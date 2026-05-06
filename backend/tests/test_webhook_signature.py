"""End-to-end test for the SendGrid webhook signature verification path.

We can't easily test against SendGrid's real public key (we don't have the matching
private key). So we generate a fresh P-256 keypair, monkey-patch the loaded public
key, and verify that:
  - a valid signature → 200 + events appended to the matching submission
  - a wrong signature → 403
  - missing headers   → 401

Run:  cd /app/backend && python -m pytest tests/test_webhook_signature.py -q
"""
import base64
import json
import os
import time

import pytest
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import ec
from fastapi.testclient import TestClient

import server  # /app/backend/server.py


@pytest.fixture(scope="module")
def keypair():
    priv = ec.generate_private_key(ec.SECP256R1())
    pub = priv.public_key()
    pub_pem = pub.public_bytes(
        encoding=serialization.Encoding.DER,
        format=serialization.PublicFormat.SubjectPublicKeyInfo,
    )
    pub_b64 = base64.b64encode(pub_pem).decode("ascii")
    return priv, pub, pub_b64


@pytest.fixture
def client(monkeypatch, keypair):
    _, pub, _ = keypair
    # Inject the test public key into the loaded module-level singleton
    monkeypatch.setattr(server, "_sg_webhook_pubkey", pub, raising=True)
    return TestClient(server.app)


def _sign(priv, timestamp: str, body: bytes) -> str:
    payload = (timestamp + body.decode("utf-8")).encode("utf-8")
    sig_der = priv.sign(payload, ec.ECDSA(hashes.SHA256()))
    return base64.b64encode(sig_der).decode("ascii")


def test_valid_signature_appends_events(client, keypair, monkeypatch):
    priv, _, _ = keypair
    sub_id = "test-sub-" + os.urandom(4).hex()

    # Stub the collection to avoid motor/event-loop conflicts in TestClient
    captured = []

    class _StubColl:
        async def update_one(self, _filter, update):
            captured.append((_filter.get("id"), update["$push"]["events"]["event"]))

            class _R: matched_count = 1
            return _R()

    monkeypatch.setattr(server.db, "contact_submissions", _StubColl(), raising=False)

    body = json.dumps([
        {"event": "delivered", "email": "sig@test.dev", "timestamp": int(time.time()),
         "submission_id": sub_id, "kind": "owner", "sg_event_id": "abc"},
        {"event": "open", "email": "sig@test.dev", "timestamp": int(time.time()),
         "submission_id": sub_id, "kind": "customer"},
    ]).encode("utf-8")
    ts = str(int(time.time()))
    sig = _sign(priv, ts, body)

    r = client.post(
        "/api/webhooks/sendgrid",
        content=body,
        headers={
            "Content-Type": "application/json",
            "X-Twilio-Email-Event-Webhook-Signature": sig,
            "X-Twilio-Email-Event-Webhook-Timestamp": ts,
        },
    )
    assert r.status_code == 200, r.text
    assert r.json() == {"accepted": 2, "skipped": 0}
    assert {ev for _, ev in captured} == {"delivered", "open"}
    assert all(sid == sub_id for sid, _ in captured)


def test_invalid_signature_rejected(client, keypair):
    priv, _, _ = keypair
    body = b"[]"
    ts = str(int(time.time()))
    # sign different body so signature won't match
    sig = _sign(priv, ts, b'[{"event":"delivered"}]')
    r = client.post(
        "/api/webhooks/sendgrid",
        content=body,
        headers={
            "X-Twilio-Email-Event-Webhook-Signature": sig,
            "X-Twilio-Email-Event-Webhook-Timestamp": ts,
        },
    )
    assert r.status_code == 403


def test_missing_headers_rejected(client):
    r = client.post("/api/webhooks/sendgrid", content=b"[]")
    assert r.status_code == 401
