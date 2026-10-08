-- AlterTable
ALTER TABLE "agent" ADD COLUMN     "nameQueue" TEXT;

-- Existing agents keep the queue they already used: derived from the name
-- (no accents, lowercase, anything else becomes "-"), same rule as agentQueueKey.
UPDATE "agent"
SET "nameQueue" = trim(both '-' from regexp_replace(
  lower(translate("name",
    'áàâãäéèêëíìîïóòôõöúùûüçñÁÀÂÃÄÉÈÊËÍÌÎÏÓÒÔÕÖÚÙÛÜÇÑ',
    'aaaaaeeeeiiiiooooouuuucnAAAAAEEEEIIIIOOOOOUUUUCN')),
  '[^a-z0-9]+', '-', 'g'));

UPDATE "agent" SET "nameQueue" = 'agente' WHERE "nameQueue" = '';

ALTER TABLE "agent" ALTER COLUMN "nameQueue" SET NOT NULL;
