-- Extra CSV columns of a campaign contact, saved into the contact's extras (metadata).
ALTER TABLE "campaign_target" ADD COLUMN "extras" JSONB NOT NULL DEFAULT '{}';
