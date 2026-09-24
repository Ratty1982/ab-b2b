-- Additional transactional purposes + motorsport enquiry recipients.

ALTER TYPE "TransactionalEmailPurpose" ADD VALUE 'COMPANY_USER_INVITED';
ALTER TYPE "TransactionalEmailPurpose" ADD VALUE 'PASSWORD_RESET';
ALTER TYPE "TransactionalEmailPurpose" ADD VALUE 'MOTORSPORT_PARTNERSHIP_INTERNAL';

ALTER TABLE "EmailSettings" ADD COLUMN "motorsportEnquiryRecipients" JSONB NOT NULL DEFAULT '[]';
