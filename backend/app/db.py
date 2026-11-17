"""Database persistence layer supporting PostgreSQL (Docker/Supabase) and SQLite (local fallback)."""

from __future__ import annotations

import json
import sqlite3
import threading
import uuid
from contextlib import contextmanager
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from app.config import DATABASE_URL

_LOCK = threading.Lock()


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _is_postgres() -> bool:
    return DATABASE_URL.startswith("postgres://") or DATABASE_URL.startswith("postgresql://")


def _sqlite_path() -> str:
    if DATABASE_URL.startswith("sqlite:///"):
        return DATABASE_URL[len("sqlite:///") :]
    return DATABASE_URL


class Database:
    """Unified repository API over SQLite (dev) or PostgreSQL (production)."""

    def __init__(self) -> None:
        self.use_pg = _is_postgres()
        if not self.use_pg:
            db_file = Path(_sqlite_path())
            db_file.parent.mkdir(parents=True, exist_ok=True)
        self._init_schema()

    @contextmanager
    def _conn(self):
        if self.use_pg:
            import psycopg
            from psycopg.rows import dict_row

            conn = psycopg.connect(DATABASE_URL, row_factory=dict_row)
            try:
                yield conn
                conn.commit()
            except Exception:
                conn.rollback()
                raise
            finally:
                conn.close()
        else:
            with _LOCK:
                conn = sqlite3.connect(_sqlite_path(), check_same_thread=False)
                conn.row_factory = sqlite3.Row
                conn.execute("PRAGMA foreign_keys = ON")
                try:
                    yield conn
                    conn.commit()
                except Exception:
                    conn.rollback()
                    raise
                finally:
                    conn.close()

    def _ph(self) -> str:
        return "%s" if self.use_pg else "?"

    def _init_schema(self) -> None:
        if self.use_pg:
            # Schema is normally initialized by db/init.sql; ensure tables exist just in case.
            sql_file = Path(__file__).resolve().parent.parent.parent / "db" / "init.sql"
            if sql_file.exists():
                with self._conn() as conn:
                    conn.execute(sql_file.read_text(encoding="utf-8"))
            try:
                with self._conn() as conn:
                    conn.execute("ALTER TABLE users ADD COLUMN IF NOT EXISTS username TEXT UNIQUE;")
                    conn.execute("ALTER TABLE users ALTER COLUMN email DROP NOT NULL;")
                    conn.execute("ALTER TABLE users ADD COLUMN IF NOT EXISTS unit_name TEXT DEFAULT '';")
                    conn.execute("ALTER TABLE users ADD COLUMN IF NOT EXISTS phone TEXT DEFAULT '';")
                    conn.execute("ALTER TABLE users ADD COLUMN IF NOT EXISTS default_reviewer_email TEXT DEFAULT '';")
                    conn.execute("ALTER TABLE users ADD COLUMN IF NOT EXISTS avatar_url TEXT DEFAULT '';")
                    conn.execute("ALTER TABLE users ADD COLUMN IF NOT EXISTS personnel_type TEXT DEFAULT 'STAFF';")
                    conn.execute("ALTER TABLE users ADD COLUMN IF NOT EXISTS division_codes_json JSONB DEFAULT '[]'::jsonb;")
                    conn.execute("ALTER TABLE users ADD COLUMN IF NOT EXISTS units_json JSONB DEFAULT '[]'::jsonb;")
                    conn.execute("ALTER TABLE users ADD COLUMN IF NOT EXISTS head_units_json JSONB DEFAULT '[]'::jsonb;")
                    conn.execute("ALTER TABLE courses ADD COLUMN IF NOT EXISTS extra_json JSONB DEFAULT '{}'::jsonb;")
                    conn.execute(
                        """
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
                          extra_json JSONB DEFAULT '{}'::jsonb,
                          instructor_name TEXT NOT NULL DEFAULT '',
                          instructor_phone TEXT DEFAULT '',
                          instructor_email TEXT NOT NULL,
                          created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
                          updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
                        );
                        """
                    )
                    conn.execute(
                        """
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
                        """
                    )
                    conn.execute(
                        """
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
                        """
                    )
                    conn.execute(
                        "CREATE INDEX IF NOT EXISTS idx_notifications_recipient "
                        "ON notifications (lower(recipient_email), is_read, created_at DESC);"
                    )
            except Exception:
                pass
            return

        with self._conn() as conn:
            conn.executescript(
                """
                CREATE TABLE IF NOT EXISTS users (
                  id TEXT PRIMARY KEY,
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
                  personnel_type TEXT DEFAULT 'STAFF',
                  division_codes_json TEXT DEFAULT '[]',
                  units_json TEXT DEFAULT '[]',
                  head_units_json TEXT DEFAULT '[]',
                  role TEXT NOT NULL DEFAULT 'drafter',
                  signature_storage_path TEXT DEFAULT '',
                  avatar_url TEXT DEFAULT '',
                  is_active INTEGER NOT NULL DEFAULT 1,
                  synced_at TEXT
                );

                CREATE TABLE IF NOT EXISTS documents (
                  id TEXT PRIMARY KEY,
                  doc_type TEXT NOT NULL,
                  division_code TEXT DEFAULT '',
                  doc_number TEXT DEFAULT '',
                  is_circular INTEGER NOT NULL DEFAULT 0,
                  speed_level TEXT DEFAULT '',
                  secrecy_level TEXT DEFAULT '',
                  font_family TEXT NOT NULL DEFAULT 'TH Sarabun New',
                  subject TEXT NOT NULL,
                  payload_json TEXT NOT NULL,
                  status TEXT NOT NULL DEFAULT 'draft',
                  docx_path TEXT DEFAULT '',
                  pdf_path TEXT DEFAULT '',
                  created_by TEXT NOT NULL,
                  created_at TEXT NOT NULL,
                  updated_at TEXT NOT NULL
                );

                CREATE TABLE IF NOT EXISTS approval_steps (
                  id TEXT PRIMARY KEY,
                  document_id TEXT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
                  step_order INTEGER NOT NULL,
                  assignee_email TEXT NOT NULL,
                  assignee_role TEXT NOT NULL,
                  action TEXT NOT NULL DEFAULT 'pending',
                  comment TEXT DEFAULT '',
                  acted_at TEXT
                );

                CREATE TABLE IF NOT EXISTS number_sequences (
                  id INTEGER PRIMARY KEY AUTOINCREMENT,
                  registry_key TEXT NOT NULL,
                  registry_name TEXT NOT NULL,
                  prefix TEXT NOT NULL DEFAULT '',
                  year_be INTEGER NOT NULL,
                  last_number INTEGER NOT NULL DEFAULT 0,
                  updated_by TEXT DEFAULT 'system',
                  updated_at TEXT NOT NULL,
                  UNIQUE (registry_key, year_be)
                );

                CREATE TABLE IF NOT EXISTS system_settings (
                  key TEXT PRIMARY KEY,
                  value_json TEXT NOT NULL,
                  updated_by TEXT DEFAULT 'system',
                  updated_at TEXT NOT NULL
                );

                CREATE TABLE IF NOT EXISTS audit_logs (
                  id INTEGER PRIMARY KEY AUTOINCREMENT,
                  document_id TEXT REFERENCES documents(id) ON DELETE CASCADE,
                  actor_email TEXT NOT NULL,
                  event_type TEXT NOT NULL,
                  metadata TEXT DEFAULT '{}',
                  created_at TEXT NOT NULL
                );

                CREATE TABLE IF NOT EXISTS courses (
                  id TEXT PRIMARY KEY,
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
                  objectives_json TEXT DEFAULT '[]',
                  standards_json TEXT DEFAULT '[]',
                  description TEXT DEFAULT '',
                  knowledge_json TEXT DEFAULT '[]',
                  skills_json TEXT DEFAULT '[]',
                  weekly_plan_json TEXT DEFAULT '[]',
                  equipment_json TEXT DEFAULT '[]',
                  assessment_json TEXT DEFAULT '[]',
                  rubric_json TEXT DEFAULT '[]',
                  extra_json TEXT DEFAULT '{}',
                  instructor_name TEXT DEFAULT '',
                  instructor_phone TEXT DEFAULT '',
                  instructor_email TEXT NOT NULL,
                  created_at TEXT NOT NULL,
                  updated_at TEXT NOT NULL
                );

                CREATE TABLE IF NOT EXISTS document_templates (
                  id TEXT PRIMARY KEY,
                  name TEXT NOT NULL,
                  category TEXT DEFAULT 'ทั่วไป',
                  description TEXT DEFAULT '',
                  file_type TEXT NOT NULL,
                  storage_filename TEXT NOT NULL,
                  fields_schema_json TEXT DEFAULT '[]',
                  is_active INTEGER NOT NULL DEFAULT 1,
                  created_by TEXT NOT NULL,
                  created_at TEXT NOT NULL,
                  updated_at TEXT NOT NULL
                );

                CREATE TABLE IF NOT EXISTS notifications (
                  id TEXT PRIMARY KEY,
                  recipient_email TEXT NOT NULL,
                  actor_email TEXT NOT NULL DEFAULT '',
                  document_id TEXT REFERENCES documents(id) ON DELETE CASCADE,
                  event_type TEXT NOT NULL,
                  title TEXT NOT NULL,
                  message TEXT NOT NULL DEFAULT '',
                  link_url TEXT NOT NULL DEFAULT '/approvals',
                  is_read INTEGER NOT NULL DEFAULT 0,
                  created_at TEXT NOT NULL
                );
                CREATE INDEX IF NOT EXISTS idx_notifications_recipient
                  ON notifications (lower(recipient_email), is_read, created_at DESC);
                """
            )
            for alter_sql in (
                "ALTER TABLE users ADD COLUMN username TEXT;",
                "ALTER TABLE users ADD COLUMN unit_name TEXT DEFAULT '';",
                "ALTER TABLE users ADD COLUMN phone TEXT DEFAULT '';",
                "ALTER TABLE users ADD COLUMN default_reviewer_email TEXT DEFAULT '';",
                "ALTER TABLE users ADD COLUMN avatar_url TEXT DEFAULT '';",
                "ALTER TABLE users ADD COLUMN personnel_type TEXT DEFAULT 'STAFF';",
                "ALTER TABLE users ADD COLUMN division_codes_json TEXT DEFAULT '[]';",
                "ALTER TABLE users ADD COLUMN units_json TEXT DEFAULT '[]';",
                "ALTER TABLE users ADD COLUMN head_units_json TEXT DEFAULT '[]';",
                "ALTER TABLE courses ADD COLUMN extra_json TEXT DEFAULT '{}';",
            ):
                try:
                    conn.execute(alter_sql)
                except Exception:
                    pass
            now = _now_iso()
            seeds = [
                ("external", "ทะเบียนหนังสือส่งออก", "ศธ ๐๖๒๒.๐๕/", 2569, 0),
                ("memo_ฝบ.", "ทะเบียนบันทึกข้อความ (ฝ่ายบริหารทรัพยากร)", "ฝบ. ", 2569, 0),
                ("memo_ฝว.", "ทะเบียนบันทึกข้อความ (ฝ่ายวิชาการ)", "ฝว. ", 2569, 0),
                ("memo_ฝย.", "ทะเบียนบันทึกข้อความ (ฝ่ายยุทธศาสตร์และแผนงาน)", "ฝย. ", 2569, 0),
                ("memo_ฝก.", "ทะเบียนบันทึกข้อความ (ฝ่ายกิจการนักเรียน นักศึกษา)", "ฝก. ", 2569, 0),
                ("order", "ทะเบียนคำสั่ง", "", 2569, 0),
                ("announcement", "ทะเบียนประกาศ", "", 2569, 0),
                ("incoming", "ทะเบียนหนังสือรับ", "", 2570, 2),
            ]
            for rk, rname, pfx, yr, num in seeds:
                conn.execute(
                    """
                    INSERT OR IGNORE INTO number_sequences
                    (registry_key, registry_name, prefix, year_be, last_number, updated_by, updated_at)
                    VALUES (?, ?, ?, ?, ?, 'system', ?)
                    """,
                    (rk, rname, pfx, yr, num, now),
                )

            conn.execute(
                "INSERT OR IGNORE INTO system_settings (key, value_json, updated_by, updated_at) VALUES (?, ?, 'system', ?)",
                ("ai_provider", json.dumps({"provider": "gemini", "model": "gemini-2.5-flash", "base_url": ""}), now),
            )
            conn.execute(
                "INSERT OR IGNORE INTO system_settings (key, value_json, updated_by, updated_at) VALUES (?, ?, 'system', ?)",
                ("default_font", json.dumps({"font_family": "TH Sarabun New"}, ensure_ascii=False), now),
            )

            default_users = [
                ("saraban@cric.ac.th", "นางสาวขนิษฐา สุใจยา", "หัวหน้างานบริหารงานทั่วไป / เจ้าหน้าที่สารบรรณ", "ฝบ.", "saraban_admin"),
                ("orawan@cric.ac.th", "นางสาวอรวรรณ แสงดาว", "รองผู้อำนวยการฝ่ายบริหารทรัพยากร", "ฝบ.", "deputy_director"),
                ("director@cric.ac.th", "นายยุทธการ ตั้งปัญญาศักดิ์", "ผู้อำนวยการวิทยาลัยการอาชีพเชียงราย", "", "director"),
                ("academic@cric.ac.th", "เจ้าหน้าที่ฝ่ายวิชาการ", "ครูผู้ช่วยปฏิบัติหน้าที่งานวิชาการ", "ฝว.", "drafter"),
            ]
            for email, name, title, div, role in default_users:
                conn.execute(
                    """
                    INSERT OR IGNORE INTO users
                    (id, email, full_name, position_title, division_code, role, synced_at)
                    VALUES (?, ?, ?, ?, ?, ?, ?)
                    """,
                    (str(uuid.uuid4()), email, name, title, div, role, now),
                )

    @staticmethod
    def _row_to_dict(row: Any) -> dict[str, Any]:
        d = dict(row)
        json_cols = (
            "payload_json",
            "value_json",
            "metadata",
            "objectives_json",
            "standards_json",
            "knowledge_json",
            "skills_json",
            "weekly_plan_json",
            "equipment_json",
            "assessment_json",
            "rubric_json",
            "extra_json",
            "fields_schema_json",
            "division_codes_json",
            "units_json",
            "head_units_json",
        )
        for key in json_cols:
            if key in d and isinstance(d[key], str):
                try:
                    d[key] = json.loads(d[key])
                except json.JSONDecodeError:
                    pass
        if isinstance(d.get("extra_json"), dict):
            for k, v in d["extra_json"].items():
                if k not in d or d[k] is None:
                    d[k] = v
        if "division_codes_json" in d or "division_code" in d:
            raw_divs = d.get("division_codes_json")
            div_list = [str(x).strip() for x in raw_divs if str(x).strip()] if isinstance(raw_divs, list) else []
            primary_div = str(d.get("division_code") or "").strip()
            if not div_list and primary_div:
                div_list = [primary_div]
            elif primary_div and primary_div not in div_list:
                div_list.insert(0, primary_div)
            d["division_codes"] = div_list
        if "units_json" in d or "unit_name" in d:
            raw_units = d.get("units_json")
            unit_list = [str(x).strip() for x in raw_units if str(x).strip()] if isinstance(raw_units, list) else []
            primary_unit = str(d.get("unit_name") or "").strip()
            if not unit_list and primary_unit:
                unit_list = [primary_unit]
            elif primary_unit and primary_unit not in unit_list:
                unit_list.insert(0, primary_unit)
            d["units"] = unit_list
        if "head_units_json" in d:
            raw_heads = d.get("head_units_json")
            d["head_units"] = [str(x).strip() for x in raw_heads if str(x).strip()] if isinstance(raw_heads, list) else []
        if "personnel_type" in d:
            pt = str(d.get("personnel_type") or "").strip().upper()
            if pt not in ("TEACHER", "STAFF"):
                pos = str(d.get("position_title") or "")
                pt = "TEACHER" if pos.startswith("ครู") or pos.startswith("อาจารย์") else "STAFF"
            d["personnel_type"] = pt
        if "is_circular" in d:
            d["is_circular"] = bool(d["is_circular"])
        if "is_active" in d:
            d["is_active"] = bool(d["is_active"])
        if "id" in d and not isinstance(d["id"], int):
            d["id"] = str(d["id"])
        if "document_id" in d and d["document_id"] is not None:
            d["document_id"] = str(d["document_id"])
        return d

    # --- Users ---
    def list_users(self) -> list[dict[str, Any]]:
        with self._conn() as conn:
            rows = conn.execute("SELECT * FROM users ORDER BY role, full_name").fetchall()
            return [self._row_to_dict(r) for r in rows]

    def get_user_by_email(self, email: str) -> dict[str, Any] | None:
        if not email:
            return None
        p = self._ph()
        with self._conn() as conn:
            row = conn.execute(f"SELECT * FROM users WHERE lower(email) = {p}", (email.strip().lower(),)).fetchone()
            return self._row_to_dict(row) if row else None

    def get_user_by_username(self, username: str) -> dict[str, Any] | None:
        if not username:
            return None
        p = self._ph()
        clean = username.strip().lstrip("@").lower()
        with self._conn() as conn:
            row = conn.execute(f"SELECT * FROM users WHERE lower(username) = {p}", (clean,)).fetchone()
            return self._row_to_dict(row) if row else None

    def get_user_by_identifier(self, identifier: str) -> dict[str, Any] | None:
        if not identifier:
            return None
        raw = str(identifier).strip()
        clean = raw.lstrip("@").lower()
        p = self._ph()
        id_cond = f"id::text = {p}" if self.use_pg else f"id = {p}"
        with self._conn() as conn:
            row = conn.execute(
                f"""
                SELECT * FROM users
                WHERE lower(email) = {p}
                   OR lower(username) = {p}
                   OR panel_user_id = {p}
                   OR sso_subject = {p}
                   OR {id_cond}
                LIMIT 1
                """,
                (clean, clean, raw, raw, raw),
            ).fetchone()
            return self._row_to_dict(row) if row else None

    def upsert_user(self, data: dict[str, Any]) -> dict[str, Any]:
        p = self._ph()
        raw_email = str(data.get("email") or "").strip().lower()
        email = raw_email if raw_email else None

        raw_username = str(data.get("username") or "").strip().lstrip("@")
        if not raw_username and email:
            raw_username = email.split("@")[0]
        username = raw_username if raw_username else None

        panel_user_id = data.get("panel_user_id")
        sso_subject = data.get("sso_subject")
        now = _now_iso()

        # Find existing user by priority: panel_user_id -> sso_subject -> username -> email
        existing: dict[str, Any] | None = None
        if panel_user_id:
            with self._conn() as conn:
                row = conn.execute(f"SELECT * FROM users WHERE panel_user_id = {p}", (panel_user_id,)).fetchone()
                existing = self._row_to_dict(row) if row else None
        if not existing and sso_subject:
            with self._conn() as conn:
                row = conn.execute(f"SELECT * FROM users WHERE sso_subject = {p}", (sso_subject,)).fetchone()
                existing = self._row_to_dict(row) if row else None
        if not existing and username:
            existing = self.get_user_by_username(username)
        if not existing and email:
            existing = self.get_user_by_email(email)

        full_name = data.get("full_name") or (existing["full_name"] if existing else (username or "ผู้ใช้งาน"))
        position_title = data.get("position_title") or (existing["position_title"] if existing else "เจ้าหน้าที่")
        division_code = (
            data["division_code"]
            if "division_code" in data and data["division_code"] is not None
            else (existing.get("division_code", "") if existing else "")
        )
        unit_name = (
            data["unit_name"]
            if "unit_name" in data and data["unit_name"] is not None
            else (existing.get("unit_name", "") if existing else "")
        )
        phone = (
            data["phone"]
            if "phone" in data and data["phone"] is not None
            else (existing.get("phone", "") if existing else "")
        )
        default_reviewer_email = (
            data["default_reviewer_email"]
            if "default_reviewer_email" in data and data["default_reviewer_email"] is not None
            else (existing.get("default_reviewer_email", "") if existing else "")
        )
        raw_div_codes = data.get("division_codes") if "division_codes" in data else (existing.get("division_codes") if existing else None)
        div_codes_list = [str(x).strip() for x in (raw_div_codes or []) if str(x).strip()]
        if division_code and division_code not in div_codes_list:
            div_codes_list.insert(0, division_code)
        elif not division_code and div_codes_list:
            division_code = div_codes_list[0]

        raw_units = data.get("units") if "units" in data else (existing.get("units") if existing else None)
        units_list = [str(x).strip() for x in (raw_units or []) if str(x).strip()]
        if unit_name and unit_name not in units_list:
            units_list.insert(0, unit_name)
        elif not unit_name and units_list:
            unit_name = units_list[0]

        raw_head_units = data.get("head_units") if "head_units" in data else (existing.get("head_units") if existing else None)
        head_units_list = [str(x).strip() for x in (raw_head_units or []) if str(x).strip() and str(x).strip() in units_list]

        raw_pt = str(data.get("personnel_type") or (existing.get("personnel_type") if existing else "") or "").strip().upper()
        if raw_pt not in ("TEACHER", "STAFF"):
            raw_pt = "TEACHER" if (position_title.startswith("ครู") or position_title.startswith("อาจารย์")) else "STAFF"

        div_codes_str = json.dumps(div_codes_list, ensure_ascii=False)
        units_str = json.dumps(units_list, ensure_ascii=False)
        head_units_str = json.dumps(head_units_list, ensure_ascii=False)

        role = data.get("role") or (existing["role"] if existing else "drafter")
        incoming_avatar = str(data["avatar_url"]).strip() if "avatar_url" in data and data["avatar_url"] is not None else None
        existing_avatar = str(existing.get("avatar_url") or "").strip() if existing else ""
        if existing_avatar.startswith("/v1/auth/users/") and incoming_avatar and not incoming_avatar.startswith("/v1/auth/users/"):
            avatar_url = existing_avatar
        elif incoming_avatar is not None and incoming_avatar != "":
            avatar_url = incoming_avatar
        elif "avatar_url" in data and data["avatar_url"] == "":
            avatar_url = ""
        else:
            avatar_url = existing_avatar
        raw_active = data.get("is_active", existing.get("is_active", True) if existing else True)
        is_active = bool(raw_active) if self.use_pg else (1 if raw_active else 0)

        with self._conn() as conn:
            if existing:
                user_id = existing["id"]
                conn.execute(
                    f"""
                    UPDATE users SET
                      sso_subject = COALESCE({p}, sso_subject),
                      panel_user_id = COALESCE({p}, panel_user_id),
                      username = COALESCE({p}, username),
                      email = COALESCE({p}, email),
                      full_name = {p},
                      position_title = {p},
                      division_code = {p},
                      unit_name = {p},
                      phone = {p},
                      default_reviewer_email = {p},
                      personnel_type = {p},
                      division_codes_json = {p},
                      units_json = {p},
                      head_units_json = {p},
                      role = {p},
                      avatar_url = {p},
                      is_active = {p},
                      synced_at = {p}
                    WHERE id = {p}
                    """,
                    (
                        sso_subject,
                        panel_user_id,
                        username,
                        email,
                        full_name,
                        position_title,
                        division_code,
                        unit_name,
                        phone,
                        default_reviewer_email,
                        raw_pt,
                        div_codes_str,
                        units_str,
                        head_units_str,
                        role,
                        avatar_url,
                        is_active,
                        now,
                        user_id,
                    ),
                )
            else:
                user_id = str(uuid.uuid4())
                conn.execute(
                    f"""
                    INSERT INTO users (
                      id, sso_subject, panel_user_id, username, email, full_name,
                      position_title, division_code, unit_name, phone, default_reviewer_email,
                      personnel_type, division_codes_json, units_json, head_units_json,
                      role, avatar_url, is_active, synced_at
                    )
                    VALUES ({p}, {p}, {p}, {p}, {p}, {p}, {p}, {p}, {p}, {p}, {p}, {p}, {p}, {p}, {p}, {p}, {p}, {p}, {p})
                    """,
                    (
                        user_id,
                        sso_subject,
                        panel_user_id,
                        username,
                        email,
                        full_name,
                        position_title,
                        division_code,
                        unit_name,
                        phone,
                        default_reviewer_email,
                        raw_pt,
                        div_codes_str,
                        units_str,
                        head_units_str,
                        role,
                        avatar_url,
                        is_active,
                        now,
                    ),
                )

        res = self.get_user_by_identifier(user_id)
        assert res is not None
        return res

    def delete_user(self, identifier: str) -> dict[str, Any] | None:
        user = self.get_user_by_identifier(identifier)
        if not user:
            return None
        p = self._ph()
        with self._conn() as conn:
            conn.execute(f"DELETE FROM users WHERE id = {p}", (user["id"],))
        return user

    def set_user_signature(self, identifier: str, path: str) -> None:
        user = self.get_user_by_identifier(identifier)
        if not user:
            return
        p = self._ph()
        with self._conn() as conn:
            conn.execute(
                f"UPDATE users SET signature_storage_path = {p} WHERE id = {p}",
                (path, user["id"]),
            )

    def set_user_avatar(self, identifier: str, avatar_url: str) -> None:
        user = self.get_user_by_identifier(identifier)
        if not user:
            return
        p = self._ph()
        with self._conn() as conn:
            conn.execute(
                f"UPDATE users SET avatar_url = {p} WHERE id = {p}",
                (avatar_url, user["id"]),
            )

    def update_user_fields(self, identifier: str, updates: dict[str, Any]) -> dict[str, Any] | None:
        existing = self.get_user_by_identifier(identifier)
        if not existing:
            return None
        merged = {
            **existing,
            **{k: v for k, v in updates.items() if v is not None},
        }
        return self.upsert_user(merged)

    # --- Settings ---
    def get_setting(self, key: str) -> dict[str, Any] | None:
        p = self._ph()
        with self._conn() as conn:
            row = conn.execute(f"SELECT * FROM system_settings WHERE key = {p}", (key,)).fetchone()
            return self._row_to_dict(row) if row else None

    def get_setting_json(self, key: str, default: dict[str, Any] | None = None) -> dict[str, Any]:
        row = self.get_setting(key)
        val = (row or {}).get("value_json")
        if isinstance(val, dict):
            return val
        return dict(default) if default is not None else {}

    def set_setting(self, key: str, value: dict[str, Any], actor_email: str) -> dict[str, Any]:
        p = self._ph()
        now = _now_iso()
        val_str = json.dumps(value, ensure_ascii=False)
        with self._conn() as conn:
            conn.execute(
                f"""
                INSERT INTO system_settings (key, value_json, updated_by, updated_at)
                VALUES ({p}, {p}, {p}, {p})
                ON CONFLICT (key) DO UPDATE SET
                  value_json = EXCLUDED.value_json,
                  updated_by = EXCLUDED.updated_by,
                  updated_at = EXCLUDED.updated_at
                """,
                (key, val_str, actor_email, now),
            )
        res = self.get_setting(key)
        assert res is not None
        return res

    # --- Number Sequences ---
    def list_sequences(self) -> list[dict[str, Any]]:
        with self._conn() as conn:
            rows = conn.execute(
                "SELECT * FROM number_sequences ORDER BY year_be DESC, id ASC"
            ).fetchall()
            return [self._row_to_dict(r) for r in rows]

    def update_sequence(self, seq_id: int, updates: dict[str, Any], actor_email: str) -> dict[str, Any] | None:
        p = self._ph()
        now = _now_iso()
        with self._conn() as conn:
            row = conn.execute(f"SELECT * FROM number_sequences WHERE id = {p}", (seq_id,)).fetchone()
            if not row:
                return None
            cur = self._row_to_dict(row)
            conn.execute(
                f"""
                UPDATE number_sequences
                SET registry_name = {p}, prefix = {p}, year_be = {p}, last_number = {p}, updated_by = {p}, updated_at = {p}
                WHERE id = {p}
                """,
                (
                    updates.get("registry_name", cur["registry_name"]),
                    updates.get("prefix", cur["prefix"]),
                    int(updates.get("year_be", cur["year_be"])),
                    int(updates.get("last_number", cur["last_number"])),
                    actor_email,
                    now,
                    seq_id,
                ),
            )
            updated = conn.execute(f"SELECT * FROM number_sequences WHERE id = {p}", (seq_id,)).fetchone()
            return self._row_to_dict(updated) if updated else None

    def create_sequence(self, data: dict[str, Any], actor_email: str) -> dict[str, Any]:
        p = self._ph()
        now = _now_iso()
        with self._conn() as conn:
            conn.execute(
                f"""
                INSERT INTO number_sequences (registry_key, registry_name, prefix, year_be, last_number, updated_by, updated_at)
                VALUES ({p}, {p}, {p}, {p}, {p}, {p}, {p})
                """,
                (
                    data["registry_key"],
                    data["registry_name"],
                    data.get("prefix", ""),
                    int(data["year_be"]),
                    int(data.get("last_number", 0)),
                    actor_email,
                    now,
                ),
            )
            row = conn.execute(
                f"SELECT * FROM number_sequences WHERE registry_key = {p} AND year_be = {p}",
                (data["registry_key"], int(data["year_be"])),
            ).fetchone()
            return self._row_to_dict(row)

    def allocate_next_number(self, registry_key: str, year_be: int, actor_email: str) -> dict[str, Any]:
        p = self._ph()
        now = _now_iso()
        with self._conn() as conn:
            row = conn.execute(
                f"SELECT * FROM number_sequences WHERE registry_key = {p} AND year_be = {p}",
                (registry_key, year_be),
            ).fetchone()
            if not row:
                raise ValueError(f"ไม่พบทะเบียนคุม '{registry_key}' ปี พ.ศ. {year_be}")
            if self.use_pg:
                updated = conn.execute(
                    f"""
                    UPDATE number_sequences
                    SET last_number = last_number + 1, updated_by = {p}, updated_at = {p}
                    WHERE registry_key = {p} AND year_be = {p}
                    RETURNING *
                    """,
                    (actor_email, now, registry_key, year_be),
                ).fetchone()
            else:
                conn.execute(
                    f"""
                    UPDATE number_sequences
                    SET last_number = last_number + 1, updated_by = {p}, updated_at = {p}
                    WHERE registry_key = {p} AND year_be = {p}
                    """,
                    (actor_email, now, registry_key, year_be),
                )
                updated = conn.execute(
                    f"SELECT * FROM number_sequences WHERE registry_key = {p} AND year_be = {p}",
                    (registry_key, year_be),
                ).fetchone()
            return self._row_to_dict(updated)

    # --- Documents & Workflow ---
    def save_document(self, data: dict[str, Any]) -> dict[str, Any]:
        p = self._ph()
        now = _now_iso()
        doc_id = data.get("id") or str(uuid.uuid4())
        payload_str = json.dumps(data["payload_json"], ensure_ascii=False)
        is_circ = bool(data.get("is_circular", False))
        circ_val = is_circ if self.use_pg else (1 if is_circ else 0)
        with self._conn() as conn:
            existing = conn.execute(f"SELECT id FROM documents WHERE id = {p}", (doc_id,)).fetchone()
            if existing:
                conn.execute(
                    f"""
                    UPDATE documents SET
                      doc_type = {p}, division_code = {p}, doc_number = {p}, is_circular = {p},
                      speed_level = {p}, secrecy_level = {p}, font_family = {p}, subject = {p},
                      payload_json = {p}, status = {p}, docx_path = {p}, pdf_path = {p}, updated_at = {p}
                    WHERE id = {p}
                    """,
                    (
                        data["doc_type"],
                        data.get("division_code", ""),
                        data.get("doc_number", ""),
                        circ_val,
                        data.get("speed_level", ""),
                        data.get("secrecy_level", ""),
                        data.get("font_family", "TH Sarabun New"),
                        data["subject"],
                        payload_str,
                        data.get("status", "draft"),
                        data.get("docx_path", ""),
                        data.get("pdf_path", ""),
                        now,
                        doc_id,
                    ),
                )
            else:
                conn.execute(
                    f"""
                    INSERT INTO documents
                    (id, doc_type, division_code, doc_number, is_circular, speed_level, secrecy_level, font_family,
                     subject, payload_json, status, docx_path, pdf_path, created_by, created_at, updated_at)
                    VALUES ({p}, {p}, {p}, {p}, {p}, {p}, {p}, {p}, {p}, {p}, {p}, {p}, {p}, {p}, {p}, {p})
                    """,
                    (
                        doc_id,
                        data["doc_type"],
                        data.get("division_code", ""),
                        data.get("doc_number", ""),
                        circ_val,
                        data.get("speed_level", ""),
                        data.get("secrecy_level", ""),
                        data.get("font_family", "TH Sarabun New"),
                        data["subject"],
                        payload_str,
                        data.get("status", "draft"),
                        data.get("docx_path", ""),
                        data.get("pdf_path", ""),
                        data["created_by"],
                        now,
                        now,
                    ),
                )
        doc = self.get_document(doc_id)
        assert doc is not None
        return doc

    def get_document(self, doc_id: str) -> dict[str, Any] | None:
        p = self._ph()
        with self._conn() as conn:
            row = conn.execute(f"SELECT * FROM documents WHERE id = {p}", (doc_id,)).fetchone()
            if not row:
                return None
            doc = self._row_to_dict(row)
            steps = conn.execute(
                f"SELECT * FROM approval_steps WHERE document_id = {p} ORDER BY step_order ASC",
                (doc_id,),
            ).fetchall()
            doc["approval_steps"] = [self._row_to_dict(s) for s in steps]
            return doc

    def list_documents(self, status: str | None = None, division_code: str | None = None) -> list[dict[str, Any]]:
        p = self._ph()
        clauses = []
        params: list[Any] = []
        if status:
            clauses.append(f"status = {p}")
            params.append(status)
        if division_code:
            clauses.append(f"division_code = {p}")
            params.append(division_code)
        where = ("WHERE " + " AND ".join(clauses)) if clauses else ""
        with self._conn() as conn:
            rows = conn.execute(
                f"SELECT * FROM documents {where} ORDER BY updated_at DESC",
                tuple(params),
            ).fetchall()
            return [self._row_to_dict(r) for r in rows]

    def list_documents_with_pending_steps(self) -> list[dict[str, Any]]:
        docs = self.list_documents()
        if not docs:
            return []
        with self._conn() as conn:
            step_rows = conn.execute(
                "SELECT document_id, step_order, assignee_email, assignee_role, action "
                "FROM approval_steps WHERE action = 'pending' ORDER BY step_order ASC"
            ).fetchall()
        pending_by_doc: dict[str, list[dict[str, Any]]] = {}
        for s in step_rows:
            d = self._row_to_dict(s)
            pending_by_doc.setdefault(str(d["document_id"]), []).append(d)
        for doc in docs:
            doc["pending_steps"] = pending_by_doc.get(str(doc["id"]), [])
        return docs

    def replace_approval_steps(self, doc_id: str, steps: list[dict[str, str]]) -> None:
        p = self._ph()
        with self._conn() as conn:
            conn.execute(f"DELETE FROM approval_steps WHERE document_id = {p}", (doc_id,))
            for idx, step in enumerate(steps, start=1):
                conn.execute(
                    f"""
                    INSERT INTO approval_steps (id, document_id, step_order, assignee_email, assignee_role, action)
                    VALUES ({p}, {p}, {p}, {p}, {p}, 'pending')
                    """,
                    (str(uuid.uuid4()), doc_id, idx, step["assignee_email"], step["assignee_role"]),
                )

    def record_step_action(self, step_id: str, action: str, comment: str = "") -> None:
        p = self._ph()
        with self._conn() as conn:
            conn.execute(
                f"UPDATE approval_steps SET action = {p}, comment = {p}, acted_at = {p} WHERE id = {p}",
                (action, comment, _now_iso(), step_id),
            )

    def add_audit_log(self, document_id: str | None, actor_email: str, event_type: str, metadata: dict[str, Any] | None = None) -> None:
        p = self._ph()
        with self._conn() as conn:
            conn.execute(
                f"INSERT INTO audit_logs (document_id, actor_email, event_type, metadata, created_at) VALUES ({p}, {p}, {p}, {p}, {p})",
                (document_id, actor_email, event_type, json.dumps(metadata or {}, ensure_ascii=False), _now_iso()),
            )

    def list_audit_logs(self, document_id: str | None = None, limit: int = 50) -> list[dict[str, Any]]:
        p = self._ph()
        with self._conn() as conn:
            if document_id:
                rows = conn.execute(
                    f"SELECT * FROM audit_logs WHERE document_id = {p} ORDER BY id DESC LIMIT {p}",
                    (document_id, limit),
                ).fetchall()
            else:
                rows = conn.execute(
                    f"SELECT * FROM audit_logs ORDER BY id DESC LIMIT {p}",
                    (limit,),
                ).fetchall()
            return [self._row_to_dict(r) for r in rows]

    # --- Courses (Teaching Module) ---
    def list_courses(self, instructor_email: str | None = None) -> list[dict[str, Any]]:
        p = self._ph()
        with self._conn() as conn:
            if instructor_email:
                rows = conn.execute(
                    f"SELECT * FROM courses WHERE lower(instructor_email) = {p} ORDER BY updated_at DESC",
                    (instructor_email.strip().lower(),),
                ).fetchall()
            else:
                rows = conn.execute("SELECT * FROM courses ORDER BY updated_at DESC").fetchall()
            return [self._row_to_dict(r) for r in rows]

    def get_course(self, course_id: str) -> dict[str, Any] | None:
        p = self._ph()
        id_cond = f"id::text = {p}" if self.use_pg else f"id = {p}"
        with self._conn() as conn:
            row = conn.execute(f"SELECT * FROM courses WHERE {id_cond}", (course_id,)).fetchone()
            return self._row_to_dict(row) if row else None

    def upsert_course(self, data: dict[str, Any], actor_email: str) -> dict[str, Any]:
        p = self._ph()
        now = _now_iso()
        course_id = str(data.get("id") or uuid.uuid4())
        existing = self.get_course(course_id) if data.get("id") else None

        fields = {
            "course_code": str(data.get("course_code") or "").strip(),
            "course_name": str(data.get("course_name") or "").strip(),
            "curriculum_level": str(data.get("curriculum_level") or "ปวช."),
            "credits": str(data.get("credits") or "1-3-2 (2 หน่วยกิต 4 ชั่วโมง)"),
            "semester": str(data.get("semester") or "2/2569"),
            "schedule_text": str(data.get("schedule_text") or ""),
            "prerequisite": str(data.get("prerequisite") or "วิชาชีพ"),
            "reference_text": str(data.get("reference_text") or "Internet และเอกสารประกอบการสอน"),
            "department_name": str(data.get("department_name") or ""),
            "division_name": str(data.get("division_name") or "ฝ่ายวิชาการ"),
            "objectives_json": json.dumps(data.get("objectives") or data.get("objectives_json") or [], ensure_ascii=False),
            "standards_json": json.dumps(data.get("standards") or data.get("standards_json") or [], ensure_ascii=False),
            "description": str(data.get("description") or ""),
            "knowledge_json": json.dumps(data.get("knowledge") or data.get("knowledge_json") or [], ensure_ascii=False),
            "skills_json": json.dumps(data.get("skills") or data.get("skills_json") or [], ensure_ascii=False),
            "weekly_plan_json": json.dumps(data.get("weekly_plan") or data.get("weekly_plan_json") or [], ensure_ascii=False),
            "equipment_json": json.dumps(data.get("equipment") or data.get("equipment_json") or [], ensure_ascii=False),
            "assessment_json": json.dumps(data.get("assessment") or data.get("assessment_json") or [], ensure_ascii=False),
            "rubric_json": json.dumps(data.get("rubric") or data.get("rubric_json") or [], ensure_ascii=False),
            "extra_json": json.dumps(
                {
                    **(data.get("extra_json") if isinstance(data.get("extra_json"), dict) else {}),
                    **{
                        k: data[k]
                        for k in (
                            "morals",
                            "indicators",
                            "evaluation_criteria",
                            "instructional_strategies",
                            "curriculum_analysis",
                            "qualification_link",
                            "credit_summary",
                            "notes",
                        )
                        if k in data
                    },
                },
                ensure_ascii=False,
            ),
            "instructor_name": str(data.get("instructor_name") or ""),
            "instructor_phone": str(data.get("instructor_phone") or ""),
            "instructor_email": str(data.get("instructor_email") or actor_email).strip().lower(),
        }

        with self._conn() as conn:
            if existing:
                id_cond = f"id::text = {p}" if self.use_pg else f"id = {p}"
                conn.execute(
                    f"""
                    UPDATE courses SET
                      course_code={p}, course_name={p}, curriculum_level={p}, credits={p}, semester={p},
                      schedule_text={p}, prerequisite={p}, reference_text={p}, department_name={p}, division_name={p},
                      objectives_json={p}, standards_json={p}, description={p}, knowledge_json={p}, skills_json={p},
                      weekly_plan_json={p}, equipment_json={p}, assessment_json={p}, rubric_json={p}, extra_json={p},
                      instructor_name={p}, instructor_phone={p}, instructor_email={p}, updated_at={p}
                    WHERE {id_cond}
                    """,
                    (
                        fields["course_code"], fields["course_name"], fields["curriculum_level"],
                        fields["credits"], fields["semester"], fields["schedule_text"],
                        fields["prerequisite"], fields["reference_text"], fields["department_name"],
                        fields["division_name"], fields["objectives_json"], fields["standards_json"],
                        fields["description"], fields["knowledge_json"], fields["skills_json"],
                        fields["weekly_plan_json"], fields["equipment_json"], fields["assessment_json"],
                        fields["rubric_json"], fields["extra_json"], fields["instructor_name"], fields["instructor_phone"],
                        fields["instructor_email"], now, course_id,
                    ),
                )
            else:
                conn.execute(
                    f"""
                    INSERT INTO courses (
                      id, course_code, course_name, curriculum_level, credits, semester,
                      schedule_text, prerequisite, reference_text, department_name, division_name,
                      objectives_json, standards_json, description, knowledge_json, skills_json,
                      weekly_plan_json, equipment_json, assessment_json, rubric_json, extra_json,
                      instructor_name, instructor_phone, instructor_email, created_at, updated_at
                    ) VALUES ({','.join([p] * 26)})
                    """,
                    (
                        course_id, fields["course_code"], fields["course_name"], fields["curriculum_level"],
                        fields["credits"], fields["semester"], fields["schedule_text"],
                        fields["prerequisite"], fields["reference_text"], fields["department_name"],
                        fields["division_name"], fields["objectives_json"], fields["standards_json"],
                        fields["description"], fields["knowledge_json"], fields["skills_json"],
                        fields["weekly_plan_json"], fields["equipment_json"], fields["assessment_json"],
                        fields["rubric_json"], fields["extra_json"], fields["instructor_name"], fields["instructor_phone"],
                        fields["instructor_email"], now, now,
                    ),
                )
        res = self.get_course(course_id)
        assert res is not None
        return res

    def delete_course(self, course_id: str) -> bool:
        p = self._ph()
        id_cond = f"id::text = {p}" if self.use_pg else f"id = {p}"
        with self._conn() as conn:
            cur = conn.execute(f"DELETE FROM courses WHERE {id_cond}", (course_id,))
            return (cur.rowcount or 0) > 0

    # --- Custom Document Templates ---
    def list_document_templates(self, active_only: bool = False) -> list[dict[str, Any]]:
        with self._conn() as conn:
            if active_only:
                cond = "WHERE is_active = true" if self.use_pg else "WHERE is_active = 1"
            else:
                cond = ""
            rows = conn.execute(f"SELECT * FROM document_templates {cond} ORDER BY category, name, updated_at DESC").fetchall()
            return [self._row_to_dict(r) for r in rows]

    def get_document_template(self, template_id: str) -> dict[str, Any] | None:
        p = self._ph()
        with self._conn() as conn:
            row = conn.execute(f"SELECT * FROM document_templates WHERE id = {p}", (template_id,)).fetchone()
            return self._row_to_dict(row) if row else None

    def upsert_document_template(self, data: dict[str, Any], actor_email: str) -> dict[str, Any]:
        p = self._ph()
        now = _now_iso()
        tpl_id = str(data.get("id") or str(uuid.uuid4()))
        existing = self.get_document_template(tpl_id)
        schema_val = data.get("fields_schema") if "fields_schema" in data else data.get("fields_schema_json")
        if schema_val is None and existing:
            schema_val = existing.get("fields_schema_json", [])
        schema_json = json.dumps(schema_val or [], ensure_ascii=False)
        is_active_val = data.get("is_active", existing["is_active"] if existing else True)
        is_active_db = bool(is_active_val) if self.use_pg else (1 if is_active_val else 0)

        name = str(data.get("name") or (existing["name"] if existing else "")).strip()
        category = str(data.get("category") if "category" in data else (existing["category"] if existing else "ทั่วไป")).strip() or "ทั่วไป"
        description = str(data.get("description") if "description" in data else (existing["description"] if existing else ""))
        file_type = str(data.get("file_type") or (existing["file_type"] if existing else "docx")).lower()
        storage_filename = str(data.get("storage_filename") or (existing["storage_filename"] if existing else ""))
        created_by = str(data.get("created_by") or (existing["created_by"] if existing else actor_email)).strip().lower()

        with self._conn() as conn:
            if existing:
                conn.execute(
                    f"""
                    UPDATE document_templates SET
                      name={p}, category={p}, description={p}, file_type={p}, storage_filename={p},
                      fields_schema_json={p}, is_active={p}, updated_at={p}
                    WHERE id={p}
                    """,
                    (name, category, description, file_type, storage_filename, schema_json, is_active_db, now, tpl_id),
                )
            else:
                conn.execute(
                    f"""
                    INSERT INTO document_templates (
                      id, name, category, description, file_type, storage_filename,
                      fields_schema_json, is_active, created_by, created_at, updated_at
                    ) VALUES ({','.join([p] * 11)})
                    """,
                    (tpl_id, name, category, description, file_type, storage_filename, schema_json, is_active_db, created_by, now, now),
                )
        res = self.get_document_template(tpl_id)
        assert res is not None
        return res

    def delete_document_template(self, template_id: str) -> bool:
        p = self._ph()
        with self._conn() as conn:
            cur = conn.execute(f"DELETE FROM document_templates WHERE id = {p}", (template_id,))
            return (cur.rowcount or 0) > 0

    # --- In-App Notifications ---
    def create_notification(
        self,
        recipient_email: str,
        event_type: str,
        title: str,
        message: str = "",
        link_url: str = "/approvals",
        actor_email: str = "",
        document_id: str | None = None,
    ) -> dict[str, Any]:
        p = self._ph()
        notif_id = str(uuid.uuid4())
        now = _now_iso()
        is_read_val = False if self.use_pg else 0
        rec = recipient_email.strip().lower()
        with self._conn() as conn:
            conn.execute(
                f"""
                INSERT INTO notifications (id, recipient_email, actor_email, document_id, event_type, title, message, link_url, is_read, created_at)
                VALUES ({','.join([p] * 10)})
                """,
                (notif_id, rec, actor_email.strip().lower(), document_id, event_type, title, message, link_url, is_read_val, now),
            )
            id_cond = f"id::text = {p}" if self.use_pg else f"id = {p}"
            row = conn.execute(f"SELECT * FROM notifications WHERE {id_cond}", (notif_id,)).fetchone()
            out = self._row_to_dict(row) if row else {
                "id": notif_id,
                "recipient_email": rec,
                "actor_email": actor_email,
                "document_id": document_id,
                "event_type": event_type,
                "title": title,
                "message": message,
                "link_url": link_url,
                "is_read": False,
                "created_at": now,
            }
        out["is_read"] = bool(out.get("is_read"))
        if out.get("id") is not None:
            out["id"] = str(out["id"])
        if out.get("document_id") is not None:
            out["document_id"] = str(out["document_id"])
        return out

    def list_notifications(self, identifiers: list[str], unread_only: bool = False, limit: int = 50) -> list[dict[str, Any]]:
        clean = [i.strip().lower() for i in identifiers if i and i.strip()]
        if not clean:
            return []
        p = self._ph()
        placeholders = ",".join([p] * len(clean))
        unread_clause = (" AND is_read = false" if self.use_pg else " AND is_read = 0") if unread_only else ""
        with self._conn() as conn:
            rows = conn.execute(
                f"SELECT * FROM notifications WHERE lower(recipient_email) IN ({placeholders}){unread_clause} "
                f"ORDER BY created_at DESC LIMIT {p}",
                (*clean, int(limit)),
            ).fetchall()
            out = []
            for r in rows:
                d = self._row_to_dict(r)
                d["is_read"] = bool(d.get("is_read"))
                d["id"] = str(d["id"])
                if d.get("document_id") is not None:
                    d["document_id"] = str(d["document_id"])
                out.append(d)
            return out

    def count_unread_notifications(self, identifiers: list[str]) -> int:
        clean = [i.strip().lower() for i in identifiers if i and i.strip()]
        if not clean:
            return 0
        p = self._ph()
        placeholders = ",".join([p] * len(clean))
        read_cond = "is_read = false" if self.use_pg else "is_read = 0"
        with self._conn() as conn:
            row = conn.execute(
                f"SELECT COUNT(*) AS cnt FROM notifications WHERE lower(recipient_email) IN ({placeholders}) AND {read_cond}",
                tuple(clean),
            ).fetchone()
            return int((row or {}).get("cnt", 0) if isinstance(row, dict) else row[0]) if row else 0

    def mark_notification_read(self, notif_id: str, identifiers: list[str]) -> bool:
        clean = [i.strip().lower() for i in identifiers if i and i.strip()]
        if not clean:
            return False
        p = self._ph()
        placeholders = ",".join([p] * len(clean))
        id_cond = f"id::text = {p}" if self.use_pg else f"id = {p}"
        read_val = True if self.use_pg else 1
        with self._conn() as conn:
            cur = conn.execute(
                f"UPDATE notifications SET is_read = {p} WHERE {id_cond} AND lower(recipient_email) IN ({placeholders})",
                (read_val, notif_id, *clean),
            )
            return (cur.rowcount or 0) > 0

    def mark_all_notifications_read(self, identifiers: list[str]) -> int:
        clean = [i.strip().lower() for i in identifiers if i and i.strip()]
        if not clean:
            return 0
        p = self._ph()
        placeholders = ",".join([p] * len(clean))
        read_val = True if self.use_pg else 1
        unread_cond = "is_read = false" if self.use_pg else "is_read = 0"
        with self._conn() as conn:
            cur = conn.execute(
                f"UPDATE notifications SET is_read = {p} WHERE lower(recipient_email) IN ({placeholders}) AND {unread_cond}",
                (read_val, *clean),
            )
            return int(cur.rowcount or 0)

    def delete_notification(self, notif_id: str, identifiers: list[str]) -> bool:
        clean = [i.strip().lower() for i in identifiers if i and i.strip()]
        if not clean:
            return False
        p = self._ph()
        placeholders = ",".join([p] * len(clean))
        id_cond = f"id::text = {p}" if self.use_pg else f"id = {p}"
        with self._conn() as conn:
            cur = conn.execute(
                f"DELETE FROM notifications WHERE {id_cond} AND lower(recipient_email) IN ({placeholders})",
                (notif_id, *clean),
            )
            return (cur.rowcount or 0) > 0


db = Database()
