-- Customer confirmation for a successfully committed sales-order amendment.
-- Separate from ORDER_RECEIVED so each amendment has its own immutable snapshot.

ALTER TYPE "TransactionalEmailPurpose" ADD VALUE 'ORDER_UPDATED';
