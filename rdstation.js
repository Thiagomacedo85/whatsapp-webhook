const RD_TOKEN = process.env.RDSTATION_CRM_TOKEN;
const RD_STAGE_ID = process.env.RDSTATION_STAGE_ID;
const RD_SOURCE_ID = process.env.RDSTATION_SOURCE_ID;
const RD_USER_ID = process.env.RDSTATION_USER_ID;
const RD_BASE_URL = 'https://crm.rdstation.com/api/v1';

/**
 * Cria um contato no RD Station CRM. Retorna o ID do contato criado.
 * Lança erro se falhar (quem chama decide o que fazer).
 */
async function createContact(phone, name) {
  const body = {
    contact: {
      name: name || phone,
      // Tipos aceitos pela API v1 de Contatos: home, work, fax (não existe "cellphone" aqui)
      phones: [{ phone: phone, type: 'work' }]
    }
  };

  const response = await fetch(`${RD_BASE_URL}/contacts?token=${RD_TOKEN}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });

  const data = await response.json();
  if (!response.ok) {
    throw new Error(`Erro ao criar contato (${response.status}): ${JSON.stringify(data)}`);
  }
  return data.id;
}

/**
 * Cria uma negociação (deal) no RD Station CRM para um novo lead do WhatsApp:
 * primeiro cria o contato, depois cria a negociação já vinculada a ele (contact_ids),
 * na etapa e fonte configuradas. Nunca lança erro - se falhar, só loga e retorna null,
 * pra nunca travar a resposta do bot no WhatsApp por causa do CRM.
 *
 * @param {string} phone - número de telefone do lead (formato do WhatsApp, ex: 5581999999999)
 * @param {string} [name] - nome do lead, se disponível. Usa o telefone se não tiver.
 * @returns {Promise<string|null>} o ID da negociação criada, ou null se falhar
 */
async function createLeadDeal(phone, name) {
  if (!RD_TOKEN || !RD_STAGE_ID) {
    console.warn('RD Station: RDSTATION_CRM_TOKEN ou RDSTATION_STAGE_ID não configurados, pulando criação de lead.');
    return null;
  }

  try {
    const contactId = await createContact(phone, name);

    const dealBody = {
      deal: {
        name: `Lead WhatsApp - ${name || phone}`,
        deal_stage_id: RD_STAGE_ID,
        contact_ids: [contactId]
      }
    };
    if (RD_SOURCE_ID) {
      dealBody.deal.deal_source_id = RD_SOURCE_ID;
    }

    const response = await fetch(`${RD_BASE_URL}/deals?token=${RD_TOKEN}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(dealBody)
    });

    const data = await response.json();

    if (!response.ok) {
      console.error('RD Station: erro ao criar negociação:', response.status, JSON.stringify(data));
      return null;
    }

    console.log(`RD Station: negociação criada para ${phone} (deal_id=${data.id}, contact_id=${contactId})`);
    return data.id || null;
  } catch (err) {
    console.error('RD Station: falha ao criar lead:', err.message);
    return null;
  }
}

/**
 * Adiciona uma anotação (nota) numa negociação existente - usado pra registrar
 * o histórico da conversa do WhatsApp direto no CRM. Nunca lança erro.
 *
 * @param {string} dealId - ID da negociação
 * @param {string} text - texto da anotação
 */
async function addNoteToDeal(dealId, text) {
  if (!RD_TOKEN || !RD_USER_ID || !dealId) return null;

  const body = {
    user_id: RD_USER_ID,
    deal_id: dealId,
    text: text
  };

  try {
    const response = await fetch(`${RD_BASE_URL}/activities?token=${RD_TOKEN}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });

    const data = await response.json();

    if (!response.ok) {
      console.error('RD Station: erro ao criar anotação:', response.status, JSON.stringify(data));
      return null;
    }

    return data.id || null;
  } catch (err) {
    console.error('RD Station: falha ao criar anotação:', err.message);
    return null;
  }
}

module.exports = { createLeadDeal, addNoteToDeal };
