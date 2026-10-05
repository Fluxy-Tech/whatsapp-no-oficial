-- CreateTable
CREATE TABLE "target" (
    "id" TEXT NOT NULL,
    "whatsappSessionId" TEXT NOT NULL,
    "targetId" TEXT NOT NULL,
    "name" TEXT,
    "pushname" TEXT,
    "isGroup" BOOLEAN NOT NULL DEFAULT false,
    "firstMessageAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "target_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "target_whatsappSessionId_targetId_key" ON "target"("whatsappSessionId", "targetId");

-- AddForeignKey
ALTER TABLE "target" ADD CONSTRAINT "target_whatsappSessionId_fkey" FOREIGN KEY ("whatsappSessionId") REFERENCES "whatsapp_session"("id") ON DELETE CASCADE ON UPDATE CASCADE;
