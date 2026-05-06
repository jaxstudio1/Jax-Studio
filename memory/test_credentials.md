# Jax Studio — Test / Admin Credentials

## Live Jax site (`/app/frontend` + `/app/backend`)
- **Admin URL**: site → bottom-left **ADMIN** button (lock icon)
- **Password**: `jaxstudio2026`
- **Session**: 7-day JWT (HS256)
- **Brute-force**: 5 failed attempts per 15 minutes per IP

### Change the live admin password
1. Generate a new bcrypt hash:
   ```bash
   python3 -c "import bcrypt; print(bcrypt.hashpw(b'YOUR_NEW_PASSWORD', bcrypt.gensalt()).decode())"
   ```
2. Update `ADMIN_PASSWORD_HASH` in `/app/backend/.env` (keep the surrounding double-quotes).
3. Restart: `sudo supervisorctl restart backend`.
4. To invalidate any existing JWTs, also rotate `JWT_SECRET` (any 64-hex-character string).

---

## Template (`/app/template/`) — for cloning to new client projects
- **Default admin password**: `template2026` (hash already in `/app/template/backend/.env`)
- **JWT_SECRET in template `.env`** is a PLACEHOLDER — generate a real one before deploying:
  ```bash
  python3 -c "import secrets; print(secrets.token_hex(32))"
  ```
- **SendGrid creds** in template `.env` are empty — fill in `SENDGRID_API_KEY`, `SENDER_EMAIL`, `SENDER_NAME`, `OWNER_EMAIL` before going live.
- See `/app/template/README.md` for the full setup workflow.

---

## API endpoints (admin)
- `POST /api/admin/login` — body: `{"password": "..."}` → `{token, expires_in, role}`
- `POST /api/admin/logout`
- `GET  /api/admin/me`
- `GET  /api/admin/settings`
- `PUT  /api/admin/settings` — partial update of any field
- `POST /api/admin/settings/reset` — restores defaults + deletes uploaded logo
- `POST /api/admin/upload/logo` — multipart `file` (PNG / SVG, ≤ 4 MB)
- `GET  /api/admin/contacts?limit=&skip=&unread_only=` — paginated inbox (newest first)
- `GET  /api/admin/contacts/{id}` — full submission incl. delivery `events[]`
- `PATCH /api/admin/contacts/{id}` — body `{"read": true|false}`
- `DELETE /api/admin/contacts/{id}` — remove a submission

## API endpoints (webhooks)
- `POST /api/webhooks/sendgrid` — SendGrid Event Webhook (ECDSA-signed, expects `X-Twilio-Email-Event-Webhook-Signature` + `X-Twilio-Email-Event-Webhook-Timestamp` headers; verifies against `SENDGRID_WEBHOOK_PUBLIC_KEY` env var)

## API endpoints (public)
- `GET  /api/settings` — current published settings
- `POST /api/contact` — visitor contact form

## Storage
- Logo upload directory: `/app/backend/uploads/` (live) / `/app/template/backend/uploads/` (template)
- Mounted at `GET /api/uploads/<filename>`
- Settings collection: `site_settings` (singleton with `id: "main"`)
- Contact submissions: `contact_submissions`
