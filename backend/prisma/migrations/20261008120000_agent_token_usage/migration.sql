-- CreateTable
CREATE TABLE "agent_token_usage" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "agentId" TEXT NOT NULL,
    "targetId" TEXT,
    "kind" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "inputTokens" INTEGER NOT NULL DEFAULT 0,
    "outputTokens" INTEGER NOT NULL DEFAULT 0,
    "totalTokens" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "agent_token_usage_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "agent_token_usage_agentId_createdAt_idx" ON "agent_token_usage"("agentId", "createdAt");

-- CreateIndex
CREATE INDEX "agent_token_usage_organizationId_createdAt_idx" ON "agent_token_usage"("organizationId", "createdAt");

-- AddForeignKey
ALTER TABLE "agent_token_usage" ADD CONSTRAINT "agent_token_usage_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agent_token_usage" ADD CONSTRAINT "agent_token_usage_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES "agent"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agent_token_usage" ADD CONSTRAINT "agent_token_usage_targetId_fkey" FOREIGN KEY ("targetId") REFERENCES "target"("id") ON DELETE SET NULL ON UPDATE CASCADE;

