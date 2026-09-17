const express = require('express');
const app = express();

app.use(express.json());

const {
  createLeadDeal,
  addNoteToDeal,
  updateDealStage
} = require('./rdstation');

const {
  findClientById,
  findClientByCpfCnpj,
  findClientByPhone,
  findQuoteRequest,
  normalizeText,
  normalizePhone
} = require('./sheets');

const VERIFY_TOKEN = process.env.VERIFY_TOKEN || 'minha_verificacao_2026';
const WHATSAPP_TOKEN = process.env.WHATSAPP_TOKEN;
const PHONE_NUMBER_ID = process.env.PHONE_NUMBER_ID;
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
const ANTHROPIC_MODEL = process.env.ANTHROPIC_MODEL || 'claude-sonnet-4-6';

const FORM_CADASTRO_URL = 'https://forms.gle/oxVrjQSmqK7JpCqq9';
const FORM_ORCAMENTO_URL = 'https://forms.gle/tGmWyBPDUoZXwZLw9';

const HUMAN_WHATSAPP = '+55 (81) 99253-9017';
const HUMAN_HOURS = 'Segunda a sexta, 09:00 às 17:00';

/*
|--------------------------------------------------------------------------
| MEMÓRIA TEMPORÁRIA
|--------------------------------------------------------------------------
*/

const conversations = {};
const leadStates = {};
const leadDeals = {};
const processedMessageIds = new Set();

/*
|--------------------------------------------------------------------------
| CONTROLE DE MENSAGENS DUPLICADAS
|--------------------------------------------------------------------------
*/

function alreadyProcessed(messageId) {
  if (!messageId) return false;

  if (processedMessageIds.has(messageId)) {
    return true;
  }

  processedMessageIds.add(messageId);

  if (processedMessageIds.size > 500) {
    const oldest = processedMessageIds.values().next().value;
    processedMessageIds.delete(oldest);
  }

  return false;
}

/*
|--------------------------------------------------------------------------
| ESTÁGIOS RD STATION
|--------------------------------------------------------------------------
*/

const RD_STAGES = {
  semContato: process.env.RDSTATION_STAGE_SEM_CONTATO,
  contatoFeito: process.env.RDSTATION_STAGE_CONTATO_FEITO,
  identificacao: process.env.RDSTATION_STAGE_IDENTIFICACAO,
  apresentacao: process.env.RDSTATION_STAGE_APRESENTACAO,
  proposta: process.env.RDSTATION_STAGE_PROPOSTA
};

/*
|--------------------------------------------------------------------------
| ESTADO INICIAL DO LEAD
|--------------------------------------------------------------------------
*/

function createInitialState() {
  return {
    cliente: {
      id: null,
      cpf: null,
      cnpj: null,
      nome: null,
      razao_social: null,
      email: null,
      telefone: null,
      cidade: null,
      estado: null,
      cadastro_localizado: false,
      dados_planilha: null
    },
    fluxo: {
      etapa: 'identificacao',
      identificacao_status: 'aguardando_id',
      aguardando_cadastro: false
    },
    empresa: {
      razao_social: null,
      nome_fantasia: null,
      cnpj: null,
      segmento: null,
      cidade: null,
      estado: null
    },
    contato: {
      nome: null,
      sobrenome: null,
      telefone: null,
      email: null,
      cargo: null,
      canal_preferencial: 'WhatsApp',
      origem_contato: 'WhatsApp Bot'
    },
    oportunidade: {
      servico: null,
      tipo: null,
      modalidade_transporte: null,
      origem: { cidade: null, estado: null, cep: null },
      destino: { cidade: null, estado: null, cep: null },
      carga: {
        tipo: null,
        quantidade_volumes: null,
        peso_total: null,
        dimensoes: null,
        valor_mercadoria: null
      },
      prazo: { data_desejada: null, urgencia: null },
      comercial: {
        frequencia: null,
        fornecedor_atual: null,
        principal_problema: null
      },
      status: 'Oportunidade Criada',
      pronto_para_vendedor: false,
      cliente_confirmou_dados: false
    },
    atendimento: {
      etapa: 'identificacao',
      servico_identificado: false,
      qualificacao_concluida: false,
      aguardando_form_orcamento: false,
      handoff: false,
      conversation_status: 'Em atendimento'
    }
  };
}

/*
|--------------------------------------------------------------------------
| SERVIÇOS OFICIAIS TGX
|--------------------------------------------------------------------------
*/

const TGX_SERVICES = [
  'Transporte',
  'Armazenagem',
  'Fulfillment',
  'Distribuição',
  'Cross-Docking',
  'Logística Internacional',
  'Serviços de Valor Agregado',
  'Containers'
];

/*
|--------------------------------------------------------------------------
| SYSTEM PROMPT (CLAUDE)
|--------------------------------------------------------------------------
*/

const SYSTEM_PROMPT = `
Você é o Assistente Comercial da TGX Cargo.

Sua função é atender clientes pelo WhatsApp, entender a necessidade comercial,
qualificar o contato, coletar informações relevantes e preparar uma oportunidade
estruturada para um vendedor da TGX.

==================================================
0. IDENTIFICAÇÃO INICIAL DO CLIENTE
==================================================

O sistema já conduz a identificação inicial antes de chegar até você.

Quando o cliente for identificado, os dados aparecerão no campo "cliente"
do ESTADO ATUAL DA QUALIFICAÇÃO.

NÃO peça novamente ID, CPF ou CNPJ depois que o cliente já foi identificado.

Formulário de Cadastro de Cliente:
https://forms.gle/oxVrjQSmqK7JpCqq9

==================================================
0.1. SOLICITAÇÃO DE ORÇAMENTO
==================================================

Quando o cliente quiser solicitar um orçamento, oriente-o a preencher:

Formulário de Solicitação de Orçamento:
https://forms.gle/tGmWyBPDUoZXwZLw9

Nesse momento, defina no state_update:
"atendimento": { "aguardando_form_orcamento": true }

==================================================
1. SOBRE A TGX
==================================================

A TGX Cargo atua em logística e transporte com serviços modulares.

O cliente pode contratar apenas um serviço ou combinar vários.

A TGX atende: B2B, B2C, pessoas físicas, envios avulsos.

==================================================
2. SERVIÇOS OFICIAIS
==================================================

1. Transporte
2. Armazenagem
3. Fulfillment
4. Distribuição
5. Cross-Docking
6. Logística Internacional
7. Serviços de Valor Agregado
8. Containers

==================================================
3. MODALIDADES DE TRANSPORTE
==================================================

- Express: até 70 kg/despacho, 23 kg/volume, 1,20m maior dimensão
- Turbo: até 70 kg/despacho, 23 kg/volume, 1,20m maior dimensão
- Standard: despacho acima de 70 kg, 23 kg/volume
- Home Delivery: até 70 kg/despacho, 23 kg/volume, 1,20m maior dimensão
- TGX Hoje: coleta/entrega mesmo dia, 08:00-18:00, 30 kg/volume ou 1.000 kg/pallet PBR
- Containers: operações relacionadas a contêineres

Nunca garanta modalidade, preço ou prazo sem validação.

==================================================
4. REGRAS GERAIS
==================================================

- Nunca invente preço, prazo, cobertura ou disponibilidade
- Não atende: produtos químicos, farmacêuticos, cargas perigosas
- Colete informações naturalmente, sem interrogatório
- Não pergunte novamente o que já foi informado
- WhatsApp já é o telefone do contato
- Nome e e-mail NÃO significam fim da qualificação
- Só marque ready_for_seller=true após confirmação do cliente

==================================================
5. SAÍDA OBRIGATÓRIA (JSON)
==================================================

{
  "reply": "mensagem ao cliente",
  "state_update": { "empresa": {}, "contato": {}, "oportunidade": {}, "atendimento": {} },
  "next_question": "próxima pergunta",
  "missing_fields": [],
  "ready_for_seller": false,
  "customer_confirmation_required": false,
  "handoff_reason": null,
  "seller_summary": null,
  "conversation_status": "Em atendimento"
}

NÃO altere os campos "cliente" e "fluxo" no state_update.
`;

/*
|--------------------------------------------------------------------------
| FUNÇÕES AUXILIARES
|--------------------------------------------------------------------------
*/

function deepMerge(target, source) {
  if (!source || typeof source !== 'object') return target;

  for (const key of Object.keys(source)) {
    const value = source[key];

    if (
      value &&
      typeof value === 'object' &&
      !Array.isArray(value) &&
      target[key] &&
      typeof target[key] === 'object' &&
      !Array.isArray(target[key])
    ) {
      deepMerge(target[key], value);
    } else if (value !== undefined) {
      target[key] = value;
    }
  }

  return target;
}

function ensureState(from) {
  if (!leadStates[from]) {
    leadStates[from] = createInitialState();
  }
  return leadStates[from];
}

function ensureConversation(from) {
  if (!conversations[from]) {
    conversations[from] = [];
  }
  return conversations[from];
}

function ensureContactPhone(from) {
  const state = ensureState(from);
  if (from) {
    state.contato.telefone = from;
  }
  return state;
}

function recordExchange(from, userText, assistantReply) {
  const conversation = ensureConversation(from);
  conversation.push({ role: 'user', content: userText });
  conversation.push({ role: 'assistant', content: assistantReply });
}

/*
|--------------------------------------------------------------------------
| HELPERS DE IDENTIFICAÇÃO
|--------------------------------------------------------------------------
*/

function isNotKnowingId(text) {
  const t = normalizeText(text);
  if (!t) return false;
  if (t === 'nao' || t === 'n') return true;

  const keywords = [
    'naosei', 'naolembro', 'naotenho', 'naosabe', 'esqueci',
    'naomelembro', 'naosaberia', 'naotenhooid', 'naolembrodoid',
    'naotenhocadastro', 'naoseimeu', 'naotenhoid'
  ];

  return keywords.some(k => t.includes(k));
}

function mentionsCpfCnpj(text) {
  const t = normalizeText(text);
  return t.includes('cpf') || t.includes('cnpj');
}

function extractDocument(text) {
  const matches = String(text).match(/\d[\d.\-/]*\d/g) || [];

  for (const m of matches) {
    const digits = m.replace(/\D/g, '');

    if (digits.length === 11) {
      return { type: 'cpf', value: digits };
    }

    if (digits.length === 14) {
      return { type: 'cnpj', value: digits };
    }
  }

  return null;
}

function extractIdCandidate(text) {
  const t = String(text).trim();

  const idMatch = t.match(/(?:id|cliente)[\s:é]*([A-Za-z0-9\-.]{2,})/i);
  if (idMatch) {
    return idMatch[1];
  }

  const tokens = t.split(/\s+/).filter(Boolean);
  if (tokens.length === 1) {
    return tokens[0];
  }

  return tokens[tokens.length - 1];
}

function isFillConfirmation(text) {
  const t = normalizeText(text);
  if (!t) return false;

  const negatives = [
    'naopreenchi', 'naoterminei', 'aindanao',
    'naofinalizei', 'naoenviei', 'aindanaopreenchi'
  ];

  if (negatives.some(k => t.includes(k))) {
    return false;
  }

  const positives = [
    'preenchi', 'preenchido', 'terminei', 'finalizei',
    'enviei', 'enviado', 'pronto', 'feito', 'conclui',
    'japreenchi', 'ok'
  ];

  return positives.some(k => t.includes(k));
}

function buildReply(reply, extra = {}) {
  return {
    reply,
    state_update: {},
    next_question: null,
    missing_fields: [],
    ready_for_seller: extra.ready_for_seller || false,
    customer_confirmation_required: false,
    handoff_reason: extra.handoff_reason || null,
    seller_summary: extra.seller_summary || null,
    conversation_status: extra.conversation_status || 'Em atendimento'
  };
}

function buildGreeting() {
  return 'Olá! 👋 Bem-vindo(a) ao atendimento da *TGX Cargo*!\n\n' +
    'Para iniciar, me informe o seu *ID de Cliente* (o número gerado no seu cadastro).\n\n' +
    'Caso não lembre o ID, fique tranquilo: você pode me enviar o seu *CPF* ou *CNPJ* que eu localizo o seu cadastro. 😉';
}

function applyIdentifiedClient(from, client, state, via) {
  state.cliente.id = client.id || state.cliente.id;
  state.cliente.cpf = client.cpf || state.cliente.cpf;
  state.cliente.cnpj = client.cnpj || state.cliente.cnpj;
  state.cliente.nome = client.nome || state.cliente.nome;
  state.cliente.razao_social = client.razao_social || state.cliente.razao_social;
  state.cliente.email = client.email || state.cliente.email;
  state.cliente.telefone = client.telefone || from;
  state.cliente.cidade = client.cidade || state.cliente.cidade;
  state.cliente.estado = client.estado || state.cliente.estado;
  state.cliente.cadastro_localizado = true;
  state.cliente.dados_planilha = client._raw || null;

  if (client.nome) {
    const parts = String(client.nome).trim().split(/\s+/);
    if (parts.length) {
      state.contato.nome = parts[0];
    }
    if (parts.length > 1) {
      state.contato.sobrenome = parts.slice(1).join(' ');
    }
  }

  if (client.email) {
    state.contato.email = client.email;
  }

  if (client.cnpj) {
    state.empresa.cnpj = client.cnpj;
  }

  if (client.razao_social) {
    state.empresa.razao_social = client.razao_social;
  }

  if (client.cidade) {
    state.empresa.cidade = client.cidade;
  }

  if (client.estado) {
    state.empresa.estado = client.estado;
  }

  state.contato.telefone = from;
  state.fluxo.identificacao_status = 'identificado';
  state.fluxo.aguardando_cadastro = false;
  state.fluxo.etapa = 'atendimento';
  state.atendimento.etapa = 'atendimento';

  const primeiroNome = client.nome
    ? ', ' + String(client.nome).trim().split(/\s+/)[0]
    : '';

  const idInfo = client.id
    ? 'Seu ID de cliente é: *' + client.id + '*\n\n'
    : '';

  const reply = '✅ Cadastro localizado' + primeiroNome + '!\n\n' +
    idInfo +
    'Como posso ajudar você hoje? 😊';

  return buildReply(reply);
}

/*
|--------------------------------------------------------------------------
| FLUXO DE IDENTIFICAÇÃO
|--------------------------------------------------------------------------
*/

async function handleIdStep(from, text, state) {
  if (isNotKnowingId(text)) {
    state.fluxo.identificacao_status = 'aguardando_cpf_cnpj';

    return buildReply(
      'Sem problemas! 😉 Para localizar seu cadastro, me informe o seu *CPF* (11 dígitos) ou *CNPJ* (14 dígitos).'
    );
  }

  if (mentionsCpfCnpj(text)) {
    const doc = extractDocument(text);

    if (doc) {
      return handleCpfCnpjSearch(from, doc, state);
    }
  }

  const id = extractIdCandidate(text);

  let client = null;

  try {
    client = await findClientById(id);
  } catch (err) {
    console.error('Erro ao buscar ID na planilha:', err);

    return buildReply(
      'Tive um problema ao consultar nosso sistema agora. 😕 Poderia tentar novamente em instantes?'
    );
  }

  if (client) {
    return applyIdentifiedClient(from, client, state, 'id');
  }

  state.fluxo.identificacao_status = 'aguardando_cpf_cnpj';

  return buildReply(
    'Não localizei nenhum cadastro com esse ID. 😕\n\n' +
    'Para te ajudar, me informa o seu *CPF* (11 dígitos) ou *CNPJ* (14 dígitos) que eu busco na nossa base.'
  );
}

async function handleCpfCnpjStep(from, text, state) {
  const doc = extractDocument(text);

  if (!doc) {
    return buildReply(
      'Não consegui identificar o número. 🤔 Me envie apenas os números do seu *CPF* (11 dígitos) ou *CNPJ* (14 dígitos).'
    );
  }

  return handleCpfCnpjSearch(from, doc, state);
}

async function handleCpfCnpjSearch(from, doc, state) {
  let client = null;

  try {
    client = await findClientByCpfCnpj(doc.value);
  } catch (err) {
    console.error('Erro ao buscar CPF/CNPJ na planilha:', err);

    return buildReply(
      'Tive um problema ao consultar nosso sistema agora. 😕 Poderia tentar novamente em instantes?'
    );
  }

  if (client) {
    return applyIdentifiedClient(from, client, state, doc.type);
  }

  state.fluxo.identificacao_status = 'aguardando_cadastro';
  state.fluxo.aguardando_cadastro = true;

  const label = doc.type === 'cpf' ? 'CPF' : 'CNPJ';

  return buildReply(
    'Não encontrei nenhum cadastro com esse ' + label + ' em nossa base. 😕\n\n' +
    'Para seguirmos com seu atendimento, é necessário realizar o seu cadastro. ' +
    'Por favor, preencha o formulário abaixo:\n\n' +
    '📋 *Cadastro de Cliente*\n' + FORM_CADASTRO_URL + '\n\n' +
    'Assim que terminar, me chame aqui novamente que eu já localizo os seus dados! 😉'
  );
}

async function handleCadastroStep(from, text, state) {
  if (!isFillConfirmation(text)) {
    return buildReply(
      'Certo! Assim que você finalizar o preenchimento do formulário de cadastro, ' +
      'me avise aqui que eu localizo os seus dados. 😉\n\n' +
      '📋 *Cadastro de Cliente*\n' + FORM_CADASTRO_URL
    );
  }

  let client = null;

  try {
    client = await findClientByPhone(normalizePhone(from));
  } catch (err) {
    console.error('Erro ao buscar cadastro por telefone:', err);

    return buildReply(
      'Tive um problema ao consultar nosso sistema agora. 😕 Poderia tentar novamente em instantes?'
    );
  }

  if (client) {
    return applyIdentifiedClient(from, client, state, 'cadastro');
  }

  return buildReply(
    'Ainda não localizei seu cadastro em nossa base. 😕\n\n' +
    'Pode ser que leve alguns instantes para o formulário atualizar nossos registros. ' +
    'Confirme se você finalizou o envio e tente novamente em instantes. 🙏'
  );
}

async function handleIdentificationFlow(from, text, state) {
  const status = state.fluxo.identificacao_status;

  if (status === 'aguardando_id') {
    return handleIdStep(from, text, state);
  }

  if (status === 'aguardando_cpf_cnpj') {
    return handleCpfCnpjStep(from, text, state);
  }

  if (status === 'aguardando_cadastro') {
    return handleCadastroStep(from, text, state);
  }

  return null;
}

/*
|--------------------------------------------------------------------------
| CONFIRMAÇÃO DE SOLICITAÇÃO DE ORÇAMENTO
|--------------------------------------------------------------------------
*/

async function handleQuoteConfirmation(from, text, state) {
  if (!isFillConfirmation(text)) {
    return null;
  }

  let quote = null;

  try {
    quote = await findQuoteRequest({
      id: state.cliente.id,
      cpf: state.cliente.cpf,
      cnpj: state.cliente.cnpj,
      phone: normalizePhone(from)
    });
  } catch (err) {
    console.error('Erro ao buscar solicitação de orçamento:', err);

    return buildReply(
      'Tive um problema ao consultar nosso sistema agora. 😕 Poderia tentar novamente em instantes?'
    );
  }

  if (quote) {
    state.atendimento.aguardando_form_orcamento = false;
    state.atendimento.handoff = true;
    state.atendimento.qualificacao_concluida = true;
    state.atendimento.conversation_status = 'Encaminhado ao vendedor';

    state.oportunidade.solicitacao_orcamento_id = quote.solicitacao_id || null;
    state.oportunidade.status = 'Solicitação de Orçamento';
    state.oportunidade.pronto_para_vendedor = true;
    state.oportunidade.cliente_confirmou_dados = true;

    const idPart = quote.solicitacao_id
      ? 'Seu ID da Solicitação de Orçamento é: *' + quote.solicitacao_id + '*\n\n'
      : '';

    const reply = '✅ Confirmei o preenchimento do seu formulário de Solicitação de Orçamento!\n\n' +
      idPart +
      'Sua solicitação foi efetuada com *sucesso* e estou encaminhando para um *Executivo de Vendas* dar continuidade ao seu atendimento. \n\n' +
      'Em breve entraremos em contato. Qualquer dúvida, estou à disposição!';

    return buildReply(reply, {
      ready_for_seller: true,
      handoff_reason: 'Solicitação de orçamento confirmada na planilha',
      seller_summary: 'Solicitação de Orçamento confirmada. ID: ' + (quote.solicitacao_id || 'N/D'),
      conversation_status: 'Encaminhado ao vendedor'
    });
  }

  return buildReply(
    'Ainda não localizei sua Solicitação de Orçamento em nossa base. \n\n' +
    'Pode ser que leve alguns instantes para o formulário atualizar nossos registros. ' +
    'Confirme se você finalizou o envio e tente novamente em instantes. 🙏'
  );
}

/*
|--------------------------------------------------------------------------
| EXTRAI JSON DO CLAUDE
|--------------------------------------------------------------------------
*/

function extractJson(text) {
  if (!text) return null;

  try {
    return JSON.parse(text);
  } catch (_) {}

  const fenced = text.match(/```json\s*([\s\S]*?)\s*```/i);
  if (fenced) {
    try {
      return JSON.parse(fenced[1]);
    } catch (_) {}
  }

  const firstBrace = text.indexOf('{');
  const lastBrace = text.lastIndexOf('}');

  if (firstBrace !== -1 && lastBrace !== -1) {
    const possibleJson = text.slice(firstBrace, lastBrace + 1);
    try {
      return JSON.parse(possibleJson);
    } catch (_) {}
  }

  return null;
}

/*
|--------------------------------------------------------------------------
| CLAUDE
|--------------------------------------------------------------------------
*/

async function askClaude(from, userText) {
  const state = ensureContactPhone(from);
  const conversation = ensureConversation(from);

  conversation.push({ role: 'user', content: userText });

  const history = conversation.slice(-12);

  const contextMessage = `
ESTADO ATUAL DA QUALIFICAÇÃO:

${JSON.stringify(state, null, 2)}

REGRAS IMPORTANTES:

- Não pergunte novamente informações que já estejam preenchidas.
- Use a mensagem atual e o histórico para identificar novas informações.
- Atualize somente o que mudou.
- Escolha apenas a próxima pergunta mais importante.
- Não trate nome ou e-mail como sinal de encerramento da qualificação.
- O telefone do WhatsApp já é o telefone do contato.
- Continue a qualificação enquanto houver informação relevante de alto valor.
- Se os dados estiverem suficientes, primeiro solicite confirmação do resumo.
- Somente depois da confirmação marque ready_for_seller como true.
- Nunca marque ready_for_seller como true apenas porque nome e/ou e-mail foram informados.
- Não altere os campos "cliente" e "fluxo" do estado.

HISTÓRICO RECENTE:

${JSON.stringify(history, null, 2)}

MENSAGEM ATUAL:

${userText}
`;

  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01',
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      model: ANTHROPIC_MODEL,
      max_tokens: 1400,
      system: SYSTEM_PROMPT,
      messages: [{ role: 'user', content: contextMessage }]
    })
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Erro Anthropic ${response.status}: ${errorText}`);
  }

  const data = await response.json();
  const rawReply = data.content?.find(item => item.type === 'text')?.text || '';
  const parsed = extractJson(rawReply);

  if (!parsed) {
    conversation.push({ role: 'assistant', content: rawReply });

    return {
      reply: rawReply,
      state_update: {},
      next_question: null,
      missing_fields: [],
      ready_for_seller: false,
      customer_confirmation_required: false,
      handoff_reason: null,
      seller_summary: null,
      conversation_status: 'Em atendimento'
    };
  }

  if (parsed.state_update) {
    const safeUpdate = { ...parsed.state_update };
    delete safeUpdate.cliente;
    delete safeUpdate.fluxo;
    deepMerge(state, safeUpdate);
  }

  state.contato.telefone = from;

  if (parsed.ready_for_seller === true) {
    state.oportunidade.pronto_para_vendedor = true;
    state.atendimento.handoff = true;
    state.atendimento.qualificacao_concluida = true;
    state.atendimento.conversation_status = 'Encaminhado ao vendedor';
  }

  if (state.oportunidade.servico) {
    state.atendimento.servico_identificado = true;
  }

  conversation.push({ role: 'assistant', content: parsed.reply || '' });

  return {
    reply: parsed.reply || 'Perfeito. Vou verificar as informações para você.',
    state_update: parsed.state_update || {},
    next_question: parsed.next_question || null,
    missing_fields: Array.isArray(parsed.missing_fields) ? parsed.missing_fields : [],
    ready_for_seller: parsed.ready_for_seller === true,
    customer_confirmation_required: parsed.customer_confirmation_required === true,
    handoff_reason: parsed.handoff_reason || null,
    seller_summary: parsed.seller_summary || null,
    conversation_status: parsed.conversation_status || 'Em atendimento'
  };
}

/*
|--------------------------------------------------------------------------
| ENVIO WHATSAPP
|--------------------------------------------------------------------------
*/

async function sendWhatsAppMessage(to, text) {
  const response = await fetch(
    `https://graph.facebook.com/v21.0/${PHONE_NUMBER_ID}/messages`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${WHATSAPP_TOKEN}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        messaging_product: 'whatsapp',
        to: to,
        text: { body: text }
      })
    }
  );

  const result = await response.json();

  console.log('Status envio:', response.status, JSON.stringify(result));

  if (!response.ok) {
    throw new Error(`Erro WhatsApp ${response.status}: ${JSON.stringify(result)}`);
  }

  return result;
}

/*
|--------------------------------------------------------------------------
| REGISTRO NO RD
|--------------------------------------------------------------------------
*/

function buildSellerNote(from, userText, botResult) {
  const state = ensureContactPhone(from);

  const oportunidadeNote = JSON.parse(JSON.stringify(state.oportunidade));

  if (oportunidadeNote.servico === 'Transporte' && !oportunidadeNote.modalidade_transporte) {
    oportunidadeNote.modalidade_transporte = 'A validar';
  }

  return `
QUALIFICAÇÃO COMERCIAL TGX

Cliente: ${JSON.stringify(state.cliente, null, 2)}
Empresa: ${JSON.stringify(state.empresa, null, 2)}
Contato: ${JSON.stringify(state.contato, null, 2)}
Oportunidade: ${JSON.stringify(oportunidadeNote, null, 2)}

Última mensagem do cliente: ${userText}
Resposta do bot: ${botResult.reply}
Ready para vendedor: ${botResult.ready_for_seller}
Motivo do handoff: ${botResult.handoff_reason || 'Não informado'}
Resumo para vendedor: ${botResult.seller_summary || 'Ainda não gerado'}
Status da conversa: ${botResult.conversation_status}
`;
}

async function recordDeal(from, userText, botResult, isNewContact, dealPromise) {
  if (isNewContact && dealPromise) {
    const dealId = await dealPromise;
    if (dealId) {
      leadDeals[from] = dealId;
    }
  }

  const dealId = leadDeals[from];

  if (dealId) {
    const note = buildSellerNote(from, userText, botResult);

    addNoteToDeal(dealId, note).catch(err => {
      console.error('Erro ao adicionar anotação no RD Station:', err);
    });

    const state = ensureState(from);
    const desiredStage = botResult.ready_for_seller
      ? RD_STAGES.identificacao
      : RD_STAGES.contatoFeito;

    if (desiredStage) {
      await updateDealStage(dealId, desiredStage);
    }
  }
}

/*
|--------------------------------------------------------------------------
| PROCESSAMENTO DA MENSAGEM
|--------------------------------------------------------------------------
*/

async function processMessage(message) {
  const from = message.from;
  const text = message.text?.body || '';

  console.log(`Mensagem de ${from}: ${text}`);

  const state = ensureContactPhone(from);
  const isNewContact = !conversations[from];

  let dealPromise = null;

  if (isNewContact) {
    ensureConversation(from);

    dealPromise = createLeadDeal(from).catch(err => {
      console.error('Erro ao criar lead no RD Station:', err);
      return null;
    });
  }

  try {
    // 1) PRIMEIRA MENSAGEM
    if (isNewContact) {
      state.fluxo.identificacao_status = 'aguardando_id';

      const reply = buildGreeting();

      recordExchange(from, text, reply);
      await sendWhatsAppMessage(from, reply);
      await recordDeal(from, text, buildReply(reply), isNewContact, dealPromise);

      return;
    }

    // 2) FLUXO DE IDENTIFICAÇÃO
    const identificationResult = await handleIdentificationFlow(from, text, state);

    if (identificationResult) {
      recordExchange(from, text, identificationResult.reply);
      await sendWhatsAppMessage(from, identificationResult.reply);
      await recordDeal(from, text, identificationResult, isNewContact, dealPromise);

      return;
    }

    // 3) CONFIRMAÇÃO DE SOLICITAÇÃO DE ORÇAMENTO
    if (state.atendimento.aguardando_form_orcamento) {
      const quoteResult = await handleQuoteConfirmation(from, text, state);

      if (quoteResult) {
        recordExchange(from, text, quoteResult.reply);
        await sendWhatsAppMessage(from, quoteResult.reply);
        await recordDeal(from, text, quoteResult, isNewContact, dealPromise);

        return;
      }
    }

    // 4) CLAUDE QUALIFICA
    const botResult = await askClaude(from, text);

    console.log('Resposta estruturada do Claude:', JSON.stringify(botResult, null, 2));

    await sendWhatsAppMessage(from, botResult.reply);
    await recordDeal(from, text, botResult, isNewContact, dealPromise);

    if (botResult.ready_for_seller) {
      console.log(`HANDOFF NECESSÁRIO para ${from}`);
    }

  } catch (err) {
    console.error('Erro ao processar mensagem:', err);

    await sendWhatsAppMessage(
      from,
      'Desculpe, tive um problema técnico agora. Pode tentar novamente em instantes?'
    ).catch(sendErr => {
      console.error('Erro ao avisar o usuário:', sendErr);
    });
  }
}

/*
|--------------------------------------------------------------------------
| WEBHOOK META - VERIFICAÇÃO
|--------------------------------------------------------------------------
*/

app.get('/webhook', (req, res) => {
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];

  if (mode === 'subscribe' && token === VERIFY_TOKEN) {
    console.log('Webhook verificado com sucesso!');
    return res.status(200).send(challenge);
  }

  return res.sendStatus(403);
});

/*
|--------------------------------------------------------------------------
| WEBHOOK META - MENSAGENS
|--------------------------------------------------------------------------
*/

app.post('/webhook', (req, res) => {
  res.sendStatus(200);

  const entry = req.body.entry?.[0];
  const change = entry?.changes?.[0];
  const message = change?.value?.messages?.[0];

  if (message && !alreadyProcessed(message.id)) {
    processMessage(message).catch(err => {
      console.error('Erro no processamento:', err);
    });
  }
});

/*
|--------------------------------------------------------------------------
| HEALTH CHECK
|--------------------------------------------------------------------------
*/

app.get('/', (req, res) => {
  res.status(200).json({
    status: 'online',
    service: 'TGX Cargo Bot',
    model: ANTHROPIC_MODEL,
    services: TGX_SERVICES,
    forms: {
      cadastro: FORM_CADASTRO_URL,
      orcamento: FORM_ORCAMENTO_URL
    }
  });
});

/*
|--------------------------------------------------------------------------
| SERVIDOR
|--------------------------------------------------------------------------
*/

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log(`TGX Bot rodando na porta ${PORT}`);
});
