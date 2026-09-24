# Transactional email

Automotive Brands sends transactional email through a durable outbox
(`TransactionalEmail`) and a provider-independent transport.

## Admin configuration (SiteGround SMTP)

Configure outbound mail from:

**Admin → System → Settings → Email**

1. Enter SMTP Server details from SiteGround (host, port, encryption, username, password).
2. Enter Sender Details (From name/email, optional Reply-To).
3. Add Trade Application and New B2B Order notification recipients.
4. **Save settings** (password is write-only; leave blank to keep the existing password).
5. **Test SMTP connection** — tests the *saved* configuration only (network, TLS, auth). Does not send mail.
6. **Send test email** — diagnostic send through the same SMTP transport (may run even when delivery is disabled).
7. Enable **Transactional email** when ready for live sends.

### SiteGround setup (your mailbox)

Obtain the exact values from SiteGround for the Power Maxed mailbox:

- Outgoing server / SMTP host
- Port
- Encryption (SSL/TLS or STARTTLS)
- Email / username
- Password

Do **not** put these in Coolify as `SMTP_HOST`, `SMTP_PORT`, `SMTP_USERNAME`, or `SMTP_PASSWORD`.
The Admin UI stores them in the database. The SMTP password is encrypted with AES-256-GCM using the
application `AUTH_SECRET` (same pattern as Autopart IMAP credentials).

## Architecture

```text
Business workflow (order / trade application)
        ↓
TransactionalEmail outbox (PENDING / SENT / FAILED / DEFERRED)
        ↓
EmailTransport
        ↓
SmtpEmailTransport (nodemailer)  ← initial provider
```

Future providers (Resend, Postmark, SES) add a new transport adapter only.
Order templates, trade templates, history, and retry stay unchanged.

## Delivery toggle

When **Transactional email** is disabled:

- Business workflows continue (orders, approvals, activation).
- Outbox rows become `DEFERRED`.
- No SMTP send is attempted for business emails.
- Diagnostic **Send test email** may still run (clearly labelled as a TEST) so you can verify SMTP before enabling delivery.

## Purposes

| Purpose | Trigger |
| --- | --- |
| `TRADE_APPLICATION_RECEIVED` | Customer submits application |
| `TRADE_APPLICATION_INTERNAL_NOTIFICATION` | Same — to configured recipients |
| `TRADE_APPLICATION_MORE_INFO` | Staff requests more information |
| `TRADE_APPLICATION_APPROVED` | Staff approves (includes existing activation link) |
| `TRADE_APPLICATION_REJECTED` | Staff rejects |
| `TRADE_ACCOUNT_ACTIVATED` | Customer completes activation |
| `ORDER_RECEIVED` | B2B order placed (customer contact) |
| `ORDER_RECEIVED_INTERNAL` | B2B order placed (staff recipients) |
| `EMAIL_TEST` | Admin diagnostic test email |

## Failure behaviour

SMTP failure **never** rolls back:

- trade application create / approve / reject
- account activation
- order creation
- stock reservation
- basket conversion

Failed rows remain retryable from Admin → Settings → Email (or order detail).
Retry rebuilds content from the authoritative Order / Application snapshot and
**never** creates another order, reservation, approval, or company.

## Security

- SMTP password is never returned to the browser (`smtpPasswordConfigured: true` only).
- Encryption/decryption is server-only.
- Passwords are never logged or written to `AuditEvent` metadata.
- Access requires `settings.view` (read) / `settings.edit` (mutate, test, retry).
- Trade customers and sales users without settings permissions have no access.

## Encryption

`src/server/crypto/secret.ts` — AES-256-GCM, key = SHA-256(`AUTH_SECRET`),
format `v1:iv:tag:ciphertext`. Shared with Autopart IMAP password storage.
