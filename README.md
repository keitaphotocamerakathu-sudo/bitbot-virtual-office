# REA 30.0 — Bitkub THB settlement and wallet reconciliation

แก้การตัดเศษเงินรับจากการขายให้ตรงกับ Bitkub แสดงยอด THB ที่ใช้ได้และยอดที่ถูกจองจาก Exchange พร้อมเวลาอ่าน แยกเงินสดของบอทและส่วนต่าง ไม่ขยายค่าผ่อนปรนเพื่อซ่อนยอดคลาดเคลื่อน เครื่องมือแก้สมุดบัญชีเก่าตรวจหลักฐานครบและเก็บ Audit ก่อนปรับ ดู [รายละเอียด REA 30.0](docs/REA-30.0-WALLET-TH.md)

# REA 28.0 — Capital guard and visible risk pauses

เพิ่ม Risk Manager แบบปกป้องทุนที่เจ้าของอนุมัติ: ขาดทุนรายวันถึง 1.5% ลดงบเสี่ยงครึ่งหนึ่ง แพ้ติดกัน 3 ไม้ใน 24 ชั่วโมงพักซื้อ 60 นาที กันเงินสด 30% และตรวจมูลค่าขายที่ Stop ก่อนสร้างไม้ใหม่ พักซื้อที่เจ้าของสั่งไม่ถูกปลดเอง ไม้เดิมยังเฝ้าจุดขายเดิม ผลกำไรยังต้องวัดจากข้อมูลจริง ดู [รายละเอียด REA 28.0](docs/REA-28.0-RISK-TH.md)

# REA 27.0 — Owner-approved five live positions

เพิ่มเพดานเงินจริงของบัญชีที่เจ้าของอนุมัติจาก 2 เป็น 5 สถานะ รวมคำสั่งซื้อที่ยังไม่จบ แบ่งงบเสี่ยงต่อไม้ใหม่ตามจำนวนช่อง โดยคงเพดานความเสี่ยงรวมเทียบเท่า 2 ไม้เดิม ทุนที่อนุมัติ เพดานถือครอง และขาดทุนรายวันไม่เพิ่ม การถือเดิมใช้จุดออกเดิมต่อ ฐานข้อมูลตรวจสิทธิ์และเพดานซ้ำก่อนออกตั๋วส่งคำสั่ง ดู [รายละเอียด REA 27.0](docs/REA-27.0-POSITIONS-TH.md)

# REA 26.0 — Profit protection and selective-entry study

[ตั้งค่า / Settings](https://keitaphotocamerakathu-sudo.github.io/bitbot-virtual-office/rea.html#settings): ดูวงเงินเงินจริงที่ใช้อยู่ เชื่อม Bitkub และใช้ปุ่มควบคุมเดิม รองรับลิงก์เก่า #safety และ bitkub-setup.html

เพิ่มชุดทดลองจุดออก 3 พอร์ตเริ่มพร้อมกัน รวม Paper 10 พอร์ต เก็บ 7 พอร์ตเดิมต่อ เปรียบเทียบจุดออกเดิมกับการเลื่อน Stop ตามกำไรสุทธิ และแบบคัดจังหวะเข้าเพิ่ม ฝั่งจริงแสดงแผนเปรียบเทียบแบบอ่านอย่างเดียว ดู [รายละเอียด REA 26.0](docs/REA-26.0-PROFIT-STUDY-TH.md) · [ผลทดลอง](https://keitaphotocamerakathu-sudo.github.io/bitbot-virtual-office/rea.html#agents)

# REA 25.0 — Post-trade knowledge and parallel Paper experience

เพิ่มสมุดบทเรียนรายไม้เงินจริง และ Paper อีก 2 พอร์ต รวม 7 พอร์ต ทำงานบน Backend ควบคู่กับเงินจริง ฝั่งจริงตรวจบทเรียนก่อนซื้อ และรับผลเปรียบเทียบจากคู่ Paper ใหม่ภายใต้ตัวกรองพักซื้อชั่วคราวที่จำกัดไว้ในโค้ด ดู [รายละเอียด REA 25.0](docs/REA-25.0-LEARNING-TH.md) · [เงินจริงและบทเรียน](https://keitaphotocamerakathu-sudo.github.io/bitbot-virtual-office/rea.html#live) · [ทีม Paper](https://keitaphotocamerakathu-sudo.github.io/bitbot-virtual-office/rea.html#agents)

# REA AI Trading Bot · Bitkub · 24.0

เพิ่มทีมเป็น 17 หน้าที่ พร้อมการทดลอง Paper 5 พอร์ตเพื่อเทียบกลยุทธ์และแบบคัดคะแนนขั้นต่ำ 80, ตัวตรวจความสัมพันธ์ผลตอบแทนของเหรียญ และตัวแยกสาเหตุขาดทุนตามสมุดบัญชี ไม่หักค่าธรรมเนียมซ้ำ ไม่แก้ยอดขาดทุนเป็นศูนย์ และไม่เปลี่ยนกลยุทธ์เงินจริงอัตโนมัติ ดู [รายละเอียด 24.0](docs/REA-24.0-EXPERIMENTS-TH.md) และ [ผลทดลองกับออฟฟิศ](https://keitaphotocamerakathu-sudo.github.io/bitbot-virtual-office/rea.html#agents)

เพิ่มผู้ช่วยวางแผนเงินทุน บอกเหตุผลที่ยังไม่ต้องเติม/ต้องรอตรวจ และคำนวณขนาดไม้จากกฎความเสี่ยงจริง แยกเงินที่ขาดใน Wallet ออกจากงบบอทที่ต้องอนุมัติเพิ่ม พร้อมประวัติย้อนหลัง อ่าน [รายละเอียด 23.0](docs/REA-23.0-CAPITAL-TH.md) บน [พอร์ตเงินจริง](https://keitaphotocamerakathu-sudo.github.io/bitbot-virtual-office/rea.html#live) ไม่เรียก Codex เพิ่มและไม่เปลี่ยนงบเอง

เพิ่มทีมตรวจสอบจาก 7 เป็น 14 หน้าที่ ใช้ข้อมูลตลาดชุดเดียวกัน ตรวจคุณภาพข้อมูล สภาพคล่อง หลายกรอบเวลา เหตุผลคัดค้าน ต้นทุน พอร์ต และเวลา Backend พร้อมบันทึกผลย้อนหลัง แสดงในหน้า [ทีมงานและออฟฟิศ](https://keitaphotocamerakathu-sudo.github.io/bitbot-virtual-office/rea.html#agents) อ่าน [รายละเอียด 22.0](docs/REA-22.0-TEAM-TH.md) ตัวตรวจใหม่ใช้กฎเชิงตัวเลข ไม่เรียก Codex/LLM เพิ่ม และไม่รับประกันผลกำไร

เพิ่มหน้า [สมอง Codex AI](https://keitaphotocamerakathu-sudo.github.io/bitbot-virtual-office/rea.html#codex) ใน REA 21.1: OpenAI managed Codex harness วิเคราะห์ข้อมูลพอร์ตและเสนอแผนพร้อมหลักฐาน ต้องเชื่อม OpenAI Key และยินยอมค่า API ก่อนเริ่ม เปิดให้ Backend รับงานเองตามตารางและเหตุการณ์พอร์ตเมื่อเจ้าของบันทึกยินยอม รายละเอียดใน [คู่มือ Codex 21.0](docs/REA-21.0-CODEX-TH.md)


[เปิดพอร์ตเงินจริงและออฟฟิศ AI](https://keitaphotocamerakathu-sudo.github.io/bitbot-virtual-office/rea.html#live) · [หน้าเว็บและออฟฟิศ 20.0](docs/REA-20.0-DASHBOARD-TH.md) · [เปิด Live วงเงินจำกัด 19.1](docs/REA-19.1-LIMITED-LIVE-TH.md) · [Live Execution 19.0](docs/REA-19.0-LIVE-TH.md) · [เปิด Dashboard](https://keitaphotocamerakathu-sudo.github.io/bitbot-virtual-office/rea.html) · [SRS v1.0](docs/REA-SRS-v1.0.md) · [ผลส่งมอบและหลักฐาน 18.1](docs/REA-18.1-DELIVERY-TH.md) · [คู่มือใช้งาน](docs/REA-OPERATIONS-TH.md)

ระบบเลือกคู่ THB และจำลองการซื้อขายด้วยข้อมูลตลาดจริงที่ Backend เริ่มต้น `PAPER_ONLY` เพิ่ม Live Execution ที่ใช้ผลจับคู่จริงแยกจาก Paper แล้ว บัญชี Live เริ่ม `LIVE_LOCKED` รุ่น 19.1 เพิ่มการเปิดเงินจริงวงเงินจำกัดสูงสุด 100 บาทเมื่อเจ้าของยืนยันและรับทราบผลตรวจรับเต็มที่ยังไม่ครบ ส่วน STANDARD ยังต้องผ่านการตรวจรับเต็ม การอนุมัติและการบังคับวงเงินอยู่ที่ Server

## สถานะปัจจุบัน

หน้าแรกเปิดพอร์ตเงินจริงแล้ว รวม Wallet, สถานะที่ถือ, ผลจับคู่จาก Exchange, เหตุผลที่รอ และออฟฟิศ Animation 17 หน้าที่ในหน้าเดียว Scanner/ประวัติ/กำไร/ทีมงานเลือกแหล่งข้อมูลเงินจริงหรือ Paper ได้อย่างชัดเจน งานทดลองกลยุทธ์แสดง Paper แยกเสมอ ระบบรุ่นเดิมเก็บไว้ที่ `legacy.html`

ตรวจ Private API ล่าสุดอ่าน Wallet ได้ THB 99.97 บาท (17 พฤศจิกายน 2569) ยอดนี้ใช้เปิด Live วงเงินจำกัดได้หลังเจ้าของยืนยันบนเว็บ การบันทึก Key หรือการโหลดหน้าไม่เปิด Live หรือซื้อสินทรัพย์อัตโนมัติ หากเปลี่ยน Key ต้องตรวจ Wallet ใหม่ก่อนบันทึก

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

ผลตรวจ REA 19.0 ผ่าน [GitHub Actions](https://github.com/keitaphotocamerakathu-sudo/bitbot-virtual-office/actions/runs/44096511177): Backend 209 รายการ, Browser/Mobile 24 รายการ, Docker Build/Runtime, Compose, Public WebSocket จริง และ Public Backend Smoke Checks รายละเอียดโค้ดสุดท้ายและสถานะการเชื่อมต่ออยู่ในรายงาน Live 19.0

```sh
npm ci --ignore-scripts --no-audit --no-fund
npm test
npm run test:ui
```

การติดตั้ง Docker ใช้ [compose.rea.yaml](compose.rea.yaml) และ Secret Mount ฝั่ง Host ตาม [คู่มือรุ่น 18.1](docs/REA-18.1-DELIVERY-TH.md#ติดตั้ง-docker) ไม่มี Bitkub API Key ใน Container

```sh
docker compose -f compose.rea.yaml up -d --build
```

การตรวจรับเต็มยังต้องตรวจ Host จริง การแจ้งเตือนภายนอก เก็บ Paper Trading อย่างน้อย 7 วัน และผ่าน formal review ก่อนเปิด STANDARD ส่วนการเปิดเงินจริงวงเงินจำกัดสูงสุด 100 บาทต้องยอมรับผลตรวจที่ยังไม่ครบอย่างชัดเจนจากบัญชีเจ้าของ LLM ไม่มีสิทธิ์ปลดล็อกหรือเปลี่ยนวงเงิน

งานวิจัยและเอกสารรุ่นเดิมอยู่ใน `research/` และ `docs/` ข้อกำหนดปัจจุบันให้ยึด SRS v1.0 และเอกสาร REA รุ่นล่าสุด
