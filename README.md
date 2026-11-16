# BITBOT 10 — Bitkub Multi-Agent Trading
ระบบใหม่หน้าเดียว: ทดลอง, เชื่อมบัญชี, ตั้งวงเงิน, ดูเหตุผล และตรวจประวัติ

เว็บไซต์: https://keitaphotocamerakathu-sudo.github.io/bitbot-virtual-office/

## เริ่มใช้งาน
1. ทดลอง: กด **เริ่มทดลองบอท** ใช้ราคาจริงจาก Bitkub และเงินจำลอง 100,000 บาท ไม่ต้องล็อกอิน ต้องเปิดหน้านี้ไว้
2. จริง: เลือก **เงินจริง** → สมัครชื่อผู้ใช้ (ไม่ส่งอีเมล) หรือใช้อีเมล/รหัสผ่านบัญชีเดิม → เชื่อม API Key/Secret → บันทึกทุนและวงเงิน → เริ่มบอทและยืนยัน
3. เก็บรหัสกู้บัญชีที่แสดงหลังสมัครไว้ส่วนตัว ใช้ตั้งรหัสใหม่ได้ครั้งเดียว แล้วระบบให้รหัสกู้ใหม่
4. บัญชีเดิมยังใช้ session และ API Key ที่เข้ารหัสไว้เดิมได้ บัญชีชื่อผู้ใช้ใหม่เป็นอีกบัญชีหนึ่งและต้องเชื่อมคีย์ของตนเอง

## ทีมทำงานจริง 5 บทบาท
| เอเจนต์ | หน้าที่ |
| --- | --- |
| Coordinator | ตรวจข้อมูลและประสานรอบ พร้อมบันทึกผล |
| Trend | EMA 9/21 และ RSI 14 จากแท่งปิด 5 นาที |
| Strategy | เลือก trend-pullback / breakout และจัดอันดับจากผลสุทธิ |
| Risk | ตรวจวงเงิน, exposure, daily loss, drawdown, spread, candle replay |
| Execution | สร้าง LIMIT, จองคำสั่งก่อนส่ง, ตรวจผลจริงและ partial fills |

ระบบเป็น quantitative multi-agent แยกการประเมินและผลลัพธ์ ไม่ใช่หลาย LLM และไม่อ้างว่าเป็นโมเดลที่ฝึกตัวเอง
ความจำกลยุทธ์ใช้การนับแพ้/ชนะหลังค่าธรรมเนียมด้วย prior แบบ Beta เพื่อจัดอันดับเท่านั้น ไม่รับรองกำไร

## ความหมายของปุ่ม
- **พักซื้อใหม่**: งดการซื้อ แต่ยังเฝ้าทางออกของสถานะ
- **หยุดบอท**: หยุดเปิดคำสั่งใหม่ และขอยกเลิกคำสั่งค้างในรอบเซิร์ฟเวอร์ถัดไป เหรียญที่ถือยังอยู่และต้องดูแลเอง
- **จบรอบ / เริ่มรอบใหม่**: ทดลองสามารถล้างสถานะจำลองโดยเก็บประวัติ จริงทำได้เมื่อหยุดบอท ไม่มีคำสั่งค้าง ไม่มี BTC ใน Wallet และทุน THB เพียงพอ ผลกำไรของธุรกรรมภายนอกไม่ถูกสมมติขึ้น
- **ตรวจเลขออร์เดอร์ค้าง**: ใส่เลขออร์เดอร์ Bitkub ได้เมื่อเกิด UNKNOWN เซิร์ฟเวอร์ตรวจ client_id ว่าตรงกับคำสั่งบัญชีนี้ก่อนรับข้อมูล

## การควบคุมความเสี่ยง
- BTC/THB spot, LIMIT เท่านั้น ไม่มี endpoint ถอนเงินหรือ proxy ตาม URL ผู้ใช้
- ปิดสิทธิ์ Withdraw ที่ Bitkub และใช้ Read + Trade เท่านั้น ระบบไม่สามารถพิสูจน์การตั้งสิทธิ์ของคีย์จาก wallet API ได้
- คีย์เข้ารหัสใน Supabase Vault ไม่มี secret ใน source, browser storage หรือผลตอบกลับ
- คำสั่งเงินจริงมี server cap: ต่อครั้ง 1,000 บาท, ซื้อ 5,000 บาท/วัน, ขาย 10,000 บาท/วัน ผู้ใช้ลดเพดานได้ ค่าเริ่มต้นต่อครั้ง 100, ซื้อ 300, ขาย 1,000 บาท/วัน
- เงินทุนจริงเริ่มตั้งค่า 1,000 บาท ถือ BTC ไม่เกิน 20% ของพอร์ต, SL 2%, TP 4%, daily loss 3%, max drawdown 10%
- ตรวจทุก 1 นาที สัญญาณจากแท่งปิด 5 นาที Stop Loss ไม่ใช่คำสั่งรับประกันราคา การจำกัดวงเงินขาย/ส่วนต่างราคา/ขั้นต่ำอาจทำให้ขายไม่ครบหรือขายช้า
- ซื้อใหม่ขั้นต่ำภายในระบบ 100 บาท ส่วนการขายใช้ขั้นต่ำ 10 บาทตาม Bitkub เพื่อให้ตัดขาดทุนของคำสั่งเล็กได้ ค่าธรรมเนียมซื้อหักจากจำนวนเงินบาทที่ใช้ และจำลองการปัดขึ้นเป็นสตางค์
- คำสั่งค้างเกิน 2 นาทีจะขอยกเลิก แล้วรอยืนยันผลและนำ partial fills มาคิดบัญชีครั้งเดียว
- เครือข่ายผิดพลาดหลังส่ง = UNKNOWN หยุดบอท ไม่ส่งซ้ำ ต้องตรวจผลจาก Bitkub
- lease ในฐานข้อมูลป้องกันหลาย worker ทำงานซ้อน และ server reserve ป้องกันการส่งซ้ำ
- ป้องกัน gateway รุ่นเดิมทำงานชนกับบอทใหม่
- ค่ากำไรจริงเป็นประมาณการจาก fill history และค่าธรรมเนียมหลังเครดิต ตรวจ Wallet และรายการ Bitkub เป็นหลัก
- ข้อมูลเก่าและคีย์เดิมไม่ถูกลบ แยกตาราง v10 และเก็บ backup branch ก่อนเปลี่ยน

## โครงสร้าง
- assets/engine.mjs — logic ที่ใช้ร่วมกันระหว่าง browser, server, tests
- assets/app.mjs, assets/style.css, index.html — เว็บ
- supabase/functions/bitbot-v10/index.ts — auth, keys, wallet, live execution, scheduler
- supabase/bitbot_v10.sql — ตาราง, RPC, lease, reservation, Vault scheduler, cron ทุกนาที
- tests/ — engine invariants, mocked server security, browser flows, public backend checks
- .github/workflows/deploy-pages.yml — ทดสอบก่อนเผยแพร่ เผยแพร่เฉพาะไฟล์เว็บ

## ดูแลระบบ
ใช้ Supabase project เดิม lrxrigimdaedfemqheug
Edge Function ใช้ SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY ที่ระบบจัดให้
BITBOT_LIVE_ENABLED=false เป็น emergency switch ปิดคำสั่งใหม่ แต่การตรวจและขอยกเลิกคำสั่งค้างยังทำงาน
กำหนด verify_jwt=false เนื่องจาก market/login เป็น public; ทุก private action ตรวจ JWT กับ Supabase Auth ก่อนเสมอ
Cron ใช้ token สุ่มใน Vault เท่านั้น ไม่ใช่ bearer ของผู้ใช้ ไม่มี task เริ่มเทรดใครโดยอัตโนมัติหลังติดตั้ง
หาก Bitkub ตั้ง IP whitelist ต้องอนุญาต IP ออกจาก backend ที่ใช้จริง การตรวจ Wallet จะแสดงข้อผิดพลาดเมื่อคีย์/สิทธิ์/IP ไม่ตรง

## ตรวจสอบ
npm test
npm install --ignore-scripts
npx playwright install --with-deps chromium
npm run test:ui
node tests/backend-smoke.mjs

Browser tests ใช้ราคาจำลองที่ระบุชัดและจำลองการเชื่อมต่อสำหรับ QA เท่านั้น เว็บใช้งานจริงไม่มี fallback ราคาปลอม
Smoke tests เรียก health, public market, และตรวจ 401 ของ private/scheduler เท่านั้น ไม่ส่งคำสั่งซื้อขาย
การผ่าน tests ไม่ทดแทนการยืนยัน API ของเจ้าของบัญชีและการทดสอบการจับคู่เงินจริงที่ Bitkub
