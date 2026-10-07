-- CreateTable
CREATE TABLE "lead_comment" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "targetId" TEXT NOT NULL,
    "authorId" TEXT,
    "body" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "lead_comment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "lead_attachment" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "targetId" TEXT NOT NULL,
    "uploadedById" TEXT,
    "fileName" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "size" INTEGER NOT NULL,
    "storageKey" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "lead_attachment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "lead_comment_targetId_createdAt_idx" ON "lead_comment"("targetId", "createdAt");

-- CreateIndex
CREATE INDEX "lead_attachment_targetId_createdAt_idx" ON "lead_attachment"("targetId", "createdAt");

-- AddForeignKey
ALTER TABLE "lead_comment" ADD CONSTRAINT "lead_comment_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lead_comment" ADD CONSTRAINT "lead_comment_targetId_fkey" FOREIGN KEY ("targetId") REFERENCES "target"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lead_comment" ADD CONSTRAINT "lead_comment_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lead_attachment" ADD CONSTRAINT "lead_attachment_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lead_attachment" ADD CONSTRAINT "lead_attachment_targetId_fkey" FOREIGN KEY ("targetId") REFERENCES "target"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lead_attachment" ADD CONSTRAINT "lead_attachment_uploadedById_fkey" FOREIGN KEY ("uploadedById") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE CASCADE;

