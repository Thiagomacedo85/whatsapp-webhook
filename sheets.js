const APPS_SCRIPT_URL = process.env.APPS_SCRIPT_URL;

/**
 * Busca cliente por ID
 */
async function findClientById(id) {
  const response = await fetch(APPS_SCRIPT_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      action: 'findById',
      id: String(id).trim()
    })
  });

  const data = await response.json();
  return data.client || null;
}

/**
 * Busca cliente por CPF ou CNPJ
 */
async function findClientByCpfCnpj(document) {
  const response = await fetch(APPS_SCRIPT_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      action: 'findByDocument',
      document: String(document).replace(/\D/g, '')
    })
  });

  const data = await response.json();
  return data.client || null;
}

/**
 * Busca cliente por telefone (WhatsApp)
 */
async function findClientByPhone(phone) {
  const response = await fetch(APPS_SCRIPT_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      action: 'findByPhone',
      phone: String(phone).replace(/\D/g, '')
    })
  });

  const data = await response.json();
  return data.client || null;
}

/**
 * Busca solicitação de orçamento
 */
async function findQuoteRequest(filters) {
  const response = await fetch(APPS_SCRIPT_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      action: 'findQuoteRequest',
      filters
    })
  });

  const data = await response.json();
  return data.quote || null;
}

/**
 * Normaliza valor (remove caracteres especiais)
 */
function normalizeValue(value) {
  if (!value) return '';
  return String(value).replace(/\D/g, '').trim();
}

module.exports = {
  findClientById,
  findClientByCpfCnpj,
  findClientByPhone,
  findQuoteRequest,
  normalizeValue
};
