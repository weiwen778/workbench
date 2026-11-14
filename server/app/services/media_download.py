"""SSRF-safe streaming download for parsed media.

The parser returns third-party CDN URLs. Browser downloads would hit hotlink
protection and CORS, so the API proxies the bytes. This module keeps the same
guarantees as ``public_http``: validate every hop, connect to the validated IP,
reject private networks, and cap the response size while streaming.
"""
from __future__ import annotations

import http.client
import socket
import ssl
import time
from dataclasses import dataclass
from urllib.parse import urljoin, urlsplit

from ..config import settings
from .public_http import PublicHttpError, public_target

BROWSER_USER_AGENT = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36"
)
CHUNK_SIZE = 64 * 1024


class MediaDownloadError(Exception):
    def __init__(self, code: str, message: str, status: int = 502):
        super().__init__(message)
        self.code = code
        self.message = message
        self.status = status


@dataclass
class MediaStream:
    connection: http.client.HTTPConnection
    response: http.client.HTTPResponse
    headers: dict[str, str]
    final_url: str

    def iter_bytes(self, max_bytes: int):
        total = 0
        try:
            while True:
                chunk = self.response.read(CHUNK_SIZE)
                if not chunk:
                    break
                total += len(chunk)
                if total > max_bytes:
                    raise MediaDownloadError("MEDIA_TOO_LARGE", "文件超过下载大小限制", 413)
                yield chunk
        finally:
            self.close()

    def close(self) -> None:
        try:
            self.response.close()
        finally:
            self.connection.close()


def _headers(response: http.client.HTTPResponse) -> dict[str, str]:
    return {key.lower(): value for key, value in response.getheaders()}


def open_media_stream(
    url: str,
    *,
    referer: str = "",
    timeout: float = 30.0,
    max_bytes: int | None = None,
    max_redirects: int = 5,
) -> MediaStream:
    limit = int(max_bytes if max_bytes is not None else settings.media_max_download_bytes)
    deadline = time.monotonic() + max(1.0, timeout)
    current = url
    redirects = 0
    allow_loopback = bool(settings.media_allow_loopback)

    while True:
        if redirects > max_redirects:
            raise MediaDownloadError("MEDIA_REDIRECT_FAILED", "媒体地址跳转次数过多")
        try:
            parts, port, address = public_target(current, allow_loopback=allow_loopback)
        except PublicHttpError as exc:
            raise MediaDownloadError("MEDIA_URL_REJECTED", exc.message, 403) from exc

        remaining = deadline - time.monotonic()
        if remaining <= 0:
            raise MediaDownloadError("MEDIA_TIMEOUT", "下载超时", 504)

        connection = http.client.HTTPConnection(address, port, timeout=min(remaining, 15))
        try:
            try:
                connection.connect()
                if parts.scheme.lower() == "https":
                    connection.sock = ssl.create_default_context().wrap_socket(
                        connection.sock, server_hostname=parts.hostname
                    )
            except (TimeoutError, socket.timeout) as exc:
                raise MediaDownloadError("MEDIA_TIMEOUT", "下载超时", 504) from exc
            except ssl.SSLError as exc:
                raise MediaDownloadError("MEDIA_TLS_ERROR", "媒体站点证书校验失败") from exc
            except OSError as exc:
                raise MediaDownloadError("MEDIA_NETWORK", "无法连接媒体站点") from exc

            request_headers = {
                "Host": parts.netloc,
                "User-Agent": BROWSER_USER_AGENT,
                "Accept": "*/*",
                "Accept-Encoding": "identity",
                "Connection": "close",
            }
            if referer:
                request_headers["Referer"] = referer

            path = parts.path or "/"
            if parts.query:
                path += "?" + parts.query
            try:
                connection.request("GET", path, headers=request_headers)
                response = connection.getresponse()
            except (TimeoutError, socket.timeout) as exc:
                raise MediaDownloadError("MEDIA_TIMEOUT", "下载超时", 504) from exc
            except (OSError, http.client.HTTPException) as exc:
                raise MediaDownloadError("MEDIA_NETWORK", "媒体连接中断") from exc

            response_headers = _headers(response)
            if response.status in {301, 302, 303, 307, 308}:
                location = response_headers.get("location")
                response.read(8192)
                response.close()
                connection.close()
                if not location:
                    raise MediaDownloadError("MEDIA_REDIRECT_FAILED", "媒体地址返回了无效跳转")
                current = urljoin(current, location)
                if urlsplit(current).scheme.lower() not in {"http", "https"}:
                    raise MediaDownloadError("MEDIA_URL_REJECTED", "媒体地址跳转到了不支持的协议", 403)
                redirects += 1
                continue

            if response.status < 200 or response.status >= 300:
                response.read(4096)
                response.close()
                connection.close()
                raise MediaDownloadError("MEDIA_UPSTREAM_ERROR", f"媒体站点返回 HTTP {response.status}")

            content_length = response_headers.get("content-length")
            if content_length and content_length.isdigit() and int(content_length) > limit:
                response.close()
                connection.close()
                raise MediaDownloadError("MEDIA_TOO_LARGE", "文件超过下载大小限制", 413)

            return MediaStream(connection, response, response_headers, current)
        except Exception:
            try:
                connection.close()
            except Exception:
                pass
            raise
