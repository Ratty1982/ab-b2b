# Version Updates / What's New

Internal release notes for Automotive Brands B2B staff.

## Purpose

Super Admin publishes short, business-friendly updates about platform changes.
Targeted internal staff see a polished **What's New** modal when they next use B2B, and can re-open history later.

This is **not** an automatic feed of Git commits or technical migrations.

## Super Admin management

Route: `/admin/version-updates`  
Nav: **System → Version Updates**

Permission: `version_updates.manage` (Super Admin only via `ALL_PERMISSIONS`).

Server-side checks also require `systemRoles` to include `SUPER_ADMIN`.

Actions: create/edit draft, preview, publish, archive.

**Quick add:** paste a plain-text block on `/admin/version-updates`. First non-empty line is the title; everything after is the body. `•`, `-`, and `*` bullets are normalised to `•`. Version is auto-filled as `YYYY.MM.DD` (the existing model still requires a version). Audience defaults to all internal staff. Create as draft or publish now — both still go through the existing `VersionUpdate` draft/publish path.

The detailed editor remains at `/admin/version-updates/new` (**Advanced options**) for version, audience, sections, and summary.

## Content model

Structured JSON (not free HTML):

```json
{
  "intro": "We've made several improvements…",
  "sections": [
    { "heading": "Product Safety Data Sheets", "body": "…" }
  ]
}
```

Plain text only — tags are stripped. Headings + paragraphs (+ newlines) are enough for readable notes.

## Audience

- **All internal staff**, or
- **Selected system roles** from RBAC (`SUPER_ADMIN`, `MANAGEMENT`, `SALES_MANAGER`, `SALES_REPRESENTATIVE`, `CUSTOMER_SERVICE`, `ACCOUNTS`, `MARKETING`)

Trade/customer users never receive internal release updates.

## Publishing

Publishing sets `PUBLISHED` + `publishedAt` and writes `version_update.published`.

It does **not** send email, create CRM activities, or change catalogue/business data.

## Login modal

When an internal user opens a back-office shell (`/admin`, `/sales`, `/crm`):

1. Server finds newest `PUBLISHED` update targeted to their roles
2. That they have not acknowledged
3. Shows one modal (not a stack)

If more unread exist: “N earlier updates also available in What's New.”

Draft / archived never appear.

## Acknowledgement

**Got it** writes `VersionUpdateRead.acknowledgedAt` server-side (unique per user/update).

Follows the user across browsers/devices. Not localStorage.

Editing a published update does **not** reset acknowledgements.

## What's New history

Sidebar account area: **What's New** (+ subtle unread count).

Lists published updates targeted to the user, newest first.

## Archive

Archived updates stop triggering the modal and unread count. Super Admin can still see them in management.

## Security

| Actor | Can manage | Can read published / acknowledge |
| --- | --- | --- |
| Super Admin | Yes | Yes (if audience matches) |
| Other internal | No | Yes (if audience matches) |
| Trade | No | No |

## Audit

- `version_update.created`
- `version_update.updated`
- `version_update.published`
- `version_update.archived`

Metadata includes version, title, status — not full content copies.
