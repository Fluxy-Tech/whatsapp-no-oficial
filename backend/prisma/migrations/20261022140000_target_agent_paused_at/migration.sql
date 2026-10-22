-- When the agent was paused for the contact: the manual conversation since then
-- goes into the agent's history on the next turn after it is resumed.
ALTER TABLE "target" ADD COLUMN "agentPausedAt" TIMESTAMP(3);
