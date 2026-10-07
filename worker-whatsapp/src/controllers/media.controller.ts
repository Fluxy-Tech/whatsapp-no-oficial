import type { Request, Response } from "express";
import { findMessageById } from "../services/message.service";
import { getMediaUrl } from "../services/storage.service";
import { HttpError } from "../utils/http-error";

/**
 * Gera uma URL assinada nova para a mídia de uma mensagem (as do webhook
 * expiram). :id aceita o _id do Mongo ou o messageId do WhatsApp.
 * Com ?redirect=true responde 302 direto para o arquivo.
 */
export async function show(req: Request<{ organizationId: string; id: string }>, res: Response) {
  const message = await findMessageById(req.params.organizationId, decodeURIComponent(req.params.id));
  if (!message) throw new HttpError(404, "Mensagem não encontrada");
  if (!message.media) throw new HttpError(404, "Mensagem não possui mídia armazenada", { mediaError: message.mediaError });

  const url = await getMediaUrl(message.media);
  if (req.query.redirect === "true") return res.redirect(302, url);

  res.json({
    url,
    mimetype: message.media.mimetype ?? null,
    filename: message.media.filename ?? null,
    size: message.media.size ?? null,
  });
}
