# Bitbot Virtual Trading Office

เว็บไซต์จำลองสำนักงาน AI Multi-Agent สำหรับ Bitcoin/THB (Bitkub) พร้อมอวตาร 5 ตัวที่เคลื่อนไหวและคลิกดูรายละเอียดได้

**[เปิดเว็บไซต์](https://keitaphotocamerakathu-sudo.github.io/bitbot-virtual-office/)**

## โหมดการใช้งาน

- **GitHub Pages:** เว็บไซต์ตัวอย่างแบบเคลื่อนไหว 2.5D และข้อมูลพอร์ต/ราคา/สัญญาณซื้อขายที่สร้างขึ้นเพื่อสาธิตเท่านั้น
- **Paper Trading Bot บนเครื่อง:** สามารถใช้เว็บ Office จากโปรเจกต์ Python v3 โดยเปิดเซิร์ฟเวอร์ภายในเครื่องเพื่ออ่านสถานะพอร์ตจำลองจาก SQLite
- เว็บไซต์ที่เผยแพร่ **ไม่ได้** ใช้ API key, ไม่เชื่อมบัญชี Bitkub และไม่ส่งคำสั่งซื้อขายเงินจริง

## Multi-Agent Virtual Office

1. Coordinator — ประสานงานระหว่างเอเจนต์
2. Trend — วิเคราะห์แนวโน้มราคา
3. Risk — ตรวจสอบความเสี่ยง
4. Strategy — วางแผนและประเมินสัญญาณ
5. Execution — จำลองการจัดคำสั่ง

หน้าเว็บอยู่ในไฟล์ `index.html` แบบ standalone รวม HTML, CSS, JS ไว้ในไฟล์เดียว รองรับคอมพิวเตอร์และมือถือ

## เผยแพร่

ไฟล์ `.github/workflows/deploy-pages.yml` ใช้ GitHub Actions สำหรับเผยแพร่เว็บไซต์ อาจต้องเปิดที่ `Settings → Pages → Build and deployment → Source → GitHub Actions` ก่อนการ deploy ครั้งแรก

## ข้อจำกัด

ตัวละครเคลื่อนไหวด้วย CSS/JavaScript แบบ 2.5D ไม่ใช่โมเดล 3D ที่เดินได้อย่างอิสระ ภาพและตัวเลขเป็นเดโม ไม่ใช่ราคาตลาดจริงหรือผลตอบแทนที่เกิดขึ้นจริง
