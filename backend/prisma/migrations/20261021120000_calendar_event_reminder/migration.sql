-- Reminder sent to the lead on WhatsApp some minutes before the event.
ALTER TABLE "calendar_event" ADD COLUMN     "reminderMessage" TEXT,
ADD COLUMN     "reminderMinutesBefore" INTEGER,
ADD COLUMN     "reminderSentAt" TIMESTAMP(3);
