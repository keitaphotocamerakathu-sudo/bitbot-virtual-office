# ติดตั้งและใช้งาน REA Paper

## ดูข้อมูลและควบคุม

เปิด `rea.html` จากเว็บไซต์ Bitbot เดิม เข้าสู่ระบบด้วยบัญชีเดิม และกลับมาเปิดหน้า REA ไม่ต้องกรอก Bitkub Key เพื่อทดลอง ระบบเตรียมพอร์ตแยกให้บัญชีบอทเดิมที่พบระหว่างการติดตั้งเท่านั้น

Overview แสดงทุนจำลอง เงินจอง และการใช้วงเงินขาดทุน Market Scanner แสดงเหตุผลการรอ Orders & Positions แสดงคำสั่งจำลอง Profit Analytics แสดงผลสุทธิและขอบเขตข้อมูล Agent Monitor แสดงผลที่ Backend บันทึก และ Safety ใช้ควบคุมระบบ

ปุ่มทำงานต่อไม่ล้าง Daily Loss Lock และไม่ปลด Emergency Stop ต้องปลดหยุดฉุกเฉินแยกต่างหาก ไม่มีปุ่มหรือค่าแวดล้อมที่เปิดเงินจริงในรุ่นนี้

## Paper บน Backend ที่มีอยู่

ฐานข้อมูลโครงการ Bitbot `lrxrigimdaedfemqheug` ใช้ตารางแยก schema `rea` และ Cron `rea-paper-minute` เรียกทุกนาที การปิดคอมหรือหน้าเว็บไม่หยุด Cron ตัวนี้

หาก Heartbeat เก่าเกิน 3 นาที หน้าเว็บแสดงสถานะขาดการติดต่อ ไม่ถือว่าการเปิดหน้าเว็บแปลว่า Backend กำลังทำงาน ตรวจ `last_error`, เหตุการณ์ `risk_events`, Agent Decisions และรอบ Cron ก่อนเริ่มใหม่

## เตรียม VPS / Container Host

ต้องมี Docker Engine พร้อม Compose, การออกอินเทอร์เน็ตไปยัง Supabase/Bitkub/แหล่งข่าว, เวลาเครื่องที่ตรง และระบบเฝ้าระวังที่ผู้ดูแลรับการแจ้งเตือนได้ ในการส่งมอบครั้งนี้ยังไม่ได้ผูก VPS จึงยังไม่ถือว่าผ่าน Operational Verification

1. Clone Repository ที่มี `compose.rea.yaml`
2. สร้าง `.secrets/rea-supabase-service-key` แล้วใส่ Backend Service Role Key ของโครงการ Bitbot ผ่าน Secret Manager ของ Host ไฟล์นี้ถูกกันจาก Git และ Docker Build Context
3. ตรวจค่า `SUPABASE_URL` ใน Compose ให้เป็นโครงการ Bitbot เท่านั้น ห้ามใช้โครงการสหกรณ์หรือ Restart
4. รัน `docker compose -f compose.rea.yaml up -d --build`
5. ตรวจ `docker compose -f compose.rea.yaml logs --tail=100` และ `http://127.0.0.1:8080/health`
6. เมื่อพิสูจน์ว่า VPS ทำงานต่อเนื่องแล้ว ให้หยุด Cron สำรองด้วย `select cron.unschedule('rea-paper-minute');` ไม่ต้องเปิด Executor พร้อมกันถาวร แม้ฐานข้อมูลจะป้องกันการจับงานซ้ำอยู่
7. หากต้องย้อนกลับ ให้ใช้ `select cron.schedule('rea-paper-minute','* * * * *','select bitbot_private.rea_schedule()');` หลังตรวจว่าไม่มีชื่อ Job นี้อยู่แล้ว

ไม่มี Bitkub API Secret ใน Container นี้ เพราะเป็น Paper เท่านั้น อย่าเพิ่มสิทธิ์ถอนหรือวาง Secret ในหน้าเว็บ/Repository

## ทดสอบ

`npm test` รันทดสอบเชิงตรรกะ

`npm ci` และ `PLAYWRIGHT_CHROMIUM_EXECUTABLE=/path/to/chromium npm run test:ui` รันทดสอบ Browser บนเครื่องที่เปิด Chromium ได้

`tests/rea-database.sql` เป็นชุดตรวจฐานข้อมูลแบบ Rollback ต้องมีบัญชี Paper ที่เตรียมไว้ก่อน

`node research/rea-backtest.mjs archived-snapshots.json` Replay ข้อมูล Snapshot ตามลำดับเวลา ต้องใช้ราคาและ Order Book ที่บันทึกในเวลานั้นจริง เครื่องมือไม่สร้าง Order Book ย้อนหลังจาก OHLC และจะปฏิเสธ Quote จากอนาคต

หลังติดตั้งต้องติดตาม Paper อย่างน้อย 7 วันและเก็บหลักฐาน ไม่สรุปว่าผ่าน 7 วันจากการรันทดสอบเร็วหรือ Backtest
