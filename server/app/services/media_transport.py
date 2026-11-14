"""出站传输：把请求连接到已校验的 IP，避免解析阶段的 SSRF/私网访问。

media-parser 内部直接使用 ``requests``，因此这里通过自定义 adapter 复用
``public_http.public_target`` 的校验结果，而不是重新实现一套解析器传输层。
"""
from __future__ import annotations

from requests.adapters import HTTPAdapter
from urllib3.connection import HTTPConnection, HTTPSConnection
from urllib3.connectionpool import HTTPConnectionPool, HTTPSConnectionPool
from urllib3.exceptions import NewConnectionError
from urllib3.poolmanager import PoolManager
from urllib3.util import connection

from ..config import settings
from .public_http import PublicHttpError, public_target


def _target_url(scheme: str, host: str, port: int) -> str:
    if ":" in host and not host.startswith("["):
        host = f"[{host}]"
    return f"{scheme}://{host}:{port}/"


class _PinnedConnectionMixin:
    scheme = "http"

    def _new_conn(self):
        try:
            _, port, address = public_target(
                _target_url(self.scheme, self.host, self.port),
                allow_loopback=bool(settings.media_allow_loopback),
            )
        except PublicHttpError as exc:
            raise NewConnectionError(self, f"目标地址被拒绝：{exc.message}") from exc
        return connection.create_connection(
            (address, port),
            self.timeout,
            source_address=self.source_address,
            socket_options=self.socket_options,
        )


class PinnedHTTPConnection(_PinnedConnectionMixin, HTTPConnection):
    scheme = "http"


class PinnedHTTPSConnection(_PinnedConnectionMixin, HTTPSConnection):
    scheme = "https"


class PinnedHTTPPool(HTTPConnectionPool):
    ConnectionCls = PinnedHTTPConnection


class PinnedHTTPSPool(HTTPSConnectionPool):
    ConnectionCls = PinnedHTTPSConnection


class PinnedPoolManager(PoolManager):
    pool_classes_by_scheme = {"http": PinnedHTTPPool, "https": PinnedHTTPSPool}


class PinnedAdapter(HTTPAdapter):
    def init_poolmanager(self, *args, **kwargs):
        self.poolmanager = PinnedPoolManager(*args, **kwargs)


def validate_target(url: str) -> None:
    """请求前校验目标；失败时抛出解析器能识别的 ParseFailure。"""
    try:
        public_target(url, allow_loopback=bool(settings.media_allow_loopback))
    except PublicHttpError as exc:
        from .media_parser.src.utils.parser_transport import ParseFailure

        raise ParseFailure(403, "TARGET_REJECTED", f"目标地址被拒绝：{exc.message}") from exc


def install_parser_transport() -> None:
    """把安全 adapter 与校验器注入 vendored ParserSession。"""
    from .media_parser.src.utils.parser_transport import ParserSession

    ParserSession.session_adapter = PinnedAdapter
    ParserSession.target_validator = validate_target
