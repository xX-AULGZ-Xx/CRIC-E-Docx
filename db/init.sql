-- CRIC E-Docx Database Schema (PostgreSQL 16+)

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- 1. ผู้ใช้งานและลายเซ็น (รองรับ sso.cric.ac.th และ Sync จาก panel.cric.ac.th)
CREATE TABLE IF NOT EXISTS users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  sso_subject TEXT UNIQUE,
  panel_user_id TEXT UNIQUE,
  username TEXT UNIQUE,
  email TEXT UNIQUE,
  full_name TEXT NOT NULL,
  position_title TEXT NOT NULL,
  division_code TEXT DEFAULT '',
  unit_name TEXT DEFAULT '',
  phone TEXT DEFAULT '',
  default_reviewer_email TEXT DEFAULT '',
  role TEXT NOT NULL DEFAULT 'drafter', -- drafter | unit_head | deputy_director | director | saraban_admin
  signature_storage_path TEXT DEFAULT '',
  avatar_url TEXT DEFAULT '',
  is_active BOOLEAN NOT NULL DEFAULT true,
  synced_at TIMESTAMPTZ DEFAULT now()
);

-- 2. เอกสารร่างและฉบับจริง
CREATE TABLE IF NOT EXISTS documents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  doc_type TEXT NOT NULL,               -- memo | order | external | announcement | agenda | minutes
  division_code TEXT DEFAULT '',
  doc_number TEXT DEFAULT '',
  is_circular BOOLEAN NOT NULL DEFAULT false,
  speed_level TEXT DEFAULT '',
  secrecy_level TEXT DEFAULT '',
  font_family TEXT NOT NULL DEFAULT 'TH Sarabun New',
  subject TEXT NOT NULL,
  payload_json JSONB NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft', -- draft | pending_review | needs_revision | pending_approval | approved | numbered | archived
  docx_path TEXT DEFAULT '',
  pdf_path TEXT DEFAULT '',
  created_by TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 3. ลำดับขั้นการเสนอตรวจ-อนุมัติ
CREATE TABLE IF NOT EXISTS approval_steps (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id UUID NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  step_order INT NOT NULL,
  assignee_email TEXT NOT NULL,
  assignee_role TEXT NOT NULL,
  action TEXT NOT NULL DEFAULT 'pending', -- pending | approved | rejected | returned
  comment TEXT DEFAULT '',
  acted_at TIMESTAMPTZ
);

-- 4. ตัวรันเลขสารบรรณป้องกันเลขซ้ำ (ตั้งค่าได้โดยเจ้าหน้าที่)
CREATE TABLE IF NOT EXISTS number_sequences (
  id SERIAL PRIMARY KEY,
  registry_key TEXT NOT NULL,
  registry_name TEXT NOT NULL,
  prefix TEXT NOT NULL DEFAULT '',
  year_be INT NOT NULL,
  last_number INT NOT NULL DEFAULT 0,
  updated_by TEXT DEFAULT 'system',
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (registry_key, year_be)
);

-- 5. การตั้งค่าระบบ (AI Provider และค่าเริ่มต้นฟอนต์)
CREATE TABLE IF NOT EXISTS system_settings (
  key TEXT PRIMARY KEY,
  value_json JSONB NOT NULL,
  updated_by TEXT DEFAULT 'system',
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 6. ประวัติการใช้งาน (Audit Log)
CREATE TABLE IF NOT EXISTS audit_logs (
  id BIGSERIAL PRIMARY KEY,
  document_id UUID REFERENCES documents(id) ON DELETE CASCADE,
  actor_email TEXT NOT NULL,
  event_type TEXT NOT NULL,
  metadata JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 7. คลังรายวิชาสำหรับแผนการสอนและรายงานหลังการสอน (เริ่มจากฐานข้อมูลว่าง)
CREATE TABLE IF NOT EXISTS courses (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  course_code TEXT NOT NULL,
  course_name TEXT NOT NULL,
  curriculum_level TEXT DEFAULT 'ปวช.',
  credits TEXT DEFAULT '1-3-2 (2 หน่วยกิต 4 ชั่วโมง)',
  semester TEXT DEFAULT '2/2569',
  schedule_text TEXT DEFAULT '',
  prerequisite TEXT DEFAULT 'วิชาชีพ',
  reference_text TEXT DEFAULT 'Internet และเอกสารประกอบการสอน',
  department_name TEXT DEFAULT '',
  division_name TEXT DEFAULT 'ฝ่ายวิชาการ',
  objectives_json JSONB DEFAULT '[]'::jsonb,
  standards_json JSONB DEFAULT '[]'::jsonb,
  description TEXT DEFAULT '',
  knowledge_json JSONB DEFAULT '[]'::jsonb,
  skills_json JSONB DEFAULT '[]'::jsonb,
  weekly_plan_json JSONB DEFAULT '[]'::jsonb,
  equipment_json JSONB DEFAULT '[]'::jsonb,
  assessment_json JSONB DEFAULT '[]'::jsonb,
  rubric_json JSONB DEFAULT '[]'::jsonb,
  instructor_name TEXT DEFAULT '',
  instructor_phone TEXT DEFAULT '',
  instructor_email TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 8. คลังแม่แบบเอกสารแบบกำหนดเอง {{ตัวแปร}} (เริ่มจากฐานข้อมูลว่าง)
CREATE TABLE IF NOT EXISTS document_templates (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  category TEXT DEFAULT 'ทั่วไป',
  description TEXT DEFAULT '',
  file_type TEXT NOT NULL,
  storage_filename TEXT NOT NULL,
  fields_schema_json JSONB DEFAULT '[]'::jsonb,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_by TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 9. การแจ้งเตือนภายในระบบรายบุคคล (In-App Notification Center + SSE)
CREATE TABLE IF NOT EXISTS notifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  recipient_email TEXT NOT NULL,
  actor_email TEXT NOT NULL DEFAULT '',
  document_id UUID REFERENCES documents(id) ON DELETE CASCADE,
  event_type TEXT NOT NULL,
  title TEXT NOT NULL,
  message TEXT NOT NULL DEFAULT '',
  link_url TEXT NOT NULL DEFAULT '/approvals',
  is_read BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_notifications_recipient
  ON notifications (lower(recipient_email), is_read, created_at DESC);

-- Seed initial registry books (สอดคล้องกับ ทะเบียนคุมหนังสือรับ 2569.xls และ 4 ฝ่าย)
INSERT INTO number_sequences (registry_key, registry_name, prefix, year_be, last_number)
VALUES
  ('external', 'ทะเบียนหนังสือส่งออก', 'ศธ ๐๖๒๒.๐๕/', 2569, 0),
  ('memo_ฝบ.', 'ทะเบียนบันทึกข้อความ (ฝ่ายบริหารทรัพยากร)', 'ฝบ. ', 2569, 0),
  ('memo_ฝว.', 'ทะเบียนบันทึกข้อความ (ฝ่ายวิชาการ)', 'ฝว. ', 2569, 0),
  ('memo_ฝย.', 'ทะเบียนบันทึกข้อความ (ฝ่ายยุทธศาสตร์และแผนงาน)', 'ฝย. ', 2569, 0),
  ('memo_ฝก.', 'ทะเบียนบันทึกข้อความ (ฝ่ายกิจการนักเรียน นักศึกษา)', 'ฝก. ', 2569, 0),
  ('order', 'ทะเบียนคำสั่ง', '', 2569, 0),
  ('announcement', 'ทะเบียนประกาศ', '', 2569, 0),
  ('incoming', 'ทะเบียนหนังสือรับ', '', 2570, 2)
ON CONFLICT (registry_key, year_be) DO NOTHING;

-- Seed default system settings
INSERT INTO system_settings (key, value_json)
VALUES
  ('ai_provider', '{"provider": "gemini", "model": "gemini-2.5-flash", "base_url": ""}'::jsonb),
  ('default_font', '{"font_family": "TH Sarabun New"}'::jsonb)
ON CONFLICT (key) DO NOTHING;

-- Seed default CRIC users (สามารถ Sync ทับจาก panel.cric.ac.th ได้)
INSERT INTO users (email, full_name, position_title, division_code, role)
VALUES
  ('saraban@cric.ac.th', 'นางสาวขนิษฐา สุใจยา', 'หัวหน้างานบริหารงานทั่วไป / เจ้าหน้าที่สารบรรณ', 'ฝบ.', 'saraban_admin'),
  ('orawan@cric.ac.th', 'นางสาวอรวรรณ แสงดาว', 'รองผู้อำนวยการฝ่ายบริหารทรัพยากร', 'ฝบ.', 'deputy_director'),
  ('director@cric.ac.th', 'นายยุทธการ ตั้งปัญญาศักดิ์', 'ผู้อำนวยการวิทยาลัยการอาชีพเชียงราย', '', 'director'),
  ('academic@cric.ac.th', 'เจ้าหน้าที่ฝ่ายวิชาการ', 'ครูผู้ช่วยปฏิบัติหน้าที่งานวิชาการ', 'ฝว.', 'drafter')
ON CONFLICT (email) DO NOTHING;
