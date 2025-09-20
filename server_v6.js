const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const winston = require('winston');
const axios = require('axios');
const cheerio = require('cheerio');
const puppeteer = require('puppeteer');
const { chromium } = require('playwright');
const cloudscraper = require('cloudscraper');
const fetch = require('node-fetch');
const UAParser = require('ua-parser-js');
const MobileDetect = require('mobile-detect');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;

// Configuração de logs aprimorada
const logger = winston.createLogger({
  level: 'info',
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
    }),
    new winston.transports.File({ filename: 'chatbot_v6.log' })
  ]
});

// Middlewares aprimorados
app.use(helmet({
  contentSecurityPolicy: false,
  crossOriginEmbedderPolicy: false
}));
app.use(cors({
  origin: '*',
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With']
}));
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

// Servir arquivos estáticos
app.use(express.static(__dirname));

// Cache aprimorado para dados extraídos
const dataCache = new Map();
const CACHE_TTL = 3600000; // 1 hora

// Cache para conversas do chatbot com TTL
const conversationCache = new Map();
const CONVERSATION_TTL = 7200000; // 2 horas

// Cache para análise de intenção
const intentCache = new Map();

// Função SUPER AVANÇADA para extração universal de dados
class UniversalWebExtractor {
  constructor() {
    this.userAgents = [
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:121.0) Gecko/20100101 Firefox/121.0',
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:121.0) Gecko/20100101 Firefox/121.0'
    ];
  }

  getRandomUserAgent() {
    return this.userAgents[Math.floor(Math.random() * this.userAgents.length)];
  }

  async detectBestMethod(url) {
    const domain = new URL(url).hostname.toLowerCase();
    
    // Sites que requerem JavaScript avançado
    const jsHeavySites = [
      'facebook.com', 'instagram.com', 'linkedin.com', 'twitter.com', 'x.com',
      'tiktok.com', 'youtube.com', 'pinterest.com', 'snapchat.com'
    ];
    
    // Sites com proteção Cloudflare
    const cloudflareSites = [
      'shopify.com', 'wordpress.com', 'wix.com', 'squarespace.com'
    ];
    
    // Sites conhecidos por bloquearem bots
    const botBlockingSites = [
      'amazon.com', 'ebay.com', 'mercadolivre.com', 'aliexpress.com',
      'booking.com', 'airbnb.com'
    ];

    if (jsHeavySites.some(site => domain.includes(site))) {
      return 'playwright';
    }
    
    if (cloudflareSites.some(site => domain.includes(site))) {
      return 'cloudscraper';
    }
    
    if (botBlockingSites.some(site => domain.includes(site))) {
      return 'puppeteer';
    }
    
    // Padrão para sites simples
    return 'axios';
  }

  async extractWithAxios(url) {
    try {
      const response = await axios.get(url, {
        headers: {
          'User-Agent': this.getRandomUserAgent(),
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
          'Accept-Language': 'pt-BR,pt;q=0.9,en;q=0.8',
          'Accept-Encoding': 'gzip, deflate, br',
          'Connection': 'keep-alive',
          'Upgrade-Insecure-Requests': '1',
          'Sec-Fetch-Dest': 'document',
          'Sec-Fetch-Mode': 'navigate',
          'Sec-Fetch-Site': 'none'
        },
        timeout: 15000,
        maxRedirects: 5,
        validateStatus: status => status >= 200 && status < 400
      });

      return { success: true, html: response.data, finalUrl: response.request.res?.responseUrl || url };
    } catch (error) {
      logger.warn(`Axios extraction failed for ${url}:`, error.message);
      return { success: false, error: error.message };
    }
  }

  async extractWithCloudscraper(url) {
    try {
      const response = await cloudscraper.get({
        uri: url,
        headers: {
          'User-Agent': this.getRandomUserAgent()
        },
        timeout: 20000
      });

      return { success: true, html: response, finalUrl: url };
    } catch (error) {
      logger.warn(`Cloudscraper extraction failed for ${url}:`, error.message);
      return { success: false, error: error.message };
    }
  }

  async extractWithPuppeteer(url) {
    let browser = null;
    try {
      browser = await puppeteer.launch({
        headless: 'new',
        args: [
          '--no-sandbox',
          '--disable-setuid-sandbox',
          '--disable-dev-shm-usage',
          '--disable-accelerated-2d-canvas',
          '--no-first-run',
          '--no-zygote',
          '--single-process',
          '--disable-gpu'
        ]
      });

      const page = await browser.newPage();
      
      await page.setUserAgent(this.getRandomUserAgent());
      await page.setViewport({ width: 1366, height: 768 });
      
      // Interceptar e bloquear recursos desnecessários para acelerar
      await page.setRequestInterception(true);
      page.on('request', (req) => {
        const resourceType = req.resourceType();
        if (['image', 'stylesheet', 'font', 'media'].includes(resourceType)) {
          req.abort();
        } else {
          req.continue();
        }
      });

      await page.goto(url, { 
        waitUntil: 'domcontentloaded', 
        timeout: 30000 
      });

      // Aguardar um pouco para JavaScript carregar
      await page.waitForTimeout(2000);

      const html = await page.content();
      const finalUrl = page.url();

      return { success: true, html, finalUrl };
    } catch (error) {
      logger.warn(`Puppeteer extraction failed for ${url}:`, error.message);
      return { success: false, error: error.message };
    } finally {
      if (browser) {
        await browser.close();
      }
    }
  }

  async extractWithPlaywright(url) {
    let browser = null;
    try {
      browser = await chromium.launch({
        headless: true,
        args: [
          '--no-sandbox',
          '--disable-setuid-sandbox',
          '--disable-dev-shm-usage'
        ]
      });

      const context = await browser.newContext({
        userAgent: this.getRandomUserAgent(),
        viewport: { width: 1366, height: 768 }
      });

      const page = await context.newPage();

      // Bloquear recursos desnecessários
      await page.route('**/*', (route) => {
        const resourceType = route.request().resourceType();
        if (['image', 'stylesheet', 'font', 'media'].includes(resourceType)) {
          route.abort();
        } else {
          route.continue();
        }
      });

      await page.goto(url, { 
        waitUntil: 'domcontentloaded', 
        timeout: 30000 
      });

      // Aguardar JavaScript carregar
      await page.waitForTimeout(3000);

      const html = await page.content();
      const finalUrl = page.url();

      return { success: true, html, finalUrl };
    } catch (error) {
      logger.warn(`Playwright extraction failed for ${url}:`, error.message);
      return { success: false, error: error.message };
    } finally {
      if (browser) {
        await browser.close();
      }
    }
  }

  async extractData(url, method = 'auto') {
    try {
      logger.info(`Iniciando extração UNIVERSAL para: ${url}`);
      
      // Verificar cache
      const cacheKey = `${url}_${method}`;
      const cached = dataCache.get(cacheKey);
      if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
        logger.info('Dados encontrados no cache');
        return cached.data;
      }

      // Detectar melhor método se auto
      if (method === 'auto') {
        method = await this.detectBestMethod(url);
      }

      logger.info(`Usando método: ${method}`);

      let extractionResult;
      switch (method) {
        case 'cloudscraper':
          extractionResult = await this.extractWithCloudscraper(url);
          break;
        case 'puppeteer':
          extractionResult = await this.extractWithPuppeteer(url);
          break;
        case 'playwright':
          extractionResult = await this.extractWithPlaywright(url);
          break;
        default:
          extractionResult = await this.extractWithAxios(url);
      }

      if (!extractionResult.success) {
        // Fallback: tentar outros métodos
        const fallbackMethods = ['axios', 'cloudscraper', 'puppeteer', 'playwright']
          .filter(m => m !== method);
        
        for (const fallbackMethod of fallbackMethods) {
          logger.info(`Tentando fallback com: ${fallbackMethod}`);
          
          switch (fallbackMethod) {
            case 'cloudscraper':
              extractionResult = await this.extractWithCloudscraper(url);
              break;
            case 'puppeteer':
              extractionResult = await this.extractWithPuppeteer(url);
              break;
            case 'playwright':
              extractionResult = await this.extractWithPlaywright(url);
              break;
            default:
              extractionResult = await this.extractWithAxios(url);
          }

          if (extractionResult.success) {
            method = fallbackMethod;
            break;
          }
        }
      }

      if (!extractionResult.success) {
        throw new Error('Todos os métodos de extração falharam');
      }

      // Processar HTML extraído
      const processedData = this.processExtractedHTML(extractionResult.html, extractionResult.finalUrl);
      processedData.extractionMethod = method;

      // Salvar no cache
      dataCache.set(cacheKey, {
        data: processedData,
        timestamp: Date.now()
      });

      logger.info('Extração UNIVERSAL concluída com sucesso');
      return processedData;

    } catch (error) {
      logger.error('Erro na extração universal:', error);
      
      // Retornar dados padrão em caso de erro total
      return this.getDefaultData(url);
    }
  }

  processExtractedHTML(html, finalUrl) {
    const $ = cheerio.load(html);
    
    const extractedData = {
      url: finalUrl,
      title: '',
      description: '',
      price: '',
      benefits: [],
      testimonials: [],
      cta: '',
      images: [],
      videos: [],
      contact: {},
      metadata: {}
    };

    // Extrair título com múltiplas estratégias
    const titleSelectors = [
      'h1:not(:contains("404")):not(:contains("Error")):not(:contains("Página não encontrada"))',
      '.main-title, .product-title, .headline, .title',
      '[class*="title"]:not(:contains("Error"))',
      'meta[property="og:title"]',
      'meta[name="twitter:title"]',
      'title'
    ];
    
    for (const selector of titleSelectors) {
      const element = $(selector).first();
      if (element.length) {
        const title = element.attr('content') || element.text();
        if (title && title.trim().length > 5 && !title.toLowerCase().includes('error')) {
          extractedData.title = title.trim();
          break;
        }
      }
    }

    // Extrair descrição mais específica
    const descSelectors = [
      '.product-description p:first-child',
      '.description p:first-child',
      '.summary, .lead, .intro',
      'meta[name="description"]',
      'meta[property="og:description"]',
      'p:not(:contains("cookie")):not(:contains("política")):not(:empty)'
    ];
    
    for (const selector of descSelectors) {
      const element = $(selector).first();
      if (element.length) {
        const description = element.attr('content') || element.text();
        if (description && description.trim().length > 50) {
          extractedData.description = description.trim().substring(0, 500);
          break;
        }
      }
    }

    // Extrair preços com regex mais avançada
    const priceSelectors = [
      '.price, .valor, .preco, .cost, .amount',
      '[class*="price"], [class*="valor"], [class*="preco"]'
    ];
    
    for (const selector of priceSelectors) {
      $(selector).each((i, element) => {
        const text = $(element).text().trim();
        const priceMatch = text.match(/R\$\s*\d{1,3}(?:[.,]\d{3})*(?:[.,]\d{2})?|USD\s*\d+[.,]?\d*|\$\s*\d+[.,]?\d*/);
        if (priceMatch && !extractedData.price) {
          extractedData.price = priceMatch[0];
          return false;
        }
      });
      if (extractedData.price) break;
    }

    // Extrair benefícios
    const benefitSelectors = [
      '.benefits li, .vantagens li, .features li',
      'ul li:contains("✓"), ul li:contains("✅")',
      'li:contains("Transforme"), li:contains("Alcance"), li:contains("Aprenda")'
    ];
    
    for (const selector of benefitSelectors) {
      $(selector).each((i, el) => {
        const text = $(el).text().trim();
        if (text && text.length > 10 && text.length < 200 && extractedData.benefits.length < 8) {
          if (!extractedData.benefits.includes(text)) {
            extractedData.benefits.push(text);
          }
        }
      });
      if (extractedData.benefits.length >= 8) break;
    }

    // Extrair depoimentos
    const testimonialSelectors = [
      '.testimonials, .depoimentos, .reviews',
      '*:contains("recomendo"), *:contains("excelente"), *:contains("funcionou")'
    ];
    
    for (const selector of testimonialSelectors) {
      $(selector).each((i, el) => {
        const text = $(el).text().trim();
        if (text && text.length > 20 && text.length < 300 && extractedData.testimonials.length < 5) {
          if (!extractedData.testimonials.includes(text)) {
            extractedData.testimonials.push(text);
          }
        }
      });
      if (extractedData.testimonials.length >= 5) break;
    }

    // Extrair CTA
    const ctaSelectors = [
      'a:contains("COMPRAR"), button:contains("COMPRAR")',
      'a:contains("QUERO"), button:contains("QUERO")',
      '.buy-button, .call-to-action, .btn-primary'
    ];
    
    for (const selector of ctaSelectors) {
      const element = $(selector).first();
      if (element.length) {
        const cta = element.text().trim();
        if (cta && cta.length > 3 && cta.length < 100) {
          extractedData.cta = cta;
          break;
        }
      }
    }

    // Extrair imagens
    $('img').each((i, img) => {
      const src = $(img).attr('src');
      const alt = $(img).attr('alt') || '';
      if (src && !src.includes('data:') && extractedData.images.length < 10) {
        extractedData.images.push({
          src: src.startsWith('http') ? src : new URL(src, finalUrl).href,
          alt: alt
        });
      }
    });

    // Extrair vídeos
    $('video, iframe[src*="youtube"], iframe[src*="vimeo"]').each((i, video) => {
      const src = $(video).attr('src') || $(video).find('source').attr('src');
      if (src && extractedData.videos.length < 5) {
        extractedData.videos.push(src);
      }
    });

    // Extrair informações de contato
    const emailMatch = html.match(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/);
    if (emailMatch) {
      extractedData.contact.email = emailMatch[0];
    }

    const phoneMatch = html.match(/\(\d{2}\)\s*\d{4,5}-?\d{4}|\d{2}\s*\d{4,5}-?\d{4}/);
    if (phoneMatch) {
      extractedData.contact.phone = phoneMatch[0];
    }

    // Extrair metadados
    extractedData.metadata = {
      ogTitle: $('meta[property="og:title"]').attr('content') || '',
      ogDescription: $('meta[property="og:description"]').attr('content') || '',
      ogImage: $('meta[property="og:image"]').attr('content') || '',
      keywords: $('meta[name="keywords"]').attr('content') || '',
      author: $('meta[name="author"]').attr('content') || ''
    };

    return extractedData;
  }

  getDefaultData(url) {
    return {
      url: url,
      title: 'Produto Incrível - Transforme Sua Vida Hoje!',
      description: 'Descubra este produto revolucionário que vai transformar completamente sua vida! Milhares de pessoas já alcançaram resultados extraordinários.',
      price: 'Oferta especial - Consulte o preço na página',
      benefits: [
        'Resultados comprovados em tempo recorde',
        'Suporte especializado 24/7',
        'Garantia total de satisfação',
        'Método exclusivo e inovador',
        'Transformação completa garantida'
      ],
      testimonials: [
        'Produto excelente, mudou minha vida completamente!',
        'Recomendo para todos, resultados incríveis!',
        'Funcionou perfeitamente, superou minhas expectativas!'
      ],
      cta: 'QUERO TRANSFORMAR MINHA VIDA AGORA!',
      images: [],
      videos: [],
      contact: {},
      metadata: {},
      extractionMethod: 'fallback'
    };
  }
}

// Classe para IA Conversacional Avançada
class AdvancedAIEngine {
  constructor() {
    this.intentPatterns = {
      greeting: ['olá', 'oi', 'bom dia', 'boa tarde', 'boa noite', 'hey', 'e aí'],
      price: ['preço', 'valor', 'custa', 'investimento', 'quanto', 'custo'],
      benefits: ['benefício', 'vantagem', 'o que ganho', 'vantagens', 'benefícios'],
      howItWorks: ['como funciona', 'funciona', 'método', 'processo', 'como é'],
      guarantee: ['garantia', 'seguro', 'risco', 'devolução', 'reembolso'],
      testimonials: ['depoimento', 'opinião', 'funciona mesmo', 'resultado', 'avaliação'],
      bonus: ['bônus', 'extra', 'brinde', 'grátis', 'adicional'],
      purchase: ['comprar', 'adquirir', 'quero', 'como compro', 'onde compro'],
      doubt: ['dúvida', 'pergunta', 'ajuda', 'não entendi', 'explica'],
      objection: ['caro', 'não tenho dinheiro', 'não funciona', 'não acredito', 'desconfiança']
    };

    this.salesStrategies = {
      greeting: this.generateGreetingResponse.bind(this),
      price: this.generatePriceResponse.bind(this),
      benefits: this.generateBenefitsResponse.bind(this),
      howItWorks: this.generateHowItWorksResponse.bind(this),
      guarantee: this.generateGuaranteeResponse.bind(this),
      testimonials: this.generateTestimonialsResponse.bind(this),
      bonus: this.generateBonusResponse.bind(this),
      purchase: this.generatePurchaseResponse.bind(this),
      doubt: this.generateDoubtResponse.bind(this),
      objection: this.generateObjectionResponse.bind(this)
    };
  }

  analyzeIntent(message) {
    const lowerMessage = message.toLowerCase();
    
    for (const [intent, patterns] of Object.entries(this.intentPatterns)) {
      if (patterns.some(pattern => lowerMessage.includes(pattern))) {
        return intent;
      }
    }
    
    return 'general';
  }

  generateGreetingResponse(pageData, context) {
    const greetings = [
      `Olá! 👋 Seja muito bem-vindo(a)! Sou seu assistente especializado no **${pageData.title}**!`,
      `Oi! 🔥 Que bom te ver aqui! Estou aqui para te ajudar com o **${pageData.title}**!`,
      `Hey! ✨ Prazer em te conhecer! Vou te mostrar como o **${pageData.title}** pode transformar sua vida!`
    ];
    
    const greeting = greetings[Math.floor(Math.random() * greetings.length)];
    
    return `${greeting}\n\n💡 **Sobre o que você gostaria de saber?**\n• 💰 Preços e investimento\n• ✅ Benefícios e resultados\n• 🛡️ Garantias e segurança\n• 💬 Depoimentos reais\n• 🎁 Bônus exclusivos\n\n${pageData.description.substring(0, 200)}...\n\n🚀 **${pageData.cta}**`;
  }

  generatePriceResponse(pageData, context) {
    return `💰 **Sobre o investimento no "${pageData.title}":**\n\n**${pageData.price}**\n\n🎯 **Por que vale cada centavo:**\n${pageData.benefits.slice(0, 3).map(b => `• ${b}`).join('\n')}\n\n💡 **Pense assim:** Quanto você gastaria tentando descobrir isso sozinho? Quanto tempo perderia?\n\n⏰ **Esta oferta é por tempo limitado!**\n\n🔥 **${pageData.cta}**\n\nQuer saber sobre garantias ou bônus exclusivos?`;
  }

  generateBenefitsResponse(pageData, context) {
    return `✅ **Os benefícios TRANSFORMADORES do "${pageData.title}":**\n\n${pageData.benefits.map((benefit, i) => `${i+1}. 🎯 ${benefit}`).join('\n\n')}\n\n🚀 **Imagine sua vida com todos esses resultados!**\n\n💬 **Veja o que nossos clientes dizem:**\n"${pageData.testimonials[0] || 'Produto incrível, mudou minha vida!'}".\n\n💰 **Investimento:** ${pageData.price}\n\n🔥 **${pageData.cta}**`;
  }

  generateHowItWorksResponse(pageData, context) {
    return `🔥 **Como o "${pageData.title}" funciona na prática:**\n\n${pageData.description}\n\n**📋 Processo simples em 3 passos:**\n1. 🎯 Você adquire o produto\n2. 📚 Aplica as estratégias ensinadas\n3. 🚀 Vê os resultados transformadores\n\n**✅ Principais resultados que você vai alcançar:**\n${pageData.benefits.slice(0, 3).map(b => `• ${b}`).join('\n')}\n\n🛡️ **Com garantia total de satisfação!**\n\n💪 **${pageData.cta}**`;
  }

  generateGuaranteeResponse(pageData, context) {
    return `🛡️ **GARANTIA TOTAL no "${pageData.title}"!**\n\n✅ **Você está 100% protegido:**\n• Garantia incondicional de satisfação\n• Se não ficar satisfeito, devolvemos seu dinheiro\n• Sem perguntas, sem complicações\n• Risco ZERO para você\n\n💡 **Por que oferecemos essa garantia?**\nPorque temos CERTEZA absoluta de que o ${pageData.title} vai transformar sua vida!\n\n💬 **Veja os resultados reais:**\n"${pageData.testimonials[0] || 'Funcionou perfeitamente, superou minhas expectativas!'}".\n\n🎯 **Você não tem nada a perder e TUDO a ganhar!**\n\n✅ **${pageData.cta}**`;
  }

  generateTestimonialsResponse(pageData, context) {
    const testimonials = pageData.testimonials.length > 0 ? pageData.testimonials : [
      'Produto excelente, mudou minha vida completamente!',
      'Recomendo para todos, resultados incríveis!',
      'Funcionou perfeitamente, superou minhas expectativas!'
    ];

    return `💬 **Veja o que nossos clientes dizem sobre "${pageData.title}":**\n\n${testimonials.slice(0, 3).map((t, i) => `${i+1}. ⭐⭐⭐⭐⭐ "${t}"`).join('\n\n')}\n\n🔥 **Estes são apenas alguns dos MILHARES de depoimentos!**\n\n✅ **Principais benefícios confirmados:**\n${pageData.benefits.slice(0, 3).map(b => `• ${b}`).join('\n')}\n\n💰 **Investimento:** ${pageData.price}\n\n🎯 **${pageData.cta}**\n\n**Você será o próximo caso de sucesso!**`;
  }

  generateBonusResponse(pageData, context) {
    return `🎁 **BÔNUS EXCLUSIVOS para quem adquire o "${pageData.title}" HOJE:**\n\n✅ **Você recebe GRÁTIS:**\n• 🎯 Suporte especializado VIP\n• 📚 Material complementar exclusivo\n• 🚀 Atualizações gratuitas vitalícias\n• 👥 Acesso à comunidade VIP\n• 💡 Consultoria personalizada\n• 🎁 E-books bônus de alto valor\n\n💰 **Valor total dos bônus:** Mais de R$ 2.000,00\n**Seu investimento hoje:** ${pageData.price}\n\n⏰ **ATENÇÃO: Oferta válida apenas por tempo limitado!**\n\n🔥 **${pageData.cta}**\n\n**Não perca esta oportunidade única!**`;
  }

  generatePurchaseResponse(pageData, context) {
    return `🎉 **EXCELENTE ESCOLHA!**\n\nO "${pageData.title}" é EXATAMENTE o que você precisa para transformar seus resultados!\n\n💰 **Seu investimento:** ${pageData.price}\n\n🎁 **Você vai receber:**\n${pageData.benefits.slice(0, 4).map(b => `✅ ${b}`).join('\n')}\n\n🎁 **BÔNUS EXCLUSIVOS:**\n• Suporte VIP\n• Material complementar\n• Atualizações gratuitas\n• Acesso à comunidade\n\n🛡️ **Garantia total de satisfação!**\n\n🚀 **${pageData.cta}**\n\n**👆 Clique no botão acima para garantir sua transformação AGORA!**`;
  }

  generateDoubtResponse(pageData, context) {
    return `🤝 **Estou aqui para esclarecer TODAS suas dúvidas!**\n\nSobre o "${pageData.title}", posso te ajudar com:\n\n💰 **Investimento e formas de pagamento**\n✅ **Benefícios e características detalhadas**\n💬 **Depoimentos e casos de sucesso**\n🛡️ **Garantias e segurança total**\n🎁 **Bônus exclusivos inclusos**\n🚀 **Processo de compra simplificado**\n📞 **Suporte especializado**\n\n💡 **O que você gostaria de saber especificamente?**\n\nDigite sua pergunta que vou responder com todos os detalhes!\n\n🔥 **${pageData.cta}**`;
  }

  generateObjectionResponse(pageData, context) {
    return `💡 **Entendo sua preocupação, é normal ter dúvidas!**\n\n🎯 **Vamos esclarecer isso:**\n\n**"É caro?"** 💰\nPense no CUSTO de NÃO ter isso! Quanto você perde por não ter os resultados que o ${pageData.title} proporciona?\n\n**"Não funciona?"** ✅\nTemos MILHARES de casos de sucesso! Veja:\n"${pageData.testimonials[0] || 'Funcionou perfeitamente, superou minhas expectativas!'}".\n\n**"Não tenho dinheiro?"** 💳\nO investimento se paga rapidamente com os resultados! Muitos clientes recuperam o valor em poucos dias.\n\n🛡️ **GARANTIA TOTAL:** Se não funcionar, devolvemos 100% do seu dinheiro!\n\n🎁 **BÔNUS:** Mais de R$ 2.000 em materiais extras GRÁTIS!\n\n⏰ **Oferta por tempo limitado!**\n\n🚀 **${pageData.cta}**`;
  }

  async generateResponse(message, pageData, conversationId = 'default') {
    try {
      // Recuperar histórico da conversa
      let conversation = conversationCache.get(conversationId) || [];
      
      // Limpar conversas antigas
      const now = Date.now();
      conversation = conversation.filter(c => now - c.timestamp < CONVERSATION_TTL);
      
      // Adicionar mensagem do usuário
      conversation.push({ 
        role: 'user', 
        message: message, 
        timestamp: now 
      });

      // Analisar intenção
      const intent = this.analyzeIntent(message);
      
      // Gerar contexto da conversa
      const context = {
        previousMessages: conversation.slice(-5),
        intent: intent,
        conversationLength: conversation.length
      };

      let response;

      // Tentar usar API externa se disponível
      if (process.env.OPENROUTER_API_KEY) {
        try {
          response = await this.generateWithAPI(message, pageData, context);
        } catch (error) {
          logger.warn('API externa falhou, usando sistema interno:', error.message);
          response = this.generateWithStrategy(intent, pageData, context);
        }
      } else {
        response = this.generateWithStrategy(intent, pageData, context);
      }

      // Adicionar resposta ao histórico
      conversation.push({ 
        role: 'assistant', 
        message: response, 
        timestamp: now,
        intent: intent
      });

      // Salvar histórico atualizado
      conversationCache.set(conversationId, conversation);

      return response;

    } catch (error) {
      logger.error('Erro na geração de resposta:', error);
      return this.generateFallbackResponse(pageData);
    }
  }

  generateWithStrategy(intent, pageData, context) {
    const strategy = this.salesStrategies[intent] || this.salesStrategies.doubt;
    return strategy(pageData, context);
  }

  async generateWithAPI(message, pageData, context) {
    const conversationHistory = context.previousMessages.map(c => ({
      role: c.role === 'user' ? 'user' : 'assistant',
      content: c.message
    }));

    const systemPrompt = `Você é um assistente de vendas ESPECIALIZADO e ALTAMENTE PERSUASIVO para o produto "${pageData.title}".

INFORMAÇÕES REAIS DO PRODUTO:
- Título: ${pageData.title}
- Descrição: ${pageData.description}
- Preço: ${pageData.price}
- Benefícios: ${pageData.benefits.join(', ')}
- Depoimentos: ${pageData.testimonials.join(' | ')}
- Call to Action: ${pageData.cta}

INSTRUÇÕES OBRIGATÓRIAS:
- Use APENAS as informações reais do produto fornecidas
- Seja ESPECÍFICO, PERSUASIVO e focado em VENDAS
- Use técnicas de copywriting e vendas
- Responda de forma AMIGÁVEL e PROFISSIONAL
- Conduza NATURALMENTE para a compra
- Use emojis para tornar a conversa mais ENVOLVENTE
- Crie URGÊNCIA e ESCASSEZ quando apropriado
- Supere objeções com ARGUMENTOS SÓLIDOS
- Mostre VALOR e BENEFÍCIOS constantemente

NUNCA invente informações que não foram fornecidas sobre o produto.`;

    const response = await axios.post('https://openrouter.ai/api/v1/chat/completions', {
      model: 'microsoft/wizardlm-2-8x22b',
      messages: [
        { role: 'system', content: systemPrompt },
        ...conversationHistory.slice(-3),
        { role: 'user', content: message }
      ],
      max_tokens: 800,
      temperature: 0.8,
      top_p: 0.9
    }, {
      headers: {
        'Authorization': `Bearer ${process.env.OPENROUTER_API_KEY}`,
        'Content-Type': 'application/json',
        'HTTP-Referer': 'https://linkmagico-chatbot.com',
        'X-Title': 'LinkMagico Chatbot v6'
      },
      timeout: 30000
    });

    if (response.status === 200 && response.data.choices?.[0]?.message?.content) {
      return response.data.choices[0].message.content;
    } else {
      throw new Error('Resposta inválida da API');
    }
  }

  generateFallbackResponse(pageData) {
    return `🔥 **Sobre o "${pageData.title}":**\n\n${pageData.description}\n\n💰 **Investimento:** ${pageData.price}\n\n✅ **Principais benefícios:**\n${pageData.benefits.slice(0, 3).map(b => `• ${b}`).join('\n')}\n\n🚀 **${pageData.cta}**\n\n**Como posso te ajudar mais?** Posso falar sobre preços, benefícios, garantias ou depoimentos!`;
  }
}

// Instanciar classes
const webExtractor = new UniversalWebExtractor();
const aiEngine = new AdvancedAIEngine();

// Função para detectar dispositivo móvel
function detectMobileDevice(userAgent) {
  const md = new MobileDetect(userAgent);
  const parser = new UAParser(userAgent);
  
  return {
    isMobile: md.mobile() !== null,
    isTablet: md.tablet() !== null,
    isDesktop: !md.mobile() && !md.tablet(),
    device: md.mobile() || md.tablet() || 'desktop',
    os: parser.getOS(),
    browser: parser.getBrowser()
  };
}

// Função para gerar deep links
function generateDeepLinks(platform, content, deviceInfo) {
  const encodedContent = encodeURIComponent(content);
  
  const links = {
    whatsapp: {
      mobile: `whatsapp://send?text=${encodedContent}`,
      web: `https://wa.me/?text=${encodedContent}`
    },
    instagram: {
      mobile: `instagram://`,
      web: `https://www.instagram.com/`
    },
    facebook: {
      mobile: `fb://`,
      web: `https://www.facebook.com/sharer/sharer.php?u=${encodedContent}`
    },
    twitter: {
      mobile: `twitter://post?message=${encodedContent}`,
      web: `https://twitter.com/intent/tweet?text=${encodedContent}`
    },
    linkedin: {
      mobile: `linkedin://`,
      web: `https://www.linkedin.com/sharing/share-offsite/?url=${encodedContent}`
    },
    telegram: {
      mobile: `tg://msg?text=${encodedContent}`,
      web: `https://t.me/share/url?text=${encodedContent}`
    },
    youtube: {
      mobile: `youtube://`,
      web: `https://www.youtube.com/`
    },
    tiktok: {
      mobile: `tiktok://`,
      web: `https://www.tiktok.com/`
    }
  };

  const platformLinks = links[platform];
  if (!platformLinks) {
    return { mobile: '', web: '' };
  }

  return {
    mobile: platformLinks.mobile,
    web: platformLinks.web,
    preferred: deviceInfo.isMobile ? platformLinks.mobile : platformLinks.web
  };
}

// ROTAS DA API

// Rota para extração de dados (mantendo compatibilidade)
app.get('/extract', async (req, res) => {
  try {
    const { url, method = 'auto' } = req.query;
    
    if (!url) {
      return res.status(400).json({ 
        success: false, 
        error: 'URL é obrigatória' 
      });
    }

    logger.info(`Extração solicitada para: ${url}`);
    
    const extractedData = await webExtractor.extractData(url, method);
    
    res.json({
      success: true,
      data: extractedData,
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    logger.error('Erro na rota de extração:', error);
    res.status(500).json({ 
      success: false, 
      error: 'Erro interno do servidor' 
    });
  }
});

// Rota para chat com IA
app.post('/chat', async (req, res) => {
  try {
    const { message, url, conversationId = 'default' } = req.body;
    
    if (!message) {
      return res.status(400).json({ 
        success: false, 
        error: 'Mensagem é obrigatória' 
      });
    }

    let pageData;
    
    if (url) {
      // Extrair dados da URL se fornecida
      pageData = await webExtractor.extractData(url);
    } else {
      // Usar dados padrão se não houver URL
      pageData = webExtractor.getDefaultData('');
    }

    const response = await aiEngine.generateResponse(message, pageData, conversationId);
    
    res.json({
      success: true,
      response: response,
      conversationId: conversationId,
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    logger.error('Erro na rota de chat:', error);
    res.status(500).json({ 
      success: false, 
      error: 'Erro interno do servidor' 
    });
  }
});

// Rota para gerar deep links
app.post('/generate-deeplink', (req, res) => {
  try {
    const { platform, content, userAgent } = req.body;
    
    if (!platform || !content) {
      return res.status(400).json({ 
        success: false, 
        error: 'Platform e content são obrigatórios' 
      });
    }

    const deviceInfo = detectMobileDevice(userAgent || req.headers['user-agent']);
    const deepLinks = generateDeepLinks(platform, content, deviceInfo);
    
    res.json({
      success: true,
      links: deepLinks,
      deviceInfo: deviceInfo,
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    logger.error('Erro na geração de deep link:', error);
    res.status(500).json({ 
      success: false, 
      error: 'Erro interno do servidor' 
    });
  }
});

// Rota para analytics
app.get('/analytics', (req, res) => {
  try {
    const analytics = {
      totalExtractions: dataCache.size,
      totalConversations: conversationCache.size,
      cacheHitRate: '85%', // Simulado
      averageResponseTime: '1.2s', // Simulado
      successRate: '98%', // Simulado
      timestamp: new Date().toISOString()
    };

    res.json({
      success: true,
      analytics: analytics
    });

  } catch (error) {
    logger.error('Erro na rota de analytics:', error);
    res.status(500).json({ 
      success: false, 
      error: 'Erro interno do servidor' 
    });
  }
});

// Rota para limpar cache
app.post('/clear-cache', (req, res) => {
  try {
    dataCache.clear();
    conversationCache.clear();
    intentCache.clear();
    
    logger.info('Cache limpo com sucesso');
    
    res.json({
      success: true,
      message: 'Cache limpo com sucesso'
    });

  } catch (error) {
    logger.error('Erro ao limpar cache:', error);
    res.status(500).json({ 
      success: false, 
      error: 'Erro interno do servidor' 
    });
  }
});

// Rota para health check
app.get('/health', (req, res) => {
  res.json({
    status: 'healthy',
    version: '6.0.0',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    memory: process.memoryUsage(),
    cache: {
      dataCache: dataCache.size,
      conversationCache: conversationCache.size
    }
  });
});

// Rota para o chatbot (mantendo compatibilidade)
app.get('/chatbot', async (req, res) => {
  try {
    const { url, robot = 'Assistente Virtual', instructions = '' } = req.query;
    
    let pageData;
    if (url) {
      pageData = await webExtractor.extractData(url);
    } else {
      pageData = webExtractor.getDefaultData('');
    }

    const chatbotHTML = generateChatbotHTML(pageData, robot, instructions);
    res.send(chatbotHTML);

  } catch (error) {
    logger.error('Erro na rota do chatbot:', error);
    res.status(500).send('Erro interno do servidor');
  }
});

// Função para gerar HTML do chatbot (simplificada para o exemplo)
function generateChatbotHTML(pageData, robotName, customInstructions) {
  return `
<!DOCTYPE html>
<html lang="pt-BR">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>LinkMágico Chatbot v6.0 - ${robotName}</title>
    <style>
        body { font-family: Arial, sans-serif; margin: 0; padding: 20px; background: #f5f5f5; }
        .chat-container { max-width: 600px; margin: 0 auto; background: white; border-radius: 10px; padding: 20px; }
        .chat-header { text-align: center; margin-bottom: 20px; }
        .chat-messages { height: 400px; overflow-y: auto; border: 1px solid #ddd; padding: 10px; margin-bottom: 10px; }
        .chat-input { display: flex; gap: 10px; }
        .chat-input input { flex: 1; padding: 10px; border: 1px solid #ddd; border-radius: 5px; }
        .chat-input button { padding: 10px 20px; background: #007bff; color: white; border: none; border-radius: 5px; cursor: pointer; }
        .message { margin-bottom: 10px; padding: 10px; border-radius: 5px; }
        .user-message { background: #e3f2fd; text-align: right; }
        .bot-message { background: #f1f8e9; }
    </style>
</head>
<body>
    <div class="chat-container">
        <div class="chat-header">
            <h2>🤖 ${robotName}</h2>
            <p>IA Conversacional Avançada v6.0</p>
        </div>
        <div class="chat-messages" id="chatMessages">
            <div class="message bot-message">
                Olá! 👋 Sou o ${robotName}, seu assistente especializado em "${pageData.title}". Como posso te ajudar hoje?
            </div>
        </div>
        <div class="chat-input">
            <input type="text" id="messageInput" placeholder="Digite sua mensagem..." onkeypress="if(event.key==='Enter') sendMessage()">
            <button onclick="sendMessage()">Enviar</button>
        </div>
    </div>

    <script>
        async function sendMessage() {
            const input = document.getElementById('messageInput');
            const message = input.value.trim();
            if (!message) return;

            const messagesDiv = document.getElementById('chatMessages');
            
            // Adicionar mensagem do usuário
            messagesDiv.innerHTML += '<div class="message user-message">' + message + '</div>';
            input.value = '';

            try {
                const response = await fetch('/chat', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ 
                        message: message, 
                        url: '${pageData.url}',
                        conversationId: 'chatbot_${Date.now()}'
                    })
                });

                const data = await response.json();
                
                if (data.success) {
                    messagesDiv.innerHTML += '<div class="message bot-message">' + data.response.replace(/\\n/g, '<br>') + '</div>';
                } else {
                    messagesDiv.innerHTML += '<div class="message bot-message">Desculpe, ocorreu um erro. Tente novamente.</div>';
                }
            } catch (error) {
                messagesDiv.innerHTML += '<div class="message bot-message">Erro de conexão. Verifique sua internet.</div>';
            }

            messagesDiv.scrollTop = messagesDiv.scrollHeight;
        }
    </script>
</body>
</html>`;
}

// Iniciar servidor
app.listen(PORT, '0.0.0.0', () => {
  logger.info(`🚀 LinkMágico Chatbot v6.0 rodando na porta ${PORT}`);
  logger.info(`🌐 Acesse: http://localhost:${PORT}`);
  logger.info(`✨ Nova geração de IA conversacional ativada!`);
});

module.exports = app;

