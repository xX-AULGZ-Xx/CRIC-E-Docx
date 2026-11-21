"""Admin & system settings endpoints (/v1/settings)."""

from __future__ import annotations

import json
import shutil
import subprocess
import time
from pathlib import Path
from typing import Any

import httpx
from fastapi import APIRouter, Header, HTTPException, Request
from pydantic import BaseModel

from app.config import (
    ALLOWED_EMAIL_DOMAIN,
    AUTH_DEV_MODE,
    GEMINI_API_KEY,
    LOCAL_LLM_BASE_URL,
    OPENAI_API_KEY,
    PANEL_API_TOKEN,
    PANEL_API_URL,
    PANEL_SYNC_SECRET,
    RENDERED_DIR,
    SSO_CLIENT_ID,
    SSO_CLIENT_SECRET,
    SSO_ISSUER,
    SSO_REALM,
)
from app.db import db
from app.engine.generate_doc import load_defaults
from app.routers.auth import resolve_current_user
from app.services.notifier import send_webhook_message

router = APIRouter(prefix="/v1/settings", tags=["settings"])


def _require_admin(x_user_email: str | None) -> dict[str, Any]:
    actor = resolve_current_user(x_user_email)
    if actor["role"] not in ("saraban_admin", "director"):
        raise HTTPException(status_code=403, detail="เฉพาะเจ้าหน้าที่สารบรรณกลางหรือผู้อำนวยการเท่านั้นที่เข้าถึงการตั้งค่าหลังบ้านได้")
    return actor


def _mask(val: str) -> dict[str, Any]:
    clean = (val or "").strip()
    if not clean:
        return {"has_secret": False, "masked_preview": ""}
    tail = clean[-4:] if len(clean) > 4 else ""
    return {"has_secret": True, "masked_preview": f"••••{tail}"}


def get_effective_org_profile() -> dict[str, Any]:
    file_defaults = load_defaults()
    saved = db.get_setting_json("org_profile", {})
    merged = {**file_defaults, **saved}
    default_divs = file_defaults.get("divisions", {})
    if not merged.get("divisions"):
        merged["divisions"] = default_divs
    else:
        enriched_divs: dict[str, Any] = {}
        for code, info in merged["divisions"].items():
            if isinstance(info, dict):
                default_units = (default_divs.get(code) or {}).get("units", [])
                enriched_divs[code] = {
                    **info,
                    "units": info["units"] if "units" in info and isinstance(info["units"], list) else list(default_units),
                }
        merged["divisions"] = enriched_divs
    if not merged.get("director"):
        merged["director"] = file_defaults.get("director", {})
    default_sp1 = file_defaults.get(
        "sp1_signers",
        {
            "plan_head": "นายเจษฎา คำเรือง",
            "deputy_plan": "นายพุทธิพัชร์ ธนพัทธ์ปัญญา",
            "supplies_head": "นายปรีชา ปู่จาด",
            "deputy_resource": "นางสาวอรวรรณ แสงดาว",
        },
    )
    merged["sp1_signers"] = {**default_sp1, **(merged.get("sp1_signers") or {})}
    return merged


def get_effective_integrations() -> dict[str, Any]:
    saved = db.get_setting_json("integrations", {})
    return {
        "sso_issuer": saved.get("sso_issuer", SSO_ISSUER),
        "sso_realm": saved.get("sso_realm", SSO_REALM),
        "sso_client_id": saved.get("sso_client_id", SSO_CLIENT_ID),
        "sso_client_secret": saved.get("sso_client_secret", SSO_CLIENT_SECRET),
        "allowed_domain": saved.get("allowed_domain", ALLOWED_EMAIL_DOMAIN),
        "auth_dev_mode": saved.get("auth_dev_mode", AUTH_DEV_MODE),
        "panel_api_url": saved.get("panel_api_url", PANEL_API_URL),
        "panel_api_token": saved.get("panel_api_token", PANEL_API_TOKEN),
        "panel_sync_secret": saved.get("panel_sync_secret", PANEL_SYNC_SECRET),
        "repair_system_url": saved.get("repair_system_url", ""),
        "short_course_url": saved.get("short_course_url", ""),
        "student_screening_url": saved.get("student_screening_url", ""),
        "project_system_url": saved.get("project_system_url", "https://plan.cric.ac.th"),
        "plan_users_api_path": saved.get("plan_users_api_path", ""),
        "evaluation_system_url": saved.get("evaluation_system_url", ""),
        "auto_sync_enabled": bool(saved.get("auto_sync_enabled", True)),
        "auto_sync_interval_minutes": max(5, min(1440, int(saved.get("auto_sync_interval_minutes", 30) or 30))),
        "auto_sync_sources": saved.get("auto_sync_sources", "both") if saved.get("auto_sync_sources") in ("panel", "plan", "both") else "both",
        "auto_sync_on_startup": bool(saved.get("auto_sync_on_startup", True)),
    }


def get_effective_linter_rules() -> dict[str, Any]:
    saved = db.get_setting_json("linter_rules", {})
    return {
        "custom_misspellings": saved.get("custom_misspellings") or {},
        "custom_forbidden_phrases": saved.get("custom_forbidden_phrases") or [],
    }


class DivisionEntry(BaseModel):
    name: str
    deputy_title: str
    units: list[str] = []


class DirectorInfo(BaseModel):
    name: str
    title: str


class SP1SignersInfo(BaseModel):
    plan_head: str = ""
    deputy_plan: str = ""
    supplies_head: str = ""
    deputy_resource: str = ""


class OrgProfileUpdate(BaseModel):
    organization_name: str
    address_lines: list[str]
    doc_number_prefix: str
    phone_fax: str = ""
    esaraban_name: str = ""
    email: str = ""
    director: DirectorInfo
    sp1_signers: SP1SignersInfo | None = None
    divisions: dict[str, DivisionEntry]


class IntegrationsUpdate(BaseModel):
    sso_issuer: str
    sso_realm: str = "cric-college"
    sso_client_id: str = ""
    sso_client_secret: str = ""
    allowed_domain: str = "cric.ac.th"
    auth_dev_mode: bool = True
    panel_api_url: str = "http://localhost:3000"
    panel_api_token: str = ""
    panel_sync_secret: str = ""
    repair_system_url: str = ""
    short_course_url: str = ""
    student_screening_url: str = ""
    project_system_url: str = "https://plan.cric.ac.th"
    plan_users_api_path: str = ""
    evaluation_system_url: str = ""
    auto_sync_enabled: bool = True
    auto_sync_interval_minutes: int = 30
    auto_sync_sources: str = "both"  # panel | plan | both
    auto_sync_on_startup: bool = True


class IntegrationTestRequest(BaseModel):
    target: str  # sso | panel | plan


class NotificationsUpdate(BaseModel):
    enabled: bool = False
    provider: str = "custom_webhook"  # telegram | discord | custom_webhook
    webhook_url: str = ""
    telegram_chat_id: str = ""
    events: list[str] = ["submitted", "approved", "returned", "numbered"]


class LinterAndDefaultsUpdate(BaseModel):
    default_font: str = "TH Sarabun New"
    auto_preview_default: bool = True
    custom_misspellings: dict[str, str] = {}
    custom_forbidden_phrases: list[str] = []


@router.get("/public")
def get_public_settings(x_user_email: str | None = Header(default=None)):
    resolve_current_user(x_user_email)
    org = get_effective_org_profile()
    font_row = db.get_setting_json("default_font", {"font_family": "TH Sarabun New", "auto_preview_default": True})
    ai_cfg = db.get_setting_json("ai_provider", {"enabled": True})
    return {
        "org_profile": org,
        "default_font": font_row.get("font_family", "TH Sarabun New"),
        "auto_preview_default": bool(font_row.get("auto_preview_default", True)),
        "ai_copilot_enabled": bool(ai_cfg.get("enabled", True)),
    }


@router.get("/draft-roster")
def get_draft_roster(x_user_email: str | None = Header(default=None)):
    """Return read-only personnel & preset groups roster from the 1 Oct 2569 order for drafting."""
    resolve_current_user(x_user_email)
    roster_path = Path(__file__).resolve().parent.parent.parent / "resources" / "order_personnel_roster.json"
    if not roster_path.exists():
        return {"source_order": "", "personnel": [], "groups": []}
    with roster_path.open("r", encoding="utf-8") as fh:
        return json.load(fh)


@router.get("/admin")
def get_admin_settings(x_user_email: str | None = Header(default=None)):
    _require_admin(x_user_email)
    org = get_effective_org_profile()
    integ = get_effective_integrations()
    notif = db.get_setting_json(
        "notifications",
        {"enabled": False, "provider": "custom_webhook", "webhook_url": "", "telegram_chat_id": "", "events": ["submitted", "approved", "returned", "numbered"]},
    )
    ai_cfg = db.get_setting_json(
        "ai_provider",
        {"provider": "gemini", "model": "gemini-2.5-flash", "base_url": "", "custom_system_prompt": ""},
    )
    font_cfg = db.get_setting_json("default_font", {"font_family": "TH Sarabun New", "auto_preview_default": True})
    linter_cfg = get_effective_linter_rules()

    return {
        "org_profile": org,
        "integrations": {
            "sso_issuer": integ["sso_issuer"],
            "sso_realm": integ.get("sso_realm", "cric-college"),
            "sso_client_id": integ["sso_client_id"],
            "sso_client_secret_info": _mask(integ["sso_client_secret"]),
            "allowed_domain": integ["allowed_domain"],
            "auth_dev_mode": bool(integ["auth_dev_mode"]),
            "panel_api_url": integ["panel_api_url"],
            "panel_api_token_info": _mask(integ["panel_api_token"]),
            "panel_sync_secret_info": _mask(integ.get("panel_sync_secret", "")),
            "repair_system_url": integ.get("repair_system_url", ""),
            "short_course_url": integ.get("short_course_url", ""),
            "student_screening_url": integ.get("student_screening_url", ""),
            "project_system_url": integ.get("project_system_url", "https://plan.cric.ac.th"),
            "plan_users_api_path": integ.get("plan_users_api_path", ""),
            "evaluation_system_url": integ.get("evaluation_system_url", ""),
            "auto_sync_enabled": bool(integ.get("auto_sync_enabled", True)),
            "auto_sync_interval_minutes": int(integ.get("auto_sync_interval_minutes", 30)),
            "auto_sync_sources": integ.get("auto_sync_sources", "both"),
            "auto_sync_on_startup": bool(integ.get("auto_sync_on_startup", True)),
            "sync_status": db.get_setting_json("user_sync_status", {}),
        },
        "notifications": {
            "enabled": bool(notif.get("enabled", False)),
            "provider": notif.get("provider", "custom_webhook"),
            "webhook_url_info": _mask(notif.get("webhook_url", "")),
            "telegram_chat_id": notif.get("telegram_chat_id", ""),
            "events": notif.get("events", ["submitted", "approved", "returned", "numbered"]),
        },
        "ai_provider": {
            "enabled": bool(ai_cfg.get("enabled", True)),
            "provider": ai_cfg.get("provider", "gemini"),
            "model": ai_cfg.get("model", "gemini-2.5-flash"),
            "base_url": ai_cfg.get("base_url", ""),
            "custom_system_prompt": ai_cfg.get("custom_system_prompt", ""),
            "api_key_info": _mask(ai_cfg.get("api_key", "")),
            "env_keys": {
                "gemini": bool(GEMINI_API_KEY),
                "openai": bool(OPENAI_API_KEY),
                "local": bool(LOCAL_LLM_BASE_URL),
            },
        },
        "default_font": font_cfg.get("font_family", "TH Sarabun New"),
        "auto_preview_default": bool(font_cfg.get("auto_preview_default", True)),
        "linter_rules": linter_cfg,
    }


@router.put("/org-profile")
def update_org_profile(body: OrgProfileUpdate, x_user_email: str | None = Header(default=None)):
    actor = _require_admin(x_user_email)
    data = {
        "organization_name": body.organization_name.strip(),
        "address_lines": [line.strip() for line in body.address_lines if line.strip()],
        "doc_number_prefix": body.doc_number_prefix.strip(),
        "phone_fax": body.phone_fax.strip(),
        "esaraban_name": body.esaraban_name.strip() or body.organization_name.strip(),
        "email": body.email.strip(),
        "director": body.director.model_dump(),
        "sp1_signers": body.sp1_signers.model_dump() if body.sp1_signers else get_effective_org_profile().get("sp1_signers", {}),
        "divisions": {k.strip(): v.model_dump() for k, v in body.divisions.items() if k.strip()},
    }
    db.set_setting("org_profile", data, actor["email"])
    db.add_audit_log(None, actor["email"], "org_profile_updated", {"organization_name": data["organization_name"], "divisions": list(data["divisions"].keys())})
    return {"ok": True, "org_profile": data}


@router.put("/integrations")
def update_integrations(body: IntegrationsUpdate, x_user_email: str | None = Header(default=None)):
    actor = _require_admin(x_user_email)
    existing = db.get_setting_json("integrations", {})
    data = {
        "sso_issuer": body.sso_issuer.strip(),
        "sso_realm": body.sso_realm.strip() or "cric-college",
        "sso_client_id": body.sso_client_id.strip(),
        "sso_client_secret": body.sso_client_secret.strip() or existing.get("sso_client_secret", ""),
        "allowed_domain": body.allowed_domain.strip().lower(),
        "auth_dev_mode": bool(body.auth_dev_mode),
        "panel_api_url": body.panel_api_url.strip(),
        "panel_api_token": body.panel_api_token.strip() or existing.get("panel_api_token", ""),
        "panel_sync_secret": body.panel_sync_secret.strip() or existing.get("panel_sync_secret", ""),
        "repair_system_url": body.repair_system_url.strip(),
        "short_course_url": body.short_course_url.strip(),
        "student_screening_url": body.student_screening_url.strip(),
        "project_system_url": body.project_system_url.strip() or "https://plan.cric.ac.th",
        "plan_users_api_path": body.plan_users_api_path.strip(),
        "evaluation_system_url": body.evaluation_system_url.strip(),
        "auto_sync_enabled": bool(body.auto_sync_enabled),
        "auto_sync_interval_minutes": max(5, min(1440, int(body.auto_sync_interval_minutes or 30))),
        "auto_sync_sources": body.auto_sync_sources if body.auto_sync_sources in ("panel", "plan", "both") else "both",
        "auto_sync_on_startup": bool(body.auto_sync_on_startup),
    }
    db.set_setting("integrations", data, actor["email"])
    db.add_audit_log(None, actor["email"], "integrations_updated", {"sso_issuer": data["sso_issuer"], "panel_api_url": data["panel_api_url"], "auth_dev_mode": data["auth_dev_mode"]})
    return {"ok": True}


@router.post("/integrations/test")
async def test_integration(body: IntegrationTestRequest, request: Request, x_user_email: str | None = Header(default=None)):
    _require_admin(x_user_email)
    integ = get_effective_integrations()
    target = body.target.lower()
    t0 = time.perf_counter()
    try:
        async with httpx.AsyncClient(timeout=8.0) as client:
            if target == "sso":
                sso_issuer = integ["sso_issuer"].rstrip("/")
                sso_realm = integ.get("sso_realm", "cric-college")
                if "/realms/" in sso_issuer:
                    url = f"{sso_issuer}/.well-known/openid-configuration"
                else:
                    url = f"{sso_issuer}/realms/{sso_realm}/.well-known/openid-configuration"
                resp = await client.get(url)
                extra: dict[str, Any] = {}
                if resp.status_code == 200:
                    oidc_meta = resp.json()
                    jwks_uri = oidc_meta.get("jwks_uri")
                    extra["issuer"] = oidc_meta.get("issuer")
                    extra["client_configured"] = bool(integ.get("sso_client_id"))
                    if jwks_uri:
                        jwks_resp = await client.get(jwks_uri)
                        extra["jwks_ok"] = jwks_resp.status_code == 200
                ms = round((time.perf_counter() - t0) * 1000)
                return {
                    "ok": 200 <= resp.status_code < 400 and extra.get("jwks_ok", True),
                    "status_code": resp.status_code,
                    "latency_ms": ms,
                    "url": url,
                    **extra,
                }
            elif target == "panel":
                panel_url = integ["panel_api_url"].rstrip("/")
                panel_base = panel_url[:-4] if panel_url.endswith("/api") else panel_url
                headers = {}
                token = integ["panel_api_token"] or integ.get("panel_sync_secret")
                if token:
                    headers["Authorization"] = f"Bearer {token}"
                    headers["X-CRIC-SYNC-KEY"] = token
                url = f"{panel_base}/api/v1/sso/session-check"
                try:
                    resp = await client.get(url, headers=headers)
                    if resp.status_code >= 400:
                        url2 = f"{panel_base}/api/v1/users"
                        r2 = await client.get(url2, headers=headers)
                        if r2.status_code < resp.status_code:
                            resp = r2
                            url = url2
                except Exception:
                    url = f"{panel_base}/api/v1/users"
                    resp = await client.get(url, headers=headers)
            elif target == "plan":
                plan_url = str(integ.get("project_system_url") or "https://plan.cric.ac.th").strip().rstrip("/")
                plan_base = plan_url[:-4] if plan_url.endswith("/api") else plan_url
                custom_path = str(integ.get("plan_users_api_path") or "").strip()
                headers = {}
                token = integ["panel_api_token"] or integ.get("panel_sync_secret")
                if token:
                    headers["Authorization"] = f"Bearer {token}"
                    headers["X-CRIC-SYNC-KEY"] = token
                cands: list[str] = []
                if custom_path:
                    cands.append(custom_path if custom_path.startswith("http") else f"{plan_base}/{custom_path.lstrip('/')}")
                cands.extend([f"{plan_base}/api/v1/users", f"{plan_base}/api/admin/users", f"{plan_base}/api/users"])
                resp = None
                url = cands[0]
                last_err = ""
                for cand in cands:
                    try:
                        r_cand = await client.get(cand, headers=headers)
                        resp = r_cand
                        url = cand
                        if r_cand.status_code < 400:
                            break
                    except Exception as exc:
                        last_err = str(exc)
                        continue
                if resp is None:
                    ms = round((time.perf_counter() - t0) * 1000)
                    return {"ok": False, "status_code": 0, "latency_ms": ms, "url": url, "error": last_err or f"ไม่สามารถเชื่อมต่อ {plan_base} ได้"}
            else:
                raise HTTPException(status_code=400, detail="target ต้องเป็น sso, panel หรือ plan")
        ms = round((time.perf_counter() - t0) * 1000)
        return {"ok": 200 <= resp.status_code < 400, "status_code": resp.status_code, "latency_ms": ms, "url": url}
    except HTTPException:
        raise
    except Exception as exc:
        ms = round((time.perf_counter() - t0) * 1000)
        return {"ok": False, "status_code": 0, "latency_ms": ms, "error": str(exc)}


@router.put("/notifications")
def update_notifications(body: NotificationsUpdate, x_user_email: str | None = Header(default=None)):
    actor = _require_admin(x_user_email)
    existing = db.get_setting_json("notifications", {})
    data = {
        "enabled": bool(body.enabled),
        "provider": body.provider.strip().lower(),
        "webhook_url": body.webhook_url.strip() or existing.get("webhook_url", ""),
        "telegram_chat_id": body.telegram_chat_id.strip(),
        "events": body.events,
    }
    db.set_setting("notifications", data, actor["email"])
    db.add_audit_log(None, actor["email"], "notifications_updated", {"enabled": data["enabled"], "provider": data["provider"]})
    return {"ok": True}


@router.post("/notifications/test")
def test_notifications(x_user_email: str | None = Header(default=None)):
    actor = _require_admin(x_user_email)
    cfg = db.get_setting_json("notifications", {})
    ok, detail = send_webhook_message(
        cfg,
        f"[CRIC E-Docx] ทดสอบการแจ้งเตือนระบบหลังบ้านโดย {actor['email']}",
        {"event": "test", "actor": actor["email"]},
    )
    return {"ok": ok, "detail": detail}


@router.put("/linter-and-defaults")
def update_linter_and_defaults(body: LinterAndDefaultsUpdate, x_user_email: str | None = Header(default=None)):
    actor = _require_admin(x_user_email)
    font_name = body.default_font if body.default_font in ("TH Sarabun New", "TH SarabunIT๙") else "TH Sarabun New"
    db.set_setting(
        "default_font",
        {"font_family": font_name, "auto_preview_default": bool(body.auto_preview_default)},
        actor["email"],
    )
    linter_data = {
        "custom_misspellings": {k.strip(): v.strip() for k, v in body.custom_misspellings.items() if k.strip() and v.strip()},
        "custom_forbidden_phrases": [w.strip() for w in body.custom_forbidden_phrases if w.strip()],
    }
    db.set_setting("linter_rules", linter_data, actor["email"])
    db.add_audit_log(
        None,
        actor["email"],
        "linter_defaults_updated",
        {"default_font": font_name, "custom_misspellings": len(linter_data["custom_misspellings"]), "custom_forbidden": len(linter_data["custom_forbidden_phrases"])},
    )
    return {"ok": True, "default_font": font_name, "auto_preview_default": bool(body.auto_preview_default), "linter_rules": linter_data}


@router.get("/audit-logs")
def get_audit_logs(q: str = "", limit: int = 100, x_user_email: str | None = Header(default=None)):
    _require_admin(x_user_email)
    logs = db.list_audit_logs(limit=min(max(limit, 1), 300))
    term = q.strip().lower()
    if term:
        logs = [
            item
            for item in logs
            if term in (item.get("actor_email") or "").lower()
            or term in (item.get("event_type") or "").lower()
            or term in str(item.get("metadata") or "").lower()
            or term in (item.get("document_id") or "").lower()
        ]
    return {"logs": logs}


@router.get("/diagnostics")
def get_diagnostics(x_user_email: str | None = Header(default=None)):
    _require_admin(x_user_email)
    soffice = shutil.which("soffice") or shutil.which("libreoffice")
    pdftoppm = shutil.which("pdftoppm")
    rendered_files = list(RENDERED_DIR.glob("*")) if RENDERED_DIR.exists() else []
    preview_files = [f for f in rendered_files if f.name.startswith("preview_")]

    fonts_found: list[str] = []
    if shutil.which("fc-list"):
        try:
            out = subprocess.check_output(["fc-list", ":", "family"], text=True, timeout=5)
            fonts_found = sorted({line.strip() for line in out.splitlines() if "sarabun" in line.lower()})
        except Exception:
            pass

    return {
        "db_backend": "postgresql" if db.use_pg else "sqlite",
        "libreoffice_available": bool(soffice),
        "pdftoppm_available": bool(pdftoppm),
        "sarabun_fonts_detected": fonts_found,
        "rendered_file_count": len(rendered_files),
        "preview_file_count": len(preview_files),
    }


@router.post("/cleanup-previews")
def cleanup_previews_now(x_user_email: str | None = Header(default=None)):
    actor = _require_admin(x_user_email)
    removed = 0
    for f in RENDERED_DIR.glob("preview_*"):
        try:
            if f.is_file():
                f.unlink()
                removed += 1
        except OSError:
            pass
    db.add_audit_log(None, actor["email"], "cleanup_previews", {"removed": removed})
    return {"ok": True, "removed": removed}
