-- AlterTable
ALTER TABLE "organization" ADD COLUMN     "agentId" TEXT;

-- CreateTable
CREATE TABLE "agent" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "context" TEXT NOT NULL DEFAULT '',
    "tokenOpenAi" TEXT,
    "tokenAdk" TEXT,
    "documents" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "documentsStatus" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "agent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "metadado" (
    "id" TEXT NOT NULL,
    "agentId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "descricao" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "metadado_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "agent_organizationId_idx" ON "agent"("organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "metadado_agentId_name_key" ON "metadado"("agentId", "name");

-- CreateIndex
CREATE UNIQUE INDEX "organization_agentId_key" ON "organization"("agentId");

-- AddForeignKey
ALTER TABLE "organization" ADD CONSTRAINT "organization_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES "agent"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agent" ADD CONSTRAINT "agent_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "metadado" ADD CONSTRAINT "metadado_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES "agent"("id") ON DELETE CASCADE ON UPDATE CASCADE;

