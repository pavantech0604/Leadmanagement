# Vercel setup

Set these server-only environment variables for Production (and Preview only if you intend to connect that deployment to this workspace):

| Name | Value |
| --- | --- |
| STORAGE_BACKEND | supabase |
| SUPABASE_DATABASE_URL | PostgreSQL session-pooler connection string for the restricted capital_grow_app role |
| SESSION_SECRET | A stable cryptographically random secret, at least 32 characters |

Find the PostgreSQL session-pooler endpoint in Supabase project **Connect**. The HTTPS project URL and an anon key cannot substitute for the database connection string. Use port 5432 session pooling for the current transaction adapter. The application validates TLS; do not disable certificate verification. If your provider requires a CA, configure SUPABASE_DB_CA_PATH to a deployed CA file.

Do not prefix these variables with NEXT_PUBLIC_. Add them to Vercel project Settings → Environment Variables, then redeploy.

## Import the existing workspace once

The database migrations must already exist. Provision the restricted application role with a private password using Supabase administration. Do not put the password into SQL files in Git.

On your local computer, put the three variables above in ignored .env.local, then run:

```
npm run cloud:initialize
```

The command reads private data/workspace.json and data/source/capital-grow.xlsx. It removes seeded contacts and extra demo users, keeps source row positions, and imports only AP, TN, KA, HI, KL and MMS LEAD REPORT. Other tabs are excluded. It refuses to overwrite an existing workspace, and the workspace/source/version are committed together.

Vercel cannot read private files on your PC. Never commit those files to Git or use /tmp as permanent lead storage. Cloud saves use database transactions and workspace versions; configure independent database backups as well.

## Production email/password authentication

Add server-only `SUPABASE_URL=https://taxqsqczqtvlzcblmlig.supabase.co` and `SUPABASE_PUBLISHABLE_KEY` (from Supabase project Settings → API Keys). A legacy anon key is also accepted using SUPABASE_ANON_KEY. Do not use the service-role key or database password as the Auth key. Redeploy after setting these values.

In Supabase Authentication → Users, the owner must have a confirmed email/password Auth account for capitalgrow8651@gmail.com. Create that account privately through Supabase administration if it does not exist. The Supabase dashboard password and PostgreSQL database password are separate from the application user's Auth password. Do not put user passwords into Vercel variables or source code.

The existing private memberships migration authorizes only the designated owner. A verified Auth login is insufficient without an active matching membership and existing app user. First sign-in atomically binds the Auth UUID; further accounts cannot claim an already bound identity. Operators require explicit administrator provisioning in the private memberships table. There is no public signup UI.

Sessions use a signed HttpOnly cookie, Secure in production, SameSite=Strict, one-hour expiry, issuer/audience verification and a live active-membership check on every authenticated request. Logging out clears the cookie. Membership deactivation revokes workspace access. Supabase tokens are kept server-side only during login; no tokens or credentials are stored in browser localStorage. Authenticator MFA is requested for enrolled TOTP accounts. Unsupported MFA methods fail closed.

Local profile sign-in is rejected whenever cloud storage is active, including development. Login attempts are limited per client through database rate-limit counters. Existing cookies from the local profile implementation are invalidated by the new session format.

Google Apps Script connection settings are currently local files. Hosted Google write-back also requires a durable private connection configuration and a scheduled retry runner; copying local connection files into Git is not supported.

## Install warnings and build cache

The repository uses npm ci and its committed lockfile for reproducible Vercel installs. Version-specific dependency script approvals live in package.json. The build wrapper translates the legacy npm_config_cache_dir / npm_config_cache-dir alias into npm_config_cache before npm starts. It preserves the cache directory and does not hide warnings or disable security auditing.

Next.js build caching is managed by Vercel; do not delete it on every build. After changing install settings, redeploy once with **Use existing Build Cache** unchecked if an earlier dependency cache is stale. Subsequent deployments can use the cache normally. Project dashboard overrides for install/build commands should be cleared so vercel.json applies.

## If workspace returns 503 after configuration

The updated error identifies invalid URL schemes, unchanged password placeholders, database authentication/permission errors, unreachable hosts, missing migrations, uninitialized workspace and TLS failures. For network failures, use the Session pooler URI rather than an IPv6-only direct database host. For certificate-chain failures, obtain the trusted database CA from your Supabase project and put its PEM content in server-only SUPABASE_DB_CA_CERT (actual newlines or escaped \n are supported). Never disable certificate verification. Redeploy after editing environment variables.

If the error remains generic, inspect the failed /api/workspace request in Vercel runtime logs. The public error response intentionally does not expose database credentials. Production sign-in and private data initialization remain separate requirements.
