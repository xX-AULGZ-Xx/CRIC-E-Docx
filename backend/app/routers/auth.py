"""Authentication (sso.cric.ac.th), User Directory Sync (panel.cric.ac.th), and Signature PNG upload."""

from __future__ import annotations

import base64
import contextvars
import hashlib
import hmac
import json
import secrets
import shutil
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any
from urllib.parse import quote, urlencode

import httpx
import jwt
from fastapi import APIRouter, Cookie, File, Header, HTTPException, Query, Request, UploadFile
from fastapi.encoders import jsonable_encoder
from fastapi.responses import FileResponse, JSONResponse, RedirectResponse
from pydantic import BaseModel

from app.config import (
    ALLOWED_EMAIL_DOMAIN,
    AUTH_DEV_MODE,
    AVATARS_DIR,
    JWT_SECRET,
    PANEL_API_TOKEN,
    PANEL_API_URL,
    PANEL_SYNC_SECRET,
    SIGNATURES_DIR,
    SSO_CLIENT_ID,
    SSO_CLIENT_SECRET,
    SSO_ISSUER,
    SSO_REALM,
    SSO_REDIRECT_URI,
)
from app.db import db

router = APIRouter(prefix="/v1/auth", tags=["auth"])

CANDIDATE_JWT_SECRETS = [
    s
    for s in [
        JWT_SECRET,
        PANEL_SYNC_SECRET,
        "cric-secure-jwt-secret-key-super-random-32char",
        "reg-cert-mgmt-system-secret-key-2026-chiangrai",
        "reg-cert-mgmt-system-secret-key-2026",
    ]
    if s
]

SESSION_COOKIE_NAME = "cric_sso_session"
ID_TOKEN_COOKIE_NAME = "cric_sso_id_token"
OIDC_STATE_COOKIE_NAME = "cric_oidc_state"
SESSION_TTL_SECONDS = 12 * 3600
OIDC_STATE_TTL_SECONDS = 600

_ROLE_PRIORITY = {
    "drafter": 1,
    "unit_head": 2,
    "deputy_director": 3,
    "director": 4,
    "saraban_admin": 5,
}

_OIDC_CACHE: dict[str, tuple[float, dict[str, Any]]] = {}
_JWKS_CACHE: dict[str, tuple[float, dict[str, Any]]] = {}

_REQUEST_AUTH_CTX: contextvars.ContextVar[dict[str, str | None] | None] = contextvars.ContextVar(
    "cric_request_auth_ctx", default=None
)


def set_request_auth_context(
    authorization: str | None = None,
    cookie_session: str | None = None,
    x_user_identifier: str | None = None,
    x_user_email: str | None = None,
) -> contextvars.Token[dict[str, str | None] | None]:
    """Store request auth credentials for endpoints that call resolve_current_user directly."""
    return _REQUEST_AUTH_CTX.set(
        {
            "authorization": authorization,
            "cookie_session": cookie_session,
            "x_user_identifier": x_user_identifier,
            "x_user_email": x_user_email,
        }
    )


def reset_request_auth_context(token: contextvars.Token[dict[str, str | None] | None]) -> None:
    """Reset the per-request auth context after HTTP request handling."""
    _REQUEST_AUTH_CTX.reset(token)


def _effective_auth_cfg() -> dict[str, Any]:
    saved = db.get_setting_json("integrations", {})
    return {
        "sso_issuer": saved.get("sso_issuer", SSO_ISSUER),
        "sso_realm": saved.get("sso_realm", SSO_REALM),
        "sso_client_id": saved.get("sso_client_id", SSO_CLIENT_ID),
        "sso_client_secret": saved.get("sso_client_secret", SSO_CLIENT_SECRET),
        "sso_redirect_uri": saved.get("sso_redirect_uri", SSO_REDIRECT_URI),
        "allowed_domain": saved.get("allowed_domain", ALLOWED_EMAIL_DOMAIN),
        "auth_dev_mode": saved.get("auth_dev_mode", AUTH_DEV_MODE),
        "panel_api_url": saved.get("panel_api_url") or PANEL_API_URL,
        "panel_api_token": saved.get("panel_api_token") or PANEL_API_TOKEN or "",
        "panel_sync_secret": saved.get("panel_sync_secret") or PANEL_SYNC_SECRET or "cric-panel-sync-secret-2026",
        "project_system_url": saved.get("project_system_url", "https://plan.cric.ac.th"),
        "plan_users_api_path": saved.get("plan_users_api_path", ""),
        "auto_sync_enabled": bool(saved.get("auto_sync_enabled", True)),
        "auto_sync_interval_minutes": max(5, min(1440, int(saved.get("auto_sync_interval_minutes", 30) or 30))),
        "auto_sync_sources": saved.get("auto_sync_sources", "both") if saved.get("auto_sync_sources") in ("panel", "plan", "both") else "both",
        "auto_sync_on_startup": bool(saved.get("auto_sync_on_startup", True)),
    }


def _primary_jwt_secret(cfg: dict[str, Any] | None = None) -> str:
    if cfg and cfg.get("panel_sync_secret"):
        return str(cfg["panel_sync_secret"])
    return JWT_SECRET or "cric-secure-jwt-secret-key-super-random-32char"


def map_panel_role_to_edocx(raw_role: str | None) -> str:
    r = (raw_role or "").strip().lower()
    if r in ("admin", "super_admin", "saraban_admin", "edocx_admin", "saraban"):
        return "saraban_admin"
    elif r in ("director", "college_director"):
        return "director"
    elif r in ("deputy_director", "deputy"):
        return "deputy_director"
    elif r in ("planning_officer", "head_dept", "head_of_dept", "unit_head", "head_unit", "department_head"):
        return "unit_head"
    else:
        return "drafter"


def _extract_claims_role(claims: dict[str, Any], client_id: str) -> str:
    raw_candidates: list[str] = []
    for key in ("role", "edocx_role"):
        val = claims.get(key)
        if isinstance(val, str) and val.strip():
            raw_candidates.append(val)

    resource_access = claims.get("resource_access")
    if isinstance(resource_access, dict):
        client_res = resource_access.get(client_id) or {}
        if isinstance(client_res, dict) and isinstance(client_res.get("roles"), list):
            raw_candidates.extend(str(r) for r in client_res["roles"])

    realm_access = claims.get("realm_access")
    if isinstance(realm_access, dict) and isinstance(realm_access.get("roles"), list):
        raw_candidates.extend(str(r) for r in realm_access["roles"])

    if isinstance(claims.get("roles"), list):
        raw_candidates.extend(str(r) for r in claims["roles"])

    best_role = "drafter"
    best_prio = 0
    for raw in raw_candidates:
        mapped = map_panel_role_to_edocx(raw)
        prio = _ROLE_PRIORITY.get(mapped, 1)
        if prio > best_prio:
            best_prio = prio
            best_role = mapped
    return best_role


def base64url_decode(s: str) -> bytes:
    rem = len(s) % 4
    if rem > 0:
        s += "=" * (4 - rem)
    return base64.urlsafe_b64decode(s.replace("-", "+").replace("_", "/"))


def base64url_encode(raw: bytes) -> str:
    return base64.urlsafe_b64encode(raw).decode("utf-8").rstrip("=")


def verify_sso_jwt(token: str, extra_secrets: list[str] | None = None) -> dict[str, Any] | None:
    try:
        parts = token.strip().split(".")
        if len(parts) != 3:
            return None
        header_b64, payload_b64, sig_b64 = parts
        message = f"{header_b64}.{payload_b64}".encode("utf-8")

        secrets_to_try = list(CANDIDATE_JWT_SECRETS)
        if extra_secrets:
            for s in extra_secrets:
                if s and s not in secrets_to_try:
                    secrets_to_try.insert(0, s)

        matched = False
        for secret in secrets_to_try:
            if not secret:
                continue
            expected = hmac.new(secret.encode("utf-8"), message, hashlib.sha256).digest()
            expected_b64 = base64url_encode(expected)
            if hmac.compare_digest(sig_b64, expected_b64):
                matched = True
                break

        if not matched:
            return None

        payload = json.loads(base64url_decode(payload_b64).decode("utf-8"))
        if payload.get("exp") and payload["exp"] < time.time():
            return None
        return payload
    except Exception:
        return None


def _sign_hs256_jwt(payload: dict[str, Any], secret: str) -> str:
    return jwt.encode(payload, secret, algorithm="HS256")


def _auth_base_url(cfg: dict[str, Any]) -> str:
    sso_issuer = str(cfg.get("sso_issuer") or SSO_ISSUER).strip().rstrip("/")
    sso_realm = str(cfg.get("sso_realm") or SSO_REALM or "cric-college").strip()
    if "/realms/" in sso_issuer:
        return sso_issuer
    return f"{sso_issuer}/realms/{sso_realm}"


def _default_oidc_metadata(auth_base: str) -> dict[str, Any]:
    return {
        "issuer": auth_base,
        "authorization_endpoint": f"{auth_base}/protocol/openid-connect/auth",
        "token_endpoint": f"{auth_base}/protocol/openid-connect/token",
        "userinfo_endpoint": f"{auth_base}/protocol/openid-connect/userinfo",
        "end_session_endpoint": f"{auth_base}/protocol/openid-connect/logout",
        "jwks_uri": f"{auth_base}/protocol/openid-connect/certs",
    }


async def _get_oidc_endpoints(cfg: dict[str, Any], force_refresh: bool = False) -> dict[str, Any]:
    auth_base = _auth_base_url(cfg)
    now = time.time()
    cached = _OIDC_CACHE.get(auth_base)
    if cached and not force_refresh and (now - cached[0]) < 300:
        return cached[1]

    discovery_url = f"{auth_base}/.well-known/openid-configuration"
    try:
        async with httpx.AsyncClient(timeout=8.0) as client:
            resp = await client.get(discovery_url)
            if resp.status_code == 200:
                data = resp.json()
                if isinstance(data, dict) and data.get("authorization_endpoint"):
                    _OIDC_CACHE[auth_base] = (now, data)
                    return data
    except Exception:
        pass

    fallback = _default_oidc_metadata(auth_base)
    _OIDC_CACHE[auth_base] = (now, fallback)
    return fallback


async def _get_jwks(jwks_uri: str, force_refresh: bool = False) -> dict[str, Any]:
    now = time.time()
    cached = _JWKS_CACHE.get(jwks_uri)
    if cached and not force_refresh and (now - cached[0]) < 300:
        return cached[1]

    async with httpx.AsyncClient(timeout=8.0) as client:
        resp = await client.get(jwks_uri)
        resp.raise_for_status()
        data = resp.json()
        _JWKS_CACHE[jwks_uri] = (now, data)
        return data


def _verify_oidc_id_token(
    id_token: str,
    jwks_data: dict[str, Any],
    issuer: str,
    client_id: str,
    expected_nonce: str | None = None,
) -> dict[str, Any]:
    header = jwt.get_unverified_header(id_token)
    alg = str(header.get("alg") or "RS256")
    kid = header.get("kid")

    keys = jwks_data.get("keys") if isinstance(jwks_data, dict) else None
    if not isinstance(keys, list) or not keys:
        raise ValueError("ไม่พบกุญแจสาธารณะ (JWKS) สำหรับตรวจสอบโทเคน")

    selected_jwk: dict[str, Any] | None = None
    for key in keys:
        if kid and key.get("kid") == kid:
            selected_jwk = key
            break
    if not selected_jwk and not kid:
        selected_jwk = keys[0]
    if not selected_jwk:
        raise ValueError("ไม่พบคีย์ที่ตรงกับ kid ของ id_token")

    signing_key = jwt.PyJWK.from_dict(selected_jwk).key
    claims = jwt.decode(
        id_token,
        signing_key,
        algorithms=[alg],
        audience=client_id,
        issuer=issuer,
        options={"verify_exp": True, "verify_iss": bool(issuer), "verify_aud": bool(client_id)},
        leeway=30,
    )
    if expected_nonce and claims.get("nonce") != expected_nonce:
        raise ValueError("ค่า nonce ของการยืนยันตัวตนไม่ตรงกัน")
    azp = claims.get("azp")
    if azp and client_id and azp != client_id:
        raise ValueError("ค่า azp ของโทเคนไม่ตรงกับ client_id")
    return claims


async def _fetch_upstream_users(
    base_url: str,
    token: str | list[str],
    timeout: float = 12.0,
) -> tuple[list[dict[str, Any]], str | None]:
    """Fetch user directory records from Panel or Plan using candidate endpoints and tokens."""
    clean_url = str(base_url or "").strip().rstrip("/")
    raw_tokens = token if isinstance(token, list) else [token]
    token_list = []
    for t in raw_tokens + ["cric-panel-sync-secret-2026"]:
        ts = str(t or "").strip()
        if ts and ts not in token_list:
            token_list.append(ts)
    if not clean_url or not token_list:
        return [], None
    base = clean_url[:-4] if clean_url.endswith("/api") else clean_url
    candidates = [
        f"{base}/api/v1/users",
        f"{base}/api/admin/users",
        f"{base}/api/users",
        f"{clean_url}/api/v1/users",
        f"{clean_url}/users",
    ]
    if clean_url.count("/") >= 3 and not clean_url.endswith(("/api", ".th", ".com", ".net")):
        candidates.insert(0, clean_url)
    seen: set[str] = set()
    async with httpx.AsyncClient(timeout=timeout) as client:
        for url in candidates:
            if url in seen:
                continue
            seen.add(url)
            for tok in token_list:
                headers = {"Authorization": f"Bearer {tok}", "X-CRIC-SYNC-KEY": tok}
                try:
                    r = await client.get(url, headers=headers)
                    if r.status_code == 200:
                        body = r.json()
                        rows = body.get("data") or body.get("users") or [] if isinstance(body, dict) else (body if isinstance(body, list) else [])
                        if isinstance(rows, list):
                            return [row for row in rows if isinstance(row, dict)], url
                    if r.status_code not in (401, 403):
                        break
                except Exception:
                    break
    return [], None


async def _lookup_panel_user(identifier: str | None, cfg: dict[str, Any]) -> dict[str, Any] | None:
    if not identifier:
        return None
    panel_url = str(cfg.get("panel_api_url") or "").strip().rstrip("/")
    plan_url = str(cfg.get("project_system_url") or "").strip().rstrip("/")
    panel_token = str(cfg.get("panel_api_token") or cfg.get("panel_sync_secret") or "").strip()
    if not panel_token:
        return None
    target_ident = identifier.strip().lower()

    def _find_match(rows: list[dict[str, Any]]) -> dict[str, Any] | None:
        for rec in rows:
            rec_email = str(rec.get("email") or "").strip().lower()
            rec_user = str(rec.get("username") or "").strip().lower()
            if target_ident in (rec_email, rec_user):
                return rec
        return None

    panel_rows, _ = await _fetch_upstream_users(panel_url, panel_token, timeout=5.0) if panel_url else ([], None)
    matched_panel = _find_match(panel_rows)

    plan_rows, _ = await _fetch_upstream_users(plan_url, panel_token, timeout=5.0) if plan_url else ([], None)
    matched_plan = _find_match(plan_rows)

    if matched_panel and matched_plan:
        merged = dict(matched_panel)
        for k in ("units", "head_units", "headUnits", "division_code", "division_codes", "divisionCodes", "personnel_type", "position_title", "position", "department", "department_name", "role"):
            if matched_plan.get(k) not in (None, "", []):
                merged[k] = matched_plan[k]
        return merged
    return matched_panel or matched_plan


def _extract_avatar_url(
    claims: dict[str, Any],
    panel_record: dict[str, Any] | None,
    cfg: dict[str, Any],
) -> str | None:
    """Resolve user avatar URL from Panel record or OIDC/JWT claims."""
    candidates = [
        (panel_record or {}).get("avatarUrl"),
        (panel_record or {}).get("avatar_url"),
        (panel_record or {}).get("avatar"),
        (panel_record or {}).get("picture"),
        (panel_record or {}).get("image"),
        claims.get("avatarUrl"),
        claims.get("avatar_url"),
        claims.get("avatar"),
        claims.get("picture"),
        claims.get("image"),
        claims.get("photoUrl"),
    ]
    raw = ""
    for item in candidates:
        if isinstance(item, str) and item.strip():
            raw = item.strip()
            break
    if not raw:
        return None
    if raw.startswith("http://") or raw.startswith("https://") or raw.startswith("data:image/"):
        return raw
    if raw.startswith("/"):
        panel_url = str(cfg.get("panel_api_url") or PANEL_API_URL or "").strip().rstrip("/")
        panel_base = panel_url[:-4] if panel_url.endswith("/api") else panel_url
        if panel_base.startswith("http://") or panel_base.startswith("https://"):
            return f"{panel_base}{raw}"
        return raw
    return None


def _provision_sso_user(
    claims: dict[str, Any],
    cfg: dict[str, Any],
    panel_record: dict[str, Any] | None = None,
) -> dict[str, Any]:
    """Hybrid user provisioning: preserve local customizations for existing users; seed new users from SSO/Panel."""
    sso_subject = str(claims.get("sub") or "").strip() or None
    raw_email = str(claims.get("email") or (panel_record or {}).get("email") or "").strip().lower()
    email = raw_email or None
    raw_username = str(
        claims.get("preferred_username")
        or claims.get("username")
        or (panel_record or {}).get("username")
        or ""
    ).strip().lstrip("@")
    if not raw_username and email:
        raw_username = email.split("@")[0]
    username = raw_username or None

    if not sso_subject and not email and not username:
        raise HTTPException(status_code=401, detail="ข้อมูลตัวตนจาก CRIC SSO ไม่สมบูรณ์")

    allowed_domain = str(cfg.get("allowed_domain") or "").strip().lower()
    if email and allowed_domain and not email.endswith(f"@{allowed_domain}"):
        raise HTTPException(status_code=403, detail=f"อนุญาตเฉพาะบัญชี @{allowed_domain} เท่านั้น")

    existing: dict[str, Any] | None = None
    for candidate in (sso_subject, email, username):
        if candidate:
            existing = db.get_user_by_identifier(candidate)
            if existing:
                break

    claims_role = _extract_claims_role(claims, str(cfg.get("sso_client_id") or SSO_CLIENT_ID))
    resolved_avatar = _extract_avatar_url(claims, panel_record, cfg)

    if existing:
        if not existing.get("is_active", True):
            raise HTTPException(status_code=403, detail="บัญชีผู้ใช้นี้ถูกระงับการใช้งาน")

        # Link sso_subject on first OIDC login without overwriting user-edited profile, signature, or admin-set role.
        upgraded_role = None
        if not existing.get("sso_subject") and existing.get("role") == "drafter" and _ROLE_PRIORITY.get(claims_role, 1) > 1:
            upgraded_role = claims_role

        valid_sso_sub = sso_subject if (sso_subject and sso_subject != str(existing.get("id"))) else None
        needs_link = bool(valid_sso_sub and not existing.get("sso_subject"))

        existing_avatar = str(existing.get("avatar_url") or "").strip()
        is_local_avatar = existing_avatar.startswith("/v1/auth/users/")
        needs_avatar_sync = bool(resolved_avatar and not is_local_avatar and resolved_avatar != existing_avatar)

        if not needs_link and not upgraded_role and not needs_avatar_sync:
            return existing

        return db.upsert_user(
            {
                "sso_subject": valid_sso_sub or existing.get("sso_subject"),
                "username": existing.get("username") or username,
                "email": existing.get("email") or email,
                "full_name": None,
                "position_title": None,
                "role": upgraded_role,
                "avatar_url": resolved_avatar if needs_avatar_sync else None,
                "is_active": True,
            }
        )

    # First-time provisioning: combine Keycloak claims + optional Panel record
    panel_role = map_panel_role_to_edocx((panel_record or {}).get("role")) if panel_record else "drafter"
    initial_role = panel_role if _ROLE_PRIORITY.get(panel_role, 1) >= _ROLE_PRIORITY.get(claims_role, 1) else claims_role

    clean_new_username = username.split("@")[0] if (username and "@" in username and email and username.lower() == email) else username

    full_name = (
        (panel_record or {}).get("full_name")
        or (panel_record or {}).get("displayName")
        or claims.get("name")
        or f"{claims.get('given_name', '')} {claims.get('family_name', '')}".strip()
        or clean_new_username
        or email
        or "ผู้ใช้งาน CRIC"
    )
    position_title = (
        (panel_record or {}).get("position_title")
        or (panel_record or {}).get("position")
        or str(claims.get("position_title") or claims.get("job_title") or "").strip()
        or "เจ้าหน้าที่"
    )
    division_code = str((panel_record or {}).get("division_code") or claims.get("division_code") or "").strip()
    panel_user_id = str((panel_record or {}).get("id") or (panel_record or {}).get("panel_user_id") or "").strip() or None

    return db.upsert_user(
        {
            "sso_subject": sso_subject,
            "panel_user_id": panel_user_id,
            "username": clean_new_username,
            "email": email,
            "full_name": str(full_name).strip(),
            "position_title": str(position_title).strip(),
            "division_code": division_code,
            "role": initial_role,
            "avatar_url": resolved_avatar or "",
            "is_active": True,
        }
    )


def _external_base_url(request: Request) -> str:
    fwd_proto = (request.headers.get("x-forwarded-proto") or "").split(",")[0].strip()
    fwd_host = (request.headers.get("x-forwarded-host") or "").split(",")[0].strip()
    host = fwd_host or request.headers.get("host") or request.url.netloc
    proto = fwd_proto or request.url.scheme or "http"
    return f"{proto}://{host}".rstrip("/")


def _resolve_redirect_uri(request: Request, cfg: dict[str, Any]) -> str:
    explicit = str(cfg.get("sso_redirect_uri") or "").strip()
    if explicit:
        return explicit
    return f"{_external_base_url(request)}/v1/auth/sso/callback"


def _sanitize_next_path(raw_next: str | None) -> str:
    candidate = (raw_next or "/").strip()
    if not candidate.startswith("/") or candidate.startswith("//"):
        return "/"
    return candidate


def _resolve_user_and_source(
    x_user_email: str | None = None,
    x_user_identifier: str | None = None,
    authorization: str | None = None,
    cookie_session: str | None = None,
) -> tuple[dict[str, Any], str]:
    ctx = _REQUEST_AUTH_CTX.get()
    if ctx:
        if authorization is None:
            authorization = ctx.get("authorization")
        if cookie_session is None:
            cookie_session = ctx.get("cookie_session")
        if x_user_identifier is None:
            x_user_identifier = ctx.get("x_user_identifier")
        if x_user_email is None:
            x_user_email = ctx.get("x_user_email")

    cfg = _effective_auth_cfg()

    # 1. Check Bearer token or Central SSO Cookie (cric_sso_session)
    token = None
    if authorization and authorization.lower().startswith("bearer "):
        token = authorization[7:].strip()
    elif cookie_session:
        token = cookie_session.strip()

    if token:
        payload = verify_sso_jwt(token, extra_secrets=[str(cfg.get("panel_sync_secret") or "")])
        if payload:
            user = _provision_sso_user(payload, cfg, panel_record=None)
            auth_source = str(payload.get("auth_source") or "panel_jwt")
            return user, auth_source

    # 2. Check X-User-Identifier / X-User-Email header ONLY in auth_dev_mode
    identifier = (x_user_identifier or x_user_email or "").strip()
    if identifier and cfg["auth_dev_mode"]:
        if identifier.lower() == "guest":
            raise HTTPException(status_code=401, detail="กรุณาเข้าสู่ระบบผ่าน sso.cric.ac.th หรือ panel.cric.ac.th")

        user = db.get_user_by_identifier(identifier)
        if user:
            if not user.get("is_active", True):
                raise HTTPException(status_code=403, detail="บัญชีผู้ใช้นี้ถูกระงับการใช้งาน")
            return user, "dev_switcher"

        allowed_domain = cfg["allowed_domain"]
        if "@" in identifier and allowed_domain and not identifier.lower().endswith(f"@{allowed_domain}"):
            raise HTTPException(status_code=403, detail=f"อนุญาตเฉพาะบัญชี @{allowed_domain} เท่านั้น")

        clean_name = identifier.split("@")[0].lstrip("@")
        user = db.upsert_user(
            {
                "username": clean_name,
                "email": identifier if "@" in identifier else None,
                "full_name": clean_name,
                "position_title": "เจ้าหน้าที่",
                "role": "drafter",
            }
        )
        return user, "dev_switcher"

    # 3. Fallback when auth_dev_mode is enabled and no explicit guest/token
    if cfg["auth_dev_mode"]:
        default_admin = db.get_user_by_identifier("saraban@cric.ac.th") or db.get_user_by_identifier("saraban")
        if not default_admin:
            default_admin = db.upsert_user(
                {
                    "username": "saraban",
                    "email": "saraban@cric.ac.th",
                    "full_name": "นางสาวขนิษฐา สุใจยา",
                    "position_title": "หัวหน้างานสารบรรณกลาง",
                    "division_code": "ฝบ.",
                    "role": "saraban_admin",
                }
            )
        return default_admin, "dev_default"

    raise HTTPException(status_code=401, detail="กรุณาเข้าสู่ระบบผ่าน sso.cric.ac.th หรือ panel.cric.ac.th")


def resolve_current_user(
    x_user_email: str | None = None,
    x_user_identifier: str | None = None,
    authorization: str | None = None,
    cookie_session: str | None = None,
) -> dict[str, Any]:
    user, _ = _resolve_user_and_source(
        x_user_email=x_user_email,
        x_user_identifier=x_user_identifier,
        authorization=authorization,
        cookie_session=cookie_session,
    )
    return user


class PanelUserRecord(BaseModel):
    panel_user_id: str | None = None
    username: str | None = None
    email: str | None = None
    full_name: str | None = None
    displayName: str | None = None
    position_title: str | None = None
    position: str | None = None
    division_code: str = ""
    department: str | None = None
    role: str = "drafter"
    is_active: bool = True


class PanelSyncPayload(BaseModel):
    users: list[dict[str, Any]] | None = None


class UserCreatePayload(BaseModel):
    username: str | None = None
    email: str | None = None
    full_name: str
    position_title: str = "เจ้าหน้าที่"
    personnel_type: str = "STAFF"
    division_code: str = ""
    division_codes: list[str] = []
    unit_name: str = ""
    units: list[str] = []
    head_units: list[str] = []
    phone: str = ""
    default_reviewer_email: str = ""
    role: str = "drafter"
    is_active: bool = True


class UserUpdatePayload(BaseModel):
    username: str | None = None
    email: str | None = None
    full_name: str | None = None
    position_title: str | None = None
    personnel_type: str | None = None
    division_code: str | None = None
    division_codes: list[str] | None = None
    unit_name: str | None = None
    units: list[str] | None = None
    head_units: list[str] | None = None
    phone: str | None = None
    default_reviewer_email: str | None = None
    role: str | None = None
    is_active: bool | None = None


class ProfileSelfUpdatePayload(BaseModel):
    full_name: str | None = None
    email: str | None = None
    position_title: str | None = None
    personnel_type: str | None = None
    division_code: str | None = None
    division_codes: list[str] | None = None
    unit_name: str | None = None
    units: list[str] | None = None
    head_units: list[str] | None = None
    phone: str | None = None
    default_reviewer_email: str | None = None


@router.get("/me")
def get_me(
    x_user_email: str | None = Header(default=None),
    x_user_identifier: str | None = Header(default=None),
    authorization: str | None = Header(default=None),
    cric_sso_session: str | None = Cookie(default=None),
):
    cfg = _effective_auth_cfg()
    user, auth_source = _resolve_user_and_source(
        x_user_email=x_user_email,
        x_user_identifier=x_user_identifier,
        authorization=authorization,
        cookie_session=cric_sso_session,
    )
    return {
        "user": user,
        "auth_source": auth_source,
        "auth_dev_mode": cfg["auth_dev_mode"],
        "sso_issuer": cfg["sso_issuer"],
        "sso_realm": cfg.get("sso_realm", "cric-college"),
    }


@router.put("/me")
def update_my_profile(
    body: ProfileSelfUpdatePayload,
    x_user_email: str | None = Header(default=None),
    x_user_identifier: str | None = Header(default=None),
    authorization: str | None = Header(default=None),
    cric_sso_session: str | None = Cookie(default=None),
):
    user = resolve_current_user(
        x_user_email=x_user_email,
        x_user_identifier=x_user_identifier,
        authorization=authorization,
        cookie_session=cric_sso_session,
    )
    updates: dict[str, Any] = {}
    if body.full_name is not None:
        cleaned_name = body.full_name.strip()
        if not cleaned_name:
            raise HTTPException(status_code=400, detail="กรุณาระบุชื่อ–นามสกุล")
        updates["full_name"] = cleaned_name
    if body.email is not None:
        cleaned_email = body.email.strip().lower()
        cfg = _effective_auth_cfg()
        if cleaned_email and cfg["allowed_domain"] and not cleaned_email.endswith(f"@{cfg['allowed_domain']}"):
            raise HTTPException(status_code=400, detail=f"อีเมลต้องลงท้ายด้วย @{cfg['allowed_domain']}")
        updates["email"] = cleaned_email or None
    if body.position_title is not None:
        cleaned_title = body.position_title.strip()
        if not cleaned_title:
            raise HTTPException(status_code=400, detail="กรุณาระบุตำแหน่ง")
        updates["position_title"] = cleaned_title
    if body.personnel_type is not None:
        pt = body.personnel_type.strip().upper()
        if pt in ("TEACHER", "STAFF"):
            updates["personnel_type"] = pt
    if body.division_code is not None:
        updates["division_code"] = body.division_code.strip()
    if body.division_codes is not None:
        cleaned_divs = [str(d).strip() for d in body.division_codes if str(d).strip()]
        updates["division_codes"] = cleaned_divs
        if "division_code" not in updates or not updates["division_code"]:
            updates["division_code"] = cleaned_divs[0] if cleaned_divs else ""
    if body.unit_name is not None:
        updates["unit_name"] = body.unit_name.strip()
    if body.units is not None:
        cleaned_units = [str(u).strip() for u in body.units if str(u).strip()]
        updates["units"] = cleaned_units
        if "unit_name" not in updates or not updates["unit_name"]:
            updates["unit_name"] = cleaned_units[0] if cleaned_units else ""
    if body.head_units is not None:
        target_units = updates.get("units", user.get("units") or [])
        cleaned_heads = [str(h).strip() for h in body.head_units if str(h).strip() and (not target_units or str(h).strip() in target_units)]
        updates["head_units"] = cleaned_heads
        # Mirror plan.cric.ac.th head-of-work role rule while protecting admin/executive roles
        if user.get("role") in ("drafter", "unit_head"):
            updates["role"] = "unit_head" if len(cleaned_heads) > 0 else "drafter"
    if body.phone is not None:
        updates["phone"] = body.phone.strip()
    if body.default_reviewer_email is not None:
        updates["default_reviewer_email"] = body.default_reviewer_email.strip().lower()

    updated = db.update_user_fields(user["id"], updates) if updates else user
    if not updated:
        raise HTTPException(status_code=404, detail="ไม่พบบัญชีผู้ใช้งาน")

    actor_id = updated.get("email") or updated.get("username") or user["id"]
    db.add_audit_log(None, actor_id, "profile_updated", updates)
    return {"user": updated}


@router.get("/users")
def list_users(
    x_user_email: str | None = Header(default=None),
    x_user_identifier: str | None = Header(default=None),
    authorization: str | None = Header(default=None),
    cric_sso_session: str | None = Cookie(default=None),
):
    cfg = _effective_auth_cfg()
    if not cfg["auth_dev_mode"]:
        resolve_current_user(
            x_user_email=x_user_email,
            x_user_identifier=x_user_identifier,
            authorization=authorization,
            cookie_session=cric_sso_session,
        )
    return {"users": db.list_users()}


@router.post("/users")
def create_user(
    body: UserCreatePayload,
    x_user_email: str | None = Header(default=None),
    x_user_identifier: str | None = Header(default=None),
    authorization: str | None = Header(default=None),
    cric_sso_session: str | None = Cookie(default=None),
):
    actor = resolve_current_user(
        x_user_email=x_user_email,
        x_user_identifier=x_user_identifier,
        authorization=authorization,
        cookie_session=cric_sso_session,
    )
    if actor["role"] not in ("saraban_admin", "director"):
        raise HTTPException(status_code=403, detail="เฉพาะเจ้าหน้าที่สารบรรณหรือผู้อำนวยการเท่านั้นที่เพิ่มผู้ใช้ได้")

    cfg = _effective_auth_cfg()
    email = (body.email or "").strip().lower() or None
    if email and cfg["allowed_domain"] and not email.endswith(f"@{cfg['allowed_domain']}"):
        raise HTTPException(status_code=400, detail=f"อีเมลต้องลงท้ายด้วย @{cfg['allowed_domain']}")

    user_payload = body.model_dump()
    if user_payload.get("division_codes") and not user_payload.get("division_code"):
        user_payload["division_code"] = user_payload["division_codes"][0]
    if user_payload.get("units") and not user_payload.get("unit_name"):
        user_payload["unit_name"] = user_payload["units"][0]
    user = db.upsert_user(user_payload)
    actor_id = actor.get("email") or actor.get("username") or "admin"
    db.add_audit_log(
        None,
        actor_id,
        "user_created",
        {"target": user.get("username") or user.get("email"), "role": body.role},
    )
    return {"user": user}


@router.put("/users/{identifier}")
def update_user(
    identifier: str,
    body: UserUpdatePayload,
    x_user_email: str | None = Header(default=None),
    x_user_identifier: str | None = Header(default=None),
    authorization: str | None = Header(default=None),
    cric_sso_session: str | None = Cookie(default=None),
):
    actor = resolve_current_user(
        x_user_email=x_user_email,
        x_user_identifier=x_user_identifier,
        authorization=authorization,
        cookie_session=cric_sso_session,
    )
    if actor["role"] not in ("saraban_admin", "director"):
        raise HTTPException(status_code=403, detail="เฉพาะเจ้าหน้าที่สารบรรณหรือผู้อำนวยการเท่านั้นที่แก้ไขสิทธิ์ผู้ใช้ได้")

    updates = {k: v for k, v in body.model_dump().items() if v is not None}
    if "division_codes" in updates:
        divs = [str(x).strip() for x in updates["division_codes"] if str(x).strip()]
        updates["division_codes"] = divs
        if "division_code" not in updates or (updates["division_code"] not in divs):
            updates["division_code"] = divs[0] if divs else ""
    if "units" in updates:
        units = [str(x).strip() for x in updates["units"] if str(x).strip()]
        updates["units"] = units
        if "unit_name" not in updates or (updates["unit_name"] not in units):
            updates["unit_name"] = units[0] if units else ""

    updated = db.update_user_fields(identifier, updates)
    if not updated:
        raise HTTPException(status_code=404, detail="ไม่พบผู้ใช้งานที่ระบุ")

    actor_id = actor.get("email") or actor.get("username") or "admin"
    db.add_audit_log(
        None,
        actor_id,
        "user_updated",
        {"target": identifier, **updates},
    )
    return {"user": updated}


@router.delete("/users/{identifier}")
def delete_user(
    identifier: str,
    x_user_email: str | None = Header(default=None),
    x_user_identifier: str | None = Header(default=None),
    authorization: str | None = Header(default=None),
    cric_sso_session: str | None = Cookie(default=None),
):
    actor = resolve_current_user(
        x_user_email=x_user_email,
        x_user_identifier=x_user_identifier,
        authorization=authorization,
        cookie_session=cric_sso_session,
    )
    if actor["role"] not in ("saraban_admin", "director"):
        raise HTTPException(status_code=403, detail="เฉพาะเจ้าหน้าที่สารบรรณหรือผู้อำนวยการเท่านั้นที่ลบผู้ใช้ได้")

    target = db.get_user_by_identifier(identifier)
    if not target:
        raise HTTPException(status_code=404, detail="ไม่พบผู้ใช้งานที่ระบุ")
    if target["id"] == actor["id"]:
        raise HTTPException(status_code=400, detail="ไม่สามารถลบบัญชีที่กำลังใช้งานอยู่ได้")

    _clear_local_avatar_files(target["id"])
    sig_raw = (target.get("signature_storage_path") or "").strip()
    if sig_raw:
        try:
            sig_path = Path(sig_raw).resolve()
            if sig_path.is_relative_to(SIGNATURES_DIR.resolve()) and sig_path.exists():
                sig_path.unlink()
        except Exception:
            pass

    deleted = db.delete_user(target["id"])
    actor_id = actor.get("email") or actor.get("username") or "admin"
    db.add_audit_log(
        None,
        actor_id,
        "user_deleted",
        {"target": target.get("email") or target.get("username") or target["id"]},
    )
    return {"ok": True, "deleted": deleted}


@router.post("/users/{identifier}/signature")
async def admin_upload_user_signature(
    identifier: str,
    file: UploadFile = File(...),
    x_user_email: str | None = Header(default=None),
    x_user_identifier: str | None = Header(default=None),
    authorization: str | None = Header(default=None),
    cric_sso_session: str | None = Cookie(default=None),
):
    actor = resolve_current_user(
        x_user_email=x_user_email,
        x_user_identifier=x_user_identifier,
        authorization=authorization,
        cookie_session=cric_sso_session,
    )
    target = db.get_user_by_identifier(identifier)
    if not target:
        raise HTTPException(status_code=404, detail="ไม่พบผู้ใช้งานที่ระบุ")

    if (
        actor["role"] not in ("saraban_admin", "director")
        and actor.get("id") != target.get("id")
    ):
        raise HTTPException(status_code=403, detail="ไม่มีสิทธิ์อัปโหลดลายเซ็นให้ผู้ใช้อื่น")

    ext = Path(file.filename or "sig.png").suffix.lower()
    if ext not in (".png", ".jpg", ".jpeg"):
        raise HTTPException(status_code=400, detail="รองรับเฉพาะไฟล์ภาพลายเซ็น .png หรือ .jpg")

    safe_handle = (target.get("username") or target.get("email") or target["id"]).replace("@", "_at_").replace(".", "_")
    safe_name = f"{safe_handle}{ext}"
    dest = SIGNATURES_DIR / safe_name
    with dest.open("wb") as fh:
        shutil.copyfileobj(file.file, fh)

    db.set_user_signature(target["id"], str(dest))
    actor_id = actor.get("email") or actor.get("username") or "admin"
    db.add_audit_log(None, actor_id, "admin_signature_uploaded", {"target": safe_handle, "path": safe_name})
    return {"ok": True, "signature_storage_path": str(dest)}


@router.get("/sso/config")
def get_sso_config(request: Request):
    cfg = _effective_auth_cfg()
    auth_base = _auth_base_url(cfg)
    sso_realm = str(cfg.get("sso_realm") or SSO_REALM or "cric-college")
    suggested_redirect_uri = _resolve_redirect_uri(request, cfg)
    post_logout_uri = f"{_external_base_url(request)}/login?logout=1"

    login_url = None
    if cfg["sso_client_id"]:
        qs = urlencode(
            {
                "client_id": cfg["sso_client_id"],
                "redirect_uri": suggested_redirect_uri,
                "response_type": "code",
                "scope": "openid profile email",
            }
        )
        login_url = f"{auth_base}/protocol/openid-connect/auth?{qs}"

    panel_raw = str(cfg.get("panel_api_url") or PANEL_API_URL or "https://panel.cric.ac.th").rstrip("/")
    panel_base = panel_raw[:-4] if panel_raw.endswith("/api") else panel_raw

    return {
        "sso_issuer": cfg["sso_issuer"],
        "sso_realm": sso_realm,
        "sso_client_id": cfg["sso_client_id"],
        "client_configured": bool(cfg["sso_client_id"]),
        "allowed_domain": cfg["allowed_domain"],
        "auth_dev_mode": bool(cfg["auth_dev_mode"]),
        "panel_url": panel_base,
        "login_url": login_url,
        "login_endpoint": "/v1/auth/sso/login",
        "logout_endpoint": "/v1/auth/logout",
        "suggested_redirect_uri": suggested_redirect_uri,
        "suggested_post_logout_uri": post_logout_uri,
    }


def _login_error_redirect(error_code: str, detail: str) -> RedirectResponse:
    qs = urlencode({"error": error_code, "detail": detail})
    return RedirectResponse(url=f"/login?{qs}", status_code=302)


@router.get("/sso/login")
async def sso_login(
    request: Request,
    next: str = Query(default="/"),
):
    """Initiate Keycloak OIDC Authorization Code + PKCE S256 login flow."""
    cfg = _effective_auth_cfg()
    client_id = str(cfg.get("sso_client_id") or "").strip()
    if not client_id:
        return _login_error_redirect("missing_client_id", "ยังไม่ได้กำหนด SSO Client ID กรุณาตรวจสอบการตั้งค่าผู้ดูแลระบบ")

    endpoints = await _get_oidc_endpoints(cfg)
    auth_endpoint = endpoints.get("authorization_endpoint")
    if not auth_endpoint:
        return _login_error_redirect("discovery_failed", "ไม่สามารถเชื่อมต่อไปยัง CRIC SSO (sso.cric.ac.th) ได้")

    state = secrets.token_urlsafe(24)
    nonce = secrets.token_urlsafe(24)
    code_verifier = secrets.token_urlsafe(48)
    code_challenge = base64url_encode(hashlib.sha256(code_verifier.encode("ascii")).digest())
    redirect_uri = _resolve_redirect_uri(request, cfg)
    next_path = _sanitize_next_path(next)

    state_payload = {
        "state": state,
        "nonce": nonce,
        "code_verifier": code_verifier,
        "redirect_uri": redirect_uri,
        "next": next_path,
        "exp": int(time.time()) + OIDC_STATE_TTL_SECONDS,
    }
    state_cookie = _sign_hs256_jwt(state_payload, _primary_jwt_secret(cfg))

    qs = urlencode(
        {
            "client_id": client_id,
            "redirect_uri": redirect_uri,
            "response_type": "code",
            "scope": "openid profile email",
            "state": state,
            "nonce": nonce,
            "code_challenge": code_challenge,
            "code_challenge_method": "S256",
        }
    )
    resp = RedirectResponse(url=f"{auth_endpoint}?{qs}", status_code=302)
    is_https = _external_base_url(request).startswith("https://")
    resp.set_cookie(
        key=OIDC_STATE_COOKIE_NAME,
        value=state_cookie,
        max_age=OIDC_STATE_TTL_SECONDS,
        httponly=True,
        samesite="lax",
        secure=is_https,
        path="/",
    )
    return resp


@router.get("/sso/callback")
async def sso_callback(
    request: Request,
    code: str | None = Query(default=None),
    state: str | None = Query(default=None),
    error: str | None = Query(default=None),
    error_description: str | None = Query(default=None),
    cric_oidc_state: str | None = Cookie(default=None),
):
    """Handle Keycloak OIDC callback, exchange code with PKCE, verify ID token, and issue session cookie."""
    cfg = _effective_auth_cfg()
    is_https = _external_base_url(request).startswith("https://")

    def clear_state_cookie(r: RedirectResponse) -> RedirectResponse:
        r.delete_cookie(key=OIDC_STATE_COOKIE_NAME, path="/")
        return r

    if error:
        desc = error_description or "ผู้ใช้ยกเลิกการเข้าสู่ระบบหรือ CRIC SSO ปฏิเสธคำขอ"
        return clear_state_cookie(_login_error_redirect(error, desc))

    if not code or not state or not cric_oidc_state:
        return clear_state_cookie(
            _login_error_redirect("invalid_callback", "ข้อมูลตรวจสอบสถานะการเข้าสู่ระบบไม่ครบถ้วน กรุณาลองใหม่อีกครั้ง")
        )

    state_data = verify_sso_jwt(cric_oidc_state, extra_secrets=[_primary_jwt_secret(cfg)])
    if not state_data or not hmac.compare_digest(str(state_data.get("state") or ""), state):
        return clear_state_cookie(
            _login_error_redirect("invalid_state", "เซสชันการเข้าสู่ระบบหมดอายุหรือไม่ถูกต้อง กรุณากดเข้าสู่ระบบใหม่")
        )

    client_id = str(cfg.get("sso_client_id") or "").strip()
    client_secret = str(cfg.get("sso_client_secret") or "").strip()
    redirect_uri = str(state_data.get("redirect_uri") or _resolve_redirect_uri(request, cfg))
    next_path = _sanitize_next_path(state_data.get("next"))

    endpoints = await _get_oidc_endpoints(cfg)
    token_endpoint = endpoints.get("token_endpoint")
    jwks_uri = endpoints.get("jwks_uri")
    issuer = str(endpoints.get("issuer") or _auth_base_url(cfg))

    form_data = {
        "grant_type": "authorization_code",
        "code": code,
        "redirect_uri": redirect_uri,
        "client_id": client_id,
        "code_verifier": str(state_data.get("code_verifier") or ""),
    }
    if client_secret:
        form_data["client_secret"] = client_secret

    try:
        async with httpx.AsyncClient(timeout=12.0) as client:
            token_resp = await client.post(token_endpoint, data=form_data)
        if token_resp.status_code >= 400:
            err_body = token_resp.text[:250]
            return clear_state_cookie(
                _login_error_redirect("token_exchange_failed", f"แลกเปลี่ยนโทเคนจาก CRIC SSO ไม่สำเร็จ ({err_body})")
            )
        token_json = token_resp.json()
    except Exception as exc:
        return clear_state_cookie(
            _login_error_redirect("sso_unreachable", f"ไม่สามารถติดต่อ CRIC SSO Token Endpoint ได้ ({exc})")
        )

    id_token = token_json.get("id_token")
    access_token = token_json.get("access_token")
    if not id_token:
        return clear_state_cookie(_login_error_redirect("missing_id_token", "ไม่พบ id_token จาก CRIC SSO"))

    try:
        jwks_data = await _get_jwks(jwks_uri)
        try:
            claims = _verify_oidc_id_token(
                id_token=id_token,
                jwks_data=jwks_data,
                issuer=issuer,
                client_id=client_id,
                expected_nonce=state_data.get("nonce"),
            )
        except Exception:
            # Retry once with refreshed JWKS in case Keycloak rotated keys
            jwks_data = await _get_jwks(jwks_uri, force_refresh=True)
            claims = _verify_oidc_id_token(
                id_token=id_token,
                jwks_data=jwks_data,
                issuer=issuer,
                client_id=client_id,
                expected_nonce=state_data.get("nonce"),
            )
    except Exception as exc:
        return clear_state_cookie(
            _login_error_redirect("invalid_id_token", f"ตรวจสอบลายเซ็น ID Token ไม่สำเร็จ ({exc})")
        )

    # Enrich missing profile claims from OIDC userinfo endpoint when access_token is present
    userinfo_endpoint = endpoints.get("userinfo_endpoint")
    if access_token and userinfo_endpoint and (not claims.get("email") or not claims.get("name")):
        try:
            async with httpx.AsyncClient(timeout=6.0) as client:
                ui_resp = await client.get(userinfo_endpoint, headers={"Authorization": f"Bearer {access_token}"})
                if ui_resp.status_code == 200:
                    ui_data = ui_resp.json()
                    if isinstance(ui_data, dict):
                        for k, v in ui_data.items():
                            if k not in claims or not claims.get(k):
                                claims[k] = v
        except Exception:
            pass

    ident_for_panel = str(claims.get("email") or claims.get("preferred_username") or "").strip()
    panel_rec = await _lookup_panel_user(ident_for_panel, cfg)

    try:
        user = _provision_sso_user(claims, cfg, panel_record=panel_rec)
    except HTTPException as exc:
        return clear_state_cookie(_login_error_redirect("access_denied", str(exc.detail)))

    session_payload = {
        "sub": user.get("sso_subject") or claims.get("sub") or user["id"],
        "user_id": user["id"],
        "username": user.get("username") or "",
        "email": user.get("email") or "",
        "name": user.get("full_name") or "",
        "role": user.get("role") or "drafter",
        "auth_source": "sso",
        "iat": int(time.time()),
        "exp": int(time.time()) + SESSION_TTL_SECONDS,
    }
    session_jwt = _sign_hs256_jwt(session_payload, _primary_jwt_secret(cfg))

    actor_id = user.get("email") or user.get("username") or user["id"]
    db.add_audit_log(None, actor_id, "sso_login", {"sso_subject": user.get("sso_subject"), "role": user.get("role")})

    resp = RedirectResponse(url=next_path, status_code=302)
    clear_state_cookie(resp)
    resp.set_cookie(
        key=SESSION_COOKIE_NAME,
        value=session_jwt,
        max_age=SESSION_TTL_SECONDS,
        httponly=True,
        samesite="lax",
        secure=is_https,
        path="/",
    )
    resp.set_cookie(
        key=ID_TOKEN_COOKIE_NAME,
        value=id_token,
        max_age=SESSION_TTL_SECONDS,
        httponly=True,
        samesite="lax",
        secure=is_https,
        path="/",
    )
    return resp


async def _build_sso_logout_url(request: Request, cfg: dict[str, Any], id_token_hint: str | None) -> str | None:
    endpoints = await _get_oidc_endpoints(cfg)
    end_session = endpoints.get("end_session_endpoint")
    if not end_session:
        return None
    post_logout = f"{_external_base_url(request)}/login?logout=1"
    params: dict[str, str] = {"post_logout_redirect_uri": post_logout}
    if cfg.get("sso_client_id"):
        params["client_id"] = str(cfg["sso_client_id"])
    if id_token_hint:
        params["id_token_hint"] = id_token_hint
    return f"{end_session}?{urlencode(params)}"


class SyncSessionPayload(BaseModel):
    sessionToken: str | None = None
    token: str | None = None


@router.post("/sso/sync-session")
async def sync_sso_session(request: Request, body: SyncSessionPayload):
    """Verify an sso_token issued by Central Panel, provision/sync user, and issue session cookie."""
    raw_token = (body.sessionToken or body.token or "").strip()
    if not raw_token:
        raise HTTPException(status_code=400, detail="ไม่พบ sessionToken จาก Central Panel")

    cfg = _effective_auth_cfg()
    payload = verify_sso_jwt(raw_token, extra_secrets=[str(cfg.get("panel_sync_secret") or "")])
    if not payload:
        raise HTTPException(status_code=401, detail="เซสชันไม่ถูกต้องหรือหมดอายุแล้ว")

    panel_rec = None
    if not _extract_avatar_url(payload, None, cfg):
        ident = str(payload.get("email") or payload.get("username") or "").strip()
        if ident:
            panel_rec = await _lookup_panel_user(ident, cfg)

    user = _provision_sso_user(payload, cfg, panel_record=panel_rec)

    session_payload = {
        "sub": user.get("id") or user.get("email") or user.get("username"),
        "username": user.get("username") or "",
        "email": user.get("email") or "",
        "name": user.get("full_name") or "",
        "role": user.get("role") or "drafter",
        "auth_source": "panel_sso_sync",
        "exp": int(time.time()) + SESSION_TTL_SECONDS,
    }
    session_jwt = _sign_hs256_jwt(session_payload, _primary_jwt_secret(cfg))

    actor_id = str(user.get("email") or user.get("username") or user.get("id") or "panel_sso")
    db.add_audit_log(None, actor_id, "sso_sync_session", {"source": "panel"})

    resp = JSONResponse({"success": True, "user": jsonable_encoder(user), "token": session_jwt})
    is_https = _external_base_url(request).startswith("https://")
    resp.set_cookie(
        key=SESSION_COOKIE_NAME,
        value=session_jwt,
        max_age=SESSION_TTL_SECONDS,
        httponly=True,
        samesite="lax",
        secure=is_https,
        path="/",
    )
    resp.set_cookie(
        key="cric_logged_in",
        value="true",
        max_age=SESSION_TTL_SECONDS,
        httponly=False,
        samesite="lax",
        secure=is_https,
        path="/",
    )
    return resp


@router.post("/logout")
async def sso_logout_post(
    request: Request,
    cric_sso_session: str | None = Cookie(default=None),
    cric_sso_id_token: str | None = Cookie(default=None),
):
    cfg = _effective_auth_cfg()
    actor_id = "anonymous"
    if cric_sso_session:
        payload = verify_sso_jwt(cric_sso_session, extra_secrets=[str(cfg.get("panel_sync_secret") or "")])
        if payload:
            actor_id = str(payload.get("email") or payload.get("username") or payload.get("sub") or "anonymous")
    if actor_id != "anonymous":
        db.add_audit_log(None, actor_id, "sso_logout", {})

    sso_logout_url = await _build_sso_logout_url(request, cfg, cric_sso_id_token)
    resp = JSONResponse({"ok": True, "sso_logout_url": sso_logout_url})
    resp.delete_cookie(key=SESSION_COOKIE_NAME, path="/")
    resp.delete_cookie(key=ID_TOKEN_COOKIE_NAME, path="/")
    resp.delete_cookie(key=OIDC_STATE_COOKIE_NAME, path="/")
    resp.delete_cookie(key="cric_logged_in", path="/")
    return resp


@router.get("/logout")
async def sso_logout_get(
    request: Request,
    sso: bool = Query(default=False),
    cric_sso_id_token: str | None = Cookie(default=None),
):
    cfg = _effective_auth_cfg()
    target = "/login?logout=1"
    if sso:
        sso_logout_url = await _build_sso_logout_url(request, cfg, cric_sso_id_token)
        if sso_logout_url:
            target = sso_logout_url
    resp = RedirectResponse(url=target, status_code=302)
    resp.delete_cookie(key=SESSION_COOKIE_NAME, path="/")
    resp.delete_cookie(key=ID_TOKEN_COOKIE_NAME, path="/")
    resp.delete_cookie(key=OIDC_STATE_COOKIE_NAME, path="/")
    resp.delete_cookie(key="cric_logged_in", path="/")
    return resp


_PANEL_DEV_SNAPSHOT: list[dict[str, Any]] = [
    {
        "panel_user_id": "CRIC-001",
        "username": "director",
        "email": "director@cric.ac.th",
        "full_name": "นายยุทธการ ตั้งปัญญาศักดิ์",
        "position_title": "ผู้อำนวยการวิทยาลัยการอาชีพเชียงราย",
        "division_code": "",
        "role": "director",
        "is_active": True,
    },
    {
        "panel_user_id": "CRIC-002",
        "username": "orawan",
        "email": "orawan@cric.ac.th",
        "full_name": "นางสาวอรวรรณ แสงดาว",
        "position_title": "รองผู้อำนวยการฝ่ายบริหารทรัพยากร",
        "division_code": "ฝบ.",
        "role": "deputy_director",
        "is_active": True,
    },
    {
        "panel_user_id": "CRIC-003",
        "username": "saraban",
        "email": "saraban@cric.ac.th",
        "full_name": "นางสาวขนิษฐา สุใจยา",
        "position_title": "หัวหน้างานบริหารงานทั่วไป",
        "division_code": "ฝบ.",
        "role": "saraban_admin",
        "is_active": True,
    },
    {
        "panel_user_id": "CRIC-004",
        "username": "academic",
        "email": "academic@cric.ac.th",
        "full_name": "เจ้าหน้าที่ฝ่ายวิชาการ",
        "position_title": "หัวหน้างานพัฒนาหลักสูตรการเรียนการสอน",
        "division_code": "ฝว.",
        "role": "unit_head",
        "is_active": True,
    },
]


def _map_division_code(raw_code: str, div_name: str = "", dept_str: str = "") -> str:
    code = (raw_code or "").strip().upper()
    if code in ("ฝบ.", "ฝว.", "ฝย.", "ฝก."):
        return code
    if code in ("ADMIN", "RES", "RESOURCE", "RESOURCES", "GENERAL"):
        return "ฝบ."
    if code in ("ACAD", "ACADEMIC", "CURRICULUM"):
        return "ฝว."
    if code in ("PLAN", "PLANNING", "COOP", "BUDGET"):
        return "ฝย."
    if code in ("STUDENT", "DEV", "AFFAIRS"):
        return "ฝก."

    combined = f"{div_name} {dept_str}".strip()
    if "บริหารทรัพยากร" in combined or "สารบรรณ" in combined or "การเงิน" in combined or "อาคารสถานที่" in combined:
        return "ฝบ."
    if "วิชาการ" in combined or "หลักสูตร" in combined or "แผนกวิชา" in combined:
        return "ฝว."
    if "แผนงาน" in combined or "งบประมาณ" in combined or "ยุทธศาสตร์" in combined or "ความร่วมมือ" in combined:
        return "ฝย."
    if "พัฒนากิจการ" in combined or "ปกครอง" in combined or "แนะแนว" in combined or "กิจกรรมนักเรียน" in combined:
        return "ฝก."
    return raw_code.strip() if raw_code.strip() in ("ฝบ.", "ฝว.", "ฝย.", "ฝก.") else ""


def _normalize_and_upsert_records(records: list[dict[str, Any]], cfg: dict[str, Any]) -> list[dict[str, Any]]:
    synced: list[dict[str, Any]] = []
    for rec in records:
        if not isinstance(rec, dict):
            continue

        raw_role = str(rec.get("role") or "").strip().lower()
        personnel_type = str(rec.get("personnel_type") or rec.get("personnelType") or "").strip().upper()
        # Skip student accounts from saraban directory
        if raw_role == "student" or (personnel_type == "STUDENT" and not raw_role):
            continue

        raw_username = str(rec.get("username") or "").strip().lstrip("@")
        raw_email = str(rec.get("email") or "").strip().lower()
        if not raw_username and raw_email:
            raw_username = raw_email.split("@")[0]
        if not raw_username and not raw_email:
            continue

        full_name = str(rec.get("full_name") or rec.get("displayName") or rec.get("name") or raw_username).strip()
        position_title = str(rec.get("position_title") or rec.get("position") or "เจ้าหน้าที่").strip()
        mapped_role = map_panel_role_to_edocx(raw_role)

        # Infer director/deputy_director from position or personnel_type if Panel role is generic
        if mapped_role == "drafter":
            if personnel_type == "DIRECTOR" or ("ผู้อำนวยการวิทยาลัย" in position_title and "รอง" not in position_title):
                mapped_role = "director"
            elif personnel_type == "DEPUTY_DIRECTOR" or "รองผู้อำนวยการ" in position_title:
                mapped_role = "deputy_director"

        units: list[str] = list(rec.get("units")) if isinstance(rec.get("units"), list) else []
        head_units: list[str] = list(
            rec.get("head_units") if isinstance(rec.get("head_units"), list) else (
                rec.get("headUnits") if isinstance(rec.get("headUnits"), list) else []
            )
        )
        div_codes: list[str] = list(
            rec.get("division_codes") if isinstance(rec.get("division_codes"), list) else (
                rec.get("divisionCodes") if isinstance(rec.get("divisionCodes"), list) else []
            )
        )

        # Parse Panel's nested departments: [{ isHead, department: { name, division: { code, name } } }]
        panel_depts = rec.get("departments")
        if isinstance(panel_depts, list):
            for pd in panel_depts:
                if not isinstance(pd, dict):
                    continue
                dept_obj = pd.get("department") if isinstance(pd.get("department"), dict) else pd
                d_name = str(dept_obj.get("name") or "").strip()
                if d_name:
                    if d_name not in units:
                        units.append(d_name)
                    if pd.get("isHead") and d_name not in head_units:
                        head_units.append(d_name)
                div_obj = dept_obj.get("division") if isinstance(dept_obj.get("division"), dict) else {}
                mapped_div = _map_division_code(
                    str(div_obj.get("code") or ""),
                    str(div_obj.get("name") or ""),
                    d_name,
                )
                if mapped_div and mapped_div not in div_codes:
                    div_codes.append(mapped_div)

        if mapped_role in ("drafter", "unit_head") and head_units:
            mapped_role = "unit_head"

        dept_str = str(rec.get("department") or rec.get("department_name") or rec.get("unit_name") or "").strip()
        if dept_str and not units:
            units.append(dept_str)

        raw_div_code = str(rec.get("division_code") or "").strip()
        inferred_div = _map_division_code(raw_div_code, "", dept_str)
        if inferred_div and inferred_div not in div_codes:
            div_codes.append(inferred_div)

        div_code = div_codes[0] if div_codes else inferred_div
        unit_name = str(rec.get("unit_name") or rec.get("unitName") or rec.get("department_name") or dept_str or (units[0] if units else "")).strip() or None

        user_data: dict[str, Any] = {
            "panel_user_id": str(rec.get("id") or rec.get("panel_user_id") or "").strip() or None,
            "username": raw_username,
            "email": raw_email or None,
            "full_name": full_name,
            "position_title": position_title,
            "personnel_type": personnel_type or None,
            "division_code": div_code,
            "division_codes": div_codes if div_codes else None,
            "unit_name": unit_name,
            "units": units if units else None,
            "head_units": head_units if head_units else None,
            "role": mapped_role,
            "avatar_url": _extract_avatar_url(rec, rec, cfg),
            "is_active": bool(rec.get("isActive", rec.get("is_active", True))),
        }
        # Strip None values so local signature_path & unset fields are preserved, while upstream role/divisions/units overwrite cleanly
        user_data = {k: v for k, v in user_data.items() if v is not None}
        synced.append(db.upsert_user(user_data))
    return synced


def _save_sync_status(status: str, mode: str, panel_count: int, plan_count: int, synced_count: int, sources: list[str], error: str = "") -> dict[str, Any]:
    now_iso = datetime.now(timezone.utc).isoformat()
    st = {
        "last_sync_at": now_iso,
        "last_sync_status": status,
        "last_sync_mode": mode,
        "panel_count": panel_count,
        "plan_count": plan_count,
        "synced_count": synced_count,
        "sources": sources,
        "last_error": error,
    }
    db.set_setting("user_sync_status", st, "system")
    return st


async def run_user_sync(
    mode: str = "all",
    actor_id: str = "auto_sync",
    payload_users: list[dict[str, Any]] | None = None,
    is_auto: bool = False,
) -> dict[str, Any]:
    """Sync users from Panel, Plan, or both (Panel -> Plan merge), preserving local signatures."""
    cfg = _effective_auth_cfg()
    tokens = [t for t in (cfg.get("panel_api_token"), cfg.get("panel_sync_secret")) if t and str(t).strip()]
    token: str | list[str] = tokens if tokens else "cric-panel-sync-secret-2026"
    panel_url = str(cfg.get("panel_api_url") or "").strip().rstrip("/")
    plan_url = str(cfg.get("project_system_url") or "").strip().rstrip("/")
    custom_plan_path = str(cfg.get("plan_users_api_path") or "").strip()
    if custom_plan_path and plan_url:
        plan_base = plan_url[:-4] if plan_url.endswith("/api") else plan_url
        plan_fetch_target = custom_plan_path if custom_plan_path.startswith("http") else f"{plan_base}/{custom_plan_path.lstrip('/')}"
    else:
        plan_fetch_target = plan_url
    dev_mode = bool(cfg.get("auth_dev_mode", AUTH_DEV_MODE))

    sources: list[str] = []
    warnings: list[str] = []
    panel_count = 0
    plan_count = 0
    all_synced_by_key: dict[str, dict[str, Any]] = {}

    if payload_users is not None:
        upserted = _normalize_and_upsert_records(payload_users, cfg)
        for u in upserted:
            all_synced_by_key[u.get("email") or u.get("username") or u["id"]] = u
        sources.append("manual_payload")
        if mode == "plan":
            plan_count = len(upserted)
        else:
            panel_count = len(upserted)
    else:
        if mode in ("panel", "all"):
            p_rows, p_hit = await _fetch_upstream_users(panel_url, token) if panel_url else ([], None)
            if not p_rows and dev_mode and not is_auto:
                p_rows = _PANEL_DEV_SNAPSHOT
                p_hit = "panel_dev_snapshot"
            if p_rows:
                upserted = _normalize_and_upsert_records(p_rows, cfg)
                panel_count = len(upserted)
                sources.append(p_hit or panel_url)
                for u in upserted:
                    all_synced_by_key[u.get("email") or u.get("username") or u["id"]] = u
            elif panel_url:
                warnings.append(f"Panel ({panel_url}) ไม่ตอบกลับรายการผู้ใช้ (ตรวจสอบ Token / API)")

        if mode in ("plan", "all"):
            pl_rows, pl_hit = await _fetch_upstream_users(plan_fetch_target, token) if plan_fetch_target else ([], None)
            if pl_rows:
                upserted = _normalize_and_upsert_records(pl_rows, cfg)
                plan_count = len(upserted)
                sources.append(pl_hit or plan_fetch_target)
                for u in upserted:
                    all_synced_by_key[u.get("email") or u.get("username") or u["id"]] = u
            elif plan_fetch_target:
                warnings.append(f"Plan ({plan_fetch_target}) ยังไม่เปิดหรือไม่มี API รายชื่อผู้ใช้ (ตรวจสอบ Plan Users API Path / Token)")

    synced_users = list(all_synced_by_key.values())
    if not synced_users and not dev_mode and not is_auto:
        err_msg = " ; ".join(warnings) if warnings else "ไม่สามารถดึงข้อมูลผู้ใช้จาก Panel หรือ Plan ได้ กรุณาตรวจสอบ URL และ Panel API Token / Sync Secret"
        _save_sync_status("error", mode, panel_count, plan_count, 0, sources, error=err_msg)
        raise HTTPException(status_code=400, detail=err_msg)

    status_val = "ok" if synced_users else ("skipped" if is_auto else "ok")
    sync_meta = _save_sync_status(status_val, mode, panel_count, plan_count, len(synced_users), sources, error="; ".join(warnings))
    if synced_users:
        db.add_audit_log(
            None,
            actor_id,
            f"{mode}_synced",
            {"sources": sources, "panel_count": panel_count, "plan_count": plan_count, "count": len(synced_users)},
        )
    return {
        "source": ", ".join(sources) if sources else "none",
        "sources": sources,
        "warnings": warnings,
        "panel_count": panel_count,
        "plan_count": plan_count,
        "synced_count": len(synced_users),
        "users": synced_users,
        "sync_status": sync_meta,
    }


def _require_sync_admin(
    x_user_email: str | None,
    x_user_identifier: str | None,
    authorization: str | None,
    cric_sso_session: str | None,
) -> dict[str, Any]:
    actor = resolve_current_user(
        x_user_email=x_user_email,
        x_user_identifier=x_user_identifier,
        authorization=authorization,
        cookie_session=cric_sso_session,
    )
    if actor["role"] not in ("saraban_admin", "director") and not AUTH_DEV_MODE:
        raise HTTPException(status_code=403, detail="เฉพาะผู้ดูแลระบบหรือเจ้าหน้าที่สารบรรณเท่านั้นที่สั่งซิงค์ได้")
    return actor


@router.post("/sync-panel")
async def sync_from_panel(
    payload: PanelSyncPayload | None = None,
    x_user_email: str | None = Header(default=None),
    x_user_identifier: str | None = Header(default=None),
    authorization: str | None = Header(default=None),
    cric_sso_session: str | None = Cookie(default=None),
):
    actor = _require_sync_admin(x_user_email, x_user_identifier, authorization, cric_sso_session)
    actor_id = actor.get("email") or actor.get("username") or "admin"
    return await run_user_sync("panel", actor_id=actor_id, payload_users=(payload.users if payload and payload.users else None))


@router.post("/sync-plan")
async def sync_from_plan(
    payload: PanelSyncPayload | None = None,
    x_user_email: str | None = Header(default=None),
    x_user_identifier: str | None = Header(default=None),
    authorization: str | None = Header(default=None),
    cric_sso_session: str | None = Cookie(default=None),
):
    actor = _require_sync_admin(x_user_email, x_user_identifier, authorization, cric_sso_session)
    actor_id = actor.get("email") or actor.get("username") or "admin"
    return await run_user_sync("plan", actor_id=actor_id, payload_users=(payload.users if payload and payload.users else None))


@router.post("/sync-all")
async def sync_all_sources(
    x_user_email: str | None = Header(default=None),
    x_user_identifier: str | None = Header(default=None),
    authorization: str | None = Header(default=None),
    cric_sso_session: str | None = Cookie(default=None),
):
    actor = _require_sync_admin(x_user_email, x_user_identifier, authorization, cric_sso_session)
    actor_id = actor.get("email") or actor.get("username") or "admin"
    return await run_user_sync("all", actor_id=actor_id)


@router.get("/sync-status")
def get_user_sync_status(
    x_user_email: str | None = Header(default=None),
    x_user_identifier: str | None = Header(default=None),
    authorization: str | None = Header(default=None),
    cric_sso_session: str | None = Cookie(default=None),
):
    _require_sync_admin(x_user_email, x_user_identifier, authorization, cric_sso_session)
    cfg = _effective_auth_cfg()
    return {
        "auto_sync_enabled": cfg["auto_sync_enabled"],
        "auto_sync_interval_minutes": cfg["auto_sync_interval_minutes"],
        "auto_sync_sources": cfg["auto_sync_sources"],
        "auto_sync_on_startup": cfg["auto_sync_on_startup"],
        "sync_status": db.get_setting_json("user_sync_status", {}),
    }


@router.post("/webhooks/user-sync")
@router.post("/webhook/panel-sync")
async def webhook_user_sync(
    body: dict[str, Any],
    x_cric_sync_key: str | None = Header(default=None),
    authorization: str | None = Header(default=None),
):
    cfg = _effective_auth_cfg()
    valid_secrets = {
        str(s).strip()
        for s in (
            cfg.get("panel_sync_secret"),
            cfg.get("panel_api_token"),
            "cric-panel-sync-secret-2026",
        )
        if s and str(s).strip()
    }
    bearer = ""
    if authorization and authorization.lower().startswith("bearer "):
        bearer = authorization[7:].strip()
    provided = (x_cric_sync_key or bearer or "").strip()
    if not provided or provided not in valid_secrets:
        raise HTTPException(status_code=401, detail="Invalid sync secret or token")

    records: list[dict[str, Any]] = []
    if isinstance(body.get("users"), list):
        records = [r for r in body["users"] if isinstance(r, dict)]
    elif isinstance(body.get("user"), dict):
        records = [body["user"]]
    elif body.get("email") or body.get("username"):
        records = [body]

    action = str(body.get("action") or body.get("event") or "upsert").strip().lower()
    source = str(body.get("source") or "panel")

    if action in ("delete", "deleted", "deactivate"):
        deactivated: list[dict[str, Any]] = []
        for rec in records:
            ident = str(rec.get("email") or rec.get("username") or rec.get("id") or "").strip()
            if not ident:
                continue
            existing = db.get_user_by_identifier(ident)
            if existing:
                updated = db.upsert_user(
                    {
                        "username": existing["username"],
                        "email": existing.get("email"),
                        "is_active": False,
                    }
                )
                deactivated.append(updated)
        st = _save_sync_status("ok", f"webhook:{source}:deactivate", 0, 0, len(deactivated), [source])
        db.add_audit_log(None, f"webhook:{source}", "user_sync_deactivate", {"source": source, "count": len(deactivated)})
        return {"ok": True, "action": action, "source": source, "synced_count": len(deactivated), "users": deactivated, "sync_status": st}

    upserted = _normalize_and_upsert_records(records, cfg)
    st = _save_sync_status("ok", f"webhook:{source}", len(upserted) if source == "panel" else 0, len(upserted) if source == "plan" else 0, len(upserted), [source])
    db.add_audit_log(None, f"webhook:{source}", "user_sync_webhook", {"source": source, "count": len(upserted)})
    return {"ok": True, "action": action, "source": source, "synced_count": len(upserted), "users": upserted, "sync_status": st}


@router.post("/signature")
async def upload_signature(
    file: UploadFile = File(...),
    x_user_email: str | None = Header(default=None),
    x_user_identifier: str | None = Header(default=None),
    authorization: str | None = Header(default=None),
    cric_sso_session: str | None = Cookie(default=None),
):
    user = resolve_current_user(
        x_user_email=x_user_email,
        x_user_identifier=x_user_identifier,
        authorization=authorization,
        cookie_session=cric_sso_session,
    )
    ext = Path(file.filename or "sig.png").suffix.lower()
    if ext not in (".png", ".jpg", ".jpeg"):
        raise HTTPException(status_code=400, detail="รองรับเฉพาะไฟล์ภาพลายเซ็น .png หรือ .jpg")

    safe_handle = (user.get("username") or user.get("email") or user["id"]).replace("@", "_at_").replace(".", "_")
    safe_name = f"{safe_handle}{ext}"
    dest = SIGNATURES_DIR / safe_name
    with dest.open("wb") as fh:
        shutil.copyfileobj(file.file, fh)

    db.set_user_signature(user["id"], str(dest))
    actor_id = user.get("email") or user.get("username") or "user"
    db.add_audit_log(None, actor_id, "signature_uploaded", {"path": safe_name})
    return {"ok": True, "signature_storage_path": str(dest)}


@router.get("/me/signature")
def get_my_signature(
    x_user_email: str | None = Header(default=None),
    x_user_identifier: str | None = Header(default=None),
    authorization: str | None = Header(default=None),
    cric_sso_session: str | None = Cookie(default=None),
):
    user = resolve_current_user(
        x_user_email=x_user_email,
        x_user_identifier=x_user_identifier,
        authorization=authorization,
        cookie_session=cric_sso_session,
    )
    sig_raw = (user.get("signature_storage_path") or "").strip()
    if not sig_raw:
        raise HTTPException(status_code=404, detail="ยังไม่ได้อัปโหลดภาพลายเซ็น")
    sig_path = Path(sig_raw).resolve()
    if not sig_path.exists() or not sig_path.is_file():
        raise HTTPException(status_code=404, detail="ไม่พบไฟล์ภาพลายเซ็น")
    return FileResponse(sig_path, headers={"Cache-Control": "no-store"})


@router.delete("/signature")
def delete_my_signature(
    x_user_email: str | None = Header(default=None),
    x_user_identifier: str | None = Header(default=None),
    authorization: str | None = Header(default=None),
    cric_sso_session: str | None = Cookie(default=None),
):
    user = resolve_current_user(
        x_user_email=x_user_email,
        x_user_identifier=x_user_identifier,
        authorization=authorization,
        cookie_session=cric_sso_session,
    )
    sig_raw = (user.get("signature_storage_path") or "").strip()
    if sig_raw:
        try:
            sig_path = Path(sig_raw).resolve()
            if sig_path.is_relative_to(SIGNATURES_DIR.resolve()) and sig_path.exists():
                sig_path.unlink()
        except Exception:
            pass
    db.set_user_signature(user["id"], "")
    actor_id = user.get("email") or user.get("username") or "user"
    db.add_audit_log(None, actor_id, "signature_deleted", {})
    return {"ok": True}


_AVATAR_EXTENSIONS = (".webp", ".png", ".jpg", ".jpeg")
_MAX_AVATAR_BYTES = 3 * 1024 * 1024


def _safe_avatar_stem(user_id: str) -> str:
    return "".join(ch if ch.isalnum() or ch in ("-", "_") else "_" for ch in str(user_id))


def _clear_local_avatar_files(user_id: str) -> None:
    stem = _safe_avatar_stem(user_id)
    for ext in _AVATAR_EXTENSIONS:
        candidate = AVATARS_DIR / f"{stem}{ext}"
        if candidate.exists() and candidate.is_file():
            try:
                candidate.unlink()
            except Exception:
                pass


def _find_local_avatar_file(user_id: str) -> Path | None:
    stem = _safe_avatar_stem(user_id)
    for ext in _AVATAR_EXTENSIONS:
        candidate = AVATARS_DIR / f"{stem}{ext}"
        if candidate.exists() and candidate.is_file():
            return candidate
    return None


@router.post("/avatar")
async def upload_avatar(
    file: UploadFile = File(...),
    x_user_email: str | None = Header(default=None),
    x_user_identifier: str | None = Header(default=None),
    authorization: str | None = Header(default=None),
    cric_sso_session: str | None = Cookie(default=None),
):
    user = resolve_current_user(
        x_user_email=x_user_email,
        x_user_identifier=x_user_identifier,
        authorization=authorization,
        cookie_session=cric_sso_session,
    )
    ext = Path(file.filename or "avatar.png").suffix.lower()
    if ext not in _AVATAR_EXTENSIONS:
        raise HTTPException(status_code=400, detail="รองรับเฉพาะไฟล์ภาพ .png, .jpg, .jpeg หรือ .webp")

    raw_bytes = await file.read()
    if not raw_bytes:
        raise HTTPException(status_code=400, detail="ไฟล์ภาพว่างเปล่า")
    if len(raw_bytes) > _MAX_AVATAR_BYTES:
        raise HTTPException(status_code=400, detail="ขนาดไฟล์รูปโปรไฟล์ต้องไม่เกิน 3 MB")

    _clear_local_avatar_files(user["id"])
    stem = _safe_avatar_stem(user["id"])
    dest = AVATARS_DIR / f"{stem}{ext}"
    dest.write_bytes(raw_bytes)

    avatar_url = f"/v1/auth/users/{user['id']}/avatar?v={int(time.time())}"
    db.set_user_avatar(user["id"], avatar_url)
    actor_id = user.get("email") or user.get("username") or user["id"]
    db.add_audit_log(None, actor_id, "avatar_uploaded", {"path": dest.name})
    return {"ok": True, "avatar_url": avatar_url}


@router.get("/users/{user_id}/avatar")
def get_user_avatar(user_id: str):
    avatar_path = _find_local_avatar_file(user_id)
    if not avatar_path:
        raise HTTPException(status_code=404, detail="ไม่พบรูปโปรไฟล์")
    return FileResponse(avatar_path, headers={"Cache-Control": "public, max-age=300"})


@router.delete("/avatar")
def delete_my_avatar(
    x_user_email: str | None = Header(default=None),
    x_user_identifier: str | None = Header(default=None),
    authorization: str | None = Header(default=None),
    cric_sso_session: str | None = Cookie(default=None),
):
    user = resolve_current_user(
        x_user_email=x_user_email,
        x_user_identifier=x_user_identifier,
        authorization=authorization,
        cookie_session=cric_sso_session,
    )
    _clear_local_avatar_files(user["id"])
    db.set_user_avatar(user["id"], "")
    actor_id = user.get("email") or user.get("username") or user["id"]
    db.add_audit_log(None, actor_id, "avatar_deleted", {})
    return {"ok": True}
