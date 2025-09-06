
# LinkMágico Chatbot v6.1 — Deploy Render (FREE)

Este pacote mantém todos os layouts e fluxos originais. Alteração exclusiva: **configuração da inteligência conversacional** com prioridade **GROQ → OpenAI** e respostas curtas, naturais, em etapas e sempre com pergunta final.

## Variáveis de Ambiente (Render → Environment)
- `GROQ_API_KEY` (obrigatória) — obtenha em https://console.groq.com/keys
- `GROQ_MODEL` (opcional, default: `llama-3.1-70b-versatile`)
- `OPENAI_API_KEY` (opcional, fallback)
- `OPENAI_MODEL` (opcional, default: `gpt-4o-mini`)
- `PORT` (10000)

## Build & Start (usa plano Free)
- Build Command: `npm install`
- Start Command: `node server.js`
- Runtime: Node 18+

## Observações
- Se GROQ falhar, o sistema cai automaticamente para OpenAI.
- Caso ambas falhem, aplica fallback interno já existente.
- Nenhum layout/HTML foi alterado.
