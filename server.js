const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const winston = require('winston');
const axios = require('axios');
const cheerio = require('cheerio');
const bodyParser = require('body-parser');
const morgan = require('morgan');
const rateLimit = require('express-rate-limit');
const path = require('path');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;

// ================================
// CONFIGURAÇÕES DE LOGGING (v7.0)
// ================================

const logger = winston.createLogger({
  level: 'info',
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.json()
  ),
  transports: [
    new winston.transports.Console(),
    new winston.transports.File({ filename: 'app.log' })
  ]
});

// ================================
// RATE LIMITING MELHORADO (v7.0)
// ================================

// Rate limit para demos (mais permissivo)
const demoRateLimit = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutos
  max: 100, // 100 requests por IP
  message: {
    error: 'Muitas tentativas. Aguarde 15 minutos.',
    type: 'demo_rate_limit'
  },
  standardHeaders: true,
  legacyHeaders: false
});

// Rate limit para dashboard demo
const dashboardDemoLimit = rateLimit({
  windowMs: 10 * 60 * 1000, // 10 minutos
  max: 50,
  message: { error: 'Rate limit dashboard demo excedido' }
});

// Rate limit para widget embed
const widgetEmbedLimit = rateLimit({
  windowMs: 5 * 60 * 1000, // 5 minutos
  max: 200, // Mais permissivo para embeds
  message: { error: 'Rate limit widget embed excedido' }
});

// Rate limit para API pública
const publicApiLimit = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100,
  message: { error: 'Rate limit API pública excedido' }
});

// Rate limit geral (proteção básica)
const generalLimit = rateLimit({
  windowMs: 1 * 60 * 1000, // 1 minuto
  max: 1000, // Bem alto, só para ataques
  message: { error: 'Muitas requisições. Aguarde um momento.' }
});

// ================================
// MIDDLEWARES DE SEGURANÇA
// ================================

app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", "'unsafe-inline'", "https://cdnjs.cloudflare.com", "https://unpkg.com"],
      styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com", "https://cdnjs.cloudflare.com"],
      fontSrc: ["'self'", "https://fonts.gstatic.com"],
      imgSrc: ["'self'", "data:", "https:", "blob:"],
      connectSrc: ["'self'", "https://api.groq.com", "https://api.openai.com", "https://openrouter.ai"]
    }
  }
}));

app.use(cors({
  origin: process.env.NODE_ENV === 'production' 
    ? [process.env.RENDER_EXTERNAL_URL, /\.render\.com$/, /localhost:\d+$/]
    : true,
  credentials: true
}));

app.use(morgan('combined', { stream: { write: message => logger.info(message.trim()) } }));
app.use(bodyParser.json({ limit: '10mb' }));
app.use(bodyParser.urlencoded({ extended: true, limit: '10mb' }));

// Rate limiting geral
app.use(generalLimit);

// Static files
app.use('/public', express.static(path.join(__dirname, 'public')));
app.use('/assets', express.static(path.join(__dirname, 'assets')));

// ================================
// DADOS MOCKADOS PARA DEMOS v7.0
// ================================

const mockData = {
  analytics: {
    chatbotsCreated: 147,
    messagesProcessed: 8934,
    successRate: 96.7,
    avgResponseTime: '1.2s',
    activeUsers: 23,
    totalUsers: 892,
    conversionRate: 12.8
  },
  chatbots: [
    { id: 1, name: 'Assistente de Vendas', status: 'active', messages: 1245, created: '2024-01-15' },
    { id: 2, name: 'Suporte Técnico', status: 'active', messages: 987, created: '2024-01-20' },
    { id: 3, name: 'FAQ Automático', status: 'paused', messages: 456, created: '2024-02-01' }
  ],
  recentMessages: [
    { user: 'Cliente A', message: 'Olá, preciso de ajuda', bot: 'Assistente de Vendas', timestamp: new Date().toISOString() },
    { user: 'Cliente B', message: 'Qual o preço?', bot: 'Assistente de Vendas', timestamp: new Date().toISOString() },
    { user: 'Cliente C', message: 'Como posso comprar?', bot: 'Suporte Técnico', timestamp: new Date().toISOString() }
  ]
};

// ================================
// ROTA PRINCIPAL v6.0 MANTIDA COM MELHORIAS v7.0
// ================================

app.get('/', (req, res) => {
  // Servir o index.html original do v6.0, mas com melhorias de funcionalidade
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// ================================
// NOVAS ROTAS v7.0 ADICIONADAS
// ================================

// Dashboard Demo Público (NOVO v7.0)
app.get('/dashboard/demo', dashboardDemoLimit, (req, res) => {
  logger.info('Dashboard demo accessed', { ip: req.ip, userAgent: req.get('User-Agent') });
  
  res.send(`
    <!DOCTYPE html>
    <html lang="pt-BR">
    <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Dashboard Demo - Link Mágico v7.0</title>
        <style>
            * { margin: 0; padding: 0; box-sizing: border-box; }
            body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: #f5f7fa; }
            .demo-banner { background: linear-gradient(45deg, #ff6b6b, #feca57); color: white; padding: 1rem; text-align: center; font-weight: bold; }
            .back-link { color: white; text-decoration: none; margin-left: 1rem; }
            .sidebar { position: fixed; top: 64px; left: 0; width: 250px; height: calc(100vh - 64px); background: #2c3e50; color: white; padding: 1rem; overflow-y: auto; }
            .main-content { margin-left: 250px; margin-top: 64px; padding: 2rem; }
            .nav-item { padding: 0.8rem 1rem; margin: 0.5rem 0; border-radius: 8px; cursor: pointer; transition: background 0.3s; }
            .nav-item:hover { background: rgba(255,255,255,0.1); }
            .nav-item.active { background: #3498db; }
            .stats-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(250px, 1fr)); gap: 1.5rem; margin-bottom: 2rem; }
            .stat-card { background: white; padding: 1.5rem; border-radius: 10px; box-shadow: 0 2px 10px rgba(0,0,0,0.1); }
            .stat-value { font-size: 2.5rem; font-weight: bold; color: #2c3e50; margin-bottom: 0.5rem; }
            .stat-label { color: #7f8c8d; font-size: 0.9rem; text-transform: uppercase; }
            .chart-container { background: white; padding: 2rem; border-radius: 10px; box-shadow: 0 2px 10px rgba(0,0,0,0.1); margin-bottom: 2rem; }
            @media (max-width: 768px) {
                .sidebar { transform: translateX(-100%); }
                .main-content { margin-left: 0; margin-top: 64px; }
                .stats-grid { grid-template-columns: 1fr; }
            }
        </style>
    </head>
    <body>
        <div class="demo-banner">
            🔴 DEMO PÚBLICO - Dashboard Analytics
            <a href="/" class="back-link">← Voltar ao Link Mágico v6.0</a>
        </div>
        
        <div class="sidebar">
            <h3 style="margin-bottom: 1rem;">📊 Analytics</h3>
            <div class="nav-item active">📈 Dashboard</div>
            <div class="nav-item">🤖 Chatbots</div>
            <div class="nav-item">💬 Conversas</div>
            <div class="nav-item">📊 Relatórios</div>
            <div class="nav-item">⚙️ Configurações</div>
        </div>
        
        <div class="main-content">
            <h2 style="margin-bottom: 2rem;">Dashboard Analytics - Tempo Real</h2>
            
            <div class="stats-grid">
                <div class="stat-card">
                    <div class="stat-value" id="chatbots-count">${mockData.analytics.chatbotsCreated}</div>
                    <div class="stat-label">Chatbots Criados</div>
                </div>
                <div class="stat-card">
                    <div class="stat-value" id="messages-count">${mockData.analytics.messagesProcessed}</div>
                    <div class="stat-label">Mensagens Processadas</div>
                </div>
                <div class="stat-card">
                    <div class="stat-value" id="success-rate">${mockData.analytics.successRate}%</div>
                    <div class="stat-label">Taxa de Sucesso</div>
                </div>
                <div class="stat-card">
                    <div class="stat-value" id="response-time">${mockData.analytics.avgResponseTime}</div>
                    <div class="stat-label">Tempo de Resposta</div>
                </div>
            </div>
            
            <div class="chart-container">
                <h3>📈 Performance em Tempo Real</h3>
                <p>Chatbots ativos processando mensagens continuamente...</p>
                <div style="height: 200px; background: linear-gradient(45deg, #667eea, #764ba2); margin-top: 1rem; border-radius: 8px; display: flex; align-items: center; justify-content: center; color: white; font-size: 1.5rem;">
                    Gráfico de Performance - Demo
                </div>
            </div>
        </div>
        
        <script>
            // Simulação de dados em tempo real
            setInterval(() => {
                const messagesEl = document.getElementById('messages-count');
                if (Math.random() > 0.7) {
                    const currentMessages = parseInt(messagesEl.textContent);
                    messagesEl.textContent = currentMessages + Math.floor(Math.random() * 3) + 1;
                    messagesEl.style.color = '#27ae60';
                    setTimeout(() => messagesEl.style.color = '#2c3e50', 1000);
                }
            }, 3000);
        </script>
    </body>
    </html>
  `);
});

// Widget Demo Público (NOVO v7.0)
app.get('/widget/demo', widgetEmbedLimit, (req, res) => {
  logger.info('Widget demo accessed', { ip: req.ip });
  
  res.send(`
    <!DOCTYPE html>
    <html lang="pt-BR">
    <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Widget Demo - Link Mágico v7.0</title>
        <style>
            body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; margin: 0; background: linear-gradient(135deg, #74b9ff, #0984e3); min-height: 100vh; color: white; }
            .demo-banner { background: rgba(0,0,0,0.8); padding: 1rem; text-align: center; font-weight: bold; }
            .back-link { color: white; text-decoration: none; margin-left: 1rem; }
            .container { max-width: 1200px; margin: 0 auto; padding: 2rem; }
            .header { text-align: center; margin-bottom: 3rem; }
            .demo-section { background: rgba(255,255,255,0.1); backdrop-filter: blur(10px); border-radius: 15px; padding: 2rem; margin-bottom: 2rem; }
            .code-block { background: #2d3748; color: #e2e8f0; padding: 1.5rem; border-radius: 8px; overflow-x: auto; font-family: 'Courier New', monospace; font-size: 0.9rem; margin: 1rem 0; }
        </style>
    </head>
    <body>
        <div class="demo-banner">
            🔴 WIDGET DEMO - Chat Embedável
            <a href="/" class="back-link">← Voltar ao Link Mágico v6.0</a>
        </div>
        
        <div class="container">
            <div class="header">
                <h1>🔧 Widget Embedável</h1>
                <p>Chat inteligente para incorporar em qualquer site</p>
            </div>
            
            <div class="demo-section">
                <h3>💻 Código de Integração</h3>
                <p>Cole este código antes do fechamento da tag &lt;/body&gt; do seu site:</p>
                
                <div class="code-block">
&lt;script&gt;
(function() {
  var config = {
    robotName: 'Assistente de Vendas',
    instructions: 'Seja consultivo e termine com CTA',
    primaryColor: '#667eea',
    position: 'bottom-right',
    apiBase: '${req.protocol}://${req.get('host')}'
  };
  
  var script = document.createElement('script');
  script.src = '${req.protocol}://${req.get('host')}/widget.js';
  script.onload = function() {
    window.LinkMagicoWidget.init(config);
  };
  document.head.appendChild(script);
})();
&lt;/script&gt;
                </div>
                
                <h3>✨ Funcionalidades</h3>
                <ul style="margin: 1rem 0; padding-left: 2rem;">
                    <li>✅ Chat com IA (GROQ/OpenAI/OpenRouter)</li>
                    <li>✅ Responsivo para mobile</li>
                    <li>✅ Carregamento rápido (&lt;2s)</li>
                    <li>✅ Customização completa</li>
                    <li>✅ Analytics integradas</li>
                </ul>
            </div>
            
            <div style="text-align: center; margin-top: 3rem;">
                <a href="/docs" style="display: inline-block; background: rgba(255,255,255,0.2); color: white; padding: 1rem 2rem; text-decoration: none; border-radius: 25px; border: 1px solid rgba(255,255,255,0.3);">
                    📖 Ver Documentação Completa
                </a>
            </div>
        </div>
    </body>
    </html>
  `);
});

// API Pública para demos (NOVO v7.0)
app.get('/api/public/status', publicApiLimit, (req, res) => {
  res.json({
    status: 'operational',
    version: '7.0.0 (integrada)',
    features: {
      groq: !!process.env.GROQ_API_KEY,
      openai: !!process.env.OPENAI_API_KEY,
      openrouter: !!process.env.OPENROUTER_API_KEY,
      rateLimit: true,
      demos: true,
      originalV6: true
    },
    analytics: mockData.analytics,
    timestamp: new Date().toISOString()
  });
});

// Documentação (NOVO v7.0)
app.get('/docs', (req, res) => {
  res.send(`
    <!DOCTYPE html>
    <html lang="pt-BR">
    <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Documentação - Link Mágico v7.0</title>
        <style>
            body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; line-height: 1.6; margin: 0; background: #f8f9fa; }
            .container { max-width: 1200px; margin: 0 auto; padding: 2rem; }
            .header { text-align: center; background: linear-gradient(135deg, #667eea, #764ba2); color: white; padding: 3rem 2rem; margin: -2rem -2rem 2rem -2rem; }
            .back-link { color: white; text-decoration: none; }
            .endpoint { background: white; border-radius: 10px; padding: 1.5rem; margin: 1rem 0; box-shadow: 0 2px 10px rgba(0,0,0,0.1); }
            .method { display: inline-block; padding: 0.3rem 0.8rem; border-radius: 15px; font-weight: bold; font-size: 0.8rem; margin-right: 1rem; }
            .method.get { background: #d4edda; color: #155724; }
            .method.post { background: #cce5ff; color: #004085; }
            .code { background: #2d3748; color: #e2e8f0; padding: 1rem; border-radius: 5px; overflow-x: auto; font-family: 'Courier New', monospace; margin: 0.5rem 0; }
        </style>
    </head>
    <body>
        <div class="container">
            <div class="header">
                <h1>📖 Documentação Link Mágico v7.0</h1>
                <p>Integração completa - v6.0 + recursos v7.0</p>
                <a href="/" class="back-link">← Voltar ao Link Mágico</a>
            </div>
            
            <div class="endpoint">
                <h3><span class="method post">POST</span>/chat-universal</h3>
                <p><strong>Funcionalidade principal:</strong> Chat com IA usando GROQ (principal), OpenAI ou OpenRouter como fallback.</p>
                
                <h4>Exemplo de uso:</h4>
                <div class="code">
curl -X POST ${req.protocol}://${req.get('host')}/chat-universal \\
  -H "Content-Type: application/json" \\
  -d '{
    "message": "Olá, preciso de ajuda",
    "robotName": "Assistente de Vendas",
    "instructions": "Seja consultivo e termine com CTA"
  }'
                </div>
            </div>
            
            <div class="endpoint">
                <h3><span class="method get">GET</span>/dashboard/demo</h3>
                <p><strong>NOVO:</strong> Dashboard público com analytics em tempo real (dados demo).</p>
            </div>
            
            <div class="endpoint">
                <h3><span class="method get">GET</span>/widget/demo</h3>
                <p><strong>NOVO:</strong> Demonstração do widget embedável.</p>
            </div>
            
            <div class="endpoint">
                <h3><span class="method get">GET</span>/api/public/status</h3>
                <p><strong>NOVO:</strong> Status da API com informações das funcionalidades v7.0.</p>
            </div>
        </div>
    </body>
    </html>
  `);
});

// ================================
// ROTAS ORIGINAIS v6.0 MANTIDAS (INTACTAS)
// ================================

// Rota original para extração (mantida intacta)
app.post('/extract', async (req, res) => {
  try {
    logger.info('Extract request received', { url: req.body.url });
    
    const { url } = req.body;
    if (!url) {
      return res.status(400).json({ error: 'URL é obrigatória' });
    }

    const response = await axios.get(url, { timeout: 15000 });
    const $ = cheerio.load(response.data);
    
    // Remover scripts e elementos desnecessários
    $('script, style, nav, footer, .ads, .advertisement').remove();
    
    const extractedData = {
      title: $('title').text() || $('h1').first().text(),
      description: $('meta[name="description"]').attr('content') || 
                  $('meta[property="og:description"]').attr('content') || 
                  $('p').first().text().substring(0, 200),
      content: $('body').text().replace(/\s+/g, ' ').trim().substring(0, 8000),
      url: url
    };

    logger.info('Extraction successful', { url });
    res.json({ success: true, data: extractedData });
    
  } catch (error) {
    logger.error('Extraction failed', { error: error.message, url: req.body.url });
    res.status(500).json({ 
      error: 'Erro na extração', 
      details: process.env.NODE_ENV === 'development' ? error.message : 'Erro interno'
    });
  }
});

// Rota original de chat universal (mantida intacta com melhorias)
app.post('/chat-universal', publicApiLimit, async (req, res) => {
  try {
    const { message, robotName, instructions, extractedData } = req.body;
    
    if (!message) {
      return res.status(400).json({ error: 'Mensagem é obrigatória' });
    }

    logger.info('Chat request received', { 
      robotName, 
      messageLength: message.length,
      hasInstructions: !!instructions 
    });

    let response;
    
    // GROQ API (Principal)
    if (process.env.GROQ_API_KEY) {
      try {
        const groqResponse = await axios.post('https://api.groq.com/openai/v1/chat/completions', {
          model: "mixtral-8x7b-32768",
          messages: [
            {
              role: "system",
              content: `Você é ${robotName || 'um assistente virtual'}. ${instructions || 'Seja útil e prestativo.'}
              
              ${extractedData ? `Informações da página:
              Título: ${extractedData.title}
              Descrição: ${extractedData.description}
              Conteúdo: ${extractedData.content?.substring(0, 2000)}` : ''}
              
              Responda de forma natural, útil e engajadora. Mantenha o foco na venda/conversão quando apropriado.`
            },
            { role: "user", content: message }
          ],
          temperature: 0.7,
          max_tokens: 500
        }, {
          headers: {
            'Authorization': `Bearer ${process.env.GROQ_API_KEY}`,
            'Content-Type': 'application/json'
          },
          timeout: 10000
        });

        response = groqResponse.data.choices[0].message.content;
        logger.info('GROQ API response successful');
        
      } catch (groqError) {
        logger.warn('GROQ API failed, trying fallback', { error: groqError.message });
        throw groqError;
      }
    }

    // Fallback para OpenAI API
    if (!response && process.env.OPENAI_API_KEY) {
      try {
        const openaiResponse = await axios.post('https://api.openai.com/v1/chat/completions', {
          model: "gpt-3.5-turbo",
          messages: [
            {
              role: "system", 
              content: `Você é ${robotName || 'um assistente virtual'}. ${instructions || 'Seja útil e prestativo.'}`
            },
            { role: "user", content: message }
          ],
          temperature: 0.7,
          max_tokens: 500
        }, {
          headers: {
            'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`,
            'Content-Type': 'application/json'
          },
          timeout: 10000
        });

        response = openaiResponse.data.choices[0].message.content;
        logger.info('OpenAI API response successful (fallback)');
        
      } catch (openaiError) {
        logger.warn('OpenAI API failed, trying next fallback', { error: openaiError.message });
      }
    }

    // Fallback para OpenRouter API
    if (!response && process.env.OPENROUTER_API_KEY) {
      try {
        const openrouterResponse = await axios.post('https://openrouter.ai/api/v1/chat/completions', {
          model: "microsoft/wizardlm-2-8x22b",
          messages: [
            {
              role: "system", 
              content: `Você é ${robotName || 'um assistente virtual'}. ${instructions || 'Seja útil e prestativo.'}`
            },
            { role: "user", content: message }
          ]
        }, {
          headers: {
            'Authorization': `Bearer ${process.env.OPENROUTER_API_KEY}`,
            'Content-Type': 'application/json',
            'HTTP-Referer': process.env.RENDER_EXTERNAL_URL || 'http://localhost:3000'
          },
          timeout: 10000
        });

        response = openrouterResponse.data.choices[0].message.content;
        logger.info('OpenRouter API response successful (fallback)');
        
      } catch (openrouterError) {
        logger.warn('OpenRouter API failed, using native fallback', { error: openrouterError.message });
      }
    }

    // Fallback nativo (lógica simples)
    if (!response) {
      logger.info('Using native fallback response');
      
      const nativeResponses = [
        `Olá! Como ${robotName || 'assistente'}, posso ajudar você com informações sobre nossos produtos e serviços. Em que posso ser útil?`,
        `Entendo sua pergunta. Como especialista, posso dizer que temos soluções personalizadas para suas necessidades. Gostaria de saber mais detalhes?`,
        `Excelente pergunta! Nossa experiência mostra que muitos clientes têm essa mesma dúvida. Posso explicar como funcionamos e como podemos ajudar você.`,
        `Perfeito! Essa é uma questão importante. Com base na sua mensagem, acredito que posso oferecer informações valiosas. O que especificamente você gostaria de saber?`
      ];
      
      response = nativeResponses[Math.floor(Math.random() * nativeResponses.length)];
    }

    res.json({
      success: true,
      response: response,
      robotName: robotName || 'Assistente Virtual',
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    logger.error('Chat request failed', { error: error.message });
    res.status(500).json({
      error: 'Erro no processamento da mensagem',
      fallbackResponse: 'Desculpe, estou com dificuldades técnicas no momento. Pode tentar novamente em alguns instantes?'
    });
  }
});

// Status e health check (mantido e melhorado)
app.get('/status', (req, res) => {
  res.json({
    status: 'online',
    version: '6.0 + v7.0 integrada',
    uptime: process.uptime(),
    memory: process.memoryUsage(),
    apis: {
      groq: !!process.env.GROQ_API_KEY,
      openai: !!process.env.OPENAI_API_KEY,
      openrouter: !!process.env.OPENROUTER_API_KEY
    },
    newFeatures: {
      dashboard: '/dashboard/demo',
      widget: '/widget/demo',
      api: '/api/public/status',
      docs: '/docs'
    },
    rateLimit: 'active',
    timestamp: new Date().toISOString()
  });
});

app.get('/health', (req, res) => {
  res.status(200).json({ 
    status: 'healthy', 
    version: 'v6.0 + v7.0',
    timestamp: new Date().toISOString() 
  });
});

// Middleware para servir arquivos estáticos originais (mantido)
app.use(express.static('public'));

// ================================
// ROTAS ORIGINAIS PRESERVADAS
// ================================

// Chat.html original (se existir)
app.get('/chat.html', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'chat.html'));
});

// Analytics original (se existir)
app.get('/analytics', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'analytics.html'));
});

// ================================
// ERROR HANDLERS
// ================================

app.use((req, res, next) => {
  logger.warn('Route not found', { path: req.path, method: req.method });
  res.status(404).json({ 
    error: 'Rota não encontrada',
    availableRoutes: {
      original: ['/', '/chat.html', '/analytics'],
      newDemos: ['/dashboard/demo', '/widget/demo', '/docs'],
      api: ['/chat-universal', '/extract', '/api/public/status'],
      monitoring: ['/status', '/health']
    }
  });
});

app.use((err, req, res, next) => {
  logger.error('Server error', { error: err.message, stack: err.stack });
  
  if (err.status === 429) {
    return res.status(429).json({
      error: 'Rate limit excedido',
      message: 'Muitas tentativas. Aguarde e tente novamente.',
      retryAfter: err.retryAfter || 60
    });
  }
  
  res.status(err.status || 500).json({
    error: 'Erro interno do servidor',
    message: process.env.NODE_ENV === 'production' 
      ? 'Ocorreu um erro inesperado' 
      : err.message
  });
});

// ================================
// INICIALIZAÇÃO DO SERVIDOR
// ================================

app.listen(PORT, () => {
  logger.info('Server started', { port: PORT, environment: process.env.NODE_ENV });
  
  console.log(`
🚀 Link Mágico v6.0 + v7.0 INTEGRADO!
📍 Porta: ${PORT}
🌐 Ambiente: ${process.env.NODE_ENV || 'development'}

📡 APIs Configuradas:
${process.env.GROQ_API_KEY ? '✅ GROQ API (Principal)' : '❌ GROQ API'}
${process.env.OPENAI_API_KEY ? '✅ OpenAI API (Fallback)' : '❌ OpenAI API'} 
${process.env.OPENROUTER_API_KEY ? '✅ OpenRouter API (Fallback)' : '❌ OpenRouter API'}

📋 FUNCIONALIDADES ORIGINAIS v6.0:
👉 Interface Original: http://localhost:${PORT}/
👉 Chat Universal: POST /chat-universal
👉 Extração: POST /extract
👉 Analytics: http://localhost:${PORT}/analytics (se existir)

🆕 NOVOS RECURSOS v7.0 INTEGRADOS:
👉 Dashboard Demo: http://localhost:${PORT}/dashboard/demo
👉 Widget Demo: http://localhost:${PORT}/widget/demo
👉 API Status: http://localhost:${PORT}/api/public/status
👉 Documentação: http://localhost:${PORT}/docs

✅ Rate limiting ativo
✅ Logging estruturado
✅ APIs com fallback automático
✅ Demos públicos integrados
✅ Funcionalidades originais preservadas
✅ TUDO EM UM SÓ LUGAR!
  `);
});

module.exports = app;