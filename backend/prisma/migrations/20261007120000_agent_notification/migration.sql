-- AlterTable
ALTER TABLE "agent" ADD COLUMN     "numberPhoneNotification" TEXT,
ADD COLUMN     "descriptionNotification" TEXT NOT NULL DEFAULT 'Envie um relatório curto da conversa com o contato e liste todos os metadados coletados.';
