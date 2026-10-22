-- History window: previous messages sent to the model with the current one. 0 = no limit.
ALTER TABLE "agent" ADD COLUMN "historyMessages" INTEGER NOT NULL DEFAULT 4;
