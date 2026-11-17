# REA 18.1 — Backend Operations และ LLM

วันที่ 17 พฤศจิกายน 2569 · ต่อจาก SRS v1.0 · `PAPER_ONLY`

## ส่วนที่เพิ่ม

| ส่วน | การทำงาน |
|---|---|
| Backend WebSocket Collector | อ่าน Public Ticker จาก Bitkub ได้ไม่เกิน 32 คู่พร้อมกัน แบ่ง 8 Stream ต่อการเชื่อมต่อ มี Reconnect, Backoff และตัดข้อมูลเก่า |
| Independent Risk Watchdog | ตรวจ Stop Loss/Take Profit โดยไม่ต้องรอ Candle, ข่าว หรือ LLM สร้างได้เฉพาะคำสั่งออกและการลดสถานะ |
| Database Health Monitor | ตรวจ Heartbeat จากฐานข้อมูลแยกจาก HTTP Worker เปิด Incident และล็อกการเปิดสถานะใหม่เมื่อระบบไม่พร้อม |
| Docker Supervisor | ตรวจความคืบหน้าจริง หากงานไม่เดินเกิน 120 วินาทีให้ Process ออกเพื่อให้ Docker Restart ตามนโยบาย |
| LLM Advisory | เชื่อม Workers AI รุ่น `@cf/aisingapore/gemma-sea-lion-v4-27b-it` เพื่อสรุปข่าวและบริบทตลาดเป็นภาษาไทย |
| Paper Evidence | แสดงจำนวนจุดข้อมูล ระยะเวลาที่สังเกตจริง และช่องว่างระหว่าง Snapshot ไม่สรุปว่าเดินครบ 7 วันก่อนเวลาจริง |

LLM รับเฉพาะหัวข่าว วันเผยแพร่ แหล่งข่าว และคะแนน/ภาวะตลาดสาธารณะ ไม่รับยอดเงิน ผู้ใช้ API Key หรือ Secret ผลลัพธ์ไม่มีสิทธิ์ซื้อขายและไม่มีสิทธิ์เปลี่ยนความเสี่ยง การคำนวณคำสั่งเกิดจากกฎเดิมก่อนเรียก LLM

จำกัดการเรียก LLM หนึ่งครั้งต่อชั่วโมง สูงสุด 24 ครั้งต่อวัน UTC ใช้ Cache ร่วมกัน และกำหนด Output ไม่เกิน 220 Tokens เมื่อเรียกไม่ได้จะแสดงสถานะ ไม่แต่งผลวิเคราะห์ขึ้นมา

## สถานะที่ติดตั้งจริง

Supabase ติดตั้ง Backend รุ่นใหม่แล้ว รวมตาราง Operational Monitor, Incident, Market Feed และ AI Budget เพิ่มจากตารางเดิม งาน Paper เดิมยังเดินและไม่ล้างประวัติ

ปัจจุบันมี Cron แยกสำหรับ Strategy, Risk Watchdog และ Database Health Monitor ทุกนาที จึงไม่พึ่งหน้าจอผู้ใช้ งาน Risk เป็นคนละ Invocation จาก Scanner

Worker `rea-bitkub-advisor` เชื่อม AI Binding และทดสอบผ่านจาก Backend จริงแล้ว โดยได้ข้อความสรุปภาษาไทยที่ระบุ `canTrade=false` และ `canChangeLimits=false` Token ระหว่าง Backend อยู่ใน Vault และ Worker Secret ไม่อยู่ใน Source

Docker ประกอบด้วย 4 Process แยก: `market-data`, `strategy-worker`, `risk-watchdog`, `health-monitor` เมื่อรันบน Host แล้ว Collector และ Watchdog มีรอบเป้าหมายทุก 5 วินาที ขณะที่ระบบที่ติดตั้งอยู่บน Supabase ยังเป็นรอบทุกนาที

ยังไม่มี VPS/Container Host เชื่อมต่อ จึงยังไม่ได้อ้างว่าชุด Docker กำลังทำงาน 24 ชั่วโมงบนเครื่องปลายทาง การเปิดใช้ Host ต้องตรวจ Public WebSocket, Secret Mount, เวลาเครื่อง และหยุด Cron สำรองตามคู่มือ

## การป้องกันคำสั่งซ้ำและ Safe Mode

- Strategy ใช้ Lease และ Revision เดิม
- Watchdog ใช้ Compare-and-swap Revision และบันทึกใน Transaction ถ้าสถานะเปลี่ยนระหว่างคำนวณจะไม่บันทึกทับ
- Watchdog ไม่เพิ่มคำสั่งซื้อหรือเพิ่มจำนวนที่ถือ และไม่เลื่อนกำหนดรอบ Scanner จนงาน Scanner ไม่ได้ทำงาน
- มี Lease แยกต่อ Service ป้องกัน Collector หลายตัวเขียนข้อมูลสลับกัน
- Incident ซ้ำถูกจัดเป็นรายการเดียว เมื่อสุขภาพระบบฟื้นจะปิด Incident พร้อมบันทึกประวัติ
- Operational Lock ปิดการเปิดใหม่ทั้งในโค้ดและฐานข้อมูล แต่ไม่ปลด Daily Loss Lock หรือ Emergency Stop ของเจ้าของ
- ทุกทางส่งคำสั่งเงินจริงยังถูกล็อกใน Backend

## หลักฐานและข้อจำกัด

ทดสอบตรรกะในเครื่องผ่าน 190 รายการ และทดสอบ PostgreSQL จริงแบบ Rollback สำหรับ Lease, Incident, Stale Revision, การบันทึกซ้ำ และสิทธิ์ข้อมูลภายในผ่านแล้ว

การตรวจ Docker Build, Container Runtime, Public WebSocket และหน้าเว็บรอบนี้อยู่ใน GitHub Actions ให้ดูผล Run ของ Commit ล่าสุด ไม่ใช้การทดสอบ Parser กับ Mock เป็นหลักฐานว่ารับ WebSocket จริงได้

ยังต้องตรวจการทำงาน Docker บน Host จริงต่อเนื่องอย่างน้อย 7 วัน, การแจ้งเตือนถึงอุปกรณ์ของเจ้าของ และ Security Review ขั้นสุดท้าย ก่อนพิจารณา Live ไม่มีการเปิดซื้อขายเงินจริงหรือเปิดแผนบริการใหม่ในงานส่วนนี้

## ติดตั้ง Docker

1. ใช้ Schema เดิม แล้วติดตั้ง `rea_operations_v2.sql`, `rea_advisory_v2.sql`, `rea_operations_view_v2.sql`, และ `rea_risk_scheduler_v2.sql` ตามลำดับ สำหรับฐานข้อมูลปัจจุบันติดตั้งไว้แล้ว
2. เก็บ Supabase Service Role Key ที่ `.secrets/rea-supabase-service-key` ผ่าน Secret Manager ของ Host
3. รัน `docker compose -f compose.rea.yaml up -d --build`
4. ตรวจ Health ที่ `127.0.0.1:8080` ถึง `8083` เส้นทาง `/health`
5. เมื่อ Host ตรวจผ่านแล้ว หยุด Cron `rea-paper-minute` และ `rea-risk-minute` เพื่อใช้ Docker เป็นตัวประมวลผลหลัก ส่วน Database Monitor คงอยู่ได้

รุ่นนี้ไม่มี Bitkub Credential ใน Container และไม่มีการเปลี่ยนระบบส่วนอื่นนอกโครงการ Bitbot
