-- AlterTable
ALTER TABLE "agent" ADD COLUMN     "tokenJev" TEXT;

-- AlterTable
ALTER TABLE "metadado" ADD COLUMN     "kind" TEXT NOT NULL DEFAULT 'text',
ADD COLUMN     "imageRules" JSONB NOT NULL DEFAULT '[]';
