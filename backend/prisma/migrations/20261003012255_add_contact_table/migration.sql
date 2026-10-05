-- CreateTable
CREATE TABLE "contact" (
    "id" TEXT NOT NULL,
    "whatsappSessionId" TEXT NOT NULL,
    "contactId" TEXT NOT NULL,
    "name" TEXT,
    "pushname" TEXT,
    "formattedName" TEXT,
    "isMyContact" BOOLEAN NOT NULL DEFAULT false,
    "isBusiness" BOOLEAN NOT NULL DEFAULT false,
    "isGroup" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "contact_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "contact_whatsappSessionId_contactId_key" ON "contact"("whatsappSessionId", "contactId");

-- AddForeignKey
ALTER TABLE "contact" ADD CONSTRAINT "contact_whatsappSessionId_fkey" FOREIGN KEY ("whatsappSessionId") REFERENCES "whatsapp_session"("id") ON DELETE CASCADE ON UPDATE CASCADE;
