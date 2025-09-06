const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const winston = require('winston');
const axios = require('axios');
const cheerio = require('cheerio');
require('dotenv').config();

const app = express();


// ---------- Helpers para Modo Universal (respostas curtas e sem invenção) ----------
function normalizeText(t) {
  return (t || '').replace(/\s+/g, ' ').trim();
}

function extractCleanTextFromHTML(html) {
  try {
    const $ = cheerio.load(html);
    // Remove scripts, styles e elementos invisíveis
    $('script, style, noscript').remove();
    const blocks = [];
    $('h1, h2, h3, h4, h5, h6, p, li, blockquote').each((i, el) => {
      const txt = normalizeText($(el).text());
      if (txt && txt.length > 20 && txt.length < 600) blocks.push(txt);
    });
    return blocks.join('\n');
  } catch(e) {
    return '';
  }
}

function tokenize(s) {
  if (!s) return [];
  return (s.toLowerCase().match(/[a-zá-úà-ùâ-ûãõç0-9]+/gi) || [])
    .filter(w => !['a','o','os','as','um','uma','de','da','do','das','dos','e','é','em','para','por','com','sem','entre','sobre','que','quem','quando','onde','qual','quais','como','porque','se','no','na','nos','nas','ao','à','às','aos','até','the','of','and','to','in','for','on','at','from','is','are','be','or','by','with','this','that','as','it','its'].includes(w));
}

function classifyPage(text) {
  const l = (text || '').toLowerCase();
  const hasPrice = /(r\$\s?\d{1,3}(?:\.\d{3})*(?:,\d{2})?|\d+%)/i.test(l);
  const isSales = hasPrice || /(oferta|promoção|compre|comprar|garantia|frete|desconto|cupom|checkout|carrinho)/i.test(l);
  const isBlog = /(blog|artigo|post|publicado|leia mais)/i.test(l) && !isSales;
  const isInst = /(sobre|quem somos|missão|valores|nossa história|empresa)/i.test(l) && !isSales;
  const type = isSales ? 'sales' : isBlog ? 'blog' : isInst ? 'institutional' : 'other';
  return { page_type: type, has_price: hasPrice };
}

function selectRelevantSentences(text, question, max = 5) {
  if (!text) return [];
  const qTokens = tokenize(question);
  if (!qTokens.length) return [];
  const sentences = text.split(/(?<=[.!?:])\s+/);
  const scored = [];
  sentences.forEach(s => {
    const toks = tokenize(s);
    if (!toks.length) return;
    const overlap = toks.filter(t => qTokens.includes(t)).length;
    if (overlap > 0) {
      scored.push({score: overlap / toks.length, s: normalizeText(s)});
    }
  });
  scored.sort((a,b)=>b.score-a.score);
  return scored.slice(0, max).map(x=>x.s);
}

function bullets(items, limit = 5) {
  const list = (items || []).map(i => normalizeText(i)).filter(Boolean).slice(0, limit);
  return list.map(i => `- ${i}`).join('\n');
}

function clampSentences(text, max = 3) {
  const sents = normalizeText(text).split(/(?<=[.!?])\s+/);
  return sents.slice(0, max).join(' ');
}

const NOT_FOUND_MSG = "Não encontrei essa informação nesta página. Quer que eu te mostre o link direto?";

function universalAnswer(pageText, question) {
  const analysis = classifyPage(pageText);
  const rel = selectRelevantSentences(pageText, question, 5);
  if (!rel.length) {
    return { mode: 'not_found', page_type: analysis.page_type, answer: NOT_FOUND_MSG };
  }
  // sales highlighting
  if (analysis.page_type === 'sales' && analysis.has_price) {
    const prices = (pageText.match(/(R\$\s?\d{1,3}(?:\.\d{3})*(?:,\d{2})?|\d+%)/gi) || []).slice(0,3);
    const out = [];
    if (prices.length) out.push(`Preço/Promoção: ${prices.join(', ')}.`);
    out.push(...rel.slice(0,4));
    return { mode: 'bullets', page_type: analysis.page_type, answer: bullets(out) };
  }
  if (analysis.page_type === 'institutional') {
    const cues = [];
    const lower = pageText.toLowerCase();
    ['missão','valores','serviços','soluções','clientes','setores'].forEach(c => {
      const m = lower.match(new RegExp(c + '.{0,160}[.!?]', 'i'));
      if (m) cues.push(normalizeText(m[0]));
    });
    if (cues.length) {
      return { mode: 'bullets', page_type: analysis.page_type, answer: bullets([...cues, ...rel.slice(0,4)]) };
    }
    return { mode: 'sentences', page_type: analysis.page_type, answer: clampSentences(rel.join(' '), 3) };
  }
  if (analysis.page_type === 'blog') {
    return { mode: 'bullets', page_type: analysis.page_type, answer: bullets(rel) };
  }
  return { mode: 'sentences', page_type: analysis.page_type, answer: clampSentences(rel.join(' '), 3) };
}
const PORT = process.env.PORT || 3000;

// Configuração de logs
const logger = winston.createLogger({
  level: 'info',
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.json()
  ),
  transports: [
    new winston.transports.Console(),
    new winston.transports.File({ filename: 'chatbot.log' })
  ]
});

// Middlewares
app.use(helmet({
  contentSecurityPolicy: false,
  crossOriginEmbedderPolicy: false
}));
app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Servir arquivos estáticos da pasta atual
app.use(express.static(__dirname));

// Cache para dados extraídos
const dataCache = new Map();
const CACHE_TTL = 3600000; // 1 hora

// Cache para conversas do chatbot
const conversationCache = new Map();

// Função SUPER REFINADA para extrair dados da página
async function extractPageData(url) {
  try {
    logger.info(`Iniciando extração SUPER REFINADA de dados para: ${url}`);
    
    // Verificar cache
    const cacheKey = url;
    const cached = dataCache.get(cacheKey);
    if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
      logger.info('Dados encontrados no cache');
      return cached.data;
    }

    let extractedData = {
      title: 'Produto Incrível',
      description: 'Descubra este produto incrível que vai transformar sua vida!',
      price: 'Consulte o preço na página',
      benefits: ['Resultados comprovados', 'Suporte especializado', 'Garantia de satisfação'],
      testimonials: ['Produto excelente!', 'Recomendo para todos!'],
      cta: 'Compre Agora!',
      url: url
    };

    try {
      // Fazer requisição HTTP com headers realistas
      const response = await axios.get(url, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
          'Accept-Language': 'pt-BR,pt;q=0.9,en;q=0.8',
          'Accept-Encoding': 'gzip, deflate, br',
          'Connection': 'keep-alive',
          'Upgrade-Insecure-Requests': '1'
        },
        timeout: 15000,
        maxRedirects: 5,
        validateStatus: function (status) {
          return status >= 200 && status < 400; // Aceita redirecionamentos
        }
      });

      // Log da URL final após redirecionamentos
      const finalUrl = response.request.res.responseUrl || url;
      if (finalUrl !== url) {
        logger.info(`URL redirecionada de ${url} para ${finalUrl}`);
        extractedData.url = finalUrl; // Atualizar com URL final
      }

      if (response.status === 200) {
        const $ = cheerio.load(response.data);
        // Texto limpo para modo universal
        extractedData.cleanText = extractCleanTextFromHTML(response.data);
        
        // SUPER REFINAMENTO: Extrair título com múltiplas estratégias
        let title = '';
        const titleSelectors = [
          'h1:not(:contains("Vendd")):not(:contains("Página")):not(:contains("Error")):not(:contains("404"))',
          '.main-title:not(:contains("Vendd"))',
          '.product-title:not(:contains("Vendd"))',
          '.headline:not(:contains("Vendd"))',
          '.title:not(:contains("Vendd"))',
          '[class*="title"]:not(:contains("Vendd")):not(:contains("Error"))',
          '[class*="headline"]:not(:contains("Vendd"))',
          'meta[property="og:title"]',
          'meta[name="twitter:title"]',
          'title'
        ];
        
        for (const selector of titleSelectors) {
          const element = $(selector).first();
          if (element.length) {
            title = element.attr('content') || element.text();
            if (title && title.trim().length > 10 && 
                !title.toLowerCase().includes('vendd') && 
                !title.toLowerCase().includes('página') &&
                !title.toLowerCase().includes('error') &&
                !title.toLowerCase().includes('404')) {
              extractedData.title = title.trim();
              logger.info(`Título extraído: ${title.trim()}`);
              break;
            }
          }
        }

        // SUPER REFINAMENTO: Extrair descrição mais específica e detalhada
        let description = '';
        const descSelectors = [
          // Primeiro, procurar por descrições específicas do produto
          '.product-description p:first-child',
          '.description p:first-child',
          '.summary p:first-child',
          '.lead p:first-child',
          '.intro p:first-child',
          '.content p:first-child',
          '.main-content p:first-child',
          // Procurar por parágrafos com palavras-chave específicas
          'p:contains("Arsenal"):first',
          'p:contains("Secreto"):first',
          'p:contains("CEO"):first',
          'p:contains("Afiliado"):first',
          'p:contains("Transforme"):first',
          'p:contains("Descubra"):first',
          'p:contains("Vendas"):first',
          'p:contains("Marketing"):first',
          'p:contains("Estratégia"):first',
          'p:contains("Resultado"):first',
          // Meta tags
          'meta[name="description"]',
          'meta[property="og:description"]',
          'meta[name="twitter:description"]',
          // Por último, parágrafos gerais (mas filtrados)
          'p:not(:contains("cookie")):not(:contains("política")):not(:contains("termos")):not(:contains("vendd")):not(:empty)',
          '.text-content p:first',
          'article p:first',
          'main p:first'
        ];
        
        for (const selector of descSelectors) {
          const element = $(selector).first();
          if (element.length) {
            description = element.attr('content') || element.text();
            if (description && description.trim().length > 80 && 
                !description.toLowerCase().includes('cookie') && 
                !description.toLowerCase().includes('política') &&
                !description.toLowerCase().includes('termos') &&
                !description.toLowerCase().includes('vendd') &&
                !description.toLowerCase().includes('error')) {
              extractedData.description = description.trim().substring(0, 500);
              logger.info(`Descrição extraída: ${description.trim().substring(0, 100)}...`);
              break;
            }
          }
        }

        // SUPER REFINAMENTO: Extrair preço com busca mais específica e inteligente
        let price = '';
        const priceSelectors = [
          // Seletores específicos para preços
          '.price-value',
          '.product-price-value',
          '.valor-produto',
          '.preco-produto',
          '.amount',
          '.cost',
          '.price',
          '.valor',
          '.preco',
          '.money',
          '.currency',
          // Classes que podem conter preços
          '[class*="price"]',
          '[class*="valor"]',
          '[class*="preco"]',
          '[class*="money"]',
          '[class*="cost"]',
          '[class*="amount"]'
        ];
        
        // Primeiro, procurar em elementos específicos
        for (const selector of priceSelectors) {
          $(selector).each((i, element) => {
            const text = $(element).text().trim();
            // Regex mais específica para encontrar preços brasileiros
            const priceMatch = text.match(/R\$\s*\d{1,3}(?:[.,]\d{3})*(?:[.,]\d{2})?|USD\s*\d+[.,]?\d*|\$\s*\d+[.,]?\d*|€\s*\d+[.,]?\d*|£\s*\d+[.,]?\d*/);
            if (priceMatch && !price) {
              price = priceMatch[0];
              logger.info(`Preço extraído: ${price}`);
              return false; // Break do each
            }
          });
          if (price) break;
        }
        
        // Se não encontrou preço específico, procurar no texto geral
        if (!price) {
          const bodyText = $("body").text();
          const priceMatches = bodyText.match(/R\$\s*\d{1,3}(?:[.,]\d{3})*(?:[.,]\d{2})?/g);
          if (priceMatches && priceMatches.length > 0) {
            // Pegar o primeiro preço que pareça ser um valor de produto (não muito baixo)
            for (const match of priceMatches) {
              const numericValue = parseFloat(match.replace(/R\$\s*/, '').replace(/[.,]/g, ''));
              if (numericValue > 50) { // Assumir que produtos custam mais que R$ 50
                price = match;
                logger.info(`Preço extraído do texto geral: ${price}`);
                break;
              }
            }
          }
        }
        
        // Se ainda não encontrou preço, procurar por ofertas ou promoções
        if (!price) {
          const offerSelectors = [
            '*:contains("oferta"):not(script):not(style)',
            '*:contains("promoção"):not(script):not(style)',
            '*:contains("desconto"):not(script):not(style)',
            '*:contains("por apenas"):not(script):not(style)',
            '*:contains("investimento"):not(script):not(style)',
            '*:contains("valor"):not(script):not(style)'
          ];
          
          for (const selector of offerSelectors) {
            $(selector).each((i, element) => {
              const text = $(element).text().trim();
              if (text.length > 20 && text.length < 300 && !price &&
                  (text.includes('R$') || text.includes('apenas') || text.includes('investimento'))) {
                price = text;
                logger.info(`Oferta extraída: ${price}`);
                return false;
              }
            });
            if (price) break;
          }
        }
        
        if (price) {
          extractedData.price = price;
        }

        // SUPER REFINAMENTO: Extrair resumo de até 3 linhas do conteúdo da página
        const bodyText = $("body").text();
        const cleanText = bodyText.replace(/\s+/g, " ").trim();
        const sentences = cleanText.split(/[.!?]+/).filter(s => s.trim().length > 20);
        const summary = sentences.slice(0, 3).join('. ').substring(0, 300) + "...";
        extractedData.summary = summary;

        // SUPER REFINAMENTO: Extrair benefícios mais específicos e relevantes
        const benefits = [];
        const benefitSelectors = [
          '.benefits li',
          '.vantagens li',
          '.features li',
          '.product-benefits li',
          '.advantages li',
          'ul li:contains("✓")',
          'ul li:contains("✅")',
          'ul li:contains("•")',
          'ul li:contains("→")',
          'li:contains("Transforme")',
          'li:contains("Alcance")',
          'li:contains("Domine")',
          'li:contains("Aprenda")',
          'li:contains("Fechar")',
          'li:contains("Resultados")',
          'li:contains("Garantia")',
          'li:contains("Estratégia")',
          'li:contains("Técnica")',
          'li:contains("Método")',
          'li:contains("Sistema")',
          'ul li',
          'ol li'
        ];
        
        for (const selector of benefitSelectors) {
          $(selector).each((i, el) => {
            const text = $(el).text().trim();
            if (text && text.length > 20 && text.length < 300 && benefits.length < 5 &&
                !text.toLowerCase().includes('cookie') &&
                !text.toLowerCase().includes('política') &&
                !text.toLowerCase().includes('termos') &&
                !text.toLowerCase().includes('vendd') &&
                !text.toLowerCase().includes('error') &&
                !benefits.includes(text)) {
              benefits.push(text);
            }
          });
          if (benefits.length >= 5) break;
        }
        
        if (benefits.length > 0) {
          extractedData.benefits = benefits;
          logger.info(`Benefícios extraídos: ${benefits.length}`);
        }

        // SUPER REFINAMENTO: Extrair depoimentos mais específicos
        const testimonials = [];
        const testimonialSelectors = [
          '.testimonials li',
          '.depoimentos li',
          '.reviews li',
          '.review',
          '.testimonial-text',
          '.depoimento',
          '.feedback',
          '*:contains("recomendo"):not(script):not(style)',
          '*:contains("excelente"):not(script):not(style)',
          '*:contains("funcionou"):not(script):not(style)',
          '*:contains("resultado"):not(script):not(style)',
          '*:contains("incrível"):not(script):not(style)',
          '*:contains("mudou minha vida"):not(script):not(style)'
        ];
        
        for (const selector of testimonialSelectors) {
          $(selector).each((i, el) => {
            const text = $(el).text().trim();
            if (text && text.length > 30 && text.length < 400 && testimonials.length < 3 &&
                !text.toLowerCase().includes('cookie') &&
                !text.toLowerCase().includes('política') &&
                !text.toLowerCase().includes('vendd') &&
                !testimonials.includes(text)) {
              testimonials.push(text);
            }
          });
          if (testimonials.length >= 3) break;
        }
        
        if (testimonials.length > 0) {
          extractedData.testimonials = testimonials;
        }

        // SUPER REFINAMENTO: Extrair CTA mais específico
        let cta = '';
        const ctaSelectors = [
          'a.button:contains("QUERO")',
          'button.cta:contains("QUERO")',
          'a:contains("ARSENAL")',
          'button:contains("ARSENAL")',
          'a:contains("AGORA")',
          'button:contains("AGORA")',
          'a:contains("COMPRAR")',
          'button:contains("COMPRAR")',
          'a:contains("ADQUIRIR")',
          'button:contains("ADQUIRIR")',
          '.buy-button',
          '.call-to-action',
          '[class*="buy"]',
          '[class*="cta"]',
          '.btn-primary',
          '.btn-success',
          '.button-primary'
        ];
        
        for (const selector of ctaSelectors) {
          const element = $(selector).first();
          if (element.length) {
            cta = element.text().trim();
            if (cta && cta.length > 5 && cta.length < 100) {
              extractedData.cta = cta;
              logger.info(`CTA extraído: ${cta}`);
              break;
            }
          }
        }

        logger.info('Extração SUPER REFINADA concluída com sucesso via Cheerio');

      } else {
        logger.warn(`Status HTTP não OK: ${response.status}`);
      }

    } catch (axiosError) {
      logger.error('Erro na requisição HTTP:', axiosError.message, axiosError.response ? axiosError.response.data : 'No response data');
      
      // Fallback: tentar com fetch nativo se axios falhar
      try {
        const fetch = require('node-fetch');
        const response = await fetch(url, {
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
          },
          timeout: 10000
        });
        
        if (response.ok) {
          const html = await response.text();
          if (!extractedData.cleanText) extractedData.cleanText = extractCleanTextFromHTML(html);
          
          // Extrair título básico
          const titleMatch = html.match(/<title[^>]*>([^<]+)<\/title>/i);
          if (titleMatch && titleMatch[1] && !titleMatch[1].toLowerCase().includes('vendd')) {
            extractedData.title = titleMatch[1].trim();
          }
          
          // Extrair meta description
          const descMatch = html.match(/<meta[^>]*name=["']description["'][^>]*content=["']([^"']+)["']/i);
          if (descMatch && descMatch[1]) {
            extractedData.description = descMatch[1].trim();
          }
          
          logger.info('Extração básica concluída via fetch');
        }
      } catch (fetchError) {
        logger.warn('Erro no fallback fetch:', fetchError.message);
      }
    }

    // Salvar no cache
   // Forçar título e preço a ficarem vazios
extractedData.title = "";
extractedData.price = "";

// Salvar no cache
dataCache.set(cacheKey, {
  data: extractedData,
  timestamp: Date.now()
});

logger.info("Dados SUPER REFINADOS extraídos (com título e preço ocultados):", extractedData);
return extractedData;

  } catch (error) {
    logger.error("Erro geral na extração:", error);
    // Retornar dados padrão em caso de erro
    return {
      title: 'Arsenal Secreto dos CEOs - Transforme Afiliados em CEOs de Sucesso',
      description: 'Descubra o Arsenal Secreto que está transformando afiliados em CEOs de sucesso! Pare de perder tempo e dinheiro! Agora você tem em mãos as estratégias e ferramentas exatas que os maiores empreendedores digitais usam para ganhar milhares de reais!',
      price: 'Oferta especial - Consulte o preço na página',
      benefits: ['Resultados comprovados', 'Suporte especializado', 'Garantia de satisfação'],
      testimonials: ['Produto excelente!', 'Recomendo para todos!'],
      cta: 'Compre Agora!',
      url: url
    };
  }
}

// Rota para extração de dados da página
app.post('/extract', async (req, res) => {
  const { url } = req.body;
  logger.info(`Solicitação de extração SUPER REFINADA para: ${url}`);

  if (!url) {
    return res.status(400).json({ error: 'URL da página é obrigatória.' });
  }

  try {
    const extractedData = await extractPageData(url);
    res.json({ data: extractedData });
  } catch (error) {
    logger.error('Erro ao processar a extração:', error);
    res.status(500).json({ error: 'Erro ao extrair dados da página.' });
  }
});

// Função para gerar resposta da IA
async function generateAIResponse(userMessage, pageData, conversationId = 'default') {
  try {
    // Recuperar histórico da conversa
    let conversation = conversationCache.get(conversationId) || [];
    
    // Adicionar mensagem do usuário ao histórico
    conversation.push({ role: 'user', message: userMessage, timestamp: Date.now() });
    
    // Manter apenas as últimas 10 mensagens para não sobrecarregar
    if (conversation.length > 10) {
      conversation = conversation.slice(-10);
    }
    
    // Salvar histórico atualizado
    conversationCache.set(conversationId, conversation);

    if (!process.env.OPENROUTER_API_KEY) {
      // SUPER INTELIGÊNCIA: Sistema de respostas contextuais e específicas
      const message = userMessage.toLowerCase();
      
      // Detectar intenção específica da mensagem
      let response = '';
      
      if (message.includes('preço') || message.includes('valor') || message.includes('custa') || message.includes('investimento')) {
        response = `💰 **Sobre o investimento no "${pageData.title}":**\n\n${pageData.price}\n\nÉ um investimento que se paga rapidamente com os resultados que você vai alcançar! Muitos clientes recuperam o valor em poucos dias.\n\n🎯 ${pageData.cta}`;
        
      } else if (message.includes('benefício') || message.includes('vantagem') || message.includes('o que ganho')) {
        response = `✅ **Os principais benefícios do "${pageData.title}" são:**\n\n${pageData.benefits.map((benefit, i) => `${i+1}. ${benefit}`).join('\n')}\n\n🚀 ${pageData.cta}`;
        
      } else if (message.includes('como funciona') || message.includes('funciona') || message.includes('método')) {
        response = `🔥 **Como o "${pageData.title}" funciona:**\n\n${pageData.description}\n\n**Principais resultados que você vai alcançar:**\n${pageData.benefits.slice(0,3).map(b => `• ${b}`).join('\n')}\n\n💪 ${pageData.cta}`;
        
      } else if (message.includes('garantia') || message.includes('seguro') || message.includes('risco')) {
        response = `🛡️ **Sim! O "${pageData.title}" oferece garantia total.**\n\n${pageData.description}\n\nVocê não tem nada a perder e tudo a ganhar! Se não ficar satisfeito, devolvemos seu dinheiro.\n\n✅ ${pageData.cta}`;
        
      } else if (message.includes('depoimento') || message.includes('opinião') || message.includes('funciona mesmo') || message.includes('resultado')) {
        if (pageData.testimonials.length > 0) {
          // Remover duplicatas dos depoimentos
          const uniqueTestimonials = [...new Set(pageData.testimonials)].slice(0, 3);
          response = `💬 **Veja o que nossos clientes dizem sobre "${pageData.title}":**\n\n${uniqueTestimonials.map((t, i) => `${i+1}. "${t}"`).join('\n\n')}\n\n🎯 ${pageData.cta}`;
        } else {
          response = `💬 **O "${pageData.title}" já transformou a vida de milhares de pessoas!**\n\n${pageData.description}\n\nOs resultados falam por si só!\n\n🚀 ${pageData.cta}`;
        }
        
      } else if (message.includes('bônus') || message.includes('extra') || message.includes('brinde')) {
        response = `🎁 **Sim! Temos bônus exclusivos para quem adquire o "${pageData.title}" hoje:**\n\n• Suporte especializado\n• Atualizações gratuitas\n• Acesso à comunidade VIP\n• Material complementar\n\n⏰ Oferta por tempo limitado!\n\n🔥 ${pageData.cta}`;
        
      } else if (message.includes('comprar') || message.includes('adquirir') || message.includes('quero')) {
        response = `🎉 **Excelente escolha!**\n\nO "${pageData.title}" é exatamente o que você precisa para transformar seus resultados!\n\n💰 **Investimento:** ${pageData.price}\n\n✅ **Você vai receber:**\n${pageData.benefits.slice(0,3).map(b => `• ${b}`).join('\n')}\n\n🚀 **${pageData.cta}**\n\nClique no botão acima para garantir sua vaga!`;
        
      } else if (message.includes('dúvida') || message.includes('pergunta') || message.includes('ajuda')) {
        response = `🤝 **Estou aqui para te ajudar!**\n\nPosso esclarecer qualquer dúvida sobre o "${pageData.title}":\n\n• 💰 Preços e formas de pagamento\n• ✅ Benefícios e características\n• 💬 Depoimentos de clientes\n• 🛡️ Garantias e segurança\n• 🎁 Bônus exclusivos\n• 🚀 Processo de compra\n\nO que você gostaria de saber?`;
        
      } else {
        // Resposta padrão mais inteligente e persuasiva
        response = `Olá! 👋 **Sobre o "${pageData.title}":**\n\n${pageData.description}\n\n💰 **Investimento:** ${pageData.price}\n\n✅ **Principais benefícios:**\n${pageData.benefits.slice(0,3).map(b => `• ${b}`).join('\n')}\n\n🎯 **${pageData.cta}**\n\n**Como posso te ajudar mais?** Posso falar sobre preços, benefícios, garantias ou depoimentos!`;
      }
      
      // Adicionar resposta ao histórico
      conversation.push({ role: 'assistant', message: response, timestamp: Date.now() });
      conversationCache.set(conversationId, conversation);
      
      return response;
    }

    // Se tiver API key, usar IA externa
    const conversationHistory = conversation.map(c => ({
      role: c.role === 'user' ? 'user' : 'assistant',
      content: c.message
    }));

    const prompt = `Você é um assistente de vendas especializado e altamente persuasivo para o produto "${pageData.title}".

INFORMAÇÕES REAIS DO PRODUTO:
- Título: ${pageData.title}
- Descrição: ${pageData.description}
- Preço: ${pageData.price}
- Benefícios: ${pageData.benefits.join(', ')}
- Call to Action: ${pageData.cta}

INSTRUÇÕES:
- Use APENAS as informações reais do produto fornecidas
- Seja específico, persuasivo e focado em vendas
- Responda de forma amigável e profissional
- Conduza naturalmente para a compra
- Use emojis para tornar a conversa mais envolvente

Pergunta do cliente: ${userMessage}`;

    const response = await axios.post('https://openrouter.ai/api/v1/chat/completions', {
      model: 'microsoft/wizardlm-2-8x22b',
      messages: [
        {
          role: 'system',
          content: 'Você é um assistente de vendas especializado, amigável e altamente persuasivo. Use apenas informações reais do produto fornecidas.'
        },
        ...conversationHistory.slice(-5), // Últimas 5 mensagens para contexto
        {
          role: 'user',
          content: prompt
        }
      ],
      max_tokens: 500,
      temperature: 0.7
    }, {
      headers: {
        'Authorization': `Bearer ${process.env.OPENROUTER_API_KEY}`,
        'Content-Type': 'application/json',
        'HTTP-Referer': 'https://linkmagico-chatbot.com',
        'X-Title': 'LinkMagico Chatbot'
      }
    });

    if (response.status === 200) {
      const aiResponse = response.data.choices[0].message.content;
      
      // Adicionar resposta da IA ao histórico
      conversation.push({ role: 'assistant', message: aiResponse, timestamp: Date.now() });
      conversationCache.set(conversationId, conversation);
      
      return aiResponse;
    } else {
      throw new Error('Erro na API do OpenRouter');
    }

  } catch (error) {
    logger.error('Erro na geração de resposta IA:', error);
    
    // SUPER FALLBACK: Resposta específica e persuasiva
    const fallbackResponse = `Olá! 🔥 **Sobre o "${pageData.title}":**\n\n${pageData.description}\n\n💰 **Investimento:** ${pageData.price}\n\n✅ **Principais benefícios:**\n${pageData.benefits.map(benefit => `• ${benefit}`).join('\n')}\n\n💬 **Depoimentos:** ${pageData.testimonials.slice(0,2).join(' | ')}\n\n🚀 **${pageData.cta}**\n\n**Como posso te ajudar mais?** Posso esclarecer sobre preços, benefícios, garantias ou processo de compra!`;

    return fallbackResponse;
  }
}

// Função para gerar HTML do chatbot (melhorada)
function generateChatbotHTML(pageData, robotName, customInstructions = '') {
  return `
<!DOCTYPE html>
<html lang="pt-BR">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>LinkMágico Chatbot - ${robotName}</title>
    <style>
        * {
            margin: 0;
            padding: 0;
            box-sizing: border-box;
        }
        
        body {
            font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            min-height: 100vh;
            display: flex;
            align-items: center;
            justify-content: center;
            padding: 20px;
        }
        
        .chat-container {
            background: white;
            border-radius: 20px;
            box-shadow: 0 20px 40px rgba(0,0,0,0.1);
            width: 100%;
            max-width: 500px;
            height: 600px;
            display: flex;
            flex-direction: column;
            overflow: hidden;
        }
        
        .chat-header {
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            color: white;
            padding: 20px;
            text-align: center;
        }
        
        .chat-header h1 {
            font-size: 1.5rem;
            margin-bottom: 5px;
        }
        
        .chat-header p {
            opacity: 0.9;
            font-size: 0.9rem;
        }
        
        .product-info {
            background: #f8f9fa;
            padding: 15px;
            border-bottom: 1px solid #e9ecef;
        }
        
        .product-title {
            font-weight: bold;
            color: #333;
            margin-bottom: 5px;
            font-size: 0.95rem;
        }
        
        .product-price {
            color: #28a745;
            font-weight: bold;
            font-size: 1.1rem;
        }
        
        .chat-messages {
            flex: 1;
            padding: 20px;
            overflow-y: auto;
            background: #f8f9fa;
        }
        
        .message {
            margin-bottom: 15px;
            display: flex;
            align-items: flex-start;
        }
        
        .message.user {
            justify-content: flex-end;
        }
        
        .message.bot {
            justify-content: flex-start;
        }
        
        .message-content {
            max-width: 80%;
            padding: 12px 16px;
            border-radius: 18px;
            word-wrap: break-word;
            white-space: pre-line;
            line-height: 1.4;
        }
        
        .message.user .message-content {
            background: #667eea;
            color: white;
        }
        
        .message.bot .message-content {
            background: white;
            color: #333;
            border: 1px solid #e9ecef;
        }
        
        .chat-input {
            padding: 20px;
            background: white;
            border-top: 1px solid #e9ecef;
        }
        
        .input-group {
            display: flex;
            gap: 10px;
        }
        
        .input-group input {
            flex: 1;
            padding: 12px 16px;
            border: 2px solid #e9ecef;
            border-radius: 25px;
            outline: none;
            font-size: 1rem;
        }
        
        .input-group input:focus {
            border-color: #667eea;
        }
        
        .input-group button {
            padding: 12px 20px;
            background: #667eea;
            color: white;
            border: none;
            border-radius: 25px;
            cursor: pointer;
            font-size: 1rem;
            transition: background 0.3s;
        }
        
        .input-group button:hover {
            background: #5a6fd8;
        }
        
        .typing-indicator {
            display: none;
            padding: 10px;
            font-style: italic;
            color: #666;
        }
        
        @media (max-width: 600px) {
            .chat-container {
                height: 100vh;
                border-radius: 0;
            }
        }
    </style>
</head>
<body>
    <div class="chat-container">
        <div class="chat-header">
            <h1>🤖 ${robotName}</h1>
            <p>Assistente Inteligente para Vendas</p>
        </div>
        
        
        
        <div class="chat-messages" id="chatMessages">
            <div class="message bot">
                <div class="message-content">
                    Olá! 👋 Sou o ${robotName}, seu assistente especializado em "${pageData.title}". 
                    
                    Como posso te ajudar hoje? Posso responder sobre:
                    • Preços e formas de pagamento
                    • Benefícios e características
                    • Depoimentos de clientes
                    • Processo de compra
                    ${customInstructions ? '\n\n' + customInstructions : ''}
                </div>
            </div>
        </div>
        
        <div class="typing-indicator" id="typingIndicator">
            ${robotName} está digitando...
        </div>
        
        <div class="chat-input">
            <div class="input-group">
                <input type="text" id="messageInput" placeholder="Digite sua pergunta..." maxlength="500">
                <button onclick="sendMessage()">Enviar</button>
            </div>
        </div>
    </div>

    <script>
        const pageData = ${JSON.stringify(pageData)};
        const robotName = "${robotName}";
        const conversationId = 'chat_' + Date.now();
        
        function addMessage(content, isUser = false) {
            const messagesContainer = document.getElementById('chatMessages');
            const messageDiv = document.createElement('div');
            messageDiv.className = 'message ' + (isUser ? 'user' : 'bot');
            
            const contentDiv = document.createElement('div');
            contentDiv.className = 'message-content';
            contentDiv.textContent = content;
            
            messageDiv.appendChild(contentDiv);
            messagesContainer.appendChild(messageDiv);
            messagesContainer.scrollTop = messagesContainer.scrollHeight;
        }
        
        function showTyping() {
            document.getElementById('typingIndicator').style.display = 'block';
        }
        
        function hideTyping() {
            document.getElementById('typingIndicator').style.display = 'none';
        }
        
        async function sendMessage() {
            const input = document.getElementById('messageInput');
            const message = input.value.trim();
            
            if (!message) return;
            
            addMessage(message, true);
            input.value = '';
            
            showTyping();
            
            try {
                const response = await fetch('/chat-universal', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify({
                        message: message,
                        pageData: pageData,
                        robotName: robotName,
                        conversationId: conversationId
                    })
                });
                
                const data = await response.json();
                hideTyping();
                
                if (data.success) {
                    addMessage(data.response);
                } else {
                    addMessage('Desculpe, ocorreu um erro. Tente novamente.');
                }
            } catch (error) {
                hideTyping();
                addMessage('Erro de conexão. Verifique sua internet e tente novamente.');
            }
        }
        
        document.getElementById('messageInput').addEventListener('keypress', function(e) {
            if (e.key === 'Enter') {
                sendMessage();
            }
        });
    </script>
</body>
</html>`;
}



// UI simples para o modo universal (não interfere no chat existente)
function generateUniversalHTML(url, robotName) {
  return `<!DOCTYPE html>
  <html lang="pt-BR"><head>
  <meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${robotName} • Chat Universal</title>
  <style>
  body{font-family:system-ui;background:#0b1020;margin:0;display:flex;align-items:center;justify-content:center;min-height:100vh}
  .box{background:#fff;max-width:880px;width:94%;border-radius:18px;box-shadow:0 10px 30px rgba(0,0,0,.2);padding:18px}
  input{width:100%;padding:10px;border:1px solid #e2e8f0;border-radius:10px}
  button{background:#6a11cb;border:0;color:#fff;padding:10px 14px;border-radius:10px;font-weight:700;cursor:pointer}
  #out{white-space:pre-wrap;border:1px dashed #cbd5e1;border-radius:10px;padding:12px;background:#f8fafc;min-height:72px}
  small{color:#64748b}
  </style></head>
  <body><div class="box">
  <h2>${robotName} — Chat Universal</h2>
  <p><small>Responde só com base no conteúdo de: <b>${url}</b></small></p>
  <div style="display:flex; gap:12px"><input id="q" placeholder="Pergunte de forma objetiva..."><button id="ask">Perguntar</button></div>
  <h3>Resposta</h3><div id="out"></div>
  </div>
  <script>
  const ask = async () => {
    const q = document.getElementById('q').value.trim();
    const out = document.getElementById('out');
    if(!q){alert('Escreva sua pergunta'); return;}
    out.textContent = 'Pensando...';
    const r = await fetch('/chat-universal', {method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ url: '${url}', message: q })});
    const data = await r.json();
    out.textContent = data.success ? data.answer : ('Erro: '+(data.error||'falha'));
  }
  document.getElementById('ask').onclick = ask;
  </script></body></html>`;
}
// Rotas da API

// CORREÇÃO: Rota /extract (não /api/extract)
app.post("/extract", async (req, res) => {
  try {
    const { url } = req.body;
    
    if (!url) {
      return res.status(400).json({ 
        success: false, 
        error: 'URL é obrigatória' 
      });
    }

    logger.info(`Solicitação de extração SUPER REFINADA para: ${url}`);
    const data = await extractPageData(url);
    
    res.json(data); // Retorna diretamente os dados, não wrapped em success/data
    
  } catch (error) {
    logger.error('Erro na rota de extração:', error);
    res.status(500).json({ 
      success: false, 
      error: 'Erro interno do servidor' 
    });
  }
});

// Manter rota /api/extract para compatibilidade
app.get('/api/extract', async (req, res) => {
  try {
    const { url } = req.body;
    
    if (!url) {
      return res.status(400).json({ 
        success: false, 
        error: 'URL é obrigatória' 
      });
    }

    logger.info(`Solicitação de extração para: ${url}`);
    const data = await extractPageData(url);
    
    res.json({ 
      success: true, 
      data: data 
    });
    
  } catch (error) {
    logger.error('Erro na rota de extração:', error);
    res.status(500).json({ 
      success: false, 
      error: 'Erro interno do servidor' 
    });
  }
});

// Rota para o chatbot
app.get('/chatbot', async (req, res) => {
  try {
    const { url, robot, instructions } = req.query;
    
    if (!url || !robot) {
      return res.status(400).send('URL e nome do robô são obrigatórios');
    }

    logger.info(`Gerando chatbot para: ${url} com robô: ${robot}`);
    
    const pageData = await extractPageData(url);
    const html = generateChatbotHTML(pageData, robot, instructions);
    
    res.send(html);
    
  } catch (error) {
    logger.error('Erro na rota do chatbot:', error);
    res.status(500).send('Erro interno do servidor');
  }
});

// Rota para chat da IA (melhorada)
app.post('/chat-universal', async (req, res) => {
  try {
    const { message, pageData, robotName, conversationId } = req.body;
    
    if (!message || !pageData) {
      return res.status(400).json({ 
        success: false, 
        error: 'Mensagem e dados da página são obrigatórios' 
      });
    }

    logger.info(`Chat: ${robotName} - ${message}`);
    
    const response = await generateAIResponse(message, pageData, conversationId);
    
    res.json({ 
      success: true, 
      response: response 
    });
    
  } catch (error) {
    logger.error('Erro na rota de chat:', error);
    res.status(500).json({ 
      success: false, 
      error: 'Erro interno do servidor' 
    });
  }
});

// Rota de teste para extração
app.get('/test-extraction', async (req, res) => {
  try {
    const { url } = req.body;
    const testUrl = url || 'https://www.arsenalsecretodosceos.com.br/Nutrileads';
    
    logger.info(`Teste de extração SUPER REFINADA para: ${testUrl}`);
    const data = await extractPageData(testUrl);
    
    res.json({
      success: true,
      url: testUrl,
      extractedData: data,
      timestamp: new Date().toISOString()
    });
    
  } catch (error) {
    logger.error('Erro no teste de extração:', error);
    res.status(500).json({ 
      success: false, 
      error: error.message 
    });
  }
});

// Rota de saúde
app.get('/health', (req, res) => {
  res.json({ 
    status: 'OK', 
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    version: '5.0.1-SUPER-CORRIGIDO'
  });
});

// Rota raiz para servir o index.html
app.get('/', (req, res) => {
  res.sendFile(__dirname + '/index.html');
});

// Middleware de tratamento de erros
app.use((error, req, res, next) => {
  logger.error('Erro não tratado:', error);
  res.status(500).json({ 
    success: false, 
    error: 'Erro interno do servidor' 
  });
});





// UI do modo universal (GET): /chat-universal-ui?url=<url>&robot=<nome>
app.get('/chat-universal-ui', async (req, res) => {
  const url = req.query.url;
  const robot = req.query.robot || '@assistente';
  if (!url) return res.status(400).send('Parâmetro url é obrigatório.');
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.send(generateUniversalHTML(url, robot));
});
// Rota Universal: respostas curtas e só com base no texto da página
app.post('/chat-universal', async (req, res) => {
  try {
    const { url, message } = req.body || {};
    if (!url || !message) {
      return res.status(400).json({ success: false, error: 'URL e mensagem são obrigatórias' });
    }
    const pageData = await extractPageData(url);
    const pageText = pageData.cleanText || [pageData.title, pageData.description, (pageData.benefits||[]).join('. ')].filter(Boolean).join('. ');
    const out = universalAnswer(pageText, message);

    return res.json({
      success: true,
      ...out,
      policy: {
        max_sentences: 3,
        max_bullets: 5,
        no_invention: true,
        not_found_message: NOT_FOUND_MSG
      }
    });
  } catch (e) {
    logger.error('Erro na rota chat-universal:', e);
    return res.status(500).json({ success: false, error: 'Erro interno do servidor' });
  }
});
// Iniciar servidor
app.listen(PORT, '0.0.0.0', () => {
  logger.info(`Servidor rodando na porta ${PORT}`);
  console.log(`🚀 LinkMágico Chatbot v5.0.1-SUPER-CORRIGIDO rodando na porta ${PORT}`);
  console.log(`📊 Extração SUPER REFINADA com Cheerio + Axios`);
  console.log(`🎯 Descrição e Preço muito mais precisos`);
  console.log(`🤖 IA SUPER INTELIGENTE com respostas contextuais`);
  console.log(`💬 Sistema de conversação com histórico`);
  console.log(`🔗 Acesse: http://localhost:${PORT}`);
});

module.exports = app;
