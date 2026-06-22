-- AlterTable: allow anonymous (guest) device tokens
ALTER TABLE "DeviceToken" ALTER COLUMN "customerEmail" DROP NOT NULL;