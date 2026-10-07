import { DeleteObjectCommand, GetObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";

// Same SeaweedFS bucket used by worker-whatsapp; here for RAG documents
// uploaded on the agent screen and files attached to leads. Path-style addressing is required by SeaweedFS.
const endpoint = (process.env.SEAWEEDFS_S3_ENDPOINT ?? "").replace(/\/+$/, "");
const bucket = process.env.SEAWEEDFS_S3_BUCKET ?? "";
const prefix = (process.env.SEAWEEDFS_S3_PREFIX ?? "").replace(/^\/+|\/+$/g, "");

let client: S3Client | null = null;

function s3() {
  if (!endpoint || !bucket) throw new Error("SEAWEEDFS_S3_ENDPOINT / SEAWEEDFS_S3_BUCKET are not configured");
  client ??= new S3Client({
    endpoint,
    region: process.env.SEAWEEDFS_S3_REGION ?? "us-east-1",
    forcePathStyle: true,
    credentials: {
      accessKeyId: process.env.SEAWEEDFS_S3_ACCESS_KEY ?? "",
      secretAccessKey: process.env.SEAWEEDFS_S3_SECRET_KEY ?? "",
    },
  });
  return client;
}

const bucketUrlPrefix = () => `${endpoint}/${bucket}/`;

/** Uploads a file and returns its path-style URL (endpoint/bucket/key). */
export async function uploadAgentDocument(agentId: string, filename: string, body: Buffer, contentType: string) {
  const safeName = filename.normalize("NFKD").replace(/[^\w.-]+/g, "_").slice(-120) || "documento";
  const key = [prefix, "agents", agentId, "documents", `${Date.now()}-${safeName}`].filter(Boolean).join("/");

  await s3().send(new PutObjectCommand({ Bucket: bucket, Key: key, Body: body, ContentType: contentType }));
  return `${bucketUrlPrefix()}${key}`;
}

/** Deletes a file previously uploaded by uploadAgentDocument; external links are left alone. */
export async function deleteIfStoredDocument(url: string) {
  if (!endpoint || !url.startsWith(bucketUrlPrefix())) return;
  await s3().send(new DeleteObjectCommand({ Bucket: bucket, Key: url.slice(bucketUrlPrefix().length) }));
}

const safeFileName = (filename: string, fallback: string) =>
  filename.normalize("NFKD").replace(/[^\w.-]+/g, "_").slice(-120) || fallback;

/** Stores a file attached to a lead; returns its object key. */
export async function uploadLeadAttachment(
  organizationId: string,
  targetId: string,
  filename: string,
  body: Buffer,
  contentType: string,
) {
  const key = [prefix, "organizations", organizationId, "leads", targetId, `${Date.now()}-${safeFileName(filename, "arquivo")}`]
    .filter(Boolean)
    .join("/");
  await s3().send(new PutObjectCommand({ Bucket: bucket, Key: key, Body: body, ContentType: contentType }));
  return key;
}

/** Object body as a Node stream (downloads go through the backend, which checks access). */
export async function getObjectStream(key: string) {
  const object = await s3().send(new GetObjectCommand({ Bucket: bucket, Key: key }));
  return object.Body as NodeJS.ReadableStream;
}

export async function deleteObject(key: string) {
  await s3().send(new DeleteObjectCommand({ Bucket: bucket, Key: key }));
}

// One object per user: a new photo overwrites the previous one.
const avatarKey = (userId: string) => [prefix, "users", userId, "avatar"].filter(Boolean).join("/");

export async function uploadUserAvatar(userId: string, body: Buffer, contentType: string) {
  await s3().send(new PutObjectCommand({ Bucket: bucket, Key: avatarKey(userId), Body: body, ContentType: contentType }));
}

export async function getUserAvatar(userId: string) {
  const object = await s3().send(new GetObjectCommand({ Bucket: bucket, Key: avatarKey(userId) }));
  return { stream: object.Body as NodeJS.ReadableStream, contentType: object.ContentType ?? "image/jpeg" };
}

export async function deleteUserAvatar(userId: string) {
  await s3().send(new DeleteObjectCommand({ Bucket: bucket, Key: avatarKey(userId) }));
}
