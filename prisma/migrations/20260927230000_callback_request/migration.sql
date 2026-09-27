-- Callback enquiry: Activity type + transactional email purpose.

ALTER TYPE "ActivityType" ADD VALUE 'CALLBACK_REQUEST';
ALTER TYPE "TransactionalEmailPurpose" ADD VALUE 'CALLBACK_REQUEST_INTERNAL';
