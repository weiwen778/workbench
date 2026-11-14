from __future__ import annotations

import re
from urllib.parse import quote

from fastapi import APIRouter, Depends, Query
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from starlette.background import BackgroundTask

from ..config import settings
from ..deps import get_current_user
from ..errors import ApiError
from ..services import media
from ..services.media_download import MediaDownloadError, open_media_stream

router = APIRouter(tags=["media"], dependencies=[Depends(get_current_user)])


class ParseIn(BaseModel):
    text: str = ""


def _content_disposition(filename: str) -> str:
    ascii_name = re.sub(r"[^A-Za-z0-9._-]+", "_", filename).strip("._") or "download"
    return f"attachment; filename=\"{ascii_name}\"; filename*=UTF-8''{quote(filename)}"


@router.get("/media/config")
def media_config() -> dict:
    return media.config_payload()


@router.post("/media/parse")
async def media_parse(body: ParseIn) -> dict:
    return await media.parse_share_async(body.text)


@router.get("/media/download")
def media_download(token: str = Query(..., min_length=1)) -> StreamingResponse:
    payload = media.decode_download_token(token)
    try:
        stream = open_media_stream(
            payload["u"],
            referer=str(payload.get("r") or ""),
            max_bytes=settings.media_max_download_bytes,
        )
    except MediaDownloadError as exc:
        raise ApiError(exc.code, exc.message, exc.status) from exc

    headers = {
        "Content-Disposition": _content_disposition(str(payload.get("n") or "download")),
        "Cache-Control": "no-store",
    }
    length = stream.headers.get("content-length")
    if length and length.isdigit():
        headers["Content-Length"] = length
    media_type = stream.headers.get("content-type") or "application/octet-stream"
    return StreamingResponse(
        stream.iter_bytes(settings.media_max_download_bytes),
        media_type=media_type,
        headers=headers,
        background=BackgroundTask(stream.close),
    )
