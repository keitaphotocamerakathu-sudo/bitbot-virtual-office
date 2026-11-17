# REA 19.0 — Live Execution บน Bitkub

วันที่ 17 พฤศจิกายน 2569 · รุ่น Backend แอป 19.0.0

[เปิดหน้า Live Trading](https://keitaphotocamerakathu-sudo.github.io/bitbot-virtual-office/rea.html#live)

## ผลที่เปลี่ยน

รุ่นนี้มีเส้นทางส่งคำสั่ง Bitkub จริงที่แยกจากพอร์ต Paper บันทึกคำสั่งและสิทธิ์ส่งก่อนเรียก Exchange และสร้างสถานะถือครองจากผลจับคู่ที่ Exchange ยืนยันเท่านั้น ไม่ใช้ตัวจำลอง Fill และไม่ย้ายยอด Paper มาเป็นเงินจริง

| ส่วน | การทำงาน |
|---|---|
| Live Strategy | คัดเลือกคู่ THB ด้วยกฎกลยุทธ์และความเสี่ยงเดิม |
| Private API | ลงลายเซ็น HMAC ฝั่ง Backend ใช้ Key/Secret จาก Vault |
| Submit Gate | ตรวจสิทธิ์เจ้าของ Lease, Revision, เนื้อหาคำสั่ง, ด้านซื้อ/ขาย, ราคา, Wallet, โหมด และวงเงิน ก่อนส่งจริง |
| Exchange Receipts | อ่าน Order Info และประวัติแต่ละ Fill บันทึก Txn ID, จำนวน, ราคา, Fee และ Credit ใช้ซ้ำไม่ได้ |
| Partial Fill | ลงบัญชีส่วนที่จับคู่จริงได้ระหว่างที่คำสั่งยังค้าง |
| Unknown Order | ค้น Client ID ใน Open Orders และ History แบบ Cursor ก่อน ห้ามส่งคำสั่งเดิมซ้ำ |
| Cancel Pending | ยังจองเงินและช่องสถานะจน Exchange ยืนยัน ไม่ถือว่าขอยกเลิกเท่ากับยกเลิกสำเร็จ |
| Stop Loss | ตัวเฝ้าระวังแยกจาก Candle/News ใช้ Limit ตามปกติ และ Market Sell สำรองเมื่อเกิด Gap ตามกฎ |
| Frontend | หน้า Live แสดง Wallet, พอร์ตจริง, คำสั่ง, Exchange ID, Txn ID และเงื่อนไขตรวจรับแยกจาก Paper |

ใช้ทุนจริงที่เจ้าของเลือกไม่เกิน 10,000 บาท เสี่ยงต่อรายการ 1% ไม่เกิน 100 บาท สูงสุด 2 สถานะรวมซื้อค้าง วงเงินต่อสถานะ 4,000 บาท รวม 8,000 บาท และขาดทุนรายวัน 3% ไม่เกิน 300 บาท วงเงินลดตามทุนจริงเมื่อทุนต่ำกว่าฐาน

## งานบน Backend

ติดตั้ง Strategy Cron ทุกนาที และ Live Risk Watchdog เป้าหมายทุก 15 วินาทีบน Supabase แล้ว ไม่ต้องเปิดเว็บหรือรอ VPS เพื่อให้ชุดนี้ทำงาน Scanner ทำงานนอก Lease ส่งคำสั่ง เพื่อไม่ให้งาน Candle/News ที่ค้างกีดกันตัวตรวจจุดออก มี Cooldown 429 ที่เก็บในฐานข้อมูลอย่างน้อย 31 วินาที จึงยังคงมีผลเมื่อ Worker เปลี่ยนหรือ Restart รอบจริงขึ้นอยู่กับเครือข่าย Exchange และการกระทบยอด จึงไม่รับประกันว่าขาดทุนจะหยุดตรงวงเงินแบบจำลองเมื่อราคากระโดด

มีตาราง `rea.live_accounts`, `live_orders`, `live_fills`, `live_checks`, `live_heartbeats`, `live_equity` แยกจาก Paper ทุกตารางใช้ RLS และให้เฉพาะ Service Role เข้าถึง การอ่านของเจ้าของผ่าน Backend ที่ตรวจ JWT และกำหนด User ID จาก Token

## ผลตรวจการเชื่อมต่อจริง

Bitkub ปฏิเสธกุญแจที่เก็บไว้ โดย Wallet V4 ตอบ `401 / A1003-MK` และการอ่าน Open Orders V3 ตอบ `401 / 3` ยืนยันได้ว่าขัดข้องที่ Private API บัญชีจริง ยังอ่านยอดเงินบาทไม่ได้ จึงไม่แสดงยอดสมมติและยังไม่ส่งคำสั่งเงินจริง

เจ้าของต้องใส่ API Key/Secret ที่ใช้งานได้ในหน้า Live Trading ส่วน “เชื่อม Bitkub สำหรับบัญชีนี้” ระบบจะอ่าน Wallet เพื่อตรวจสอบก่อนบันทึกใน Vault ช่องข้อมูลจะถูกล้างหลังส่ง และไม่เก็บ Secret ใน Local Storage

ให้ตรวจสิทธิ์ Trade และปิด Withdraw ที่ Bitkub การอ่าน Wallet ผ่านเพียงอย่างเดียวไม่ยืนยันว่ามีสิทธิ์ Trade หรือไม่มีสิทธิ์ถอน จึงมีการตรวจสิทธิ์กุญแจแยกในกระบวนการตรวจรับ

## การเปิด Live

บัญชีใหม่เริ่ม `LIVE_LOCKED` โดยยังไม่จัดสรรทุน ระบบยังต้องตรวจหลักฐาน Paper จริงอย่างน้อย 7 วัน การกระทบยอด Security Review การตรวจสิทธิ์ถอน และการแจ้งเตือนถึงเจ้าของตาม SRS เดิม ก่อนเปิดใช้เงินจริง ต้องยืนยันบนบัญชีเจ้าของพร้อมพิมพ์ “เปิดซื้อขายจริง Bitkub” และวงเงิน Server ตรวจซ้ำก่อนคำสั่งซื้อทุกครั้ง

ผลตรวจสิทธิ์กุญแจและการกระทบยอดผูกกับ Fingerprint ของ API Key ชุดปัจจุบัน ผลของ Key เก่าจึงใช้ปลด Key ใหม่ไม่ได้ การพิมพ์ข้อความหรือเลือก Checkbox ไม่สามารถเปลี่ยนผลตรวจรับในฐานข้อมูลได้ และ LLM ไม่มีสิทธิ์เพิ่มวงเงินหรือเปิดโหมดนี้ เส้นทางส่งคำสั่งเก่ากับ Gateway เดิมยังล็อกไว้ เพื่อไม่ให้มี Executor สองชุดแข่งขันกัน

เมื่อ Emergency Stop จะหยุดการส่งคำสั่งทั้งหมด แต่คำสั่งที่ Bitkub รับไปแล้วอาจยังจับคู่ได้ ระบบยังอ่านผลเพื่อกระทบยอด ไม่รายงานว่าคำสั่งค้างถูกยกเลิกโดยไม่มีหลักฐาน

## การทดสอบ

ตรรกะ Backend ในเครื่องผ่าน 209 รายการ รวม Live Risk, Partial Fill, Fee Credit, การไม่ลงบัญชีจาก ACK, Unknown Order Recovery, การอนุมัติก่อน HMAC และการปฏิเสธสิทธิ์ก่อนเข้าถึง Exchange

PostgreSQL จริงผ่านการตรวจ Lease, Revision, การส่งซ้ำ, Emergency Stop, ด้านซื้อ/ขาย, เนื้อหา Wire Request และสิทธิ์เข้าถึง โดยใช้ Transaction Rollback ข้อมูลย้อนหลังและผลตรวจรับสังเคราะห์ใน Test ถูก Rollback ทั้งหมด ไม่มีการสร้างหลักฐาน Paper ปลอมหรือเปิด Live ค้างไว้

ผลตรวจของโค้ดเริ่มต้น [Run 44095256254](https://github.com/keitaphotocamerakathu-sudo/bitbot-virtual-office/actions/runs/44095256254) ผ่าน Backend 209 รายการ, Browser/Mobile 24 รายการ, Docker Build/Runtime, Compose, WebSocket จริง และ Public Backend Smoke Checks

ผลตรวจโค้ดสุดท้าย `b65e032a51dad7cde3e8ac0d71dfa09d53e75b98` อยู่ที่ [Run 44096511177](https://github.com/keitaphotocamerakathu-sudo/bitbot-virtual-office/actions/runs/44096511177) สถานะ: ผ่านครบและเผยแพร่แล้ว — Backend 209 รายการ, Browser/Mobile 24 รายการ, Docker Build/Runtime, Compose, Public WebSocket จริง และ Public Backend Smoke Checks

ทดสอบ PostgreSQL จริงเพิ่มเติมแล้วว่าเปลี่ยน Key จะใช้ผลตรวจ Key เก่าไม่ได้ และ Cooldown 429 คงอยู่หลังปล่อย Lease ทั้งสองกรณีผ่านแบบ Rollback

Backend ติดตั้งเป็น Edge Function Version 28 แล้ว ตรวจ Cron ล่าสุดสำเร็จทั้ง Strategy และ Watchdog เวลา 20:50 น. บัญชียังเป็น `LIVE_LOCKED`, ไม่จัดสรรทุน, Live Orders 0 และ Live Fills 0 รายการ ส่วน Live Orders ของระบบเดิมยังเป็น 4 รายการตามเดิม

ผลคำสั่งเงินจริงยังไม่ผ่านการตรวจรับ เพราะ Private API ปฏิเสธกุญแจปัจจุบัน ไม่มีรายการ Live ของ REA ที่อ้างเป็นผลจับคู่จริงในช่วงพัฒนานี้

เมื่อ Wallet ไม่ตรงกับทุน/เหรียญที่บอทบันทึก เช่น เจ้าของถอนหรือย้ายสินทรัพย์จนเงินค้ำวงเงินบอทไม่พอ ระบบจะล็อกเพื่อกระทบยอดจากหลักฐาน ไม่ถือส่วนต่างที่ไม่ทราบที่มาเป็นกำไร

Security Advisor หลังติดตั้งไม่มีข้อแจ้งเตือนใหม่จากตาราง Live ยังมีของเดิมคือ [`pg_net` ใน Public Schema](https://supabase.com/docs/guides/database/database-linter?lint=0014_extension_in_public) และ [ยังไม่เปิดตรวจรหัสผ่านที่เคยรั่ว](https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection) จึงยังไม่บันทึกว่าผ่าน Security Review ขั้นสุดท้าย

ผล Automated Execution/Recovery ถูกบันทึกที่ Server พร้อม Commit และ URL ของ Run ที่ผ่าน ส่วน Reconciliation Review, Security Review, No Withdraw Scope และ Owner Alert Delivery ยังไม่ได้ระบุว่าผ่าน การรับรองอัตโนมัติสองรายการไม่ปลด Live เอง
