-- AlterTable
ALTER TABLE "organization" ADD COLUMN     "messageWaitSeconds" INTEGER NOT NULL DEFAULT 20;

-- AlterTable
ALTER TABLE "agent" ADD COLUMN     "splitMessages" BOOLEAN NOT NULL DEFAULT false;
