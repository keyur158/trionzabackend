-- CreateIndex
CREATE INDEX "Product_availableForSale_idx" ON "Product"("availableForSale");

-- CreateIndex
CREATE INDEX "Product_productType_idx" ON "Product"("productType");

-- CreateIndex
CREATE INDEX "Product_createdAt_idx" ON "Product"("createdAt");

-- CreateIndex
CREATE INDEX "Product_minPrice_idx" ON "Product"("minPrice");

-- CreateIndex
CREATE INDEX "Product_availableForSale_productType_idx" ON "Product"("availableForSale", "productType");

-- CreateIndex
CREATE INDEX "Product_availableForSale_createdAt_idx" ON "Product"("availableForSale", "createdAt");

-- CreateIndex
CREATE INDEX "Product_availableForSale_minPrice_idx" ON "Product"("availableForSale", "minPrice");
