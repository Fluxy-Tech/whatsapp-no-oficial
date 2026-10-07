import { createCipheriv, createDecipheriv, createHash, randomBytes } from "crypto";

// Agent API keys (OpenAI / Google ADK) are stored encrypted with AES-256-GCM.
// Format: "v1:<iv>:<authTag>:<ciphertext>" (base64 parts).
const PREFIX = "v1";

function key() {
  const secret = process.env.AGENT_TOKENS_SECRET;
  if (!secret) throw new Error("AGENT_TOKENS_SECRET is not configured");
  return createHash("sha256").update(secret).digest();
}

export function encryptSecret(plain: string) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key(), iv);
  const encrypted = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  return [PREFIX, iv.toString("base64"), cipher.getAuthTag().toString("base64"), encrypted.toString("base64")].join(":");
}

export function decryptSecret(value: string | null | undefined): string | null {
  if (!value) return null;
  const [prefix, iv, tag, data] = value.split(":");
  if (prefix !== PREFIX || !iv || !tag || !data) return null;

  const decipher = createDecipheriv("aes-256-gcm", key(), Buffer.from(iv, "base64"));
  decipher.setAuthTag(Buffer.from(tag, "base64"));
  return Buffer.concat([decipher.update(Buffer.from(data, "base64")), decipher.final()]).toString("utf8");
}

/** What the UI may see about a stored key: whether it exists and its last 4 chars. */
export function describeSecret(value: string | null | undefined) {
  const plain = decryptSecret(value);
  return { configured: Boolean(plain), last4: plain ? plain.slice(-4) : null };
}
