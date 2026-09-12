const express = require('express');
const app = express();
app.use(express.json());

const VERIFY_TOKEN = 'minha_verificacao_2026';
const WHATSAPP_TOKEN = process.env.WHATSAPP_TOKEN;
const PHONE_NUMBER_ID = process.env.PHONE_NUMBER_ID;
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;

// Guarda o histórico de cada conversa em memória (some se o servidor reiniciar)
const conversations = {};

app.get('/webhook', (req, res) => {
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];

  if (mode === 'subscribe' && token === VERIFY_TOKEN) {
    console.log('Webhook verificado com sucesso!');
    res.status(200).send(challenge);
  } else {
    res.sendStatus(403);
  }
});

async function askClaude(from, userText) {
  if (!conversations[from]) conversations[from] = [];
  conversations[from].push({ role: 'user', content: userText });

  // Mantém só as últimas 10 mensagens pra não crescer demais
  const history = conversations[from].slice(-10);

  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01',
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      model: 'claude-sonnet-4-6',
      max_tokens: 500,
      system: 'Você é um assistente virtual da TGX Cargo, uma empresa de transporte/logística. Responda de forma educada, objetiva e curta, em português.',
      messages: history
    })
  });

  const data = await response.json();
  const reply = data.content?.[0]?.text || 'Desculpe, não consegui processar sua mensagem agora.';

  conversations[from].push({ role: 'assistant', content: reply });
  return reply;
}

async
