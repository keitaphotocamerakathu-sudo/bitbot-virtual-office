# BITBOT 14.2 — AI Trading Company
เว็บ: https://keitaphotocamerakathu-sudo.github.io/bitbot-virtual-office/

## การทำงานใหม่
- คัดกรองคู่ THB ที่มีข้อมูลราคาและยังเปิดซื้อขายจาก Bitkub ทุกคู่ ไม่กำหนด BTC เป็นเหรียญเดียว
- อ่าน min_quote_size, price_step, price_scale, base_quantity_scale และ freeze flags จาก Bitkub ไม่สมมติว่าทุกเหรียญมีขั้นต่ำหรือทศนิยมเหมือนกัน
- คัดกรองทุกคู่ด้วยสภาพคล่อง 24 ชั่วโมง ส่วนต่างซื้อขาย และข่าว จากนั้นดึงแท่งปิด 5 นาทีของตัวเลือกสภาพคล่องอันดับต้น 8 คู่และหมุนเวียนอีก 4 คู่ และเหรียญที่กำลังถือมาวิเคราะห์ EMA/RSI/ATR
- ถือสถานะบอททีละเหรียญ เมื่อปิดสถานะแล้วจึงคัดเหรียญใหม่ ไม่ขายเหรียญที่เจ้าของถือเองนอกบอท
- แสดงคะแนน เหตุผล HOLD ข่าวประกอบ และเงินใช้ได้หลังสำรอง
- ไม่มีจังหวะที่ผ่านเกณฑ์ = ไม่ซื้อ ไม่ฝืนให้มีรายการ

## คำนวณจากกระเป๋าเงินจริง
บอทอ่าน Wallet ทุกครั้งก่อนวิเคราะห์ และอ่านซ้ำก่อนส่งคำสั่ง
ใช้เฉพาะ THB.available ไม่รวม reserved
สำรองเงินเริ่มต้น 20% และตั้งสำรองเพิ่มเป็นบาทได้
วงเงินซื้อเป็นค่าต่ำสุดของ:
1. เงินในพอร์ตบอทและเงิน THB หลังสำรอง
2. เพดานต่อคำสั่งและวงเงินคงเหลือรายวัน
3. สัดส่วนถือเหรียญและพื้นที่คงเหลือหลังรวมเหรียญที่เจ้าของถือเอง
4. เงินที่ยอมเสี่ยงต่อครั้งหารด้วยระยะ Stop Loss/ATR ค่าธรรมเนียม และ spread
5. เพดานตามสภาพคล่องตลาด
ทุนสูงสุดที่ตั้งไว้ยังเป็นเพดาน ไม่ใช้เงินทั้งกระเป๋าโดยอัตโนมัติ
เมื่อเริ่มรอบใหม่ ทุนบอทจะลดให้ตรงกับเงินที่ใช้ได้จริงหลังสำรอง ไม่มีการเพิ่มทุนที่ตั้งไว้เอง

## ทีม 6 เอเจนต์
Coordinator คัดเหรียญและประสานรอบ, Trend วิเคราะห์ EMA/RSI/ATR, News คัดกรองหัวข่าว,
Strategy เลือกจังหวะเข้า, Risk คุมวงเงิน/กระเป๋า/ความผันผวน, Execution ส่ง LIMIT และตรวจการจับคู่
เป็น quantitative multi-agent ไม่ใช่หลาย LLM และไม่รับรองกำไร

## ข่าว
ดึง RSS จาก CoinDesk และ Cointelegraph พร้อมแหล่งอ้างอิง เวลาเผยแพร่ และเวลาที่ระบบอ่าน
คัดกรองคำเสี่ยงจากหัวข่าวที่ตรงกับชื่อเหรียญ/สัญลักษณ์ เช่น hack, exploit, fraud, delist
สัญลักษณ์กำกวม เช่น ONE และ OP ต้องมีบริบทชื่อเหรียญหรือ $ / วงเล็บ
แหล่งข่าวเก่าหรืออ่านไม่ได้ทั้งหมด = งดซื้อใหม่ แต่ยังดูแล Stop Loss ของสถานะเดิม
ข่าวบวกเพียงอย่างเดียวไม่สร้างคำสั่งซื้อ ต้องผ่านสัญญาณราคาและความเสี่ยง
ระบบนี้ไม่ใช่การตรวจข้อเท็จจริงหรือการเข้าใจเนื้อหาข่าวด้วยโมเดลภาษา และไม่ครอบคลุมข่าวทุกแหล่ง

## เริ่มใช้
ทดลอง: กดเริ่มได้เลย ไม่ต้องล็อกอิน ข้อมูลจำลองเก็บในเบราว์เซอร์และต้องเปิดหน้านี้ไว้
เงินจริง: สมัครด้วยชื่อผู้ใช้หรือใช้อีเมลบัญชีเดิม → เชื่อม Read+Trade API (ปิด Withdraw)
→ ตั้งทุนสูงสุด วงเงิน และสำรองเงิน → ยืนยันเริ่ม
เก็บรหัสกู้บัญชีไว้ส่วนตัว บัญชีชื่อผู้ใช้ไม่ต้องรอส่งอีเมล
บอทเงินจริงตรวจทุก 1 นาทีบนเซิร์ฟเวอร์ แม้ปิดหน้าเว็บ

## ความหมายของปุ่ม
พักซื้อใหม่: หยุดซื้อแต่ยังดูแลเหรียญเดิม
หยุดบอท: หยุดคำสั่งใหม่และขอยกเลิกคำสั่งค้าง เหรียญที่ถืออยู่ยังต้องดูแลเอง
จบรอบ: เก็บประวัติเดิมก่อนเริ่มใหม่ สำหรับเงินจริงต้องหยุดและตรวจสถานะค้างก่อน

## ความเสี่ยงและความปลอดภัย
- LIMIT spot THB เท่านั้น ไม่มี endpoint ถอนเงิน
- คีย์เข้ารหัสใน Supabase Vault ไม่ส่งกลับ browser หรือเก็บใน GitHub
- Server cap: คำสั่งละ 1,000 บาท ซื้อ 5,000/วัน ขาย 10,000/วัน ผู้ใช้ลดเพดานได้
- จองคำสั่งในฐานข้อมูลก่อนส่ง ป้องกันหลาย worker/หลายแท็บส่งชนกัน
- คำสั่งไม่ทราบผล = UNKNOWN หยุด ไม่ส่งซ้ำ ตรวจ client_id และผลจาก Bitkub ก่อนคิดบัญชี
- เก็บ symbol และ qty_scale ทุกออร์เดอร์ การตรวจผล/ยกเลิกใช้เหรียญของออร์เดอร์นั้น
- ขั้นต่ำ broker บางเหรียญสูงกว่า spot ทั่วไป บอทเว้นส่วนเผื่อให้ขายตอน Stop Loss ได้ แต่ราคาอาจลดจนต่ำกว่าขั้นต่ำได้
- Stop Loss ตรวจเป็นรอบ ไม่รับประกันราคา/การขายทันที สภาพคล่อง วงเงินขาย และ minimum มีผล
- กำไรจริงเป็นประมาณการจาก fill history และเครดิต ตรวจยอดกับ Bitkub เป็นหลัก
- บัญชี คีย์ และประวัติเดิมยังอยู่ สำรอง source ก่อนเปลี่ยน

## ดูแลระบบ
Supabase project lrxrigimdaedfemqheug; Edge Function bitbot-v10 (version API 11)
ไฟล์ supabase/bitbot_v11.sql เพิ่ม market registry, cache, wallet funding และ symbol/precision ใน orders
registry/cache เป็น service-only; client อ่านข้อมูลผ่าน Edge Function เท่านั้น
ไม่เริ่มบอทของผู้ใช้เองหลังติดตั้ง
BITBOT_LIVE_ENABLED=false ปิดคำสั่งใหม่ ขณะที่ตรวจ/ขอยกเลิกคำสั่งค้างได้

## ตรวจสอบ
npm test
npm install --ignore-scripts
npx playwright install --with-deps chromium
npm run test:ui
node tests/backend-smoke.mjs
ชุดทดสอบครอบคลุมเลือกเหรียญอื่น, เงินสำรอง/เงินติดคำสั่ง, กระเป๋าเก่า, ข่าวเสีย/อ่านไม่ได้,
ถือเหรียญเดิม, minimum broker, ทศนิยมราคาต่ำ, auth/HMAC/UNKNOWN, browser และ mobile
การทดสอบไม่ส่งคำสั่งเงินจริง และไม่ทดแทนการยืนยันการจับคู่ที่ Bitkub ของเจ้าของบัญชี


## Intraday v12 (2026-11-17)
New entries exclude stablecoins and require fresh public depth, sufficient hourly range and net reward/risk after rounded fees, spread and slippage. The entry freezes ATR-based exit levels and maximum holding time. Daily net profit target, entry cap and losing-streak cooldown pause only new buys. Existing legacy positions retain their policy and receive no retroactive deadline. Upgrade leaves the requested live account stopped.

The dashboard separates realized profit, estimated unrealized profit including an exit fee, actual cash fees and Bangkok daily results. Daily detail begins at v12; historical details are not invented. Exchange settlement stores a per-fill ledger and state atomically and refuses duplicate settlement.

News uses entity/context rules, two RSS sources and bounded article extraction for four recent stories. Inaccessible content is labeled headline-only; a single positive source cannot boost the score. No LLM is configured. This is a quantitative agent team.

`node research/backtest.mjs` performs three chronological 14-day-training/two-day-holdout runs on six predeclared coins. Holding time is selected only on training. Real OHLCV is used with synthetic spread/depth and neutral news; costs are explicit, fills are optimistic proxies and results do not establish live profitability. Each CI run archives its report. As of v14 both paper and real engines run on Cloud when explicitly started; the browser only renders their state.


## Evidence and server paper research v13

The three preregistered hypotheses and two holding times are defined in `research/protocol-v13.json` before downloading the research window. Its end (2026-10-28) precedes the previously examined v12 window. Four chronological training/validation splits choose only from their training data; CASH is a valid result. The final 14-day block is not evaluated if no candidate qualifies. Both the 10,000 THB development case and the 79.98 THB allocated-capital case are reported. Missing data never becomes a fabricated candle. `node research/compare-v13.mjs` reproduces the report from public Bitkub OHLCV with a local compressed cache. Archived reports include data and source digests.

No candidate currently qualifies for real trading. Server enforcement checks historical approval and at least 20 positive-net forward rounds over 14 days, and never treats passing those necessary conditions as a guarantee. Existing positions may still be managed when explicitly started; new real buys require evidence. The requested real account remains stopped.

A separate minute scheduler now evaluates six independent paper portfolios even with the computer off. It has no exchange key access and no signed exchange calls. Simulated LIMIT orders are only eligible on a subsequent fresh quote with enough visible depth at the limit price, and expire after two minutes. Visible depth is a snapshot proxy, not proof of queue position or real matching. Fees are charged conservatively without fee credits. The dashboard separates this research capital/results from actual positions and allows pausing paper research. Paper state, events and checkpoints use an account-scoped lease and atomic database function, with service-only access.


## Company v14 (17 November 2026)

Ten quantitative departments now share a permissioned tool router, dynamically allocated bounded workers and durable account-scoped company jobs. The isometric office replays actual task records and handoffs, with explicit playback labels. It does not invent LLM conversations. New closed-data indicators cover 1m/5m/15m/1h/4h/1D, and a missing/downward hourly context vetoes new buys. A public WebSocket ticker is display-only, reconnects with backoff and falls back to REST. Optional browser TTS reads a recorded handoff after a button press.

The browser's old guest paper execution has been replaced with authenticated cloud paper controls. Real and paper pause flags are preserved during upgrade. Changing paper capital archives the old paper session and never rewrites the real portfolio. Daily/weekly/monthly/yearly ledger reports, CSV and real XLSX files disclose data coverage. The owner can request a separate typed-confirmation close of bot-owned real assets under existing limits.

The 14-day/20-round progress display uses actual continuous paper records, and server enforcement also checks it. No strategy is approved, no new real order is authorized by the upgrade, and no daily profit is promised. The new hourly filter still needs long-duration empirical evaluation. Managed PITR/restore testing and any LLM provider remain unconfigured/unverified.

- [Architecture and scope](docs/ARCHITECTURE.md)
- [Deployment and recovery](docs/OPERATIONS.md)
- [คู่มือภาษาไทย](docs/USER_GUIDE_TH.md)
- [Server environment template](.env.example)

## Owner live consent v14.1

At the owner's explicit request, incomplete historical/forward research can now be acknowledged in the existing real-start dialog. A server-stored, configuration-bound session consent permits new buys through the company and final buy gates while retaining all signal, wallet, market, daily, loss, reservation and reconciliation checks. Research continues to display its actual failed/pending result. The upgrade starts no account and does not change capital or keys. See [owner live consent](docs/OWNER_LIVE_CONSENT.md) for scope and deployment.


## Animated office v14.2 (presentation only)

The office now runs an autonomous visual scene: ten furnished departments, glass partitions, shared meeting table, coffee bar and lounge. Characters follow collision-aware tile paths, visit each other, carry reports, take turns speaking from archived task summaries and return to their desks. New completed job archives are picked up automatically; repeated playback is labeled with the original source time. Ambient walks are explicitly cosmetic, and a guest scene is explicitly a demo. No LLM conversation is invented.

The same page now shows the real bot heartbeat, scan decision and HOLD/error reason independently from the animation. It provides camera pan/zoom, fit/follow, speed, pause and optional browser Thai voice. Pausing or replaying the scene cannot start, stop or send an order. The scene sleeps when hidden and is capped around 30 FPS. This release changes no Edge Function, research gate, account flags, risk settings or trade state.

Validation adds path reachability/obstacle tests and browser checks for automatic movement, actual-record dialogue, identical frames while paused, mobile controls and absence of trading actions from scene controls.
