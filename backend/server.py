from dotenv import load_dotenv
from pathlib import Path
ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / '.env')

from fastapi import FastAPI, APIRouter, HTTPException, BackgroundTasks, Request, Depends, UploadFile, File, status
from fastapi.responses import JSONResponse
from fastapi.staticfiles import StaticFiles
from starlette.middleware.cors import CORSMiddleware
from motor.motor_asyncio import AsyncIOMotorClient
import os
import re
import logging
import html as html_lib
from pydantic import BaseModel, Field, ConfigDict, EmailStr, field_validator
from typing import List, Optional
import uuid
import secrets
from datetime import datetime, timezone, timedelta

import bcrypt
import jwt as pyjwt

from sendgrid import SendGridAPIClient
from sendgrid.helpers.mail import Mail, From, To, ReplyTo


# MongoDB connection
mongo_url = os.environ['MONGO_URL']
client = AsyncIOMotorClient(mongo_url)
db = client[os.environ['DB_NAME']]

# SendGrid config
SENDGRID_API_KEY = os.environ.get('SENDGRID_API_KEY')
SENDER_EMAIL = os.environ.get('SENDER_EMAIL', 'hello@jaxstudio.ink')
SENDER_NAME = os.environ.get('SENDER_NAME', 'Jax Studio')
OWNER_EMAIL = os.environ.get('OWNER_EMAIL', 'jaxstudio.ink@gmail.com')

# Admin auth
JWT_SECRET = os.environ['JWT_SECRET']
ADMIN_PASSWORD_HASH = os.environ['ADMIN_PASSWORD_HASH']
JWT_ALGORITHM = "HS256"
ADMIN_TOKEN_TTL_DAYS = 7

# Uploads
UPLOAD_DIR = Path(os.environ.get('UPLOAD_DIR', '/app/backend/uploads'))
UPLOAD_DIR.mkdir(parents=True, exist_ok=True)
ALLOWED_LOGO_EXTS = {'.png', '.svg'}
MAX_LOGO_BYTES = 4 * 1024 * 1024  # 4 MB

# Logger
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)


# App + router
app = FastAPI(title="Jax Studio API")
api_router = APIRouter(prefix="/api")

# Mount uploads at /api/uploads/* so it routes through the ingress (which forwards /api/* → backend)
app.mount('/api/uploads', StaticFiles(directory=str(UPLOAD_DIR)), name='uploads')


# ================= Models =================
class StatusCheck(BaseModel):
    model_config = ConfigDict(extra="ignore")
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    client_name: str
    timestamp: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))


class StatusCheckCreate(BaseModel):
    client_name: str


class ContactRequest(BaseModel):
    name: str = Field(..., min_length=1, max_length=120)
    email: EmailStr
    message: str = Field(..., min_length=4, max_length=4000)
    website: Optional[str] = Field(default="", max_length=200)

    @field_validator('name')
    @classmethod
    def strip_name(cls, v: str) -> str:
        return v.strip()

    @field_validator('message')
    @classmethod
    def strip_message(cls, v: str) -> str:
        return v.strip()


class ContactResponse(BaseModel):
    status: str
    message: str
    id: str


class AdminLogin(BaseModel):
    password: str = Field(..., min_length=1, max_length=200)


class AdminLoginResponse(BaseModel):
    token: str
    expires_in: int
    role: str = "admin"


HEX_COLOR_RE = re.compile(r"^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$")


def _validate_hex_color(v: Optional[str]) -> Optional[str]:
    if v is None:
        return None
    v = v.strip()
    if not HEX_COLOR_RE.match(v):
        raise ValueError("accent_color must be a hex color like #ff5722")
    return v


ALLOWED_CUBE_FONTS = {
    "Boldonse",
    "Bricolage Grotesque",
    "Big Shoulders Display",
    "Archivo Black",
    "Bebas Neue",
    "Anton",
    "Fraunces",
    "Space Grotesk",
}


class Settings(BaseModel):
    """Singleton site settings doc (id='main'). All fields optional → null = use default."""
    model_config = ConfigDict(extra="ignore")
    logo_url: Optional[str] = None       # /api/uploads/<file> or null = bundled default
    cube_text_1: Optional[str] = None    # default "COMING" (supports \n line breaks)
    cube_text_2: Optional[str] = None    # default "SOON"   (supports \n line breaks)
    cube_font: Optional[str] = None      # default "Boldonse"
    brand_title: Optional[str] = None    # default "Jax Studio"
    brand_tagline: Optional[str] = None  # default "Coming Soon"
    welcome_heading: Optional[str] = None      # default "Jax Studio"
    welcome_sub: Optional[str] = None          # default "Graphic Design · Portfolio & Studio"
    accent_color: Optional[str] = None   # default #ff5722
    updated_at: Optional[str] = None


class SettingsUpdate(BaseModel):
    logo_url: Optional[str] = Field(default=None, max_length=400)
    cube_text_1: Optional[str] = Field(default=None, max_length=60)
    cube_text_2: Optional[str] = Field(default=None, max_length=60)
    cube_font: Optional[str] = Field(default=None, max_length=60)
    brand_title: Optional[str] = Field(default=None, max_length=80)
    brand_tagline: Optional[str] = Field(default=None, max_length=80)
    welcome_heading: Optional[str] = Field(default=None, max_length=80)
    welcome_sub: Optional[str] = Field(default=None, max_length=160)
    accent_color: Optional[str] = Field(default=None, max_length=9)

    @field_validator('accent_color')
    @classmethod
    def _color(cls, v):
        return _validate_hex_color(v)

    @field_validator('cube_font')
    @classmethod
    def _font(cls, v):
        if v is None:
            return None
        v = v.strip()
        if v == "":
            return None
        if v not in ALLOWED_CUBE_FONTS:
            raise ValueError(f"cube_font must be one of: {sorted(ALLOWED_CUBE_FONTS)}")
        return v


# ================= Email helpers =================
def _safe(text: str) -> str:
    return html_lib.escape(text or "").replace("\n", "<br/>")


def _owner_email_html(name, email, message, submission_id):
    return f"""
    <!doctype html>
    <html><body style="margin:0;padding:0;background:#0a0a0a;font-family:-apple-system,Segoe UI,Helvetica,Arial,sans-serif;color:#eaeaea;">
      <div style="max-width:560px;margin:0 auto;padding:32px 28px;">
        <div style="font-size:11px;letter-spacing:0.4em;text-transform:uppercase;color:#888;margin-bottom:24px;">JAX STUDIO · NEW INQUIRY</div>
        <h1 style="font-size:22px;font-weight:700;margin:0 0 18px 0;color:#fff;">{_safe(name)} just reached out</h1>
        <table style="border-collapse:collapse;font-size:14px;line-height:1.55;color:#cfcfcf;width:100%;">
          <tr><td style="padding:6px 0;width:90px;color:#888;">From</td><td style="padding:6px 0;color:#fff;">{_safe(name)} &lt;{_safe(email)}&gt;</td></tr>
          <tr><td style="padding:6px 0;color:#888;">Ref</td><td style="padding:6px 0;color:#fff;font-family:monospace;font-size:12px;">{_safe(submission_id)}</td></tr>
        </table>
        <div style="margin-top:22px;padding:18px 20px;border-left:3px solid #ff5722;background:#141414;border-radius:4px;color:#eaeaea;font-size:14px;line-height:1.6;">
          {_safe(message)}
        </div>
        <p style="margin-top:28px;font-size:12px;color:#666;">Reply directly to this email to respond — the visitor's address is set as Reply-To.</p>
      </div>
    </body></html>
    """


def _autoreply_email_html(name, email, message):
    first = _safe(name).split(' ')[0] or 'friend'
    return f"""
    <!doctype html>
    <html><body style="margin:0;padding:0;background:#0a0a0a;font-family:-apple-system,Segoe UI,Helvetica,Arial,sans-serif;color:#eaeaea;">
      <div style="max-width:560px;margin:0 auto;padding:32px 28px;">
        <div style="font-size:11px;letter-spacing:0.4em;text-transform:uppercase;color:#888;margin-bottom:24px;">JAX STUDIO</div>
        <h1 style="font-size:24px;font-weight:700;margin:0 0 14px 0;color:#fff;">Thanks, {first} <span style="color:#ff5722;">!</span></h1>
        <p style="font-size:15px;line-height:1.6;color:#cfcfcf;margin:0 0 14px 0;">
          I&rsquo;ve received your message and will get back to you within <strong style="color:#fff;">24 hours</strong>.
        </p>
        <p style="font-size:13px;line-height:1.6;color:#888;margin:0 0 22px 0;">A copy of what you sent is below for your records.</p>
        <div style="padding:18px 20px;border-left:3px solid #ff5722;background:#141414;border-radius:4px;color:#eaeaea;font-size:14px;line-height:1.6;">
          {_safe(message)}
        </div>
        <p style="margin-top:30px;font-size:12px;color:#666;">— Jax Studio · hello@jaxstudio.ink</p>
      </div>
    </body></html>
    """


def _send_via_sendgrid(mail: Mail) -> int:
    if not SENDGRID_API_KEY:
        logger.error("SENDGRID_API_KEY is not set; skipping send.")
        return 0
    sg = SendGridAPIClient(SENDGRID_API_KEY)
    response = sg.send(mail)
    return response.status_code


def send_contact_emails(name, email, message, submission_id):
    results = {"owner": None, "customer": None}
    try:
        owner_mail = Mail(
            from_email=From(SENDER_EMAIL, SENDER_NAME),
            to_emails=[To(OWNER_EMAIL)],
            subject=f"New inquiry from {name} — Jax Studio",
            html_content=_owner_email_html(name, email, message, submission_id),
        )
        owner_mail.reply_to = ReplyTo(email, name)
        results["owner"] = _send_via_sendgrid(owner_mail)
        logger.info(f"Owner email status: {results['owner']} for {submission_id}")
    except Exception as e:
        logger.exception(f"Owner email send failed: {e}")
        results["owner"] = f"error: {e}"
    try:
        first = (name or '').split(' ')[0] or 'there'
        customer_mail = Mail(
            from_email=From(SENDER_EMAIL, SENDER_NAME),
            to_emails=[To(email)],
            subject=f"Thanks {first} — I'll be in touch shortly",
            html_content=_autoreply_email_html(name, email, message),
        )
        customer_mail.reply_to = ReplyTo(OWNER_EMAIL, SENDER_NAME)
        results["customer"] = _send_via_sendgrid(customer_mail)
        logger.info(f"Customer auto-reply status: {results['customer']} for {submission_id}")
    except Exception as e:
        logger.exception(f"Customer auto-reply failed: {e}")
        results["customer"] = f"error: {e}"
    return results


# ================= Auth helpers =================
def _verify_password(plain: str, hashed: str) -> bool:
    try:
        return bcrypt.checkpw(plain.encode("utf-8"), hashed.encode("utf-8"))
    except Exception:
        return False


def _create_admin_token() -> str:
    payload = {
        "sub": "admin",
        "role": "admin",
        "type": "access",
        "iat": int(datetime.now(timezone.utc).timestamp()),
        "exp": datetime.now(timezone.utc) + timedelta(days=ADMIN_TOKEN_TTL_DAYS),
        "jti": secrets.token_hex(8),
    }
    return pyjwt.encode(payload, JWT_SECRET, algorithm=JWT_ALGORITHM)


def _decode_token(token: str):
    try:
        return pyjwt.decode(token, JWT_SECRET, algorithms=[JWT_ALGORITHM])
    except pyjwt.ExpiredSignatureError:
        raise HTTPException(status_code=401, detail="Token expired")
    except pyjwt.InvalidTokenError:
        raise HTTPException(status_code=401, detail="Invalid token")


async def require_admin(request: Request) -> dict:
    auth = request.headers.get("Authorization", "")
    token = None
    if auth.startswith("Bearer "):
        token = auth[7:]
    if not token:
        token = request.cookies.get("admin_token")
    if not token:
        raise HTTPException(status_code=401, detail="Not authenticated")
    payload = _decode_token(token)
    if payload.get("role") != "admin" or payload.get("type") != "access":
        raise HTTPException(status_code=401, detail="Invalid admin token")
    return payload


# Brute-force tracking (in-memory, per-process — fine for one-process backend)
_login_attempts: dict = {}
LOGIN_WINDOW_SEC = 15 * 60
LOGIN_MAX_ATTEMPTS = 5


def _check_brute_force(ip: str):
    now = datetime.now(timezone.utc).timestamp()
    record = _login_attempts.get(ip)
    if record:
        # purge old
        record["events"] = [t for t in record["events"] if now - t < LOGIN_WINDOW_SEC]
        if len(record["events"]) >= LOGIN_MAX_ATTEMPTS:
            wait = int(LOGIN_WINDOW_SEC - (now - record["events"][0]))
            raise HTTPException(status_code=429, detail=f"Too many attempts. Try again in {wait // 60 + 1} min.")


def _register_failure(ip: str):
    now = datetime.now(timezone.utc).timestamp()
    rec = _login_attempts.setdefault(ip, {"events": []})
    rec["events"].append(now)


def _clear_failures(ip: str):
    _login_attempts.pop(ip, None)


# ================= Settings helpers =================
SETTINGS_DOC_ID = "main"


async def _get_settings_doc() -> dict:
    doc = await db.site_settings.find_one({"id": SETTINGS_DOC_ID}, {"_id": 0})
    if not doc:
        doc = {"id": SETTINGS_DOC_ID, "updated_at": datetime.now(timezone.utc).isoformat()}
        await db.site_settings.insert_one(doc.copy())
    return {k: v for k, v in doc.items() if k != "id"}


# ================= Public routes =================
@api_router.get("/")
async def root():
    return {"message": "Jax Studio API up"}


@api_router.post("/status", response_model=StatusCheck)
async def create_status_check(payload: StatusCheckCreate):
    status_obj = StatusCheck(**payload.model_dump())
    doc = status_obj.model_dump()
    doc['timestamp'] = doc['timestamp'].isoformat()
    await db.status_checks.insert_one(doc)
    return status_obj


@api_router.get("/status", response_model=List[StatusCheck])
async def get_status_checks():
    rows = await db.status_checks.find({}, {"_id": 0}).to_list(1000)
    for r in rows:
        if isinstance(r.get('timestamp'), str):
            r['timestamp'] = datetime.fromisoformat(r['timestamp'])
    return rows


@api_router.post("/contact", response_model=ContactResponse)
async def submit_contact(payload: ContactRequest, background_tasks: BackgroundTasks, request: Request):
    if payload.website:
        return ContactResponse(status="ok", message="Thanks!", id=str(uuid.uuid4()))
    submission_id = str(uuid.uuid4())
    now_iso = datetime.now(timezone.utc).isoformat()
    client_ip = request.client.host if request.client else None
    user_agent = request.headers.get("user-agent", "")
    doc = {
        "id": submission_id,
        "name": payload.name,
        "email": payload.email,
        "message": payload.message,
        "ip": client_ip,
        "user_agent": user_agent,
        "created_at": now_iso,
        "email_sent": False,
    }
    try:
        await db.contact_submissions.insert_one(doc)
    except Exception as e:
        logger.exception(f"Mongo insert failed: {e}")
        raise HTTPException(status_code=500, detail="Could not save your message. Please try again.")

    def _send_and_mark():
        try:
            results = send_contact_emails(payload.name, payload.email, payload.message, submission_id)
            ok = results.get("owner") in (200, 201, 202) or results.get("customer") in (200, 201, 202)
            from pymongo import MongoClient
            sync_client = MongoClient(mongo_url)
            sync_client[os.environ['DB_NAME']]['contact_submissions'].update_one(
                {"id": submission_id},
                {"$set": {"email_sent": ok, "email_results": {k: str(v) for k, v in results.items()}}},
            )
            sync_client.close()
        except Exception as e:
            logger.exception(f"BG email failed for {submission_id}: {e}")

    background_tasks.add_task(_send_and_mark)
    return ContactResponse(
        status="ok",
        message="Thanks! I’ve received your message and will get back to you within 24 hours.",
        id=submission_id,
    )


@api_router.get("/settings", response_model=Settings)
async def get_public_settings():
    """Public — anyone can read current published settings (so visitors get the customized cube)."""
    return Settings(**await _get_settings_doc())


# ================= Admin routes =================
@api_router.post("/admin/login", response_model=AdminLoginResponse)
async def admin_login(payload: AdminLogin, request: Request):
    ip = request.client.host if request.client else "unknown"
    _check_brute_force(ip)
    if not _verify_password(payload.password, ADMIN_PASSWORD_HASH):
        _register_failure(ip)
        # generic message to avoid leaking which side was wrong
        raise HTTPException(status_code=401, detail="Incorrect password")
    _clear_failures(ip)
    token = _create_admin_token()
    response = JSONResponse(
        AdminLoginResponse(token=token, expires_in=ADMIN_TOKEN_TTL_DAYS * 86400).model_dump()
    )
    # also set as httpOnly cookie for convenience (frontend uses Bearer header, but cookie is a nice fallback)
    response.set_cookie(
        key="admin_token",
        value=token,
        httponly=True,
        secure=True,
        samesite="lax",
        max_age=ADMIN_TOKEN_TTL_DAYS * 86400,
        path="/",
    )
    return response


@api_router.post("/admin/logout")
async def admin_logout():
    response = JSONResponse({"status": "ok"})
    response.delete_cookie(key="admin_token", path="/")
    return response


@api_router.get("/admin/me")
async def admin_me(_: dict = Depends(require_admin)):
    return {"role": "admin"}


@api_router.get("/admin/settings", response_model=Settings)
async def admin_get_settings(_: dict = Depends(require_admin)):
    return Settings(**await _get_settings_doc())


@api_router.put("/admin/settings", response_model=Settings)
async def admin_update_settings(payload: SettingsUpdate, _: dict = Depends(require_admin)):
    update = {k: v for k, v in payload.model_dump().items() if v is not None}
    update["updated_at"] = datetime.now(timezone.utc).isoformat()
    await db.site_settings.update_one(
        {"id": SETTINGS_DOC_ID},
        {"$set": update, "$setOnInsert": {"id": SETTINGS_DOC_ID}},
        upsert=True,
    )
    return Settings(**await _get_settings_doc())


@api_router.post("/admin/settings/reset", response_model=Settings)
async def admin_reset_settings(_: dict = Depends(require_admin)):
    """Reset settings to defaults; also delete any uploaded logo file."""
    current = await _get_settings_doc()
    old_logo = current.get("logo_url")
    if old_logo and old_logo.startswith("/api/uploads/"):
        try:
            (UPLOAD_DIR / Path(old_logo).name).unlink(missing_ok=True)
        except Exception:
            pass
    await db.site_settings.update_one(
        {"id": SETTINGS_DOC_ID},
        {"$set": {
            "logo_url": None, "cube_text_1": None, "cube_text_2": None,
            "cube_font": None,
            "brand_title": None, "brand_tagline": None,
            "welcome_heading": None, "welcome_sub": None,
            "accent_color": None,
            "updated_at": datetime.now(timezone.utc).isoformat(),
        }, "$setOnInsert": {"id": SETTINGS_DOC_ID}},
        upsert=True,
    )
    return Settings(**await _get_settings_doc())


@api_router.post("/admin/upload/logo")
async def admin_upload_logo(file: UploadFile = File(...), _: dict = Depends(require_admin)):
    name = file.filename or ""
    ext = Path(name).suffix.lower()
    if ext not in ALLOWED_LOGO_EXTS:
        raise HTTPException(status_code=400, detail="Logo must be .png or .svg")

    # Read with size cap
    contents = await file.read()
    if len(contents) > MAX_LOGO_BYTES:
        raise HTTPException(status_code=413, detail="File too large (max 4 MB)")

    # Delete previous logo file (if any) — saves disk + matches user's intent
    current = await _get_settings_doc()
    old_logo = current.get("logo_url")
    if old_logo and old_logo.startswith("/api/uploads/"):
        try:
            (UPLOAD_DIR / Path(old_logo).name).unlink(missing_ok=True)
        except Exception:
            pass

    new_name = f"logo-{uuid.uuid4().hex[:10]}{ext}"
    target = UPLOAD_DIR / new_name
    target.write_bytes(contents)
    public_url = f"/api/uploads/{new_name}"

    # Persist immediately (single source of truth)
    await db.site_settings.update_one(
        {"id": SETTINGS_DOC_ID},
        {"$set": {"logo_url": public_url, "updated_at": datetime.now(timezone.utc).isoformat()},
         "$setOnInsert": {"id": SETTINGS_DOC_ID}},
        upsert=True,
    )
    return {"logo_url": public_url, "size": len(contents), "ext": ext}


# Include router and middleware
app.include_router(api_router)

app.add_middleware(
    CORSMiddleware,
    allow_credentials=True,
    allow_origins=os.environ.get('CORS_ORIGINS', '*').split(','),
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.on_event("shutdown")
async def shutdown_db_client():
    client.close()
