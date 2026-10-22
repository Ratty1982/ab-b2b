# Autopart customer history — retired

Historical 561L and SLRB imports, including 561L-ALL and SLRB-ALL, are no longer part of customer onboarding.

Active trade customers are linked from the existing 407EXP customer master when they become active. See `docs/trade-onboarding.md`.

Ongoing invoices and credits come from the 504 feed. Ongoing product lines come from TRM21QC. Sales Enquiry, portal purchases, and purchasing reports read those ongoing rows only. A customer with no ongoing sales sees an empty state. That empty state is not a complete historical purchase record.

Verifying an Autopart ID does not import sales, approve a trade application, or enable portal login. The approved backfill for existing unambiguous mappings is the separate account-verification change.

Imported historical rows stay in the database until the controlled cleanup in `docs/historical-sales-cleanup.md` is approved. That cleanup is not run on deployment. Documents already used by live 504 or TRM21QC processing are kept, including the ongoing 504 documents that still have monetary discrepancies.

Credit position (407P100) is not imported or shown. Autopart remains the accounting system.
