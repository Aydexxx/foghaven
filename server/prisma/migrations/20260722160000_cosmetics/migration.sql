-- CreateEnum
CREATE TYPE "CosmeticType" AS ENUM ('HAT', 'ACCESSORY', 'PET', 'OUTFIT', 'VICTORY_POSE', 'DEATH_EFFECT');

-- AlterTable
ALTER TABLE "users" ADD COLUMN "coins" INTEGER NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "cosmetics" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "type" "CosmeticType" NOT NULL,
    "name" TEXT NOT NULL,
    "priceCoins" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "cosmetics_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_cosmetics" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "cosmeticId" TEXT NOT NULL,
    "equipped" BOOLEAN NOT NULL DEFAULT false,
    "acquiredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "user_cosmetics_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "cosmetics_slug_key" ON "cosmetics"("slug");

-- CreateIndex
CREATE INDEX "user_cosmetics_userId_equipped_idx" ON "user_cosmetics"("userId", "equipped");

-- CreateIndex
CREATE UNIQUE INDEX "user_cosmetics_userId_cosmeticId_key" ON "user_cosmetics"("userId", "cosmeticId");

-- AddForeignKey
ALTER TABLE "user_cosmetics" ADD CONSTRAINT "user_cosmetics_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_cosmetics" ADD CONSTRAINT "user_cosmetics_cosmeticId_fkey" FOREIGN KEY ("cosmeticId") REFERENCES "cosmetics"("id") ON DELETE CASCADE ON UPDATE CASCADE;
