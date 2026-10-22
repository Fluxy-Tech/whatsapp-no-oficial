-- Special "Nome" metadado: the agent asks for the contact's name when it has none.
ALTER TABLE "agent" ADD COLUMN "requireContactName" BOOLEAN NOT NULL DEFAULT false;
