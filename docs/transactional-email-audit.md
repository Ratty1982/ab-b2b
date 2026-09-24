# Transactional email audit

Definitive inventory of Automotive Brands email-related workflows
(as of Phase 6B + Admin SMTP + wiring pass).

All production transactional mail uses:

`TransactionalEmail` outbox → `EmailTransport` → `SmtpEmailTransport` (Admin → Settings → Email).

| WORKFLOW | EMAIL PURPOSE | RECIPIENT | TRIGGER | WIRED? | NOTES |
| --- | --- | --- | --- | --- | --- |
| Trade application submitted | `TRADE_APPLICATION_RECEIVED` | Customer (primary contact) | Successful `/register` submit | YES | Branded shell |
| Trade application submitted | `TRADE_APPLICATION_INTERNAL_NOTIFICATION` | Configured trade-application recipients | Same | YES | Skipped if no recipients |
| More information required | `TRADE_APPLICATION_MORE_INFO` | Customer | Staff MORE_INFO_REQUIRED | YES | Customer message only |
| Application approved | `TRADE_APPLICATION_APPROVED` | Customer | Staff approve | YES | Existing `/activate?token=` link |
| Application rejected | `TRADE_APPLICATION_REJECTED` | Customer | Staff reject | YES | Customer-facing text only |
| Account activated | `TRADE_ACCOUNT_ACTIVATED` | Customer | `/activate` success | YES | Welcome / portal CTA |
| Company portal invite | `COMPANY_USER_INVITED` | Invitee | Admin Invite user | YES | Token returned only if email deferred |
| Forgot password | `PASSWORD_RESET` | User | Public forgot-password | YES | Better Auth URL; outbox + branded shell; no enumeration |
| Admin send password reset | `PASSWORD_RESET` | User | Admin Users → Send password reset email | YES | Same Better Auth flow |
| Admin force-set password | — | — | Admin emergency set password | N/A | Shows password once; not emailed (intentional) |
| Order placed | `ORDER_RECEIVED` | Order contact snapshot | After order commit | YES | Historical snapshots only |
| Order placed | `ORDER_RECEIVED_INTERNAL` | Order notification recipients | After order commit | YES | Env fallback transitional |
| Motorsport partnership enquiry | `MOTORSPORT_PARTNERSHIP_INTERNAL` | Motorsport enquiry recipients | Form submit → Lead | YES | Skipped if no recipients |
| SMTP diagnostic | `EMAIL_TEST` | Admin-chosen | Settings → Send test email | YES | May bypass delivery toggle |
| Contact page callback | — | — | Form submit | FUTURE | Stub UI (“does not send email yet”) |
| Portal support message | — | — | Form submit | FUTURE | Mailto only |
| Quote send / quote viewed | — | — | — | FUTURE | Mock UI; Prisma Quote unused by services |
| Invoice email | — | — | — | FUTURE | Mock UI; Prisma Invoice unused |
| CRM digests / marketing | — | — | — | FUTURE | Out of scope (transactional only) |
| Email verification on signup | — | — | — | FUTURE | `requireEmailVerification: false`; trade uses activation |
| Decorative Settings notification checkboxes | — | — | — | LEGACY/MOCK | Real alerts are Email Settings recipients |
| Autopart stock IMAP | — | — | Inbound poll | INTERNAL | Not transactional outbound |

## Classification legend

- **YES** — SHOULD SEND NOW and wired
- **FUTURE** — real product later; do not invent in this pass
- **LEGACY/MOCK** — prototype UI only
- **INTERNAL** — not customer/staff transactional mail
- **N/A** — intentionally not email

## Manual production checklist

Use a safe test mailbox (not a real customer):

1. Submit trade application → customer ack + internal alert  
2. Request more info → customer email  
3. Approve → activation email (link works)  
4. Activate → welcome email  
5. Forgot password → reset email → new password → login  
6. Admin → Send password reset email  
7. Place B2B order → customer + internal order emails  
8. Motorsport form (with recipients configured) → internal alert  
9. Settings → Send test email (branded shell + From Name)

Confirm Outlook From display name is **Automotive Brands** (or set M365 mailbox display name if directory rewrite still shows `b2b` for internal recipients).
