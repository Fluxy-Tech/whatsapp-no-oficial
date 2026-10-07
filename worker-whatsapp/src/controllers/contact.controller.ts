import type { Request, Response } from "express";
import { getContactSnapshot } from "../services/contact.service";
import { notifyBackend } from "../services/webhook.service";
import { getClient } from "../services/whatsapp/session.manager";
import { HttpError } from "../utils/http-error";

/**
 * Busca agora no WhatsApp nome, número e última visualização do contato e
 * envia ao backend (contact.updated), que é quem guarda os contatos.
 * :chatId é o id do WhatsApp (5511999999999@c.us) ou só o número.
 */
export async function refresh(req: Request<{ organizationId: string; chatId: string }>, res: Response) {
  const { organizationId } = req.params;
  if (!getClient(organizationId)) throw new HttpError(409, "Sessão do WhatsApp não está conectada");

  const raw = decodeURIComponent(req.params.chatId);
  const chatId = raw.includes("@") ? raw : `${raw.replace(/\D/g, "")}@c.us`;

  const contact = await getContactSnapshot(organizationId, chatId, { force: true });
  await notifyBackend("contact.updated", organizationId, { contact });
  res.json(contact);
}
