from __future__ import annotations

from fastapi import APIRouter
from fastapi.responses import JSONResponse
from sqlalchemy import select, text

from ..db import SessionLocal
from ..models import TranslationConnection

router = APIRouter(tags=["health"])


@router.get("/health")
def health():
    try:
        with SessionLocal() as db:
            db.execute(text("SELECT 1"))
            providers = {
                c.provider: c.enabled for c in db.scalars(select(TranslationConnection)).all()
            }
        return {"status": "ok", "database": "ok", "translation": providers}
    except Exception:  # Do not expose connection strings or driver internals.
        return JSONResponse(status_code=503, content={"status": "degraded", "database": "error"})
