# Guia Técnico - LinkMágico Chatbot IA v6.0

## 🔧 Arquitetura Técnica Detalhada

### Visão Geral da Arquitetura

O LinkMágico Chatbot IA v6.0 foi projetado com uma arquitetura modular e escalável, seguindo os princípios de Clean Architecture e Domain-Driven Design.

```
┌─────────────────────────────────────────────────────────────┐
│                    Frontend (Browser)                       │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────────────┐  │
│  │   HTML5     │  │    CSS3     │  │    JavaScript       │  │
│  │  Interface  │  │   Styles    │  │   Logic & API       │  │
│  └─────────────┘  └─────────────┘  └─────────────────────┘  │
└─────────────────────┬───────────────────────────────────────┘
                      │ HTTP/HTTPS + WebSocket (futuro)
┌─────────────────────▼───────────────────────────────────────┐
│                   Flask Backend                             │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────────────┐  │
│  │   Routes    │  │   Models    │  │      Services       │  │
│  │  /api/chat  │  │ SQLAlchemy  │  │  AI Engine + Web    │  │
│  │ /api/extract│  │   Tables    │  │     Extractor       │  │
│  └─────────────┘  └─────────────┘  └─────────────────────┘  │
└─────────────────────┬───────────────────────────────────────┘
                      │
┌─────────────────────▼───────────────────────────────────────┐
│                External Services                            │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────────────┐  │
│  │  OpenAI     │  │  Web Sites  │  │    Databases        │  │
│  │    API      │  │  (Target)   │  │   SQLite/Postgres   │  │
│  └─────────────┘  └─────────────┘  └─────────────────────┘  │
└─────────────────────────────────────────────────────────────┘
```

### Componentes Principais

#### 1. Motor de IA Conversacional (`AIConversationEngine`)

**Responsabilidades:**
- Análise de intenção do usuário
- Geração de respostas contextuais
- Gerenciamento de sessões de conversa
- Aplicação de estratégias de vendas

**Fluxo de Processamento:**
```python
def process_message(self, message, session_id, context=None):
    # 1. Análise de intenção
    intent_analysis = self.analyze_user_intent(message, context)
    
    # 2. Recuperação de contexto
    conversation_context = self.get_conversation_context(session_id)
    
    # 3. Seleção de estratégia
    strategy = self._select_prompt_strategy(intent_analysis)
    
    # 4. Geração de resposta
    response = self.generate_response(message, intent_analysis, strategy, conversation_context)
    
    # 5. Armazenamento
    self._store_conversation(session_id, message, response, intent_analysis)
    
    return response
```

**Estratégias de Prompt:**
- **Greeting**: Primeira impressão e estabelecimento de rapport
- **Objection Handling**: Superação de objeções com técnicas de vendas
- **Closing**: Fechamento de vendas com urgência e escassez
- **Follow-up**: Nutrição de leads e manutenção de relacionamento

#### 2. Extrator Universal de Dados (`UniversalWebExtractor`)

**Métodos de Extração:**

1. **Requests + BeautifulSoup**
   - Uso: Sites estáticos simples
   - Vantagens: Rápido, baixo consumo de recursos
   - Limitações: Não executa JavaScript

2. **CloudScraper**
   - Uso: Sites protegidos por Cloudflare
   - Vantagens: Contorna proteções anti-bot básicas
   - Limitações: Pode não funcionar com proteções avançadas

3. **Selenium WebDriver**
   - Uso: Sites com JavaScript moderado
   - Vantagens: Executa JavaScript, simula navegador real
   - Limitações: Mais lento, maior consumo de recursos

4. **Playwright**
   - Uso: Sites complexos com JavaScript pesado
   - Vantagens: Máxima compatibilidade, execução rápida
   - Limitações: Maior complexidade de configuração

**Algoritmo de Seleção de Método:**
```python
def _detect_best_method(self, url):
    domain = urlparse(url).netloc.lower()
    
    # Sites que requerem JavaScript avançado
    if any(js_site in domain for js_site in ['facebook.com', 'instagram.com', 'linkedin.com']):
        return 'playwright'
    
    # Sites com proteção Cloudflare
    if any(cf_site in domain for cf_site in ['shopify.com', 'wordpress.com']):
        return 'cloudscraper'
    
    # Sites conhecidos por bloquearem bots
    if any(bot_site in domain for bot_site in ['amazon.com', 'ebay.com']):
        return 'selenium'
    
    # Padrão para sites simples
    return 'requests'
```

#### 3. Sistema de Persistência

**Modelos de Dados:**

```python
# Conversas do chatbot
class Conversation(db.Model):
    __tablename__ = 'conversations'
    
    id = db.Column(db.Integer, primary_key=True)
    session_id = db.Column(db.String(100), nullable=False, index=True)
    user_message = db.Column(db.Text, nullable=False)
    bot_response = db.Column(db.Text, nullable=False)
    timestamp = db.Column(db.DateTime, default=datetime.utcnow, index=True)
    context_data = db.Column(db.Text)  # JSON serializado
    sentiment_score = db.Column(db.Float, default=0.0)
    intent = db.Column(db.String(50))
    buying_stage = db.Column(db.String(50))

# Cache de dados extraídos da web
class WebData(db.Model):
    __tablename__ = 'web_data'
    
    id = db.Column(db.Integer, primary_key=True)
    url = db.Column(db.String(500), nullable=False, unique=True, index=True)
    title = db.Column(db.String(200))
    content = db.Column(db.Text)
    extracted_data = db.Column(db.Text)  # JSON com dados estruturados
    last_updated = db.Column(db.DateTime, default=datetime.utcnow, index=True)
    extraction_method = db.Column(db.String(50))
    success = db.Column(db.Boolean, default=True)
    error_message = db.Column(db.Text)

# Base de conhecimento para respostas
class KnowledgeBase(db.Model):
    __tablename__ = 'knowledge_base'
    
    id = db.Column(db.Integer, primary_key=True)
    category = db.Column(db.String(100), nullable=False, index=True)
    keyword = db.Column(db.String(200), nullable=False, index=True)
    content = db.Column(db.Text, nullable=False)
    priority = db.Column(db.Integer, default=1, index=True)
    created_at = db.Column(db.DateTime, default=datetime.utcnow)
    updated_at = db.Column(db.DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
    active = db.Column(db.Boolean, default=True)
```

### Fluxo de Dados Completo

#### 1. Requisição de Chat
```
User Input → Frontend → Flask Route → AI Engine → OpenAI API → Response
     ↓                                    ↓
Database ← Conversation Storage ← Context Processing
```

#### 2. Extração de URL
```
URL Input → Frontend → Flask Route → Web Extractor → Target Website
    ↓                                       ↓
Database ← WebData Storage ← Data Processing ← Raw HTML/Data
```

#### 3. Deep Linking
```
Social Button → JavaScript → Platform Detection → URL Generation → App/Web Launch
```

### Otimizações de Performance

#### 1. Cache de Dados Web
```python
def extract_data(self, url, method='auto', force_refresh=False):
    if not force_refresh:
        # Verifica cache (válido por 24 horas)
        cached_data = WebData.query.filter_by(url=url).first()
        if cached_data and (datetime.utcnow() - cached_data.last_updated).hours < 24:
            return self._format_cached_response(cached_data)
    
    # Extração nova se não há cache ou force_refresh=True
    return self._perform_extraction(url, method)
```

#### 2. Sessões de Conversa Otimizadas
```python
def get_conversation_context(self, session_id, limit=10):
    # Busca apenas as últimas N mensagens para contexto
    recent_conversations = Conversation.query.filter_by(session_id=session_id)\
        .order_by(Conversation.timestamp.desc())\
        .limit(limit)\
        .all()
    
    return {
        'previous_messages': [conv.to_dict() for conv in reversed(recent_conversations)],
        'total_interactions': len(recent_conversations),
        'session_start': recent_conversations[-1].timestamp if recent_conversations else None
    }
```

#### 3. Lazy Loading de Recursos
```javascript
// Carrega analytics apenas quando necessário
async function loadAnalytics() {
    if (document.getElementById('analytics-section').offsetParent !== null) {
        const response = await fetch('/api/chatbot/analytics');
        const data = await response.json();
        updateAnalyticsDisplay(data);
    }
}
```

### Segurança e Validação

#### 1. Sanitização de Entrada
```python
def sanitize_input(self, user_input):
    # Remove caracteres perigosos
    sanitized = re.sub(r'[<>"\']', '', user_input)
    
    # Limita tamanho
    if len(sanitized) > 1000:
        sanitized = sanitized[:1000] + "..."
    
    return sanitized.strip()
```

#### 2. Validação de URLs
```python
def validate_url(self, url):
    try:
        parsed = urlparse(url)
        if not all([parsed.scheme, parsed.netloc]):
            return False
        
        # Lista de domínios bloqueados
        blocked_domains = ['localhost', '127.0.0.1', '0.0.0.0']
        if parsed.netloc.lower() in blocked_domains:
            return False
        
        return True
    except Exception:
        return False
```

#### 3. Rate Limiting (Recomendado)
```python
from flask_limiter import Limiter
from flask_limiter.util import get_remote_address

limiter = Limiter(
    app,
    key_func=get_remote_address,
    default_limits=["200 per day", "50 per hour"]
)

@app.route('/api/chatbot/chat', methods=['POST'])
@limiter.limit("10 per minute")
def chat():
    # Lógica do chat
    pass
```

### Monitoramento e Logs

#### 1. Logging Estruturado
```python
import logging
import json

class StructuredLogger:
    def __init__(self):
        self.logger = logging.getLogger('linkmagico_chatbot')
        
    def log_chat_interaction(self, session_id, message, response, intent):
        log_data = {
            'event': 'chat_interaction',
            'session_id': session_id,
            'message_length': len(message),
            'response_length': len(response),
            'intent': intent,
            'timestamp': datetime.utcnow().isoformat()
        }
        self.logger.info(json.dumps(log_data))
    
    def log_web_extraction(self, url, method, success, duration):
        log_data = {
            'event': 'web_extraction',
            'url': url,
            'method': method,
            'success': success,
            'duration_ms': duration * 1000,
            'timestamp': datetime.utcnow().isoformat()
        }
        self.logger.info(json.dumps(log_data))
```

#### 2. Métricas de Performance
```python
import time
from functools import wraps

def measure_performance(func):
    @wraps(func)
    def wrapper(*args, **kwargs):
        start_time = time.time()
        result = func(*args, **kwargs)
        end_time = time.time()
        
        # Log performance
        logger.info(f"{func.__name__} executed in {end_time - start_time:.3f}s")
        
        return result
    return wrapper
```

### Escalabilidade

#### 1. Configuração para Produção
```python
# config.py
import os

class ProductionConfig:
    SQLALCHEMY_DATABASE_URI = os.environ.get('DATABASE_URL', 'postgresql://user:pass@localhost/linkmagico')
    REDIS_URL = os.environ.get('REDIS_URL', 'redis://localhost:6379')
    CELERY_BROKER_URL = os.environ.get('REDIS_URL', 'redis://localhost:6379')
    CELERY_RESULT_BACKEND = os.environ.get('REDIS_URL', 'redis://localhost:6379')
    
    # Performance
    SQLALCHEMY_ENGINE_OPTIONS = {
        'pool_size': 20,
        'pool_recycle': 3600,
        'pool_pre_ping': True
    }
```

#### 2. Processamento Assíncrono (Futuro)
```python
from celery import Celery

celery = Celery('linkmagico_chatbot')

@celery.task
def extract_url_async(url, method='auto'):
    """Extração assíncrona de URL para não bloquear a interface"""
    extractor = UniversalWebExtractor()
    return extractor.extract_data(url, method)

@celery.task
def generate_response_async(message, session_id, context):
    """Geração assíncrona de resposta para melhor UX"""
    ai_engine = AIConversationEngine()
    return ai_engine.process_message(message, session_id, context)
```

#### 3. Cache Distribuído
```python
import redis
import json

class DistributedCache:
    def __init__(self, redis_url):
        self.redis_client = redis.from_url(redis_url)
    
    def get_web_data(self, url):
        cached = self.redis_client.get(f"web_data:{url}")
        return json.loads(cached) if cached else None
    
    def set_web_data(self, url, data, ttl=86400):  # 24 horas
        self.redis_client.setex(
            f"web_data:{url}", 
            ttl, 
            json.dumps(data, default=str)
        )
    
    def get_conversation_context(self, session_id):
        cached = self.redis_client.get(f"context:{session_id}")
        return json.loads(cached) if cached else {}
    
    def set_conversation_context(self, session_id, context, ttl=3600):  # 1 hora
        self.redis_client.setex(
            f"context:{session_id}",
            ttl,
            json.dumps(context, default=str)
        )
```

### Testes Avançados

#### 1. Testes de Integração
```python
class TestIntegration(unittest.TestCase):
    def test_full_chat_flow(self):
        """Testa fluxo completo de chat"""
        # 1. Extrai dados de uma URL
        response = self.app.post('/api/chatbot/extract-url', 
                                json={'url': 'https://example.com'})
        self.assertEqual(response.status_code, 200)
        
        # 2. Faz pergunta sobre os dados extraídos
        response = self.app.post('/api/chatbot/chat',
                                json={
                                    'message': 'Me fale sobre este site',
                                    'url': 'https://example.com'
                                })
        self.assertEqual(response.status_code, 200)
        
        # 3. Verifica se a resposta menciona dados do site
        data = json.loads(response.data)
        self.assertIn('example', data['response'].lower())
```

#### 2. Testes de Performance
```python
import time
import concurrent.futures

class TestPerformance(unittest.TestCase):
    def test_concurrent_chat_requests(self):
        """Testa múltiplas requisições simultâneas"""
        def make_chat_request():
            return self.app.post('/api/chatbot/chat',
                                json={'message': 'Olá'})
        
        start_time = time.time()
        
        with concurrent.futures.ThreadPoolExecutor(max_workers=10) as executor:
            futures = [executor.submit(make_chat_request) for _ in range(50)]
            responses = [future.result() for future in futures]
        
        end_time = time.time()
        
        # Todas as requisições devem ser bem-sucedidas
        for response in responses:
            self.assertEqual(response.status_code, 200)
        
        # Deve processar 50 requisições em menos de 30 segundos
        self.assertLess(end_time - start_time, 30)
```

### Deployment e DevOps

#### 1. Docker Configuration
```dockerfile
# Dockerfile
FROM python:3.11-slim

WORKDIR /app

# Instala dependências do sistema
RUN apt-get update && apt-get install -y \
    chromium-browser \
    chromium-chromedriver \
    && rm -rf /var/lib/apt/lists/*

# Copia e instala dependências Python
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copia código da aplicação
COPY src/ ./src/
COPY tests/ ./tests/

# Configura variáveis de ambiente
ENV FLASK_APP=src.main:app
ENV FLASK_ENV=production

# Expõe porta
EXPOSE 5000

# Comando de inicialização
CMD ["gunicorn", "--bind", "0.0.0.0:5000", "--workers", "4", "src.main:app"]
```

#### 2. Docker Compose
```yaml
# docker-compose.yml
version: '3.8'

services:
  web:
    build: .
    ports:
      - "5000:5000"
    environment:
      - DATABASE_URL=postgresql://postgres:password@db:5432/linkmagico
      - REDIS_URL=redis://redis:6379
      - OPENAI_API_KEY=${OPENAI_API_KEY}
    depends_on:
      - db
      - redis
    volumes:
      - ./logs:/app/logs

  db:
    image: postgres:15
    environment:
      - POSTGRES_DB=linkmagico
      - POSTGRES_USER=postgres
      - POSTGRES_PASSWORD=password
    volumes:
      - postgres_data:/var/lib/postgresql/data

  redis:
    image: redis:7-alpine
    volumes:
      - redis_data:/data

  nginx:
    image: nginx:alpine
    ports:
      - "80:80"
      - "443:443"
    volumes:
      - ./nginx.conf:/etc/nginx/nginx.conf
      - ./ssl:/etc/nginx/ssl
    depends_on:
      - web

volumes:
  postgres_data:
  redis_data:
```

#### 3. CI/CD Pipeline
```yaml
# .github/workflows/deploy.yml
name: Deploy LinkMágico Chatbot

on:
  push:
    branches: [main]

jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      - name: Set up Python
        uses: actions/setup-python@v4
        with:
          python-version: '3.11'
      - name: Install dependencies
        run: |
          pip install -r requirements.txt
      - name: Run tests
        run: |
          python tests/test_simple.py

  deploy:
    needs: test
    runs-on: ubuntu-latest
    if: github.ref == 'refs/heads/main'
    steps:
      - uses: actions/checkout@v3
      - name: Deploy to production
        run: |
          # Script de deploy personalizado
          ./deploy.sh
```

### Troubleshooting Avançado

#### 1. Debug de Extração Web
```python
def debug_extraction(self, url):
    """Função de debug para problemas de extração"""
    print(f"🔍 Debugando extração para: {url}")
    
    # Testa cada método
    methods = ['requests', 'cloudscraper', 'selenium', 'playwright']
    results = {}
    
    for method in methods:
        try:
            start_time = time.time()
            result = self._extract_with_method(url, method)
            duration = time.time() - start_time
            
            results[method] = {
                'success': result['success'],
                'duration': duration,
                'content_length': len(result.get('data', {}).get('content', '')),
                'error': result.get('error')
            }
            
            print(f"  ✅ {method}: {duration:.2f}s, {results[method]['content_length']} chars")
            
        except Exception as e:
            results[method] = {'success': False, 'error': str(e)}
            print(f"  ❌ {method}: {str(e)}")
    
    return results
```

#### 2. Monitoramento de Saúde
```python
@app.route('/health')
def health_check():
    """Endpoint de verificação de saúde"""
    checks = {
        'database': check_database_connection(),
        'openai_api': check_openai_api(),
        'redis': check_redis_connection(),
        'disk_space': check_disk_space()
    }
    
    all_healthy = all(checks.values())
    status_code = 200 if all_healthy else 503
    
    return jsonify({
        'status': 'healthy' if all_healthy else 'unhealthy',
        'checks': checks,
        'timestamp': datetime.utcnow().isoformat()
    }), status_code
```

### Roadmap Técnico

#### Próximas Versões
- **v6.1**: WebSocket para chat em tempo real
- **v6.2**: Processamento assíncrono com Celery
- **v6.3**: Cache distribuído com Redis
- **v6.4**: API GraphQL
- **v6.5**: Machine Learning para otimização de conversões
- **v7.0**: Microserviços com Kubernetes

#### Melhorias Planejadas
- Suporte a múltiplos idiomas
- Integração com CRM (Salesforce, HubSpot)
- Análise de sentimento avançada
- Geração de relatórios automatizados
- A/B testing de estratégias de conversa
- Integração com WhatsApp Business API

---

Este guia técnico fornece uma visão completa da implementação do LinkMágico Chatbot IA v6.0, servindo como referência para desenvolvedores e administradores de sistema.

