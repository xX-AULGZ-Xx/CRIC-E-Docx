"""Configurable AI Drafting & Polishing Gateway (Gemini / OpenAI / Local LLM + Offline Fallback)."""

from __future__ import annotations

import json
import re
from typing import Any

import httpx
from fastapi import APIRouter, Header, HTTPException
from pydantic import BaseModel

from app.config import GEMINI_API_KEY, LOCAL_LLM_BASE_URL, OPENAI_API_KEY
from app.db import db
from app.engine.thai_utils import to_thai_digits
from app.routers.auth import resolve_current_user

router = APIRouter(prefix="/v1/ai", tags=["ai"])

SYSTEM_PROMPT = (
    "คุณคือผู้เชี่ยวชาญงานสารบรรณราชการไทยตามระเบียบสำนักนายกรัฐมนตรี ว่าด้วยงานสารบรรณ พ.ศ. 2526 "
    "สำหรับวิทยาลัยการอาชีพเชียงราย ใช้ภาษาสุภาพ กระชับ ชัดเจน "
    "ห้ามใช้คำว่า อนุญาติ(ใช้ อนุญาต), ปรากฎ(ใช้ ปรากฏ), อาทิเช่น, ใคร่, จัก, บริษัทฯ, นาย ๆ ละ "
    "เรื่องใหม่ขึ้นต้นภาคเหตุด้วย 'ด้วย' หรือ 'เนื่องจาก' (ห้ามลงท้าย 'นั้น'); "
    "เรื่องที่เคยติดต่อมาก่อนขึ้นต้นด้วย 'ตามที่' (ลงท้ายด้วย 'ความแจ้งแล้วนั้น') "
    "และใช้เลขไทย (๐-๙) เสมอ"
)


class AISettingsUpdate(BaseModel):
    provider: str  # gemini | openai | local
    model: str
    base_url: str = ""
    api_key: str = ""
    custom_system_prompt: str = ""
    enabled: bool | None = None


class AIToggleRequest(BaseModel):
    enabled: bool


def is_ai_copilot_enabled() -> bool:
    row = db.get_setting("ai_provider")
    val = (row or {}).get("value_json") or {}
    return bool(val.get("enabled", True))


def _require_ai_enabled() -> None:
    if not is_ai_copilot_enabled():
        raise HTTPException(status_code=403, detail="ผู้ดูแลระบบปิดใช้งาน AI Co-pilot ชั่วคราว")


class AIDraftRequest(BaseModel):
    doc_type: str = "memo"
    prompt: str
    division_name: str = "ฝ่ายบริหารทรัพยากร"
    purpose: str = "ขออนุมัติ"
    provider_override: str | None = None


class AIPolishRequest(BaseModel):
    paragraphs: list[str]
    closing_purpose: str = ""
    provider_override: str | None = None


@router.get("/settings")
def get_ai_settings(x_user_email: str | None = Header(default=None)):
    resolve_current_user(x_user_email)
    row = db.get_setting("ai_provider")
    val = (row or {}).get("value_json") or {"provider": "gemini", "model": "gemini-2.5-flash", "base_url": ""}
    # Mask secret status instead of returning raw API key
    return {
        "enabled": bool(val.get("enabled", True)),
        "provider": val.get("provider", "gemini"),
        "model": val.get("model", "gemini-2.5-flash"),
        "base_url": val.get("base_url", ""),
        "custom_system_prompt": val.get("custom_system_prompt", ""),
        "has_custom_key": bool(val.get("api_key")),
        "env_keys": {
            "gemini": bool(GEMINI_API_KEY),
            "openai": bool(OPENAI_API_KEY),
            "local": bool(LOCAL_LLM_BASE_URL),
        },
    }


@router.put("/enabled")
def toggle_ai_copilot(body: AIToggleRequest, x_user_email: str | None = Header(default=None)):
    actor = resolve_current_user(x_user_email)
    if actor["role"] not in ("saraban_admin", "director"):
        raise HTTPException(status_code=403, detail="เฉพาะเจ้าหน้าที่สารบรรณกลางหรือผู้อำนวยการเท่านั้นที่ปิด–เปิด AI Co-pilot ได้")
    existing = (db.get_setting("ai_provider") or {}).get("value_json") or {
        "provider": "gemini",
        "model": "gemini-2.5-flash",
        "base_url": "",
        "custom_system_prompt": "",
        "api_key": "",
    }
    new_val: dict[str, Any] = {**existing, "enabled": bool(body.enabled)}
    db.set_setting("ai_provider", new_val, actor["email"])
    db.add_audit_log(None, actor["email"], "ai_copilot_toggled", {"enabled": bool(body.enabled)})
    return {"ok": True, "enabled": bool(body.enabled)}


@router.put("/settings")
def update_ai_settings(body: AISettingsUpdate, x_user_email: str | None = Header(default=None)):
    actor = resolve_current_user(x_user_email)
    if actor["role"] not in ("saraban_admin", "director"):
        raise HTTPException(status_code=403, detail="เฉพาะเจ้าหน้าที่สารบรรณหรือผู้บริหารเท่านั้นที่ตั้งค่า AI ได้")
    provider = body.provider.strip().lower()
    if provider not in ("gemini", "openai", "local"):
        raise HTTPException(status_code=400, detail="รองรับเฉพาะ provider: gemini, openai, local")

    existing = (db.get_setting("ai_provider") or {}).get("value_json") or {}
    enabled_val = bool(body.enabled) if body.enabled is not None else bool(existing.get("enabled", True))
    new_val: dict[str, Any] = {
        "enabled": enabled_val,
        "provider": provider,
        "model": body.model.strip(),
        "base_url": body.base_url.strip(),
        "custom_system_prompt": body.custom_system_prompt.strip(),
        "api_key": body.api_key.strip() if body.api_key.strip() else existing.get("api_key", ""),
    }
    db.set_setting("ai_provider", new_val, actor["email"])
    db.add_audit_log(None, actor["email"], "ai_settings_updated", {"provider": provider, "model": new_val["model"], "enabled": enabled_val})
    return {"ok": True, "enabled": enabled_val, "provider": provider, "model": new_val["model"], "base_url": new_val["base_url"]}


def _resolve_provider_config(override: str | None = None) -> dict[str, str]:
    saved = ((db.get_setting("ai_provider") or {}).get("value_json")) or {}
    provider = (override or saved.get("provider") or "gemini").lower()
    model = saved.get("model") or ("gemini-2.5-flash" if provider == "gemini" else "gpt-4o-mini" if provider == "openai" else "llama3.1")
    base_url = saved.get("base_url") or (LOCAL_LLM_BASE_URL if provider == "local" else "")
    api_key = saved.get("api_key") or (GEMINI_API_KEY if provider == "gemini" else OPENAI_API_KEY if provider == "openai" else "ollama")
    custom_prompt = saved.get("custom_system_prompt") or ""
    return {"provider": provider, "model": model, "base_url": base_url, "api_key": api_key, "custom_prompt": custom_prompt}


async def _call_llm_json(user_prompt: str, cfg: dict[str, str]) -> dict[str, Any] | None:
    provider = cfg["provider"]
    api_key = cfg["api_key"]
    sys_prompt = SYSTEM_PROMPT + (f"\nข้อกำหนดเพิ่มเติม: {cfg['custom_prompt']}" if cfg.get("custom_prompt") else "")

    if provider == "gemini":
        if not api_key:
            return None
        url = f"https://generativelanguage.googleapis.com/v1beta/models/{cfg['model']}:generateContent?key={api_key}"
        payload = {
            "system_instruction": {"parts": [{"text": sys_prompt}]},
            "contents": [{"parts": [{"text": user_prompt}]}],
            "generationConfig": {"responseMimeType": "application/json"},
        }
        async with httpx.AsyncClient(timeout=30.0) as client:
            r = await client.post(url, json=payload)
            if r.status_code == 200:
                txt = r.json()["candidates"][0]["content"]["parts"][0]["text"]
                return json.loads(txt)
        return None

    # OpenAI or Local OpenAI-compatible (Ollama/vLLM)
    if provider == "openai" and not api_key:
        return None
    endpoint = (cfg["base_url"].rstrip("/") if cfg["base_url"] else "https://api.openai.com/v1") + "/chat/completions"
    headers = {"Authorization": f"Bearer {api_key}"} if api_key else {}
    payload = {
        "model": cfg["model"],
        "messages": [
            {"role": "system", "content": sys_prompt + " ตอบเป็น JSON เท่านั้น"},
            {"role": "user", "content": user_prompt},
        ],
        "temperature": 0.3,
    }
    try:
        async with httpx.AsyncClient(timeout=30.0) as client:
            r = await client.post(endpoint, headers=headers, json=payload)
            if r.status_code == 200:
                content = r.json()["choices"][0]["message"]["content"]
                m = re.search(r"\{.*\}", content, flags=re.DOTALL)
                return json.loads(m.group(0) if m else content)
    except Exception:
        return None
    return None


def _offline_draft_fallback(req: AIDraftRequest) -> dict[str, Any]:
    prompt_clean = to_thai_digits(req.prompt.strip())
    closing_map = {
        "ขออนุมัติ": "จึงเรียนมาเพื่อโปรดพิจารณาอนุมัติ",
        "แจ้งเพื่อทราบ": "จึงเรียนมาเพื่อโปรดทราบ",
        "ขอความอนุเคราะห์": "จึงเรียนมาเพื่อโปรดพิจารณาอนุเคราะห์ด้วย จะเป็นพระคุณ",
        "เชิญเป็นวิทยากร": "จึงเรียนมาเพื่อโปรดพิจารณารับเชิญ ด้วยจะเป็นพระคุณ",
        "รายงานผล": "จึงเรียนมาเพื่อโปรดทราบ และพิจารณาดำเนินการต่อไปด้วย จะเป็นพระคุณ",
    }
    closing = closing_map.get(req.purpose, "จึงเรียนมาเพื่อโปรดพิจารณา")
    subject_snippet = prompt_clean[:70].rstrip("。")
    return {
        "subject": f"{req.purpose}{subject_snippet}" if not subject_snippet.startswith(req.purpose) else subject_snippet,
        "paragraphs": [
            f"ด้วย{req.division_name} วิทยาลัยการอาชีพเชียงราย มีความประสงค์จะดำเนินการเรื่อง {prompt_clean} เพื่อให้การปฏิบัติราชการเป็นไปด้วยความเรียบร้อยและบรรลุวัตถุประสงค์ของสถานศึกษา",
            "ในการนี้ จึงขอเสนอเรื่องดังกล่าวต่อผู้บังคับบัญชาเพื่อโปรดพิจารณาให้ความเห็นชอบตามระเบียบทางราชการต่อไป",
        ],
        "closing_purpose": closing,
        "mode": "offline_saraban_template",
    }


def _offline_polish(text: str) -> str:
    replacements = [
        ("อนุญาติ", "อนุญาต"),
        ("ปรากฎ", "ปรากฏ"),
        ("กฏหมาย", "กฎหมาย"),
        ("กระทันหัน", "กะทันหัน"),
        ("คำนวน", "คำนวณ"),
        ("บุคคลากร", "บุคลากร"),
        ("สังเกตุ", "สังเกต"),
        ("อาทิเช่น", "อาทิ"),
        ("ใคร่ขอ", "ขอ"),
        ("จะทำการ", "จะ"),
        ("ใช้เวลาในการ", "ใช้เวลา"),
        ("หน่วยงานของท่าน", "ส่วนราชการ"),
        ("อยากขอ", "มีความประสงค์ขอ"),
        ("ช่วยดำเนินการ", "โปรดอนุเคราะห์ดำเนินการ"),
    ]
    out = text.strip()
    for wrong, right in replacements:
        out = out.replace(wrong, right)
    return to_thai_digits(out)


@router.post("/draft")
async def ai_draft(req: AIDraftRequest, x_user_email: str | None = Header(default=None)):
    resolve_current_user(x_user_email)
    _require_ai_enabled()
    cfg = _resolve_provider_config(req.provider_override)
    instruction = (
        f"ร่างหนังสือราชการประเภท '{req.doc_type}' ของ '{req.division_name}' วิทยาลัยการอาชีพเชียงราย "
        f"วัตถุประสงค์ '{req.purpose}' จากโจทย์: {req.prompt}\n"
        'คืนค่า JSON รูปแบบ: {"subject": "...", "paragraphs": ["ภาคเหตุ", "ภาคความประสงค์"], "closing_purpose": "..."}'
    )
    llm_res = await _call_llm_json(instruction, cfg)
    if llm_res and "paragraphs" in llm_res:
        llm_res["subject"] = to_thai_digits(str(llm_res.get("subject", "")))
        llm_res["paragraphs"] = [to_thai_digits(str(p)) for p in llm_res.get("paragraphs", [])]
        llm_res["closing_purpose"] = to_thai_digits(str(llm_res.get("closing_purpose", "")))
        llm_res["mode"] = f"{cfg['provider']}:{cfg['model']}"
        return llm_res
    return _offline_draft_fallback(req)


@router.post("/polish")
async def ai_polish(req: AIPolishRequest, x_user_email: str | None = Header(default=None)):
    resolve_current_user(x_user_email)
    _require_ai_enabled()
    cfg = _resolve_provider_config(req.provider_override)
    instruction = (
        "ปรับเกลาข้อความต่อไปนี้ให้เป็นภาษาราชการไทยที่ถูกต้องตามคู่มือ ก.พ. และระเบียบงานสารบรรณ พ.ศ. 2526 "
        "ใช้เลขไทย (๐-๙) และคงความหมายเดิมไว้ครบถ้วน:\n"
        + json.dumps({"paragraphs": req.paragraphs, "closing_purpose": req.closing_purpose}, ensure_ascii=False)
        + '\nคืนค่า JSON รูปแบบ: {"paragraphs": [...], "closing_purpose": "..."}'
    )
    llm_res = await _call_llm_json(instruction, cfg)
    if llm_res and "paragraphs" in llm_res:
        return {
            "paragraphs": [to_thai_digits(str(p)) for p in llm_res.get("paragraphs", [])],
            "closing_purpose": to_thai_digits(str(llm_res.get("closing_purpose", req.closing_purpose))),
            "mode": f"{cfg['provider']}:{cfg['model']}",
        }
    return {
        "paragraphs": [_offline_polish(p) for p in req.paragraphs],
        "closing_purpose": _offline_polish(req.closing_purpose),
        "mode": "offline_rule_polish",
    }


class AIDraftSPRequest(BaseModel):
    project_name: str
    department_name: str = "แผนกวิชา"
    budget_hint: float | None = None
    prompt: str = ""
    provider_override: str | None = None


class AIDraftTeachingRequest(BaseModel):
    mode: str = "course_plan"  # course_plan | post_teaching
    course_code: str = ""
    course_name: str = ""
    curriculum_level: str = "ปวช."
    description: str = ""
    prompt: str = ""
    provider_override: str | None = None


@router.post("/draft-sp")
async def ai_draft_sp(req: AIDraftSPRequest, x_user_email: str | None = Header(default=None)):
    resolve_current_user(x_user_email)
    _require_ai_enabled()
    cfg = _resolve_provider_config(req.provider_override)
    instruction = (
        f"ช่วยออกแบบชุดจัดซื้อวัสดุฝึกโครงการ '{req.project_name}' สำหรับ '{req.department_name}' "
        f"งบประมาณโดยประมาณ: {req.budget_hint or 'ไม่ระบุ'} บาท รายละเอียดเพิ่มเติม: {req.prompt}\n"
        'คืนค่า JSON รูปแบบ: {"objectives": ["ข้อ 1", "ข้อ 2"], "expected_outcome": "...", '
        '"tor_background": "...", "tor_objective": "...", '
        '"items": [{"name": "ชื่อรายการ", "spec": "คุณลักษณะย่อ", "qty": 1, "unit": "ชุด", "unit_price": 500, "note": ""}]}'
    )
    llm_res = await _call_llm_json(instruction, cfg)
    if llm_res and "items" in llm_res:
        llm_res["mode"] = f"{cfg['provider']}:{cfg['model']}"
        return llm_res
    budget = float(req.budget_hint or 1500)
    return {
        "objectives": [
            f"จัดซื้อวัสดุฝึก{req.project_name} เพื่อใช้ในการจัดการเรียนการสอนภาคปฏิบัติ",
            "พัฒนาทักษะวิชาชีพของผู้เรียนให้ได้มาตรฐานตามหลักสูตรอาชีวศึกษา",
        ],
        "expected_outcome": f"ผู้เรียนมีวัสดุอุปกรณ์ฝึกปฏิบัติครบถ้วนสำหรับ {req.project_name}",
        "tor_background": f"ด้วย {req.department_name} มีความประสงค์จัดซื้อวัสดุฝึกเพื่อใช้ประกอบการเรียนการสอนในโครงการ {req.project_name} ให้เกิดประสิทธิภาพสูงสุด",
        "tor_objective": f"จัดซื้อวัสดุฝึก {req.project_name} เพื่อสนับสนุนการเรียนการสอนภาคปฏิบัติของ {req.department_name}",
        "items": [
            {
                "name": f"วัสดุฝึกหลักสำหรับ {req.project_name}",
                "spec": "ตามมาตรฐานงานฝึกปฏิบัติการวิชาชีพ",
                "qty": 1,
                "unit": "ชุด",
                "unit_price": budget,
                "note": "",
            }
        ],
        "mode": "offline_sp_template",
    }


@router.post("/draft-teaching")
async def ai_draft_teaching(req: AIDraftTeachingRequest, x_user_email: str | None = Header(default=None)):
    resolve_current_user(x_user_email)
    _require_ai_enabled()
    cfg = _resolve_provider_config(req.provider_override)
    if req.mode == "post_teaching":
        instruction = (
            f"ช่วยสรุปผลการจัดการเรียนการสอนและแนวทางพัฒนาสำหรับรายวิชา '{req.course_code} {req.course_name}' "
            f"บริบทเพิ่มเติม: {req.prompt}\n"
            'คืนค่า JSON รูปแบบ: {"weekly_attendance": "...", "evaluation_summary": "...", "problems": "...", "solutions": "...", '
            '"assignment": "...", "topics": ["หัวข้อ 1", "หัวข้อ 2"], "outcomes": ["ผลลัพธ์ 1", "ผลลัพธ์ 2"]}'
        )
        llm_res = await _call_llm_json(instruction, cfg)
        if llm_res and "evaluation_summary" in llm_res:
            llm_res["mode"] = f"{cfg['provider']}:{cfg['model']}"
            return llm_res
        cname = req.course_name or req.course_code or "รายวิชา"
        return {
            "weekly_attendance": "ผู้เรียนเข้าเรียนและร่วมฝึกปฏิบัติครบตามแผนการจัดการเรียนรู้อย่างสม่ำเสมอ",
            "evaluation_summary": f"ผู้เรียนในรายวิชา {cname} มีส่วนร่วมในการปฏิบัติงานและผ่านเกณฑ์การประเมินตามจุดประสงค์เชิงพฤติกรรม",
            "problems": "ผู้เรียนบางส่วนต้องฝึกทักษะพื้นฐานและลำดับขั้นตอนการทำงานเพิ่มเติมในภาคปฏิบัติ",
            "solutions": "จัดกิจกรรมการฝึกปฏิบัติแบบจับคู่เพื่อนช่วยเพื่อน มอบหมายแบบฝึกทบทวน และติดตามผลรายบุคคล",
            "assignment": f"แบบฝึกปฏิบัติและใบงานสรุปองค์ความรู้ประจำหน่วยวิชา {cname}",
            "topics": [f"บทนำและการประยุกต์ใช้งาน {cname}", "ฝึกปฏิบัติการตามใบงานและประเมินสมรรถนะ"],
            "outcomes": ["อธิบายหลักการสำคัญและขั้นตอนการปฏิบัติงานได้ถูกต้อง", "ปฏิบัติตามใบงานสำเร็จตามเกณฑ์มาตรฐานความปลอดภัย"],
            "mode": "offline_teaching_template",
        }

    instruction = (
        f"สร้างโครงสร้างรายวิชาและแผนการจัดการเรียนรู้ 18 สัปดาห์ ระดับ {req.curriculum_level} "
        f"รหัสวิชา '{req.course_code}' ชื่อวิชา '{req.course_name}' คำอธิบาย: '{req.description}' บริบท: '{req.prompt}'\n"
        'คืนค่า JSON รูปแบบ: {"objectives": ["..."], "standards": ["..."], "description": "...", '
        '"knowledge": ["..."], "skills": ["..."], "morals": ["..."], "indicators": ["..."], "evaluation_criteria": ["..."], '
        '"equipment": [{"category": "...", "item": "...", "purpose": "..."}], '
        '"assessment": [{"domain": "...", "weight": "30%", "method": "...", "criteria": "..."}], '
        '"rubric": [{"dimension": "...", "level4": "...", "level3": "...", "level2": "...", "level1": "..."}], '
        '"weekly_plan": [{"week": 1, "topic": "...", "subtopics": "...", "behavioral_objectives": "...", '
        '"activities": "...", "media": "...", "evaluation": "...", "competency": "...", "theory_hours": 1, "practice_hours": 3}]}'
    )
    llm_res = await _call_llm_json(instruction, cfg)
    if llm_res and "weekly_plan" in llm_res:
        llm_res["mode"] = f"{cfg['provider']}:{cfg['model']}"
        return llm_res

    name = req.course_name or "รายวิชา"
    weeks = []
    for w in range(1, 19):
        if w == 9:
            topic = "ทบทวนและประเมินผลสัมฤทธิ์กลางภาคเรียน"
        elif w == 18:
            topic = "สรุปองค์ความรู้และประเมินผลสัมฤทธิ์ปลายภาคเรียน"
        else:
            topic = f"หน่วยการเรียนรู้ที่ {w}: หลักการและปฏิบัติการ {name} (ตอนที่ {w})"
        weeks.append(
            {
                "week": w,
                "topic": topic,
                "subtopics": f"สาระสำคัญและขั้นตอนการปฏิบัติงานเรื่อง {topic}",
                "behavioral_objectives": f"ผู้เรียนสามารถอธิบายหลักการและปฏิบัติงานตามหัวข้อ {topic} ได้อย่างถูกต้อง",
                "activities": "ภาคทฤษฎี: บรรยายและสาธิต / ภาคปฏิบัติ: ฝึกปฏิบัติตามใบงาน",
                "media": f"สื่อนำเสนอ, เอกสารประกอบการสอน, ชุดฝึกปฏิบัติวิชา {name}",
                "evaluation": f"แบบสังเกตพฤติกรรมและตรวจใบงานสัปดาห์ที่ {w}",
                "competency": f"ปฏิบัติงานตามมาตรฐานในหัวข้อ {topic} ได้",
                "theory_hours": 1,
                "practice_hours": 3,
            }
        )
    return {
        "objectives": [
            f"เข้าใจหลักการและกระบวนการทำงานพื้นฐานในรายวิชา {name}",
            f"มีทักษะการปฏิบัติงานและการประยุกต์ใช้เครื่องมือด้าน {name}",
            "มีคุณธรรม จริยธรรม และเจตคติที่ดีในการประกอบอาชีพ",
        ],
        "standards": [
            f"แสดงความรู้เกี่ยวกับหลักการพื้นฐานของ {name}",
            f"ปฏิบัติงานด้าน {name} ตามขั้นตอนและมาตรฐานความปลอดภัย",
        ],
        "description": req.description or f"ศึกษาและปฏิบัติเกี่ยวกับหลักการพื้นฐาน การใช้งานเครื่องมือ และการประยุกต์ใช้ {name} ในงานอาชีพ",
        "knowledge": [f"หลักการ ทฤษฎี และโครงสร้างองค์ประกอบของ {name}"],
        "skills": [f"วางแผน ออกแบบ และลงมือปฏิบัติงาน {name} ได้ตามมาตรฐาน"],
        "morals": [
            "ความมีวินัย ตรงต่อเวลา และปฏิบัติงานตามกฎความปลอดภัยอย่างเคร่งครัด",
            "ความซื่อสัตย์สุจริต ความรับผิดชอบ และการทำงานร่วมกับผู้อื่นได้",
        ],
        "indicators": [
            f"ผู้เรียนผ่านเกณฑ์การประเมินด้านความรู้และทักษะปฏิบัติวิชา {name} ไม่น้อยกว่าร้อยละ 70",
            "ผู้เรียนมีเวลาเรียนไม่น้อยกว่าร้อยละ 80 ของเวลาเรียนทั้งหมด",
        ],
        "evaluation_criteria": [
            "ด้านความรู้ (สอบย่อย/กลางภาค/ปลายภาค) ร้อยละ 30",
            "ด้านทักษะปฏิบัติ (ใบงาน/ชิ้นงาน/ทดสอบปฏิบัติ) ร้อยละ 50",
            "ด้านคุณธรรม จริยธรรม และจิตพิสัย ร้อยละ 20",
        ],
        "equipment": [
            {"category": "เอกสารและสื่อประกอบการสอน", "item": f"เอกสารประกอบการสอน สไลด์ และใบงานวิชา {name}", "purpose": "อธิบายหลักการ ขั้นตอน และแบบฝึกปฏิบัติ"},
            {"category": "อุปกรณ์/เครื่องมือปฏิบัติการ", "item": f"ชุดฝึกปฏิบัติและเครื่องมือมาตรฐานวิชา {name}", "purpose": "ใช้ฝึกทักษะปฏิบัติจริงตามสมรรถนะอาชีพ"},
            {"category": "สื่อดิจิทัลและแหล่งสืบค้น", "item": "ห้องเรียนออนไลน์ คลังใบความรู้ และสื่อวิดีทัศน์สาธิต", "purpose": "ทบทวนความรู้เพิ่มเติมและส่งมอบหมายงาน"},
        ],
        "assessment": [
            {"domain": "พุทธิพิสัย (Cognitive)", "weight": "30%", "method": "แบบทดสอบย่อย กลางภาค และปลายภาค", "criteria": f"อธิบายหลักการของ {name} ได้ถูกต้อง"},
            {"domain": "ทักษะพิสัย (Psychomotor)", "weight": "50%", "method": "ประเมินใบงานและการปฏิบัติงานจริง", "criteria": "ปฏิบัติงานครบขั้นตอนและได้มาตรฐาน"},
            {"domain": "จิตพิสัย (Affective)", "weight": "20%", "method": "สังเกตพฤติกรรม การเข้าชั้นเรียน วินัย", "criteria": "เวลาเรียนไม่น้อยกว่า 80% และส่งงานตรงเวลา"},
        ],
        "rubric": [
            {
                "dimension": f"1. ความเข้าใจหลักการวิชา {name}",
                "level4": "อธิบายเชื่อมโยงหลักการและวิเคราะห์ปัญหาได้ครบถ้วน",
                "level3": "อธิบายหลักการสำคัญได้ถูกต้องครบถ้วน",
                "level2": "อธิบายได้บางส่วน ต้องได้รับคำแนะนำ",
                "level1": "ยังไม่สามารถอธิบายหลักการพื้นฐานได้",
            },
            {
                "dimension": "2. ทักษะปฏิบัติงานและความปลอดภัย",
                "level4": "ปฏิบัติงานถูกต้อง แม่นยำ เสร็จตรงเวลา และปลอดภัยดีเยี่ยม",
                "level3": "ปฏิบัติงานสำเร็จตามขั้นตอนหลักและปลอดภัย",
                "level2": "ปฏิบัติงานได้บางส่วน ต้องมีผู้กำกับดูแล",
                "level1": "ปฏิบัติงานไม่สำเร็จหรือผิดขั้นตอนสำคัญ",
            },
        ],
        "weekly_plan": weeks,
        "mode": "offline_teaching_template",
    }


class AITemplateFillRequest(BaseModel):
    template_id: str | None = None
    template_name: str = ""
    fields_schema: list[dict[str, Any]] = []
    prompt: str
    provider_override: str | None = None


@router.post("/fill-template")
async def ai_fill_custom_template(req: AITemplateFillRequest, x_user_email: str | None = Header(default=None)):
    resolve_current_user(x_user_email)
    _require_ai_enabled()
    cfg = _resolve_provider_config(req.provider_override)
    schema = req.fields_schema or []
    if req.template_id and not schema:
        from app.db import db

        tpl = db.get_document_template(req.template_id)
        if tpl:
            schema = tpl.get("fields_schema_json") or []
            if not req.template_name:
                req.template_name = tpl.get("name", "")

    main_fields = [f for f in schema if f.get("group", "main") != "items" and f.get("field_type") != "image"]
    item_fields = [f for f in schema if f.get("group") == "items"]

    schema_desc = [
        {
            "key": f.get("key"),
            "label": f.get("label") or f.get("key"),
            "type": f.get("field_type", "text"),
            "options": f.get("options") or [],
        }
        for f in main_fields
    ]
    item_desc = [
        {"key": f.get("key"), "label": f.get("label") or f.get("key"), "type": f.get("field_type", "text")}
        for f in item_fields
    ]

    instruction = (
        f"ช่วยกรอกข้อมูลลงแบบฟอร์มเอกสารราชการไทย '{req.template_name}' ตามคำสั่งของผู้ใช้: {req.prompt}\n"
        f"โครงสร้างฟิลด์หลัก: {json.dumps(schema_desc, ensure_ascii=False)}\n"
        f"โครงสร้างแถวตาราง items (ถ้ามี): {json.dumps(item_desc, ensure_ascii=False)}\n"
        'คืนค่า JSON เท่านั้น รูปแบบ: {"fields": {"<key>": "ค่า..."}, "items": [{"<col>": "ค่า..."}]}\n'
        "ข้อกำหนด: ฟิลด์ type=date ให้ตอบรูปแบบ YYYY-MM-DD (ค.ศ.), type=number ให้ตอบเป็นตัวเลขล้วน, ข้อความราชการไทยใช้ภาษาสุภาพ"
    )
    llm_res = await _call_llm_json(instruction, cfg)
    if llm_res and isinstance(llm_res.get("fields"), dict):
        return {
            "fields": llm_res["fields"],
            "items": llm_res.get("items") if isinstance(llm_res.get("items"), list) else [],
            "mode": f"{cfg['provider']}:{cfg['model']}",
        }

    # Deterministic offline fallback
    import datetime as _dt

    today_iso = _dt.date.today().isoformat()
    out_fields: dict[str, Any] = {}
    prompt_clean = (req.prompt or "").strip()
    for f in main_fields:
        k = str(f.get("key") or "")
        lbl = str(f.get("label") or k)
        ftype = f.get("field_type", "text")
        if f.get("default_value"):
            out_fields[k] = f["default_value"]
        elif ftype == "date":
            out_fields[k] = today_iso
        elif ftype == "number":
            out_fields[k] = 1000
        elif ftype == "select" and f.get("options"):
            out_fields[k] = f["options"][0]
        elif ftype == "textarea":
            out_fields[k] = f"ตามที่ได้รับมอบหมายให้ดำเนินการเรื่อง {prompt_clean or req.template_name or lbl} เพื่อให้การปฏิบัติงานเป็นไปด้วยความเรียบร้อยและเกิดประสิทธิภาพสูงสุด"
        else:
            out_fields[k] = prompt_clean[:80] if (k in ("subject", "เรื่อง", "ชื่อเรื่อง", "title") and prompt_clean) else f"{lbl}: {prompt_clean[:40] or 'วิทยาลัยการอาชีพเชียงราย'}"

    out_items: list[dict[str, Any]] = []
    if item_fields:
        sample_row: dict[str, Any] = {}
        for f in item_fields:
            k = str(f.get("key") or "")
            ftype = f.get("field_type", "text")
            if ftype == "number":
                sample_row[k] = 1
            elif ftype == "date":
                sample_row[k] = today_iso
            else:
                sample_row[k] = f"รายการสำหรับ {prompt_clean[:30] or req.template_name or k}"
        out_items.append(sample_row)

    return {"fields": out_fields, "items": out_items, "mode": "offline_template_fill"}
