# Delivery evidence — 17 November 2026

| Phase | Implemented and verified | Remaining evidence or external setup |
| --- | --- | --- |
| 1 Audit | Existing v13 source/state inspected; real and paper pauses preserved | None for this upgrade |
| 2 Core | Existing wallet/HMAC/reserve/reconcile engine retained; new company preflight, closed hourly veto and public-read backoff | New policy has no completed profitability validation |
| 3 Departments/tools | Ten quantitative departments, role allowlists, dynamic bounded worker allocation, actual task/handoff records | No language model configured; these are synchronous quantitative workers |
| 4 Cloud | Existing minute cron extended for durable observational jobs, recoverable leases, bounded retry and atomic checkpoints | Long unattended soak/recovery observation still required |
| 5 Office | Isometric canvas, desk/meeting movement, click details, explicit actual-record replay, optional TTS | No 3D world or invented free-form conversations |
| 6 Reports | Bangkok day/week/month/year, closed statistics, coverage disclosure, CSV/XLSX, paper exports | Legacy fills/rounds may be incomplete; no backfilled invented dates |
| 7 Market/news | All active THB universe, rotating detailed shortlist, actual public data/news, indicators over six timeframes | Missing/gapped timeframes shown unavailable; no access to unconnected paid feeds |
| 8 Learning | Frozen six-candidate research, versioned evidence, historical verifier, paper results, manually triggered research workflow | No candidate historically approved; hourly filter needs a separate preregistered study |
| 9 Controls | PAPER/LIVE, pause entry, stop, separate typed owner-close request, authenticated configuration | Real close endpoint verified with mocks only; no owner asset sold to test it |
| 10 Release | 108 unit/security/financial tests, 8 browser flows, real public backend smoke, SQL rollback tests | Fourteen continuous paper days/20 closed rounds cannot be manufactured during release |

Production commissioning: one **OBSERVE** job completed with ten successful tasks, nine factual handoffs and zero exchange submissions. It created ten registry rows. Real and paper flags stayed false, pending real orders stayed zero, and the last real order timestamp did not change. Closed 5m/15m/1h/4h data was available; gaps in 1m data were exposed. Daily API resolution was corrected from unsupported `1440` to `1D` after an actual public-data probe (HTTP 500 vs HTTP 200 with 242 bars).

Security advisors after DDL found no newly exposed application tables. Existing provider advisories remain: pg_net in public schema ([provider guidance](https://supabase.com/docs/guides/database/database-linter?lint=0014_extension_in_public)), leaked-password protection disabled ([provider guidance](https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection)), and intentionally inaccessible private control RLS without an end-user policy. These settings were not silently changed as part of the trading upgrade.

Source rollback is available through the pre-v14 backup branch. Database PITR/restore tests, persistent VPS WebSocket collectors and LLM providers are not claimed configured. The browser's WebSocket is a display feed; the cloud engine continues to use independently checked REST data. The acceptance gate remains closed and no profit guarantee is made.
