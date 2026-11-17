"""Services directory proxy and fallback presets for 9-Dots App Launcher."""

from __future__ import annotations

from typing import Any
from urllib.parse import quote
import httpx
from fastapi import APIRouter, HTTPException, Response
from pydantic import BaseModel

from app.config import PANEL_API_TOKEN, PANEL_API_URL, PANEL_SYNC_SECRET
from app.db import db

router = APIRouter(prefix="/v1", tags=["services"])


def get_default_services(panel_base: str) -> list[dict[str, Any]]:
    is_prod = "panel.cric.ac.th" in panel_base or not ("localhost" in panel_base or "127.0.0.1" in panel_base)
    panel_home = panel_base if panel_base else ("https://panel.cric.ac.th" if is_prod else "http://localhost:3000")
    plan_home = "https://plan.cric.ac.th" if is_prod else "http://localhost:3005"
    edocx_home = "https://edocx.cric.ac.th" if is_prod else "http://localhost:3030"
    rcms_home = "https://rcms.cric.ac.th" if is_prod else "http://localhost:5050"
    uptime_home = "https://uptime.cric.ac.th" if is_prod else "http://localhost:3001"

    panel_asset_base = "https://panel.cric.ac.th" if is_prod else panel_home

    return [
        {
            "id": "panel",
            "title": "CRIC E-Service Panel",
            "description": "ศูนย์กลางบริการดิจิทัลและระบบงาน วิทยาลัยการอาชีพเชียงราย",
            "url": panel_home,
            "iconUrl": "/icons/cric-logo-borderless.png",
            "category": "core",
            "allowedRoles": ["guest", "student", "teacher", "staff", "admin"],
            "isActive": True,
            "isDefaultFavorite": True,
            "openInNewTab": True,
        },
        {
            "id": "plan",
            "title": "CRIC Plan",
            "description": "ระบบติดตามแผนงานและงบประมาณ",
            "url": plan_home,
            "iconUrl": "/icons/1793600486266-tab-icon.png",
            "category": "management",
            "allowedRoles": ["guest", "teacher", "staff", "admin"],
            "isActive": True,
            "isDefaultFavorite": True,
            "openInNewTab": True,
        },
        {
            "id": "edocx",
            "title": "CRIC E-Docx",
            "description": "ระบบร่างเอกสารราชการและสารบรรณออนไลน์",
            "url": edocx_home,
            "iconUrl": "/icons/cric-logo-borderless.png",
            "category": "saraban",
            "allowedRoles": ["teacher", "staff", "admin"],
            "isActive": True,
            "isDefaultFavorite": True,
            "openInNewTab": False,
        },
        {
            "id": "rcms",
            "title": "CRIC RCMS / LinkHub",
            "description": "ระบบออกหนังสือรับรองและบริการนักศึกษา",
            "url": rcms_home,
            "iconUrl": "/icons/1793600763812-tab-icon.png",
            "category": "academic",
            "allowedRoles": ["guest", "student", "teacher", "staff", "admin"],
            "isActive": True,
            "isDefaultFavorite": True,
            "openInNewTab": True,
        },
        {
            "id": "uptime",
            "title": "CRIC Uptime Kuma",
            "description": "ระบบตรวจสอบสถานะเซิร์ฟเวอร์และเครือข่าย",
            "url": uptime_home,
            "iconUrl": "https://cdn-icons-png.flaticon.com/512/8899/8899687.png",
            "category": "infra",
            "allowedRoles": ["guest", "teacher", "staff", "admin"],
            "isActive": True,
            "isDefaultFavorite": False,
            "openInNewTab": True,
        },
        {
            "id": "website",
            "title": "วิทยาลัยการอาชีพเชียงราย",
            "description": "เว็บไซต์หลัก Chiang Rai Industrial and Community Education College",
            "url": "https://cric.ac.th",
            "iconUrl": "/icons/cric-logo-borderless.png",
            "category": "general",
            "allowedRoles": ["guest", "student", "teacher", "staff", "admin"],
            "isActive": True,
            "isDefaultFavorite": False,
            "openInNewTab": True,
        },
        {
            "id": "sso",
            "title": "Keycloak SSO",
            "description": "ระบบยืนยันตัวตนกลางสถาบัน (realm: cric-college)",
            "url": "https://sso.cric.ac.th",
            "iconUrl": "https://cdn-icons-png.flaticon.com/512/2092/2092663.png",
            "category": "security",
            "allowedRoles": ["guest", "student", "teacher", "staff", "admin"],
            "isActive": True,
            "isDefaultFavorite": False,
            "openInNewTab": True,
        },
    ]


def map_to_panel_role(edocx_role: str | None) -> str:
    """Map E-Docx internal roles to CRIC E-Service Panel RBAC roles."""
    r = (edocx_role or "guest").strip().lower()
    if r in ("saraban_admin", "director", "admin"):
        return "admin"
    if r in ("deputy_director", "unit_head", "drafter", "staff", "teacher"):
        return "staff"
    if r == "student":
        return "student"
    return "guest"


@router.get("/services")
async def list_services(role: str | None = None):
    saved = db.get_setting_json("integrations", {})
    panel_url = (saved.get("panel_api_url") or PANEL_API_URL).rstrip("/")
    panel_base = panel_url[:-4] if panel_url.endswith("/api") else panel_url
    panel_token = saved.get("panel_api_token") or PANEL_API_TOKEN or saved.get("panel_sync_secret") or PANEL_SYNC_SECRET

    panel_role = map_to_panel_role(role)
    is_guest = panel_role == "guest"

    headers: dict[str, str] = {}
    if panel_token:
        headers["Authorization"] = f"Bearer {panel_token}"
        headers["X-CRIC-SYNC-KEY"] = panel_token

    # 1. Try fetching real registered services from Panel API with mapped role
    candidate_urls = [
        f"{panel_base}/api/v1/services?role={panel_role}",
        f"{panel_url}/api/v1/services?role={panel_role}",
        f"{panel_url}/services?role={panel_role}",
    ]

    async with httpx.AsyncClient(timeout=3.5) as client:
        for curl in candidate_urls:
            try:
                resp = await client.get(curl, headers=headers)
                if resp.status_code == 200:
                    data = resp.json()
                    services = data.get("data") if isinstance(data, dict) and "data" in data else data
                    if isinstance(services, list):
                        # Filter active services and double-check guest visibility
                        real_services = []
                        for s in services:
                            if s.get("isActive") is False:
                                continue
                            allowed = s.get("allowedRoles") or []
                            if is_guest and len(allowed) > 0 and "guest" not in allowed:
                                continue
                            icon = s.get("iconUrl")
                            if isinstance(icon, str):
                                if icon.startswith("/"):
                                    s["iconUrl"] = f"/v1/services/icon?path={quote(icon)}"
                                elif icon.startswith(f"{panel_base}/uploads/"):
                                    rel = icon[len(panel_base):]
                                    s["iconUrl"] = f"/v1/services/icon?path={quote(rel)}"
                            real_services.append(s)

                        return {
                            "source": "panel_api",
                            "panel_url": panel_base,
                            "role": panel_role,
                            "services": real_services,
                        }
            except Exception:
                continue

    # 2. Offline Fallback (only used if Panel API is completely unreachable)
    defaults = get_default_services(panel_base)
    if is_guest:
        defaults = [d for d in defaults if "guest" in d.get("allowedRoles", []) and d["id"] != "edocx"]

    return {
        "source": "offline_fallback",
        "panel_url": panel_base,
        "role": panel_role,
        "services": defaults,
    }


@router.get("/services/icon")
async def proxy_service_icon(path: str):
    """Proxy relative /uploads/ or /icons/ icon paths from CRIC E-Service Panel."""
    if not path.startswith(("/uploads/", "/icons/")) or ".." in path:
        raise HTTPException(status_code=400, detail="Invalid icon path")

    saved = db.get_setting_json("integrations", {})
    panel_url = (saved.get("panel_api_url") or PANEL_API_URL).rstrip("/")
    panel_base = panel_url[:-4] if panel_url.endswith("/api") else panel_url

    target_url = f"{panel_base}{path}"
    async with httpx.AsyncClient(timeout=5.0) as client:
        try:
            resp = await client.get(target_url)
            if resp.status_code == 200:
                return Response(
                    content=resp.content,
                    media_type=resp.headers.get("content-type", "image/png"),
                    headers={"Cache-Control": "public, max-age=86400"},
                )
        except Exception:
            pass
    raise HTTPException(status_code=404, detail="Icon not found")
