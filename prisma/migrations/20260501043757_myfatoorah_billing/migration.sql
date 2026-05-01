/*
  Warnings:

  - You are about to drop the column `hyperpayRef` on the `Subscription` table. All the data in the column will be lost.

*/
-- CreateEnum
CREATE TYPE "PaymentProvider" AS ENUM ('MYFATOORAH');

-- CreateEnum
CREATE TYPE "ChargeStatus" AS ENUM ('PENDING', 'SUCCEEDED', 'FAILED', 'REFUNDED');

-- AlterTable
ALTER TABLE "Subscription" DROP COLUMN "hyperpayRef",
ADD COLUMN     "provider" "PaymentProvider" NOT NULL DEFAULT 'MYFATOORAH',
ADD COLUMN     "providerRef" TEXT,
ADD COLUMN     "trialEndsAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "PaymentMethod" (
    "id" TEXT NOT NULL,
    "merchantId" TEXT NOT NULL,
    "provider" "PaymentProvider" NOT NULL DEFAULT 'MYFATOORAH',
    "recurringId" TEXT NOT NULL,
    "last4" TEXT NOT NULL,
    "brand" TEXT NOT NULL,
    "expMonth" INTEGER NOT NULL,
    "expYear" INTEGER NOT NULL,
    "holderName" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PaymentMethod_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Charge" (
    "id" TEXT NOT NULL,
    "subscriptionId" TEXT NOT NULL,
    "amountSar" INTEGER NOT NULL,
    "status" "ChargeStatus" NOT NULL,
    "provider" "PaymentProvider" NOT NULL DEFAULT 'MYFATOORAH',
    "providerInvoiceId" TEXT,
    "providerPaymentId" TEXT,
    "failureReason" TEXT,
    "attemptedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "succeededAt" TIMESTAMP(3),

    CONSTRAINT "Charge_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "PaymentMethod_merchantId_key" ON "PaymentMethod"("merchantId");

-- CreateIndex
CREATE UNIQUE INDEX "PaymentMethod_recurringId_key" ON "PaymentMethod"("recurringId");

-- CreateIndex
CREATE UNIQUE INDEX "Charge_providerInvoiceId_key" ON "Charge"("providerInvoiceId");

-- CreateIndex
CREATE INDEX "Charge_subscriptionId_idx" ON "Charge"("subscriptionId");

-- CreateIndex
CREATE INDEX "Charge_status_idx" ON "Charge"("status");

-- AddForeignKey
ALTER TABLE "PaymentMethod" ADD CONSTRAINT "PaymentMethod_merchantId_fkey" FOREIGN KEY ("merchantId") REFERENCES "Merchant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Charge" ADD CONSTRAINT "Charge_subscriptionId_fkey" FOREIGN KEY ("subscriptionId") REFERENCES "Subscription"("id") ON DELETE CASCADE ON UPDATE CASCADE;
