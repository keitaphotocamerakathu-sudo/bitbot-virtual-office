# REA Bitkub — ผลส่งมอบตาม SRS v1.0

วันที่ 17 พฤศจิกายน 2569 · สถานะ `PAPER_ONLY` · ไม่มีการอนุมัติ Live

## สิ่งที่ใช้งานแล้ว

หน้า `rea.html` ใช้บัญชี Bitbot เดิม แสดงพอร์ตจำลองอ้างอิง 10,000 บาท จาก Backend แยกจากยอด Wallet จริงและพอร์ตทดลองเดิม ไม่ต้องใส่ Bitkub API Key เพื่อใช้พอร์ต REA

- กฎความเสี่ยงเป็นโค้ดตายตัว: 1% ไม่เกิน 100 บาท, สูงสุด 2 สถานะรวมคำสั่งซื้อค้าง, ต่อสถานะไม่เกิน 4,000 บาท, รวมไม่เกิน 8,000 บาท
- ทุนลดลงแล้วลดความเสี่ยงตามทุนจริงในพอร์ตจำลอง ไม่เพิ่มเกินเพดานเดิมเมื่อ Equity สูงขึ้น
- ขนาดซื้อคิด Stop Distance + ค่าธรรมเนียมสองด้าน + Slippage และสำรองการปัดเศษ ไม่แบ่งเงินเท่า ๆ กัน
- Daily P&L คิดจาก Equity หักผลฝากถอน รวมสถานะที่ยังถือและค่าธรรมเนียม ล็อกขาดทุนทั้งวันและไม่ปลดเพราะราคาฟื้น
- Pause/Resume, หยุดเฉพาะการเปิดใหม่, Emergency Stop ทุกคำสั่ง มีบันทึกประวัติ การ Resume ไม่ล้าง Daily Loss Lock
- คัดคู่ THB Spot ที่ส่งคำสั่งได้ตามข้อมูลตลาด วิเคราะห์ EMA, RSI, MACD, ATR และสามกลยุทธ์ พร้อมคะแนนหกปัจจัยตามน้ำหนักใน SRS
- คำสั่งจำลองบันทึกก่อนจับคู่รอบถัดไป มี Partial Fill, Timeout, Cash Reservation และ Client Order ID ป้องกันซ้ำ
- จำลองการจับคู่ไม่เกิน 10% ของปริมาณ Order Book ที่มองเห็น ไม่ถือเป็นหลักฐานการจับคู่จริงจาก Exchange
- ใช้ Single Active Executor ผ่านฐานข้อมูล, Lease, Revision และ Transaction การกดพักจะทำให้รอบเก่าบันทึกทับไม่ได้
- ตาราง 12 ชุดอยู่ใน schema `rea` แยกจากระบบเดิม เปิด RLS และให้เฉพาะ Backend เข้าถึง API ตรวจ JWT และผูกบัญชีก่อนอ่าน/ควบคุม
- Dashboard 6 หน้า: Overview, Scanner, Orders & Positions, Profit Analytics, Agent Monitor, Safety มี Dark/Light Mode
- รอบ Paper ทำงานจาก Supabase Cron ทุกนาทีแม้ปิดหน้าเว็บ เป็นระบบระหว่างเตรียม VPS

## สิ่งที่พบจากระบบเดิมและแก้ไข

ระบบเดิมที่ติดตั้งจริงคือ Edge Function `bitbot-v10` v17 และ `bitkub-gateway` v5 ไม่ใช่ชุด v7/v8 ที่มีไฟล์บันทึกเก่า รายการคำสั่งจริงมีประวัติอยู่แล้ว จึงคงข้อมูลเดิมทั้งหมดไว้

1. โค้ดเดิมใช้ Live เป็นค่าปริยายเมื่อไม่ได้กำหนดค่าเป็น `false` และมีการยอมรับผลทดสอบไม่ครบผ่าน `allowUnvalidated` รุ่นนี้ล็อก Live ทั้งสอง Backend และตรวจซ้ำที่ฟังก์ชันส่ง Exchange ก่อนมี Network Request
2. ระหว่างตรวจพบตัวรันจริงเปิดอยู่ โดยฐานข้อมูลบอทแสดงไม่มีเหรียญที่บอทถือและไม่มีคำสั่งที่ยังไม่กระทบยอด จึงหยุดตัวรัน Live และปิด Master Switch ตาม SRS นี้ ไม่ได้ส่งคำสั่งซื้อขายหรือยกเลิกคำสั่งจริงระหว่างพัฒนา
3. ระบบเดิมใช้ทุนบอท 100 บาท และเงินจัดสรรประมาณ 79.976 บาท ประกอบกับเพดาน Allocation 20% ทำให้ขนาดซื้อประมาณ 16 บาท การไม่ซื้อมีทั้งข้อจำกัดเงินและสัญญาณ ไม่ใช่พิสูจน์ว่า Backend หยุดทำงาน
4. งานเดิมตรวจทุก 1 นาที แต่ใช้แท่งปิด 5 นาทีและมีการตรวจแนวโน้มหลายช่วงเวลา จึงไม่ควรคาดว่าจะซื้อทุกรอบหรือแก้ด้วยการฝืนสัญญาณ
5. ข้อมูลตลาดเดิมใช้ REST และ Cache ที่ Backend ส่วน WebSocket อยู่ในเบราว์เซอร์เพื่อแสดงราคา ยังไม่มีตัวเก็บ WebSocket ต่อเนื่องบน VPS
6. คำสั่ง HTTP 429 ทำให้พักการเรียก Bitkub อย่างน้อย 30 วินาทีในตัวรันนั้น ปฏิเสธการเปิดสถานะเมื่อข้อมูลไม่พร้อม

## หลักฐานการทดสอบ

- `npm test`: 175 รายการผ่าน หลังเพิ่ม REA, การล็อก Live, Replay ที่ป้องกันข้อมูลอนาคต และกรณีเครือข่ายล้มเหลว
- ตรวจ Syntax ของหน้าเว็บ, Core, Service และ Docker Runner ผ่าน
- ทดสอบกับ PostgreSQL จริงแบบ Transaction/Rollback: บันทึก Checkpoint สำเร็จ, ปฏิเสธการบันทึกซ้ำ, ไม่ให้สอง Executor จับบัญชีเดียวกัน, Pause ไม่ถูก Lease เก่าบันทึกทับ และปิดสิทธิ์ anon/authenticated ต่อ RPC ภายใน
- ตรวจ API ที่ติดตั้งจริงคืน `mode=PAPER_ONLY` และ `liveEnabled=false`
- ตรวจรอบ Paper ที่ทำงานจริงแล้ว: พบคู่ THB 347 คู่ วิเคราะห์เชิงลึก 20 คู่ บันทึก Agent Decisions, Equity และ Heartbeat ได้ ตัวเลขการค้นพบเปลี่ยนได้ตามตลาด
- ยังไม่ผ่านการทดสอบภาพหน้าเว็บ: เครื่องทดสอบ Chromium เปิดไม่ได้เพราะข้อจำกัดระบบ `socket() Operation not permitted` ชุด Playwright ถูกจัดเตรียมไว้แต่ไม่อ้างว่าผ่าน
- ยังไม่ได้ทดสอบ Docker Build/Run บนเครื่องปลายทาง เนื่องจากไม่มี Docker หรือ VPS ที่เชื่อมต่อในงานนี้

## สถานะตาม Phase

| Phase | สถานะจริง |
|---|---|
| 1 Audit | ตรวจ Source ที่ติดตั้งจริง, Supabase, Auth, Scheduler และความเสี่ยงหลักแล้ว |
| 2 Market & Scanner | Backend REST/Cache และ Scanner ใช้งานแล้ว; Backend WebSocket บน VPS ยังไม่เสร็จ |
| 3 Strategy & Risk | กฎ SRS สำหรับ Paper ใช้งานและทดสอบแล้ว; ยังต้อง Backtest และ Out-of-sample ด้วยข้อมูลเพียงพอ |
| 4 Paper & Dashboard | Backend Paper ทำงานแล้ว; Dashboard พร้อมเผยแพร่; การตรวจภาพหน้าเว็บยังมีข้อจำกัด |
| 5 Operations | มี Lease/Recovery/Safe Mode; ยังต้องเดินหน้าอย่างน้อย 7 วัน, ทดสอบ VPS, Independent Watchdog และการแจ้งเตือนเจ้าของ |
| 6 Live | ล็อกทั้งหมด ไม่มีกระบวนการเปิด Live ในรุ่นนี้ และไม่มีกำหนดเปิดอัตโนมัติ |

## ข้อจำกัดที่ต้องทำต่อก่อนตรวจรับ

โค้ด Agent ใช้การวิเคราะห์เชิงตัวเลขและกฎตรวจข่าว ยังไม่ได้เชื่อม LLM Provider และไม่ได้อ้างว่าเป็นการถกเถียงจากโมเดลภาษาหลายตัว

สถาปัตยกรรม Docker ที่ส่งให้เป็น Paper Runner ซึ่งใช้โมดูลเดิม ยังไม่ใช่ระบบแปด Service แยกครบตาม SRS ไม่มี Backend WebSocket Collector, Independent Stop Watchdog, Alert Delivery หรือ Production Observability ที่ตรวจรับแล้ว

Docker Runner มี HTTP Health Endpoint และ Restart Policy แต่ Docker ไม่ Restart เพียงเพราะ Healthcheck ขึ้น Unhealthy ต้องเพิ่มระบบ Monitor/Orchestrator ของ VPS ใน Phase 5

Frontend ปัจจุบันใช้ GitHub Pages เดิม ยังไม่ได้ย้ายไป Cloudflare Pages เครื่องมือใหม่เปิดอ่าน/ควบคุม Paper ผ่าน Backend เท่านั้น

การจำลอง Limit Fill ใช้สมมติฐานคิวและ Order Book ไม่มีหลักฐานการจับคู่จริง จึงใช้ยืนยันกำไรหรือความพร้อม Live ไม่ได้ หากข้ามเที่ยงคืนขณะถือสถานะและข้อมูลขาดหายจนพิสูจน์ทุนเริ่มวันไม่ได้ ระบบจะหยุดเปิดซื้อใหม่แทนการเดาตัวเลข

ข้อมูลเก่าของ Dashboard และคู่มือเดิมเกี่ยวกับการเปิด Live ก่อนผลทดสอบครบถูกแทนที่ด้วยนโยบาย `PAPER_ONLY` ในเอกสารนี้

## API ที่ตรวจสอบอ้างอิง

- [Bitkub API ทางการ](https://github.com/bitkub/bitkub-official-api-docs)
- [REST v3: ตลาดและคำสั่ง](https://github.com/bitkub/bitkub-official-api-docs/blob/master/rest-v3.md)
- [REST v4: Wallet](https://github.com/bitkub/bitkub-official-api-docs/blob/master/rest-v4.md)
- [Public WebSocket](https://github.com/bitkub/bitkub-official-api-docs/blob/master/websocket-public.md)
- [Supabase Edge Runtime Limits](https://supabase.com/docs/guides/functions/limits)

กำไรไม่รับประกัน เกณฑ์ผ่านงานส่วนนี้คือการคำนวณและบันทึกถูกต้อง มีการควบคุมความเสี่ยง และไม่มีคำสั่งเงินจริงก่อนตรวจรับ
