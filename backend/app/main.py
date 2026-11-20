"""FastAPI entrypoint for CRIC E-Docx backend engine."""

from __future__ import annotations

import asyncio
import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware

from app.config import CORS_ORIGINS
from app.db import db
from app.routers import ai, auth, bundles, courses, documents, notifications, registry, services, settings, templates
from app.routers.auth import _effective_auth_cfg, reset_request_auth_context, run_user_sync, set_request_auth_context

logger = logging.getLogger("cric.autosync")


async def _auto_sync_loop() -> None:
    try:
        await asyncio.sleep(5)
        cfg = _effective_auth_cfg()
        if cfg.get("auto_sync_enabled") and cfg.get("auto_sync_on_startup", True):
            mode = "all" if cfg.get("auto_sync_sources") == "both" else str(cfg.get("auto_sync_sources") or "all")
            try:
                await run_user_sync(mode=mode, actor_id="auto_sync_startup", is_auto=True)
            except Exception as exc:
                logger.warning("Startup auto-sync failed: %s", exc)

        elapsed = 0
        while True:
            await asyncio.sleep(30)
            elapsed += 30
            cfg = _effective_auth_cfg()
            if not cfg.get("auto_sync_enabled"):
                elapsed = 0
                continue
            interval_sec = max(5, int(cfg.get("auto_sync_interval_minutes", 30) or 30)) * 60
            if elapsed >= interval_sec:
                elapsed = 0
                mode = "all" if cfg.get("auto_sync_sources") == "both" else str(cfg.get("auto_sync_sources") or "all")
                try:
                    await run_user_sync(mode=mode, actor_id="auto_sync", is_auto=True)
                except Exception as exc:
                    logger.warning("Scheduled auto-sync failed: %s", exc)
    except asyncio.CancelledError:
        return


@asynccontextmanager
async def lifespan(_app: FastAPI):
    task = asyncio.create_task(_auto_sync_loop())
    try:
        yield
    finally:
        task.cancel()
        try:
            await task
        except asyncio.CancelledError:
            pass


app = FastAPI(
    title="CRIC E-Docx Document Engine",
    version="1.0.0",
    description="Official Thai government document drafting, validation, PDF preview, signing, and Saraban registry API.",
    lifespan=lifespan,
)


@app.middleware("http")
async def attach_request_auth_context(request: Request, call_next):
    token = set_request_auth_context(
        authorization=request.headers.get("authorization"),
        cookie_session=request.cookies.get("cric_sso_session"),
        x_user_identifier=request.headers.get("x-user-identifier"),
        x_user_email=request.headers.get("x-user-email"),
    )
    try:
        return await call_next(request)
    finally:
        reset_request_auth_context(token)

app.add_middleware(
    CORSMiddleware,
    allow_origins=CORS_ORIGINS,
    allow_origin_regex=r"^https?://(localhost|127\.0\.0\.1|100\.\d+\.\d+\.\d+|[a-zA-Z0-9-]+\.[a-zA-Z0-9-]+\.ts\.net)(:\d+)?$",
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(auth.router)
app.include_router(documents.router)
app.include_router(bundles.router)
app.include_router(courses.router)
app.include_router(registry.router)
app.include_router(ai.router)
app.include_router(settings.router)
app.include_router(services.router)
app.include_router(templates.router)
app.include_router(notifications.router)


@app.get("/health")
def health_check():
    return {"status": "ok", "db_backend": "postgresql" if db.use_pg else "sqlite"}
