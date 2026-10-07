-- AlterTable
ALTER TABLE "agent" ADD COLUMN     "leadAssigneeId" TEXT;

-- AddForeignKey
ALTER TABLE "agent" ADD CONSTRAINT "agent_leadAssigneeId_fkey" FOREIGN KEY ("leadAssigneeId") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE CASCADE;
