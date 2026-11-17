"""Automated tests for CRIC SSO (Keycloak OIDC + PKCE, Panel JWT cookie, Hybrid provisioning, and Logout)."""

from __future__ import annotations

import base64
import hashlib
import json
import os
import tempfile
import time
from pathlib import Path
from typing import Any
from urllib.parse import parse_qs, urlparse

from cryptography.hazmat.primitives.asymmetric import rsa
import jwt
from jwt.algorithms import RSAAlgorithm

_TEST_TMP = tempfile.TemporaryDirectory()
os.environ.setdefault("STORAGE_DIR", _TEST_TMP.name)
os.environ.setdefault("DATABASE_URL", f"sqlite:///{(Path(_TEST_TMP.name) / 'test_sso.db').as_posix()}")

from fastapi.testclient import TestClient

from app.db import db
from app.main import app
import app.routers.auth as auth_router

client = TestClient(app)


def _generate_rsa_jwk(kid: str = "test-kid-1"):
    private_key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    public_jwk = json.loads(RSAAlgorithm.to_jwk(private_key.public_key()))
    public_jwk["kid"] = kid
    public_jwk["use"] = "sig"
    public_jwk["alg"] = "RS256"
    return private_key, {"keys": [public_jwk]}


def _with_temp_integrations(overrides: dict[str, Any]):
    prev = db.get_setting_json("integrations", {})
    db.set_setting("integrations", {**prev, **overrides}, "pytest")
    return prev


def _restore_integrations(prev: dict[str, Any]):
    db.set_setting("integrations", prev, "pytest")


def test_sso_login_builds_pkce_redirect_with_forwarded_host(monkeypatch):
    client.cookies.clear()
    prev = _with_temp_integrations(
        {
            "sso_issuer": "https://sso.cric.ac.th/realms/cric-college",
            "sso_realm": "cric-college",
            "sso_client_id": "cric-edocx",
            "sso_redirect_uri": "",
        }
    )

    async def fake_endpoints(cfg, force_refresh=False):
        return {
            "issuer": "https://sso.cric.ac.th/realms/cric-college",
            "authorization_endpoint": "https://sso.cric.ac.th/realms/cric-college/protocol/openid-connect/auth",
            "token_endpoint": "https://sso.cric.ac.th/realms/cric-college/protocol/openid-connect/token",
            "jwks_uri": "https://sso.cric.ac.th/realms/cric-college/protocol/openid-connect/certs",
            "end_session_endpoint": "https://sso.cric.ac.th/realms/cric-college/protocol/openid-connect/logout",
        }

    monkeypatch.setattr(auth_router, "_get_oidc_endpoints", fake_endpoints)
    try:
        r = client.get(
            "/v1/auth/sso/login?next=/draft",
            headers={"X-Forwarded-Host": "100.75.26.30:3030", "X-Forwarded-Proto": "http"},
            follow_redirects=False,
        )
        assert r.status_code == 302
        loc = r.headers["location"]
        parsed = urlparse(loc)
        qs = parse_qs(parsed.query)
        assert parsed.netloc == "sso.cric.ac.th"
        assert qs["client_id"] == ["cric-edocx"]
        assert qs["response_type"] == ["code"]
        assert qs["code_challenge_method"] == ["S256"]
        assert qs["redirect_uri"] == ["http://100.75.26.30:3030/v1/auth/sso/callback"]
        assert auth_router.OIDC_STATE_COOKIE_NAME in r.cookies
    finally:
        _restore_integrations(prev)


def test_sso_callback_hybrid_provisioning_and_preserves_profile(monkeypatch):
    client.cookies.clear()
    private_key, jwks_doc = _generate_rsa_jwk()
    prev = _with_temp_integrations(
        {
            "sso_issuer": "https://sso.cric.ac.th/realms/cric-college",
            "sso_realm": "cric-college",
            "sso_client_id": "cric-edocx",
            "sso_client_secret": "",
            "allowed_domain": "cric.ac.th",
            "sso_redirect_uri": "",
        }
    )

    issuer = "https://sso.cric.ac.th/realms/cric-college"

    async def fake_endpoints(cfg, force_refresh=False):
        return {
            "issuer": issuer,
            "authorization_endpoint": f"{issuer}/protocol/openid-connect/auth",
            "token_endpoint": f"{issuer}/protocol/openid-connect/token",
            "userinfo_endpoint": f"{issuer}/protocol/openid-connect/userinfo",
            "jwks_uri": f"{issuer}/protocol/openid-connect/certs",
            "end_session_endpoint": f"{issuer}/protocol/openid-connect/logout",
        }

    async def fake_jwks(jwks_uri, force_refresh=False):
        return jwks_doc

    async def fake_panel_lookup(identifier, cfg):
        return None

    state_holder: dict[str, str] = {}

    class FakeResponse:
        def __init__(self, status_code: int, payload: dict[str, Any]):
            self.status_code = status_code
            self._payload = payload
            self.text = json.dumps(payload)

        def json(self):
            return self._payload

    class FakeAsyncClient:
        def __init__(self, *args, **kwargs):
            pass

        async def __aenter__(self):
            return self

        async def __aexit__(self, *args):
            return False

        async def post(self, url, data=None, **kwargs):
            expected_challenge = base64.urlsafe_b64encode(
                hashlib.sha256(data["code_verifier"].encode("ascii")).digest()
            ).decode("utf-8").rstrip("=")
            assert expected_challenge == state_holder["code_challenge"]
            id_token = jwt.encode(
                {
                    "sub": "kc-sub-999",
                    "iss": issuer,
                    "aud": "cric-edocx",
                    "azp": "cric-edocx",
                    "nonce": state_holder["nonce"],
                    "email": "teacher.test@cric.ac.th",
                    "preferred_username": "teacher.test",
                    "name": "อาจารย์ทดสอบ ระบบเอสเอสโอ",
                    "realm_access": {"roles": ["offline_access", "unit_head"]},
                    "exp": int(time.time()) + 300,
                },
                private_key,
                algorithm="RS256",
                headers={"kid": "test-kid-1"},
            )
            return FakeResponse(200, {"id_token": id_token, "access_token": "dummy-access"})

        async def get(self, url, **kwargs):
            return FakeResponse(200, {})

    monkeypatch.setattr(auth_router, "_get_oidc_endpoints", fake_endpoints)
    monkeypatch.setattr(auth_router, "_get_jwks", fake_jwks)
    monkeypatch.setattr(auth_router, "_lookup_panel_user", fake_panel_lookup)
    monkeypatch.setattr(auth_router.httpx, "AsyncClient", FakeAsyncClient)

    try:
        # 1. Start login to capture PKCE state + nonce
        login_res = client.get("/v1/auth/sso/login?next=/approvals", follow_redirects=False)
        assert login_res.status_code == 302
        qs = parse_qs(urlparse(login_res.headers["location"]).query)
        state_holder["state"] = qs["state"][0]
        state_holder["nonce"] = qs["nonce"][0]
        state_holder["code_challenge"] = qs["code_challenge"][0]

        # 2. Callback completes OIDC exchange and creates user
        cb_res = client.get(
            f"/v1/auth/sso/callback?code=auth-code-123&state={state_holder['state']}",
            cookies={auth_router.OIDC_STATE_COOKIE_NAME: login_res.cookies[auth_router.OIDC_STATE_COOKIE_NAME]},
            follow_redirects=False,
        )
        assert cb_res.status_code == 302
        assert cb_res.headers["location"] == "/approvals"
        session_cookie = cb_res.cookies[auth_router.SESSION_COOKIE_NAME]

        # 3. Verify /v1/auth/me works via cookie even without X-User-Email
        me_res = client.get("/v1/auth/me", cookies={auth_router.SESSION_COOKIE_NAME: session_cookie})
        assert me_res.status_code == 200
        assert me_res.json()["auth_source"] == "sso"
        assert me_res.json()["user"]["role"] == "unit_head"
        assert me_res.json()["user"]["sso_subject"] == "kc-sub-999"

        # 4. Customize local profile (position_title & division_code), re-login via SSO, confirm preserved
        user_id = me_res.json()["user"]["id"]
        db.update_user_fields(user_id, {"position_title": "หัวหน้าแผนกวิชาคอมพิวเตอร์", "division_code": "ฝว."})

        login_res2 = client.get("/v1/auth/sso/login", follow_redirects=False)
        qs2 = parse_qs(urlparse(login_res2.headers["location"]).query)
        state_holder["state"] = qs2["state"][0]
        state_holder["nonce"] = qs2["nonce"][0]
        state_holder["code_challenge"] = qs2["code_challenge"][0]
        cb_res2 = client.get(
            f"/v1/auth/sso/callback?code=auth-code-456&state={state_holder['state']}",
            cookies={auth_router.OIDC_STATE_COOKIE_NAME: login_res2.cookies[auth_router.OIDC_STATE_COOKIE_NAME]},
            follow_redirects=False,
        )
        assert cb_res2.status_code == 302
        me_after = client.get(
            "/v1/auth/me",
            cookies={auth_router.SESSION_COOKIE_NAME: cb_res2.cookies[auth_router.SESSION_COOKIE_NAME]},
        )
        assert me_after.status_code == 200
        assert me_after.json()["user"]["position_title"] == "หัวหน้าแผนกวิชาคอมพิวเตอร์"
        assert me_after.json()["user"]["division_code"] == "ฝว."
    finally:
        _restore_integrations(prev)


def test_sso_callback_rejects_bad_state_and_disallowed_domain(monkeypatch):
    client.cookies.clear()
    private_key, jwks_doc = _generate_rsa_jwk()
    prev = _with_temp_integrations(
        {
            "sso_issuer": "https://sso.cric.ac.th/realms/cric-college",
            "sso_realm": "cric-college",
            "sso_client_id": "cric-edocx",
            "allowed_domain": "cric.ac.th",
        }
    )
    issuer = "https://sso.cric.ac.th/realms/cric-college"

    async def fake_endpoints(cfg, force_refresh=False):
        return {
            "issuer": issuer,
            "authorization_endpoint": f"{issuer}/protocol/openid-connect/auth",
            "token_endpoint": f"{issuer}/protocol/openid-connect/token",
            "jwks_uri": f"{issuer}/protocol/openid-connect/certs",
        }

    async def fake_jwks(jwks_uri, force_refresh=False):
        return jwks_doc

    async def fake_panel_lookup(identifier, cfg):
        return None

    nonce_box: dict[str, str] = {}

    class FakeResp:
        def __init__(self, payload):
            self.status_code = 200
            self._p = payload
            self.text = json.dumps(payload)

        def json(self):
            return self._p

    class FakeClient:
        def __init__(self, *a, **k):
            pass

        async def __aenter__(self):
            return self

        async def __aexit__(self, *a):
            return False

        async def post(self, url, **kwargs):
            tok = jwt.encode(
                {
                    "sub": "outsider-1",
                    "iss": issuer,
                    "aud": "cric-edocx",
                    "nonce": nonce_box["nonce"],
                    "email": "outsider@gmail.com",
                    "preferred_username": "outsider",
                    "exp": int(time.time()) + 300,
                },
                private_key,
                algorithm="RS256",
                headers={"kid": "test-kid-1"},
            )
            return FakeResp({"id_token": tok})

    monkeypatch.setattr(auth_router, "_get_oidc_endpoints", fake_endpoints)
    monkeypatch.setattr(auth_router, "_get_jwks", fake_jwks)
    monkeypatch.setattr(auth_router, "_lookup_panel_user", fake_panel_lookup)
    monkeypatch.setattr(auth_router.httpx, "AsyncClient", FakeClient)

    try:
        login_res = client.get("/v1/auth/sso/login", follow_redirects=False)
        qs = parse_qs(urlparse(login_res.headers["location"]).query)
        nonce_box["nonce"] = qs["nonce"][0]

        # Bad state rejected
        bad_state = client.get(
            "/v1/auth/sso/callback?code=c&state=tampered",
            cookies={auth_router.OIDC_STATE_COOKIE_NAME: login_res.cookies[auth_router.OIDC_STATE_COOKIE_NAME]},
            follow_redirects=False,
        )
        assert bad_state.status_code == 302
        assert "error=invalid_state" in bad_state.headers["location"]

        # Disallowed domain rejected
        bad_domain = client.get(
            f"/v1/auth/sso/callback?code=c&state={qs['state'][0]}",
            cookies={auth_router.OIDC_STATE_COOKIE_NAME: login_res.cookies[auth_router.OIDC_STATE_COOKIE_NAME]},
            follow_redirects=False,
        )
        assert bad_domain.status_code == 302
        assert "error=access_denied" in bad_domain.headers["location"]
    finally:
        _restore_integrations(prev)


def test_prod_mode_blocks_header_spoof_and_accepts_panel_jwt_and_logout(monkeypatch):
    client.cookies.clear()
    prev = _with_temp_integrations(
        {
            "auth_dev_mode": False,
            "panel_sync_secret": "panel-shared-secret-key-2026",
            "sso_client_id": "cric-edocx",
        }
    )

    async def fake_endpoints(cfg, force_refresh=False):
        return {
            "issuer": "https://sso.cric.ac.th/realms/cric-college",
            "end_session_endpoint": "https://sso.cric.ac.th/realms/cric-college/protocol/openid-connect/logout",
        }

    monkeypatch.setattr(auth_router, "_get_oidc_endpoints", fake_endpoints)

    try:
        # 1. Spoofed X-User-Email without cookie is rejected with 401 when auth_dev_mode=False
        spoof_me = client.get("/v1/auth/me", headers={"X-User-Email": "saraban@cric.ac.th"})
        assert spoof_me.status_code == 401

        spoof_docs = client.get("/v1/documents", headers={"X-User-Email": "saraban@cric.ac.th"})
        assert spoof_docs.status_code == 401

        spoof_users = client.get("/v1/auth/users", headers={"X-User-Email": "guest"})
        assert spoof_users.status_code == 401

        # 2. Panel-signed cric_sso_session JWT cookie works across all routers (via middleware contextvar)
        panel_jwt = jwt.encode(
            {
                "username": "saraban",
                "email": "saraban@cric.ac.th",
                "name": "นางสาวขนิษฐา สุใจยา",
                "role": "saraban_admin",
                "exp": int(time.time()) + 300,
            },
            "panel-shared-secret-key-2026",
            algorithm="HS256",
        )
        ok_me = client.get("/v1/auth/me", cookies={auth_router.SESSION_COOKIE_NAME: panel_jwt})
        assert ok_me.status_code == 200
        assert ok_me.json()["user"]["email"] == "saraban@cric.ac.th"
        assert ok_me.json()["auth_source"] == "panel_jwt"

        ok_settings = client.get("/v1/settings/admin", cookies={auth_router.SESSION_COOKIE_NAME: panel_jwt})
        assert ok_settings.status_code == 200

        # 3. Logout clears session cookie and returns Keycloak end_session_endpoint
        logout_res = client.post("/v1/auth/logout", cookies={auth_router.SESSION_COOKIE_NAME: panel_jwt})
        assert logout_res.status_code == 200
        assert logout_res.json()["ok"] is True
        assert "protocol/openid-connect/logout" in logout_res.json()["sso_logout_url"]
        set_cookies = logout_res.headers.get_list("set-cookie")
        assert any(auth_router.SESSION_COOKIE_NAME in c for c in set_cookies)
    finally:
        _restore_integrations(prev)


def test_dev_mode_guest_identifier_returns_401_without_creating_guest_user():
    client.cookies.clear()
    prev = _with_temp_integrations({"auth_dev_mode": True})
    try:
        res = client.get("/v1/auth/me", headers={"X-User-Email": "guest"})
        assert res.status_code == 401
        assert db.get_user_by_identifier("guest") is None
        # In Dev Mode, user list remains accessible to populate the Dev Switcher even when switched to Guest
        users_res = client.get("/v1/auth/users", headers={"X-User-Email": "guest"})
        assert users_res.status_code == 200
        assert len(users_res.json()["users"]) >= 1
    finally:
        _restore_integrations(prev)


def test_avatar_hybrid_sync_upload_serve_preserve_and_delete():
    client.cookies.clear()
    prev = _with_temp_integrations(
        {
            "auth_dev_mode": True,
            "panel_api_url": "https://panel.cric.ac.th/api",
            "panel_sync_secret": "panel-shared-secret-key-2026-long",
        }
    )
    try:
        # 1. Panel sync-session with relative avatarUrl resolves against panel_api_url base
        panel_tok = jwt.encode(
            {
                "username": "avatar.tester@cric.ac.th",
                "email": "avatar.tester@cric.ac.th",
                "name": "ณัฐพงษ์ ทดสอบรูปโปรไฟล์",
                "role": "saraban_admin",
                "avatarUrl": "/uploads/avatars/natthaphong.png",
                "exp": int(time.time()) + 300,
            },
            "panel-shared-secret-key-2026-long",
            algorithm="HS256",
        )
        sync_res = client.post("/v1/auth/sso/sync-session", json={"sessionToken": panel_tok})
        assert sync_res.status_code == 200
        user_obj = sync_res.json()["user"]
        user_id = user_obj["id"]
        # Username normalized without duplicate @ when matching email
        assert user_obj["username"] == "avatar.tester"
        assert user_obj["avatar_url"] == "https://panel.cric.ac.th/uploads/avatars/natthaphong.png"

        # 2. Upload custom local avatar in E-Docx
        tiny_png = base64.b64decode(
            "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII="
        )
        up_res = client.post(
            "/v1/auth/avatar",
            files={"file": ("me.png", tiny_png, "image/png")},
        )
        assert up_res.status_code == 200
        local_avatar_url = up_res.json()["avatar_url"]
        assert local_avatar_url.startswith(f"/v1/auth/users/{user_id}/avatar")

        # 3. Serve avatar image cleanly
        get_res = client.get(f"/v1/auth/users/{user_id}/avatar")
        assert get_res.status_code == 200
        assert get_res.headers["content-type"].startswith("image/")

        # 4. Subsequent Panel sync-session preserves locally uploaded E-Docx avatar
        sync_res2 = client.post("/v1/auth/sso/sync-session", json={"sessionToken": panel_tok})
        assert sync_res2.status_code == 200
        assert sync_res2.json()["user"]["avatar_url"] == local_avatar_url

        # 5. Reject invalid extension
        bad_up = client.post(
            "/v1/auth/avatar",
            files={"file": ("bad.txt", b"not-an-image", "text/plain")},
        )
        assert bad_up.status_code == 400

        # 6. Delete avatar clears avatar_url and returns 404 on fetch
        del_res = client.delete("/v1/auth/avatar")
        assert del_res.status_code == 200
        assert client.get(f"/v1/auth/users/{user_id}/avatar").status_code == 404
        client.cookies.clear()
    finally:
        _restore_integrations(prev)


def test_plan_user_settings_multi_units_head_toggle_and_admin_crud():
    client.cookies.clear()
    prev = _with_temp_integrations({"auth_dev_mode": True})
    admin_headers = {"X-User-Email": "saraban@cric.ac.th"}
    try:
        # 1. Verify org_profile includes default division units
        pub = client.get("/v1/settings/public")
        assert pub.status_code == 200
        divs = pub.json()["org_profile"]["divisions"]
        assert "ฝว." in divs and "แผนกวิชาเทคโนโลยีสารสนเทศ" in divs["ฝว."]["units"]

        # 2. Admin creates a multi-division/multi-unit TEACHER user
        create_res = client.post(
            "/v1/auth/users",
            headers=admin_headers,
            json={
                "username": "somchai.teacher",
                "email": "somchai.teacher@cric.ac.th",
                "full_name": "นายสมชาย ใจดี",
                "position_title": "ครูชำนาญการ",
                "personnel_type": "TEACHER",
                "division_code": "ฝว.",
                "division_codes": ["ฝว.", "ฝก."],
                "unit_name": "แผนกวิชาเทคโนโลยีสารสนเทศ",
                "units": ["แผนกวิชาเทคโนโลยีสารสนเทศ", "งานกิจกรรมนักเรียน นักศึกษา"],
                "head_units": [],
                "role": "drafter",
                "is_active": True,
            },
        )
        assert create_res.status_code == 200
        u = create_res.json()["user"]
        uid = u["id"]
        assert u["personnel_type"] == "TEACHER"
        assert u["division_codes"] == ["ฝว.", "ฝก."]
        assert "แผนกวิชาเทคโนโลยีสารสนเทศ" in u["units"]

        # 3. Self-update toggling head_units promotes drafter -> unit_head automatically
        teacher_headers = {"X-User-Email": "somchai.teacher@cric.ac.th"}
        self_head = client.put(
            "/v1/auth/me",
            headers=teacher_headers,
            json={
                "head_units": ["แผนกวิชาเทคโนโลยีสารสนเทศ"],
            },
        )
        assert self_head.status_code == 200
        assert self_head.json()["user"]["role"] == "unit_head"
        assert self_head.json()["user"]["head_units"] == ["แผนกวิชาเทคโนโลยีสารสนเทศ"]

        # 4. Clearing head_units reverts unit_head -> drafter, while non-admin cannot delete users
        self_clear = client.put(
            "/v1/auth/me",
            headers=teacher_headers,
            json={"head_units": []},
        )
        assert self_clear.status_code == 200
        assert self_clear.json()["user"]["role"] == "drafter"
        assert client.delete(f"/v1/auth/users/{uid}", headers=teacher_headers).status_code == 403

        # 5. saraban_admin updating own profile preserves saraban_admin role
        admin_self = client.put("/v1/auth/me", headers=admin_headers, json={"head_units": []})
        assert admin_self.status_code == 200
        assert admin_self.json()["user"]["role"] == "saraban_admin"

        # 6. Admin cannot delete self, can update & delete created user
        me_admin = client.get("/v1/auth/me", headers=admin_headers).json()["user"]
        assert client.delete(f"/v1/auth/users/{me_admin['id']}", headers=admin_headers).status_code == 400

        upd_res = client.put(
            f"/v1/auth/users/{uid}",
            headers=admin_headers,
            json={"units": ["งานกิจกรรมนักเรียน นักศึกษา"], "unit_name": "งานกิจกรรมนักเรียน นักศึกษา"},
        )
        assert upd_res.status_code == 200
        assert upd_res.json()["user"]["units"] == ["งานกิจกรรมนักเรียน นักศึกษา"]

        del_res = client.delete(f"/v1/auth/users/{uid}", headers=admin_headers)
        assert del_res.status_code == 200
        assert db.get_user_by_identifier(uid) is None
    finally:
        _restore_integrations(prev)
