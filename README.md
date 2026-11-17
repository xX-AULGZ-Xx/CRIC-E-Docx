# CRIC E-Docx — ระบบร่างเอกสารราชการออนไลน์ วิทยาลัยการอาชีพเชียงราย

ระบบร่าง ตรวจทานภาษาไทยราชการ พรีวิว PDF ด้วยฟอนต์มาตรฐาน (`TH SarabunIT๙` / `TH Sarabun New`) เสนอลงนามออนไลน์ และออกเลขสารบรรณอัตโนมัติ

## โครงสร้างโปรเจกต์
- `backend/` — Python FastAPI + เครื่องมือสร้างและตรวจ `.docx` + แปลง PDF (LibreOffice / Word)
- `frontend/` — Next.js 15 App Router + TypeScript + Tailwind CSS
- `db/init.sql` — PostgreSQL Schema & Seed Data
- `docker-compose.yml` — รันระบบทั้งหมด (PostgreSQL + FastAPI/LibreOffice + Next.js)

## การรันแบบ Development (Windows)
1. **Backend (Terminal 1):**
   ```powershell
   cd backend
   .\.venv\Scripts\python.exe -m uvicorn app.main:app --reload --port 8000
   ```
2. **Frontend (Terminal 2):**
   ```powershell
   cd frontend
   npm install
   npm run dev
   ```
3. เปิดเบราว์เซอร์ที่ `http://localhost:3000`

## การรันผ่าน Docker Compose (Production / Linux Server)
```powershell
copy .env.example .env
docker compose up -d --build
```
