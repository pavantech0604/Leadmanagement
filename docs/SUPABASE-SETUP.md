# Supabase deployment status

Target project: `taxqsqczqtvlzcblmlig`.
Designated owner: `capitalgrow8651@gmail.com`.

The CLI is installed locally and linked to the target project. On 12 October 2026,
both migrations (`20261012090000` and `20261012090100`) were successfully pushed
after a dry run. Remote verification confirmed RLS enabled and forced on all nine
private tables, with no SELECT grants to `anon` or `authenticated`. No business
data has been imported.

## Prepared locally

- Private `capital_grow` schema, outside the default Supabase Data API schemas.
- RLS enabled and forced; browser roles receive no schema or table access.
- Restricted server database role, immutable transfer records, unique file and
  source-row reservations, transactional workspace history, and security events.
- Owner membership migration, without creating an Auth account.
- An initial PostgreSQL adapter in `lib/cloud-database.ts`.

The adapter is selected by `STORAGE_BACKEND=supabase`; the default development mode remains local. Vercel refuses local storage. See [Vercel setup](VERCEL-SETUP.md) for private initialization and required environment variables.
Production email/password sign-in now verifies Supabase identity and private active membership, supports enrolled TOTP verification, and uses signed server cookies. Real account and publishable-key configuration are still required. Independent backups and hosted end-to-end verification remain deployment responsibilities.

## Resume deployment

1. CLI authentication, project linking, and both initial migrations are complete.
   Keep tokens and database passwords out of chat.
2. Before subsequent deployments, verify the linked project is still the exact
   target and inspect migration history.
3. Review `npx supabase db push --dry-run` before pushing future migrations.
4. Finish verified Supabase authentication and MFA, membership-based permissions,
   secure session cookies, export authorization and auditing, and request limits.
   Disable profile-based local entry whenever cloud storage is active.
5. Configure a TLS-verified server connection using the restricted application
   role. Store credentials only in ignored environment configuration or the host's
   secret manager. Never expose a database password or service-role key to clients.
6. Import the real workspace once, excluding demo contacts. Sanitize the source
   workbook to language-pool sheets before importing: unrelated workbook tabs
   must not be uploaded. Preserve physical sheet row positions.
7. Test unauthorized access, role boundaries, concurrent transfers, retries,
   rollback, downloads, and restore before activating cloud mode.

Database version history shares the production database's failure domain. Configure
and test an independent encrypted backup/restore process as well. Access controls
reduce unauthorized disclosure but cannot prevent authorized users from copying
information they can legitimately view.
