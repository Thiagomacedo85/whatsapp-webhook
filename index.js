const express = require('express');
const app = express();
app.use(express.json());

const VERIFY_TOKEN = 'minha_verificacao_2026';
const WHATSAPP_TOKEN = process.env.WHATSAPP_TOKEN;
const PHONE_NUMBER_ID = process.env.PHONE_NUMBER_ID;
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;

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

async function sendWhatsAppMessage(to, text) {
  const response = await fetch(`https://graph.facebook.com/v21.0/${PHONE_NUMBER_ID}/messages`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${WHATSAPP_TOKEN}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      messaging_product: 'whatsapp',
      to: to,
      text: { body: text }
    })
  });
  const result = await response.json();
  console.log('Status envio:', response.status, JSON.stringify(result));
}

app.post('/webhook', async (req, res) => {
  const entry = req.body.entry?.[0];
  const change = entry?.changes?.[0];
  const message = change?.value?.messages?.[0];

  if (message) {
    const from = message.from;
    const text = message.text?.body || '';
    console.log(`Mensagem de ${from}: ${text}`);

    try {
      const reply = await askClaude(from, text);
      console.log(`Resposta do Claude: ${reply}`);
      await sendWhatsAppMessage(from, reply);
    } catch (err) {
      console.error('Erro:', err);
    }
  }

  res.sendStatus(200);
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Rodando na porta ${PORT}`));
