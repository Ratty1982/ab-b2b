-- The physical warehouse coded AUTOPART is the Studley location.
-- Keep the code so existing inventory and Autopart stock imports stay attached.
-- Do not insert a second warehouse.

UPDATE "Warehouse"
SET "name" = 'Studley',
    "updatedAt" = CURRENT_TIMESTAMP
WHERE "code" = 'AUTOPART'
  AND "name" IS DISTINCT FROM 'Studley';
