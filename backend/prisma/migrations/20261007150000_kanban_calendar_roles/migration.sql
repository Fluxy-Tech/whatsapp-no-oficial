-- AlterTable
ALTER TABLE "agent" ADD COLUMN     "completedStageId" TEXT,
ADD COLUMN     "leadOnFirstMessage" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "leadStageId" TEXT,
ADD COLUMN     "maxEventsPerDay" INTEGER,
ADD COLUMN     "maxEventsPerSlot" INTEGER,
ADD COLUMN     "meetingDurationMinutes" INTEGER NOT NULL DEFAULT 60,
ADD COLUMN     "schedulingEnabled" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "schedulingEndTime" TEXT NOT NULL DEFAULT '18:00',
ADD COLUMN     "schedulingStartTime" TEXT NOT NULL DEFAULT '09:00',
ADD COLUMN     "schedulingWeekdays" INTEGER[] DEFAULT ARRAY[1, 2, 3, 4, 5]::INTEGER[];

-- AlterTable
ALTER TABLE "invitation" ADD COLUMN     "code" TEXT;

-- AlterTable
ALTER TABLE "member" ADD COLUMN     "acceptsEvents" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "acceptsLeads" BOOLEAN NOT NULL DEFAULT false,
ALTER COLUMN "role" SET DEFAULT 'atendente';

-- AlterTable
ALTER TABLE "metadado" ADD COLUMN     "stageId" TEXT;

-- CreateTable
CREATE TABLE "organization_role_permission" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "permissions" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "organization_role_permission_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pipeline" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "position" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "pipeline_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pipeline_stage" (
    "id" TEXT NOT NULL,
    "pipelineId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "color" TEXT NOT NULL DEFAULT '#8b5cf6',
    "position" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "pipeline_stage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "lead_card" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "targetId" TEXT NOT NULL,
    "pipelineId" TEXT NOT NULL,
    "stageId" TEXT NOT NULL,
    "position" INTEGER NOT NULL DEFAULT 0,
    "assigneeId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "lead_card_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "calendar_event" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "startsAt" TIMESTAMP(3) NOT NULL,
    "endsAt" TIMESTAMP(3) NOT NULL,
    "assigneeId" TEXT,
    "targetId" TEXT,
    "source" TEXT NOT NULL DEFAULT 'manual',
    "status" TEXT NOT NULL DEFAULT 'scheduled',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "calendar_event_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "organization_role_permission_organizationId_role_key" ON "organization_role_permission"("organizationId", "role");

-- CreateIndex
CREATE INDEX "pipeline_organizationId_position_idx" ON "pipeline"("organizationId", "position");

-- CreateIndex
CREATE INDEX "pipeline_stage_pipelineId_position_idx" ON "pipeline_stage"("pipelineId", "position");

-- CreateIndex
CREATE UNIQUE INDEX "lead_card_targetId_key" ON "lead_card"("targetId");

-- CreateIndex
CREATE INDEX "lead_card_organizationId_idx" ON "lead_card"("organizationId");

-- CreateIndex
CREATE INDEX "lead_card_stageId_position_idx" ON "lead_card"("stageId", "position");

-- CreateIndex
CREATE INDEX "calendar_event_organizationId_startsAt_idx" ON "calendar_event"("organizationId", "startsAt");

-- CreateIndex
CREATE INDEX "calendar_event_assigneeId_startsAt_idx" ON "calendar_event"("assigneeId", "startsAt");

-- CreateIndex
CREATE UNIQUE INDEX "invitation_code_key" ON "invitation"("code");

-- AddForeignKey
ALTER TABLE "agent" ADD CONSTRAINT "agent_leadStageId_fkey" FOREIGN KEY ("leadStageId") REFERENCES "pipeline_stage"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agent" ADD CONSTRAINT "agent_completedStageId_fkey" FOREIGN KEY ("completedStageId") REFERENCES "pipeline_stage"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "metadado" ADD CONSTRAINT "metadado_stageId_fkey" FOREIGN KEY ("stageId") REFERENCES "pipeline_stage"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "organization_role_permission" ADD CONSTRAINT "organization_role_permission_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pipeline" ADD CONSTRAINT "pipeline_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pipeline_stage" ADD CONSTRAINT "pipeline_stage_pipelineId_fkey" FOREIGN KEY ("pipelineId") REFERENCES "pipeline"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lead_card" ADD CONSTRAINT "lead_card_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lead_card" ADD CONSTRAINT "lead_card_targetId_fkey" FOREIGN KEY ("targetId") REFERENCES "target"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lead_card" ADD CONSTRAINT "lead_card_pipelineId_fkey" FOREIGN KEY ("pipelineId") REFERENCES "pipeline"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lead_card" ADD CONSTRAINT "lead_card_stageId_fkey" FOREIGN KEY ("stageId") REFERENCES "pipeline_stage"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lead_card" ADD CONSTRAINT "lead_card_assigneeId_fkey" FOREIGN KEY ("assigneeId") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "calendar_event" ADD CONSTRAINT "calendar_event_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "calendar_event" ADD CONSTRAINT "calendar_event_assigneeId_fkey" FOREIGN KEY ("assigneeId") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "calendar_event" ADD CONSTRAINT "calendar_event_targetId_fkey" FOREIGN KEY ("targetId") REFERENCES "target"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- Data: better-auth's default roles become the new ones.
-- owner/admin -> gerente, member -> atendente; only the platform admin keeps "admin".
UPDATE "member" SET "role" = 'gerente' WHERE "role" IN ('owner', 'admin');
UPDATE "member" SET "role" = 'atendente' WHERE "role" = 'member';
UPDATE "member" SET "role" = 'admin'
WHERE "userId" IN (SELECT "id" FROM "user" WHERE lower("email") = 'sturnusflow@gmail.com');
UPDATE "invitation" SET "role" = 'gerente' WHERE "role" IN ('owner', 'admin');
UPDATE "invitation" SET "role" = 'atendente' WHERE "role" = 'member' OR "role" IS NULL;
