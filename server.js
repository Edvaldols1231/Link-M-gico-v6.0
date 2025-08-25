import express from "express";
import fetch from "node-fetch";
import bodyParser from "body-parser";
import cors from "cors";

const app = express();
app.use(cors());
app.use(bodyParser.json());

/**
 * Chamada para Groq API (prioridade)
 */
async function chamarGroq(mensagem) {
  const resposta = await fetch("https://api.groq.com/openai/v1/chat/completions", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${process.env.GROQ_API_KEY}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      model: "llama3-8b-8192",
      messages: [
        { role: "system", content: "Você é um assistente amigável, consultivo e objetivo." },
        { role: "user", content: mensagem }
      ]
    })
  });

  if (!resposta.ok) throw new Error("Groq falhou");
  const dados = await resposta.json();
  return dados.choices[0].message.content;
}

/**
 * Chamada para OpenAI API (fallback)
 */
async function chamarOpenAI(mensagem) {
  const resposta = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${process.env.OPENAI_API_KEY}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      model: "gpt-3.5-turbo",
      messages: [
        { role: "system", content: "Você é um assistente amigável, consultivo e objetivo." },
        { role: "user", content: mensagem }
      ]
    })
  });

  if (!resposta.ok) throw new Error("OpenAI falhou");
  const dados = await resposta.json();
  return dados.choices[0].message.content;
}

/**
 * Rota principal do chatbot
 */
app.post("/chat", async (req, res) => {
  const { mensagem } = req.body;

  try {
    // Prioriza Groq
    console.log("[Groq] Tentando...");
    const resposta = await chamarGroq(mensagem);
    return res.json({ resposta, provider: "Groq" });
  } catch (e) {
    console.log("[Groq] Falhou, tentando OpenAI...");
    try {
      const resposta = await chamarOpenAI(mensagem);
      return res.json({ resposta, provider: "OpenAI" });
    } catch (e2) {
      console.error("[Erro] Nenhum provedor respondeu:", e2.message);
      return res.status(500).json({ erro: "Nenhum provedor respondeu." });
    }
  }
});

const PORT = process.env.PORT || 10000;
app.listen(PORT, () => {
  console.log(`🚀 Servidor rodando na porta ${PORT}`);
});
