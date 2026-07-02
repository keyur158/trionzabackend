-- AlterTable
ALTER TABLE "Payment" ADD COLUMN "paypalOrderId" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "Payment_paypalOrderId_key" ON "Payment"("paypalOrderId");