const express = require('express');
const app = express();

app.use(express.json());

const { createLeadDeal, addNoteToDeal } = require('./rdstation');

const VERIFY_TOKEN = process.env.VERIFY_TOKEN || 'minha_verificacao_2026';
const WHATSAPP_TOKEN = process.env.WHATSAPP_TOKEN;
const PHONE_NUMBER_ID = process.env.PHONE_NUMBER_ID;
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;

const HUMAN_WHATSAPP = '+55 (81) 99253-9017';
const HUMAN_HOURS = 'Segunda a sexta, 09:00 às 17:00';

/*
|--------------------------------------------------------------------------
| MEMÓRIA TEMPORÁRIA
|--------------------------------------------------------------------------
|
| ATENÇÃO:
| Esta memória existe somente enquanto o processo Node.js estiver rodando.
| Depois podemos migrar para Supabase/Redis/PostgreSQL.
|
*/

const conversations = {};
const leadStates = {};
const leadDeals = {};

/*
|--------------------------------------------------------------------------
| CONTROLE DE MENSAGENS DUPLICADAS
|--------------------------------------------------------------------------
*/

const processedMessageIds = new Set();

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
| ESTADO INICIAL DO LEAD
|--------------------------------------------------------------------------
*/

function createInitialState() {
  return {
    empresa: {
      razao_social: null,
      nome_fantasia: null,
      cnpj: null,
      segmento: null,
      porte: null,
      cidade: null,
      estado: null,
      site: null,
      status_conta: null,
      classificacao_abc: null,
      servicos_utilizados: [],
      servicos_com_potencial: [],
      origem_principal: null
    },

    contato: {
      nome: null,
      sobrenome: null,
      telefone: null,
      email: null,
      cargo: null,
      departamento: null,
      funcao_processo_compra: null,
      e_decisor: null,
      canal_preferencial: 'WhatsApp',
      origem_contato: 'WhatsApp Bot'
    },

    oportunidade: {
      nome: null,
      servico: null,
      tipo: null,
      modalidade_transporte: null,
      tipo_demanda: null,
      frequencia: null,

      origem: {
        cep: null,
        cidade: null,
        estado: null,
        endereco: null,
        numero: null,
        complemento: null,
        bairro: null,
        tipo_local: null
      },

      destino: {
        cep: null,
        cidade: null,
        estado: null,
        endereco: null,
        numero: null,
        complemento: null,
        bairro: null,
        tipo_local: null
      },

      operacao: null,

      carga: {
        tipo: null,
        descricao: null,
        quantidade_volumes: null,
        peso_total: null,
        peso_por_volume: null,
        comprimento: null,
        largura: null,
        altura: null,
        maior_dimensao: null,
        valor_mercadoria: null,
        embalagem: null,
        paletizada: null,
        quantidade_pallets: null,
        tipo_pallet: null,
        peso_por_pallet: null,
        altura_pallet: null,
        padrao_pbr: null
      },

      prazo: {
        data_coleta: null,
        data_entrega: null,
        data_desejada: null,
        prazo_maximo: null,
        horario_limite: null,
        urgencia: null,
        prazo_fator_decisivo: null
      },

      comercial: {
        como_opera_hoje: null,
        fornecedor_atual: null,
        principal_problema: null,
        criterio_decisao: null,
        concorrente: null,
        estagio_compra: null,
        valor_estimado: null,
        valor_oportunidade: null,
        condicao_comercial: null,
        forma_pagamento: null,
        decisor: null,
        observacoes: null
      },

      validacao: {
        elegibilidade: null,
        observacoes: null,
        dados_pendentes: []
      },

      status: 'Oportunidade Criada',
      motivo_perda: null,
      proxima_acao: null,
      data_proxima_acao: null,
      pronto_para_vendedor: false,
      cliente_confirmou_dados: false
    },

    atendimento: {
      etapa: 'identificacao',
      servico_identificado: false,
      qualificacao_concluida: false,
      aguardando_confirmacao: false,
      handoff: false,

      follow_up_required: false,
      follow_up_reason: null,
      follow_up_stage: null,
      follow_up_message: null,
      follow_up_after_minutes: null,
      follow_up_attempt: 0,
      next_pending_field: null,
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

const TRANSPORT_MODALITIES = [
  'Express',
  'Turbo',
  'Standard',
  'Home Delivery',
  'TGX Hoje',
  'Containers'
];

/*
|--------------------------------------------------------------------------
| INSTRUÇÃO MESTRA DO CLAUDE
|--------------------------------------------------------------------------
*/

const SYSTEM_PROMPT = `
Você é o Assistente Comercial da TGX Cargo.

Sua função é atender clientes pelo WhatsApp, entender a necessidade comercial,
qualificar o contato, coletar informações relevantes e preparar uma oportunidade
estruturada para um vendedor da TGX.

Você NÃO é apenas um chatbot institucional.

Você é o primeiro coletor e organizador de informações do processo comercial.

O vendedor humano será responsável por interpretar a necessidade, validar a
operação, elaborar ou validar a cotação, negociar e fechar.

==================================================
1. SOBRE A TGX
==================================================

A TGX Cargo atua em logística e transporte.

Os serviços são MODULARES.

O cliente pode contratar apenas um serviço ou combinar vários serviços.

Exemplos:

- somente Transporte;
- somente Armazenagem;
- Armazenagem + Distribuição;
- Fulfillment + Distribuição;
- Transporte + Armazenagem;
- operação integrada de vários serviços.

A TGX atende:

- B2B;
- B2C;
- pessoas físicas;
- envios avulsos.

Nunca diga que a TGX atende somente empresas.

==================================================
2. SERVIÇOS OFICIAIS
==================================================

Os serviços da TGX são:

1. Transporte
2. Armazenagem
3. Fulfillment
4. Distribuição
5. Cross-Docking
6. Logística Internacional
7. Serviços de Valor Agregado
8. Containers

Quando o cliente demonstrar uma necessidade, identifique primeiro qual serviço
ou combinação de serviços faz mais sentido.

==================================================
3. MODALIDADES DE TRANSPORTE
==================================================

Dentro de Transporte existem atualmente:

- Express
- Turbo
- Standard
- Home Delivery
- TGX Hoje
- Containers

Não escolha uma modalidade apenas pelo nome informado pelo cliente.

Primeiro entenda a operação.

Nunca garanta uma modalidade, preço, prazo ou disponibilidade sem validação.

==================================================
4. REGRAS DE TRANSPORTE
==================================================

Express:

- até 70 kg por despacho;
- até 23 kg por volume;
- maior dimensão de até 1,20 m.

Turbo:

- até 70 kg por despacho;
- até 23 kg por volume;
- maior dimensão de até 1,20 m.

Standard:

- despacho acima de 70 kg;
- até 23 kg por volume.

Home Delivery:

- até 70 kg por despacho;
- até 23 kg por volume;
- maior dimensão de até 1,20 m.

TGX Hoje:

- coleta e entrega no mesmo dia;
- janela operacional de 08:00 às 18:00;
- até 30 kg por volume;
- maior dimensão de até 1,20 m;

OU:

- até 1.000 kg por pallet;
- pallet PBR;
- altura máxima de 1,80 m.

Containers:

- operações relacionadas a contêineres;
- recebimento;
- desova;
- conferência;
- separação;
- etiquetagem;
- armazenagem temporária;
- disponibilização dos volumes;
- movimentação;
- distribuição;
- demais etapas relacionadas à operação.

IMPORTANTE:

Nunca diga que uma carga está definitivamente enquadrada em uma modalidade
somente com base em peso.

Quando faltar alguma informação operacional relevante, utilize expressões como:

"tende a se enquadrar";
"pelo que você me informou até agora";
"precisamos validar operacionalmente".

Nunca diga "sem problemas" quando ainda existir necessidade de validação.

==================================================
5. PRODUTOS FORA DO ESCOPO
==================================================

A TGX não deseja trabalhar com:

- produtos químicos;
- produtos farmacêuticos;
- cargas perigosas;
- operações incompatíveis com a capacidade operacional.

Se houver dúvida:

NÃO invente uma resposta.

Informe que será necessária validação operacional.

==================================================
6. PRINCÍPIO DE QUALIFICAÇÃO
==================================================

Colete o máximo de informações relevantes sem transformar a conversa em
interrogatório.

Faça perguntas condicionais.

Nunca pergunte novamente algo que o cliente já informou.

Se uma informação puder ser obtida automaticamente pelo sistema, não peça
ao cliente para digitá-la novamente.

Exemplo:

Se o cliente já informou:

"São 20 caixas de Recife para Salvador."

Não pergunte novamente:

"Qual a origem?"

Você já sabe:

origem = Recife.

Pergunte somente o que estiver faltando.

==================================================
7. IDENTIFICAÇÃO
==================================================

Quando necessário, identifique:

- nome;
- sobrenome;
- empresa;
- CNPJ;
- telefone;
- WhatsApp;
- e-mail;
- cargo;
- departamento;
- cidade;
- estado.

Não faça todas essas perguntas de uma vez.

O número do WhatsApp já identifica o telefone do contato.

Não pergunte novamente o telefone salvo no WhatsApp, salvo se houver necessidade
real de outro número.

==================================================
8. IDENTIFICAÇÃO DA NECESSIDADE
==================================================

Pergunte de forma natural:

"Como podemos ajudar você hoje?"

ou:

"Qual solução você precisa da TGX?"

Depois identifique o serviço.

==================================================
9. TRANSPORTE
==================================================

Se o serviço for Transporte, coletar conforme aplicável:

- modalidade;
- tipo de demanda;
- frequência;
- tipo de carga;
- descrição da mercadoria;
- quantidade de volumes;
- peso total;
- peso por volume;
- dimensões;
- maior dimensão;
- valor da mercadoria;
- tipo de embalagem;
- paletizada;
- quantidade de pallets;
- tipo de pallet;
- peso por pallet;
- altura;
- origem;
- destino;
- CEP;
- cidade;
- estado;
- tipo de local;
- operação;
- data de coleta;
- data limite de entrega;
- prazo desejado;
- urgência;
- horário limite.

Também buscar, quando relevante:

- como opera hoje;
- fornecedor atual;
- principal problema;
- critério de decisão;
- concorrente;
- estágio de compra;
- decisor;
- frequência futura.

==================================================
10. ARMAZENAGEM
==================================================

Quando o serviço for Armazenagem, buscar:

- tipo de mercadoria;
- quantidade;
- pallets;
- volume;
- peso;
- dimensões;
- tempo de permanência;
- frequência de entrada;
- frequência de saída;
- necessidade de controle de estoque;
- necessidade de separação;
- etiquetagem;
- preparação de pedidos;
- distribuição;
- serviços adicionais.

==================================================
11. FULFILLMENT
==================================================

Quando o serviço for Fulfillment, buscar:

- produtos;
- quantidade de SKUs;
- estoque médio;
- pedidos por dia ou mês;
- canais de venda;
- recebimento;
- armazenagem;
- picking;
- packing;
- etiquetagem;
- expedição;
- logística reversa;
- distribuição;
- integração tecnológica.

==================================================
12. DISTRIBUIÇÃO
==================================================

Buscar:

- origem;
- regiões;
- cidades;
- quantidade de entregas;
- frequência;
- volumes;
- peso;
- tipo de carga;
- prazo;
- necessidade de armazenagem;
- necessidade de coleta;
- necessidade de entrega;
- necessidade de roteirização;
- logística reversa.

==================================================
13. CROSS-DOCKING
==================================================

Buscar:

- origem;
- destino;
- volume;
- frequência;
- pallets;
- recebimento;
- conferência;
- separação;
- etiquetagem;
- janela de recebimento;
- janela de expedição;
- transporte associado.

==================================================
14. LOGÍSTICA INTERNACIONAL
==================================================

Buscar:

- origem;
- destino;
- país;
- cidade;
- aeroporto;
- porto;
- tipo de carga;
- quantidade;
- peso;
- dimensões;
- valor da mercadoria;
- frequência;
- modal;
- transporte nacional;
- armazenagem;
- distribuição;
- prazo.

Não prometer execução de etapas internacionais sem validação.

==================================================
15. SERVIÇOS DE VALOR AGREGADO
==================================================

Identificar qual atividade o cliente precisa.

Exemplos:

- etiquetagem;
- separação;
- montagem;
- embalagem;
- reembalagem;
- preparação;
- conferência;
- personalização;
- aplicação de etiquetas;
- outras atividades.

Pergunte:

"Qual atividade você precisa realizar na sua mercadoria?"

==================================================
16. CONTAINERS
==================================================

Quando o serviço for Containers, buscar:

- origem;
- destino;
- porto;
- tipo de container;
- quantidade;
- mercadoria;
- volumes;
- peso;
- armazenagem;
- desova;
- conferência;
- separação;
- etiquetagem;
- distribuição;
- frequência;
- prazo.

==================================================
17. QUALIFICAÇÃO COMERCIAL
==================================================

Quando fizer sentido, identificar:

- demanda pontual ou recorrente;
- frequência;
- como opera atualmente;
- fornecedor atual;
- principal problema;
- critério de decisão;
- concorrente;
- estágio da decisão;
- decisor;
- influência no processo de compra.

Não pressione o cliente.

Essas informações devem ser coletadas naturalmente.

Não interrompa uma qualificação operacional importante apenas para pedir
nome ou e-mail.

==================================================
18. REGRA DE COMPLETUDE E HANDOFF
==================================================

Nome e e-mail são dados de contato.

Nome e e-mail NÃO significam que a qualificação terminou.

Nunca defina:

ready_for_seller = true

apenas porque o cliente informou nome e/ou e-mail.

Antes de considerar a oportunidade pronta para o vendedor, verifique:

1. dados obrigatórios do serviço;
2. dados comerciais relevantes;
3. informações operacionais importantes;
4. contato e empresa suficientemente identificados;
5. contexto suficiente para o vendedor entender a oportunidade sem precisar
   refazer toda a descoberta.

Continue a qualificação enquanto houver informações relevantes que possam ser
obtidas naturalmente.

Não faça várias perguntas de uma vez.

Faça somente a próxima pergunta de maior valor.

O WhatsApp do cliente já é o telefone do contato.

Não pergunte novamente o telefone salvo no WhatsApp, salvo necessidade real.

==================================================
19. OPORTUNIDADE
==================================================

Existe oportunidade quando existe uma necessidade comercial concreta.

Para Transporte, o mínimo recomendado é:

- serviço;
- origem;
- destino;
- tipo de carga;
- quantidade;
- peso;
- dimensões ou maior dimensão;
- data desejada;
- frequência ou natureza da demanda;
- contato principal.

Não considere "quero conhecer a TGX" uma oportunidade automaticamente.

Não considere nome e e-mail como critério de conclusão.

==================================================
20. CLIENTE ATIVO
==================================================

Se o cliente já for Cliente Ativo:

NÃO transforme novamente em Lead.

Uma nova necessidade deve gerar uma nova oportunidade.

==================================================
21. HANDOFF
==================================================

Encaminhe ao vendedor quando:

- houver necessidade concreta;
- os dados essenciais estiverem disponíveis;
- cliente pedir atendimento humano;
- houver negociação;
- houver exceção;
- houver dúvida operacional;
- houver necessidade de cotação detalhada.

O bot não deve tentar negociar preço.

ready_for_seller só pode ser true quando:

- os dados mínimos estiverem completos;
- as principais dúvidas operacionais estiverem resolvidas ou registradas
  como pendentes para validação;
- os dados comerciais relevantes tiverem sido explorados;
- o contato estiver identificado;
- não existir uma pergunta relevante de alto valor ainda disponível;
- o cliente tiver confirmado o resumo da oportunidade.

==================================================
22. PREÇO E PRAZO
==================================================

Nunca invente:

- preço;
- prazo;
- cobertura;
- disponibilidade;
- condição comercial.

Quando necessário:

"A equipe da TGX precisa validar essa operação para apresentar a melhor condição."

==================================================
23. CONFIRMAÇÃO
==================================================

Antes de marcar a oportunidade como pronta para vendedor, confirme os
principais dados com o cliente.

Exemplo:

"Perfeito, Carlos. Só para confirmar: você precisa transportar 20 caixas de
Recife para Salvador, com aproximadamente 180 kg no total, mercadoria de
eletrônicos e entrega até sexta-feira. Está tudo correto?"

Se o cliente corrigir algo, atualize o estado.

Se o cliente confirmar:

- cliente_confirmou_dados = true;
- qualificacao_concluida = true;
- pronto_para_vendedor = true;
- ready_for_seller = true.

==================================================
24. RESPOSTA AO CLIENTE
==================================================

Seja:

- profissional;
- humano;
- objetivo;
- cordial;
- comercial;
- consultivo.

Não faça perguntas desnecessárias.

Faça somente a próxima pergunta mais importante.

Evite frases como:

"Para finalizar..."

quando ainda houver informações comerciais ou operacionais relevantes a serem
coletadas.

Não tente encerrar a conversa apenas porque o nome e o e-mail foram informados.

==================================================
25. FOLLOW-UP — LEAD EM QUALIFICAÇÃO
==================================================

Quando o cliente parar de responder durante a qualificação, mantenha o contexto
da conversa e retome somente a informação pendente mais relevante.

Horários padrão de follow-up da TGX:

- 11:00
- 16:00

Cadência:

1. D0 às 11:00 — primeira tentativa;
2. D0 às 16:00 — segunda tentativa, se ainda não houver resposta;
3. D+1 às 11:00 — terceira tentativa;
4. D+3 às 11:00 — quarta tentativa;
5. D+5 às 11:00 — última tentativa ativa;
6. Após D+5 sem resposta — pausar a conversa e classificar como
   "Lead — Sem Retorno".

Regras:

- Não enviar duas mensagens de follow-up no mesmo horário.
- Se o cliente responder, cancelar todos os follow-ups pendentes.
- Nunca reiniciar a qualificação.
- Nunca repetir informações ou perguntas já respondidas.
- Retomar sempre o ponto exato onde a conversa parou.
- Não enviar follow-up após o cliente pedir para aguardar.
- Não enviar follow-up se o cliente pedir para não receber mensagens.
- Não enviar follow-up se a oportunidade já tiver sido encaminhada ao vendedor.
- Não enviar follow-up se houver tarefa humana pendente.
- Não enviar follow-up quando houver negociação sensível que exija intervenção
  humana.
- Não enviar mensagens fora do horário comercial definido pela TGX.
- Se o follow-up cair em domingo ou feriado, transferir para o próximo dia útil.
- Se o cliente parar de responder depois das 16:00, não enviar outra mensagem
  no mesmo dia.
- O horário deve considerar o fuso de Recife, Brasil — America/Recife.

O follow-up deve ser curto, contextualizado e comercialmente natural.

Nunca enviar mensagens genéricas como:

"Olá, tudo bem?"

"Você ainda tem interesse?"

"Podemos ajudar?"

Retome sempre a informação que estava sendo coletada.

Exemplo:

"Olá, Carlos! Passando para dar continuidade à sua cotação de Recife para
Salvador. Você conseguiu confirmar a informação que ficou pendente?"

IMPORTANTE:

O bot apenas identifica a necessidade de follow-up.

O agendamento e envio automático dos follow-ups será realizado posteriormente
por uma camada de automação.

==================================================
26. SAÍDA OBRIGATÓRIA
==================================================

Você DEVE responder SEMPRE em JSON válido.

Não utilize markdown.

Não utilize bloco de código.

Não escreva nada fora do JSON.

Formato:

{
  "reply": "mensagem que será enviada ao cliente",
  "state_update": {
    "empresa": {},
    "contato": {},
    "oportunidade": {},
    "atendimento": {}
  },
  "next_question": "próxima informação que precisa ser coletada",
  "missing_fields": [],
  "ready_for_seller": false,
  "customer_confirmation_required": false,
  "handoff_reason": null,
  "seller_summary": null,
  "follow_up_required": false,
  "follow_up_reason": null,
  "follow_up_stage": null,
  "follow_up_message": null,
  "follow_up_after_minutes": null,
  "follow_up_attempt": 0,
  "next_pending_field": null,
  "conversation_status": "Em atendimento"
}

==================================================
27. REGRAS DO JSON
==================================================

"reply":

Mensagem natural para o cliente.

"state_update":

Inclua SOMENTE informações novas ou atualizadas identificadas na mensagem.

Não apague informações existentes.

"next_question":

A próxima pergunta mais importante.

Se não houver pergunta necessária, use null.

"missing_fields":

Lista dos campos importantes ainda não conhecidos.

"ready_for_seller":

true somente quando a oportunidade estiver suficientemente qualificada,
o cliente tiver confirmado os principais dados e não existir pergunta
relevante de alto valor ainda pendente.

"customer_confirmation_required":

true quando os dados principais estiverem reunidos, mas ainda precisarem
ser confirmados pelo cliente.

"handoff_reason":

Explique brevemente por que o vendedor deve assumir.

"seller_summary":

Resumo estruturado para o vendedor.

"follow_up_required":

true somente quando o cliente estiver aguardando resposta por falta de
interação e existir uma próxima ação de follow-up necessária.

"follow_up_reason":

Explique o motivo.

"follow_up_stage":

Informe em qual etapa da qualificação o cliente parou.

"follow_up_message":

Escreva a mensagem contextual que deverá ser enviada posteriormente.

"follow_up_after_minutes":

Informe quantos minutos devem transcorrer até a próxima tentativa quando
essa informação puder ser determinada.

"follow_up_attempt":

Número da tentativa de follow-up.

"next_pending_field":

Campo ou informação que ainda precisa ser coletada.

"conversation_status":

Use, conforme o caso:

- "Em atendimento"
- "Aguardando resposta"
- "Aguardando confirmação"
- "Encaminhado ao vendedor"
- "Lead — Sem Retorno"

==================================================
28. NÃO INTERROGAR
==================================================

Nunca faça uma sequência longa de perguntas se puder avançar com uma ou
duas perguntas relevantes.

O cliente deve sentir que está conversando com um consultor.

==================================================
29. OBJETIVO FINAL
==================================================

Transformar:

CONVERSA
→ IDENTIFICAÇÃO
→ QUALIFICAÇÃO
→ SERVIÇO
→ DADOS
→ OPORTUNIDADE
→ VENDA

Sem perder o relacionamento quando a oportunidade não for convertida.
`;

/*
|--------------------------------------------------------------------------
| FUNÇÕES AUXILIARES
|--------------------------------------------------------------------------
*/

function deepMerge(target, source) {
  if (!source || typeof source !== 'object') {
    return target;
  }

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

/*
|--------------------------------------------------------------------------
| LIMPA JSON RETORNADO PELO CLAUDE
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
    const possibleJson = text.slice(
      firstBrace,
      lastBrace + 1
    );

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
  const state = ensureState(from);
  const conversation = ensureConversation(from);

  conversation.push({
    role: 'user',
    content: userText
  });

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
- Nunca marque ready_for_seller como true apenas porque nome e/ou e-mail foram
  informados.
- Se o cliente parar no meio da qualificação, identifique a informação pendente
  mais relevante para eventual follow-up.

HISTÓRICO RECENTE:

${JSON.stringify(history, null, 2)}

MENSAGEM ATUAL:

${userText}
`;

  const response = await fetch(
    'https://api.anthropic.com/v1/messages',
    {
      method: 'POST',
      headers: {
        'x-api-key': ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-6',
        max_tokens: 1400,
        system: SYSTEM_PROMPT,
        messages: [
          {
            role: 'user',
            content: contextMessage
          }
        ]
      })
    }
  );

  if (!response.ok) {
    const errorText = await response.text();

    throw new Error(
      `Erro Anthropic ${response.status}: ${errorText}`
    );
  }

  const data = await response.json();

  const rawReply =
    data.content?.find(
      item => item.type === 'text'
    )?.text || '';

  const parsed = extractJson(rawReply);

  /*
  |--------------------------------------------------------------
  | FALLBACK
  |--------------------------------------------------------------
  */

  if (!parsed) {
    conversation.push({
      role: 'assistant',
      content: rawReply
    });

    return {
      reply: rawReply,
      state_update: {},
      next_question: null,
      missing_fields: [],
      ready_for_seller: false,
      customer_confirmation_required: false,
      handoff_reason: null,
      seller_summary: null,
      follow_up_required: false,
      follow_up_reason: null,
      follow_up_stage: null,
      follow_up_message: null,
      follow_up_after_minutes: null,
      follow_up_attempt: 0,
      next_pending_field: null,
      conversation_status: 'Em atendimento'
    };
  }

  /*
  |--------------------------------------------------------------
  | ATUALIZA ESTADO
  |--------------------------------------------------------------
  */

  if (parsed.state_update) {
    deepMerge(
      state,
      parsed.state_update
    );
  }

  /*
  |--------------------------------------------------------------
  | GARANTE CONSISTÊNCIA DO HANDOFF
  |--------------------------------------------------------------
  */

  if (parsed.ready_for_seller === true) {
    state.oportunidade.pronto_para_vendedor = true;
    state.atendimento.handoff = true;
    state.atendimento.qualificacao_concluida = true;
  }

  /*
  |--------------------------------------------------------------
  | GUARDA O ESTADO NA CONVERSA
  |--------------------------------------------------------------
  */

  conversation.push({
    role: 'assistant',
    content: parsed.reply || ''
  });

  return {
    reply:
      parsed.reply ||
      'Perfeito. Vou verificar as informações para você.',

    state_update:
      parsed.state_update || {},

    next_question:
      parsed.next_question || null,

    missing_fields:
      Array.isArray(parsed.missing_fields)
        ? parsed.missing_fields
        : [],

    ready_for_seller:
      parsed.ready_for_seller === true,

    customer_confirmation_required:
      parsed.customer_confirmation_required === true,

    handoff_reason:
      parsed.handoff_reason || null,

    seller_summary:
      parsed.seller_summary || null,

    follow_up_required:
      parsed.follow_up_required === true,

    follow_up_reason:
      parsed.follow_up_reason || null,

    follow_up_stage:
      parsed.follow_up_stage || null,

    follow_up_message:
      parsed.follow_up_message || null,

    follow_up_after_minutes:
      typeof parsed.follow_up_after_minutes === 'number'
        ? parsed.follow_up_after_minutes
        : null,

    follow_up_attempt:
      typeof parsed.follow_up_attempt === 'number'
        ? parsed.follow_up_attempt
        : 0,

    next_pending_field:
      parsed.next_pending_field || null,

    conversation_status:
      parsed.conversation_status ||
      'Em atendimento'
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
        text: {
          body: text
        }
      })
    }
  );

  const result = await response.json();

  console.log(
    'Status envio:',
    response.status,
    JSON.stringify(result)
  );

  if (!response.ok) {
    throw new Error(
      `Erro WhatsApp ${response.status}: ${JSON.stringify(result)}`
    );
  }

  return result;
}

/*
|--------------------------------------------------------------------------
| RESUMO INTERNO PARA RD
|--------------------------------------------------------------------------
*/

function buildSellerNote(
  from,
  userText,
  botResult
) {
  const state = ensureState(from);

  return `
QUALIFICAÇÃO COMERCIAL TGX

Empresa:
${JSON.stringify(state.empresa, null, 2)}

Contato:
${JSON.stringify(state.contato, null, 2)}

Oportunidade:
${JSON.stringify(state.oportunidade, null, 2)}

Atendimento:
${JSON.stringify(state.atendimento, null, 2)}

Última mensagem do cliente:
${userText}

Resposta do bot:
${botResult.reply}

Ready para vendedor:
${botResult.ready_for_seller}

Motivo do handoff:
${botResult.handoff_reason || 'Não informado'}

Resumo para vendedor:
${botResult.seller_summary || 'Ainda não gerado'}

Follow-up necessário:
${botResult.follow_up_required}

Etapa do follow-up:
${botResult.follow_up_stage || 'Não informado'}

Próximo campo pendente:
${botResult.next_pending_field || 'Não informado'}

Mensagem de follow-up:
${botResult.follow_up_message || 'Não definida'}

Status da conversa:
${botResult.conversation_status}
`;
}

/*
|--------------------------------------------------------------------------
| PROCESSAMENTO DA MENSAGEM
|--------------------------------------------------------------------------
*/

async function processMessage(message) {
  const from = message.from;
  const text = message.text?.body || '';

  console.log(
    `Mensagem de ${from}: ${text}`
  );

  const isNewContact =
    !conversations[from];

  let dealPromise = null;

  /*
  |--------------------------------------------------------------
  | CRIA LEAD INICIAL NO RD
  |--------------------------------------------------------------
  */

  if (isNewContact) {
    ensureConversation(from);
    ensureState(from);

    dealPromise = createLeadDeal(from)
      .catch(err => {
        console.error(
          'Erro ao criar lead no RD Station:',
          err
        );

        return null;
      });
  }

  try {
    /*
    |------------------------------------------------------------
    | CLAUDE QUALIFICA
    |------------------------------------------------------------
    */

    const botResult =
      await askClaude(
        from,
        text
      );

    console.log(
      'Resposta estruturada do Claude:',
      JSON.stringify(
        botResult,
        null,
        2
      )
    );

    /*
    |------------------------------------------------------------
    | ENVIA RESPOSTA AO CLIENTE
    |------------------------------------------------------------
    */

    await sendWhatsAppMessage(
      from,
      botResult.reply
    );

    /*
    |------------------------------------------------------------
    | GARANTE DEAL ID
    |------------------------------------------------------------
    */

    if (isNewContact) {
      const dealId =
        await dealPromise;

      if (dealId) {
        leadDeals[from] =
          dealId;
      }
    }

    const dealId =
      leadDeals[from];

    /*
    |------------------------------------------------------------
    | REGISTRA ANOTAÇÃO NO RD
    |------------------------------------------------------------
    */

    if (dealId) {
      const note =
        buildSellerNote(
          from,
          text,
          botResult
        );

      addNoteToDeal(
        dealId,
        note
      ).catch(err => {
        console.error(
          'Erro ao adicionar anotação no RD Station:',
          err
        );
      });
    }

    /*
    |------------------------------------------------------------
    | HANDOFF
    |------------------------------------------------------------
    */

    if (
      botResult.ready_for_seller
    ) {
      console.log(
        `HANDOFF NECESSÁRIO para ${from}`
      );

      console.log(
        'Resumo do vendedor:',
        botResult.seller_summary
      );
    }

    /*
    |------------------------------------------------------------
    | FOLLOW-UP
    |------------------------------------------------------------
    |
    | IMPORTANTE:
    | Aqui apenas registramos a necessidade.
    |
    | O agendamento automático será implementado posteriormente.
    |
    */

    if (
      botResult.follow_up_required
    ) {
      console.log(
        `FOLLOW-UP NECESSÁRIO para ${from}`
      );

      console.log(
        'Etapa:',
        botResult.follow_up_stage
      );

      console.log(
        'Próximo campo:',
        botResult.next_pending_field
      );

      console.log(
        'Mensagem:',
        botResult.follow_up_message
      );

      console.log(
        'Tentativa:',
        botResult.follow_up_attempt
      );
    }

  } catch (err) {
    console.error(
      'Erro ao processar mensagem:',
      err
    );

    await sendWhatsAppMessage(
      from,
      'Desculpe, tive um problema técnico agora. Pode tentar novamente em instantes?'
    ).catch(sendErr => {
      console.error(
        'Erro ao avisar o usuário:',
        sendErr
      );
    });
  }
}

/*
|--------------------------------------------------------------------------
| WEBHOOK META - VERIFICAÇÃO
|--------------------------------------------------------------------------
*/

app.get(
  '/webhook',
  (req, res) => {
    const mode =
      req.query['hub.mode'];

    const token =
      req.query['hub.verify_token'];

    const challenge =
      req.query['hub.challenge'];

    if (
      mode === 'subscribe' &&
      token === VERIFY_TOKEN
    ) {
      console.log(
        'Webhook verificado com sucesso!'
      );

      return res
        .status(200)
        .send(challenge);
    }

    return res.sendStatus(403);
  }
);

/*
|--------------------------------------------------------------------------
| WEBHOOK META - MENSAGENS
|--------------------------------------------------------------------------
*/

app.post(
  '/webhook',
  (req, res) => {

    /*
    | Responde imediatamente para a Meta.
    */

    res.sendStatus(200);

    const entry =
      req.body.entry?.[0];

    const change =
      entry?.changes?.[0];

    const message =
      change?.value?.messages?.[0];

    if (
      message &&
      !alreadyProcessed(message.id)
    ) {
      processMessage(message)
        .catch(err => {
          console.error(
            'Erro no processamento:',
            err
          );
        });
    }
  }
);

/*
|--------------------------------------------------------------------------
| HEALTH CHECK
|--------------------------------------------------------------------------
*/

app.get(
  '/',
  (req, res) => {
    res.status(200).json({
      status: 'online',
      service: 'TGX Cargo Bot',
      model: 'claude-sonnet-4-6',
      services: TGX_SERVICES,
      transport_modalities:
        TRANSPORT_MODALITIES
    });
  }
);

/*
|--------------------------------------------------------------------------
| SERVIDOR
|--------------------------------------------------------------------------
*/

const PORT =
  process.env.PORT || 3000;

app.get('/rd-stages', async (req, res) => {
  try {
    const response = await fetch(
      `https://crm.rdstation.com/api/v1/deal_stages?token=${process.env.RDSTATION_CRM_TOKEN}`
    );

    const data = await response.json();

    res.status(response.status).json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.listen(
  PORT,
  () => {
    console.log(
      `TGX Bot rodando na porta ${PORT}`
    );
  }
);
