-- Human handoff: the agent hands the conversation over to an attendant when the contact asks for a person.
-- AlterTable
ALTER TABLE "agent" ADD COLUMN     "humanHandoffEnabled" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "human_handoff" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "targetId" TEXT NOT NULL,
    "chatId" TEXT NOT NULL,
    "agentId" TEXT,
    "reason" TEXT NOT NULL DEFAULT '',
    "summaryStatus" TEXT NOT NULL DEFAULT 'pending',
    "summary" TEXT,
    "keyPoints" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "summaryError" TEXT,
    "acknowledgedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "human_handoff_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "human_handoff_organizationId_acknowledgedAt_idx" ON "human_handoff"("organizationId", "acknowledgedAt");

-- CreateIndex
CREATE INDEX "human_handoff_targetId_createdAt_idx" ON "human_handoff"("targetId", "createdAt");

-- AddForeignKey
ALTER TABLE "human_handoff" ADD CONSTRAINT "human_handoff_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "human_handoff" ADD CONSTRAINT "human_handoff_targetId_fkey" FOREIGN KEY ("targetId") REFERENCES "target"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "human_handoff" ADD CONSTRAINT "human_handoff_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES "agent"("id") ON DELETE SET NULL ON UPDATE CASCADE;

