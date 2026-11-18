# REA 21.0 — Codex วิเคราะห์พอร์ต

เพิ่ม OpenAI managed Codex harness ผ่าน Agents API ด้วยโมเดล `gpt-6.1-sol` แยกจาก SEA-LION ที่สรุปข่าวเดิม ไม่ใช่การติดตั้งบัญชี ChatGPT หรือคัดลอกผู้ช่วยในบทสนทนาเข้าเว็บ

## เริ่มใช้งาน

เปิด `rea.html#codex` ด้วยบัญชี Bitbot ของเจ้าของ ใส่ OpenAI API Key ในแบบฟอร์ม ยืนยันการส่งข้อมูลตลาดและตัวเลขพอร์ตพร้อมค่า API แล้วบันทึก Key ถูกตรวจด้วยการอ่านข้อมูลโมเดลและ Agents API ก่อนเก็บใน Supabase Vault การตรวจเบื้องต้นยังไม่รับรองสิทธิ์สร้าง Session จนการวิเคราะห์ครั้งแรกสำเร็จ

Key ต้องเข้าถึง `gpt-6.1-sol` และมีสิทธิ์ `api.agents.read`, `api.agents.write`, `api.responses.write` หากบัญชีหรือโปรเจกต์ยังเข้าถึง Agents API ไม่ได้ หน้าเว็บแสดงรหัสข้อผิดพลาดโดยไม่เปลี่ยนไปใช้โมเดลอื่นเงียบ ๆ

กด “วิเคราะห์พอร์ตตอนนี้” ให้ Backend เข้าคิวและประมวลผลแม้ปิดหน้าเว็บ มีตัวเลือกอัตโนมัติทุก 180 นาที ซึ่งปิดไว้เริ่มต้น จำกัดคำขอที่จองไว้ 8 ครั้ง/วัน Asia/Bangkok และเว้นคำขออย่างน้อย 5 นาที เพดานนี้ไม่ใช่เพดานค่าใช้จ่ายเป็นบาท ค่า API คิดแยกจาก ChatGPT ควรตรวจงบและการใช้งานที่ OpenAI

## ข้อมูลและสิทธิ์

ส่งเฉพาะข้อมูลที่เลือกไว้: ตัวเลขพอร์ต เหรียญที่ถือ จุด Stop/เป้าหมาย ผลสแกน/อินดิเคเตอร์ ราคาที่บันทึก และสรุปข่าวรอง ไม่ส่ง Bitkub API Key/Secret, ชื่อ/อีเมลผู้ใช้, UID, รหัสคำสั่งจริง หรือประวัติแชต Key ของ OpenAI ไม่อยู่ในบริบทโมเดล ไม่อยู่ใน localStorage และไม่ถูกส่งคืนจาก API

Codex มี environment `none`, tools ว่าง และปิด multi-agent ไม่มีสิทธิ์เรียก Exchange หรือแก้ค่าความเสี่ยง ผลเป็น WATCH/HOLD/REVIEW_ENTRY/REVIEW_EXIT พร้อม evidenceId ของเหรียญที่อยู่ใน Snapshot เท่านั้น ยังไม่ใช้คำตอบ Codex เป็นสัญญาณส่งคำสั่งจริง กลยุทธ์เชิงตัวเลขและ Risk Manager เดิมยังควบคุมการเทรด

## ความน่าเชื่อถือและการกู้คืน

- เก็บงานและ Lease ก่อนสร้าง Session เพียงครั้งเดียว บันทึก Session ID ก่อน polling
- หากผลสร้างไม่แน่นอน ล็อก UNKNOWN ไม่ส่งสร้างซ้ำหลัง Restart เจ้าของต้องตรวจ OpenAI และยืนยันก่อนเริ่มคำขอใหม่
- ต้องมี root turn completed และ assistant final_answer ที่ผูก turn เดียวกันจึงรับผลได้ Session idle เพียงอย่างเดียวไม่ถือว่าสำเร็จ
- ตรวจ JSON, รุ่นโมเดล, เหรียญ, หลักฐาน และขนาดผล คำตอบที่ข้อมูลเก่าไม่อนุญาตให้เสนอ REVIEW_ENTRY/REVIEW_EXIT
- พยายามยกเลิกงานที่ยังไม่จบหลัง 5 นาที หรือเมื่อถอนความยินยอม การยกเลิกไม่รับประกันค่าใช้จ่ายคงที่ หาก Provider ติดต่อไม่ได้ยังคงล็อกคำขอนั้น
- ตัวเฝ้า Stop Loss และ Live executor เดิมไม่รอผล Codex ตารางและ Cron นี้ไม่มีสิทธิ์เปลี่ยนวงเงินหรืออนุมัติ Live
- บันทึกเวลา รุ่นโมเดล Session/Turn ID หลักฐาน ผล และโควตาเพื่อย้อนตรวจ ไม่แสดงคำตอบจำลองเป็นผลจริง

## การติดตั้งและตรวจ

SQL: `supabase/rea_codex_brain_v5.sql` และแพตช์ตรวจความยาว Key `supabase/rea_codex_key_validation_v5.sql` ติดตั้งด้วย migration เฉพาะโปรเจกต์ Bitbot ตาราง RLS และ RPC เปิดเฉพาะ service_role

Edge: เพิ่ม `rea-codex.mjs` ใน `bitbot-v10` ตัวขับ `rea-codex-run` ใช้ Vault runner token เดิม Cron ทุกนาทีจะไม่เรียก Provider หากไม่มี Key + consent + งานที่ถึงกำหนด Endpoint ของผู้ใช้ตรวจ JWT และใช้ UID จาก Server เท่านั้น

ทดสอบด้วย `npm test`, Browser/Mobile CI และ `tests/rea-codex-database.sql` แบบ transaction rollback (สร้างผู้ใช้/Key สังเคราะห์ชั่วคราว ไม่เรียก HTTP หรือส่งคำสั่งเทรด) การทดสอบกับ OpenAI จริงต้องใช้ Key ที่เจ้าของเชื่อมพร้อม consent แล้ว จึงยังไม่อ้างว่า inference สำเร็จก่อนมีผล Session จริง

เอกสาร: https://developers.openai.com/api/docs/guides/agents-api/overview.md และ https://developers.openai.com/api/docs/guides/agents-api/quickstart.md

## แพตช์ 21.0.1 — บันทึก Key แล้วไม่เกิดผล

พบคำขอ rea-codex-config ตอบ 502 เพราะ RPC ของ Backend ตอบ 403 จากการขาด USAGE ของ service_role บน schema bitbot_private แม้มี EXECUTE บนฟังก์ชันแล้ว เพิ่มสิทธิ์เฉพาะ service_role ด้วย rea_codex_backend_access_v5.sql โดย anon/authenticated ยังไม่มีสิทธิ์เข้า schema

เพิ่มการทดสอบ tests/rea-codex-backend-role.sql ด้วย SET LOCAL ROLE service_role: บันทึก Key สังเคราะห์ เข้า Queue, Claim, โหลด Key และ Checkpoint แล้ว rollback ทั้งหมด ไม่เรียก Provider หรือ Exchange

หน้าเว็บเก็บข้อความข้อผิดพลาดไว้แม้มีการอัปเดตสถานะอัตโนมัติ แจ้งขั้นตอนถัดไปหลังบันทึก Key และรองรับ Enter เพื่อบันทึก คำขอวิเคราะห์ยังต้องมี consent และคำสั่งจากเจ้าของหรือการเปิดอัตโนมัติ
