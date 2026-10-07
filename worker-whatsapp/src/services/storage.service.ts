import { GetObjectCommand, HeadBucketCommand, PutObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import mime from "mime-types";
import { env } from "../config/env";
import { s3 } from "../config/s3";

export type StoredMedia = {
  bucket: string;
  key: string;
  mimetype: string | null;
  filename: string | null;
  size: number;
};

function sanitizeSegment(value: string) {
  return value.replace(/[^a-zA-Z0-9@._-]/g, "_");
}

function extensionFor(mimetype: string | null, filename: string | null) {
  const fromName = filename?.includes(".") ? filename.split(".").pop() : null;
  if (fromName) return fromName.toLowerCase();
  // "audio/ogg; codecs=opus" -> "audio/ogg"
  const ext = mimetype ? mime.extension(mimetype.split(";")[0].trim()) : false;
  return ext || "bin";
}

// <prefixo>/<organizationId>/<chatId>/<AAAA-MM>/<messageId>.<ext>
function buildKey(params: { organizationId: string; chatId: string; messageId: string; ext: string; at: Date }) {
  const month = `${params.at.getUTCFullYear()}-${String(params.at.getUTCMonth() + 1).padStart(2, "0")}`;
  return [
    env.SEAWEEDFS_S3_PREFIX,
    sanitizeSegment(params.organizationId),
    sanitizeSegment(params.chatId),
    month,
    `${sanitizeSegment(params.messageId)}.${params.ext}`,
  ]
    .filter(Boolean)
    .join("/");
}

export async function uploadMessageMedia(params: {
  organizationId: string;
  chatId: string;
  messageId: string;
  buffer: Buffer;
  mimetype: string | null;
  filename: string | null;
  at: Date;
}): Promise<StoredMedia> {
  const key = buildKey({ ...params, ext: extensionFor(params.mimetype, params.filename) });

  await s3.send(
    new PutObjectCommand({
      Bucket: env.SEAWEEDFS_S3_BUCKET,
      Key: key,
      Body: params.buffer,
      ContentType: params.mimetype ?? "application/octet-stream",
      ContentLength: params.buffer.length,
      Metadata: {
        organization: params.organizationId,
        chat: params.chatId,
        ...(params.filename ? { filename: encodeURIComponent(params.filename) } : {}),
      },
    }),
  );

  return {
    bucket: env.SEAWEEDFS_S3_BUCKET,
    key,
    mimetype: params.mimetype,
    filename: params.filename,
    size: params.buffer.length,
  };
}

export async function getMediaUrl(media: { bucket: string; key: string; filename?: string | null }) {
  return getSignedUrl(
    s3,
    new GetObjectCommand({
      Bucket: media.bucket,
      Key: media.key,
      ...(media.filename
        ? { ResponseContentDisposition: `inline; filename*=UTF-8''${encodeURIComponent(media.filename)}` }
        : {}),
    }),
    { expiresIn: env.S3_PRESIGNED_URL_TTL },
  );
}

export async function checkStorage() {
  await s3.send(new HeadBucketCommand({ Bucket: env.SEAWEEDFS_S3_BUCKET }));
}
