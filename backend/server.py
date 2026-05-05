from fastapi import FastAPI, APIRouter, HTTPException, BackgroundTasks, Request
from dotenv import load_dotenv
from starlette.middleware.cors import CORSMiddleware
from motor.motor_asyncio import AsyncIOMotorClient
import os
import logging
import html as html_lib
from pathlib import Path
from pydantic import BaseModel, Field, ConfigDict, EmailStr, field_validator
from typing import List, Optional
import uuid
from datetime import datetime, timezone

from sendgrid import SendGridAPIClient
from sendgrid.helpers.mail import Mail, From, To, Cc, ReplyTo


ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / '.env')

# MongoDB connection
mongo_url = os.environ['MONGO_URL']
client = AsyncIOMotorClient(mongo_url)
db = client[os.environ['DB_NAME']]

# SendGrid config
SENDGRID_API_KEY = os.environ.get('SENDGRID_API_KEY')
SENDER_EMAIL = os.environ.get('SENDER_EMAIL', 'hello@jaxstudio.ink')
SENDER_NAME = os.environ.get('SENDER_NAME', 'Jax Studio')
OWNER_EMAIL = os.environ.get('OWNER_EMAIL', 'jaxstudio.ink@gmail.com')

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)


# App + router
app = FastAPI(title="Jax Studio API")
api_router = APIRouter(prefix="/api")


# ---------------- Models ----------------
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
    # honeypot — must be empty for humans
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


# ---------------- Email helpers ----------------
def _safe(text: str) -> str:
    """HTML-escape user input."""
    return html_lib.escape(text or "").replace("\n", "<br/>")


def _owner_email_html(name: str, email: str, message: str, submission_id: str) -> str:
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


def _autoreply_email_html(name: str, email: str, message: str) -> str:
    return f"""
    <!doctype html>
    <html><body style="margin:0;padding:0;background:#0a0a0a;font-family:-apple-system,Segoe UI,Helvetica,Arial,sans-serif;color:#eaeaea;">
      <div style="max-width:560px;margin:0 auto;padding:32px 28px;">
        <div style="font-size:11px;letter-spacing:0.4em;text-transform:uppercase;color:#888;margin-bottom:24px;">JAX STUDIO</div>
        <h1 style="font-size:24px;font-weight:700;margin:0 0 14px 0;color:#fff;">Thanks, {_safe(name).split(' ')[0] or 'friend'} <span style="color:#ff5722;">!</span></h1>
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


def send_contact_emails(name: str, email: str, message: str, submission_id: str) -> dict:
    """Sends owner notification + customer auto-reply. Logs but never raises."""
    results = {"owner": None, "customer": None}

    # 1. Owner notification (Reply-To = visitor)
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
        logger.exception(f"Owner email send failed for {submission_id}: {e}")
        results["owner"] = f"error: {e}"

    # 2. Customer auto-reply
    try:
        customer_mail = Mail(
            from_email=From(SENDER_EMAIL, SENDER_NAME),
            to_emails=[To(email)],
            subject=f"Thanks {name.split(' ')[0]} — I'll be in touch shortly",
            html_content=_autoreply_email_html(name, email, message),
        )
        customer_mail.reply_to = ReplyTo(OWNER_EMAIL, SENDER_NAME)
        results["customer"] = _send_via_sendgrid(customer_mail)
        logger.info(f"Customer auto-reply status: {results['customer']} for {submission_id}")
    except Exception as e:
        logger.exception(f"Customer auto-reply failed for {submission_id}: {e}")
        results["customer"] = f"error: {e}"

    return results


# ---------------- Routes ----------------
@api_router.get("/")
async def root():
    return {"message": "Jax Studio API up"}


@api_router.post("/status", response_model=StatusCheck)
async def create_status_check(input: StatusCheckCreate):
    status_obj = StatusCheck(**input.model_dump())
    doc = status_obj.model_dump()
    doc['timestamp'] = doc['timestamp'].isoformat()
    await db.status_checks.insert_one(doc)
    return status_obj


@api_router.get("/status", response_model=List[StatusCheck])
async def get_status_checks():
    status_checks = await db.status_checks.find({}, {"_id": 0}).to_list(1000)
    for check in status_checks:
        if isinstance(check.get('timestamp'), str):
            check['timestamp'] = datetime.fromisoformat(check['timestamp'])
    return status_checks


@api_router.post("/contact", response_model=ContactResponse)
async def submit_contact(payload: ContactRequest, background_tasks: BackgroundTasks, request: Request):
    # Honeypot — silently accept but do nothing
    if payload.website:
        logger.warning("Honeypot triggered; ignoring submission.")
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

    # Send emails in background — do not block the response
    def _send_and_mark():
        try:
            results = send_contact_emails(payload.name, payload.email, payload.message, submission_id)
            ok = results.get("owner") in (200, 201, 202) or results.get("customer") in (200, 201, 202)
            # update Mongo synchronously is fine here; use sync motor not available
            # use a simple PyMongo update via motor in a separate event loop is overkill; rely on logs + a flag attempt
            from pymongo import MongoClient
            sync_client = MongoClient(mongo_url)
            sync_client[os.environ['DB_NAME']]['contact_submissions'].update_one(
                {"id": submission_id},
                {"$set": {"email_sent": ok, "email_results": {k: str(v) for k, v in results.items()}}},
            )
            sync_client.close()
        except Exception as e:
            logger.exception(f"Background email task failed for {submission_id}: {e}")

    background_tasks.add_task(_send_and_mark)

    return ContactResponse(
        status="ok",
        message="Thanks! I’ve received your message and will get back to you within 24 hours.",
        id=submission_id,
    )


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
