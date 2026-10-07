import type { Prisma } from "@prisma/client";
import { whatsappEvents } from "../lib/events";
import { prisma } from "../lib/prisma";
import { deleteObject, getObjectStream, uploadLeadAttachment } from "../lib/s3";

export class LeadNotesError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

const MAX_COMMENT_LENGTH = 5000;

type Actor = { userId: string; canManage: boolean };

const commentInclude = { author: { select: { id: true, name: true, image: true } } } satisfies Prisma.LeadCommentInclude;
const attachmentInclude = { uploadedBy: { select: { id: true, name: true } } } satisfies Prisma.LeadAttachmentInclude;

type CommentRow = Prisma.LeadCommentGetPayload<{ include: typeof commentInclude }>;
type AttachmentRow = Prisma.LeadAttachmentGetPayload<{ include: typeof attachmentInclude }>;

const commentView = (comment: CommentRow) => ({
  id: comment.id,
  body: comment.body,
  author: comment.author,
  createdAt: comment.createdAt.toISOString(),
  updatedAt: comment.updatedAt.toISOString(),
});

const attachmentView = (attachment: AttachmentRow) => ({
  id: attachment.id,
  fileName: attachment.fileName,
  mimeType: attachment.mimeType,
  size: attachment.size,
  uploadedBy: attachment.uploadedBy,
  createdAt: attachment.createdAt.toISOString(),
});

async function loadLead(organizationId: string, targetId: string) {
  const target = await prisma.target.findFirst({ where: { id: targetId, organizationId }, select: { id: true } });
  if (!target) throw new LeadNotesError(404, "Lead não encontrado");
  return target;
}

/** Board cards show the comment/attachment counts: refresh them. */
const notify = (organizationId: string) => whatsappEvents.emit("kanban-updated", { organizationId });

export async function listNotes(organizationId: string, targetId: string) {
  await loadLead(organizationId, targetId);
  const [comments, attachments] = await Promise.all([
    prisma.leadComment.findMany({ where: { targetId }, include: commentInclude, orderBy: { createdAt: "asc" } }),
    prisma.leadAttachment.findMany({ where: { targetId }, include: attachmentInclude, orderBy: { createdAt: "desc" } }),
  ]);
  return { comments: comments.map(commentView), attachments: attachments.map(attachmentView) };
}

export async function addComment(organizationId: string, targetId: string, authorId: string, rawBody: unknown) {
  await loadLead(organizationId, targetId);
  const body = String(rawBody ?? "").trim();
  if (!body) throw new LeadNotesError(400, "Escreva o comentário");
  if (body.length > MAX_COMMENT_LENGTH) {
    throw new LeadNotesError(400, `O comentário deve ter até ${MAX_COMMENT_LENGTH} caracteres`);
  }
  const comment = await prisma.leadComment.create({
    data: { organizationId, targetId, authorId, body },
    include: commentInclude,
  });
  notify(organizationId);
  return commentView(comment);
}

/** Only the author (or a manager) removes a comment. */
export async function deleteComment(organizationId: string, targetId: string, commentId: string, actor: Actor) {
  const comment = await prisma.leadComment.findFirst({ where: { id: commentId, targetId, organizationId } });
  if (!comment) throw new LeadNotesError(404, "Comentário não encontrado");
  if (comment.authorId !== actor.userId && !actor.canManage) {
    throw new LeadNotesError(403, "Só quem escreveu (ou o gerente) pode apagar este comentário");
  }
  await prisma.leadComment.delete({ where: { id: comment.id } });
  notify(organizationId);
}

export async function addAttachment(
  organizationId: string,
  targetId: string,
  uploadedById: string,
  file: { originalname: string; buffer: Buffer; mimetype: string; size: number },
) {
  await loadLead(organizationId, targetId);
  const storageKey = await uploadLeadAttachment(organizationId, targetId, file.originalname, file.buffer, file.mimetype);
  const attachment = await prisma.leadAttachment.create({
    data: {
      organizationId,
      targetId,
      uploadedById,
      fileName: file.originalname,
      mimeType: file.mimetype || "application/octet-stream",
      size: file.size,
      storageKey,
    },
    include: attachmentInclude,
  });
  notify(organizationId);
  return attachmentView(attachment);
}

export async function openAttachment(organizationId: string, targetId: string, attachmentId: string) {
  const attachment = await prisma.leadAttachment.findFirst({ where: { id: attachmentId, targetId, organizationId } });
  if (!attachment) throw new LeadNotesError(404, "Arquivo não encontrado");
  return { attachment, stream: await getObjectStream(attachment.storageKey) };
}

/** Only who uploaded it (or a manager) removes a file. */
export async function deleteAttachment(organizationId: string, targetId: string, attachmentId: string, actor: Actor) {
  const attachment = await prisma.leadAttachment.findFirst({ where: { id: attachmentId, targetId, organizationId } });
  if (!attachment) throw new LeadNotesError(404, "Arquivo não encontrado");
  if (attachment.uploadedById !== actor.userId && !actor.canManage) {
    throw new LeadNotesError(403, "Só quem enviou (ou o gerente) pode apagar este arquivo");
  }
  await prisma.leadAttachment.delete({ where: { id: attachment.id } });
  await deleteObject(attachment.storageKey).catch((error) =>
    console.error(`Failed to delete ${attachment.storageKey} from S3:`, error),
  );
  notify(organizationId);
}
