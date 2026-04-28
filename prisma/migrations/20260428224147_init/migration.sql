-- CreateEnum
CREATE TYPE "Vertical" AS ENUM ('CAFE', 'SALON', 'JUICE', 'BAKERY', 'LAUNDRY', 'OTHER');

-- CreateEnum
CREATE TYPE "Plan" AS ENUM ('STARTER', 'GROWTH', 'PRO');

-- CreateEnum
CREATE TYPE "SubscriptionStatus" AS ENUM ('TRIALING', 'ACTIVE', 'PAST_DUE', 'CANCELED');

-- CreateEnum
CREATE TYPE "PassStatus" AS ENUM ('ACTIVE', 'REDEEMED', 'EXPIRED', 'DELETED');

-- CreateTable
CREATE TABLE "Merchant" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "logoUrl" TEXT,
    "brandColor" TEXT NOT NULL DEFAULT '#000000',
    "vertical" "Vertical" NOT NULL,
    "ownerEmail" TEXT NOT NULL,
    "ownerPhone" TEXT NOT NULL,
    "clerkUserId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Merchant_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Subscription" (
    "id" TEXT NOT NULL,
    "merchantId" TEXT NOT NULL,
    "plan" "Plan" NOT NULL,
    "status" "SubscriptionStatus" NOT NULL,
    "hyperpayRef" TEXT,
    "currentPeriodEnd" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Subscription_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StaffPin" (
    "id" TEXT NOT NULL,
    "merchantId" TEXT NOT NULL,
    "pinHash" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StaffPin_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LoyaltyProgram" (
    "id" TEXT NOT NULL,
    "merchantId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "stampsRequired" INTEGER NOT NULL DEFAULT 10,
    "rewardLabel" TEXT NOT NULL,
    "passKitProgramId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LoyaltyProgram_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Pass" (
    "id" TEXT NOT NULL,
    "programId" TEXT NOT NULL,
    "customerPhone" TEXT NOT NULL,
    "passKitPassId" TEXT NOT NULL,
    "applePassUrl" TEXT,
    "googleWalletUrl" TEXT,
    "stampsCount" INTEGER NOT NULL DEFAULT 0,
    "status" "PassStatus" NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Pass_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StampEvent" (
    "id" TEXT NOT NULL,
    "passId" TEXT NOT NULL,
    "staffPinId" TEXT NOT NULL,
    "source" TEXT NOT NULL DEFAULT 'scanner',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StampEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RewardRedemption" (
    "id" TEXT NOT NULL,
    "passId" TEXT NOT NULL,
    "staffPinId" TEXT NOT NULL,
    "redeemedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RewardRedemption_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Merchant_slug_key" ON "Merchant"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "Merchant_ownerEmail_key" ON "Merchant"("ownerEmail");

-- CreateIndex
CREATE UNIQUE INDEX "Merchant_clerkUserId_key" ON "Merchant"("clerkUserId");

-- CreateIndex
CREATE INDEX "Merchant_clerkUserId_idx" ON "Merchant"("clerkUserId");

-- CreateIndex
CREATE UNIQUE INDEX "Subscription_merchantId_key" ON "Subscription"("merchantId");

-- CreateIndex
CREATE INDEX "StaffPin_merchantId_idx" ON "StaffPin"("merchantId");

-- CreateIndex
CREATE UNIQUE INDEX "LoyaltyProgram_passKitProgramId_key" ON "LoyaltyProgram"("passKitProgramId");

-- CreateIndex
CREATE INDEX "LoyaltyProgram_merchantId_idx" ON "LoyaltyProgram"("merchantId");

-- CreateIndex
CREATE UNIQUE INDEX "Pass_passKitPassId_key" ON "Pass"("passKitPassId");

-- CreateIndex
CREATE INDEX "Pass_programId_customerPhone_idx" ON "Pass"("programId", "customerPhone");

-- CreateIndex
CREATE INDEX "Pass_status_idx" ON "Pass"("status");

-- CreateIndex
CREATE INDEX "StampEvent_passId_idx" ON "StampEvent"("passId");

-- CreateIndex
CREATE INDEX "StampEvent_createdAt_idx" ON "StampEvent"("createdAt");

-- CreateIndex
CREATE INDEX "RewardRedemption_passId_idx" ON "RewardRedemption"("passId");

-- CreateIndex
CREATE INDEX "RewardRedemption_redeemedAt_idx" ON "RewardRedemption"("redeemedAt");

-- AddForeignKey
ALTER TABLE "Subscription" ADD CONSTRAINT "Subscription_merchantId_fkey" FOREIGN KEY ("merchantId") REFERENCES "Merchant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StaffPin" ADD CONSTRAINT "StaffPin_merchantId_fkey" FOREIGN KEY ("merchantId") REFERENCES "Merchant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LoyaltyProgram" ADD CONSTRAINT "LoyaltyProgram_merchantId_fkey" FOREIGN KEY ("merchantId") REFERENCES "Merchant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Pass" ADD CONSTRAINT "Pass_programId_fkey" FOREIGN KEY ("programId") REFERENCES "LoyaltyProgram"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StampEvent" ADD CONSTRAINT "StampEvent_passId_fkey" FOREIGN KEY ("passId") REFERENCES "Pass"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RewardRedemption" ADD CONSTRAINT "RewardRedemption_passId_fkey" FOREIGN KEY ("passId") REFERENCES "Pass"("id") ON DELETE CASCADE ON UPDATE CASCADE;
