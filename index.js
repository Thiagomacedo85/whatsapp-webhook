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
  normalizeValue
} = require('./sheets');

const VERIFY_TOKEN =
  process.env.VERIFY_TOKEN || 'minha_verificacao_2026';

const WHATSAPP_TOKEN =
  process.env.WHATSAPP_TOKEN;

const PHONE_NUMBER_ID =
  process.env.PHONE_NUMBER_ID;

const ANTHROPIC_API_KEY =
  process.env.ANTHROPIC_API_KEY;

const ANTHROPIC_MODEL =
  process.env.ANTHROPIC_MODEL || 'claude-sonnet-4-6';

const FORM_CADASTRO_URL =
  'https://forms.gle/RQxSnpQaL22AsYfEA';

const FORM_ORCAMENTO_URL =
  'https://forms.gle/tGmWyBPDUoZXwZLw9';

const HUMAN_WHATSAPP =
  '+55 (81) 99253-9017';

const HUMAN_HOURS =
  'Segunda a sexta, 09:00 às 17:00';

/*
|--------------------------------------------------------------------------
| MEMÓRIA TEMPORÁRIA
|--------------------------------------------------------------------------
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
    const oldest =
      processedMessageIds.values().next().value;

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
  semContato:
    process.env.RDSTATION_STAGE_SEM_CONTATO,

  contatoFeito:
    process.env.RDSTATION_STAGE_CONTATO_FEITO,

  identificacao:
    process.env.RDSTATION_STAGE_IDENTIFICACAO,

  apresentacao:
    process.env.RDSTATION_STAGE_APRESENTACAO,

  proposta:
    process.env.RDSTATION_STAGE_PROPOSTA
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

      solicitacao_orcamento_id: null,

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

      aguardando_form_orcamento: false,

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
0. IDENTIFICAÇÃO INICIAL DO CLIENTE
==================================================

O sistema (em código) já conduz a identificação inicial do cliente antes de
chegar até você. Esse fluxo é automático:

1. O sistema pergunta o ID de Cliente.
2. Se o cliente não souber, pergunta CPF ou CNPJ.
3. Consulta a planilha de cadastro.
4. Se encontrar, informa ao cliente "Cadastro localizado! Seu ID é X".
5. Se não encontrar, orienta o preenchimento do formulário de cadastro.

Quando o cliente for identificado, os dados dele aparecerão no campo "cliente"
do ESTADO ATUAL DA QUALIFICAÇÃO.

NÃO peça novamente ID, CPF ou CNPJ depois que o cliente já foi identificado.

Se algum dado de contato estiver faltando (ex.: e-mail), você pode pedir
apenas o que estiver faltando.

Formulário de Cadastro de Cliente:
https://forms.gle/RQxSnpQaL22AsYfEA

==================================================
0.1. SOLICITAÇÃO DE ORÇAMENTO
==================================================

Quando o cliente quiser solicitar um orçamento, oriente-o a preencher o
formulário oficial:

Formulário de Solicitação de Orçamento:
https://forms.gle/tGmWyBPDUoZXwZLw9

Nesse momento, defina no state_update:

"atendimento": {
  "aguardando_form_orcamento": true
}

Depois disso, o cliente preenche o formulário e retorna aqui para confirmar.

O SISTEMA (em código) fará a leitura da planilha, confirmará o preenchimento
e informará o ID da Solicitação de Orçamento. Você NÃO precisa fazer essa
verificação.

Enquanto o cliente estiver preenchendo o formulário de orçamento, não inicie
uma nova qualificação nem faça perguntas operacionais.

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

Se o cliente já foi identificado pelo sistema (campo "cliente" preenchido),
não peça novamente esses dados, apenas complemente o que estiver faltando.

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

NÃO altere os campos "cliente" e "fluxo" no state_update. Eles são controlados
pelo sistema.

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
    leadStates[from] =
      createInitialState();
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
  const state =
    ensureState(from);

  if (from) {
    state.contato.telefone = from;
  }

  return state;
}

function recordExchange(from, userText, assistantReply) {
  const conversation =
    ensureConversation(from);

  conversation.push({
    role: 'user',
    content: userText
  });

  conversation.push({
    role: 'assistant',
    content: assistantReply
  });
}

/*
|--------------------------------------------------------------------------
| HELPERS DE IDENTIFICAÇÃO / FLUXO
|--------------------------------------------------------------------------
*/

function isNotKnowingId(text) {
  const t = normalizeValue(text);
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
  const t = normalizeValue(text);
  return t.includes('cpf') || t.includes('cnpj');
}

function extractDocument(text) {
  const matches =
    String(text).match(/\d[\d.\-/]*\d/g) || [];

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

  const idMatch =
    t.match(/(?:id|cliente)[\s:é]*([A-Za-z0-9\-.]{2,})/i);

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
  const t = normalizeValue(text);
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
    follow_up_required: false,
    follow_up_reason: null,
    follow_up_stage: null,
    follow_up_message: null,
    follow_up_after_minutes: null,
    follow_up_attempt: 0,
    next_pending_field: null,
    conversation_status:
      extra.conversation_status || 'Em atendimento'
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
  state.cliente.razao_social =
    client.razao_social || state.cliente.razao_social;
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
      state.contato.sobrenome =
        parts.slice(1).join(' ');
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

  const primeiroNome =
    client.nome
      ? ', ' + String(client.nome).trim().split(/\s+/)[0]
      : '';

  const idInfo =
    client.id
      ? 'Seu ID de cliente é: *' + client.id + '*\n\n'
      : '';

  const reply =
    '✅ Cadastro localizado' + primeiroNome + '!\n\n' +
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
    client = await findClientByPhone(from);
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
      phone: from
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
    state.atendimento.conversation_status =
      'Encaminhado ao vendedor';

    state.oportunidade.solicitacao_orcamento_id =
      quote.solicitacao_id || null;

    state.oportunidade.status =
      'Solicitação de Orçamento';

    state.oportunidade.pronto_para_vendedor = true;
    state.oportunidade.cliente_confirmou_dados = true;

    const idPart = quote.solicitacao_id
      ? 'Seu ID da Solicitação de Orçamento é: *' +
        quote.solicitacao_id + '*\n\n'
      : '';

    const reply =
      '✅ Confirmei o preenchimento do seu formulário de Solicitação de Orçamento!\n\n' +
      idPart +
      'Sua solicitação foi efetuada com *sucesso* e estou encaminhando para um *Executivo de Vendas* dar continuidade ao seu atendimento. 🚀\n\n' +
      'Em breve entraremos em contato. Qualquer dúvida, estou à disposição!';

    return buildReply(reply, {
      ready_for_seller: true,
      handoff_reason:
        'Solicitação de orçamento confirmada na planilha',
      seller_summary:
        'Solicitação de Orçamento confirmada. ID: ' +
        (quote.solicitacao_id || 'N/D'),
      conversation_status: 'Encaminhado ao vendedor'
    });
  }

  return buildReply(
    'Ainda não localizei sua Solicitação de Orçamento em nossa base. 😕\n\n' +
    'Pode ser que leve alguns instantes para o formulário atualizar nossos registros. ' +
    'Confirme se você finalizou o envio e tente novamente em instantes. 🙏'
  );
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

  const fenced =
    text.match(
      /```json\s*([\s\S]*?)\s*```/i
    );

  if (fenced) {
    try {
      return JSON.parse(
        fenced[1]
      );
    } catch (_) {}
  }

  const firstBrace =
    text.indexOf('{');

  const lastBrace =
    text.lastIndexOf('}');

  if (
    firstBrace !== -1 &&
    lastBrace !== -1
  ) {
    const possibleJson =
      text.slice(
        firstBrace,
        lastBrace + 1
      );

    try {
      return JSON.parse(
        possibleJson
      );
    } catch (_) {}
  }

  return null;
}

/*
|--------------------------------------------------------------------------
| DETERMINA ESTÁGIO DO RD
|--------------------------------------------------------------------------
*/

function getDesiredRdStage(
  state,
  botResult,
  isNewContact
) {
  if (
    isNewContact &&
    RD_STAGES.contatoFeito
  ) {
    return RD_STAGES.contatoFeito;
  }

  const serviceIdentified =
    state.atendimento
      .servico_identificado === true ||
    Boolean(
      state.oportunidade.servico
    );

  const interestIdentified =
    serviceIdentified ||
    Boolean(
      state.oportunidade.origem?.cep
    ) ||
    Boolean(
      state.oportunidade.destino?.cep
    ) ||
    Boolean(
      state.oportunidade.carga?.tipo
    ) ||
    Boolean(
      state.oportunidade.carga?.peso_total
    );

  if (
    interestIdentified &&
    RD_STAGES.identificacao
  ) {
    return RD_STAGES.identificacao;
  }

  if (
    RD_STAGES.contatoFeito
  ) {
    return RD_STAGES.contatoFeito;
  }

  return null;
}

async function updateRdStageIfNeeded(
  from,
  botResult,
  isNewContact
) {
  const dealId =
    leadDeals[from];

  if (!dealId) {
    return;
  }

  const state =
    ensureState(from);

  const desiredStage =
    getDesiredRdStage(
      state,
      botResult,
      isNewContact
    );

  if (!desiredStage) {
    return;
  }

  if (
    desiredStage ===
      RD_STAGES.apresentacao ||
    desiredStage ===
      RD_STAGES.proposta
  ) {
    return;
  }

  await updateDealStage(
    dealId,
    desiredStage
  );
}

/*
|--------------------------------------------------------------------------
| CLAUDE
|--------------------------------------------------------------------------
*/

async function askClaude(
  from,
  userText
) {
  const state =
    ensureContactPhone(from);

  const conversation =
    ensureConversation(from);

  conversation.push({
    role: 'user',
    content: userText
  });

  const history =
    conversation.slice(-12);

  const contextMessage = `
ESTADO ATUAL DA QUALIFICAÇÃO:

${JSON.stringify(
  state,
  null,
  2
)}

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
- Não altere os campos "cliente" e "fluxo" do estado.

HISTÓRICO RECENTE:

${JSON.stringify(
  history,
  null,
  2
)}

MENSAGEM ATUAL:

${userText}
`;

  const response =
    await fetch(
      'https://api.anthropic.com/v1/messages',
      {
        method: 'POST',
        headers: {
          'x-api-key':
            ANTHROPIC_API_KEY,

          'anthropic-version':
            '2023-06-01',

          'Content-Type':
            'application/json'
        },

        body: JSON.stringify({
          model:
            ANTHROPIC_MODEL,

          max_tokens:
            1400,

          system:
            SYSTEM_PROMPT,

          messages: [
            {
              role: 'user',
              content:
                contextMessage
            }
          ]
        })
      }
    );

  if (!response.ok) {
    const errorText =
      await response.text();

    throw new Error(
      `Erro Anthropic ${response.status}: ${errorText}`
    );
  }

  const data =
    await response.json();

  const rawReply =
    data.content?.find(
      item =>
        item.type === 'text'
    )?.text || '';

  const parsed =
    extractJson(rawReply);

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
      conversation_status:
        'Em atendimento'
    };
  }

  if (parsed.state_update) {
    const safeUpdate = {
      ...parsed.state_update
    };

    delete safeUpdate.cliente;
    delete safeUpdate.fluxo;

    deepMerge(
      state,
      safeUpdate
    );
  }

  state.contato.telefone =
    from;

  if (
    parsed.ready_for_seller === true
  ) {
    state.oportunidade
      .pronto_para_vendedor = true;

    state.atendimento.handoff =
      true;

    state.atendimento
      .qualificacao_concluida = true;

    state.atendimento
      .conversation_status =
      'Encaminhado ao vendedor';

    state.atendimento
      .aguardando_confirmacao =
      false;
  }

  if (
    parsed.follow_up_required === true
  ) {
    state.atendimento
      .follow_up_required = true;

    state.atendimento
      .follow_up_reason =
      parsed.follow_up_reason ||
      null;

    state.atendimento
      .follow_up_stage =
      parsed.follow_up_stage ||
      null;

    state.atendimento
      .follow_up_message =
      parsed.follow_up_message ||
      null;

    state.atendimento
      .follow_up_after_minutes =
      typeof parsed.follow_up_after_minutes ===
      'number'
        ? parsed.follow_up_after_minutes
        : null;

    state.atendimento
      .follow_up_attempt =
      typeof parsed.follow_up_attempt ===
      'number'
        ? parsed.follow_up_attempt
        : 0;

    state.atendimento
      .next_pending_field =
      parsed.next_pending_field ||
      null;
  }

  if (
    state.oportunidade.servico
  ) {
    state.atendimento
      .servico_identificado = true;
  }

  conversation.push({
    role: 'assistant',
    content:
      parsed.reply || ''
  });

  return {
    reply:
      parsed.reply ||
      'Perfeito. Vou verificar as informações para você.',

    state_update:
      parsed.state_update || {},

    next_question:
      parsed.next_question ||
      null,

    missing_fields:
      Array.isArray(
        parsed.missing_fields
      )
        ? parsed.missing_fields
        : [],

    ready_for_seller:
      parsed.ready_for_seller === true,

    customer_confirmation_required:
      parsed.customer_confirmation_required === true,

    handoff_reason:
      parsed.handoff_reason ||
      null,

    seller_summary:
      parsed.seller_summary ||
      null,

    follow_up_required:
      parsed.follow_up_required === true,

    follow_up_reason:
      parsed.follow_up_reason ||
      null,

    follow_up_stage:
      parsed.follow_up_stage ||
      null,

    follow_up_message:
      parsed.follow_up_message ||
      null,

    follow_up_after_minutes:
      typeof parsed.follow_up_after_minutes ===
      'number'
        ? parsed.follow_up_after_minutes
        : null,

    follow_up_attempt:
      typeof parsed.follow_up_attempt ===
      'number'
        ? parsed.follow_up_attempt
        : 0,

    next_pending_field:
      parsed.next_pending_field ||
      null,

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

async function sendWhatsAppMessage(
  to,
  text
) {
  const response =
    await fetch(
      `https://graph.facebook.com/v21.0/${PHONE_NUMBER_ID}/messages`,
      {
        method: 'POST',

        headers: {
          Authorization:
            `Bearer ${WHATSAPP_TOKEN}`,

          'Content-Type':
            'application/json'
        },

        body: JSON.stringify({
          messaging_product:
            'whatsapp',

          to: to,

          text: {
            body: text
          }
        })
      }
    );

  const result =
    await response.json();

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
  const state =
    ensureContactPhone(from);

  const oportunidadeNote =
    JSON.parse(
      JSON.stringify(
        state.oportunidade
      )
    );

  if (
    oportunidadeNote.servico ===
      'Transporte' &&
    !oportunidadeNote
      .modalidade_transporte
  ) {
    oportunidadeNote.modalidade_transporte =
      'A validar';
  }

  return `
QUALIFICAÇÃO COMERCIAL TGX

Cliente (cadastro):
${JSON.stringify(
  state.cliente,
  null,
  2
)}

Fluxo:
${JSON.stringify(
  state.fluxo,
  null,
  2
)}

Empresa:
${JSON.stringify(
  state.empresa,
  null,
  2
)}

Contato:
${JSON.stringify(
  state.contato,
  null,
  2
)}

Oportunidade:
${JSON.stringify(
  oportunidadeNote,
  null,
  2
)}

Atendimento:
${JSON.stringify(
  state.atendimento,
  null,
  2
)}

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
| REGISTRO NO RD (deal id + nota + estágio)
|--------------------------------------------------------------------------
*/

async function recordDeal(
  from,
  userText,
  botResult,
  isNewContact,
  dealPromise
) {
  if (isNewContact && dealPromise) {
    const dealId =
      await dealPromise;

    if (dealId) {
      leadDeals[from] =
        dealId;
    }
  }

  const dealId =
    leadDeals[from];

  if (dealId) {
    const note =
      buildSellerNote(
        from,
        userText,
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

    await updateRdStageIfNeeded(
      from,
      botResult,
      isNewContact
    );
  }
}

/*
|--------------------------------------------------------------------------
| PROCESSAMENTO DA MENSAGEM
|--------------------------------------------------------------------------
*/

async function processMessage(
  message
) {
  const from =
    message.from;

  const text =
    message.text?.body || '';

  console.log(
    `Mensagem de ${from}: ${text}`
  );

  const state =
    ensureContactPhone(from);

  const isNewContact =
    !conversations[from];

  let dealPromise = null;

  if (isNewContact) {
    ensureConversation(from);

    dealPromise =
      createLeadDeal(
        from
      ).catch(err => {
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
    | 1) PRIMEIRA MENSAGEM — BOAS-VINDAS E PEDIDO DE ID
    |------------------------------------------------------------
    */

    if (isNewContact) {
      state.fluxo.identificacao_status =
        'aguardando_id';

      const reply =
        buildGreeting();

      recordExchange(
        from,
        text,
        reply
      );

      await sendWhatsAppMessage(
        from,
        reply
      );

      await recordDeal(
        from,
        text,
        buildReply(reply),
        isNewContact,
        dealPromise
      );

      return;
    }

    /*
    |------------------------------------------------------------
    | 2) FLUXO DE IDENTIFICAÇÃO
    |------------------------------------------------------------
    */

    const identificationResult =
      await handleIdentificationFlow(
        from,
        text,
        state
      );

    if (identificationResult) {
      recordExchange(
        from,
        text,
        identificationResult.reply
      );

      await sendWhatsAppMessage(
        from,
        identificationResult.reply
      );

      await recordDeal(
        from,
        text,
        identificationResult,
        isNewContact,
        dealPromise
      );

      return;
    }

    /*
    |------------------------------------------------------------
    | 3) CONFIRMAÇÃO DE SOLICITAÇÃO DE ORÇAMENTO
    |------------------------------------------------------------
    */

    if (
      state.atendimento
        .aguardando_form_orcamento
    ) {
      const quoteResult =
        await handleQuoteConfirmation(
          from,
          text,
          state
        );

      if (quoteResult) {
        recordExchange(
          from,
          text,
          quoteResult.reply
        );

        await sendWhatsAppMessage(
          from,
          quoteResult.reply
        );

        await recordDeal(
          from,
          text,
          quoteResult,
          isNewContact,
          dealPromise
        );

        return;
      }
    }

    /*
    |------------------------------------------------------------
    | 4) CLAUDE QUALIFICA
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

    await sendWhatsAppMessage(
      from,
      botResult.reply
    );

    await recordDeal(
      from,
      text,
      botResult,
      isNewContact,
      dealPromise
    );

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
      req.query[
        'hub.verify_token'
      ];

    const challenge =
      req.query[
        'hub.challenge'
      ];

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

    res.sendStatus(200);

    const entry =
      req.body.entry?.[0];

    const change =
      entry?.changes?.[0];

    const message =
      change?.value?.messages?.[0];

    if (
      message &&
      !alreadyProcessed(
        message.id
      )
    ) {
      processMessage(
        message
      ).catch(err => {
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
      model: ANTHROPIC_MODEL,
      services:
        TGX_SERVICES,
      transport_modalities:
        TRANSPORT_MODALITIES,
      forms: {
        cadastro: FORM_CADASTRO_URL,
        orcamento: FORM_ORCAMENTO_URL
      },
      sheets_configured: Boolean(
        process.env.SPREADSHEET_CADASTRO_ID &&
        process.env.SPREADSHEET_ORCAMENTO_ID
      )
    });
  }
);

/*
|--------------------------------------------------------------------------
| CONSULTA TEMPORÁRIA DOS ESTÁGIOS RD
|--------------------------------------------------------------------------
*/

app.get(
  '/rd-stages',
  async (req, res) => {
    try {
      const response =
        await fetch(
          `https://crm.rdstation.com/api/v1/deal_stages?token=${process.env.RDSTATION_CRM_TOKEN}`
        );

      const data =
        await response.json();

      res
        .status(response.status)
        .json(data);

    } catch (err) {
      res
        .status(500)
        .json({
          error:
            err.message
        });
    }
  }
);

/*
|--------------------------------------------------------------------------
| SERVIDOR
|--------------------------------------------------------------------------
*/

const PORT =
  process.env.PORT || 3000;

app.listen(
  PORT,
  () => {
    console.log(
      `TGX Bot rodando na porta ${PORT}`
    );
  }
);
