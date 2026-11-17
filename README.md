# REA AI Trading Bot · Bitkub · 19.0

[เปิดหน้า Live Trading](https://keitaphotocamerakathu-sudo.github.io/bitbot-virtual-office/rea.html#live) · [Live Execution 19.0](docs/REA-19.0-LIVE-TH.md) · [เปิด Dashboard](https://keitaphotocamerakathu-sudo.github.io/bitbot-virtual-office/rea.html) · [SRS v1.0](docs/REA-SRS-v1.0.md) · [ผลส่งมอบและหลักฐาน 18.1](docs/REA-18.1-DELIVERY-TH.md) · [คู่มือใช้งาน](docs/REA-OPERATIONS-TH.md)

ระบบเลือกคู่ THB และจำลองการซื้อขายด้วยข้อมูลตลาดจริงที่ Backend เริ่มต้น `PAPER_ONLY` เพิ่ม Live Execution ที่ใช้ผลจับคู่จริงแยกจาก Paper แล้ว บัญชี Live เริ่ม `LIVE_LOCKED` และต้องผ่านการตรวจรับกับเจ้าของอนุมัติที่ Server การอนุมัติเดิมไม่ปลด Live รุ่นนี้

## สถานะปัจจุบัน

Private API ปัจจุบันถูก Bitkub ปฏิเสธ `401 / 3` จึงยังอ่าน Wallet และเปิดใช้งานเงินจริงไม่ได้ ให้เชื่อม API Key/Secret ที่ใช้งานได้ในหน้า Live Trading ระบบตรวจ Wallet ก่อนบันทึก

- Live Strategy ทำงานบน Supabase ทุกนาทีและ Independent Live Watchdog เป้าหมายทุก 15 วินาที โดยไม่ต้องเปิดเว็บ แยกสมุดบัญชีและคำสั่งจาก Paper

- Supabase Backend ทำงานผ่าน Cron ทุกนาที มี Strategy, Independent Risk Watchdog และ Database Health Monitor แยกกัน ปิดหน้าเว็บได้
- Docker เตรียมไว้ 4 Service: Market Data, Strategy Worker, Risk Watchdog และ Health Monitor มี Service Lease, Reconnect, Progress Supervisor และ Safe Mode
- ยังไม่มี VPS/Container Host เชื่อมต่อ ชุด Docker จึงยังไม่ได้ทำงานต่อเนื่องบนเครื่องปลายทาง
- LLM สรุปข่าวภาษาไทยผ่าน Workers AI รับเฉพาะบริบทสาธารณะ ไม่มีสิทธิ์ซื้อขายหรือแก้ความเสี่ยง จำกัดหนึ่งครั้งต่อชั่วโมง สูงสุด 24 ครั้งต่อวัน UTC
- เก็บสัญญาณ คำสั่งจำลอง การจับคู่ การตัดสินใจ ความเสี่ยง และประวัติการควบคุมใน Schema `rea` ที่แยกจากระบบเดิม

## กฎความเสี่ยง

| ตัวแปร | เพดานเริ่มต้น |
|---|---:|
| ทุนจำลอง | 10,000 THB |
| ความเสี่ยงต่อรายการ | 1% ไม่เกิน 100 THB |
| สถานะรวมคำสั่งซื้อค้าง | 2 |
| มูลค่าต่อสถานะ / รวม | 4,000 / 8,000 THB |
| ขาดทุนรายวัน | 3% ไม่เกิน 300 THB |
| Reset รายวัน | 00:00 Asia/Bangkok |
| Leverage | 1x Spot |

ทุนเริ่มวันต่ำกว่า 10,000 บาททำให้วงเงินเสี่ยงลดลง Daily Loss Lock ไม่ปลดเพราะราคาดีดกลับหรือกด Resume ในวันเดิม

## ตรวจสอบและใช้งาน

ผลตรวจโค้ด `ae2f29b` ผ่าน [GitHub Actions](https://github.com/keitaphotocamerakathu-sudo/bitbot-virtual-office/actions/runs/44087338864): Backend 190 รายการ, Browser/Mobile 21 รายการ, Docker Build/Runtime, Compose, Public WebSocket จริง และ Public Backend Smoke Checks

```sh
npm ci --ignore-scripts --no-audit --no-fund
npm test
npm run test:ui
```

การติดตั้ง Docker ใช้ [compose.rea.yaml](compose.rea.yaml) และ Secret Mount ฝั่ง Host ตาม [คู่มือรุ่น 18.1](docs/REA-18.1-DELIVERY-TH.md#ติดตั้ง-docker) ไม่มี Bitkub API Key ใน Container

```sh
docker compose -f compose.rea.yaml up -d --build
```

ยังต้องตรวจ Host จริง การกู้คืนและแจ้งเตือน เก็บ Paper Trading ให้ครบอย่างน้อย 7 วัน และผ่าน Security Review ก่อนพิจารณา Live Live เปิดได้จากบัญชีเจ้าของหลัง Server ตรวจรับผ่านเท่านั้น LLM ไม่มีสิทธิ์ปลดล็อก

งานวิจัยและเอกสารรุ่นเดิมอยู่ใน `research/` และ `docs/` ข้อกำหนดปัจจุบันให้ยึด SRS v1.0 และเอกสาร REA รุ่นล่าสุด
