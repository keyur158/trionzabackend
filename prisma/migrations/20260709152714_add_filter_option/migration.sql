-- CreateTable
CREATE TABLE "FilterOption" (
    "id" SERIAL NOT NULL,
    "type" TEXT NOT NULL,
    "handle" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "position" INTEGER NOT NULL,

    CONSTRAINT "FilterOption_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "FilterOption_type_idx" ON "FilterOption"("type");

-- CreateIndex
CREATE UNIQUE INDEX "FilterOption_type_handle_key" ON "FilterOption"("type", "handle");
