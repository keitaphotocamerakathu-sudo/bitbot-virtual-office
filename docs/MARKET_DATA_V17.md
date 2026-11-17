# Verified market data v17

The previous feed rejected ETH on every one of 27 observed cycles because the last 25 five-minute candles contained missing time slots. A read-only comparison with Bitkub's recent trades confirmed no matched trades in those intervals. V17 distinguishes a verified empty interval, an interval recoverable from actual trades, and an unresolved data gap.

## Data processing

- Validate, sort and deduplicate closed OHLCV; malformed or conflicting data is rejected.
- Request up to 1,000 recent public trades only when history is insufficient, discontinuous or stale. Normalize both the documented millisecond timestamps and the second timestamps observed from the exchange.
- A gap can be reconstructed only when the returned recent-trades window starts strictly before the interval and reaches at least its end. Reconstruct OHLCV from matching trades, or carry the prior close with volume zero if the fully covered interval has no trades. Every reconstructed candle carries its source and coverage evidence. Never fill an unverified interval, a leading empty interval without a prior close, or an open candle.
- Preserve previously verified repairs within a 360-candle window. New original candles and fresh covering trade evidence take priority.
- Try up to 24 candidates, prioritizing held assets, liquid leaders and rotating candidates with usable history. Stop after 12 ready candidates or the scan time budget; refresh quotes after history work. Failed-source reasons are returned to the UI. Each health record expires independently after five minutes.
- Recover hourly history with the same rules. The hourly trend veto and all existing signal, fee, size, daily-entry, loss and order reconciliation controls remain enforced.

## Owner activation

The release installs code and a service-only database function. Existing accounts continue using their original data pipeline until the owner opens Live mode → **ใช้ระบบข้อมูลใหม่** and confirms in the application. This is a data-source update, not a new profit-tested strategy. The app displays the actual account limits and whether the existing bot is running.

The atomic upgrade checks the displayed configuration against the current row, rejects open holdings, unresolved orders and risk locks, invalidates any old worker lease, and records the owner's acknowledgment against the updated configuration. It preserves balances, accounting history, daily counters, trading limits and the running/pause flags. A stopped bot stays stopped. No exchange order is submitted by the upgrade endpoint.

## Verification

`npm test` covers provider timestamp formats, zero-volume proof, missing coverage, stale evidence, actual-trade aggregation, repair retention, quote refresh, rotating candidates, owner configuration binding and a mocked unattended BUY → fill reconciliation → SELL → fill reconciliation cycle with duplicate prevention. `npm run test:ui` covers confirmation and held-position restrictions alongside the existing browser flows. The archived v13/v16 research digests remain unchanged; their results do not validate this new data pipeline's profitability.

Deployment: apply `supabase/bitbot_v17.sql`, deploy all files in `supabase/functions/bitbot-v10/` with the existing internal authentication and `verify_jwt=false`, publish Pages after CI, and run `node tests/backend-smoke.mjs`. Verification calls public data and authentication checks only; do not invoke the scheduler, tick, observe or owner activation endpoint as a live test.

Public data reference: https://github.com/bitkub/bitkub-official-api-docs/blob/master/rest-v3.md#get-apiv3markettrades
