const RD_TOKEN = process.env.RDSTATION_CRM_TOKEN;
const RD_STAGE_ID = process.env.RDSTATION_STAGE_ID;
const RD_BASE_URL = 'https://crm.rdstation.com/api/v1';

/**
 * Cria uma negociação (deal) no RD Station CRM para um novo lead do WhatsApp,
 * já vinculando o contato pelo telefone e colocando na etapa do funil configurada
 * (RDSTATION_STAGE_ID). Nunca lança erro - se falhar, só loga e retorna null,
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

  const body = {
    deal: {
      name: `Lead WhatsApp - ${name || phone}`,
      deal_stage_id: RD_STAGE_ID,
      contacts: [
        {
          name: name || phone,
          phones: [{ phone: phone, type: 'cellphone' }]
        }
      ]
    }
  };

  try {
    const response = await fetch(`${RD_BASE_URL}/deals?token=${RD_TOKEN}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });

    const data = await response.json();

    if (!response.ok) {
      console.error('RD Station: erro ao criar negociação:', response.status, JSON.stringify(data));
      return null;
    }

    console.log(`RD Station: negociação criada para ${phone} (deal_id=${data.id})`);
    return data.id || null;
  } catch (err) {
    console.error('RD Station: falha na chamada da API:', err.message);
    return null;
  }
}

module.exports = { createLeadDeal };
