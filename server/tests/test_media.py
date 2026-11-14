from __future__ import annotations

import threading
import time
from http.server import BaseHTTPRequestHandler, HTTPServer

import pytest

from app.config import settings
from app.errors import ApiError
from app.services import media
from app.services.media_download import MediaDownloadError, open_media_stream


class FakeParser:
    def __init__(self, *, empty: bool = False, fail: str | None = None):
        self.empty = empty
        self.fail = fail
        self.cookie_required = False
        self.terminal_error = None
        self.is_preview = False
        self.full_duration = None

    def _maybe_fail(self):
        if self.fail == "timeout":
            from app.services.media_parser.src.utils.parser_transport import ParseFailure

            raise ParseFailure(504, "PARSE_TIMEOUT", "解析超时")
        if self.fail == "cookie":
            self.terminal_error = {
                "error_code": "XIAOHONGSHU_COOKIE_REQUIRED",
                "detail_msg": "需要登录 Cookie",
            }

    def get_title_content(self):
        self._maybe_fail()
        return "" if self.empty else "测试标题"

    def get_description(self):
        return "" if self.empty else "测试描述"

    def get_real_video_url(self):
        return None if self.empty else "http://cdn.example.com/video.mp4"

    def get_video_list(self):
        return [] if self.empty else ["http://cdn.example.com/video-2.mp4"]

    def get_cover_photo_url(self):
        return None if self.empty else "http://cdn.example.com/cover.jpg"

    def get_author_info(self):
        return None if self.empty else {"nickname": "作者", "avatar": "http://cdn.example.com/avatar.jpg"}

    def get_image_list(self):
        if self.empty:
            return []
        return [
            {"url": "http://cdn.example.com/1.jpg", "live_photo_url": "http://cdn.example.com/1.mp4"},
            "http://cdn.example.com/2.jpg",
        ]

    def get_audio_url(self):
        return None

    def get_subtitles(self):
        return None


def test_download_token_roundtrip():
    token = media.download_token("https://cdn.example.com/a.mp4", "视频.mp4", "douyin", "https://www.douyin.com/")
    payload = media.decode_download_token(token)
    assert payload["u"] == "https://cdn.example.com/a.mp4"
    assert payload["n"] == "视频.mp4"
    assert payload["p"] == "douyin"


def test_download_token_rejects_tampering():
    token = media.download_token("https://cdn.example.com/a.mp4", "a.mp4", "douyin")
    with pytest.raises(ApiError) as exc:
        media.decode_download_token(token[:-1] + ("0" if token[-1] != "0" else "1"))
    assert exc.value.code == "DOWNLOAD_TOKEN_INVALID"


def test_download_token_expires(monkeypatch):
    monkeypatch.setattr(settings, "media_download_ttl_seconds", -10)
    token = media.download_token("https://cdn.example.com/a.mp4", "a.mp4", "douyin")
    with pytest.raises(ApiError) as exc:
        media.decode_download_token(token)
    assert exc.value.code == "DOWNLOAD_TOKEN_EXPIRED"


def test_parse_requires_text():
    with pytest.raises(ApiError) as exc:
        media.parse_share("   ")
    assert exc.value.code == "MEDIA_TEXT_REQUIRED"


def test_parse_rejects_unsupported_platform():
    with pytest.raises(ApiError) as exc:
        media.parse_share("看看这个 https://example.com/video/1")
    assert exc.value.code == "MEDIA_PLATFORM_UNSUPPORTED"


def test_parse_normalizes_fake_parser(monkeypatch):
    from app.services.media_parser.src.parser_factory import ParserFactory
    from app.services.media_parser.utils.web_fetcher import WebFetcher

    monkeypatch.setattr(
        WebFetcher,
        "fetch_redirect_url",
        staticmethod(lambda url, max_redirects=5: "https://www.douyin.com/video/123"),
    )
    monkeypatch.setattr(
        ParserFactory,
        "create_parser",
        classmethod(lambda cls, platform, url: FakeParser()),
    )

    result = media.parse_share("复制打开抖音 https://v.douyin.com/abc/ 看视频")
    assert result["platform"] == "douyin"
    assert result["title"] == "测试标题"
    assert result["author"] == "作者"
    assert result["video_url"] == "https://cdn.example.com/video.mp4"
    assert result["videos"] == ["https://cdn.example.com/video-2.mp4"]
    assert len(result["images"]) == 2
    assert result["images"][0]["live_photo_url"] == "https://cdn.example.com/1.mp4"
    assert result["downloads"]["video"]["filename"].endswith(".mp4")
    assert result["downloads"]["images"][0]["live_photo_url"]["filename"].endswith("_live.mp4")
    assert "token=" in result["downloads"]["video"]["url"]


def test_parse_maps_cookie_requirement(monkeypatch):
    from app.services.media_parser.src.parser_factory import ParserFactory
    from app.services.media_parser.utils.web_fetcher import WebFetcher

    monkeypatch.setattr(
        WebFetcher,
        "fetch_redirect_url",
        staticmethod(lambda url, max_redirects=5: "https://www.xiaohongshu.com/explore/123"),
    )
    monkeypatch.setattr(
        ParserFactory,
        "create_parser",
        classmethod(lambda cls, platform, url: FakeParser(empty=True, fail="cookie")),
    )

    with pytest.raises(ApiError) as exc:
        media.parse_share("小红书分享 https://xhslink.com/a/abc")
    assert exc.value.code == "MEDIA_COOKIE_REQUIRED"
    assert exc.value.status_code == 409
    assert exc.value.details["env"] == "WB_MEDIA_XHS_COOKIE"


def test_parse_maps_timeout(monkeypatch):
    from app.services.media_parser.src.parser_factory import ParserFactory
    from app.services.media_parser.utils.web_fetcher import WebFetcher

    monkeypatch.setattr(
        WebFetcher,
        "fetch_redirect_url",
        staticmethod(lambda url, max_redirects=5: "https://www.douyin.com/video/123"),
    )
    monkeypatch.setattr(
        ParserFactory,
        "create_parser",
        classmethod(lambda cls, platform, url: FakeParser(fail="timeout")),
    )

    with pytest.raises(ApiError) as exc:
        media.parse_share("https://v.douyin.com/abc/")
    assert exc.value.code == "MEDIA_TIMEOUT"
    assert exc.value.status_code == 504


def test_parse_route_uses_service(monkeypatch, auth):
    async def fake_parse(text: str):
        return {"platform": "douyin", "title": text}

    monkeypatch.setattr(media, "parse_share_async", fake_parse)
    resp = auth.post("/api/v1/media/parse", json={"text": "hello"})
    assert resp.status_code == 200
    assert resp.json() == {"platform": "douyin", "title": "hello"}


def test_config_route_lists_platforms(auth):
    resp = auth.get("/api/v1/media/config")
    assert resp.status_code == 200
    body = resp.json()
    assert body["enabled"] is True
    assert {item["key"] for item in body["platforms"]} == {"douyin", "xhs", "kuaishou"}


class _MediaHandler(BaseHTTPRequestHandler):
    payload = b"0123456789" * 1000

    def log_message(self, *_args):
        pass

    def do_GET(self):  # noqa: N802
        if self.path == "/redirect":
            self.send_response(302)
            self.send_header("location", "/file")
            self.end_headers()
            return
        self.send_response(200)
        self.send_header("content-type", "video/mp4")
        self.send_header("content-length", str(len(self.payload)))
        self.end_headers()
        self.wfile.write(self.payload)


@pytest.fixture
def local_media_url():
    server = HTTPServer(("127.0.0.1", 0), _MediaHandler)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    try:
        yield f"http://127.0.0.1:{server.server_port}"
    finally:
        server.shutdown()
        server.server_close()


def test_stream_downloads_and_redirects(local_media_url):
    stream = open_media_stream(f"{local_media_url}/redirect", timeout=10)
    try:
        data = b"".join(stream.iter_bytes(10_000_000))
    finally:
        stream.close()
    assert data == _MediaHandler.payload


def test_stream_rejects_private_address(monkeypatch, local_media_url):
    monkeypatch.setattr(settings, "allow_insecure_upstream", False)
    with pytest.raises(MediaDownloadError) as exc:
        open_media_stream(f"{local_media_url}/file")
    assert exc.value.code == "MEDIA_URL_REJECTED"


def test_download_route_returns_file(local_media_url, auth):
    token = media.download_token(f"{local_media_url}/file", "测试视频.mp4", "douyin", "https://www.douyin.com/")
    resp = auth.get(f"/api/v1/media/download?token={token}")
    assert resp.status_code == 200
    assert resp.content == _MediaHandler.payload
    assert "attachment" in resp.headers["content-disposition"]
