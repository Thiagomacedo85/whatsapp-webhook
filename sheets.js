const APPS_SCRIPT_URL = process.env.APPS_SCRIPT_URL;

async function callAppsScript(action, payload = {}) {
  if (!APPS_SCRIPT_URL) {
    throw new Error('APPS_SCRIPT_URL não configurada nas variáveis de ambiente');
  }

  const response = await fetch(APPS_SCRIPT_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'text/plain;charset=utf-8'
    },
    body: JSON.stringify({ action, ...payload }),
    redirect: 'follow'
  });

  const text = await response.text();

  // Verifica se a resposta é HTML (erro do Apps Script)
  if (text.trim().startsWith('<')) {
    throw new Error(`Apps Script retornou HTML (provavelmente erro de URL ou deploy). Resposta: ${text.slice(0, 300)}`);
  }

  let data;
  try {
    data = JSON.parse(text);
  } catch (e) {
    throw new Error(`Resposta não-JSON do Apps Script: ${text.slice(0, 200)}`);
  }

  return data;
}

async function buscarClientePorId(id) {
  const result = await callAppsScript('buscarPorId', { id });
  return result?.data || null;
}

async function buscarClientePorDocumento(doc) {
  const result = await callAppsScript('buscarPorDocumento', { documento: doc });
  return result?.data || null;
}

module.exports = { buscarClientePorId, buscarClientePorDocumento };
