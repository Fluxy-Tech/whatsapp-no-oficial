-- AlterTable
ALTER TABLE "agent" ADD COLUMN     "resetKeywords" TEXT[] DEFAULT ARRAY[]::TEXT[];

