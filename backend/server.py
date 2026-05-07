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
from sendgrid.helpers.mail import Mail, From, To, ReplyTo, CustomArg
from sendgrid.helpers.eventwebhook import EventWebhook


# MongoDB connection
mongo_url = os.environ['MONGO_URL']
client = AsyncIOMotorClient(mongo_url)
db = client[os.environ['DB_NAME']]

# SendGrid config
SENDGRID_API_KEY = os.environ.get('SENDGRID_API_KEY')
SENDER_EMAIL = os.environ.get('SENDER_EMAIL', 'hello@jaxstudio.ink')
SENDER_NAME = os.environ.get('SENDER_NAME', 'Jax Studio')
OWNER_EMAIL = os.environ.get('OWNER_EMAIL', 'jaxstudio.ink@gmail.com')
SENDGRID_WEBHOOK_PUBLIC_KEY = os.environ.get('SENDGRID_WEBHOOK_PUBLIC_KEY', '').strip()
# Pre-build verifier (cheap; reused per request)
_sg_event_webhook = EventWebhook()
_sg_webhook_pubkey = None
if SENDGRID_WEBHOOK_PUBLIC_KEY:
    try:
        _sg_webhook_pubkey = _sg_event_webhook.convert_public_key_to_ecdsa(SENDGRID_WEBHOOK_PUBLIC_KEY)
    except Exception as _e:
        logging.getLogger(__name__).error(f"Could not load SENDGRID_WEBHOOK_PUBLIC_KEY: {_e}")

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
ALLOWED_PROJECT_IMAGE_EXTS = {'.png', '.jpg', '.jpeg', '.webp', '.svg'}
MAX_PROJECT_IMAGE_BYTES = 6 * 1024 * 1024  # 6 MB

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

ALLOWED_GRADIENT_PRESETS = {
    "default", "sunset", "ocean", "mono-white", "acid", "vaporwave", "noir", "forest",
}

ALLOWED_LETTER_EFFECTS = {
    "Eurhythmic", "Aquarius", "Lycanthropy", "Wonderland", "Screenager",
    "Callipygian", "Eviternity", "Jumbuck", "Babooner",
}
ALLOWED_LETTER_DENSITIES = {"sparse", "normal", "dense"}
ALLOWED_LETTER_SHAPES = {"mix", "circle", "rect", "polygon"}
ALLOWED_LETTER_APPLY_TO = {"heading", "sub", "both"}


class Settings(BaseModel):
    """Singleton site settings doc (id='main'). All fields optional → null = use default."""
    model_config = ConfigDict(extra="ignore")
    logo_url: Optional[str] = None
    cube_text_1: Optional[str] = None
    cube_text_2: Optional[str] = None
    cube_font: Optional[str] = None
    cube_letter_spacing: Optional[float] = None    # em units, default 0.06
    cube_line_spacing: Optional[float] = None      # multiplier, default 1.05
    gradient_preset: Optional[str] = None          # default "default"
    gradient_color_a: Optional[str] = None         # hex
    gradient_color_b: Optional[str] = None         # hex
    brand_title: Optional[str] = None
    brand_tagline: Optional[str] = None
    welcome_heading: Optional[str] = None
    welcome_sub: Optional[str] = None
    welcome_letter_spacing: Optional[float] = None    # em units, default -0.02
    welcome_line_spacing: Optional[float] = None      # multiplier, default 0.95
    accent_color: Optional[str] = None
    ripple_speed: Optional[float] = None              # multiplier, default 1.0 (0.5–2.0)
    ripple_tint: Optional[int] = None                 # accent-mix %, default 30 (0–60)
    ripple_ring_count: Optional[int] = None           # 3 / 4 / 5, default 4
    # Welcome overlay decorative letter animation (codrops)
    welcome_letter_effect: Optional[str] = None       # one of EFFECT_NAMES
    welcome_letter_speed: Optional[float] = None      # 0.5–2.0
    welcome_letter_stagger: Optional[int] = None      # ms per-letter, 10–80 or 0 = preset default
    welcome_letter_density: Optional[str] = None      # 'sparse' | 'normal' | 'dense'
    welcome_letter_shapes: Optional[str] = None       # 'mix' | 'circle' | 'rect' | 'polygon'
    welcome_letter_fill: Optional[bool] = None
    welcome_letter_use_accent: Optional[bool] = None  # tint shapes from accent_color
    welcome_letter_apply_to: Optional[str] = None     # 'heading' | 'sub' | 'both'
    swipe_threshold: Optional[int] = None             # px, 16–80, default 36
    wheel_threshold: Optional[int] = None             # px, 4–40, default 12
    # About me / page section content (admin-editable)
    about_eyebrow: Optional[str] = None
    about_heading_pre: Optional[str] = None
    about_heading_emphasis: Optional[str] = None
    about_body: Optional[str] = None        # markdown-ish — paragraphs split on blank lines
    about_photo_url: Optional[str] = None
    about_person_name: Optional[str] = None
    about_person_role: Optional[str] = None
    about_years: Optional[int] = None
    about_skills: Optional[List[dict]] = None  # [{name, pct}]
    about_tools: Optional[List[str]] = None
    updated_at: Optional[str] = None


class SettingsUpdate(BaseModel):
    logo_url: Optional[str] = Field(default=None, max_length=400)
    cube_text_1: Optional[str] = Field(default=None, max_length=60)
    cube_text_2: Optional[str] = Field(default=None, max_length=60)
    cube_font: Optional[str] = Field(default=None, max_length=60)
    cube_letter_spacing: Optional[float] = Field(default=None, ge=-0.05, le=0.6)
    cube_line_spacing: Optional[float] = Field(default=None, ge=0.7, le=2.0)
    gradient_preset: Optional[str] = Field(default=None, max_length=40)
    gradient_color_a: Optional[str] = Field(default=None, max_length=9)
    gradient_color_b: Optional[str] = Field(default=None, max_length=9)
    brand_title: Optional[str] = Field(default=None, max_length=80)
    brand_tagline: Optional[str] = Field(default=None, max_length=80)
    welcome_heading: Optional[str] = Field(default=None, max_length=80)
    welcome_sub: Optional[str] = Field(default=None, max_length=160)
    welcome_letter_spacing: Optional[float] = Field(default=None, ge=-0.05, le=0.6)
    welcome_line_spacing: Optional[float] = Field(default=None, ge=0.7, le=2.0)
    accent_color: Optional[str] = Field(default=None, max_length=9)
    ripple_speed: Optional[float] = Field(default=None, ge=0.5, le=2.0)
    ripple_tint: Optional[int] = Field(default=None, ge=0, le=60)
    ripple_ring_count: Optional[int] = Field(default=None, ge=3, le=5)
    welcome_letter_effect: Optional[str] = Field(default=None, max_length=40)
    welcome_letter_speed: Optional[float] = Field(default=None, ge=0.5, le=2.0)
    welcome_letter_stagger: Optional[int] = Field(default=None, ge=0, le=80)
    welcome_letter_density: Optional[str] = Field(default=None, max_length=12)
    welcome_letter_shapes: Optional[str] = Field(default=None, max_length=12)
    welcome_letter_fill: Optional[bool] = Field(default=None)
    welcome_letter_use_accent: Optional[bool] = Field(default=None)
    welcome_letter_apply_to: Optional[str] = Field(default=None, max_length=12)
    swipe_threshold: Optional[int] = Field(default=None, ge=16, le=80)
    wheel_threshold: Optional[int] = Field(default=None, ge=4, le=40)
    about_eyebrow: Optional[str] = Field(default=None, max_length=80)
    about_heading_pre: Optional[str] = Field(default=None, max_length=120)
    about_heading_emphasis: Optional[str] = Field(default=None, max_length=120)
    about_body: Optional[str] = Field(default=None, max_length=2000)
    about_photo_url: Optional[str] = Field(default=None, max_length=400)
    about_person_name: Optional[str] = Field(default=None, max_length=80)
    about_person_role: Optional[str] = Field(default=None, max_length=80)
    about_years: Optional[int] = Field(default=None, ge=0, le=99)
    about_skills: Optional[List[dict]] = Field(default=None)
    about_tools: Optional[List[str]] = Field(default=None)

    @field_validator('welcome_letter_effect')
    @classmethod
    def _letter_effect(cls, v):
        if v is None or v == "":
            return None
        if v not in ALLOWED_LETTER_EFFECTS:
            raise ValueError(f"welcome_letter_effect must be one of: {sorted(ALLOWED_LETTER_EFFECTS)}")
        return v

    @field_validator('welcome_letter_density')
    @classmethod
    def _letter_density(cls, v):
        if v is None or v == "":
            return None
        if v not in ALLOWED_LETTER_DENSITIES:
            raise ValueError(f"welcome_letter_density must be one of: {sorted(ALLOWED_LETTER_DENSITIES)}")
        return v

    @field_validator('welcome_letter_shapes')
    @classmethod
    def _letter_shapes(cls, v):
        if v is None or v == "":
            return None
        if v not in ALLOWED_LETTER_SHAPES:
            raise ValueError(f"welcome_letter_shapes must be one of: {sorted(ALLOWED_LETTER_SHAPES)}")
        return v

    @field_validator('welcome_letter_apply_to')
    @classmethod
    def _letter_apply_to(cls, v):
        if v is None or v == "":
            return None
        if v not in ALLOWED_LETTER_APPLY_TO:
            raise ValueError(f"welcome_letter_apply_to must be one of: {sorted(ALLOWED_LETTER_APPLY_TO)}")
        return v

    @field_validator('accent_color', 'gradient_color_a', 'gradient_color_b')
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

    @field_validator('gradient_preset')
    @classmethod
    def _preset(cls, v):
        if v is None:
            return None
        v = v.strip()
        if v == "":
            return None
        if v not in ALLOWED_GRADIENT_PRESETS:
            raise ValueError(f"gradient_preset must be one of: {sorted(ALLOWED_GRADIENT_PRESETS)}")
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
        owner_mail.add_custom_arg(CustomArg("submission_id", submission_id))
        owner_mail.add_custom_arg(CustomArg("kind", "owner"))
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
        customer_mail.add_custom_arg(CustomArg("submission_id", submission_id))
        customer_mail.add_custom_arg(CustomArg("kind", "customer"))
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
async def get_status_checks(limit: int = 50, skip: int = 0):
    limit = max(1, min(limit, 200))
    skip = max(0, skip)
    rows = await (
        db.status_checks
        .find({}, {"_id": 0})
        .sort("timestamp", -1)
        .skip(skip)
        .limit(limit)
        .to_list(limit)
    )
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
        "read": False,
        "events": [],
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
            "cube_letter_spacing": None, "cube_line_spacing": None,
            "gradient_preset": None,
            "gradient_color_a": None, "gradient_color_b": None,
            "brand_title": None, "brand_tagline": None,
            "welcome_heading": None, "welcome_sub": None,
            "welcome_letter_spacing": None, "welcome_line_spacing": None,
            "accent_color": None,
            "ripple_speed": None, "ripple_tint": None, "ripple_ring_count": None,
            "welcome_letter_effect": None, "welcome_letter_speed": None, "welcome_letter_stagger": None,
            "welcome_letter_density": None, "welcome_letter_shapes": None, "welcome_letter_fill": None,
            "welcome_letter_use_accent": None, "welcome_letter_apply_to": None,
            "swipe_threshold": None, "wheel_threshold": None,
            "about_eyebrow": None, "about_heading_pre": None, "about_heading_emphasis": None,
            "about_body": None, "about_photo_url": None, "about_person_name": None,
            "about_person_role": None, "about_years": None, "about_skills": None, "about_tools": None,
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


# ================= Admin: Contact submissions inbox =================
class ContactPatch(BaseModel):
    read: Optional[bool] = None


def _summary_doc(d: dict) -> dict:
    msg = d.get("message", "") or ""
    snippet = msg[:140] + ("…" if len(msg) > 140 else "")
    events = d.get("events") or []
    statuses = sorted({e.get("event") for e in events if e.get("event")})
    return {
        "id": d.get("id"),
        "name": d.get("name"),
        "email": d.get("email"),
        "snippet": snippet,
        "created_at": d.get("created_at"),
        "read": bool(d.get("read", False)),
        "email_sent": bool(d.get("email_sent", False)),
        "event_statuses": statuses,
        "event_count": len(events),
    }


@api_router.get("/admin/contacts")
async def admin_list_contacts(
    limit: int = 50,
    skip: int = 0,
    unread_only: bool = False,
    _: dict = Depends(require_admin),
):
    limit = max(1, min(limit, 200))
    skip = max(0, skip)
    query: dict = {}
    if unread_only:
        query["read"] = {"$ne": True}
    total = await db.contact_submissions.count_documents(query)
    unread = await db.contact_submissions.count_documents({"read": {"$ne": True}})
    cursor = (
        db.contact_submissions
        .find(query, {"_id": 0})
        .sort("created_at", -1)
        .skip(skip)
        .limit(limit)
    )
    rows = [_summary_doc(d) async for d in cursor]
    return {"total": total, "unread": unread, "items": rows}


@api_router.get("/admin/contacts/{submission_id}")
async def admin_get_contact(submission_id: str, _: dict = Depends(require_admin)):
    doc = await db.contact_submissions.find_one({"id": submission_id}, {"_id": 0})
    if not doc:
        raise HTTPException(status_code=404, detail="Submission not found")
    return doc


@api_router.patch("/admin/contacts/{submission_id}")
async def admin_patch_contact(
    submission_id: str,
    payload: ContactPatch,
    _: dict = Depends(require_admin),
):
    update = {k: v for k, v in payload.model_dump().items() if v is not None}
    if not update:
        raise HTTPException(status_code=400, detail="No fields to update")
    res = await db.contact_submissions.update_one(
        {"id": submission_id}, {"$set": update}
    )
    if res.matched_count == 0:
        raise HTTPException(status_code=404, detail="Submission not found")
    doc = await db.contact_submissions.find_one({"id": submission_id}, {"_id": 0})
    return _summary_doc(doc) if doc else {"id": submission_id, **update}


@api_router.delete("/admin/contacts/{submission_id}")
async def admin_delete_contact(submission_id: str, _: dict = Depends(require_admin)):
    res = await db.contact_submissions.delete_one({"id": submission_id})
    if res.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Submission not found")
    return {"status": "ok", "id": submission_id}


# ================= SendGrid Event Webhook =================
@api_router.post("/webhooks/sendgrid")
async def sendgrid_event_webhook(request: Request):
    """Receive SendGrid event webhook payloads, verify signature, persist per-submission events.

    SendGrid posts an array of event dicts. Each event we sent carries `submission_id`
    (and `kind`) as custom_args, so we can map events back to their `contact_submissions` doc.
    """
    raw = await request.body()
    sig = request.headers.get("X-Twilio-Email-Event-Webhook-Signature")
    ts = request.headers.get("X-Twilio-Email-Event-Webhook-Timestamp")

    if _sg_webhook_pubkey is None:
        # Not configured = don't accept events (fail closed)
        raise HTTPException(status_code=503, detail="Webhook not configured")
    if not sig or not ts:
        raise HTTPException(status_code=401, detail="Missing signature headers")

    # Verify ECDSA signature over (timestamp + raw_body)
    # SDK signature: verify_signature(payload: str, signature: str, timestamp: str, public_key=...)
    try:
        valid = _sg_event_webhook.verify_signature(
            raw.decode("utf-8"), sig, ts, _sg_webhook_pubkey,
        )
    except Exception as e:
        logger.warning(f"SendGrid sig verify error: {e}")
        valid = False
    if not valid:
        raise HTTPException(status_code=403, detail="Invalid signature")

    # Reject replays older than 10 minutes
    try:
        if abs(int(datetime.now(timezone.utc).timestamp()) - int(ts)) > 600:
            raise HTTPException(status_code=403, detail="Stale request")
    except (TypeError, ValueError):
        raise HTTPException(status_code=400, detail="Invalid timestamp")

    # Parse JSON body
    import json as _json
    try:
        events = _json.loads(raw.decode("utf-8"))
        if not isinstance(events, list):
            raise ValueError("payload must be a JSON array")
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Bad JSON: {e}")

    accepted = 0
    skipped = 0
    for ev in events:
        sub_id = ev.get("submission_id")
        if not sub_id:
            skipped += 1
            continue
        evt_doc = {
            "event": ev.get("event"),
            "kind": ev.get("kind"),
            "email": ev.get("email"),
            "timestamp": ev.get("timestamp"),
            "received_at": datetime.now(timezone.utc).isoformat(),
            "sg_event_id": ev.get("sg_event_id"),
            "sg_message_id": ev.get("sg_message_id"),
            "reason": ev.get("reason"),
            "url": ev.get("url"),
        }
        # Drop None values to keep docs tidy
        evt_doc = {k: v for k, v in evt_doc.items() if v is not None}
        await db.contact_submissions.update_one(
            {"id": sub_id},
            {"$push": {"events": evt_doc}},
        )
        accepted += 1

    logger.info(f"SendGrid webhook: accepted={accepted} skipped={skipped}")
    return {"accepted": accepted, "skipped": skipped}


# ================= Projects (Past Work) =================
class ProjectIn(BaseModel):
    title: str = Field(..., min_length=1, max_length=120)
    year: int = Field(..., ge=1900, le=2100)
    description: Optional[str] = Field(default=None, max_length=400)
    image_url: Optional[str] = Field(default=None, max_length=400)
    accent: Optional[str] = Field(default=None, max_length=9)
    sort_order: Optional[int] = Field(default=None, ge=0, le=9999)

    @field_validator('accent')
    @classmethod
    def _color(cls, v):
        return _validate_hex_color(v)


class ProjectPatch(BaseModel):
    title: Optional[str] = Field(default=None, min_length=1, max_length=120)
    year: Optional[int] = Field(default=None, ge=1900, le=2100)
    description: Optional[str] = Field(default=None, max_length=400)
    image_url: Optional[str] = Field(default=None, max_length=400)
    accent: Optional[str] = Field(default=None, max_length=9)
    sort_order: Optional[int] = Field(default=None, ge=0, le=9999)

    @field_validator('accent')
    @classmethod
    def _color(cls, v):
        return _validate_hex_color(v)


@api_router.get("/projects")
async def list_projects():
    """Public — returns all projects sorted by sort_order ASC, then by year DESC."""
    rows = await (
        db.projects.find({}, {"_id": 0})
        .sort([("sort_order", 1), ("year", -1), ("created_at", -1)])
        .to_list(200)
    )
    return rows


@api_router.post("/admin/projects")
async def admin_create_project(payload: ProjectIn, _: dict = Depends(require_admin)):
    project_id = str(uuid.uuid4())
    now = datetime.now(timezone.utc).isoformat()
    doc = payload.model_dump()
    if doc.get("sort_order") is None:
        # Append at end
        last = await db.projects.find_one(
            {}, {"sort_order": 1, "_id": 0}, sort=[("sort_order", -1)]
        )
        doc["sort_order"] = ((last or {}).get("sort_order") or 0) + 10
    doc["id"] = project_id
    doc["created_at"] = now
    doc["updated_at"] = now
    await db.projects.insert_one(doc.copy())
    return {k: v for k, v in doc.items() if k != "_id"}


@api_router.put("/admin/projects/{project_id}")
async def admin_update_project(
    project_id: str,
    payload: ProjectPatch,
    _: dict = Depends(require_admin),
):
    update = {k: v for k, v in payload.model_dump().items() if v is not None}
    if not update:
        raise HTTPException(status_code=400, detail="No fields to update")
    update["updated_at"] = datetime.now(timezone.utc).isoformat()
    res = await db.projects.update_one({"id": project_id}, {"$set": update})
    if res.matched_count == 0:
        raise HTTPException(status_code=404, detail="Project not found")
    doc = await db.projects.find_one({"id": project_id}, {"_id": 0})
    return doc


@api_router.delete("/admin/projects/{project_id}")
async def admin_delete_project(project_id: str, _: dict = Depends(require_admin)):
    doc = await db.projects.find_one({"id": project_id}, {"_id": 0})
    if not doc:
        raise HTTPException(status_code=404, detail="Project not found")
    # Delete uploaded image file (best-effort)
    img = doc.get("image_url")
    if img and img.startswith("/api/uploads/"):
        try:
            (UPLOAD_DIR / Path(img).name).unlink(missing_ok=True)
        except Exception:
            pass
    await db.projects.delete_one({"id": project_id})
    return {"status": "ok", "id": project_id}


@api_router.post("/admin/projects/upload")
async def admin_upload_project_image(
    file: UploadFile = File(...),
    _: dict = Depends(require_admin),
):
    name = file.filename or ""
    ext = Path(name).suffix.lower()
    if ext not in ALLOWED_PROJECT_IMAGE_EXTS:
        raise HTTPException(status_code=400, detail="Image must be .png, .jpg, .jpeg, .webp, or .svg")
    contents = await file.read()
    if len(contents) > MAX_PROJECT_IMAGE_BYTES:
        raise HTTPException(status_code=413, detail="File too large (max 6 MB)")
    new_name = f"project-{uuid.uuid4().hex[:10]}{ext}"
    target = UPLOAD_DIR / new_name
    target.write_bytes(contents)
    return {"image_url": f"/api/uploads/{new_name}", "size": len(contents), "ext": ext}


@api_router.post("/admin/about/upload")
async def admin_upload_about_photo(
    file: UploadFile = File(...),
    _: dict = Depends(require_admin),
):
    name = file.filename or ""
    ext = Path(name).suffix.lower()
    if ext not in ALLOWED_PROJECT_IMAGE_EXTS:
        raise HTTPException(status_code=400, detail="Image must be .png, .jpg, .jpeg, .webp, or .svg")
    contents = await file.read()
    if len(contents) > MAX_PROJECT_IMAGE_BYTES:
        raise HTTPException(status_code=413, detail="File too large (max 6 MB)")
    new_name = f"about-{uuid.uuid4().hex[:10]}{ext}"
    target = UPLOAD_DIR / new_name
    target.write_bytes(contents)
    return {"image_url": f"/api/uploads/{new_name}", "size": len(contents), "ext": ext}


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
