-- RGBS: per-agent split + wait by message size, replacing splitMessages and
-- the organization's fixed delay between messages.
ALTER TABLE "agent" ADD COLUMN     "rgbsEnabled" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "timeSmall" INTEGER NOT NULL DEFAULT 5,
ADD COLUMN     "timeMedium" INTEGER NOT NULL DEFAULT 10,
ADD COLUMN     "timeLarge" INTEGER NOT NULL DEFAULT 15;

UPDATE "agent" SET "rgbsEnabled" = "splitMessages";

ALTER TABLE "agent" DROP COLUMN "splitMessages";

ALTER TABLE "organization" DROP COLUMN "agentMessageDelaySeconds";
