const APPS_SCRIPT_URL = process.env.APPS_SCRIPT_URL;

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

async function findClientByPhone(phone) {
  const response = await fetch(APPS_SCRIPT_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      action: 'findByPhone',
      phone: normalizePhone(phone)
    })
  });

  const data = await response.json();
  return data.client || null;
}

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

function normalizeValue(value) {
  if (!value) return '';
  return String(value).replace(/\D/g, '').trim();
}

function normalizeText(value) {
  if (!value) return '';
  return String(value)
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^\w\s]/gi, '')
    .replace(/\s+/g, '')
    .trim();
}

function normalizePhone(phone) {
  if (!phone) return '';
  let clean = String(phone).replace(/\D/g, '');

  // Remove o DDI 55 se estiver presente (12 ou 13 dígitos)
  if (clean.startsWith('55')) {
    clean = clean.slice(2);
  }

  // Se sobrar 10 dígitos, é porque o WhatsApp enviou SEM o 9 do celular
  // Ex: 8191842731 -> insere o 9 após o DDD -> 81991842731
  if (clean.length === 10 && clean.startsWith('8')) {
    clean = clean.slice(0, 2) + '9' + clean.slice(2);
  }

  return clean;
}

module.exports = {
  findClientById,
  findClientByCpfCnpj,
  findClientByPhone,
  findQuoteRequest,
  normalizeValue,
  normalizeText,
  normalizePhone
};
