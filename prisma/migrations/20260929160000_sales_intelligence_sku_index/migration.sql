-- Product-first Sales Intelligence enquiry: filter AutopartSalesLine by SKU across companies.
CREATE INDEX "AutopartSalesLine_sku_companyId_idx" ON "AutopartSalesLine"("sku", "companyId");
