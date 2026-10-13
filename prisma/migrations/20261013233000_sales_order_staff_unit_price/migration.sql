-- Staff sales-order drafts may store an order-only unit price.
-- Customer price lists, negotiated prices, and product base prices are unchanged.
ALTER TABLE "SalesOrderDraftLine" ADD COLUMN "unitPriceOverride" DECIMAL(12,2);
