// LinkMágico Chatbot - Consolidated server (v6.0 + v7.0 compat)
// Cleaned and prepared for Render deployment.
// Environment: create a .env with OPENAI_API_KEY, GROQ_API_KEY, etc. as needed.

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
const rateLimit = require('express-rate-limit');

// Optional dependencies - graceful fallback
let puppeteer = null;
try { puppeteer = require('puppeteer'); console.log('✅ Puppeteer available'); } catch (e) { /* optional */ }
let Tesseract = null;
try { Tesseract = require('tesseract.js'); console.log('✅ Tesseract available'); } catch (e) { /* optional */ }

const app = express();

// Logger
const logger = winston.createLogger({
  level: process.env.LOG_LEVEL || 'info',
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.errors({ stack: true }),
    winston.format.json()
  ),
  transports: [ new winston.transports.Console({ format: winston.format.combine(winston.format.colorize(), winston.format.simple()) }) ]
});

// Rate limiters
const dashboardDemoLimit = rateLimit({ windowMs: 10*60*1000, max: 50, message: { error: 'Rate limit dashboard demo excedido' } });
const widgetEmbedLimit = rateLimit({ windowMs: 5*60*1000, max: 200, message: { error: 'Rate limit widget embed excedido' } });
const publicApiLimit = rateLimit({ windowMs: 15*60*1000, max: 100, message: { error: 'Rate limit API pública excedido' } });

// Helmet with permissive-ish CSP to allow inline JS used by demo/widget UIs
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", "'unsafe-inline'", "'unsafe-eval'", "https://cdnjs.cloudflare.com", "https://fonts.googleapis.com"],
      styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com", "https://cdnjs.cloudflare.com"],
      fontSrc: ["'self'", "https://fonts.gstatic.com"],
      imgSrc: ["'self'", "data:", "https:", "blob:"],
      connectSrc: ["'self'", "https://api.groq.com", "https://api.openai.com", "https://openrouter.ai", "https://api.openrouter.ai"]
    }
  },
  crossOriginEmbedderPolicy: false
}));

app.use(cors({ origin: process.env.ALLOWED_ORIGINS ? process.env.ALLOWED_ORIGINS.split(',') : '*', credentials: true, maxAge: 86400 }));
app.use(express.json({ limit: '5mb' }));
app.use(express.urlencoded({ extended: true, limit: '5mb' }));
app.use(bodyParser.json({ limit: '5mb' }));
app.use(morgan('combined'));

// Serve public
const publicDir = path.join(__dirname, 'public');
if (fs.existsSync(publicDir)) app.use(express.static(publicDir, { maxAge: '1d', etag: true, lastModified: true }));

// Analytics & cache
const analytics = { totalRequests:0, chatRequests:0, extractRequests:0, errors:0, activeChats:new Set(), startTime:Date.now(), responseTimeHistory:[], successfulExtractions:0, failedExtractions:0 };
app.use((req,res,next)=>{ const start=Date.now(); analytics.totalRequests++; res.on('finish',()=>{ const time=Date.now()-start; analytics.responseTimeHistory.push(time); if(analytics.responseTimeHistory.length>100) analytics.responseTimeHistory.shift(); if(res.statusCode>=400) analytics.errors++; }); next(); });

const dataCache = new Map();
const CACHE_TTL = 30 * 60 * 1000;
function setCacheData(k,d){ dataCache.set(k,{data:d,timestamp:Date.now()}); }
function getCacheData(k){ const c=dataCache.get(k); if(c && (Date.now()-c.timestamp)<CACHE_TTL) return c.data; dataCache.delete(k); return null; }

// Utilities
function normalizeText(text){ return (text||'').replace(/\s+/g,' ').trim(); }
function uniqueLines(text){ if(!text) return ''; const seen=new Set(); return text.split('\n').map(l=>l.trim()).filter(Boolean).filter(l=>{ if(seen.has(l)) return false; seen.add(l); return true; }).join('\n'); }
function clampSentences(text,maxSentences=2){ if(!text) return ''; const s=normalizeText(text).split(/(?<=[.!?])\s+/); return s.slice(0,maxSentences).join(' '); }
function extractPrices(text){ if(!text) return []; const regex=/(R\\$\\s?\\d{1,3}(?:\\.\\d{3})*,\\d{2}|USD\\s*\\d+(?:[.,]\\d+)?|\\$\\s*\\d+(?:[.,]\\d+)?)/gi; const m=[]; let r; while((r=regex.exec(text))!==null){ m.push(r[0]); if(m.length>=10) break; } return Array.from(new Set(m)); }
function extractBonuses(text){ if(!text) return []; const bonusKeywords=/(bônus|bonus|brinde|extra|grátis|template|planilha|checklist|e-book|ebook)/gi; const lines=String(text).split(/\\r?\\n/).map(l=>l.trim()).filter(Boolean); const bonuses=[]; for(const line of lines){ if(bonusKeywords.test(line) && line.length>10 && line.length<200){ bonuses.push(line); if(bonuses.length>=5) break; } } return Array.from(new Set(bonuses)); }

// Content extraction helpers
function extractCleanTextFromHTML(html){
  try{
    const $ = cheerio.load(html||'');
    $('script, style, noscript, iframe, nav, footer, aside').remove();
    const textBlocks=[];
    const selectors=['h1','h2','h3','p','li','span','div'];
    for(const sel of selectors){ $(sel).each((i,el)=>{ const t=normalizeText($(el).text()||''); if(t && t.length>15 && t.length<1000) textBlocks.push(t); }); }
    const metaDesc = $('meta[name="description"]').attr('content') || $('meta[property="og:description"]').attr('content') || '';
    if(metaDesc && metaDesc.trim().length>20) textBlocks.unshift(normalizeText(metaDesc.trim()));
    return [...new Set(textBlocks.map(b=>b.trim()).filter(Boolean))].join('\\n');
  }catch(err){ logger.warn('extractCleanTextFromHTML error', err.message || err); return ''; }
}

// Page extraction (Axios + Cheerio) - basic but effective
async function extractPageData(url){
  const start = Date.now();
  try{
    if(!url) throw new Error('URL is required');
    const cacheKey = url;
    const cached = getCacheData(cacheKey);
    if(cached){ logger.info('Cache hit for '+url); return cached; }
    logger.info('Starting extraction for: '+url);
    const extracted = { title:'', description:'', price:'', benefits:[], testimonials:[], cta:'', summary:'', cleanText:'', imagesText:[], url, extractionTime:0, method:'unknown', bonuses_detected:[], price_detected:[] };
    let html='';
    try{
      const response = await axios.get(url, { headers: { 'User-Agent':'Mozilla/5.0', 'Accept-Language':'pt-BR,pt;q=0.9,en;q=0.8' }, timeout:10000, maxRedirects:3, validateStatus: s => s>=200 && s<400 });
      html = response.data || '';
      const finalUrl = response.request?.res?.responseUrl || url;
      if(finalUrl && finalUrl!==url) extracted.url = finalUrl;
      extracted.method = 'axios-cheerio';
      logger.info('Axios extraction success length='+String(html.length));
    }catch(e){ logger.warn('Axios extraction failed: ' + (e.message||e)); }

    if(html && html.length>100){
      try{
        const $ = cheerio.load(html);
        $('script, style, noscript, iframe').remove();
        // title
        const titleSelectors=['h1','meta[property="og:title"]','meta[name="twitter:title"]','title'];
        for(const sel of titleSelectors){
          const el = $(sel).first();
          const title = (el.attr && (el.attr('content')||el.text) ? (el.attr('content') || el.text()) : el.text ? el.text() : '').toString().trim();
          if(title && title.length>5 && title.length<200){ extracted.title = title; break; }
        }
        // description
        const descSelectors=['meta[name="description"]','meta[property="og:description"]','.description','article p','main p'];
        for(const sel of descSelectors){
          const el = $(sel).first();
          const desc = (el.attr && (el.attr('content')||el.text) ? (el.attr('content') || el.text()) : el.text ? el.text() : '').toString().trim();
          if(desc && desc.length>50 && desc.length<1000){ extracted.description = desc; break; }
        }
        extracted.cleanText = extractCleanTextFromHTML(html);
        const bodyText = $('body').text() || '';
        const priceMatches = bodyText.match(/(R\\$\\s*\\d{1,3}(?:[.,]\\d{3})*(?:[.,]\\d{2})?|\\$\\s*\\d+(?:[.,]\\d+)?|USD\\s*\\d+)/gi);
        if(priceMatches && priceMatches.length){ extracted.price = priceMatches[0]; extracted.price_detected = priceMatches.slice(0,5); }
        const summaryText = bodyText.replace(/\\s+/g,' ').trim();
        const sentences = summaryText.split(/[.!?]+/).map(s=>s.trim()).filter(Boolean);
        extracted.summary = sentences.slice(0,3).join('. ').substring(0,400) + (sentences.length>3? '...' : '');
        extracted.bonuses_detected = extractBonuses(bodyText);
        extracted.price_detected = extractPrices(bodyText);
        analytics.successfulExtractions++;
        logger.info('Cheerio extraction completed for '+url);
      }catch(e){ logger.warn('Cheerio parsing failed: '+(e.message||e)); analytics.failedExtractions++; }
    }

    try{
      if(extracted.cleanText) extracted.cleanText = uniqueLines(extracted.cleanText);
      if(!extracted.title && extracted.cleanText){
        const firstLine = extracted.cleanText.split('\\n').find(l=>l && l.length>10 && l.length<150);
        if(firstLine) extracted.title = firstLine.slice(0,150);
      }
      if(!extracted.summary && extracted.cleanText){
        const sents = extracted.cleanText.split(/(?<=[.!?])\\s+/).filter(Boolean);
        extracted.summary = sents.slice(0,3).join('. ').slice(0,400) + (sents.length>3 ? '...' : '');
      }
    }catch(e){ logger.warn('Final processing failed: '+(e.message||e)); }

    extracted.extractionTime = Date.now() - start;
    setCacheData(cacheKey, extracted);
    logger.info(`Extraction completed for ${url} in ${extracted.extractionTime}ms using ${extracted.method}`);
    return extracted;
  }catch(err){ analytics.failedExtractions++; logger.error('Page extraction failed: '+(err.message||err)); return { title:'', description:'', price:'', benefits:[], testimonials:[], cta:'', summary:'', cleanText:'', imagesText:[], url: url||'', extractionTime: Date.now()-start, method:'failed', error: err.message || String(err), bonuses_detected: [], price_detected: [] }; }
}

// LLM Integration helpers
async function callGroq(messages, temperature=0.4, maxTokens=300){
  if(!process.env.GROQ_API_KEY) throw new Error('GROQ_API_KEY missing');
  const payload = { model: process.env.GROQ_MODEL || 'llama-3.1-70b-versatile', messages, temperature, max_tokens: maxTokens };
  const url = process.env.GROQ_API_BASE || 'https://api.groq.com/openai/v1/chat/completions';
  const headers = { 'Authorization': `Bearer ${process.env.GROQ_API_KEY}`, 'Content-Type': 'application/json' };
  const resp = await axios.post(url, payload, { headers, timeout:15000 });
  if(!(resp && resp.status>=200 && resp.status<300)) throw new Error('GROQ API failed status='+resp?.status);
  if(resp.data?.choices?.[0]?.message?.content) return resp.data.choices[0].message.content;
  throw new Error('Invalid GROQ response');
}

async function callOpenAI(messages, temperature=0.2, maxTokens=300){
  if(!process.env.OPENAI_API_KEY) throw new Error('OPENAI_API_KEY missing');
  const model = process.env.OPENAI_MODEL || 'gpt-4o-mini';
  const url = process.env.OPENAI_API_BASE || 'https://api.openai.com/v1/chat/completions';
  const payload = { model, messages, temperature, max_tokens: maxTokens };
  const headers = { 'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`, 'Content-Type': 'application/json' };
  const resp = await axios.post(url, payload, { headers, timeout:15000 });
  if(!(resp && resp.status>=200 && resp.status<300)) throw new Error('OpenAI API failed status='+resp?.status);
  if(resp.data?.choices?.[0]?.message?.content) return resp.data.choices[0].message.content;
  throw new Error('Invalid OpenAI response');
}

// Local response generator and orchestration
const NOT_FOUND_MSG = "Não encontrei essa informação específica na página. Posso te ajudar com outras dúvidas ou enviar o link direto?";

function shouldActivateSalesMode(instructions=''){ if(!instructions) return false; const text=String(instructions).toLowerCase(); return /sales_mode:on|consultivo|vendas|venda|cta|sempre.*link|finalize.*cta/i.test(text); }

function generateLocalResponse(userMessage, pageData={}, instructions=''){
  const q = String(userMessage||'').toLowerCase();
  const salesMode = shouldActivateSalesMode(instructions);
  if(/preço|valor|quanto custa/.test(q)){
    if(pageData.price) return salesMode ? `O preço é ${pageData.price}. Quer garantir sua vaga agora?` : `Preço: ${pageData.price}`;
    return 'Preço não informado na página.';
  }
  if(/como funciona|funcionamento/.test(q)){
    const summary = pageData.summary || pageData.description;
    if(summary){ const shortSummary = clampSentences(summary,2); return salesMode ? `${shortSummary} Quer saber mais detalhes?` : shortSummary; }
  }
  if(/bônus|bonus/.test(q)){
    if(pageData.bonuses_detected && pageData.bonuses_detected.length>0){ const bonuses = pageData.bonuses_detected.slice(0,2).join(', '); return salesMode ? `Inclui: ${bonuses}. Quer garantir todos os bônus?` : `Bônus: ${bonuses}`; }
    return 'Informações sobre bônus não encontradas.';
  }
  if(pageData.summary) { const summary = clampSentences(pageData.summary,2); return salesMode ? `${summary} Posso te ajudar com mais alguma dúvida?` : summary; }
  return NOT_FOUND_MSG;
}

async function generateAIResponse(userMessage, pageData={}, conversation=[], instructions=''){
  const start = Date.now();
  try{
    if(/\b(link|página|site|comprar|inscrever)\b/i.test(userMessage) && pageData && pageData.url){
      const url = pageData.url;
      const salesMode = shouldActivateSalesMode(instructions);
      return salesMode ? `Aqui está o link oficial: ${url}\n\nQuer que eu te ajude com mais alguma informação sobre o produto?` : `Aqui está o link: ${url}`;
    }
    const systemLines = [
      "Você é um assistente especializado em vendas online.",
      "Responda de forma clara, útil e concisa.",
      "Use apenas informações da página extraída.",
      "Nunca invente dados que não estejam disponíveis.",
      "Máximo 2-3 frases por resposta."
    ];
    if(shouldActivateSalesMode(instructions)){ systemLines.push("Tom consultivo e entusiasmado.","Termine com pergunta que leve à compra."); }
    const systemPrompt = systemLines.join('\\n');
    const contextLines = [];
    if(pageData.title) contextLines.push(`Produto: ${pageData.title}`);
    if(pageData.bonuses_detected && pageData.bonuses_detected.length>0) contextLines.push(`Bônus: ${pageData.bonuses_detected.slice(0,3).join(', ')}`);
    const contentExcerpt = (pageData.summary || pageData.cleanText || '').slice(0,1000);
    if(contentExcerpt) contextLines.push(`Informações: ${contentExcerpt}`);
    const pageContext = contextLines.join('\\n');
    const userPrompt = `${instructions ? `Instruções: ${instructions}\\n\\n` : ''}Contexto:\\n${pageContext}\\n\\nPergunta: ${userMessage}\\n\\nResponda de forma concisa usando apenas as informações fornecidas.`;
    const messages = [{ role: 'system', content: systemPrompt }, { role: 'user', content: userPrompt }];
    let response = null; let usedProvider = 'local';
    if(process.env.GROQ_API_KEY){ try{ response = await callGroq(messages,0.4,250); usedProvider='groq'; logger.info('GROQ call ok'); }catch(e){ logger.warn('GROQ failed: '+(e.message||e)); } }
    if(!response && process.env.OPENAI_API_KEY){ try{ response = await callOpenAI(messages,0.2,250); usedProvider='openai'; logger.info('OpenAI call ok'); }catch(e){ logger.warn('OpenAI failed: '+(e.message||e)); } }
    if(!response || !String(response).trim()){ response = generateLocalResponse(userMessage, pageData, instructions); usedProvider = 'local'; }
    const finalResponse = clampSentences(String(response).trim(), 3);
    logger.info(`AI response generated in ${Date.now()-start}ms using ${usedProvider}`);
    return finalResponse;
  }catch(err){ logger.error('AI generation failed: '+(err.message||err)); return NOT_FOUND_MSG; }
}

// Mock data for demos
const mockData = { analytics: { chatbotsCreated:147, messagesProcessed:8934, successRate:96.7, avgResponseTime:'1.2s', activeUsers:23, totalUsers:892, conversionRate:12.8 } };

// Routes
app.get('/health', (req,res)=>{
  const uptime = process.uptime();
  const avgResponseTime = analytics.responseTimeHistory.length>0 ? Math.round(analytics.responseTimeHistory.reduce((a,b)=>a+b,0)/analytics.responseTimeHistory.length) : 0;
  res.json({ status:'healthy', uptime:Math.floor(uptime), timestamp:new Date().toISOString(), version:'6.0.0 + v7.0', analytics:{ totalRequests:analytics.totalRequests, chatRequests:analytics.chatRequests, extractRequests:analytics.extractRequests, errors:analytics.errors, activeChats:analytics.activeChats.size, avgResponseTime, successfulExtractions:analytics.successfulExtractions, failedExtractions:analytics.failedExtractions, cacheSize:dataCache.size }, services:{ groq:!!process.env.GROQ_API_KEY, openai:!!process.env.OPENAI_API_KEY, puppeteer:!!puppeteer, tesseract:!!Tesseract } });
});

app.get('/status', (req,res)=>{
  res.json({ status:'online', version:'6.0 + v7.0 integrada', uptime:process.uptime(), memory:process.memoryUsage(), apis:{ groq:!!process.env.GROQ_API_KEY, openai:!!process.env.OPENAI_API_KEY, openrouter:!!process.env.OPENROUTER_API_KEY }, newFeatures:{ dashboard:'/dashboard/demo', widget:'/widget/demo', docs:'/docs' }, timestamp:new Date().toISOString() });
});

app.get('/analytics', (req,res)=>{
  const uptimeMs = Date.now()-analytics.startTime;
  const avgResponseTime = analytics.responseTimeHistory.length>0 ? Math.round(analytics.responseTimeHistory.reduce((a,b)=>a+b,0)/analytics.responseTimeHistory.length) : 0;
  res.json({ overview:{ totalRequests:analytics.totalRequests, chatRequests:analytics.chatRequests, extractRequests:analytics.extractRequests, errorCount:analytics.errors, errorRate: analytics.totalRequests>0 ? Math.round((analytics.errors/analytics.totalRequests)*100)+'%' : '0%', activeChats:analytics.activeChats.size, uptime:Math.floor(uptimeMs/1000), avgResponseTime, successRate: analytics.extractRequests>0 ? Math.round((analytics.successfulExtractions/analytics.extractRequests)*100)+'%' : '100%' }, performance:{ responseTimeHistory: analytics.responseTimeHistory.slice(-20), cacheHits: dataCache.size, memoryUsage: process.memoryUsage() } });
});

// POST /extract
app.post('/extract', async (req,res)=>{
  analytics.extractRequests++;
  try{
    const { url, instructions } = req.body || {};
    if(!url) return res.status(400).json({ success:false, error:'URL é obrigatório' });
    try{ new URL(url); } catch(e){ return res.status(400).json({ success:false, error:'URL inválido' }); }
    logger.info('Starting extraction for URL: '+url);
    const extracted = await extractPageData(url);
    if(instructions) extracted.custom_instructions = instructions;
    return res.json({ success:true, data:extracted });
  }catch(err){ analytics.errors++; logger.error('Extract endpoint error: '+(err.message||err)); return res.status(500).json({ success:false, error:'Erro interno ao extrair página' }); }
});

// POST /chat-universal
app.post('/chat-universal', async (req,res)=>{
  analytics.chatRequests++;
  try{
    const { message, pageData, url, conversationId, instructions = '', robotName, extractedData } = req.body || {};
    if(!message) return res.status(400).json({ success:false, error:'Mensagem é obrigatória' });
    if(conversationId){ analytics.activeChats.add(conversationId); setTimeout(()=>analytics.activeChats.delete(conversationId), 30*60*1000); }
    let processedPageData = pageData || extractedData;
    if(!processedPageData && url) processedPageData = await extractPageData(url);
    const aiResponse = await generateAIResponse(message, processedPageData || {}, [], instructions);
    let finalResponse = aiResponse;
    if(processedPageData?.url && !String(finalResponse).includes(processedPageData.url)) finalResponse = `${finalResponse}\n\n${processedPageData.url}`;
    return res.json({ success:true, response: finalResponse, bonuses_detected: processedPageData?.bonuses_detected || [], robotName: robotName || 'Assistente Virtual', timestamp: new Date().toISOString(), metadata: { hasPageData: !!processedPageData, contentLength: processedPageData?.cleanText?.length || 0, method: processedPageData?.method || 'none' } });
  }catch(err){ analytics.errors++; logger.error('Chat endpoint error: '+(err.message||err)); return res.status(500).json({ success:false, error:'Erro interno ao gerar resposta', fallbackResponse:'Desculpe, estou com dificuldades técnicas no momento. Pode tentar novamente em alguns instantes?' }); }
});

// Dashboard demo
app.get('/dashboard/demo', dashboardDemoLimit, (req,res)=>{
  logger.info('Dashboard demo accessed', { ip: req.ip });
  res.send(`<!DOCTYPE html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Dashboard Demo</title><style>*{box-sizing:border-box}body{font-family:-apple-system,Segoe UI,Roboto,sans-serif;background:#f5f7fa;margin:0} .banner{background:linear-gradient(45deg,#ff6b6b,#feca57);color:#fff;padding:1rem;text-align:center} .grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:1rem;padding:1rem} .card{background:#fff;padding:1rem;border-radius:8px;box-shadow:0 6px 20px rgba(0,0,0,0.06)}</style></head><body><div class="banner">🔴 DEMO PÚBLICO - Dashboard Analytics</div><div class="grid"><div class="card"><h3>${mockData.analytics.chatbotsCreated}</h3><p>Chatbots Criados</p></div><div class="card"><h3>${mockData.analytics.messagesProcessed}</h3><p>Mensagens Processadas</p></div><div class="card"><h3>${mockData.analytics.successRate}%</h3><p>Taxa de Sucesso</p></div><div class="card"><h3>${mockData.analytics.avgResponseTime}</h3><p>Tempo Médio</p></div></div></body></html>`);
});

// Widget demo
app.get('/widget/demo', widgetEmbedLimit, (req,res)=>{
  logger.info('Widget demo accessed', { ip: req.ip });
  res.send(`<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Widget Demo</title></head><body><h1>Widget Demo - Link Mágico</h1><p>Use /widget.js to embed</p></body></html>`);
});

// Docs
app.get('/docs', (req,res)=>{
  res.send(`<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Docs</title></head><body><h1>Documentação Link Mágico</h1><p>Ver endpoints: /chat-universal, /extract, /dashboard/demo, /widget/demo</p></body></html>`);
});

// Widget JS (client side embed)
app.get('/widget.js', (req,res)=>{
  res.set('Content-Type','application/javascript');
  res.send(`(function(){ if(window.LinkMagicoWidget) return; window.LinkMagicoWidget = { init: function(cfg){ this.cfg = Object.assign({apiBase:window.location.origin,robotName:'Assistente IA',primaryColor:'#667eea',instructions:''}, cfg||{}); if(document.readyState==='loading'){ document.addEventListener('DOMContentLoaded', this._create.bind(this)); } else this._create(); }, _create:function(){ const c=document.createElement('div'); c.id='linkmagico-widget'; c.innerHTML='<div style="position:fixed;right:20px;bottom:20px;z-index:999999"><button id=\"lm-btn\" style=\"width:60px;height:60px;border-radius:50%;background:'+this.cfg.primaryColor+';color:#fff\">💬</button></div>'; document.body.appendChild(c); document.getElementById('lm-btn').addEventListener('click', ()=>{ alert(\"Widget ativo - integracao com /chat-universal\") }); } }; })();`);
});

// Chatbot UI generator
function generateChatbotHTML(pageData = {}, robotName = 'Assistente IA', customInstructions = ''){
  const safeRobot = String(robotName||'Assistente IA').replace(/"/g,'\\"');
  const safeInst = String(customInstructions||'').replace(/"/g,'\\"');
  const escapedPage = JSON.stringify(pageData || {});
  return `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>LinkMágico - ${safeRobot}</title><style>*{box-sizing:border-box}body{font-family:-apple-system,Segoe UI,Roboto,sans-serif;background:linear-gradient(135deg,#667eea,#764ba2);min-height:100vh;padding:20px} .chat{max-width:700px;margin:0 auto;background:#fff;border-radius:12px;overflow:hidden;display:flex;flex-direction:column;height:80vh} .messages{flex:1;padding:16px;overflow:auto} .input{display:flex;padding:12px;border-top:1px solid #eee} input{flex:1;padding:10px;border-radius:20px;border:1px solid #ddd} button{margin-left:8px;padding:10px 14px;border-radius:8px;background:#667eea;color:#fff;border:0}</style></head><body><div class="chat"><div style="background:linear-gradient(135deg,#667eea,#764ba2);color:#fff;padding:16px"><h2>${safeRobot}</h2><p>Assistente Inteligente</p></div><div class="messages" id="messages"><div><strong>${safeRobot}:</strong> Olá! Como posso ajudar?</div></div><div class="input"><input id="msg" placeholder="Digite sua pergunta"><button id="send">Enviar</button></div></div><script>const pageData=${escapedPage};document.getElementById('send').onclick=async function(){ const m=document.getElementById('msg').value.trim(); if(!m) return; const cont=document.getElementById('messages'); cont.innerHTML += '<div style=\"text-align:right\"><strong>Você:</strong> '+m+'</div>'; document.getElementById('msg').value=''; try{ const r=await fetch('/chat-universal',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({message:m,pageData:pageData,robotName:'${safeRobot}',instructions:'${safeInst}',conversationId:'chat_'+Date.now()})}); const j=await r.json(); if(j.success){ cont.innerHTML += '<div><strong>${safeRobot}:</strong> '+(j.response||'Sem resposta')+'</div>'; } else { cont.innerHTML += '<div><strong>${safeRobot}:</strong> Erro ao gerar resposta</div>'; } }catch(e){ cont.innerHTML += '<div><strong>${safeRobot}:</strong> Erro de conexão</div>'; } }</script></body></html>`;
}

// Chatbot endpoint
app.get('/chatbot', async (req,res)=>{
  try{
    const robotName = req.query.name || 'Assistente IA';
    const url = req.query.url || '';
    const instructions = req.query.instructions || '';
    let pageData = {};
    if(url){ try{ pageData = await extractPageData(url); }catch(e){ logger.warn('Failed to extract for chatbot UI: '+(e.message||e)); } }
    const html = generateChatbotHTML(pageData, robotName, instructions);
    res.set('Content-Type','text/html; charset=utf-8').send(html);
  }catch(err){ logger.error('Chatbot HTML generation error: '+(err.message||err)); res.status(500).send('<h3>Erro ao gerar interface do chatbot</h3>'); }
});

// Root fallback
app.get('/', (req,res)=>{
  const indexPath = path.join(__dirname,'public','index.html');
  if(fs.existsSync(indexPath)) return res.sendFile(indexPath);
  res.send(`<html><body style="font-family:Arial,sans-serif;text-align:center;padding:40px"><h1>🤖 LinkMágico Chatbot v6.0 + v7.0</h1><p><a href="/health">Status</a> • <a href="/analytics">Analytics</a> • <a href="/widget.js">Widget</a> • <a href="/chatbot">Chat Demo</a></p><p><a href="/dashboard/demo">Dashboard Demo</a> • <a href="/widget/demo">Widget Demo</a> • <a href="/docs">Docs</a></p></body></html>`);
});

// Error handling & 404
app.use((err,req,res,next)=>{ analytics.errors++; logger.error('Unhandled error:', err); res.status(err.status || 500).json({ success:false, error: process.env.NODE_ENV === 'production' ? 'Internal server error' : (err.message || String(err)) }); });
app.use((req,res)=> res.status(404).json({ success:false, error:'Endpoint not found' }));

// Graceful shutdown
process.on('SIGTERM', ()=>{ logger.info('SIGTERM received, shutting down'); process.exit(0); });
process.on('SIGINT', ()=>{ logger.info('SIGINT received, shutting down'); process.exit(0); });

// Start server
const PORT = parseInt(process.env.PORT || '3000', 10);
app.listen(PORT, '0.0.0.0', ()=>{
  logger.info(`🚀 LinkMágico Chatbot v6.0 + v7.0 Server Started on port ${PORT}`);
  console.log(`Server started on port ${PORT}`);
});

module.exports = app;
