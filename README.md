# Bitbot Virtual Trading Office v6.1

[ทดลองใช้งานเว็บไซต์ Bitbot](https://keitaphotocamerakathu-sudo.github.io/bitbot-virtual-office/)

**สถานะ:** PAPER TRADING ONLY • NO REAL ORDERS • RULE-BASED AGENTS (not an ML model).

## วิธีใช้งาน

1. เปิดเว็บ แล้วเลือกสถานการณ์ตลาดและกด **เริ่มจำลอง** หรือ **ดูบอตซื้อ–ขาย 1 รอบ**
2. ดูสถานะ BUY/SELL/HOLD, กำไรขาดทุน, ยอดพอร์ตและรายละเอียด Agent
3. เปิด **🧠 บอตจดจำอะไรจากการเทรด?** แล้วกด **ทดสอบตลาดยาก 90 รอบ**
4. การทดลอง 90 รอบประกอบด้วยตลาด 5 แบบ × เมล็ดสุ่มใหม่ 3 ชุด × กลยุทธ์ 3 แบบ × ต้นทุน 2 แบบ ทุกครั้งมีรหัสชุดข้อมูลและการตรวจความเสี่ยง
5. ดูบทเรียน และกด **สำรองบทเรียน JSON** เพื่อเก็บข้อมูลก่อนล้างเบราว์เซอร์
6. การทดสอบและประวัติที่เครื่องนี้จะถูกเก็บใน **IndexedDB** ของเบราว์เซอร์

## Trading Memory — 2 ชั้น

- **IndexedDB (พร้อมใช้):** บันทึกการตัดสินใจแต่ละแท่งเทียน คำสั่งจำลอง บทเรียนและรอบการทดสอบ โดยอยู่ในเครื่องและเบราว์เซอร์ที่ใช้เท่านั้น
- **Supabase Cloud (สร้างแล้ว):** ใช้โปรเจกต์แยก `lrxrigimdaedfemqheug` ในบัญชี Keitaphotocamera · เปิด RLS ทั้ง 3 ตารางแล้ว · บนเว็บลงชื่อเข้าใช้ด้วยอีเมลเพื่อสำรองบทเรียนอัตโนมัติขณะหน้าเว็บเปิดและออนไลน์ รวมถึงสำรอง/กู้คืนด้วยตนเองได้

ห้ามใช้โปรเจกต์ RESTART หรือสหกรณ์เพื่อแยกความเสี่ยงและบัญชีผู้ใช้งาน การเชื่อมผ่าน Data API ใช้เฉพาะ publishable key + Row Level Security (RLS) แบบ user_id = auth.uid().

### ตั้งค่า Auth อีก 1 ขั้นตอนเพื่อเข้าใช้ Cloud Sync

1. โปรเจกต์ Supabase แยกสำหรับ Bitbot สร้างสำเร็จแล้ว: [Bitbot Paper Trading Memory](https://supabase.com/dashboard/project/lrxrigimdaedfemqheug)
2. ตาราง `bitbot_paper_runs`, `bitbot_paper_journal`, `bitbot_paper_lessons` สร้างแล้ว; RLS เปิดทุกตาราง และ `anon` ไม่มีสิทธิ์ SELECT/INSERT; Supabase security advisors ไม่พบรายการเตือนในการตรวจครั้งแรก
3. **ผู้ดูแลต้องตั้งค่า Auth → URL Configuration ที่ [หน้านี้](https://supabase.com/dashboard/project/lrxrigimdaedfemqheug/auth/url-configuration):**
   - Site URL = `https://keitaphotocamerakathu-sudo.github.io/bitbot-virtual-office/`
   - Redirect URLs เพิ่ม `https://keitaphotocamerakathu-sudo.github.io/bitbot-virtual-office/`
   - ตรวจว่า Email Auth เปิดอยู่ใน Authentication → Providers
4. เปิด Bitbot แล้วขยายเมนู **☁️ สำรองประวัติข้ามอุปกรณ์**, กรอกอีเมล กดส่งลิงก์ เข้าใช้งานจากอีเมลให้เสร็จบนเว็บไซต์เดิม
5. เมื่อเข้าสู่ระบบแล้วหน้าเว็บจะสำรองบทเรียนอัตโนมัติหลังคำสั่ง/รอบทดสอบ หรือเมื่อกลับมาออนไลน์ **เฉพาะตอนเปิดหน้าเว็บ** รวมถึงกดสำรองด้วยตนเองได้
6. ใช้ปุ่มดึงบทเรียนจาก Cloud เพื่อกู้คืนในเครื่องใหม่; ทุกข้อมูลแยกตาม user_id ด้วย RLS และยังมี JSON Backup เผื่อฉุกเฉิน

> การล็อกอินผ่านอีเมลและบันทึกจริงจากเบราว์เซอร์ยังไม่ผ่านการยืนยันแบบ end-to-end ก่อนผู้ดูแลตั้ง Auth redirect เสร็จ การสร้างโปรเจกต์และตรวจ RLS ในฐานข้อมูลผ่านแล้ว ไม่ได้ทดสอบการเข้าใช้ด้วยบัญชีจริงของผู้ใช้

## สิ่งที่ยังไม่ใช่

- ไม่ใช่โมเดล AI ที่เรียนรู้ด้วยการปรับน้ำหนักโมเดลหรือปรับกลยุทธ์อัตโนมัติ: ระบบสรุปหลักฐานย้อนหลังและเสนอการทดลองเท่านั้น
- ไม่ใช่ราคา Bitkub แบบสด: ทดสอบจากข้อมูลสังเคราะห์/CSV ที่เลือกเอง ไม่เชื่อมกระดานซื้อขายจริง
- ไม่รันต่อเมื่อปิดแท็บ ไม่ใช่ Trading Bot ตลอด 24 ชม.
- ไม่รับประกันกำไร: กลยุทธ์อาจไม่มีคำสั่งซื้อเลยในบางตลาด

## การทดสอบ

- `node tests/stress-core.test.cjs` — ตรวจ Paper Simulator 90 ชุดจริงจาก engine เดียวกับบนเว็บ
- `node --check bitbot-v6-learning.js` และสคริปต์อื่น — ตรวจไวยากรณ์
- การทดสอบ UI ด้วย Chromium/IndexedDB จากสภาพแวดล้อมสร้างไฟล์ **ยังถูกบล็อก** ต้องทดสอบจากเบราว์เซอร์จริงบนเว็บไซต์เพิ่มเติม

## ประวัติเวอร์ชัน

- v3 สำรอง: `backup-v3-before-learning-v4`
- v4 สำรอง: `backup-v4-before-simple-ui-v5`
- v5 สำรองก่อนเผยแพร่ v6: `backup-v5-before-learning-v6`

มีเฉพาะการจำลอง ไม่เชื่อม Bitkub API Key หรือทำคำสั่งซื้อขายเงินจริง