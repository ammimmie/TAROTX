# TAROTX — PUBLIC READY

เวอร์ชันนี้สร้างมาสำหรับนำขึ้น Static Hosting เช่น GitHub Pages หรือ Cloudflare Pages โดยตรง

## สิ่งที่อยู่ใน Public Build

- หน้าเว็บ TAROTX
- Final deterministic Reading Engine ที่ทำงานใน browser
- Reading specification และ card signal map ที่จำเป็นต่อคำทำนาย
- Artwork/runtime assets ที่จำเป็น

## สิ่งที่ถูกตัดออก

- Node server / API server
- Calibration Lab
- Approve / Reject / Import / Export calibration endpoints
- Golden tests / benchmark / developer reports
- ไฟล์ local launcher สำหรับ Mac

ไม่มี API key, password หรือ secret ใด ๆ ที่ต้องตั้งค่า

## Deploy บน GitHub Pages

1. สร้าง GitHub repository ใหม่ เช่น `tarotx` และเลือก Public
2. อัปโหลด **ไฟล์ภายในโฟลเดอร์นี้ทั้งหมด** ไปที่ root ของ repository (อย่าอัปโหลด ZIP เป็นไฟล์เดียว)
3. ไปที่ `Settings` → `Pages`
4. Build and deployment → Source เลือก `Deploy from a branch`
5. Branch เลือก `main` และ Folder เลือก `/ (root)`
6. กด Save และรอ GitHub สร้างลิงก์

ลิงก์โดยทั่วไปจะเป็น `https://USERNAME.github.io/REPOSITORY/`

## หมายเหตุ

รูปหน้าไพ่ Rider–Waite–Smith ในหน้าเว็บอ้างอิง URL จาก Wikimedia Commons และมี fallback artwork หากรูปภายนอกโหลดไม่ได้ ส่วน Google Fonts โหลดจาก Google Fonts; ไม่มีไฟล์ฟอนต์ถูกบันเดิลในแพ็กเกจนี้

Public Build ไม่มีระบบเก็บข้อมูลผู้ใช้หรือ Calibration feedback ฝั่ง server
