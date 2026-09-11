const express = require('express');
const app = express();
app.use(express.json());

const VERIFY_TOKEN = 'minha_verificacao_2026'; // troque por algo seu

// 1. Verificação do webhook (GET) - a Meta chama isso ao salvar a config
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

// 2. Recebimento de eventos (POST) - mensagens, status, etc
app.post('/webhook', (req, res) => {
  console.log(JSON.stringify(req.body, null, 2));
  // aqui você processa a mensagem recebida
  res.sendStatus(200);
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Rodando na porta ${PORT}`));
