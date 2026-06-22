-- CreateTable
CREATE TABLE "AppVersion" (
    "id" SERIAL NOT NULL,
    "platform" TEXT NOT NULL,
    "version" TEXT NOT NULL,
    "forced" BOOLEAN NOT NULL DEFAULT false,
    "message" TEXT NOT NULL DEFAULT '',
    "storeUrl" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AppVersion_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AppVersion_platform_idx" ON "AppVersion"("platform");

-- CreateIndex
CREATE UNIQUE INDEX "AppVersion_platform_version_key" ON "AppVersion"("platform", "version");