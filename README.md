# Capital Grow

The active interface is now **Capital Grow Daily Operations**, designed for one or two operators. It imports the user's UPDATE and MMS LEAD REPORT source registers, counts actual physical lead rows per language, and tracks floor deliveries. See [Daily Operations](docs/DAILY-OPERATIONS.md) for source mappings, counting rules and refresh limits. The CRM demo menu is removed; uploads remain available and do not mix sample contacts into the daily register. Smart floor transfers now calculate row ranges and increment filenames, with server confirmation, immutable exports and retry protection. See [Smart transfers](docs/SMART-TRANSFERS.md) for architecture, algorithms, permissions, changed files, testing and deployment limits.

A responsive multi-company, multi-branch lead workspace built with Next.js App Router, TypeScript, Recharts, Zod, PapaParse, SheetJS and libphonenumber-js.

## Run locally

Requires Node 20.19+ and npm. Run `npm install`, then `npm run dev`. Open http://localhost:3000 and open the owner or designated operator desk. Data is seeded with 500 fictional leads, three branches under two companies, three vendors, seven language categories, and ten users. Data persists in `data/workspace.json` across restarts. Back up that directory before making changes.

`npm test` runs domain tests. With the development server running, `npm run test:api` runs real HTTP workflow checks and archives its QA lead. `npm run build` checks TypeScript and creates the production bundle. Development profile selection is deliberately disabled in production. Verification evidence is in `docs/VERIFICATION.md`.

## Implemented local workflows

- Overview with shared-filter counts, 14-day received-lead chart, language breakdown and branch cards.
- Search, branch/language/status/vendor/date filters, sortable customer column, pagination and selection.
- Manual lead creation, branch-consistent assignment, bulk status updates, follow-up scheduling, notes and immutable-by-API timeline.
- CSV/XLS/XLSX import, drag/drop, mapping, preview, phone and email validation, language aliases, same-file and existing-record duplicates, error report download, confirmation and import history.
- Duplicate comparison, reject and merge-source review; merge preserves existing history and notes.
- Daily company/branch register, vendor performance, current pipeline, CSV/Excel exports, printable reports.
- Admin can create branches, vendors and languages. Team view displays role access and performance. Audit page records mutations with old/new snapshots.
- Light/dark themes, responsive layout, loading/error/empty states, toasts and lead detail drawer.

## Permission matrix

| Action | Admin | Manager | Team Leader | Employee |
|---|---|---|---|---|
| See leads | All | Assigned branches | Own team and branch | Own assigned leads in branch |
| Import/create/review/export | Yes | Assigned branches | No | No |
| Assign | Yes | Own branches | Own team | No |
| Update status/notes/follow-up | Yes | Own branches | Own team | Own leads |
| Archive | Yes | Own branches | No | No |
| Create settings / see audit | Yes | No | No | No |

The API enforces access on reads and mutations. Exports derive from those authorized reads. UI controls are not the security boundary.

## Import and duplicate rules

First row must contain unique column headers. The first Excel sheet is parsed. Name and phone mapping is required; all raw columns are preserved as custom data. Branch and vendor are chosen for the whole batch (file branch/vendor columns are not yet mapped). Files are limited to 10 MB and 10,000 rows. Phone normalization defaults to India, while explicit international dialing prefixes are supported.

An exact normalized phone and matching name is a duplicate. A matching phone with a different name or an existing email match is held as potential duplicate. A name alone does not block insertion. Raw imported rows are retained, and preview is recomputed at commit time. Global duplicate checking does not expose matched records outside the current user's scope. Within-file matches cannot be merged through the review page; reject the redundant row. Accept-as-new is intentionally unavailable because the normalized-phone key must remain unique.

Error reports contain row number, original fields, result and reason. Sample file: `public/vendor-template.csv`. Unknown languages and malformed phones remain review rows. Current rejected/merged review rows use an Error state with the disposition retained in the reason; import batch totals describe the original result.

## API

All endpoints return JSON. `GET /api/workspace` returns authorized branches, users, leads, imports and settings. Unauthenticated development requests return demo-profile choices. The signed, HttpOnly, SameSite=Strict session cookie expires after eight hours.

`POST /api/workspace` accepts these action envelopes:

| action | Fields | Result |
|---|---|---|
| login | userId | Development session only |
| logout | No additional fields | Session cookie removed |
| create | lead: {name, phone, email, branchId, language, vendor} | New validated lead |
| preview | rows, mapping, branchId, vendor, language | Validated row results |
| import | preview fields plus file | Committed batch and leads |
| update | ids, patch: {status?, assignedTo?, followUp?, note?} | Bulk atomic update |
| review | batchId, row, decision: merge/reject | Source merge or rejection |
| setting | kind: branch/language/vendor, value, company?, city? | Admin-created setting |

Mapping keys are name, phone, email and language; values are source column headers. Validation errors return 400, unauthenticated writes 401, denied actions 403, and process-local rate limiting 429. Cross-origin mutations are rejected. Maximum 90 writes/minute per apparent IP; use a trusted reverse proxy before relying on forwarded headers.

## Data and deployment

The runnable application currently uses a serialized JSON file adapter, suitable for a single-process local demonstration. `prisma/schema.prisma` defines the proposed PostgreSQL model with companies, branches, roles/permissions, teams, users, languages/vendors, leads, source data, import batches/rows, duplicates, assignments, history, notes, follow-ups, attachments, settings and audits. Foreign keys and duplicate/filter indexes are included. `prisma/migrations/0001_initial/migration.sql` is the generated initial migration. No database is required to run the local demo; the schema is not wired into the application adapter yet.

To prepare PostgreSQL, copy `.env.example` to `.env`, set DATABASE_URL, run `npm run db:generate`, and apply `npx prisma migrate deploy` against a disposable database first. Connecting the production repository requires replacing `lib/store.ts` and the store-oriented services with transactional Prisma queries. Do not deploy the JSON adapter with multiple processes or ephemeral disk.

Before production: integrate Auth.js or your identity provider with credential verification, account provisioning and logout; use SESSION_SECRET from a secret manager; connect PostgreSQL; create queue workers for large imports; add trusted-proxy distributed rate limiting, encrypted backups, retention rules, secure object storage and malware scanning; validate production dependency advisories; add database and browser integration tests. Build with `npm run build`, then start with `npm start` only after these integrations. Demo profile login remains blocked in production.

## Current limits and assumptions

This is a working local application, not yet production-ready. Redis/BullMQ, live background progress, production authentication, a connected PostgreSQL repository, attachment storage, user/role editing, branch editing/deactivation, language renaming/deactivation, fuzzy name scoring and configurable permission grants are not implemented. Imports execute synchronously within the 10,000-row cap. Follow-ups currently store one next appointment plus notes and update history, not independent structured call-outcome records. Charts show lead receipt cohort conversions, not timestamped conversion events. Daily reports use India Standard Time; date filters use rolling periods. Phone masking is not configured. Audit stores full snapshots locally and needs restricted retention/encryption in deployment. Uploaded workbooks are parsed in the browser without macros being executed, but malware scanning is absent. Test coverage does not certify large-file performance or production infrastructure.

Please confirm actual companies/branches, default country, employee teams, vendor names, whether duplicates are global across companies (currently yes), lead retention, phone masking policy, and the production hosting/identity provider. These are configurable business inputs, not blockers for exploring the demo.
