# Guia de Deployment - LinkMágico Chatbot IA v6.0

## 🚀 Opções de Deployment

### 1. Desenvolvimento Local

#### Configuração Rápida
```bash
# Clone o repositório
git clone <repository-url>
cd linkmagico_chatbot_v6

# Configure ambiente virtual
python -m venv venv
source venv/bin/activate  # Linux/Mac
# ou venv\Scripts\activate  # Windows

# Instale dependências
pip install -r requirements.txt

# Configure variáveis de ambiente
export OPENAI_API_KEY="sua-chave-openai"
export OPENAI_API_BASE="https://api.openai.com/v1"

# Execute a aplicação
python src/main.py
```

Acesse: `http://localhost:5000`

### 2. Produção com Docker

#### Dockerfile Otimizado
```dockerfile
FROM python:3.11-slim

# Instala dependências do sistema
RUN apt-get update && apt-get install -y \
    chromium-browser \
    chromium-chromedriver \
    curl \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copia e instala dependências Python
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copia código da aplicação
COPY src/ ./src/
COPY tests/ ./tests/

# Cria usuário não-root
RUN useradd -m -u 1000 appuser && chown -R appuser:appuser /app
USER appuser

# Configura variáveis de ambiente
ENV FLASK_APP=src.main:app
ENV FLASK_ENV=production
ENV PYTHONPATH=/app

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
    CMD curl -f http://localhost:5000/health || exit 1

EXPOSE 5000

# Comando de inicialização com Gunicorn
CMD ["gunicorn", "--bind", "0.0.0.0:5000", "--workers", "4", "--timeout", "120", "src.main:app"]
```

#### Build e Run
```bash
# Build da imagem
docker build -t linkmagico-chatbot:v6.0 .

# Run com variáveis de ambiente
docker run -d \
  --name linkmagico-chatbot \
  -p 5000:5000 \
  -e OPENAI_API_KEY="sua-chave-openai" \
  -e OPENAI_API_BASE="https://api.openai.com/v1" \
  -v $(pwd)/logs:/app/logs \
  linkmagico-chatbot:v6.0
```

### 3. Docker Compose Completo

#### docker-compose.yml
```yaml
version: '3.8'

services:
  web:
    build: .
    ports:
      - "5000:5000"
    environment:
      - DATABASE_URL=postgresql://postgres:${POSTGRES_PASSWORD}@db:5432/linkmagico
      - REDIS_URL=redis://redis:6379
      - OPENAI_API_KEY=${OPENAI_API_KEY}
      - OPENAI_API_BASE=${OPENAI_API_BASE}
      - FLASK_ENV=production
    depends_on:
      db:
        condition: service_healthy
      redis:
        condition: service_healthy
    volumes:
      - ./logs:/app/logs
      - ./uploads:/app/uploads
    restart: unless-stopped
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost:5000/health"]
      interval: 30s
      timeout: 10s
      retries: 3

  db:
    image: postgres:15-alpine
    environment:
      - POSTGRES_DB=linkmagico
      - POSTGRES_USER=postgres
      - POSTGRES_PASSWORD=${POSTGRES_PASSWORD}
    volumes:
      - postgres_data:/var/lib/postgresql/data
      - ./init.sql:/docker-entrypoint-initdb.d/init.sql
    restart: unless-stopped
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U postgres"]
      interval: 10s
      timeout: 5s
      retries: 5

  redis:
    image: redis:7-alpine
    volumes:
      - redis_data:/data
    restart: unless-stopped
    healthcheck:
      test: ["CMD", "redis-cli", "ping"]
      interval: 10s
      timeout: 5s
      retries: 3

  nginx:
    image: nginx:alpine
    ports:
      - "80:80"
      - "443:443"
    volumes:
      - ./nginx/nginx.conf:/etc/nginx/nginx.conf
      - ./nginx/ssl:/etc/nginx/ssl
      - ./nginx/logs:/var/log/nginx
    depends_on:
      - web
    restart: unless-stopped

  # Opcional: Monitoramento
  prometheus:
    image: prom/prometheus:latest
    ports:
      - "9090:9090"
    volumes:
      - ./monitoring/prometheus.yml:/etc/prometheus/prometheus.yml
    restart: unless-stopped

  grafana:
    image: grafana/grafana:latest
    ports:
      - "3000:3000"
    environment:
      - GF_SECURITY_ADMIN_PASSWORD=${GRAFANA_PASSWORD}
    volumes:
      - grafana_data:/var/lib/grafana
    restart: unless-stopped

volumes:
  postgres_data:
  redis_data:
  grafana_data:

networks:
  default:
    driver: bridge
```

#### .env para Docker Compose
```bash
# .env
OPENAI_API_KEY=sua-chave-openai
OPENAI_API_BASE=https://api.openai.com/v1
POSTGRES_PASSWORD=senha-super-segura
GRAFANA_PASSWORD=admin-password
```

#### Comandos Docker Compose
```bash
# Iniciar todos os serviços
docker-compose up -d

# Ver logs
docker-compose logs -f web

# Parar serviços
docker-compose down

# Rebuild e restart
docker-compose up -d --build
```

### 4. Nginx Configuration

#### nginx.conf
```nginx
events {
    worker_connections 1024;
}

http {
    upstream linkmagico_backend {
        server web:5000;
    }

    # Rate limiting
    limit_req_zone $binary_remote_addr zone=api:10m rate=10r/s;
    limit_req_zone $binary_remote_addr zone=chat:10m rate=5r/s;

    server {
        listen 80;
        server_name seu-dominio.com;

        # Redirect HTTP to HTTPS
        return 301 https://$server_name$request_uri;
    }

    server {
        listen 443 ssl http2;
        server_name seu-dominio.com;

        # SSL Configuration
        ssl_certificate /etc/nginx/ssl/cert.pem;
        ssl_certificate_key /etc/nginx/ssl/key.pem;
        ssl_protocols TLSv1.2 TLSv1.3;
        ssl_ciphers ECDHE-RSA-AES256-GCM-SHA512:DHE-RSA-AES256-GCM-SHA512;
        ssl_prefer_server_ciphers off;

        # Security headers
        add_header X-Frame-Options DENY;
        add_header X-Content-Type-Options nosniff;
        add_header X-XSS-Protection "1; mode=block";
        add_header Strict-Transport-Security "max-age=63072000; includeSubDomains; preload";

        # Gzip compression
        gzip on;
        gzip_vary on;
        gzip_min_length 1024;
        gzip_types text/plain text/css text/xml text/javascript application/javascript application/xml+rss application/json;

        # Static files
        location /static/ {
            alias /app/src/static/;
            expires 1y;
            add_header Cache-Control "public, immutable";
        }

        # API endpoints with rate limiting
        location /api/chatbot/chat {
            limit_req zone=chat burst=10 nodelay;
            proxy_pass http://linkmagico_backend;
            proxy_set_header Host $host;
            proxy_set_header X-Real-IP $remote_addr;
            proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
            proxy_set_header X-Forwarded-Proto $scheme;
            proxy_timeout 120s;
        }

        location /api/ {
            limit_req zone=api burst=20 nodelay;
            proxy_pass http://linkmagico_backend;
            proxy_set_header Host $host;
            proxy_set_header X-Real-IP $remote_addr;
            proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
            proxy_set_header X-Forwarded-Proto $scheme;
        }

        # Main application
        location / {
            proxy_pass http://linkmagico_backend;
            proxy_set_header Host $host;
            proxy_set_header X-Real-IP $remote_addr;
            proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
            proxy_set_header X-Forwarded-Proto $scheme;
        }

        # Health check
        location /health {
            proxy_pass http://linkmagico_backend;
            access_log off;
        }
    }
}
```

### 5. Cloud Deployment

#### AWS ECS com Fargate

**task-definition.json**
```json
{
  "family": "linkmagico-chatbot",
  "networkMode": "awsvpc",
  "requiresCompatibilities": ["FARGATE"],
  "cpu": "1024",
  "memory": "2048",
  "executionRoleArn": "arn:aws:iam::ACCOUNT:role/ecsTaskExecutionRole",
  "taskRoleArn": "arn:aws:iam::ACCOUNT:role/ecsTaskRole",
  "containerDefinitions": [
    {
      "name": "linkmagico-chatbot",
      "image": "ACCOUNT.dkr.ecr.REGION.amazonaws.com/linkmagico-chatbot:latest",
      "portMappings": [
        {
          "containerPort": 5000,
          "protocol": "tcp"
        }
      ],
      "environment": [
        {
          "name": "FLASK_ENV",
          "value": "production"
        },
        {
          "name": "DATABASE_URL",
          "value": "postgresql://user:pass@rds-endpoint:5432/linkmagico"
        }
      ],
      "secrets": [
        {
          "name": "OPENAI_API_KEY",
          "valueFrom": "arn:aws:secretsmanager:REGION:ACCOUNT:secret:openai-api-key"
        }
      ],
      "logConfiguration": {
        "logDriver": "awslogs",
        "options": {
          "awslogs-group": "/ecs/linkmagico-chatbot",
          "awslogs-region": "us-east-1",
          "awslogs-stream-prefix": "ecs"
        }
      },
      "healthCheck": {
        "command": ["CMD-SHELL", "curl -f http://localhost:5000/health || exit 1"],
        "interval": 30,
        "timeout": 5,
        "retries": 3
      }
    }
  ]
}
```

**deploy-aws.sh**
```bash
#!/bin/bash

# Build e push para ECR
aws ecr get-login-password --region us-east-1 | docker login --username AWS --password-stdin ACCOUNT.dkr.ecr.us-east-1.amazonaws.com

docker build -t linkmagico-chatbot .
docker tag linkmagico-chatbot:latest ACCOUNT.dkr.ecr.us-east-1.amazonaws.com/linkmagico-chatbot:latest
docker push ACCOUNT.dkr.ecr.us-east-1.amazonaws.com/linkmagico-chatbot:latest

# Update ECS service
aws ecs update-service --cluster linkmagico-cluster --service linkmagico-service --force-new-deployment
```

#### Google Cloud Run

**cloudbuild.yaml**
```yaml
steps:
  # Build da imagem
  - name: 'gcr.io/cloud-builders/docker'
    args: ['build', '-t', 'gcr.io/$PROJECT_ID/linkmagico-chatbot', '.']

  # Push para Container Registry
  - name: 'gcr.io/cloud-builders/docker'
    args: ['push', 'gcr.io/$PROJECT_ID/linkmagico-chatbot']

  # Deploy para Cloud Run
  - name: 'gcr.io/cloud-builders/gcloud'
    args:
      - 'run'
      - 'deploy'
      - 'linkmagico-chatbot'
      - '--image'
      - 'gcr.io/$PROJECT_ID/linkmagico-chatbot'
      - '--region'
      - 'us-central1'
      - '--platform'
      - 'managed'
      - '--allow-unauthenticated'
      - '--set-env-vars'
      - 'FLASK_ENV=production'
      - '--set-secrets'
      - 'OPENAI_API_KEY=openai-api-key:latest'

images:
  - 'gcr.io/$PROJECT_ID/linkmagico-chatbot'
```

#### Heroku Deployment

**Procfile**
```
web: gunicorn --bind 0.0.0.0:$PORT --workers 4 src.main:app
```

**runtime.txt**
```
python-3.11.0
```

**heroku-deploy.sh**
```bash
#!/bin/bash

# Login no Heroku
heroku login

# Criar app
heroku create linkmagico-chatbot-prod

# Configurar variáveis de ambiente
heroku config:set OPENAI_API_KEY="sua-chave-openai"
heroku config:set OPENAI_API_BASE="https://api.openai.com/v1"
heroku config:set FLASK_ENV="production"

# Adicionar PostgreSQL
heroku addons:create heroku-postgresql:hobby-dev

# Deploy
git push heroku main

# Executar migrações
heroku run python -c "from src.main import app, db; app.app_context().push(); db.create_all()"
```

### 6. Kubernetes Deployment

#### k8s-deployment.yaml
```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: linkmagico-chatbot
  labels:
    app: linkmagico-chatbot
spec:
  replicas: 3
  selector:
    matchLabels:
      app: linkmagico-chatbot
  template:
    metadata:
      labels:
        app: linkmagico-chatbot
    spec:
      containers:
      - name: linkmagico-chatbot
        image: linkmagico-chatbot:v6.0
        ports:
        - containerPort: 5000
        env:
        - name: FLASK_ENV
          value: "production"
        - name: DATABASE_URL
          valueFrom:
            secretKeyRef:
              name: linkmagico-secrets
              key: database-url
        - name: OPENAI_API_KEY
          valueFrom:
            secretKeyRef:
              name: linkmagico-secrets
              key: openai-api-key
        resources:
          requests:
            memory: "512Mi"
            cpu: "250m"
          limits:
            memory: "1Gi"
            cpu: "500m"
        livenessProbe:
          httpGet:
            path: /health
            port: 5000
          initialDelaySeconds: 30
          periodSeconds: 10
        readinessProbe:
          httpGet:
            path: /health
            port: 5000
          initialDelaySeconds: 5
          periodSeconds: 5

---
apiVersion: v1
kind: Service
metadata:
  name: linkmagico-chatbot-service
spec:
  selector:
    app: linkmagico-chatbot
  ports:
    - protocol: TCP
      port: 80
      targetPort: 5000
  type: LoadBalancer

---
apiVersion: networking.k8s.io/v1
kind: Ingress
metadata:
  name: linkmagico-chatbot-ingress
  annotations:
    kubernetes.io/ingress.class: nginx
    cert-manager.io/cluster-issuer: letsencrypt-prod
spec:
  tls:
  - hosts:
    - seu-dominio.com
    secretName: linkmagico-tls
  rules:
  - host: seu-dominio.com
    http:
      paths:
      - path: /
        pathType: Prefix
        backend:
          service:
            name: linkmagico-chatbot-service
            port:
              number: 80
```

### 7. Monitoramento e Observabilidade

#### Prometheus Configuration
```yaml
# monitoring/prometheus.yml
global:
  scrape_interval: 15s

scrape_configs:
  - job_name: 'linkmagico-chatbot'
    static_configs:
      - targets: ['web:5000']
    metrics_path: '/metrics'
    scrape_interval: 30s

  - job_name: 'postgres'
    static_configs:
      - targets: ['db:5432']

  - job_name: 'redis'
    static_configs:
      - targets: ['redis:6379']
```

#### Grafana Dashboard
```json
{
  "dashboard": {
    "title": "LinkMágico Chatbot Metrics",
    "panels": [
      {
        "title": "Chat Requests per Minute",
        "type": "graph",
        "targets": [
          {
            "expr": "rate(flask_http_request_total{endpoint=\"/api/chatbot/chat\"}[1m])"
          }
        ]
      },
      {
        "title": "Response Time",
        "type": "graph",
        "targets": [
          {
            "expr": "flask_http_request_duration_seconds{endpoint=\"/api/chatbot/chat\"}"
          }
        ]
      },
      {
        "title": "Active Sessions",
        "type": "singlestat",
        "targets": [
          {
            "expr": "linkmagico_active_sessions"
          }
        ]
      }
    ]
  }
}
```

### 8. Backup e Disaster Recovery

#### Backup Script
```bash
#!/bin/bash
# backup.sh

DATE=$(date +%Y%m%d_%H%M%S)
BACKUP_DIR="/backups"

# Backup do banco de dados
docker exec linkmagico_db pg_dump -U postgres linkmagico > "$BACKUP_DIR/db_backup_$DATE.sql"

# Backup dos logs
tar -czf "$BACKUP_DIR/logs_backup_$DATE.tar.gz" ./logs/

# Backup da configuração
tar -czf "$BACKUP_DIR/config_backup_$DATE.tar.gz" ./nginx/ ./docker-compose.yml ./.env

# Upload para S3 (opcional)
aws s3 cp "$BACKUP_DIR/" s3://linkmagico-backups/ --recursive --exclude "*" --include "*$DATE*"

# Limpar backups antigos (manter últimos 7 dias)
find "$BACKUP_DIR" -name "*.sql" -mtime +7 -delete
find "$BACKUP_DIR" -name "*.tar.gz" -mtime +7 -delete

echo "Backup concluído: $DATE"
```

#### Restore Script
```bash
#!/bin/bash
# restore.sh

if [ -z "$1" ]; then
    echo "Uso: ./restore.sh YYYY-MM-DD_HHMMSS"
    exit 1
fi

DATE=$1
BACKUP_DIR="/backups"

# Parar serviços
docker-compose down

# Restaurar banco de dados
docker-compose up -d db
sleep 10
docker exec -i linkmagico_db psql -U postgres -c "DROP DATABASE IF EXISTS linkmagico;"
docker exec -i linkmagico_db psql -U postgres -c "CREATE DATABASE linkmagico;"
docker exec -i linkmagico_db psql -U postgres linkmagico < "$BACKUP_DIR/db_backup_$DATE.sql"

# Restaurar logs
tar -xzf "$BACKUP_DIR/logs_backup_$DATE.tar.gz"

# Reiniciar todos os serviços
docker-compose up -d

echo "Restore concluído: $DATE"
```

### 9. Troubleshooting

#### Logs Centralizados
```bash
# Ver todos os logs
docker-compose logs -f

# Logs específicos do chatbot
docker-compose logs -f web

# Logs do banco de dados
docker-compose logs -f db

# Logs do nginx
docker-compose logs -f nginx
```

#### Health Checks
```bash
# Verificar saúde da aplicação
curl http://localhost:5000/health

# Verificar métricas
curl http://localhost:5000/metrics

# Testar endpoint de chat
curl -X POST http://localhost:5000/api/chatbot/chat \
  -H "Content-Type: application/json" \
  -d '{"message": "Olá"}'
```

#### Performance Monitoring
```bash
# Monitorar recursos do container
docker stats linkmagico-chatbot

# Verificar conexões de rede
netstat -tulpn | grep :5000

# Monitorar queries do banco
docker exec linkmagico_db psql -U postgres -c "SELECT * FROM pg_stat_activity;"
```

### 10. Checklist de Deployment

#### Pré-deployment
- [ ] Variáveis de ambiente configuradas
- [ ] Certificados SSL válidos
- [ ] Backup do banco de dados atual
- [ ] Testes de carga executados
- [ ] Monitoramento configurado

#### Durante o deployment
- [ ] Build da imagem Docker bem-sucedido
- [ ] Migrações de banco executadas
- [ ] Health checks passando
- [ ] Logs sem erros críticos
- [ ] Endpoints respondendo corretamente

#### Pós-deployment
- [ ] Verificar métricas de performance
- [ ] Testar funcionalidades principais
- [ ] Monitorar logs por 24h
- [ ] Backup pós-deployment
- [ ] Documentar mudanças

---

Este guia de deployment fornece todas as opções necessárias para colocar o LinkMágico Chatbot IA v6.0 em produção de forma segura e escalável.




## 🚀 Opções de Deployment - Render.com

Este guia detalha os passos para realizar o deploy da ferramenta LinkMágico Chatbot IA no Render.com.

### Pré-requisitos

*   Conta no Render.com
*   Conta no GitHub (ou similar) para hospedar o código

### Passos para Deploy

1.  **Preparar o Código:**
    *   Certifique-se de que todos os arquivos do projeto (`index.html`, `server.js`, `package.json`, `src/` etc.) estejam na raiz do seu repositório Git.
    *   O arquivo `server.js` deve estar configurado para ouvir na porta `process.env.PORT`.

2.  **Criar um Novo Serviço Web no Render.com:**
    *   Faça login na sua conta do Render.com.
    *   No dashboard, clique em "New" e selecione "Web Service".
    *   Conecte seu repositório Git onde o código do LinkMágico Chatbot IA está hospedado.
    *   Configure as seguintes opções:
        *   **Name:** `linkmagico-chatbot-ia` (ou outro nome de sua preferência)
        *   **Region:** Escolha a região mais próxima dos seus usuários.
        *   **Branch:** `main` (ou a branch que contém seu código)
        *   **Root Directory:** `/` (se seus arquivos estiverem na raiz do repositório)
        *   **Runtime:** `Node`
        *   **Build Command:** `npm install`
        *   **Start Command:** `node server.js`
        *   **Health Check Path:** `/` (ou um endpoint de sua escolha para verificar a saúde do serviço)

3.  **Configurar Variáveis de Ambiente (Opcional, se houver):**
    *   Se o seu `server.js` ou `web_extractor.py` utilizar variáveis de ambiente (ex: chaves de API), adicione-as em "Environment Variables" no Render.com.

4.  **Deploy:**
    *   Clique em "Create Web Service".
    *   O Render.com irá automaticamente clonar seu repositório, instalar as dependências e iniciar o serviço.
    *   Acompanhe os logs para garantir que o deploy ocorra sem erros.

5.  **Acessar a Aplicação:**
    *   Após o deploy bem-sucedido, o Render.com fornecerá uma URL pública para sua aplicação (ex: `https://linkmagico-chatbot-ia.onrender.com`).
    *   Acesse esta URL no seu navegador para testar a ferramenta.

### Observações Importantes

*   **Persistência de Dados:** O Render.com é uma plataforma de deploy para aplicações stateless. Se você precisar de persistência de dados, considere integrar um banco de dados externo.
*   **Escalabilidade:** O Render.com oferece opções de escalabilidade para lidar com o aumento de tráfego.
*   **Domínio Personalizado:** Você pode configurar um domínio personalizado para sua aplicação no Render.com.

Este guia é um ponto de partida. Consulte a documentação oficial do Render.com para informações mais detalhadas e configurações avançadas.



## Novo Modo Universal (sem alterar o fluxo antigo)

### Rotas adicionadas
- `POST /chat-universal` — responde curto, sem invenção, baseado só no texto extraído.
- `GET  /chat-universal-ui?url=<URL>&robot=<@nome>` — UI simples que consome a rota acima.

### Como usar na sua tela de geração de link (index_v6.html)
O botão **"Link do Chatbot"** agora aponta para `/chat-universal-ui?...` automaticamente.

Se quiser manter os dois modos, crie um segundo botão que aponte para `/chatbot?...` (modo antigo).

### Deploy no Render (resumo)
- Build: `npm ci`
- Start: `node server.js`
- Node 20.x
