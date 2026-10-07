-- Contacts (targets) and WhatsApp session state move to Postgres; MongoDB
-- keeps only messages. Existing target rows are preserved.

-- whatsapp_session: last connection error reported by worker-whatsapp
ALTER TABLE "whatsapp_session" ADD COLUMN "lastError" TEXT;

-- target: owned by the organization instead of the WhatsApp session
ALTER TABLE "target" ADD COLUMN "organizationId" TEXT;
UPDATE "target" t
SET "organizationId" = s."organizationId"
FROM "whatsapp_session" s
WHERE s."id" = t."whatsappSessionId";
DELETE FROM "target" WHERE "organizationId" IS NULL;
ALTER TABLE "target" ALTER COLUMN "organizationId" SET NOT NULL;

ALTER TABLE "target" DROP CONSTRAINT "target_whatsappSessionId_fkey";
DROP INDEX "target_whatsappSessionId_targetId_key";
ALTER TABLE "target" DROP COLUMN "whatsappSessionId";
ALTER TABLE "target" DROP COLUMN "isGroup";

ALTER TABLE "target" RENAME COLUMN "targetId" TO "chatId";
ALTER TABLE "target"
    ADD COLUMN "number" TEXT,
    ADD COLUMN "lastSeen" TIMESTAMP(3),
    ADD COLUMN "isOnline" BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN "agentActive" BOOLEAN NOT NULL DEFAULT true,
    ADD COLUMN "extras" JSONB NOT NULL DEFAULT '{}';

ALTER TABLE "target" ALTER COLUMN "firstMessageAt" DROP NOT NULL;
ALTER TABLE "target" ALTER COLUMN "firstMessageAt" DROP DEFAULT;
ALTER TABLE "target" ALTER COLUMN "lastMessageAt" DROP NOT NULL;
ALTER TABLE "target" ALTER COLUMN "lastMessageAt" DROP DEFAULT;

UPDATE "target" SET "number" = split_part("chatId", '@', 1) WHERE "chatId" LIKE '%@c.us';

-- Same contact could exist once per (old) session; keep the most recent one.
DELETE FROM "target" a
USING "target" b
WHERE a."organizationId" = b."organizationId"
  AND a."chatId" = b."chatId"
  AND a."updatedAt" < b."updatedAt";

CREATE UNIQUE INDEX "target_organizationId_chatId_key" ON "target"("organizationId", "chatId");
CREATE INDEX "target_organizationId_lastMessageAt_idx" ON "target"("organizationId", "lastMessageAt");

ALTER TABLE "target" ADD CONSTRAINT "target_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
