
# 🚀 Guia de Deploy no Render (Passo a Passo)

## 1. Crie o serviço no Render
- Vá até: https://dashboard.render.com/
- Clique em **New +** → **Web Service**
- Conecte seu repositório GitHub ou faça upload do ZIP.

## 2. Configure
- **Runtime:** Node
- **Environment:** Node 20
- **Build Command:**
  ```bash
  npm install
  ```
- **Start Command:**
  ```bash
  node server.js
  ```

## 3. Deploy manual (ZIP)
Se quiser subir direto do ZIP:
1. Compacte o projeto no seu PC:
   ```bash
   zip -r LinkMagico_v7_DUAL_MODE.zip .
   ```
2. No Render → **Manual Deploy → Deploy latest commit**.

## 4. Variáveis de ambiente
- PORT=10000

## 5. Teste os dois modos
- Clássico: `https://<seu-subdominio>.onrender.com/chatbot?url=...&robot=...`
- Universal: `https://<seu-subdominio>.onrender.com/chat-universal-ui?url=...&robot=...`

Pronto ✅
