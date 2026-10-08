-- AlterTable
ALTER TABLE "organization" ADD COLUMN     "useWordsToBlockCampaign" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "wordsToBlockCampaign" TEXT[] DEFAULT ARRAY[]::TEXT[];

-- CreateTable
CREATE TABLE "campaign" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "templateText" TEXT NOT NULL,
    "variableCount" INTEGER NOT NULL DEFAULT 0,
    "phoneNumber" TEXT,
    "status" TEXT NOT NULL DEFAULT 'PROCESSING',
    "dispatchType" TEXT NOT NULL DEFAULT 'CSV',
    "expectedContacts" INTEGER NOT NULL DEFAULT 0,
    "totalContacts" INTEGER NOT NULL DEFAULT 0,
    "totalSent" INTEGER NOT NULL DEFAULT 0,
    "totalFailures" INTEGER NOT NULL DEFAULT 0,
    "createdByUserId" TEXT,
    "createdByName" TEXT,
    "createdByEmail" TEXT,
    "batchSize" INTEGER NOT NULL,
    "batchIntervalMinutes" INTEGER NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "pausedReason" TEXT,
    "scheduledAt" TIMESTAMP(3),
    "nextBatchAt" TIMESTAMP(3),
    "sentAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "campaign_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "campaign_pending_contact" (
    "id" TEXT NOT NULL,
    "campaignId" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "contact" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "campaign_pending_contact_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "campaign_target" (
    "id" TEXT NOT NULL,
    "campaignId" TEXT NOT NULL,
    "targetId" TEXT,
    "phone" TEXT NOT NULL,
    "name" TEXT,
    "status" TEXT NOT NULL DEFAULT 'QUEUED',
    "error" TEXT,
    "messageId" TEXT,
    "variables" JSONB NOT NULL DEFAULT '[]',
    "text" TEXT,
    "respondedCampaign" BOOLEAN NOT NULL DEFAULT false,
    "campaignResponse" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "campaign_target_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "target_block_campaign" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "targetId" TEXT NOT NULL,
    "reason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "target_block_campaign_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "campaign_organizationId_sentAt_idx" ON "campaign"("organizationId", "sentAt");

-- CreateIndex
CREATE INDEX "campaign_status_active_nextBatchAt_idx" ON "campaign"("status", "active", "nextBatchAt");

-- CreateIndex
CREATE INDEX "campaign_pending_contact_campaignId_position_idx" ON "campaign_pending_contact"("campaignId", "position");

-- CreateIndex
CREATE UNIQUE INDEX "campaign_target_messageId_key" ON "campaign_target"("messageId");

-- CreateIndex
CREATE INDEX "campaign_target_campaignId_idx" ON "campaign_target"("campaignId");

-- CreateIndex
CREATE INDEX "campaign_target_targetId_respondedCampaign_idx" ON "campaign_target"("targetId", "respondedCampaign");

-- CreateIndex
CREATE UNIQUE INDEX "target_block_campaign_targetId_key" ON "target_block_campaign"("targetId");

-- CreateIndex
CREATE INDEX "target_block_campaign_organizationId_idx" ON "target_block_campaign"("organizationId");

-- AddForeignKey
ALTER TABLE "campaign" ADD CONSTRAINT "campaign_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "campaign_pending_contact" ADD CONSTRAINT "campaign_pending_contact_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "campaign"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "campaign_target" ADD CONSTRAINT "campaign_target_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "campaign"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "campaign_target" ADD CONSTRAINT "campaign_target_targetId_fkey" FOREIGN KEY ("targetId") REFERENCES "target"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "target_block_campaign" ADD CONSTRAINT "target_block_campaign_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "target_block_campaign" ADD CONSTRAINT "target_block_campaign_targetId_fkey" FOREIGN KEY ("targetId") REFERENCES "target"("id") ON DELETE CASCADE ON UPDATE CASCADE;
