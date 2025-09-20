// LinkMágico Chatbot v6.0 - Combined & Fixed Server
// Single-file server (index.js) ready for Render
require('dotenv').config();

const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const winston = require('winston');
const axios = require('axios');
const cheerio = require('cheerio');
const path = require('path');
const fs = require('fs');
const bodyParser = require('body-parser');
const morgan = require('morgan');

// Optional dependencies with graceful fallback
let puppeteer = null;
try {
    puppeteer = require('puppeteer');
    console.log('✅ Puppeteer loaded - Dynamic rendering available');
} catch (e) {
    console.log('⚠️  Puppeteer not installed - Using basic extraction only');
}

let Tesseract = null;
try {
    Tesseract = require('tesseract.js');
    console.log('✅ Tesseract loaded - OCR available');
} catch (e) {
    console.log('⚠️  Tesseract not installed - OCR unavailable');
}

const app = express();

// ===== Enhanced Logger =====
const logger = winston.createLogger({
    level: process.env.LOG_LEVEL || 'info',
    format: winston.format.combine(
        winston.format.timestamp(),
        winston.format.errors({ stack: true }),
        winston.format.json()
    ),
    transports: [
        new winston.transports.Console({
            format: winston.format.combine(
                winston.format.colorize(),
                winston.format.simple()
            )
        })
    ]
});

// ===== Middleware =====
app.use(helmet({
    contentSecurityPolicy: false,
    crossOriginEmbedderPolicy: false
}));

app.use(cors({
    origin: process.env.ALLOWED_ORIGINS ? process.env.ALLOWED_ORIGINS.split(',') : '*',
    credentials: true,
    maxAge: 86400
}));

app.use(express.json({ limit: '5mb' }));
app.use(express.urlencoded({ extended: true, limit: '5mb' }));
app.use(bodyParser.json({ limit: '5mb' }));

app.use(morgan('combined'));

// Serve static assets
const publicDir = path.join(__dirname, 'public');
if (fs.existsSync(publicDir)) {
    app.use(express.static(publicDir, {
        maxAge: '1d',
        etag: true,
        lastModified: true
    }));
}

// ===== Analytics & Cache =====
const analytics = {
    totalRequests: 0,
    chatRequests: 0,
    extractRequests: 0,
    errors: 0,
    activeChats: new Set(),
    startTime: Date.now(),
    responseTimeHistory: [],
    successfulExtractions: 0,
    failedExtractions: 0
};

app.use((req, res, next) => {
    const start = Date.now();
    analytics.totalRequests++;

    res.on('finish', () => {
        const responseTime = Date.now() - start;
        analytics.responseTimeHistory.push(responseTime);
        if (analytics.responseTimeHistory.length > 100) analytics.responseTimeHistory.shift();
        if (res.statusCode >= 400) analytics.errors++;
    });

    next();
});

const dataCache = new Map();
const CACHE_TTL = 30 * 60 * 1000; // 30 minutes

function setCacheData(key, data) {
    dataCache.set(key, { data, timestamp: Date.now() });
}

function getCacheData(key) {
    const cached = dataCache.get(key);
    if (cached && (Date.now() - cached.timestamp) < CACHE_TTL) {
        return cached.data;
    }
    dataCache.delete(key);
    return null;
}

// ===== Utility functions =====
function normalizeText(text) {
    return (text || '').replace(/\s+/g, ' ').trim();
}

function uniqueLines(text) {
    if (!text) return '';
    const seen = new Set();
    return text.split('\n')
        .map(line => line.trim())
        .filter(Boolean)
        .filter(line => {
            if (seen.has(line)) return false;
            seen.add(line);
            return true;
        })
        .join('\n');
}

function clampSentences(text, maxSentences = 2) {
    if (!text) return '';
    const sentences = normalizeText(text).split(/(?<=[.!?])\s+/);
    return sentences.slice(0, maxSentences).join(' ');
}

function shortenSentence(sentence, maxWords = 16) {
    if (!sentence) return '';
    const words = sentence.split(/\s+/);
    return words.length <= maxWords ? sentence : words.slice(0, maxWords).join(' ') + '...';
}

function extractPrices(text) {
    if (!text) return [];
    const regex = /(R\$\s?\d{1,3}(?:\.\d{3})*,\d{2}|USD\s*\d+(?:[.,]\d+)?|\$\s*\d+(?:[.,]\d+)?)/gi;
    const matches = [];
    let match;
    while ((match = regex.exec(text)) !== null) {
        matches.push(match[0]);
        if (matches.length >= 10) break;
    }
    return Array.from(new Set(matches));
}

function extractBonuses(text) {
    if (!text) return [];
    const bonusKeywords = /(bônus|bonus|brinde|extra|grátis|template|planilha|checklist|e-book|ebook)/gi;
    const lines = String(text).split(/\r?\n/).map(l => l.trim()).filter(Boolean);
    const bonuses = [];

    for (const line of lines) {
        if (bonusKeywords.test(line) && line.length > 10 && line.length < 200) {
            bonuses.push(line);
            if (bonuses.length >= 5) break;
        }
    }
    return Array.from(new Set(bonuses));
}

// ===== Hide price helper =====
// Removes price-related fields from objects that will be sent to the frontend/UI
function hidePriceFields(data) {
    try {
        if (!data || typeof data !== 'object') return;
        if (data.price) {
            // Keep a hidden copy if you want to inspect later, and remove visible price
            data._hidden_price = data.price;
            delete data.price;
        }
        if (data.price_detected && Array.isArray(data.price_detected) && data.price_detected.length) {
            data._hidden_price_detected = data.price_detected;
            data.price_detected = [];
        }
    } catch (e) {
        // silent
    }
}

// ===== Content extraction =====
function extractCleanTextFromHTML(html) {
    try {
        const $ = cheerio.load(html || '');
        $('script, style, noscript, iframe, nav, footer, aside').remove();

        const textBlocks = [];
        const selectors = ['h1', 'h2', 'h3', 'p', 'li', 'span', 'div'];

        for (const selector of selectors) {
            $(selector).each((i, element) => {
                const text = normalizeText($(element).text() || '');
                if (text && text.length > 15 && text.length < 1000) {
                    textBlocks.push(text);
                }
            });
        }

        const metaDesc = $('meta[name="description"]').attr('content') ||
            $('meta[property="og:description"]').attr('content') || '';
        if (metaDesc && metaDesc.trim().length > 20) {
            textBlocks.unshift(normalizeText(metaDesc.trim()));
        }

        const uniqueBlocks = [...new Set(textBlocks.map(b => b.trim()).filter(Boolean))];
        return uniqueBlocks.join('\n');
    } catch (error) {
        logger.warn('extractCleanTextFromHTML error:', error.message || error);
        return '';
    }
}

// ===== Page extraction =====
async function extractPageData(url) {
    const startTime = Date.now();
    try {
        if (!url) throw new Error('URL is required');

        const cacheKey = url;
        const cached = getCacheData(cacheKey);
        if (cached) {
            logger.info(`Cache hit for ${url}`);
            return cached;
        }
        logger.info(`Starting extraction for: ${url}`);

        const extractedData = {
            title: '',
            description: '',
            price: '',
            benefits: [],
            testimonials: [],
            cta: '',
            summary: '',
            cleanText: '',
            imagesText: [],
            url: url,
            extractionTime: 0,
            method: 'unknown',
            bonuses_detected: [],
            price_detected: []
        };

        let html = '';
        try {
            logger.info('Attempting Axios + Cheerio extraction...');
            const response = await axios.get(url, {
                headers: {
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
                    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
                    'Accept-Language': 'pt-BR,pt;q=0.9,en;q=0.8'
                },
                timeout: 10000,
                maxRedirects: 3,
                validateStatus: status => status >= 200 && status < 400
            });
            html = response.data || '';
            const finalUrl = response.request?.res?.responseUrl || url;
            if (finalUrl && finalUrl !== url) extractedData.url = finalUrl;
            extractedData.method = 'axios-cheerio';
            logger.info(`Axios extraction successful, HTML length: ${String(html).length}`);
        } catch (axiosError) {
            logger.warn(`Axios extraction failed for ${url}: ${axiosError.message || axiosError}`);
        }

        if (html && html.length > 100) {
            try {
                const $ = cheerio.load(html);
                $('script, style, noscript, iframe').remove();

                // Title
                const titleSelectors = ['h1', 'meta[property="og:title"]', 'meta[name="twitter:title"]', 'title'];
                for (const selector of titleSelectors) {
                    const el = $(selector).first();
                    const title = (el.attr && (el.attr('content') || el.text) ? (el.attr('content') || el.text()) : el.text ? el.text() : '').toString().trim();
                    if (title && title.length > 5 && title.length < 200) {
                        extractedData.title = title;
                        break;
                    }
                }

                // Description
                const descSelectors = ['meta[name="description"]', 'meta[property="og:description"]', '.description', 'article p', 'main p'];
                for (const selector of descSelectors) {
                    const el = $(selector).first();
                    const desc = (el.attr && (el.attr('content') || el.text) ? (el.attr('content') || el.text()) : el.text ? el.text() : '').toString().trim();
                    if (desc && desc.length > 50 && desc.length < 1000) {
                        extractedData.description = desc;
                        break;
                    }
                }

                extractedData.cleanText = extractCleanTextFromHTML(html);

                const bodyText = $('body').text() || '';
                const priceMatches = bodyText.match(/(R\$\s*\d{1,3}(?:[.,]\d{3})*(?:[.,]\d{2})?|\$\s*\d+(?:[.,]\d+)?|USD\s*\d+)/gi);
                if (priceMatches && priceMatches.length) {
                    extractedData.price = priceMatches[0];
                    extractedData.price_detected = priceMatches.slice(0, 5);
                }

                const summaryText = bodyText.replace(/\s+/g, ' ').trim();
                const sentences = summaryText.split(/[.!?]+/).map(s => s.trim()).filter(Boolean);
                extractedData.summary = sentences.slice(0, 3).join('. ').substring(0, 400) + (sentences.length > 3 ? '...' : '');

                extractedData.bonuses_detected = extractBonuses(bodyText);
                extractedData.price_detected = extractPrices(bodyText);

                logger.info(`Cheerio extraction completed for ${url}`);
                analytics.successfulExtractions++;
            } catch (cheerioError) {
                logger.warn(`Cheerio parsing failed: ${cheerioError.message || cheerioError}`);
                analytics.failedExtractions++;
            }
        }

        // Puppeteer fallback
        const minAcceptableLength = 200;
        if ((!extractedData.cleanText || extractedData.cleanText.length < minAcceptableLength) && puppeteer) {
            logger.info('Trying Puppeteer for dynamic rendering...');
            let browser = null;
            try {
                browser = await puppeteer.launch({
                    headless: true,
                    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
                    defaultViewport: { width: 1200, height: 800 },
                    timeout: 20000
                });
                const page = await browser.newPage();
                await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64)');
                await page.setRequestInterception(true);
                page.on('request', (req) => {
                    const rt = req.resourceType();
                    if (['stylesheet', 'font', 'image', 'media'].includes(rt)) req.abort();
                    else req.continue();
                });

                try {
                    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 20000 });
                } catch (gotoErr) {
                    logger.warn('Puppeteer goto failed:', gotoErr.message || gotoErr);
                }

                // quick scroll
                try {
                    await page.evaluate(async () => {
                        await new Promise((resolve) => {
                            let total = 0;
                            const dist = 300;
                            const timer = setInterval(() => {
                                window.scrollBy(0, dist);
                                total += dist;
                                if (total >= document.body.scrollHeight || total > 3000) {
                                    clearInterval(timer);
                                    resolve();
                                }
                            }, 100);
                        });
                    });
                    await page.waitForTimeout(500);
                } catch (scrollErr) {
                    logger.warn('Puppeteer scroll failed:', scrollErr.message || scrollErr);
                }

                const puppeteerData = await page.evaluate(() => {
                    const clone = document.cloneNode(true);
                    const removeEls = clone.querySelectorAll('script, style, noscript, iframe');
                    removeEls.forEach(e => e.remove());
                    return {
                        bodyText: clone.body ? clone.body.innerText : '',
                        title: document.title || '',
                        metaDescription: document.querySelector('meta[name=\"description\"]')?.content || ''
                    };
                });

                const cleanedText = normalizeText(puppeteerData.bodyText || '').replace(/\s{2,}/g, ' ');
                const lines = cleanedText.split('\n').map(l => l.trim()).filter(Boolean);
                const uniq = [...new Set(lines)];
                const finalText = uniq.join('\n');

                if (finalText && finalText.length > (extractedData.cleanText || '').length) {
                    extractedData.cleanText = finalText;
                    extractedData.method = 'puppeteer';
                    if (!extractedData.title && puppeteerData.title) extractedData.title = puppeteerData.title.slice(0, 200);
                    if (!extractedData.description && puppeteerData.metaDescription) extractedData.description = puppeteerData.metaDescription.slice(0, 500);
                    const sents = finalText.split(/[.!?]+/).map(s => s.trim()).filter(Boolean);
                    if (!extractedData.summary && sents.length) extractedData.summary = sents.slice(0, 3).join('. ').substring(0, 400) + (sents.length > 3 ? '...' : '');
                    const priceRegex = /(R\$\s*\d{1,3}(?:[.,]\d{3})*(?:[.,]\d{2})?|\$\s*\d+(?:[.,]\d+)?|USD\s*\d+)/gi;
                    const priceMatches = finalText.match(priceRegex);
                    if (priceMatches && priceMatches.length && !extractedData.price) {
                        extractedData.price = priceMatches[0];
                        extractedData.price_detected = priceMatches.slice(0, 5);
                    }
                    extractedData.bonuses_detected = extractBonuses(finalText);
                    analytics.successfulExtractions++;
                }

            } catch (puppeteerErr) {
                logger.warn('Puppeteer extraction failed:', puppeteerErr.message || puppeteerErr);
                analytics.failedExtractions++;
            } finally {
                try { if (browser) await browser.close(); } catch (e) {}
            }
        }

        // Final processing
        try {
            if (extractedData.cleanText) extractedData.cleanText = uniqueLines(extractedData.cleanText);
            if (!extractedData.title && extractedData.cleanText) {
                const firstLine = extractedData.cleanText.split('\n').find(l => l && l.length > 10 && l.length < 150);
                if (firstLine) extractedData.title = firstLine.slice(0, 150);
            }
            if (!extractedData.summary && extractedData.cleanText) {
                const sents = extractedData.cleanText.split(/(?<=[.!?])\s+/).filter(Boolean);
                extractedData.summary = sents.slice(0, 3).join('. ').slice(0, 400) + (sents.length > 3 ? '...' : '');
            }
        } catch (procErr) {
            logger.warn('Final processing failed:', procErr.message || procErr);
        }

        extractedData.extractionTime = Date.now() - startTime;
        setCacheData(cacheKey, extractedData);
        logger.info(`Extraction completed for ${url} in ${extractedData.extractionTime}ms using ${extractedData.method}`);
        return extractedData;

    } catch (error) {
        analytics.failedExtractions++;
        logger.error(`Page extraction failed for ${url}:`, error.message || error);
        return {
            title: '',
            description: '',
            price: '',
            benefits: [],
            testimonials: [],
            cta: '',
            summary: '',
            cleanText: '',
            imagesText: [],
            url: url || '',
            extractionTime: Date.now() - startTime,
            method: 'failed',
            error: error.message || String(error),
            bonuses_detected: [],
            price_detected: []
        };
    }
}

// ===== LLM Integration =====
async function callGroq(messages, temperature = 0.4, maxTokens = 300) {
    if (!process.env.GROQ_API_KEY) throw new Error('GROQ_API_KEY missing');

    const payload = {
        model: process.env.GROQ_MODEL || 'llama-3.1-70b-versatile',
        messages,
        temperature,
        max_tokens: maxTokens
    };

    const url = process.env.GROQ_API_BASE || 'https://api.groq.com/openai/v1/chat/completions';
    const headers = { 'Authorization': `Bearer ${process.env.GROQ_API_KEY}`, 'Content-Type': 'application/json' };
    const response = await axios.post(url, payload, { headers, timeout: 15000 });
    if (!(response && response.status >= 200 && response.status < 300)) throw new Error(`GROQ API failed with status ${response?.status}`);
    if (response.data?.choices?.[0]?.message?.content) return response.data.choices[0].message.content;
    throw new Error('Invalid GROQ API response format');
}

async function callOpenAI(messages, temperature = 0.2, maxTokens = 300) {
    if (!process.env.OPENAI_API_KEY) throw new Error('OPENAI_API_KEY missing');

    const model = process.env.OPENAI_MODEL || 'gpt-4o-mini';
    const url = process.env.OPENAI_API_BASE || 'https://api.openai.com/v1/chat/completions';
    const payload = { model, messages, temperature, max_tokens: maxTokens };
    const headers = { 'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`, 'Content-Type': 'application/json' };
    const response = await axios.post(url, payload, { headers, timeout: 15000 });
    if (!(response && response.status >= 200 && response.status < 300)) throw new Error(`OpenAI API failed with status ${response?.status}`);
    if (response.data?.choices?.[0]?.message?.content) return response.data.choices[0].message.content;
    throw new Error('Invalid OpenAI API response format');
}

// ===== Answer generation =====
const NOT_FOUND_MSG = "Não encontrei essa informação específica na página. Posso te ajudar com outras dúvidas ou enviar o link direto?";

function shouldActivateSalesMode(instructions = '') {
    if (!instructions) return false;
    const text = String(instructions || '').toLowerCase();
    return /sales_mode:on|consultivo|vendas|venda|cta|sempre.*link|finalize.*cta/i.test(text);
}

function generateLocalResponse(userMessage, pageData = {}, instructions = '') {
    const question = (userMessage || '').toLowerCase();
    const salesMode = shouldActivateSalesMode(instructions);

    if (/preço|valor|quanto custa/.test(question)) {
        if (pageData.price) {
            return salesMode ? `O preço é ${pageData.price}. Quer garantir sua vaga agora?` : `Preço: ${pageData.price}`;
        }
        return 'Preço não informado na página.';
    }

    if (/como funciona|funcionamento/.test(question)) {
        const summary = pageData.summary || pageData.description;
        if (summary) {
            const shortSummary = clampSentences(summary, 2);
            return salesMode ? `${shortSummary} Quer saber mais detalhes?` : shortSummary;
        }
    }

    if (/bônus|bonus/.test(question)) {
        if (pageData.bonuses_detected && pageData.bonuses_detected.length > 0) {
            const bonuses = pageData.bonuses_detected.slice(0, 2).join(', ');
            return salesMode ? `Inclui: ${bonuses}. Quer garantir todos os bônus?` : `Bônus: ${bonuses}`;
        }
        return 'Informações sobre bônus não encontradas.';
    }

    if (pageData.summary) {
        const summary = clampSentences(pageData.summary, 2);
        return salesMode ? `${summary} Posso te ajudar com mais alguma dúvida?` : summary;
    }

    return NOT_FOUND_MSG;
}

async function generateAIResponse(userMessage, pageData = {}, conversation = [], instructions = '') {
    const startTime = Date.now();
    try {
        // Make a shallow copy and remove price fields to ensure price never appears in the prompt/context
        if (pageData && typeof pageData === 'object') {
            pageData = Object.assign({}, pageData);
            if (pageData.price) {
                pageData._hidden_price = pageData.price;
                delete pageData.price;
            }
            if (pageData.price_detected) {
                pageData._hidden_price_detected = pageData.price_detected;
                pageData.price_detected = [];
            }
        }

        const salesMode = shouldActivateSalesMode(instructions);

        // Direct link handling
        if (/\b(link|página|site|comprar|inscrever)\b/i.test(userMessage) && pageData && pageData.url) {
            const url = pageData.url;
            if (salesMode) return `Aqui está o link oficial: ${url}\n\nQuer que eu te ajude com mais alguma informação sobre o produto?`;
            return `Aqui está o link: ${url}`;
        }

        const systemLines = [
            "Você é um assistente especializado em vendas online.",
            "Responda de forma clara, útil e concisa.",
            "Use apenas informações da página extraída.",
            "Nunca invente dados que não estejam disponíveis.",
            "Máximo 2-3 frases por resposta."
        ];
        if (salesMode) {
            systemLines.push("Tom consultivo e entusiasmado.");
            systemLines.push("Termine com pergunta que leve à compra.");
        }
        const systemPrompt = systemLines.join('\n');

        const contextLines = [];
        if (pageData.title) contextLines.push(`Produto: ${pageData.title}`);
        // Nota: intencionalmente NÃO incluímos o preço no contexto para evitar exibição direta
        if (pageData.bonuses_detected && pageData.bonuses_detected.length > 0) contextLines.push(`Bônus: ${pageData.bonuses_detected.slice(0, 3).join(', ')}`);
        const contentExcerpt = (pageData.summary || pageData.cleanText || '').slice(0, 1000);
        if (contentExcerpt) contextLines.push(`Informações: ${contentExcerpt}`);

        const pageContext = contextLines.join('\n');
        const userPrompt = `${instructions ? `Instruções: ${instructions}\n\n` : ''}Contexto:\n${pageContext}\n\nPergunta: ${userMessage}\n\nResponda de forma concisa usando apenas as informações fornecidas.`;

        const messages = [{ role: 'system', content: systemPrompt }, { role: 'user', content: userPrompt }];

        let response = null;
        let usedProvider = 'local';

        if (process.env.GROQ_API_KEY) {
            try {
                response = await callGroq(messages, 0.4, 250);
                usedProvider = 'groq';
                logger.info('GROQ API call successful');
            } catch (groqError) {
                logger.warn(`GROQ failed: ${groqError.message || groqError}`);
            }
        }

        if (!response && process.env.OPENAI_API_KEY) {
            try {
                response = await callOpenAI(messages, 0.2, 250);
                usedProvider = 'openai';
                logger.info('OpenAI API call successful');
            } catch (openaiError) {
                logger.warn(`OpenAI failed: ${openaiError.message || openaiError}`);
            }
        }

        if (!response || !String(response).trim()) {
            response = generateLocalResponse(userMessage, pageData, instructions);
            usedProvider = 'local';
        }

        const finalResponse = clampSentences(String(response).trim(), 3);
        const responseTime = Date.now() - startTime;
        logger.info(`AI response generated in ${responseTime}ms using ${usedProvider}`);
        return finalResponse;

    } catch (error) {
        logger.error('AI response generation failed:', error.message || error);
        return NOT_FOUND_MSG;
    }
}

// ===== API Routes =====
app.get('/health', (req, res) => {
    const uptime = process.uptime();
    const avgResponseTime = analytics.responseTimeHistory.length > 0 ?
        Math.round(analytics.responseTimeHistory.reduce((a, b) => a + b, 0) / analytics.responseTimeHistory.length) : 0;

    res.json({
        status: 'healthy',
        uptime: Math.floor(uptime),
        timestamp: new Date().toISOString(),
        version: '6.0.0',
        analytics: {
            totalRequests: analytics.totalRequests,
            chatRequests: analytics.chatRequests,
            extractRequests: analytics.extractRequests,
            errors: analytics.errors,
            activeChats: analytics.activeChats.size,
            avgResponseTime,
            successfulExtractions: analytics.successfulExtractions,
            failedExtractions: analytics.failedExtractions,
            cacheSize: dataCache.size
        },
        services: {
            groq: !!process.env.GROQ_API_KEY,
            openai: !!process.env.OPENAI_API_KEY,
            puppeteer: !!puppeteer,
            tesseract: !!Tesseract
        }
    });
});

app.get('/analytics', (req, res) => {
    const uptimeMs = Date.now() - analytics.startTime;
    const avgResponseTime = analytics.responseTimeHistory.length > 0 ?
        Math.round(analytics.responseTimeHistory.reduce((a, b) => a + b, 0) / analytics.responseTimeHistory.length) : 0;
    res.json({
        overview: {
            totalRequests: analytics.totalRequests,
            chatRequests: analytics.chatRequests,
            extractRequests: analytics.extractRequests,
            errorCount: analytics.errors,
            errorRate: analytics.totalRequests > 0 ? Math.round((analytics.errors / analytics.totalRequests) * 100) + '%' : '0%',
            activeChats: analytics.activeChats.size,
            uptime: Math.floor(uptimeMs / 1000),
            avgResponseTime,
            successRate: analytics.extractRequests > 0 ? Math.round((analytics.successfulExtractions / analytics.extractRequests) * 100) + '%' : '100%'
        },
        performance: {
            responseTimeHistory: analytics.responseTimeHistory.slice(-20),
            cacheHits: dataCache.size,
            memoryUsage: process.memoryUsage()
        }
    });
});

// /extract endpoint
app.post('/extract', async (req, res) => {
    analytics.extractRequests++;
    try {
        const { url, instructions } = req.body || {};
        if (!url) return res.status(400).json({ success: false, error: 'URL é obrigatório' });

        try { new URL(url); } catch (urlErr) { return res.status(400).json({ success: false, error: 'URL inválido' }); }

        logger.info(`Starting extraction for URL: ${url}`);
        const extractedData = await extractPageData(url);
        if (instructions) extractedData.custom_instructions = instructions;

        // Remove price fields before sending to frontend/UI
        hidePriceFields(extractedData);

        return res.json({ success: true, data: extractedData });

    } catch (error) {
        analytics.errors++;
        logger.error('Extract endpoint error:', error.message || error);
        return res.status(500).json({ success: false, error: 'Erro interno ao extrair página' });
    }
});

// /chat-universal endpoint
app.post('/chat-universal', async (req, res) => {
    analytics.chatRequests++;
    try {
        const { message, pageData, url, conversationId, instructions = '', robotName } = req.body || {};
        if (!message) return res.status(400).json({ success: false, error: 'Mensagem é obrigatória' });

        if (conversationId) {
            analytics.activeChats.add(conversationId);
            setTimeout(() => analytics.activeChats.delete(conversationId), 30 * 60 * 1000);
        }

        let processedPageData = pageData;
        if (!processedPageData && url) processedPageData = await extractPageData(url);

        // Ensure price isn't exposed via chat-universal responses & context
        if (processedPageData) hidePriceFields(processedPageData);

        const aiResponse = await generateAIResponse(message, processedPageData || {}, [], instructions);

        let finalResponse = aiResponse;
        if (processedPageData?.url && !String(finalResponse).includes(processedPageData.url)) {
            finalResponse = `${finalResponse}\n\n${processedPageData.url}`;
        }

        return res.json({
            success: true,
            response: finalResponse,
            bonuses_detected: processedPageData?.bonuses_detected || [],
            metadata: {
                hasPageData: !!processedPageData,
                contentLength: processedPageData?.cleanText?.length || 0,
                method: processedPageData?.method || 'none'
            }
        });

    } catch (error) {
        analytics.errors++;
        logger.error('Chat endpoint error:', error.message || error);
        return res.status(500).json({ success: false, error: 'Erro interno ao gerar resposta' });
    }
});

// Widget JS
app.get('/widget.js', (req, res) => {
    res.set('Content-Type', 'application/javascript');
    res.send(`// LinkMágico Widget v6.0 - Optimized
(function() {
    'use strict';
    if (window.LinkMagicoWidget) return;
    var LinkMagicoWidget = {
        config: {
            position: 'bottom-right',
            primaryColor: '#667eea',
            robotName: 'Assistente IA',
            salesUrl: '',
            instructions: '',
            apiBase: window.location.origin
        },
        init: function(userConfig) {
            this.config = Object.assign(this.config, userConfig || {});
            if (document.readyState === 'loading') {
                document.addEventListener('DOMContentLoaded', this.createWidget.bind(this));
            } else {
                this.createWidget();
            }
        },
        createWidget: function() {
            var container = document.createElement('div');
            container.id = 'linkmagico-widget';
            container.innerHTML = this.getHTML();
            this.addStyles();
            document.body.appendChild(container);
            this.bindEvents();
        },
        getHTML: function() {
            return '<div class=\"lm-button\" id=\"lm-button\"><i class=\"fas fa-comments\"></i></div><div class=\"lm-chat\" id=\"lm-chat\" style=\"display:none;flex-direction:column;display:flex;\">' +
                   '<div class=\"lm-header\"><span>' + this.config.robotName + '</span><button id=\"lm-close\">×</button></div>' +
                   '<div class=\"lm-messages\" id=\"lm-messages\"><div class=\"lm-msg lm-bot\">Olá! Como posso ajudar?</div></div>' +
                   '<div class=\"lm-input\"><input id=\"lm-input\" placeholder=\"Digite...\"><button id=\"lm-send\">➤</button></div></div>';
        },
        addStyles: function() {
            if (document.getElementById('lm-styles')) return;
            var css = '#linkmagico-widget{position:fixed;right:20px;bottom:20px;z-index:999999;font-family:sans-serif}.lm-button{width:60px;height:60px;background:' + this.config.primaryColor + ';border-radius:50%;display:flex;align-items:center;justify-content:center;color:white;font-size:24px;cursor:pointer;box-shadow:0 4px 20px rgba(0,0,0,0.15);transition:all 0.3s}.lm-chat{position:absolute;bottom:80px;right:0;width:350px;height:500px;background:white;border-radius:15px;box-shadow:0 10px 40px rgba(0,0,0,0.15);display:flex;flex-direction:column;overflow:hidden}.lm-header{background:' + this.config.primaryColor + ';color:white;padding:15px;display:flex;justify-content:space-between;align-items:center}.lm-close{background:none;border:none;color:white;cursor:pointer;font-size:20px}.lm-messages{flex:1;padding:15px;overflow-y:auto;display:flex;flex-direction:column;gap:10px}.lm-msg{max-width:80%;padding:10px 15px;border-radius:12px;font-size:14px}.lm-bot{background:#f1f3f4;color:#333;align-self:flex-start}.lm-user{background:' + this.config.primaryColor + ';color:white;align-self:flex-end}.lm-input{padding:15px;display:flex;gap:10px}.lm-input input{flex:1;border:1px solid #e0e0e0;border-radius:20px;padding:10px 15px;outline:none}.lm-input button{background:' + this.config.primaryColor + ';border:none;border-radius:50%;width:40px;height:40px;color:white;cursor:pointer}';
            var style = document.createElement('style');
            style.id = 'lm-styles';
            style.textContent = css;
            document.head.appendChild(style);
        },
        bindEvents: function() {
            var self = this;
            document.addEventListener('click', function(ev) {
                if (ev.target && ev.target.id === 'lm-button') {
                    var chat = document.getElementById('lm-chat');
                    if (chat) chat.style.display = chat.style.display === 'flex' ? 'none' : 'flex';
                }
            });
            // delegated events
            document.addEventListener('click', function(ev){
                if (ev.target && ev.target.id === 'lm-close') document.getElementById('lm-chat').style.display = 'none';
                if (ev.target && ev.target.id === 'lm-send') self.send();
            });
            document.addEventListener('keypress', function(e){
                if (e.key === 'Enter' && document.activeElement && document.activeElement.id === 'lm-input') self.send();
            });
        },
        send: function() {
            var input = document.getElementById('lm-input');
            var msg = input ? input.value.trim() : '';
            if (!msg) return;
            this.addMsg(msg, true);
            if (input) input.value = '';
            var self = this;
            fetch(this.config.apiBase + '/chat-universal', {
                method: 'POST',
                headers: {'Content-Type': 'application/json'},
                body: JSON.stringify({
                    message: msg,
                    robotName: this.config.robotName,
                    instructions: this.config.instructions,
                    url: this.config.salesUrl,
                    conversationId: 'widget_' + Date.now()
                })
            }).then(function(r){ return r.json(); })
            .then(function(d){ if (d.success) self.addMsg(d.response, false); else self.addMsg('Erro. Tente novamente.', false); })
            .catch(function(){ self.addMsg('Erro de conexão.', false); });
        },
        addMsg: function(text, isUser) {
            var div = document.createElement('div');
            div.className = 'lm-msg ' + (isUser ? 'lm-user' : 'lm-bot');
            div.textContent = text;
            var container = document.getElementById('lm-messages');
            if (container) { container.appendChild(div); container.scrollTop = container.scrollHeight; }
        }
    };
    window.LinkMagicoWidget = LinkMagicoWidget;
})();
`);
});

// Chatbot HTML endpoint
function generateChatbotHTML(pageData = {}, robotName = 'Assistente IA', customInstructions = '') {
    const escapedPageData = JSON.stringify(pageData || {});
    const safeRobotName = String(robotName || 'Assistente IA').replace(/"/g, '\\"');
    const safeInstructions = String(customInstructions || '').replace(/"/g, '\\"');

    return `<!doctype html>
<html lang="pt-BR">
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>LinkMágico Chatbot - ${safeRobotName}</title>
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700&display=swap" rel="stylesheet">
<link href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.5.1/css/all.min.css" rel="stylesheet">
<style>
* { box-sizing: border-box; margin: 0; padding: 0; }
body { font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); min-height: 100vh; display: flex; align-items: center; justify-content: center; padding: 15px; }
.chat-container { background: rgba(255,255,255,0.95); backdrop-filter: blur(20px); border-radius: 20px; width: 100%; max-width: 600px; height: 90vh; max-height: 700px; display: flex; flex-direction: column; box-shadow: 0 20px 60px rgba(0,0,0,0.15); overflow: hidden; }
.chat-header { background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; padding: 20px; text-align: center; }
.chat-header h1 { font-size: 1.3rem; font-weight: 700; margin-bottom: 5px; }
.chat-messages { flex: 1; padding: 20px; overflow-y: auto; background: linear-gradient(to bottom, #f9fafb, white); }
.message { margin-bottom: 15px; display: flex; align-items: flex-end; gap: 10px; }
.message .message-avatar { width: 40px; height: 40px; border-radius: 50%; background: #f3f4f6; display:flex; align-items:center; justify-content:center; color:#374151; }
.message .message-content { background: #fff; padding: 12px 14px; border-radius: 12px; box-shadow: 0 6px 20px rgba(0,0,0,0.04); max-width: 80%; }
.message.user .message-content { background: linear-gradient(135deg,#667eea,#764ba2); color: white; }
.chat-input { padding: 20px; background: white; border-top: 1px solid #e5e7eb; display:flex; gap:10px; align-items:center; }
.message-input { flex: 1; padding: 12px 16px; border: 2px solid #e5e7eb; border-radius: 20px; font-size: 0.9rem; }
.send-btn { width: 44px; height: 44px; border: none; border-radius: 50%; background: linear-gradient(135deg,#667eea,#764ba2); color: white; cursor: pointer; display:flex; align-items:center; justify-content:center; }
@media (max-width: 768px) { .chat-container { height: 100vh; border-radius: 0; } }
</style>
</head>
<body>
<div class="chat-container">
    <div class="chat-header"><h1>${safeRobotName}</h1><p>Assistente Inteligente para Vendas</p></div>
    <div class="chat-messages" id="chatMessages">
        <div class="message bot"><div class="message-avatar"><i class="fas fa-robot"></i></div><div class="message-content">Olá! Sou o ${safeRobotName}. Como posso te ajudar hoje?</div></div>
    </div>
    <div class="chat-input">
        <input id="messageInput" class="message-input" placeholder="Digite sua pergunta..." maxlength="500" />
        <button id="sendBtn" class="send-btn"><i class="fas fa-paper-plane"></i></button>
    </div>
</div>

<script>
const pageData = ${escapedPageData};
const robotName = "${safeRobotName}";
const instructions = "${safeInstructions}";
const conversationId = 'chat_' + Date.now();

function addMessage(content, isUser) {
    const container = document.getElementById('chatMessages');
    const messageDiv = document.createElement('div');
    messageDiv.className = 'message ' + (isUser ? 'user' : 'bot');
    const avatar = document.createElement('div'); avatar.className = 'message-avatar';
    avatar.innerHTML = isUser ? '<i class="fas fa-user"></i>' : '<i class="fas fa-robot"></i>';
    const contentDiv = document.createElement('div'); contentDiv.className = 'message-content';
    contentDiv.textContent = content;
    messageDiv.appendChild(avatar);
    messageDiv.appendChild(contentDiv);
    container.appendChild(messageDiv);
    container.scrollTop = container.scrollHeight;
}

async function sendMessage() {
    const input = document.getElementById('messageInput');
    const message = input.value.trim();
    if (!message) return;
    document.getElementById('sendBtn').disabled = true;
    addMessage(message, true);
    input.value = '';
    try {
        const response = await fetch('/chat-universal', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ message: message, pageData: pageData, robotName: robotName, conversationId: conversationId, instructions: instructions })
        });
        const data = await response.json();
        if (data.success) {
            let reply = data.response;
            if (data.bonuses_detected && data.bonuses_detected.length > 0) reply += "\\n\\nBônus inclusos: " + data.bonuses_detected.slice(0,3).join(", ");
            addMessage(reply, false);
        } else { addMessage('Desculpe, ocorreu um erro. Tente novamente.', false); }
    } catch (err) {
        addMessage('Erro de conexão. Tente novamente.', false);
    } finally {
        document.getElementById('sendBtn').disabled = false;
    }
}

document.getElementById('sendBtn').onclick = sendMessage;
document.getElementById('messageInput').onkeypress = function(e){ if (e.key === 'Enter') sendMessage(); };
</script>
</body>
</html>`;
}

// Chatbot endpoint
app.get('/chatbot', async (req, res) => {
    try {
        const robotName = req.query.name || 'Assistente IA';
        const url = req.query.url || '';
        const instructions = req.query.instructions || '';
        let pageData = {};
        if (url) {
            try { pageData = await extractPageData(url); } catch (e) { logger.warn('Failed to extract for chatbot UI:', e.message || e); }
        }

        // Ensure price fields are hidden before embedding into HTML
        if (pageData) hidePriceFields(pageData);

        const html = generateChatbotHTML(pageData, robotName, instructions);
        res.set('Content-Type', 'text/html; charset=utf-8').send(html);
    } catch (err) {
        logger.error('Chatbot HTML generation error:', err.message || err);
        res.status(500).send('<h3>Erro ao gerar interface do chatbot</h3>');
    }
});

// Root endpoint
app.get('/', (req, res) => {
    const indexPath = path.join(__dirname, 'public', 'index.html');
    if (fs.existsSync(indexPath)) return res.sendFile(indexPath);
    return res.send(`<html><body style="font-family: Arial, sans-serif; text-align:center; padding:40px;">
        <h1>🤖 LinkMágico Chatbot v6.0</h1>
        <p>Sistema de IA Conversacional para Vendas Online</p>
        <p><a href="/health">Status</a> • <a href="/analytics">Analytics</a> • <a href="/widget.js">Widget</a> • <a href="/chatbot">Chat Demo</a></p>
    </body></html>`);
});

// Error handlers
app.use((err, req, res, next) => {
    analytics.errors++;
    logger.error('Unhandled error:', err);
    res.status(err.status || 500).json({ success: false, error: process.env.NODE_ENV === 'production' ? 'Internal server error' : (err.message || String(err)) });
});

app.use((req, res) => {
    res.status(404).json({ success: false, error: 'Endpoint not found' });
});

// Graceful shutdown
process.on('SIGTERM', () => { logger.info('SIGTERM received, shutting down'); process.exit(0); });
process.on('SIGINT', () => { logger.info('SIGINT received, shutting down'); process.exit(0); });

// Start server
const PORT = parseInt(process.env.PORT || '3000', 10);
app.listen(PORT, '0.0.0.0', () => {
    logger.info(`🚀 LinkMágico Chatbot v6.0 Server Started on port ${PORT}`);
    console.log(`Server started on port ${PORT}`);
});



/*****************************************************
 * Chatbot creation & distribution (NEW FIXES)
 *****************************************************/

const chatbots = new Map();

function makeSlug() {
  const t = Date.now().toString(36);
  const r = Math.random().toString(36).slice(2,8);
  return (t + '-' + r);
}

app.post('/create-chatbot', async (req, res) => {
  try {
    const { robotName = 'Assistente IA', url = '', instructions = '', channels = [] } = req.body || {};
    if (!url) return res.status(400).json({ success:false, error:'URL é obrigatório' });
    try { new URL(url); } catch(e) { return res.status(400).json({ success:false, error:'URL inválido' }); }

    let pageData = {};
    try {
      pageData = await extractPageData(url);
    } catch (e) {
      logger.warn('Extraction failed during create-chatbot: ' + (e.message || e));
      pageData = { url };
    }

    hidePriceFields(pageData);

    const slug = makeSlug();
    const record = { robotName, instructions, pageData, channels, createdAt: Date.now() };
    chatbots.set(slug, record);

    const base = (req.protocol ? req.protocol : 'http') + '://' + (req.get('host') || req.headers.host);
    const chatLink = `${base}/c/${encodeURIComponent(slug)}`;
    const embedCode = `<script>(function(){var s=document.createElement('script');s.src='${base}/widget.js';s.onload=function(){window.LinkMagicoWidget && window.LinkMagicoWidget.init({robotName:${JSON.stringify(robotName)}, instructions:${JSON.stringify(instructions)}, apiBase:'${base}', salesUrl:'${pageData.url || ''}'});};document.head.appendChild(s);})();</script>`;

    return res.json({ success:true, slug, chatLink, embedCode, record });
  } catch (err) {
    analytics.errors++; logger.error('create-chatbot error: ' + (err.message || err));
    return res.status(500).json({ success:false, error:'Erro ao criar chatbot' });
  }
});

app.get('/c/:slug', async (req, res) => {
  try {
    const slug = req.params.slug;
    const record = chatbots.get(slug);
    if (!record) return res.status(404).send('<h3>Chatbot não encontrado (slug inválido)</h3>');
    const html = generateChatbotHTML(record.pageData || {}, record.robotName || 'Assistente IA', record.instructions || '');
    res.set('Content-Type','text/html; charset=utf-8').send(html);
  } catch (err) {
    logger.error('Serve chatbot by slug failed: ' + (err.message || err));
    res.status(500).send('<h3>Erro ao carregar chatbot</h3>');
  }
});

app.get('/dashboard/admin', (req, res) => {
  const base = (req.protocol ? req.protocol : 'http') + '://' + (req.get('host') || req.headers.host);
  res.send(`
  <!doctype html>
  <html lang="pt-BR">
  <head>
    <meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
    <title>LinkMágico - Painel Admin</title>
    <link href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700&display=swap" rel="stylesheet">
    <style>
      body{font-family:Inter,system-ui,Segoe UI,Roboto,Helvetica,Arial,sans-serif;background:#0f172a;color:#fff;padding:24px}
      .container{max-width:1100px;margin:0 auto;display:grid;grid-template-columns:1fr 420px;gap:20px;align-items:start}
      .card{background:linear-gradient(180deg,#0b1220,#0f172a);padding:18px;border-radius:12px;box-shadow:0 10px 30px rgba(2,6,23,0.7)}
      label{display:block;font-size:0.9rem;margin-bottom:8px;color:#cbd5e1}
      input,textarea,select{width:100%;padding:10px;border-radius:8px;border:1px solid #1f2937;background:#020617;color:#fff;margin-bottom:12px}
      .btn{display:inline-block;padding:12px 18px;border-radius:10px;background:linear-gradient(90deg,#7c3aed,#06b6d4);color:white;border:0;cursor:pointer}
      .social-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:8px;margin-top:8px}
      .social{padding:10px;border-radius:8px;background:#111827;text-align:center;cursor:pointer}
      iframe.preview{width:100%;height:600px;border-radius:8px;border:1px solid #111827;background:#fff}
      .muted{color:#9ca3af;font-size:0.85rem}
      .small{font-size:0.9rem;color:#e6eef8;margin-top:8px}
    </style>
  </head>
  <body>
    <h1>LinkMágico - Painel de Criação</h1>
    <p class="muted">Crie chatbots distribuíveis para clientes. Abaixo insira os dados e clique em <strong>Ativar Chatbot Inteligente</strong>.</p>
    <div class="container">
      <div class="card">
        <label>Nome do Assistente Virtual</label>
        <input id="robotName" placeholder="Assistente de Vendas"/>
        <label>URL da Página</label>
        <input id="pageUrl" placeholder="https://exemplo.com/produto"/>
        <label>Instruções Personalizadas (opcional)</label>
        <textarea id="instructions" rows="4" placeholder="Seja consultivo, termine com CTA..."></textarea>
        <div style="display:flex;gap:10px;align-items:center">
          <button id="activateBtn" class="btn">🚀 Ativar Chatbot Inteligente</button>
          <button id="copyEmbed" class="btn" style="background:#111827">📋 Copiar Embed</button>
        </div>
        <div class="small">Canais: selecione manualmente no painel do cliente. Após ativar, use os botões abaixo para compartilhar o link.</div>
        <div style="margin-top:12px">
          <div class="social-grid">
            <div class="social" id="shareWhatsapp">WhatsApp</div>
            <div class="social" id="shareTelegram">Telegram</div>
            <div class="social" id="shareFacebook">Facebook</div>
            <div class="social" id="shareTwitter">Twitter</div>
            <div class="social" id="shareLinkedin">LinkedIn</div>
            <div class="social" id="shareCopy">Copiar Link</div>
          </div>
        </div>
        <div id="responseArea" style="margin-top:12px;color:#d1fae5"></div>
      </div>

      <div class="card">
        <h3>Preview do Chatbot</h3>
        <iframe id="preview" class="preview" src="${base}/chatbot" title="Preview do Chatbot"></iframe>
        <div class="small" style="margin-top:8px">Após ativar, o preview carrega a versão distribuível. Também é possível usar o código embed para inserir o widget no site do cliente.</div>
      </div>
    </div>

    <script>
      const activateBtn = document.getElementById('activateBtn');
      const preview = document.getElementById('preview');
      const responseArea = document.getElementById('responseArea');
      const copyEmbedBtn = document.getElementById('copyEmbed');
      let latest = null;

      activateBtn.addEventListener('click', async function() {
        const robotName = document.getElementById('robotName').value || 'Assistente IA';
        const pageUrl = document.getElementById('pageUrl').value || '';
        const instructions = document.getElementById('instructions').value || '';
        if(!pageUrl){ responseArea.textContent = 'A URL da página é obrigatória'; return; }
        activateBtn.disabled = true;
        activateBtn.textContent = 'Ativando...';
        try {
          const res = await fetch('/create-chatbot', {
            method:'POST',
            headers:{'Content-Type':'application/json'},
            body: JSON.stringify({ robotName, url: pageUrl, instructions, channels: [] })
          });
          const data = await res.json();
          if (data && data.success) {
            latest = data;
            responseArea.innerHTML = '<div>✅ Chatbot criado: <a href="'+data.chatLink+'" target="_blank">'+data.chatLink+'</a></div>';
            preview.src = data.chatLink;
            copyToClipboard(data.embedCode);
          } else {
            responseArea.textContent = 'Erro ao criar: ' + (data.error || JSON.stringify(data));
          }
        } catch (e) {
          responseArea.textContent = 'Erro de rede ao criar chatbot';
        } finally {
          activateBtn.disabled = false;
          activateBtn.textContent = '🚀 Ativar Chatbot Inteligente';
        }
      });

      copyEmbedBtn.addEventListener('click', function(){
        if(latest && latest.embedCode) copyToClipboard(latest.embedCode);
      });

      function copyToClipboard(text){
        try {
          navigator.clipboard.writeText(text);
          responseArea.innerHTML = '<div>✅ Copiado para a área de transferência</div>';
        } catch(e){
          responseArea.innerHTML = '<div>🔔 Copiar manualmente: <textarea style="width:100%;height:80px">'+text+'</textarea></div>';
        }
      }

      document.getElementById('shareWhatsapp').addEventListener('click', function(){
        if(!latest) return alert('Crie o chatbot primeiro');
        const url = 'https://wa.me/?text=' + encodeURIComponent(latest.chatLink);
        window.open(url,'_blank');
      });
      document.getElementById('shareTelegram').addEventListener('click', function(){
        if(!latest) return alert('Crie o chatbot primeiro');
        const url = 'https://t.me/share/url?url=' + encodeURIComponent(latest.chatLink);
        window.open(url,'_blank');
      });
      document.getElementById('shareFacebook').addEventListener('click', function(){
        if(!latest) return alert('Crie the chatbot primeiro');
        const url = 'https://www.facebook.com/sharer/sharer.php?u=' + encodeURIComponent(latest.chatLink);
        window.open(url,'_blank');
      });
      document.getElementById('shareTwitter').addEventListener('click', function(){
        if(!latest) return alert('Crie o chatbot primeiro');
        const url = 'https://twitter.com/intent/tweet?url=' + encodeURIComponent(latest.chatLink);
        window.open(url,'_blank');
      });
      document.getElementById('shareLinkedin').addEventListener('click', function(){
        if(!latest) return alert('Crie o chatbot primeiro');
        const url = 'https://www.linkedin.com/sharing/share-offsite/?url=' + encodeURIComponent(latest.chatLink);
        window.open(url,'_blank');
      });
      document.getElementById('shareCopy').addEventListener('click', function(){
        if(!latest) return alert('Crie o chatbot primeiro');
        copyToClipboard(latest.chatLink);
      });
    </script>
  </body>
  </html>
  `);
});

app.get('/dashboard/list-chatbots', (req, res) => {
  const list = Array.from(chatbots.entries()).map(([slug, r])=>({ slug, robotName: r.robotName, url: r.pageData?.url || '', createdAt: r.createdAt }));
  res.json({ success:true, count: list.length, list });
});

// Keep module.exports for compatibility (if the original trimmed it above)
module.exports = app;
