const express = require('express');
const app = express();
app.use(express.json());

const VERIFY_TOKEN = 'minha_verificacao_2026';
const WHATSAPP_TOKEN = process.env.WHATSAPP_TOKEN;
const PHONE_NUMBER_ID = process.env.PHONE_NUMBER_ID;
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;

const conversations = {};

const SYSTEM_PROMPT = `Você é o assistente virtual da TGX Cargo, uma empresa de logística 3PL (third-party logistics) com sede em Recife - PE.

SOBRE A TGX CARGO:
A TGX assume a operação logística completa das empresas clientes, permitindo que elas foquem em vender, não em administrar logística. Atuamos em toda a cadeia: recebimento, armazenagem, processamento de pedidos, transporte, distribuição e logística reversa.

SERVIÇOS OFERECIDOS:
- Armazenagem
- Fulfillment (separação, embalagem, etiquetagem e expedição de pedidos)
- Distribuição
- Cross-docking
- Transporte (transferências, distribuição regional e última milha)
- Logística internacional
- Serviços de valor agregado
- Logística reversa

TERMINAIS/LOCALIZAÇÕES:
1. Terminal Suape - Cabo de Santo Agostinho, Pernambuco (próximo ao Complexo Portuário de Suape, conecta ao Nordeste - raio de 300km alcança 4 capitais, e raio de 800km alcança 7 capitais e +46 milhões de pessoas)
2. Terminal Itajaí - Santa Catarina (conecta Sul e Sudeste, acesso à BR-101 e BR-470 e Aeroporto de Navegantes - raio de 600km alcança SC, PR, RS, SP, 46% do PIB nacional)

DIFERENCIAIS:
- Infraestrutura pronta (espaço, equipamentos, equipe)
- Tecnologia para controle e visibilidade da operação (estoque, pedidos, movimentações)
- Operação ponta a ponta
- Permite escalar sem investir em CD próprio

CONTATO PARA ATENDIMENTO HUMANO E COTAÇÕES:
Quando alguém pedir uma cotação detalhada, orçamento, quiser ver o catálogo completo de serviços, ou precisar de atendimento mais aprofundado/personalizado, direcione para o WhatsApp Business oficial da empresa, onde um especialista humano atende com catálogo completo:
📞 +55 (81) 99253-9017

Endereço: R. do Brum, 248, Recife - PE, 50030-260
Horário: Segunda a sexta, 09:00 às 17:00

INSTRUÇÕES DE COMPORTAMENTO:
- Responda em português, de forma profissional mas acessível
- Seja objetivo e direto, evite respostas muito longas
- Não use asteriscos duplos (**) para negrito - use apenas um asterisco (*texto*) já que é o padrão do WhatsApp, ou não use formatação
- Para cotações, preços específicos, catálogo detalhado ou negociações, sempre direcione o cliente para falar com um especialista pelo WhatsApp +55 (81) 99253-9017, explicando que lá ele terá um atendimento mais completo e personalizado
- Se não souber responder algo específico, seja honesto e ofereça o mesmo contato humano
- O foco da empresa é B2B (atender empresas que precisam terceirizar logística), não entregas avulsas para pessoa física`;

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
      system: SYSTEM_PROMPT,
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
