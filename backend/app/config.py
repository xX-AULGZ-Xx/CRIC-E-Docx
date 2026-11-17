"""Application configuration loaded from environment variables."""

from __future__ import annotations

import os
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parent.parent
STORAGE_DIR = Path(os.getenv("STORAGE_DIR", str(BASE_DIR / "storage")))
RENDERED_DIR = STORAGE_DIR / "rendered"
SIGNATURES_DIR = STORAGE_DIR / "signatures"
AVATARS_DIR = STORAGE_DIR / "avatars"
ATTACHMENTS_DIR = STORAGE_DIR / "attachments"
CUSTOM_TEMPLATES_DIR = STORAGE_DIR / "custom_templates"
SYSTEM_TEMPLATE_OVERRIDES_DIR = STORAGE_DIR / "system_template_overrides"
TEMPLATES_DIR = BASE_DIR / "resources" / "templates"

RENDERED_DIR.mkdir(parents=True, exist_ok=True)
SIGNATURES_DIR.mkdir(parents=True, exist_ok=True)
AVATARS_DIR.mkdir(parents=True, exist_ok=True)
ATTACHMENTS_DIR.mkdir(parents=True, exist_ok=True)
CUSTOM_TEMPLATES_DIR.mkdir(parents=True, exist_ok=True)
SYSTEM_TEMPLATE_OVERRIDES_DIR.mkdir(parents=True, exist_ok=True)

DATABASE_URL = os.getenv("DATABASE_URL", f"sqlite:///{(STORAGE_DIR / 'cric_edocx.db').as_posix()}")

SSO_ISSUER = os.getenv("SSO_ISSUER", "https://sso.cric.ac.th/realms/cric-college")
SSO_REALM = os.getenv("SSO_REALM", "cric-college")
SSO_CLIENT_ID = os.getenv("SSO_CLIENT_ID", "cric-edocx")
SSO_CLIENT_SECRET = os.getenv("SSO_CLIENT_SECRET", "")
SSO_REDIRECT_URI = os.getenv("SSO_REDIRECT_URI", "")
ALLOWED_EMAIL_DOMAIN = os.getenv("ALLOWED_EMAIL_DOMAIN", "cric.ac.th")

PANEL_API_URL = os.getenv("PANEL_API_URL", "http://localhost:3000")
PANEL_API_TOKEN = os.getenv("PANEL_API_TOKEN", "")
PANEL_SYNC_SECRET = os.getenv("PANEL_SYNC_SECRET", "")
JWT_SECRET = os.getenv("JWT_SECRET", "cric-secure-jwt-secret-key-super-random-32char")

GEMINI_API_KEY = os.getenv("GEMINI_API_KEY", "")
OPENAI_API_KEY = os.getenv("OPENAI_API_KEY", "")
LOCAL_LLM_BASE_URL = os.getenv("LOCAL_LLM_BASE_URL", "http://localhost:11434/v1")

AUTH_DEV_MODE = os.getenv("AUTH_DEV_MODE", "true").lower() in ("1", "true", "yes")
CORS_ORIGINS = [o.strip() for o in os.getenv("CORS_ORIGINS", "http://localhost:3030,http://127.0.0.1:3030,http://localhost:3000,http://127.0.0.1:3000").split(",") if o.strip()]
