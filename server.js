// ================================================================
// LinkMágico Chatbot - server.js (integrado, ajustado e completíssimo)
// ================================================================
// Observações:
// - Arquivo único com extração (axios + cheerio), fallback com Puppeteer (se instalado),
//   OCR via Tesseract.js (se instalado), orquestração de LLMs (GROQ -> OpenAI -> OpenRouter),
//   UI minimalista embarcada e endpoints /health, /extract, /chat-universal, /scrape e /chatbot.
// - Pronto para rodar em ambientes como Render. Ajuste variáveis de ambiente conforme necessário.
// - Variáveis de ambiente importantes:
//    PORT, LOG_LEVEL,
//    GROQ_API_KEY, GROQ_API_BASE, GROQ_MODEL,
//    OPENAI_API_KEY, OPENAI_API_BASE, OPENAI_MODEL,
//    OPENROUTER_API_KEY, OPENROUTER_API_BASE, OPENROUTER_MODEL
// ================================================================

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

// Optional dependencies (try/catch to allow lighter deployments)
let puppeteer = null;
try {
  puppeteer = require('puppeteer');
} catch (e) {
  // Puppeteer not installed — dynamic rendering fallback will be unavailable.
}

let Tesseract = null;
try {
  Tesseract = require('tesseract.js');
} catch (e) {
  // Tesseract not installed — OCR will be skipped.
}

const app = express();

// ===== Logger =====
const logger = winston.createLogger({
  level: process.env.LOG_LEVEL || 'info',
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.prettyPrint()
  ),
  transports: [new winston.transports.Console()]
});

// ===== Middleware =====
app.use(helmet({ contentSecurityPolicy: false, crossOriginEmbedderPolicy: false }));
app.use(cors());
app.use(express.json({ limit: '12mb' }));
app.use(express.urlencoded({ extended: true, limit: '12mb' }));
app.use(bodyParser.json());
app.use(morgan('dev'));

// Serve static assets if ./public exists
const publicDir = path.join(__dirname, 'public');
if (fs.existsSync(publicDir)) {
  app.use(express.static(publicDir));
}

// ===== Utilities =====
function normalizeText(t) {
  return (t || '').replace(/\s+/g, ' ').trim();
}
function clampSentences(text, max = 2) {
  if (!text) return '';
  const sents = normalizeText(text).split(/(?<=[.!?])\s+/);
  return sents.slice(0, max).join(' ');
}
function clampChars(text, max = 120) {
  if (!text) return '';
  return text.length <= max ? text : text.slice(0, max) + '…';
}
function shortenSentence(s, maxWords = 16) {
  if (!s) return '';
  const words = s.split(/\s+/);
  return words.length <= maxWords ? s : words.slice(0, maxWords).join(' ') + '...';
}
function uniqueLines(text) {
  if (!text) return '';
  const seen = new Set();
  return text.split('\n').map(l => l.trim()).filter(Boolean).filter(l => {
    if (seen.has(l)) return false;
    seen.add(l);
    return true;
  }).join('\n');
}
function tokenize(s) {
  if (!s) return [];
  return (s.toLowerCase().match(/[a-zá-úà-ùâ-ûãõç0-9]+/gi) || []).filter(w => ![
    'a','o','os','as','um','uma','de','da','do','das','dos','e','é','em','para','por','com','sem',
    'entre','sobre','que','quem','quando','onde','qual','quais','como','porque','se','no','na','nos','nas',
    'ao','à','às','aos','até','the','of','and','to','in','for','on','at','from','is','are','be','or','by',
    'with','this','that','as','it','its'
  ].includes(w));
}

// Helper: find list-like lines from text
function findListItemsFromText(text) {
  if (!text) return [];
  const lines = text.split('\n').map(l => l.trim()).filter(Boolean);
  const items = [];
  for (const l of lines) {
    if (/^(?:-|\u2022|\*|\d+\.)\s+/.test(l)) {
      items.push(l.replace(/^(?:-|\u2022|\*|\d+\.)\s+/, ''));
      continue;
    }
    if (l.length < 140 && l.split(' ').length <= 20) items.push(l);
    if (items.length >= 12) break;
  }
  return uniqueLines(items.join('\n')).split('\n').filter(Boolean);
}

// ===== Context extraction helpers =====
function extractPrices(text) {
  if (!text) return [];
  const regex = /(R\$\s?\d{1,3}(?:\.\d{3})*,\d{2})/gi;
  const out = [];
  let m;
  while ((m = regex.exec(text)) !== null) {
    out.push(m[0]);
    if (out.length >= 20) break;
  }
  return Array.from(new Set(out));
}

function extractGuarantees(text) {
  if (!text) return [];
  const regex = /garantia\s*(de)?\s*\d+\s*(dias|meses)/gi;
  const out = [];
  let m;
  while ((m = regex.exec(text)) !== null) {
    out.push(m[0]);
    if (out.length >= 10) break;
  }
  return Array.from(new Set(out));
}

function extractCTAs(text) {
  if (!text) return [];
  const candidates = [];
  const lines = String(text).split(/\r?\n/).map(l => l.trim()).filter(Boolean);
  const actionWords = /(comprar|quero|adquirir|saiba mais|inscreva|assine|compre|agora|garanta|obter|garanta seu|quero meu)/i;
  for (const l of lines) {
    if (l.length > 3 && l.length < 120 && actionWords.test(l)) {
      candidates.push(l);
    }
    if (l.split(' ').length <= 4 && /^(comprar|quero|compre|garanta|assine|inscreva-se|saiba)/i.test(l)) candidates.push(l);
    if (candidates.length >= 12) break;
  }
  return Array.from(new Set(candidates)).slice(0, 12);
}

function extractBullets(text) {
  if (!text) return [];
  const lines = String(text).split(/\r?\n/).map(l => l.trim()).filter(Boolean);
  const bullets = [];
  for (const l of lines) {
    if (/^(?:\*|\-|\u2022|\d+\.)\s+/.test(l)) {
      bullets.push(l.replace(/^(?:\*|\-|\u2022|\d+\.)\s+/, ''));
      continue;
    }
    if (/^(✔|✓)/.test(l)) {
      bullets.push(l.replace(/^(✔|✓)\s*/, ''));
      continue;
    }
    if (l.length > 20 && l.length < 140 && /(módul|módulos|aulas|benefício|beneficios|benefício|benefícios|conteúdo|conteudos|módulo|aula|bonu?s)/i.test(l)) {
      bullets.push(l);
    }
    if (bullets.length >= 20) break;
  }
  return Array.from(new Set(bullets)).slice(0, 12);
}

function extractTestimonials(text) {
  if (!text) return [];
  const lines = String(text).split(/\r?\n/).map(l => l.trim()).filter(Boolean);
  const out = [];
  const emotive = /(obrigad|mudou minha vida|funciona|resultado|amei|recomendo|vende(d|u)|consegui|transformou|resultado|aprovado)/i;
  for (const l of lines) {
    if (l.length >= 12 && l.length <= 220 && emotive.test(l)) {
      out.push(l);
    }
    if (out.length >= 20) break;
  }
  return Array.from(new Set(out)).slice(0, 12);
}


// ===== OCR (optional) =====
async function extractTextFromImages(urls) {
  const results = [];
  if (!Tesseract) {
    logger.info('OCR skipped: Tesseract.js not available.');
    return results;
  }
  for (const u of urls) {
    try {
      const res = await axios.get(u, { responseType: 'arraybuffer', timeout: 20000 });
      const buffer = Buffer.from(res.data, 'binary');
      const { data: { text } } = await Tesseract.recognize(buffer, 'por+eng');
      if (text && text.trim().length > 5) {
        logger.info(`OCR detectado em ${u}: ${clampChars(text, 120)}`);
        results.push(text.trim());
      }
    } catch (err) {
      logger.warn("OCR falhou em " + u + " -> " + (err && err.message ? err.message : String(err)));
    }
  }
  return results;
}

// ===== Text extraction (Cheerio + Puppeteer fallback) =====
function extractCleanTextFromHTML(html) {
  try {
    const $ = cheerio.load(html || '');
    $('script,style,noscript,iframe').remove();
    const selectors = ['h1','h2','h3','h4','h5','h6','p','li','span','div','button','strong','em','blockquote','a'];
    const blocks = [];
    for (const sel of selectors) {
      $(sel).each((i, el) => {
        const txt = normalizeText($(el).text() || '');
        if (txt && txt.length > 10 && txt.length < 2000) blocks.push(txt);
      });
    }
    const metaDesc = $('meta[name="description"]').attr('content') || $('meta[property="og:description"]').attr('content') || '';
    if (metaDesc && metaDesc.trim().length > 20) blocks.unshift(normalizeText(metaDesc.trim()));
    const unique = [...new Set(blocks.map(b => b.trim()).filter(Boolean))];
    return unique.join('\n');
  } catch (e) {
    logger.warn('extractCleanTextFromHTML error', e?.message || e);
    return '';
  }
}


// ===== Price detection helpers =====
function detectPricesFromSource(source = '') {
  if (!source) return null;
  const priceRegex = /(?:r\$\s*)?(\d{1,3}(?:[.\s]\d{3})*(?:[.,]\d{2})|\d+(?:[.,]\d{2})?)/gi;
  const matches = [];
  let m;
  while ((m = priceRegex.exec(source)) !== null) {
    const raw = m[1];
    const normalized = parseFloat(raw.replace(/\./g, '').replace(',', '.'));
    if (!isNaN(normalized)) matches.push({ raw: `R$${raw}`, value: normalized });
    if (matches.length > 20) break;
  }
  if (!matches.length) return null;
  const values = matches.map(x => x.value);
  const max = Math.max(...values);
  const min = Math.min(...values);
  if (max === min) {
    return { full: null, promo: min, rawPromo: matches.find(x => x.value === min)?.raw || null };
  }
  return {
    full: max,
    promo: min,
    rawFull: matches.find(x => x.value === max)?.raw || null,
    rawPromo: matches.find(x => x.value === min)?.raw || null
  };
}
function formatBRL(v) {
  try {
    if (v == null) return null;
    return Number(v).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
  } catch (e) {
    return v == null ? null : `R$${String(v).replace('.', ',')}`;
  }
}

// ===== User-provided logic & heuristics =====
const NOT_FOUND_MSG = "Não encontrei essa informação nesta página. Quer que eu mostre o link direto?";

function userAskedForLink(q) {
  if (!q) return false;
  return /\blink|página de vendas|página|site|inscriç|inscrição|inscrever|comprar|quero comprar|quero me inscrever|link da página|página de vendas\b/i.test(q);
}

function shouldActivateSalesMode(instructions = '') {
  if (!instructions) return false;
  try {
    const txt = String(instructions || '');
    if (/sales_mode:on/i.test(txt)) return true;
    if (/consultivo|vendas|venda|call[- ]?to[- ]?action|cta|sempre envie o link|finalize com o cta/i.test(txt)) return true;
    return false;
  } catch (e) {
    return false;
  }
}

function parseInstructions(instructions = '') {
  return { raw: instructions || '' };
}

// ===== universalAnswer =====
function universalAnswer(pageData = {}, question = '', instructions = '') {
  try {
    const salesMode = shouldActivateSalesMode(instructions);

    if (userAskedForLink(question) && pageData && pageData.url) {
      if (salesMode) {
        return {
          mode: 'direct_link',
          answer: `🌟 Aqui está o link oficial: ${pageData.url}\nQuer que eu te envie o passo a passo para garantir agora? 🚀`
        };
      }
      return { mode: 'direct_link', answer: `Aqui está o link oficial: ${pageData.url}` };
    }

    const instrOpts = parseInstructions(instructions);

    const summary = normalizeText(pageData.summary || '');
    const description = normalizeText(pageData.description || '');
    const cleanText = normalizeText(pageData.cleanText || '');
    const source = [summary, description, cleanText].filter(Boolean).join('\n\n');

    if (!source || source.length < 30) {
      if (salesMode) {
        const cta = 'Quer que eu te envie o link para garantir agora?';
        return {
          mode: 'sales_fallback',
          answer: `Entendo sua dúvida 😊\n- Este produto entrega benefícios práticos e focados em resultados.\n- Posso encaminhar o link de compra agora mesmo.\n${cta}`
        };
      }
      return { mode: 'not_found', answer: NOT_FOUND_MSG };
    }

    // Casos específicos em modo de vendas
    if (salesMode) {
      const q = (question || '').toLowerCase();
      const priceInfo = detectPricesFromSource(source);

      if (/\bcar[oa]\b|\bcaro demais\b|\bpreço alto\b/.test(q)) {
        const lines = [];
        lines.push('Entendo a preocupação com o preço — foque no retorno que isso pode gerar. ✅');
        if (priceInfo?.promo) {
          const full = priceInfo.full ? formatBRL(priceInfo.full) : null;
          const promo = formatBRL(priceInfo.promo);
          if (full) lines.push(`Hoje está saindo de ${full} por ${promo} — investimento único para acelerar resultados.`);
          else lines.push(`Hoje está com valor promocional de ${promo}.`);
        } else {
          lines.push('O investimento é pequeno em comparação ao valor entregue e ao tempo que você economiza.');
        }
        lines.push('Quer que eu te envie o link para garantir agora? 🚀');
        return { mode: 'sales_objection_price', answer: lines.join('\n') };
      }

      if (/confus[oa]|n[aã]o entendi|poderia resumir/.test(q)) {
        const bullets = [];
        bullets.push('• O que você recebe: conteúdo prático e aplicável (conforme página).');
        const priceLine = priceInfo?.promo
          ? `${priceInfo.full ? formatBRL(priceInfo.full) + ' → ' : ''}${formatBRL(priceInfo.promo)}`
          : 'Preço: informado na página.';
        bullets.push(`• Preço: ${priceLine}`);
        bullets.push('• Garantia/segurança: compra protegida pela plataforma.');
        bullets.push('• Próximo passo: eu te envio o link para garantir agora.');
        return {
          mode: 'sales_confused',
          answer: `Entendo! Aqui vai um resumo rápido:\n${bullets.join('\n')}\nQuer que eu te envie o link para garantir agora? ✅`
        };
      }

      if (/concorr(ê|e)ncia|concorrente|outro(s)? curso(s)?|alternativa(s)?/i.test(q)) {
        const lines = [];
        lines.push('Boa pergunta! O diferencial está em aplicar métodos práticos e diretos descritos na página.');
        lines.push('Foco em resultados reais e implementação rápida — não só teoria.');
        if (priceInfo?.promo) lines.push(`Investimento atual: ${priceInfo.full ? formatBRL(priceInfo.full) + ' → ' : ''}${formatBRL(priceInfo.promo)}.`);
        lines.push('Quer que eu te envie o link para garantir agora?');
        return { mode: 'sales_comp', answer: lines.join('\n') };
      }

      if (/pre[çc]o|quanto custa|valor/i.test(q)) {
        if (priceInfo?.promo) {
          const full = priceInfo.full ? formatBRL(priceInfo.full) : null;
          const promo = formatBRL(priceInfo.promo);
          const preface = full ? `O valor cheio era ${full},` : 'Temos valor promocional ativo,';
          return {
            mode: 'sales_price',
            answer: `${preface} hoje você garante por ${promo} ✅\nBenefício: acesso ao conteúdo que acelera seus resultados 🌟\nQuer que eu te envie o link para garantir agora? 🚀`
          };
        }
        return { mode: 'sales_price', answer: `Preço atual informado na página. Quer que eu te envie o link para garantir agora? ✅` };
      }
    }

    // Similaridade baseada em tokens
    const sentences = source.split(/(?<=[.!?])\s+/).map(s => s.trim()).filter(Boolean);
    const qTokens = tokenize(question || '');
    const instr = instrOpts;

    if (!qTokens.length) {
      const listItems = findListItemsFromText(source).slice(0, instr.maxBullets || 3).map(s => shortenSentence(s, 16));
      const opener = summary || clampSentences(description || cleanText, instr.maxSentences || 2);
      const bullets = listItems.length ? '\n' + listItems.map(s => `- ${s}`).join('\n') : '';
      if (shouldActivateSalesMode(instructions)) {
        const cta = '\nQuer que eu te mande o link para garantir agora?';
        return { mode: 'sales_overview', answer: `${clampSentences(opener, instr.maxSentences || 2)}${bullets}${cta}` };
      }
      return { mode: 'paragraph', answer: clampSentences(opener + bullets, instr.maxSentences || 2 + 1) };
    }

    const scored = [];
    sentences.forEach((s, idx) => {
      const toks = tokenize(s);
      if (!toks.length) return;
      const overlap = toks.filter(t => qTokens.includes(t)).length;
      const score = (overlap / Math.max(1, toks.length)) + Math.max(0, (4 - Math.min(4, idx))) * 0.05;
      if (score > 0) scored.push({ s, score, idx });
    });

    if (!scored.length) {
      const fallbackText = (summary || description || cleanText)
        .split(/(?<=[.!?])\s+/).filter(Boolean)
        .slice(0, Math.max(1, instr.maxSentences || 2))
        .join(' ');
      if (!fallbackText) {
        if (shouldActivateSalesMode(instructions)) {
          return { mode: 'sales_fallback', answer: 'Posso te encaminhar direto para a página de compra. Quer o link agora? ✅' };
        }
        return { mode: 'not_found', answer: NOT_FOUND_MSG };
      }
      const ans = shouldActivateSalesMode(instructions) ? `${fallbackText}\nQuer que eu te mande o link para garantir agora?` : fallbackText;
      return { mode: 'paragraph', answer: clampSentences(ans, instr.maxSentences || 2) };
    }

    scored.sort((a, b) => b.score - a.score);
    const topN = scored.slice(0, 6).map(x => x.s);
    const listCandidates = findListItemsFromText(source);
    const topBullets = [];
    for (const item of listCandidates) {
      if (topBullets.length >= (instr.maxBullets || 3)) break;
      for (const ts of topN) {
        const tTokens = tokenize(ts);
        const overlap = tokenize(item).filter(t => tTokens.includes(t)).length;
        if (overlap > 0) { topBullets.push(shortenSentence(item, 16)); break; }
      }
    }
    if (!topBullets.length) {
      for (const ts of topN.slice(0, instr.maxBullets || 3)) topBullets.push(shortenSentence(ts, 16));
    }

    const opener = summary || clampSentences(pageData.description || topN[0] || '', instr.maxSentences || 2);
    const bulletsText = topBullets.slice(0, instr.maxBullets || 3).map(b => `- ${b}`).join('\n');

    if (shouldActivateSalesMode(instructions)) {
      const priceInfo = detectPricesFromSource(source);
      const priceLine = priceInfo?.promo
        ? `\nPreço: ${priceInfo.full ? `${formatBRL(priceInfo.full)} → ` : ''}${formatBRL(priceInfo.promo)} ✅`
        : '';
      const answer = `${clampSentences(opener, instr.maxSentences || 2)}\n${bulletsText}${priceLine}\nQuer que eu te mande o link para garantir agora?`;
      return { mode: 'sales', answer };
    }

    let assembled;
    if (instr.bulletsOnly) assembled = bulletsText || clampSentences(opener, instr.maxSentences || 2);
    else if (instr.preferBullets) assembled = `${clampSentences(opener, instr.maxSentences || 2)}\n${bulletsText}`;
    else {
      const paragraph = clampSentences(opener, instr.maxSentences || 2);
      assembled = bulletsText ? `${paragraph}\n${bulletsText}` : paragraph;
    }
    const finalLines = assembled.split(/\r?\n/).slice(0, Math.max(1, instr.maxSentences || 2) + (instr.maxBullets || 3));
    return { mode: 'bullets', answer: finalLines.join('\n').trim() };

  } catch (err) {
    logger.warn('universalAnswer error', err);
    return { mode: 'error', answer: NOT_FOUND_MSG };
  }
}


// ===== Extraction with caching =====
const dataCache = new Map();
const CACHE_TTL = 60 * 60 * 1000; // 1h

async function extractPageData(url) {
  try {
    if (!url) throw new Error('url vazio');
    const cacheKey = url;
    const cached = dataCache.get(cacheKey);
    if (cached && (Date.now() - cached.timestamp) < CACHE_TTL) return cached.data;

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
      url
    };

    // first attempt: axios + cheerio
    let html = '';
    try {
      const res = await axios.get(url, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          'Accept-Language': 'pt-BR,pt;q=0.9,en;q=0.8'
        },
        timeout: 15000,
        maxRedirects: 5,
        validateStatus: status => status >= 200 && status < 400
      });
      html = res.data || '';
      const finalUrl = (res.request && res.request.res && res.request.res.responseUrl) || url;
      if (finalUrl && finalUrl !== url) extractedData.url = finalUrl;
    } catch (err) {
      logger.warn('axios fetch failed for ' + url + ' — will try puppeteer if available. Error: ' + (err && err.message ? err.message : err));
      html = '';
    }

    // If we got HTML, try to parse
    if (html && html.length > 50) {
      try {
        const $ = cheerio.load(html);
        $('script, style, noscript, iframe').remove();

        // Title candidates
        const titleCandidates = ['h1', 'meta[property="og:title"]', 'meta[name="twitter:title"]', 'title'];
        for (const sel of titleCandidates) {
          const el = $(sel).first();
          const t = (el && (el.attr('content') || el.text())) || '';
          if (t && t.trim().length > 5) { extractedData.title = t.trim(); break; }
        }

        // Description candidates
        const descCandidates = ['meta[name="description"]', 'meta[property="og:description"]', '.description', 'article p', 'main p'];
        for (const sel of descCandidates) {
          const el = $(sel).first();
          const t = (el && (el.attr('content') || el.text())) || '';
          if (t && t.trim().length > 40) { extractedData.description = t.trim().substring(0, 1000); break; }
        }

        // Clean text blocks
        const clean = extractCleanTextFromHTML(html);
        extractedData.cleanText = clean;

        // Price heuristic
        const bodyText = $('body').text() || '';
        const priceRegex = /(R\$\s*\d{1,3}(?:[.,]\d{3})*(?:[.,]\d{2})?|\$\s*\d+(?:[.,]\d+)?|USD\s*\d+)/gi;
        const priceMatches = bodyText.match(priceRegex);
        if (priceMatches && priceMatches.length) extractedData.price = priceMatches[0];

        // Summary
        const bt = bodyText.replace(/\s+/g, ' ').trim();
        const sents = bt.split(/[.!?]+/).map(s => s.trim()).filter(Boolean);
        extractedData.summary = sents.slice(0, 4).join('. ').substring(0, 600) + (sents.length ? '...' : '');

        // benefits
        const benefits = [];
        $('ul li, .benefits li, .features li, li').each((i, el) => {
          if (benefits.length >= 6) return;
          const txt = normalizeText($(el).text() || '');
          if (txt && txt.length > 20) benefits.push(txt);
        });
        if (benefits.length) extractedData.benefits = benefits;

        // testimonials
        const testimonials = [];
        $('.testimonial, .testimonials, .depoimentos, .review').each((i, el) => {
          if (testimonials.length >= 4) return;
          const txt = normalizeText($(el).text() || '');
          if (txt && txt.length > 30) testimonials.push(txt);
        });
        if (testimonials.length) extractedData.testimonials = testimonials;

        // CTA
        const ctaEl = $('a, button').filter((i, el) => {
          const txt = ($(el).text() || '').toLowerCase();
          return /comprar|quero|adquirir|saiba mais|inscreva-se|assine|compre|agora|garanta/.test(txt);
        }).first();
        if (ctaEl && ctaEl.length) extractedData.cta = normalizeText(ctaEl.text()).substring(0, 200);

      } catch (e) {
        logger.warn('cheerio parse failed', e && e.message ? e.message : e);
      }
    }

    // If cleanText is small, attempt Puppeteer (if available)
    const minimalAcceptableLength = 220;
    if ((!extractedData.cleanText || extractedData.cleanText.length < minimalAcceptableLength) && puppeteer) {
      logger.info(`cleanText small (${(extractedData.cleanText||'').length}) - launching Puppeteer for ${url}`);
      let browser = null;
      try {
        browser = await puppeteer.launch({
          headless: true,
          args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
          defaultViewport: { width: 1200, height: 800 }
        });
        const page = await browser.newPage();
        await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/114.0.0.0 Safari/537.36');
        await page.setRequestInterception(true);

        page.on('request', req => {
          const resourceType = req.resourceType();
          if (['stylesheet', 'font'].includes(resourceType)) req.abort();
          else req.continue();
        });

        await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 }).catch(e => {
          logger.warn('puppeteer goto domcontentloaded failed: ' + (e && e.message ? e.message : e));
        });

        // Scroll until the end (real scroll) to load dynamic content
        try {
          await page.evaluate(async () => {
            await new Promise((resolve) => {
              let totalHeight = 0;
              const distance = 400;
              const timer = setInterval(() => {
                window.scrollBy(0, distance);
                totalHeight += distance;
                if (totalHeight >= document.body.scrollHeight) {
                  clearInterval(timer);
                  resolve();
                }
              }, 300);
            });
          });
        } catch (e) {
          logger.warn('scroll evaluate failed: ' + (e && e.message ? e.message : e));
        }

        // small pause to allow lazy-loaded content
        try { await page.waitForTimeout(800); } catch (e) {}

        const bodyText = await page.evaluate(() => {
          const clone = document.cloneNode(true);
          const scripts = clone.querySelectorAll('script, style, noscript, iframe');
          scripts.forEach(n => n.remove());
          return clone.body ? clone.body.innerText : '';
        });

        const cleaned = normalizeText(String(bodyText || '')).replace(/\s{2,}/g, ' ');
        const lines = cleaned.split('\n').map(l => l.trim()).filter(Boolean);
        const unique = [...new Set(lines)];
        const finalText = unique.join('\n');

        if (finalText && finalText.length > (extractedData.cleanText || '').length) {
          extractedData.cleanText = finalText;
          const sents = finalText.split(/[.!?]+/).map(s => s.trim()).filter(Boolean);
          if (!extractedData.title && sents.length) extractedData.title = sents[0].slice(0, 200);
          if (!extractedData.summary && sents.length) extractedData.summary = sents.slice(0, 4).join('. ').substring(0, 600) + '...';
          const priceRegex = /(R\$\s*\d{1,3}(?:[.,]\d{3})*(?:[.,]\d{2})?|\$\s*\d+(?:[.,]\d+)?|USD\s*\d+)/gi;
          const pm = finalText.match(priceRegex);
          if (pm && pm.length && !extractedData.price) extractedData.price = pm[0];
          const ctaMatch = unique.find(l => /comprar|quero|adquirir|saiba mais|inscreva-se|assine|compre|agora|garanta/i.test(l));
          if (ctaMatch && !extractedData.cta) extractedData.cta = shortenSentence(ctaMatch, 20);
          const candidateBenefits = unique.filter(l => l.length > 30 && l.split(' ').length < 30 && /benef|resultado|transforma|aprende|bônus|bonus|template|checklist|planilha|garantia/i.test(l));
          if (candidateBenefits.length) extractedData.benefits = candidateBenefits.slice(0, 6);
        }

        // OCR on images via Puppeteer: collect up to 10 images and run OCR if Tesseract available
        if (Tesseract) {
          try {
            const imgs = await page.$$eval('img[src]', els =>
              els.map(img => img.src).filter(src => src && !src.startsWith('data:')).slice(0, 20)
            );
            if (imgs && imgs.length) {
              const ocrTexts = await extractTextFromImages(imgs);
              if (ocrTexts && ocrTexts.length) {
                extractedData.imagesText = ocrTexts;
                extractedData.cleanText += '\n' + ocrTexts.join('\n');
                logger.info('🔍 OCR via Puppeteer extraído: ' + ocrTexts.slice(0,3).map(t=>t.slice(0,100)).join(' | '));
              }
            }
          } catch (imgErr) {
            logger.warn('Image OCR via puppeteer failed: ' + (imgErr && imgErr.message ? imgErr.message : imgErr));
          }
        }

      } catch (puErr) {
        logger.warn('Puppeteer extraction failed: ' + (puErr && puErr.message ? puErr.message : puErr));
      } finally {
        try { if (browser) await browser.close(); } catch (e) {}
      }
    } else if ((!extractedData.cleanText || extractedData.cleanText.length < minimalAcceptableLength) && !puppeteer) {
      logger.warn('Puppeteer not available and cleanText small — extraction may be incomplete for dynamic pages.');
    }

    // If we still have images but didn't run OCR via puppeteer, attempt a lightweight cheerio-based image OCR (if Tesseract available)
    if (Tesseract && extractedData.imagesText.length === 0 && html && html.length) {
      try {
        const $ = cheerio.load(html);
        const imgs = $('img[src]').map((i, el) => $(el).attr('src')).get()
          .filter(src => src && !src.startsWith('data:'))
          .slice(0, 20);
        if (imgs.length) {
          const ocrTexts = await extractTextFromImages(imgs);
          if (ocrTexts && ocrTexts.length) {
            extractedData.imagesText = ocrTexts;
            extractedData.cleanText += '\n' + ocrTexts.join('\n');
            logger.info('🔍 OCR via Cheerio extraído: ' + ocrTexts.slice(0,3).map(t=>t.slice(0,100)).join(' | '));
          }
        }
      } catch (imgErr) {
        logger.warn('Image OCR via cheerio failed: ' + (imgErr && imgErr.message ? imgErr.message : imgErr));
      }
    }

    // Final normalization
    try {
      if (extractedData.cleanText) {
        extractedData.cleanText = uniqueLines(extractedData.cleanText);
      } else {
        extractedData.cleanText = '';
      }
      if (!extractedData.title && extractedData.cleanText) {
        const firstLine = extractedData.cleanText.split('\n').find(l => l && l.length > 5);
        if (firstLine) extractedData.title = firstLine.slice(0, 200);
      }
      if (!extractedData.summary && extractedData.cleanText) {
        const sents = extractedData.cleanText.split(/(?<=[.!?])\s+/).filter(Boolean);
        extractedData.summary = sents.slice(0, 4).join('. ').slice(0, 600) + (sents.length ? '...' : '');
      }
    } catch (e) {
      logger.warn('final normalization failed', e && e.message ? e.message : e);
    }

    dataCache.set(cacheKey, { data: extractedData, timestamp: Date.now() });
    return extractedData;

  } catch (err) {
    logger.warn('extractPageData failed', err && err.message ? err.message : err);
    return { title: '', description: '', price: '', benefits: [], testimonials: [], cta: '', summary: '', cleanText: '', imagesText: [], url };
  }
}


// ===== LLM calls (GROQ -> OpenAI -> OpenRouter) =====
async function callGroq(messages, temperature = 0.4, max_tokens = 400, presence_penalty = 0.0, frequency_penalty = 0.0) {
  if (!process.env.GROQ_API_KEY) throw new Error('GROQ_API_KEY ausente');
  const payload = { model: process.env.GROQ_MODEL || 'llama-3.1-70b-versatile', messages, temperature, max_tokens, presence_penalty, frequency_penalty };
  const url = process.env.GROQ_API_BASE || 'https://api.groq.com/openai/v1/chat/completions';
  const headers = { Authorization: `Bearer ${process.env.GROQ_API_KEY}`, 'Content-Type': 'application/json' };
  const resp = await axios.post(url, payload, { headers, timeout: 20000 });
  if (!(resp && resp.status >= 200 && resp.status < 300)) throw new Error('GROQ falhou ' + (resp && resp.status));
  if (resp.data?.choices?.[0]?.message?.content) return resp.data.choices[0].message.content;
  if (resp.data?.choices?.[0]?.text) return resp.data.choices[0].text;
  if (typeof resp.data === 'string') return resp.data;
  return '';
}

async function callOpenAI(messages, temperature = 0.2, max_tokens = 400, presence_penalty = 0.0, frequency_penalty = 0.0) {
  if (!process.env.OPENAI_API_KEY) throw new Error('OPENAI_API_KEY ausente');
  const model = process.env.OPENAI_MODEL || process.env.PRIMARY_LLM_MODEL || 'gpt-4o-mini';
  const url = process.env.OPENAI_API_BASE || 'https://api.openai.com/v1/chat/completions';
  const payload = { model, messages, temperature, max_tokens, presence_penalty, frequency_penalty };
  const headers = { Authorization: `Bearer ${process.env.OPENAI_API_KEY}`, 'Content-Type': 'application/json' };
  const resp = await axios.post(url, payload, { headers, timeout: 20000 });
  if (!(resp && resp.status >= 200 && resp.status < 300)) throw new Error('OpenAI falhou ' + (resp && resp.status));
  if (resp.data?.choices?.[0]?.message?.content) return resp.data.choices[0].message.content;
  if (resp.data?.choices?.[0]?.text) return resp.data.choices[0].text;
  return '';
}

async function callOpenRouter(messages, temperature = 0.0, max_tokens = 400) {
  if (!process.env.OPENROUTER_API_KEY) throw new Error('OPENROUTER_API_KEY ausente');
  const url = process.env.OPENROUTER_API_BASE || 'https://openrouter.ai/api/v1/chat/completions';
  const payload = { model: process.env.OPENROUTER_MODEL || 'mistralai/mistral-large-latest', messages, temperature, max_tokens };
  const headers = { Authorization: `Bearer ${process.env.OPENROUTER_API_KEY}`, 'Content-Type': 'application/json' };
  const resp = await axios.post(url, payload, { headers, timeout: 20000 });
  if (!(resp && resp.status >= 200 && resp.status < 300)) throw new Error('OpenRouter falhou ' + (resp && resp.status));
  if (resp.data?.choices?.[0]?.message?.content) return resp.data.choices[0].message.content;
  if (resp.data?.choices?.[0]?.text) return resp.data.choices[0].text;
  return '';
}

// ===== Orchestration: generateAIResponse =====
async function generateAIResponse(userMessage, pageData = {}, conversation = [], instructions = '') {
  try {
    const salesMode = shouldActivateSalesMode(instructions);
    const instrOpts = parseInstructions(instructions);

    // Direct link override
    if (userAskedForLink(userMessage) && pageData && pageData.url) {
      const theUrl = pageData.url;
      if (salesMode) {
        return `🌟 Aqui está o link oficial: ${theUrl}\nQuer que eu te envie o passo a passo para garantir agora? 🚀`;
      }
      return `Aqui está o link oficial: ${theUrl}`;
    }

    const systemLines = [
      "Você é um assistente inteligente. Responda de forma curta, clara e útil.",
      "Nunca invente dados. Use apenas informações da página extraída ou instruções."
    ];
    if (salesMode) {
      systemLines.push("Tom de voz: amigável, consultivo e entusiasmado. Finalize com CTA para compra quando relevante.");
    } else {
      systemLines.push("Tom: conciso e objetivo; respostas curtas.");
    }
    const systemPrompt = systemLines.join('\n');

    const pageSummary = `Resumo da página:\nTítulo: ${pageData.title || ''}\nDescrição: ${pageData.description || ''}\nPreço: ${pageData.price || ''}\nBenefícios: ${Array.isArray(pageData.benefits) ? pageData.benefits.join(', ') : pageData.benefits || ''}\nCTA: ${pageData.cta || ''}\nEvidências (trechos):\n${(pageData.summary || pageData.cleanText || '').slice(0, 2000)}`;

    const userPrompt = `${instructions ? 'Instruções do painel: ' + instructions + '\n\n' : ''}${pageSummary}\n\nPergunta do usuário:\n${userMessage}\n\nResponda de forma concisa conforme as regras acima.`;

    const messages = [
      { role: 'system', content: systemPrompt },
      ...((conversation || []).slice(-6).map(m => ({ role: m.role === 'user' ? 'user' : 'assistant', content: m.message }))),
      { role: 'user', content: userPrompt }
    ];

    // Try GROQ
    if (process.env.GROQ_API_KEY) {
      try {
        const groqResp = await callGroq(messages, parseFloat(process.env.GROQ_TEMP || '0.4'), parseInt(process.env.GROQ_MAX_TOKENS || '400', 10), parseFloat(process.env.GROQ_PRESENCE_PENALTY || '0.0'), parseFloat(process.env.GROQ_FREQ_PENALTY || '0.0'));
        if (groqResp && groqResp.trim()) return clampSentences(groqResp.trim(), Math.max(1, instrOpts.maxSentences || 2));
      } catch (err) {
        logger.warn('GROQ failed, will try OpenAI. Error: ' + (err && err.message ? err.message : err));
      }
    }

    // Try OpenAI
    if (process.env.OPENAI_API_KEY) {
      try {
        const openaiResp = await callOpenAI(messages, parseFloat(process.env.OPENAI_TEMP || '0.2'), parseInt(process.env.OPENAI_MAX_TOKENS || '400', 10), parseFloat(process.env.OPENAI_PRESENCE_PENALTY || '0.0'), parseFloat(process.env.OPENAI_FREQ_PENALTY || '0.0'));
        if (openaiResp && openaiResp.trim()) return clampSentences(openaiResp.trim(), Math.max(1, instrOpts.maxSentences || 2));
      } catch (err) {
        logger.warn('OpenAI failed, will try OpenRouter if available. Error: ' + (err && err.message ? err.message : err));
      }
    }

    // Try OpenRouter
    if (process.env.OPENROUTER_API_KEY) {
      try {
        const orResp = await callOpenRouter(messages, parseFloat(process.env.OPENROUTER_TEMP || '0.0'), parseInt(process.env.OPENROUTER_MAX_TOKENS || '400', 10));
        if (orResp && orResp.trim()) return clampSentences(orResp.trim(), Math.max(1, instrOpts.maxSentences || 2));
      } catch (err) {
        logger.warn('OpenRouter failed. Error: ' + (err && err.message ? err.message : err));
      }
    }

    // Local fallback
    const ua = universalAnswer(pageData, userMessage, instructions);
    if (ua && ua.answer) return ua.answer;
    return NOT_FOUND_MSG;

  } catch (err) {
    logger.error('generateAIResponse erro: ' + (err && err.message ? err.message : err));
    return NOT_FOUND_MSG;
  }
}

// ===== Routes: chat-universal, chatbot UI, root =====

// /chat-universal - main chat endpoint used by embedded UI
app.post('/chat-universal', async (req, res) => {
  try {
    const { message, pageData, url, conversationId, instructions = '', robotName } = req.body || {};
    if (!message) return res.status(400).json({ success: false, error: 'message é obrigatório' });

    let pd = pageData;
    if (!pd) {
      if (!url) return res.status(400).json({ success: false, error: 'pageData ou url requerido' });
      pd = await extractPageData(url);
    }

    // enrich metadata using helpers (safe - small processing)
    try {
      const combined = (pd.cleanText || '') + '\n' + ((pd.imagesText || []).join('\n') || '');
      pd.bonuses_detected = extractBonuses(combined);
      pd.price_detected = extractPrices(combined);
      pd.price_info = detectPricesFromSource(combined) || null;
      pd.guarantee_detected = extractGuarantees(combined);
      pd.cta_detected = extractCTAs(combined);
      pd.bullets = extractBullets(combined);
      pd.testimonials = extractTestimonials(((pd.imagesText || []).join('\n')) + '\n' + (pd.cleanText || ''));
    } catch (e) {
      logger.warn('metadata detection failed', e && e.message ? e.message : String(e));
    }

    // Log structured context (truncated for safety)
    try {
      const contextLog = {
        title: pd.title || null,
        description: pd.description || null,
        prices: pd.price_detected || [],
        price_info: pd.price_info || null,
        guarantees: pd.guarantee_detected || [],
        ctas: pd.cta_detected || [],
        bonuses: pd.bonuses_detected || [],
        bullets: pd.bullets || [],
        testimonials_count: (pd.testimonials || []).length || 0,
        cleanText_snippet: (pd.cleanText || '').slice(0, 1000)
      };
      logger.info({ message: 'Contexto rico montado para chat-universal', context: contextLog });
    } catch (e) {}

    const conversation = []; // ephemeral by default
    const reply = await generateAIResponse(message, pd, conversation, instructions);

    // Force inclusion of page link at the end if not already present
    let finalReply = reply;
    try {
      if (pd && pd.url && !String(finalReply).includes(pd.url)) {
        finalReply = `${finalReply}\n\n${pd.url}`;
      }
    } catch (e) {
      logger.warn('Erro ao forçar inclusão do link no final da resposta', e && e.message ? e.message : e);
    }

    return res.json({ success: true, response: finalReply, bonuses_detected: pd.bonuses_detected || [] });
  } catch (err) {
    logger.error('chat-universal error', err && err.message ? err.message : err);
    return res.status(500).json({ success: false, error: 'erro interno ao gerar resposta' });
  }
});

// Minimal embedded UI route /chatbot
app.get('/chatbot', async (req, res) => {
  try {
    const robotName = req.query.name || '@Assistente';
    const url = req.query.url || '';
    const instructions = req.query.instructions || '';
    let pageData = {};
    if (url) pageData = await extractPageData(url);
    const html = generateChatbotHTML(pageData, robotName, instructions);
    res.set('Content-Type', 'text/html; charset=utf-8').send(html);
  } catch (err) {
    logger.error('chatbot html error', err && err.message ? err.message : err);
    res.status(500).send('<h3>Erro ao gerar UI</h3>');
  }
});

// Root serves public/index.html if present
app.get('/', (req, res) => {
  const indexPath = path.join(__dirname, 'public', 'index.html');
  if (fs.existsSync(indexPath)) return res.sendFile(indexPath);
  return res.send('<h2>🚀 LinkMágico Chatbot ativo</h2><p>Coloque seus arquivos estáticos na pasta /public para ativar o painel.</p>');
});


// ===== Health check =====
app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    uptime: process.uptime(),
    timestamp: new Date().toISOString()
  });
});

// ===== Extraction endpoint =====
app.post('/extract', async (req, res) => {
  try {
    const { url } = req.body || {};
    if (!url) return res.status(400).json({ success: false, error: 'url é obrigatório' });
    const data = await extractPageData(url);
    return res.json({ success: true, data });
  } catch (err) {
    logger.error('extract endpoint error', err?.message || err);
    return res.status(500).json({ success: false, error: 'erro interno ao extrair página' });
  }
});

// ===== Start Server =====
const PORT = parseInt(process.env.PORT || process.env.PORT_INTERNAL || '3000', 10);
app.listen(PORT, () => logger.info({ message: `Server rodando na porta ${PORT}`, level: 'info', timestamp: new Date().toISOString() }));

// ===== Helper: minimal UI generator (HTML) =====
function generateChatbotHTML(pageData = {}, robotName = '@Assistente', customInstructions = '') {
  const escapedPageData = JSON.stringify(pageData || {});
  const safeRobotName = String(robotName || '@assistente').replace(/"/g, '\\"');
  return `<!doctype html>
<html lang="pt-BR">
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>LinkMágico Chatbot - ${safeRobotName}</title>
<style>
*{box-sizing:border-box}body{font-family:system-ui,Segoe UI,Arial;background:linear-gradient(135deg,#667eea 0%,#764ba2 100%);min-height:100vh;display:flex;align-items:center;justify-content:center;padding:20px}
.chat-container{background:#fff;border-radius:12px;width:100%;max-width:760px;height:640px;display:flex;flex-direction:column;overflow:hidden;box-shadow:0 20px 40px rgba(0,0,0,.12)}
.chat-header{background:linear-gradient(135deg,#667eea 0%,#764ba2 100%);color:#fff;padding:18px;text-align:center}
.chat-header h1{margin:0;font-size:1.25rem}
.chat-messages{flex:1;padding:18px;overflow:auto;background:#f7f9fb}
.message{margin-bottom:12px;display:flex}
.message.bot .message-content{background:#fff;border:1px solid #e9ecef;color:#222;padding:12px 14px;border-radius:14px;max-width:82%}
.message.user{justify-content:flex-end}
.message.user .message-content{background:#667eea;color:#fff;padding:12px 14px;border-radius:14px;max-width:82%}
.chat-input{padding:14px;background:#fff;border-top:1px solid #eee}
.input-group{display:flex;gap:10px}
input[type="text"]{flex:1;padding:12px 14px;border-radius:28px;border:1px solid #e9ecef;outline:none}
button{background:#667eea;color:#fff;border:none;padding:10px 18px;border-radius:28px;cursor:pointer}
textarea{width:100%;min-height:56px;border-radius:10px;padding:8px;border:1px solid #e9ecef;margin-top:8px}
.cta-button{display:inline-block;background:#6c5ce7;color:#fff;padding:8px 14px;border-radius:8px;font-weight:700;text-decoration:none;box-shadow:0 6px 18px rgba(0,0,0,0.12)}
</style>
</head>
<body>
  <div class="chat-container">
    <div class="chat-header">
      <h1>🤖 ${safeRobotName}</h1>
      <p style="margin:6px 0 0;font-size:0.9rem;opacity:.95">Respondo com base no conteúdo desta página (respostas curtas e objetivas)</p>
    </div>

    <div style="padding:12px;background:#fff;border-bottom:1px solid #eee">
      <label for="instructionsInput">💡 Instruções Personalizadas (opcional):</label>
      <textarea id="instructionsInput" placeholder="Ex.: Responda em até 3 frases; preferir bullets; não use emojis">${customInstructions}</textarea>
    </div>

    <div class="chat-messages" id="chatMessages">
      <div class="message bot"><div class="message-content">Olá! 👋 Sou ${safeRobotName}. Respondo com base no conteúdo desta página. Como posso ajudar hoje?</div></div>
    </div>

    <div class="chat-input">
      <div class="input-group">
        <input id="messageInput" type="text" placeholder="Digite sua pergunta..." maxlength="800"/>
        <button id="sendBtn">Enviar</button>
      </div>
    </div>
  </div>

<script>
  const pageData = ${escapedPageData};
  const robotName = "${safeRobotName}";
  const conversationId = 'chat_' + Date.now();

  function normalizeUrlForCompare(u) {
    try {
      if (!u) return '';
      return String(u).trim().replace(/\/+$/, '').toLowerCase();
    } catch (e) {
      return String(u || '').replace(/\/+$/, '').toLowerCase();
    }
  }

  function addMessage(content, isUser = false){
    const messagesContainer = document.getElementById('chatMessages');
    const messageDiv = document.createElement('div');
    messageDiv.className = 'message ' + (isUser ? 'user' : 'bot');
    const contentDiv = document.createElement('div');
    contentDiv.className = 'message-content';

    // convert plain URLs into safe clickable anchors (no innerHTML used)
    const urlRegex = /https?:\/\/[^\s]+/g;
    let lastIndex = 0;
    let match;
    while ((match = urlRegex.exec(content)) !== null) {
      const textPart = content.slice(lastIndex, match.index);
      if (textPart) contentDiv.appendChild(document.createTextNode(textPart));
      const url = match[0];
      try {
        if (typeof pageData !== 'undefined' && pageData && pageData.url && normalizeUrlForCompare(url).includes(normalizeUrlForCompare(pageData.url))) {
          const a = document.createElement('a');
          a.href = url;
          a.target = '_blank';
          a.rel = 'noopener noreferrer';
          a.textContent = 'Quero me inscrever agora 🚀';
          a.className = 'cta-button';
          a.setAttribute('aria-label', 'Quero me inscrever agora - abre em nova aba');
          contentDiv.appendChild(a);
        } else {
          const a = document.createElement('a');
          a.href = url;
          a.target = '_blank';
          a.rel = 'noopener noreferrer';
          a.textContent = url;
          contentDiv.appendChild(a);
        }
      } catch (e) {
        const fallback = document.createElement('a');
        fallback.href = url;
        fallback.target = '_blank';
        fallback.rel = 'noopener noreferrer';
        fallback.textContent = url;
        contentDiv.appendChild(fallback);
      }
      lastIndex = urlRegex.lastIndex;
    }

    const remaining = content.slice(lastIndex);
    if (remaining) contentDiv.appendChild(document.createTextNode(remaining));
    messageDiv.appendChild(contentDiv);
    messagesContainer.appendChild(messageDiv);
    messagesContainer.scrollTop = messagesContainer.scrollHeight;
  }

  async function sendMessage(){
    const input = document.getElementById('messageInput');
    const instructions = document.getElementById('instructionsInput').value || '';
    const message = input.value.trim();
    if(!message) return;
    addMessage(message, true);
    input.value = '';
    try {
      const res = await fetch('/chat-universal', {
        method: 'POST',
        headers: {'Content-Type':'application/json'},
        body: JSON.stringify({ message, pageData, robotName, conversationId, instructions })
      });
      const data = await res.json();
      if(data && data.success) addMessage(data.response || 'Sem resposta.');
      else addMessage('Desculpe, ocorreu um erro. Tente novamente.');
    } catch(err){
      addMessage('Erro de conexão. Tente novamente.');
    }
  }

  document.getElementById('sendBtn').addEventListener('click', sendMessage);
  document.getElementById('messageInput').addEventListener('keypress', function(e){ if(e.key === 'Enter') sendMessage(); });
</script>
</body>
</html>`;
}
