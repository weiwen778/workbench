"""SSRF-safe HTTP reader for public feed sources.

Connects to the IP that was validated instead of resolving the hostname a
second time, so a DNS answer cannot change between validation and connect.
Every redirect is validated again. The reader never stores credentials and
never follows non-HTTP(S) schemes.
"""
from __future__ import annotations

import http.client
import ipaddress
import socket
import ssl
import time
import zlib
from dataclasses import dataclass
from urllib.parse import urljoin, urlsplit

USER_AGENT = "Mozilla/5.0 (compatible; NexusFeed/1.0; +local-workbench)"


class PublicHttpError(Exception):
    def __init__(self, code: str, message: str, status: int | None = None, retry_after: int | None = None):
        super().__init__(message)
        self.code = code
        self.message = message
        self.status = status
        self.retry_after = retry_after


@dataclass
class PublicResponse:
    status: int
    headers: dict[str, str]
    body: bytes
    final_url: str
    elapsed_ms: int = 0


def _port(parts) -> int:
    try:
        return parts.port or (443 if parts.scheme == "https" else 80)
    except ValueError:
        raise PublicHttpError("URL_REJECTED", "来源地址端口不合法")


def public_target(url: str, *, allow_loopback: bool = False) -> tuple[object, int, str]:
    """Validate a URL and return (parsed URL, port, validated IP)."""
    raw = (url or "").strip()
    if not raw or len(raw) > 2048 or any(ord(ch) < 32 for ch in raw):
        raise PublicHttpError("URL_REJECTED", "来源地址不合法")
    parts = urlsplit(raw)
    if parts.scheme.lower() not in {"http", "https"} or not parts.hostname:
        raise PublicHttpError("URL_REJECTED", "只允许 HTTP 或 HTTPS 来源地址")
    if parts.username is not None or parts.password is not None:
        raise PublicHttpError("URL_REJECTED", "来源地址不能包含账号密码")
    port = _port(parts)
    host_is_loopback = parts.hostname in {"127.0.0.1", "localhost", "::1"}
    if port not in {80, 443} and not (allow_loopback and host_is_loopback):
        raise PublicHttpError("URL_REJECTED", "只允许公开网页端口 80 或 443")
    try:
        infos = socket.getaddrinfo(parts.hostname, port, type=socket.SOCK_STREAM)
    except socket.gaierror:
        # A transient resolver hiccup should not turn a cached source stale.
        time.sleep(0.15)
        try:
            infos = socket.getaddrinfo(parts.hostname, port, type=socket.SOCK_STREAM)
        except socket.gaierror:
            raise PublicHttpError("DNS_FAILED", "无法解析来源域名")
    if not infos:
        raise PublicHttpError("DNS_FAILED", "无法解析来源域名")
    addresses = [info[4][0] for info in infos]
    only_loopback = all(ipaddress.ip_address(address).is_loopback for address in addresses)
    if allow_loopback and host_is_loopback and only_loopback:
        return parts, port, addresses[0]
    if any(not ipaddress.ip_address(address).is_global for address in addresses):
        raise PublicHttpError("PRIVATE_ADDRESS", "来源地址指向非公开网络")
    return parts, port, addresses[0]


def _read_headers(response: http.client.HTTPResponse) -> dict[str, str]:
    return {key.lower(): value for key, value in response.getheaders()}


def _retry_after(headers: dict[str, str]) -> int | None:
    value = headers.get("retry-after")
    if not value:
        return None
    try:
        return max(0, min(86400, int(value.strip())))
    except ValueError:
        return None


def _decode_body(headers: dict[str, str], raw: bytes, max_bytes: int) -> bytes:
    encoding = (headers.get("content-encoding") or "").lower()
    if encoding not in {"gzip", "deflate", ""}:
        raise PublicHttpError("UNSUPPORTED_ENCODING", "来源使用了不支持的压缩格式")
    if encoding == "" or not raw:
        return raw
    try:
        if encoding == "gzip":
            decompressor = zlib.decompressobj(16 + zlib.MAX_WBITS)
        else:
            decompressor = zlib.decompressobj()
        data = decompressor.decompress(raw, max_bytes + 1)
        if len(data) > max_bytes or decompressor.unconsumed_tail:
            raise PublicHttpError("RESPONSE_TOO_LARGE", "来源响应超过大小限制")
        return data
    except zlib.error:
        raise PublicHttpError("BAD_ENCODING", "来源压缩内容无法解析")


def fetch_public(
    url: str,
    *,
    timeout: float,
    max_bytes: int,
    max_redirects: int = 5,
    headers: dict[str, str] | None = None,
    etag: str | None = None,
    last_modified: str | None = None,
    method: str = "GET",
    body: bytes | None = None,
    allow_loopback: bool = False,
) -> PublicResponse:
    started = time.monotonic()
    deadline = started + max(0.1, timeout)
    current = url
    redirects = 0
    while True:
        parts, port, address = public_target(current, allow_loopback=allow_loopback)
        remaining = deadline - time.monotonic()
        if remaining <= 0:
            raise PublicHttpError("TIMEOUT", "来源请求超时")
        connection = http.client.HTTPConnection(address, port, timeout=min(remaining, 8))
        try:
            try:
                connection.connect()
                if parts.scheme.lower() == "https":
                    connection.sock = ssl.create_default_context().wrap_socket(
                        connection.sock, server_hostname=parts.hostname
                    )
            except (TimeoutError, socket.timeout):
                raise PublicHttpError("TIMEOUT", "来源请求超时")
            except ssl.SSLError:
                raise PublicHttpError("TLS_ERROR", "来源 HTTPS 证书校验失败")
            except OSError:
                raise PublicHttpError("NETWORK", "无法连接来源服务")

            request_headers = {
                "Host": parts.netloc,
                "User-Agent": USER_AGENT,
                "Accept": "application/rss+xml, application/atom+xml, application/json, application/xml, text/xml, */*",
                "Accept-Encoding": "identity",
                "Connection": "close",
            }
            if headers:
                request_headers.update({key: value for key, value in headers.items() if value})
            if etag:
                request_headers["If-None-Match"] = etag
            if last_modified:
                request_headers["If-Modified-Since"] = last_modified
            path = parts.path or "/"
            if parts.query:
                path += "?" + parts.query
            try:
                connection.request(method.upper(), path, body=body, headers=request_headers)
                response = connection.getresponse()
            except (TimeoutError, socket.timeout):
                raise PublicHttpError("TIMEOUT", "来源请求超时")
            except (OSError, http.client.HTTPException):
                raise PublicHttpError("NETWORK", "来源连接中断")

            response_headers = _read_headers(response)
            if response.status in {301, 302, 303, 307, 308}:
                location = response_headers.get("location")
                response.read(65536)
                if not location:
                    raise PublicHttpError("BAD_REDIRECT", "来源返回了无效跳转", response.status)
                redirects += 1
                if redirects > max_redirects:
                    raise PublicHttpError("TOO_MANY_REDIRECTS", "来源跳转次数过多", response.status)
                current = urljoin(current, location)
                if urlsplit(current).scheme.lower() not in {"http", "https"}:
                    raise PublicHttpError("URL_REJECTED", "来源跳转到了不支持的地址")
                continue

            if response.status == 304:
                return PublicResponse(
                    status=304, headers=response_headers, body=b"", final_url=current,
                    elapsed_ms=int((time.monotonic() - started) * 1000),
                )
            if response.status < 200 or response.status >= 300:
                retry_after = _retry_after(response_headers)
                response.read(4096)
                code = "RATE_LIMITED" if response.status == 429 else "HTTP_ERROR"
                message = "来源请求过于频繁" if response.status == 429 else f"来源返回 HTTP {response.status}"
                raise PublicHttpError(code, message, response.status, retry_after)

            content_length = response_headers.get("content-length")
            if content_length and content_length.isdigit() and int(content_length) > max_bytes:
                raise PublicHttpError("RESPONSE_TOO_LARGE", "来源响应超过大小限制", response.status)
            data = bytearray()
            while len(data) <= max_bytes:
                remaining = deadline - time.monotonic()
                if remaining <= 0:
                    raise PublicHttpError("TIMEOUT", "来源请求超时")
                if connection.sock:
                    connection.sock.settimeout(min(remaining, 8))
                chunk = response.read1(min(16384, max_bytes + 1 - len(data)))
                if not chunk:
                    break
                data.extend(chunk)
            if len(data) > max_bytes:
                raise PublicHttpError("RESPONSE_TOO_LARGE", "来源响应超过大小限制", response.status)
            body = _decode_body(response_headers, bytes(data), max_bytes)
            return PublicResponse(
                status=response.status, headers=response_headers, body=body, final_url=current,
                elapsed_ms=int((time.monotonic() - started) * 1000),
            )
        finally:
            connection.close()
