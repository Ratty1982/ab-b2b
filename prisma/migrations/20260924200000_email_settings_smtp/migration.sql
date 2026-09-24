-- Admin Email Settings (SiteGround SMTP) + expanded transactional purposes.
-- SMTP passwords are AES-256-GCM encrypted server-side. No Coolify SMTP env required.

ALTER TYPE "TransactionalEmailPurpose" ADD VALUE 'TRADE_APPLICATION_RECEIVED';
ALTER TYPE "TransactionalEmailPurpose" ADD VALUE 'TRADE_APPLICATION_INTERNAL_NOTIFICATION';
ALTER TYPE "TransactionalEmailPurpose" ADD VALUE 'TRADE_APPLICATION_MORE_INFO';
ALTER TYPE "TransactionalEmailPurpose" ADD VALUE 'TRADE_APPLICATION_APPROVED';
ALTER TYPE "TransactionalEmailPurpose" ADD VALUE 'TRADE_APPLICATION_REJECTED';
ALTER TYPE "TransactionalEmailPurpose" ADD VALUE 'TRADE_ACCOUNT_ACTIVATED';
ALTER TYPE "TransactionalEmailPurpose" ADD VALUE 'EMAIL_TEST';

CREATE TYPE "SmtpSecurity" AS ENUM ('SSL_TLS', 'STARTTLS', 'NONE');

CREATE TABLE "EmailSettings" (
    "id" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "smtpHost" TEXT,
    "smtpPort" INTEGER NOT NULL DEFAULT 465,
    "smtpSecurity" "SmtpSecurity" NOT NULL DEFAULT 'SSL_TLS',
    "smtpUsername" TEXT,
    "smtpPasswordEncrypted" TEXT,
    "fromName" TEXT,
    "fromEmail" TEXT,
    "replyToName" TEXT,
    "replyToEmail" TEXT,
    "tradeApplicationRecipients" JSONB NOT NULL DEFAULT '[]',
    "orderNotificationRecipients" JSONB NOT NULL DEFAULT '[]',
    "lastConnectionTestAt" TIMESTAMP(3),
    "lastConnectionTestOk" BOOLEAN,
    "lastConnectionTestError" TEXT,
    "lastTestEmailAt" TIMESTAMP(3),
    "lastTestEmailOk" BOOLEAN,
    "lastTestEmailError" TEXT,
    "updatedByUserId" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EmailSettings_pkey" PRIMARY KEY ("id")
);
