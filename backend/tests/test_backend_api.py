"""Comprehensive backend API tests for Jax Studio.

Covers:
- Public: GET /api/, /api/settings, /api/projects
- Auth: POST /api/admin/login (success + failure)
- Settings CRUD with about_* fields, validation, reset
- About photo upload (PNG ok, .txt rejected, oversize rejected, served via /api/uploads)
- Projects CRUD round-trip
- Contact form validation, honeypot, persistence
- Admin contacts pagination + read/unread + delete
- Webhook auth (no headers → 401, bad sig → 403)

Run: pytest /app/backend/tests/test_backend_api.py -v
"""
import io
import os
import time
import uuid

import pytest
import requests

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "https://store-preview-site.preview.emergentagent.com").rstrip("/")
ADMIN_PASSWORD = "jaxstudio2026"


@pytest.fixture(scope="session")
def api():
    s = requests.Session()
    s.headers.update({"Content-Type": "application/json"})
    return s


@pytest.fixture(scope="session")
def admin_token(api):
    r = api.post(f"{BASE_URL}/api/admin/login", json={"password": ADMIN_PASSWORD})
    if r.status_code != 200:
        pytest.skip(f"Admin login failed: {r.status_code} {r.text}")
    data = r.json()
    assert "token" in data and isinstance(data["token"], str) and len(data["token"]) > 20
    assert data.get("role") == "admin"
    return data["token"]


@pytest.fixture(scope="session")
def auth_headers(admin_token):
    return {"Authorization": f"Bearer {admin_token}", "Content-Type": "application/json"}


# ---------------- Public ----------------
class TestPublic:
    def test_root(self, api):
        r = api.get(f"{BASE_URL}/api/")
        assert r.status_code == 200
        assert "message" in r.json()

    def test_get_settings_public(self, api):
        r = api.get(f"{BASE_URL}/api/settings")
        assert r.status_code == 200
        data = r.json()
        # Verify all about_* fields exist (may be null)
        for key in ["about_eyebrow", "about_heading_pre", "about_heading_emphasis",
                    "about_body", "about_photo_url", "about_person_name",
                    "about_person_role", "about_years", "about_skills", "about_tools"]:
            assert key in data, f"Missing field: {key}"

    def test_get_projects(self, api):
        r = api.get(f"{BASE_URL}/api/projects")
        assert r.status_code == 200
        rows = r.json()
        assert isinstance(rows, list)


# ---------------- Auth ----------------
class TestAuth:
    def test_login_wrong_password(self, api):
        r = api.post(f"{BASE_URL}/api/admin/login", json={"password": "wrong-pw-xxx"})
        assert r.status_code in (401, 429)

    def test_admin_me(self, api, auth_headers):
        r = requests.get(f"{BASE_URL}/api/admin/me", headers=auth_headers)
        assert r.status_code == 200
        assert r.json().get("role") == "admin"

    def test_admin_me_no_auth(self):
        # Use fresh session (not the shared one which has admin cookie from login)
        r = requests.get(f"{BASE_URL}/api/admin/me")
        assert r.status_code == 401


# ---------------- Settings about_* roundtrip ----------------
class TestAboutSettings:
    def test_reset_then_about_fields_null(self, auth_headers):
        r = requests.post(f"{BASE_URL}/api/admin/settings/reset", headers=auth_headers)
        assert r.status_code == 200, r.text
        data = r.json()
        for key in ["about_eyebrow", "about_heading_pre", "about_heading_emphasis",
                    "about_body", "about_photo_url", "about_person_name",
                    "about_person_role", "about_years", "about_skills", "about_tools"]:
            assert data.get(key) is None, f"{key} should be null after reset, got {data.get(key)}"

        # Verify via public GET
        pub = requests.get(f"{BASE_URL}/api/settings")
        assert pub.status_code == 200
        for key in ["about_body", "about_photo_url", "about_skills", "about_tools"]:
            assert pub.json().get(key) is None

    def test_put_about_fields_persists(self, auth_headers):
        payload = {
            "about_eyebrow": "TEST_eyebrow",
            "about_heading_pre": "Hi, I'm",
            "about_heading_emphasis": "TestPerson",
            "about_body": "First paragraph.\n\nSecond paragraph here.",
            "about_person_name": "Test Person",
            "about_person_role": "Designer",
            "about_years": 7,
            "about_skills": [{"name": "Brand Identity", "pct": 95}, {"name": "UI Design", "pct": 88}],
            "about_tools": ["Figma", "Illustrator", "Photoshop"],
        }
        r = requests.put(f"{BASE_URL}/api/admin/settings", json=payload, headers=auth_headers)
        assert r.status_code == 200, r.text
        data = r.json()
        assert data["about_eyebrow"] == "TEST_eyebrow"
        assert data["about_years"] == 7
        assert data["about_skills"][0]["name"] == "Brand Identity"
        assert "Figma" in data["about_tools"]

        # Roundtrip via public GET
        pub = requests.get(f"{BASE_URL}/api/settings").json()
        assert pub["about_eyebrow"] == "TEST_eyebrow"
        assert pub["about_person_name"] == "Test Person"
        assert pub["about_years"] == 7
        assert len(pub["about_skills"]) == 2

    def test_put_about_years_out_of_range(self, auth_headers):
        r = requests.put(f"{BASE_URL}/api/admin/settings",
                         json={"about_years": 200}, headers=auth_headers)
        assert r.status_code == 422

    def test_put_about_body_oversize(self, auth_headers):
        r = requests.put(f"{BASE_URL}/api/admin/settings",
                         json={"about_body": "x" * 2500}, headers=auth_headers)
        assert r.status_code == 422


# ---------------- Welcome→About transition fields (NEW) ----------------
class TestAboutTransitionSettings:
    """about_transition_effect (one of 9 codrops names | null) +
       about_transition_speed (0.5–2.0 | null) round-trip + validation."""

    VALID_EFFECTS = [
        "Eurhythmic", "Aquarius", "Lycanthropy", "Wonderland", "Screenager",
        "Callipygian", "Eviternity", "Jumbuck", "Babooner",
    ]

    def test_get_settings_exposes_new_fields_publicly(self, api):
        r = api.get(f"{BASE_URL}/api/settings")
        assert r.status_code == 200
        data = r.json()
        assert "about_transition_effect" in data, "Public GET missing about_transition_effect"
        assert "about_transition_speed" in data, "Public GET missing about_transition_speed"

    def test_put_valid_transition_effect_and_speed_roundtrip(self, auth_headers, api):
        payload = {"about_transition_effect": "Wonderland", "about_transition_speed": 1.25}
        r = requests.put(f"{BASE_URL}/api/admin/settings", json=payload, headers=auth_headers)
        assert r.status_code == 200, r.text
        data = r.json()
        assert data["about_transition_effect"] == "Wonderland"
        assert abs(data["about_transition_speed"] - 1.25) < 1e-6

        # Public GET reflects values
        pub = api.get(f"{BASE_URL}/api/settings").json()
        assert pub["about_transition_effect"] == "Wonderland"
        assert abs(pub["about_transition_speed"] - 1.25) < 1e-6

    def test_put_all_nine_effects_accepted(self, auth_headers):
        for eff in self.VALID_EFFECTS:
            r = requests.put(f"{BASE_URL}/api/admin/settings",
                             json={"about_transition_effect": eff}, headers=auth_headers)
            assert r.status_code == 200, f"{eff} rejected: {r.text}"
            assert r.json()["about_transition_effect"] == eff

    def test_put_invalid_transition_effect_rejected(self, auth_headers):
        r = requests.put(f"{BASE_URL}/api/admin/settings",
                         json={"about_transition_effect": "NotARealEffect"}, headers=auth_headers)
        assert r.status_code == 422

    def test_put_speed_below_range_rejected(self, auth_headers):
        r = requests.put(f"{BASE_URL}/api/admin/settings",
                         json={"about_transition_speed": 0.4}, headers=auth_headers)
        assert r.status_code == 422

    def test_put_speed_above_range_rejected(self, auth_headers):
        r = requests.put(f"{BASE_URL}/api/admin/settings",
                         json={"about_transition_speed": 2.1}, headers=auth_headers)
        assert r.status_code == 422

    def test_put_speed_boundaries_accepted(self, auth_headers):
        for v in (0.5, 2.0):
            r = requests.put(f"{BASE_URL}/api/admin/settings",
                             json={"about_transition_speed": v}, headers=auth_headers)
            assert r.status_code == 200, f"speed {v} rejected: {r.text}"
            assert abs(r.json()["about_transition_speed"] - v) < 1e-6

    def test_reset_clears_new_fields_to_none(self, auth_headers, api):
        # First set both fields
        requests.put(f"{BASE_URL}/api/admin/settings",
                     json={"about_transition_effect": "Aquarius",
                           "about_transition_speed": 1.5},
                     headers=auth_headers)
        # Reset
        r = requests.post(f"{BASE_URL}/api/admin/settings/reset", headers=auth_headers)
        assert r.status_code == 200, r.text
        data = r.json()
        assert data.get("about_transition_effect") is None
        assert data.get("about_transition_speed") is None

        # Public GET also null
        pub = api.get(f"{BASE_URL}/api/settings").json()
        assert pub.get("about_transition_effect") is None
        assert pub.get("about_transition_speed") is None

    def test_put_null_partial_update_keeps_existing(self, auth_headers):
        """Partial PUT with null should NOT override existing values (exclude_none behavior).
        The proper way to clear is POST /api/admin/settings/reset (covered above)."""
        # set values
        requests.put(f"{BASE_URL}/api/admin/settings",
                     json={"about_transition_effect": "Babooner",
                           "about_transition_speed": 1.1},
                     headers=auth_headers)
        # partial PUT with nulls — should preserve previously-set values
        r = requests.put(f"{BASE_URL}/api/admin/settings",
                         json={"about_transition_effect": None,
                               "about_transition_speed": None},
                         headers=auth_headers)
        assert r.status_code == 200
        assert r.json()["about_transition_effect"] == "Babooner"
        assert abs(r.json()["about_transition_speed"] - 1.1) < 1e-6


# ---------------- About photo upload ----------------
class TestAboutUpload:
    @staticmethod
    def _png_bytes():
        # Minimal valid 1x1 PNG
        import base64
        return base64.b64decode(
            "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII="
        )

    def test_upload_png_ok(self, admin_token):
        headers = {"Authorization": f"Bearer {admin_token}"}
        files = {"file": ("test.png", self._png_bytes(), "image/png")}
        r = requests.post(f"{BASE_URL}/api/admin/about/upload", headers=headers, files=files)
        assert r.status_code == 200, r.text
        body = r.json()
        assert "image_url" in body and body["image_url"].startswith("/api/uploads/")
        assert body["ext"] == ".png"
        assert body["size"] > 0

        # Verify the file is reachable
        url = f"{BASE_URL}{body['image_url']}"
        r2 = requests.get(url)
        assert r2.status_code == 200, f"image not reachable at {url}"
        assert r2.headers.get("content-type", "").startswith("image/")

    def test_upload_txt_rejected(self, admin_token):
        headers = {"Authorization": f"Bearer {admin_token}"}
        files = {"file": ("bad.txt", b"hello", "text/plain")}
        r = requests.post(f"{BASE_URL}/api/admin/about/upload", headers=headers, files=files)
        assert r.status_code == 400

    def test_upload_oversize_rejected(self, admin_token):
        headers = {"Authorization": f"Bearer {admin_token}"}
        big = b"\x89PNG\r\n\x1a\n" + b"\x00" * (7 * 1024 * 1024)
        files = {"file": ("huge.png", big, "image/png")}
        r = requests.post(f"{BASE_URL}/api/admin/about/upload", headers=headers, files=files)
        assert r.status_code == 413

    def test_upload_no_auth(self):
        files = {"file": ("test.png", self._png_bytes(), "image/png")}
        r = requests.post(f"{BASE_URL}/api/admin/about/upload", files=files)
        assert r.status_code == 401


# ---------------- Projects CRUD ----------------
class TestProjects:
    def test_projects_crud_roundtrip(self, auth_headers):
        # Create
        payload = {"title": "TEST_Project", "year": 2026,
                   "description": "Test description", "accent": "#ff5722"}
        r = requests.post(f"{BASE_URL}/api/admin/projects", json=payload, headers=auth_headers)
        assert r.status_code == 200, r.text
        proj = r.json()
        assert proj["title"] == "TEST_Project"
        assert proj["year"] == 2026
        assert "id" in proj
        pid = proj["id"]

        # Verify via public GET
        listing = requests.get(f"{BASE_URL}/api/projects").json()
        assert any(p["id"] == pid for p in listing)

        # Update
        r2 = requests.put(f"{BASE_URL}/api/admin/projects/{pid}",
                          json={"title": "TEST_Updated"}, headers=auth_headers)
        assert r2.status_code == 200
        assert r2.json()["title"] == "TEST_Updated"

        # Delete
        r3 = requests.delete(f"{BASE_URL}/api/admin/projects/{pid}", headers=auth_headers)
        assert r3.status_code == 200

        # Verify gone
        listing2 = requests.get(f"{BASE_URL}/api/projects").json()
        assert not any(p["id"] == pid for p in listing2)

    def test_projects_no_auth(self):
        r = requests.post(f"{BASE_URL}/api/admin/projects",
                          json={"title": "x", "year": 2026})
        assert r.status_code == 401


# ---------------- Contact form ----------------
class TestContact:
    def test_contact_required_fields(self, api):
        r = api.post(f"{BASE_URL}/api/contact", json={"name": "", "email": "x", "message": ""})
        assert r.status_code == 422

    def test_contact_invalid_email(self, api):
        r = api.post(f"{BASE_URL}/api/contact",
                     json={"name": "X", "email": "not-an-email", "message": "hello there"})
        assert r.status_code == 422

    def test_contact_honeypot_silent(self, api):
        r = api.post(f"{BASE_URL}/api/contact", json={
            "name": "TEST_Bot", "email": "bot@example.com",
            "message": "spam content here", "website": "http://spam.com"
        })
        assert r.status_code == 200
        # Silent reject — should NOT have persisted
        # verify via admin list later

    def test_contact_persists(self, api, auth_headers):
        unique_msg = f"TEST_msg_{uuid.uuid4().hex[:8]}"
        r = api.post(f"{BASE_URL}/api/contact", json={
            "name": "TEST_Visitor", "email": "test@example.com",
            "message": unique_msg + " additional content for length",
        })
        assert r.status_code == 200
        sub_id = r.json()["id"]
        assert sub_id

        # Verify it was persisted
        r2 = requests.get(f"{BASE_URL}/api/admin/contacts/{sub_id}", headers=auth_headers)
        assert r2.status_code == 200
        assert r2.json()["name"] == "TEST_Visitor"

        # Cleanup
        requests.delete(f"{BASE_URL}/api/admin/contacts/{sub_id}", headers=auth_headers)


# ---------------- Admin contacts inbox ----------------
class TestAdminContacts:
    def test_pagination_and_read_flag(self, api, auth_headers):
        # Create one
        r = api.post(f"{BASE_URL}/api/contact", json={
            "name": "TEST_Inbox", "email": "inbox@example.com",
            "message": "TEST_inbox message body content",
        })
        sub_id = r.json()["id"]

        # List
        r2 = requests.get(f"{BASE_URL}/api/admin/contacts?limit=5&skip=0",
                          headers=auth_headers)
        assert r2.status_code == 200
        body = r2.json()
        assert "items" in body and "total" in body and "unread" in body
        assert isinstance(body["items"], list)

        # unread_only
        r3 = requests.get(f"{BASE_URL}/api/admin/contacts?unread_only=true",
                          headers=auth_headers)
        assert r3.status_code == 200

        # Mark as read
        r4 = requests.patch(f"{BASE_URL}/api/admin/contacts/{sub_id}",
                            json={"read": True}, headers=auth_headers)
        assert r4.status_code == 200
        assert r4.json()["read"] is True

        # Delete
        r5 = requests.delete(f"{BASE_URL}/api/admin/contacts/{sub_id}",
                             headers=auth_headers)
        assert r5.status_code == 200


# ---------------- Webhook auth ----------------
class TestWebhookAuth:
    def test_no_headers(self, api):
        r = api.post(f"{BASE_URL}/api/webhooks/sendgrid", data="[]")
        assert r.status_code == 401

    def test_bad_signature(self, api):
        r = api.post(
            f"{BASE_URL}/api/webhooks/sendgrid",
            data="[]",
            headers={
                "X-Twilio-Email-Event-Webhook-Signature": "bad-signature-here",
                "X-Twilio-Email-Event-Webhook-Timestamp": str(int(time.time())),
                "Content-Type": "application/json",
            },
        )
        assert r.status_code == 403


# ---------------- Cleanup ----------------
@pytest.fixture(scope="session", autouse=True)
def cleanup_at_end(request):
    yield
    # Reset settings after all tests
    try:
        r = requests.post(f"{BASE_URL}/api/admin/login", json={"password": ADMIN_PASSWORD})
        if r.status_code == 200:
            tok = r.json()["token"]
            requests.post(f"{BASE_URL}/api/admin/settings/reset",
                          headers={"Authorization": f"Bearer {tok}"})
    except Exception:
        pass
