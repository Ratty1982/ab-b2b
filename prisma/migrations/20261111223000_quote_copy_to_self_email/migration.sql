-- Salesperson quote-copy email. Additive enum value only.
ALTER TYPE "TransactionalEmailPurpose" ADD VALUE IF NOT EXISTS 'QUOTE_COPY_TO_SELF';
