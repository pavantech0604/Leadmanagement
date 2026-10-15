# Verification

Verified locally on 12 October 2026.

- `npm test`: 10 passing domain tests (phone normalization, names/raw data, language aliases/defaults, invalid rows, file duplicates, existing duplicates, email/name rules, admin/manager/employee/team isolation and seed counts).
- `node tests/api-smoke.mjs`: passing real HTTP flow against the development server. Tested sign-in, preview, confirmed import, persistence, assignment, follow-up/notes, audit events, duplicate source merge, rejection, duplicate manual creation blocked, employee unauthorized update/import blocked and manager unrelated branch import blocked. The QA lead is archived after the check; raw import and audit events remain.
- `npm run build`: successful Next.js production compilation and TypeScript validation.
- Prisma schema validation, client generation and initial SQL migration generation: successful. Migration was not applied to a live PostgreSQL instance.
- `npm audit`: zero known vulnerabilities after updating SheetJS from its official CDN and overriding patched Prisma tooling dependencies. Source: https://docs.sheetjs.com/docs/getting-started/installation/nodejs/
- Browser: profile sign-in, dashboard statistics/chart, branch cards and lead-list rendering observed. Mobile layout screenshot saved in `docs/preview.png`. Desktop viewport was checked for horizontal page overflow (none). Full browser automation coverage is not claimed.

Not verified: live PostgreSQL persistence, production identity provider, queue processing, large-file stress, attachment scanning/storage, cross-process writes, production hosting or a complete end-to-end browser suite. See README for implementation gaps.
