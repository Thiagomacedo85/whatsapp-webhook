const RDSTATION_TOKEN = process.env.RDSTATION_TOKEN;
const RDSTATION_CRM_TOKEN = process.env.RDSTATION_CRM_TOKEN;

/**
 * Cria lead/deal no RD Station
 */
async function createLeadDeal(phoneNumber) {
  const response = await fetch('https://crm.rdstation.com/api/v1/deals', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Token': RDSTATION_CRM_TOKEN
    },
    body: JSON.stringify({
      deal: {
        name: `Lead WhatsApp - ${phoneNumber}`,
        phone: phoneNumber,
        stage_id: process.env.RDSTATION_STAGE_SEM_CONTATO
      }
    })
  });

  const data = await response.json();
  return data.deal?.id || null;
}

/**
 * Adiciona nota ao deal
 */
async function addNoteToDeal(dealId, note) {
  await fetch(`https://crm.rdstation.com/api/v1/deals/${dealId}/notes`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Token': RDSTATION_CRM_TOKEN
    },
    body: JSON.stringify({ note: { content: note } })
  });
}

/**
 * Atualiza estágio do deal
 */
async function updateDealStage(dealId, stageId) {
  await fetch(`https://crm.rdstation.com/api/v1/deals/${dealId}`, {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
      'Token': RDSTATION_CRM_TOKEN
    },
    body: JSON.stringify({ deal: { stage_id: stageId } })
  });
}

module.exports = {
  createLeadDeal,
  addNoteToDeal,
  updateDealStage
};
