const express = require('express');
const app = express();
app.use(express.json());

const { createLeadDeal } = require('./rdstation');

const VERIFY_TOKEN = 'minha_verificacao_2026';
const WHATSAPP_TOKEN = process.env.WHATSAPP_TOKEN;
const PHONE_NUMBER_ID = process.env.PHONE_NUMBER_ID;
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;

const conversations = {};

// Guarda os IDs das últimas mensagens processadas, pra não duplicar resposta
// caso a Meta reenvie o mesmo webhook (acontece quando a resposta demora).
const processedMessageIds = new Set();
function alreadyProcessed(messageId) {
  if (!messageId) return false;
  if (processedMessageIds.has(messageId)) return true;
  processedMessageIds.add(messageId);
  if (processedMessageIds.size > 500) {
    const oldest = processedMessageIds.values().next().value;
    processedMessageIds.delete(oldest);
  }
  return false;
}

const SYSTEM_PROMPT = `Você é o assistente virtual da TGX Cargo, uma empresa de logística 3PL (third-party logistics).

SOBRE A TGX CARGO:
A TGX oferece uma operação logística completa e integrada, mas os serviços também podem ser contratados de forma independente e modular, conforme a necessidade do cliente. Por exemplo: o cliente pode contratar apenas armazenagem e usar outra transportadora para o transporte, ou contratar só o transporte com a TGX sem passar pela armazenagem. Cada empresa monta a combinação de serviços que faz sentido para sua operação.

PÚBLICO ATENDIDO:
A TGX atende tanto empresas (B2B) quanto pessoas físicas (B2C), incluindo envios avulsos.

SERVIÇOS OFERECIDOS (contratáveis separadamente ou em conjunto):
- Armazenagem
- Fulfillment (separação, embalagem, etiquetagem e expedição de pedidos)
- Distribuição
- Cross-docking
- Transporte (transferências, distribuição regional e última milha)
- Logística internacional
- Serviços de valor agregado
- Logística reversa

COBERTURA:
Terminais estrategicamente posicionados próximos aos principais portos do Brasil e em cidades estratégicas para garantir excelência na distribuição em todo o país.

DIFERENCIAIS:
- Infraestrutura pronta (espaço, equipamentos, equipe)
- Tecnologia para controle e visibilidade da operação (estoque, pedidos, movimentações)
- Operação ponta a ponta, ou apenas os módulos que o cliente precisar
- Permite escalar sem investir em CD próprio

CONTATO PARA ATENDIMENTO HUMANO E COTAÇÕES:
Quando alguém pedir uma cotação detalhada, orçamento, quiser ver o catálogo completo de serviços, ou precisar de atendimento mais aprofundado/personalizado, direcione para o WhatsApp Business oficial da empresa, onde um especialista humano atende com catálogo completo:
📞 +55 (81) 99253-9017

Horário: Segunda a sexta, 09:00 às 17:00

INSTRUÇÕES DE COMPORTAMENTO:
- Responda em português, de forma profissional mas acessível
- Seja objetivo e direto, evite respostas muito longas
- Não use asteriscos duplos (**) para negrito - use apenas um asterisco (*texto*) já que é o padrão do WhatsApp, ou não use formatação
- Para cotações, preços específicos, catálogo detalhado ou negociações, sempre direcione o cliente para falar com um especialista pelo WhatsApp +55 (81) 99253-9017, explicando que lá ele terá um atendimento mais completo e personalizado
- Se não souber responder algo específico, seja honesto e ofereça o mesmo contato humano
- Nunca afirme que a TGX atende só empresas ou só B2B - atendemos B2B, B2C e envios avulsos
- Nunca afirme que os serviços só podem ser contratados em conjunto - eles são modulares e podem ser combinados como o cliente precisar`;

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

async function processMessage(message) {
  const from = message.from;
  const text = message.text?.body || '';
  console.log(`Mensagem de ${from}: ${text}`);

  // Se é a primeira vez que esse número fala com o bot, cria o lead no RD Station CRM.
  // Roda em paralelo (não usa await bloqueante) pra não atrasar a resposta no WhatsApp;
  // se o RD Station falhar, o bot continua funcionando normalmente.
  const isNewContact = !conversations[from];
  if (isNewContact) {
    conversations[from] = [];
    createLeadDeal(from).catch(err => console.error('Erro ao criar lead no RD Station:', err));
  }

  try {
    const reply = await askClaude(from, text);
    console.log(`Resposta do Claude: ${reply}`);
    await sendWhatsAppMessage(from, reply);
  } catch (err) {
    console.error('Erro ao processar mensagem:', err);
    await sendWhatsAppMessage(
      from,
      'Desculpe, tive um problema técnico agora. Pode tentar novamente em instantes?'
    ).catch(sendErr => console.error('Erro ao avisar o usuário do problema:', sendErr));
  }
}

app.post('/webhook', (req, res) => {
  // Responde imediatamente pra Meta não reenviar o mesmo webhook por timeout.
  res.sendStatus(200);

  const entry = req.body.entry?.[0];
  const change = entry?.changes?.[0];
  const message = change?.value?.messages?.[0];

  if (message && !alreadyProcessed(message.id)) {
    processMessage(message).catch(err => console.error('Erro no processamento da mensagem:', err));
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Rodando na porta ${PORT}`));
