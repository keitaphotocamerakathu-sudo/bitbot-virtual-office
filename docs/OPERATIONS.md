# Deploy, recover and verify

## Existing installation

Use the dedicated trading Supabase project. Before changing it, inspect current migrations, bot flags, open orders, provider logs and RLS advisors. Preserve the owner's real and paper pause flags. GitHub Pages serves the browser; `bitbot-v10` remains the stable Edge Function route for compatibility.

1. Run `npm ci`, `npm test`, `node research/verify-v13.mjs`, and `npm run test:ui` (Chromium: `npx playwright install chromium`). The research verifier checks the archived v13 source hashes; it does not validate the new hourly filter's profitability.
2. Back up the current main commit as a branch. Keep the existing encrypted key/Vault setup and scheduler token. Never export decrypted credentials.
3. Apply `supabase/bitbot_v14.sql` after the existing v10–v13 migrations. It adds company jobs, agent registry, paper configuration and an owner-close flag. It does not start either trading mode.
4. Deploy **all** files in `supabase/functions/bitbot-v10/`, entrypoint `index.ts`. The function verifies end-user JWTs itself and validates a private Vault token for `run`. Keep the existing gateway setting `verify_jwt=false`; it is required by the independently authenticated scheduler.
5. Extend the private scheduler with `supabase/bitbot_v14_scheduler.sql`. The existing one-minute pg_cron job calls it; do not create a second scheduler. Run an OBSERVE job to commission real public-data analysis without exchange writes.
6. Publish a candidate Git branch, pass CI, then promote main with an expected-head check. Pages deployment follows the tests. It recreates old login/setup/live aliases from the current index.
7. Verify `node tests/backend-smoke.mjs`, an actual DONE/DEGRADED company archive, account-scoped registry rows, no new exchange orders, and both pause flags unchanged. DEGRADED evidence must be investigated; never replace it with sample output.

For a completely new installation, use `.env.example` and the repository's earlier setup SQL in version order. Vault and auth setup depend on the target project and must be verified before starting. Do not copy this deployment's user UUID or credentials into another project.

## Runtime

Each minute the server scans all active THB pairs, rotates a shortlist and checks owned positions. Company evidence is archived once per five-minute slot. Workers share fetched quotes/history and cannot access signing keys. The new hourly veto uses closed data; missing history blocks a new buy. Public REST reads have bounded backoff. Exchange writes are never automatically retried after an ambiguous response. REST remains authoritative for the engine; the browser's public WebSocket ticker is display-only and reconnects with backoff, falling back to the REST view when unavailable. No always-on VPS WebSocket collector is deployed.

Company jobs have 90-second leases, a maximum of three claims, 16 workers per assessment, 32 registry updates per checkpoint and a 1 MB compressed archive limit. Per-account archives have a 200 MB budget; reaching it stops new archival jobs and requires retention/export review. Failed tasks are recorded. No automatic deletion of audit history occurs. Monitor this limit before unattended operation.

`STOP` preserves holdings and stops management, with the original pending-order cancellation/reconciliation policy. `PAUSE ENTRY` still manages exits. `CLOSE POSITIONS` requires the exact owner confirmation and queues sells under the existing size/daily/safety limits; it is not an instantaneous market sale. Once the owned quantity reaches zero it stops. Unknown exchange results require reconciliation and cannot be overwritten by a new close request.

After a crash, let the lease expire and reconcile pending orders before new work. If an order's exchange result is unknown, inspect Bitkub and resolve its exact order ID through the existing journal action. Never submit a replacement because an HTTP request timed out. A full stop cannot protect a held asset while stopped; the owner must manage it or explicitly resume.

## Backup and evidence

Git branches protect source versions. The app exports current paper state and up to 10,000 recent paper events; CSV/XLSX exports include scope and coverage. Real reports paginate their ledger up to 10,000 fills and flag truncation. Pre-ledger daily dates and incomplete rounds are not invented. Source backup and browser exports do not replace database backups. Managed database backup/PITR availability and restore testing remain unverified for the provider plan.

The new multi-timeframe filter has correctness tests and public-data commissioning, but no completed long-duration profitability study. No strategy currently has historical approval. The 14-day continuous paper interval and at least 20 closed rounds are evidence gates; passing does not guarantee profit or grant automatic LIVE approval. An interruption exceeding five minutes resets the continuous interval. No LLM provider has been configured, billed or evaluated.

Official API references: [Bitkub REST](https://github.com/bitkub/bitkub-official-api-docs/blob/master/rest-v3.md), [Bitkub public WebSocket](https://github.com/bitkub/bitkub-official-api-docs/blob/master/websocket-public.md), [Supabase scheduling](https://supabase.com/docs/guides/functions/schedule-functions).
