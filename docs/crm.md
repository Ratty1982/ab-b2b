# CRM — Sales workspace

Internal CRM for Automotive Brands sales staff. Designed for daily use alongside Sales Intelligence — not a Salesforce clone.

**Phase (live testing):** Overview, Leads, Opportunities, Activities, and Tasks are production-backed. Demo opportunity/pipeline fixtures have been removed from CRM routes.

## Purpose

Workflow:

1. Sales Intelligence identifies factual change / opportunity evidence  
2. Staff create a **Follow-up** (Phase 5) → CRM **Task**  
3. Salesperson contacts the customer  
4. Log **Activity** / notes  
5. Optionally create an **Opportunity**  
6. Progress the opportunity; create **Quote** / **Order** via existing flows  
7. Customer relationship history remains on the company timeline  

## Navigation

| Surface | Route |
|---------|--------|
| Overview (My Day) | `/crm/overview` |
| Leads | `/crm/leads` |
| Opportunities | `/crm/` |
| Activities | `/crm/activities` |
| Tasks | `/crm/tasks` |

Sales Intelligence remains a separate nav area.

## Overview / My Day

Server-scoped counts (never client-filtered full dumps):

- Tasks due today  
- Overdue tasks  
- Open opportunities  
- Active leads  

Sections: My Day task lists, active opportunities, recent activity, recent leads.

Managers with team/all sales scope can switch **My view / Team**.

## Leads

Prospective trade relationships before an established Company.

**Lifecycle (existing enum):** `NEW` → `CONTACTED` → `QUALIFIED` → `CONVERTED` or `DISQUALIFIED` (Lost).

**Conversion** is deliberate: link an existing Company (search by name / email / Autopart account) or create a new `PROSPECT` company. Optional “also create opportunity” — never automatic.

Trade Application onboarding is unchanged and does not compete with Lead conversion.

## Opportunities

Database-backed only. Empty DB ⇒ empty UI (no sample cards).

**Stages (existing enum preserved):**  
`NEW_LEAD` (Identified), `QUALIFIED`, `CONTACTED`, `MEETING`, `QUOTE_REQUIRED`, `QUOTE_SENT`, `NEGOTIATION`, `WON`, `LOST`.

Table + Kanban views. Stage moves are server-authorised. Won/Lost require confirmation; Lost requires a reason. **Does not** create Orders or Quotes.

**Opportunity Value** = salesperson estimate (nullable). Never labelled as revenue/forecast. Linked Quotes (optional `Quote.opportunityId`) show separately as quoted totals.

## Activities

Manual logging:

- Log call (outcome)  
- Log email (**logged**, not sent)  
- Log meeting  
- Note (also stored on `Note` when company-linked)  

Optional follow-up Task. Feed at `/crm/activities` with type/search filters.

## Tasks

Preserves Sales Intelligence Phase 5:

- `sourceModule` / `sourceReason` / `sourceSku` / `productId` / `sourceContext`  
- duplicate warning, snapshot semantics, deep links, audits  

Additive optional `taskType`: `CALL` | `EMAIL` | `MEETING` | `FOLLOW_UP` | `GENERAL` (SI follow-ups use `FOLLOW_UP`).

Filters: due today / overdue / upcoming / completed, source, search. Quick complete + reschedule.

## Customer CRM workspace

On `/sales/customers/:id` → **CRM** tab:

- Authoritative header (SalesRep from CompanyAssignment)  
- Quick actions (log activity, task, opportunity, quote, SI links)  
- Commercial snapshot (historic net sales, last purchase, open tasks/opps/quotes)  
- Chronological timeline  

No credit limit / available credit / 407P100.

## SalesRep ownership

Assignee/owner defaults use authoritative Company → CompanyAssignment → SalesRep → User. No mixed contact cards.

## RBAC / scope

| Permission | Use |
|------------|-----|
| `crm.view` | Read Overview / Leads / Opportunities / Activities |
| `crm.manage` | Broad CRM mutation |
| `crm.activities.create` | Log activities |
| `tasks.view` / `tasks.manage` | Tasks |

Sales reps with `crm.view` + sales account scope may create/update leads & opportunities **within scope**. Trade users denied. Company/lead/opportunity IDs outside scope rejected server-side.

CRM mutations **must not** change Company lifecycle status (`ACTIVE` stays `ACTIVE`).

## Audit

Examples: `crm.lead.created|updated|converted|lost`, `crm.opportunity.created|stage_changed|won|lost`, `crm.activity.created`, `crm.task.created`, plus existing `sales_followup.*`.

## Empty-state / no-demo rule

If there are no records, show a useful empty state. Never inject sample customers, fake pipeline values, or placeholder charts.

## Limitations

- No probability weighting / forecast revenue  
- No automated lead/opportunity creation from SI  
- No customer email send from CRM log actions  
- Quote create launches existing quote flow; pricing/stock rules unchanged  
- Ongoing Autopart invoice feed not in scope  

## Related

- `docs/sales-intelligence.md` — SI follow-ups bridge  
- `docs/sales-team.md` — SalesRep profile authority  
