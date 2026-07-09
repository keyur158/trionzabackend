-- CreateIndex
CREATE INDEX "Product_metafields_idx" ON "Product" USING GIN ("metafields");
