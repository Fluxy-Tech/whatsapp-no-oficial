/// Formato de CampaignPendingContact.contact, gravado pelo backend ao criar a
/// campanha (ver backend/src/services/campaign.service.ts#createCampaign).
export interface PendingContact {
  /// Só dígitos, com DDI (ex: 5511999999999). O worker-whatsapp resolve o
  /// chatId real (com ou sem o nono dígito) antes de enviar.
  phone: string;
  name?: string;
  /// Valores de {{1}}, {{2}}... na ordem.
  variables: string[];
}
