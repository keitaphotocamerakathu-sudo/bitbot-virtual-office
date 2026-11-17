# Bitbot AI Trading Company — architecture and delivery evidence

Specification: user-supplied MASTER PROMPT, 17 November 2026. This repository extends the existing Bitkub system and uses only Supabase project `lrxrigimdaedfemqheug`. Restart and cooperative projects are out of scope.

## Phase 1 audit

The v13 system already contains a server minute scheduler, encrypted exchange credentials, HMAC signing, all-THB symbol registry, closed-candle strategies, wallet sizing, durable order reservation, reconciliation, an atomic fill ledger, chronological research, and six independent cloud paper accounts. Real trading and paper research were both paused when this audit began; preserve those owner choices. No new real order is authorized by this specification.

Missing components being added: a durable company job queue, a resource-bounded agent registry, tool permissions, task/communication evidence, an animated office driven by that evidence, multi-timeframe analysis on demand, richer performance reports, readiness progress and operational health.

## Boundaries

The browser renders data and animation. It cannot sign orders or approve a strategy. The existing Edge Function is the sole exchange adapter; it accepts no arbitrary URLs, withdrawal paths or agent-defined risk limits. The public-data engine and read-only company workers cannot access credentials. Execution still passes the existing wallet, risk, account approval, durable reservation and reconciliation gates.

The company queue contains one account-scoped cycle job with a recoverable lease. Department tasks run with explicit dependencies and measured start/end times. Their real inputs, outputs and hand-off envelopes are saved together. An office replay is explicitly labeled as a replay. Unavailable data and failed tools are displayed as such; avatars never invent conversations or pretend that a stopped bot is buying.

The default departments are CEO, CIO, Market, News, Quant, Portfolio, Risk, Execution, Audit and Learning. Registry rows are data, not a fixed architectural ceiling. Scaling is bounded by configured worker and job caps. Unregistered tools and attempts by a non-execution worker to trade are rejected. No LLM is configured; these workers use quantitative calculations and structured messages. A language model may later explain results through an explicitly configured provider, but cannot bypass risk.

## Accounting

Real fills originate in authenticated Bitkub order history. The bot-owned allocated portfolio is separated from the account's entire wallet and from paper accounts. Deposits, withdrawals and manually owned coins are not trading profit. Historic fills absent from the durable ledger are reported as incomplete coverage, never synthesized. Weekly/monthly/yearly reports use Bangkok dates and identify their coverage boundary.

## Recovery and control

Scheduler leases expire after a crash; the next minute reclaims work. Pending real orders are reconciled before a new decision. Unknown exchange-write outcomes are never retried blindly. PAUSE ENTRY continues position management; STOP cancels pending orders under the existing policy and retains holdings. Closing positions is a separate, explicitly confirmed owner action. Source backups are kept as Git branches; paper exports are available in the app. Managed database backup/PITR must be checked against the project's provider plan; it is not claimed to be configured by this application.

## Validation limits

Software correctness tests, mock exchange failure tests, browser tests and actual public-data probes are different from profit validation. A 14-day live-data paper observation cannot be completed during one coding session. No existing strategy has historical approval. Owner approval and explicit start remain necessary for real trading even after evidence passes. Performance of unconnected LLM providers, unattended VPS WebSocket collectors and managed PITR is not claimed.
