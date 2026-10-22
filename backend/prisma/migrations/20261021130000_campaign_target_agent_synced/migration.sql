-- Campaign messages go into the AI agent's history of the contact.
ALTER TABLE "campaign_target" ADD COLUMN "agentSyncedAt" TIMESTAMP(3);
