/*
|--------------------------------------------------------------------------
| CONFIGURAÇÃO DAS PLANILHAS
|--------------------------------------------------------------------------
*/

const APPS_SCRIPT_URL = process.env.APPS_SCRIPT_URL;

const SPREADSHEET_CADASTRO_ID = process.env.SPREADSHEET_CADASTRO_ID;
const SPREADSHEET_ORCAMENTO_ID = process.env.SPREADSHEET_ORCAMENTO_ID;

const CADASTRO_SHEET_NAME = process.env.CADASTRO_SHEET_NAME || 'Respostas ao formulário 1';
const ORCAMENTO_SHEET_NAME = process.env.ORCAMENTO_SHEET_NAME || 'Respostas ao formulário 1';

/*
|--------------------------------------------------------------------------
| NOMES PROVÁVEIS DAS COLUNAS
|--------------------------------------------------------------------------
*/

const ID_COLUMN_CANDIDATES = [
  'id', 'id_cliente', 'id_do_cliente', 'codigo',
  'codigo_cliente', 'codigo_do_cliente', 'numero_id',
  'numero_do_id', 'id_do_cadastro'
];

const CPF_COLUMN_CANDIDATES = [
  'cpf', 'cpf_cnpj', 'documento', 'documento_cpf', 'numero_cpf'
];

const CNPJ_COLUMN_CANDIDATES = [
  'cnpj', 'cpf_cnpj', 'documento', 'documento_cnpj', 'numero_cnpj'
];

const NOME_COLUMN_CANDIDATES = [
  'nome', 'nome_completo', 'nome_do_cliente', 'cliente'
];

const RAZAO_SOCIAL_COLUMN_CANDIDATES = [
  'razao_social', 'razao_social_do_cliente', 'empresa',
  'nome_da_empresa'
];

const EMAIL_COLUMN_CANDIDATES = [
  'email', 'e_mail', 'email_do_cliente', 'correio'
];

const TELEFONE_COLUMN_CANDIDATES = [
  'telefone', 'whatsapp', 'celular', 'telefone_whatsapp',
  'whats_app', 'phone', 'numero_whatsapp'
];

const CIDADE_COLUMN_CANDIDATES = ['cidade', 'municipio'];
const ESTADO_COLUMN_CANDIDATES = ['estado', 'uf'];

const ORCAMENTO_ID_CANDIDATES = [
  'id_da_solicitacao', 'id_solicitacao', 'id_do_orcamento',
  'id_orcamento', 'numero_da_solicitacao', 'id', 'codigo', 'numero'
];

/*
|--------------------------------------------------------------------------
| FUNÇÕES AUXILIARES
|--------------------------------------------------------------------------
*/

function normalizeColumnName(name) {
  return String(name || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

function normalizeValue(value) {
  return String(value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^0-9a-z]/gi, '')
    .toLowerCase();
}

function normalizePhone(value) {
  let digits = String(value ?? '').replace(/\D/g, '');

  if (digits.startsWith('55') && digits.length >= 12) {
    digits = digits.slice(2);
  }

  return digits;
}

function phonesMatch(a, b) {
  if (!a || !b) return false;
  if (a === b) return true;

  if (a.length >= 8 && b.length >= 8) {
    return a.slice(-8) === b.slice(-8);
  }

  return false;
}

function getColumnIndex(header, candidates) {
  for (const candidate of candidates) {
    const idx = header.findIndex(h => h === candidate);
    if (idx !== -1) return idx;
  }
  return -1;
}

function findInRow(row, header, candidates) {
  const idx = getColumnIndex(header, candidates);
  if (idx === -1) return '';
  return row[idx] ?? '';
}

function buildClientRecord(row, header) {
  return {
    id: findInRow(row, header, ID_COLUMN_CANDIDATES),
    cpf: findInRow(row, header, CPF_COLUMN_CANDIDATES),
    cnpj: findInRow(row, header, CNPJ_COLUMN_CANDIDATES),
    nome: findInRow(row, header, NOME_COLUMN_CANDIDATES),
    razao_social: findInRow(row, header, RAZAO_SOCIAL_COLUMN_CANDIDATES),
    email: findInRow(row, header, EMAIL_COLUMN_CANDIDATES),
    telefone: findInRow(row, header, TELEFONE_COLUMN_CANDIDATES),
    cidade: findInRow(row, header, CIDADE_COLUMN_CANDIDATES),
    estado: findInRow(row, header, ESTADO_COLUMN_CANDIDATES),
    _raw: row
  };
}

/*
|--------------------------------------------------------------------------
| CHAMADAS À API DO APPS SCRIPT
|--------------------------------------------------------------------------
*/

async function callAppsScript(action, payload = {}) {
  if (!APPS_SCRIPT_URL) {
    throw new Error('APPS_SCRIPT_URL não configurada nas variáveis de ambiente');
  }

  const response = await fetch(APPS_SCRIPT_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action, ...payload })
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Erro Apps Script ${response.status}: ${text}`);
  }

  return response.json();
}

async function readSheetRows(spreadsheetId, sheetName) {
  const result = await callAppsScript('readSheet', {
    spreadsheetId,
    sheetName
  });

  // Espera que o Apps Script retorne { rows: [[...], [...], ...] }
  return result.rows || [];
}

/*
|--------------------------------------------------------------------------
| BUSCAS
|--------------------------------------------------------------------------
*/

async function findClientById(id) {
  const rows = await readSheetRows(SPREADSHEET_CADASTRO_ID, CADASTRO_SHEET_NAME);

  if (rows.length < 2) return null;

  const header = rows[0].map(normalizeColumnName);
  const target = normalizeValue(id);

  if (!target) return null;

  for (const row of rows.slice(1)) {
    const rowId = normalizeValue(
      findInRow(row, header, ID_COLUMN_CANDIDATES)
    );

    if (rowId && rowId === target) {
      return buildClientRecord(row, header);
    }
  }

  return null;
}

async function findClientByCpfCnpj(value) {
  const rows = await readSheetRows(SPREADSHEET_CADASTRO_ID, CADASTRO_SHEET_NAME);

  if (rows.length < 2) return null;

  const header = rows[0].map(normalizeColumnName);
  const target = normalizeValue(value);

  if (!target) return null;

  for (const row of rows.slice(1)) {
    const cpf = normalizeValue(
      findInRow(row, header, CPF_COLUMN_CANDIDATES)
    );

    const cnpj = normalizeValue(
      findInRow(row, header, CNPJ_COLUMN_CANDIDATES)
    );

    if (
      (cpf && cpf === target) ||
      (cnpj && cnpj === target)
    ) {
      return buildClientRecord(row, header);
    }
  }

  return null;
}

async function findClientByPhone(phone) {
  const rows = await readSheetRows(SPREADSHEET_CADASTRO_ID, CADASTRO_SHEET_NAME);

  if (rows.length < 2) return null;

  const header = rows[0].map(normalizeColumnName);
  const target = normalizePhone(phone);

  if (!target) return null;

  for (const row of rows.slice(1)) {
    const tel = normalizePhone(
      findInRow(row, header, TELEFONE_COLUMN_CANDIDATES)
    );

    if (phonesMatch(target, tel)) {
      return buildClientRecord(row, header);
    }
  }

  return null;
}

async function findQuoteRequest({ id, cpf, cnpj, phone }) {
  const rows = await readSheetRows(SPREADSHEET_ORCAMENTO_ID, ORCAMENTO_SHEET_NAME);

  if (rows.length < 2) return null;

  const header = rows[0].map(normalizeColumnName);

  const idTarget = normalizeValue(id);
  const cpfTarget = normalizeValue(cpf);
  const cnpjTarget = normalizeValue(cnpj);
  const phoneTarget = normalizePhone(phone);

  for (const row of rows.slice(1)) {
    const rowId = normalizeValue(
      findInRow(row, header, ID_COLUMN_CANDIDATES)
    );

    const rowCpf = normalizeValue(
      findInRow(row, header, CPF_COLUMN_CANDIDATES)
    );

    const rowCnpj = normalizeValue(
      findInRow(row, header, CNPJ_COLUMN_CANDIDATES)
    );

    const rowPhone = normalizePhone(
      findInRow(row, header, TELEFONE_COLUMN_CANDIDATES)
    );

    const matched =
      (idTarget && rowId === idTarget) ||
      (cpfTarget && rowCpf === cpfTarget) ||
      (cnpjTarget && rowCnpj === cnpjTarget) ||
      phonesMatch(phoneTarget, rowPhone);

    if (matched) {
      return {
        solicitacao_id:
          findInRow(row, header, ORCAMENTO_ID_CANDIDATES) || null,
        _raw: row
      };
    }
  }

  return null;
}

module.exports = {
  findClientById,
  findClientByCpfCnpj,
  findClientByPhone,
  findQuoteRequest,
  normalizeValue,
  normalizePhone
};
