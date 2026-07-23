-- AlterTable
ALTER TABLE "users" ADD COLUMN "ageConfirmed" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "users" ADD COLUMN "consentAcceptedAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "user_stats" (
    "userId" TEXT NOT NULL,
    "gamesPlayed" INTEGER NOT NULL DEFAULT 0,
    "gamesWon" INTEGER NOT NULL DEFAULT 0,
    "gamesSurvived" INTEGER NOT NULL DEFAULT 0,
    "tasksCompleted" INTEGER NOT NULL DEFAULT 0,
    "totalSurvivalTimeMs" INTEGER NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "user_stats_pkey" PRIMARY KEY ("userId")
);

-- CreateTable
CREATE TABLE "user_role_stats" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "gamesPlayed" INTEGER NOT NULL DEFAULT 0,
    "gamesWon" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "user_role_stats_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "user_role_stats_userId_idx" ON "user_role_stats"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "user_role_stats_userId_role_key" ON "user_role_stats"("userId", "role");

-- AddForeignKey
ALTER TABLE "user_stats" ADD CONSTRAINT "user_stats_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_role_stats" ADD CONSTRAINT "user_role_stats_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
