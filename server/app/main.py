from __future__ import annotations

import logging
import asyncio
import time
import uuid
from contextlib import suppress
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from sqlalchemy import select

from .config import settings
from .db import SessionLocal, init_db
from .errors import ApiError, api_error_handler, error_payload
from .models import FeedbackIntegration, TranslationConnection, User
from .security import hash_password, new_csrf_token
from .services import log_store
from .utils import now_local

logger = logging.getLogger("workbench")

SAFE_METHODS = {"GET", "HEAD", "OPTIONS"}
CSRF_EXEMPT = {"/api/v1/auth/login"}


def create_app() -> FastAPI:
    log_store.install()

    @asynccontextmanager
    async def lifespan(_app: FastAPI):
        # 生产只走 alembic：create_all 只建表不加列，会掩盖迁移并造成结构漂移。
        if settings.env != "production":
            init_db()
        bootstrap()
        task = None
        worker = None
        if settings.env == "production":
            from .maintenance import maintenance_loop
            task = asyncio.create_task(maintenance_loop())
        if settings.env!='test':
            from .services.server_metrics import start as start_metrics
            start_metrics()
            from .services.jobs import worker_loop
            worker=asyncio.create_task(worker_loop())
        try:
            yield
        finally:
            from .services.server_metrics import stop as stop_metrics
            stop_metrics()
            if worker is not None:
                worker.cancel()
                with suppress(asyncio.CancelledError): await worker
            if task is not None:
                task.cancel()
                with suppress(asyncio.CancelledError):
                    await task
            with suppress(Exception):
                await asyncio.to_thread(log_store.flush_now)

    app = FastAPI(
        title=settings.app_name,
        version="2.1.0",
        docs_url="/api/docs",
        openapi_url="/api/openapi.json",
        lifespan=lifespan,
    )

    app.add_exception_handler(ApiError, api_error_handler)

    @app.exception_handler(RequestValidationError)
    async def _validation_handler(_request: Request, exc: RequestValidationError):
        fields: dict[str, str] = {}
        for err in exc.errors():
            loc = [str(x) for x in err.get("loc", []) if x != "body"]
            fields[".".join(loc) or "body"] = err.get("msg", "参数不合法")
        return JSONResponse(
            status_code=422,
            content=error_payload("VALIDATION_ERROR", "提交的内容不合法", {"fields": fields}),
        )

    @app.middleware("http")
    async def _reject_oversized_body(request: Request, call_next):
        # Reject declared oversized bodies before Starlette buffers the multipart
        # payload to disk. Chunked bodies are still bounded by the reverse proxy.
        raw_length = request.headers.get("content-length")
        if raw_length:
            try:
                length = int(raw_length)
            except ValueError:
                length = -1
            if length > settings.max_upload_bytes + 1_000_000:
                return JSONResponse(
                    status_code=413,
                    content=error_payload(
                        "REQUEST_TOO_LARGE",
                        f"请求体不能超过 {settings.max_upload_bytes // 1_000_000} MB",
                    ),
                )
        return await call_next(request)

    @app.middleware("http")
    async def _csrf_and_cookie(request: Request, call_next):
        path = request.url.path
        # 没有会话 Cookie 的请求不可能是「借用登录态」的 CSRF，交给鉴权返回 401
        has_session = bool(request.cookies.get(settings.cookie_name))
        if (
            request.method not in SAFE_METHODS
            and path.startswith("/api")
            and path not in CSRF_EXEMPT
            and has_session
            and not (path.startswith('/api/v1/agent/') and request.headers.get('authorization'))
        ):
            header = request.headers.get("x-csrf-token")
            cookie = request.cookies.get(settings.csrf_cookie_name)
            if not header or not cookie or header != cookie:
                return JSONResponse(
                    status_code=403,
                    content=error_payload("CSRF_FAILED", "页面凭证已失效，请刷新页面后重试"),
                )
        response = await call_next(request)
        if not request.cookies.get(settings.csrf_cookie_name):
            response.set_cookie(
                settings.csrf_cookie_name,
                new_csrf_token(),
                max_age=60 * 60 * 24 * 30,
                samesite="lax",
                secure=settings.cookie_secure,
                httponly=False,
                path="/",
            )
        return response

    @app.middleware('http')
    async def _audit(request:Request,call_next):
        from .agent_runtime import execution
        internal=execution.get() is not None
        response=await call_next(request)
        identity=getattr(request.state,'audit_identity',None)
        if not internal and identity and request.method in {'POST','PUT','PATCH','DELETE'} and response.status_code<400 and not request.url.path.startswith('/api/v1/auth/'):
            from starlette.background import BackgroundTasks
            uid,actor=identity;method=request.method;path=request.url.path[:1000];status=response.status_code
            def save_audit():
                try:
                    from .models import OperationLog
                    with SessionLocal() as audit_db:
                        audit_db.add(OperationLog(user_id=uid,actor=actor,method=method,path=path,status=status));audit_db.commit()
                except Exception:logger.exception('Could not save operation log')
            background=BackgroundTasks()
            if response.background:background.add_task(response.background)
            background.add_task(save_audit);response.background=background
        return response

    @app.middleware('http')
    async def _log_requests(request: Request, call_next):
        path = request.url.path
        if not path.startswith('/api/'):
            return await call_next(request)
        request_id = (request.headers.get('X-Request-ID') or uuid.uuid4().hex[:16])[:64]
        token = log_store.request_id_var.set(request_id)
        request.state.request_id = request_id
        started = time.perf_counter()
        try:
            response = await call_next(request)
        except Exception:
            duration = int((time.perf_counter() - started) * 1000)
            logger.exception(
                '请求处理失败 %s %s', request.method, path,
                extra={
                    'log_source': 'request', 'path': path, 'method': request.method,
                    'status': 500, 'duration_ms': duration, 'request_id': request_id,
                    'user_id': log_store.user_id_var.get(None),
                },
            )
            raise
        finally:
            log_store.request_id_var.reset(token)
        duration = int((time.perf_counter() - started) * 1000)
        response.headers['X-Request-ID'] = request_id
        skip = path in {'/api/v1/health', '/api/v1/logs/client'} or (
            path.startswith('/api/v1/logs') and request.method == 'GET'
        )
        if not skip:
            status = response.status_code
            level = logging.ERROR if status >= 500 else logging.WARNING if status >= 400 else logging.INFO
            logger.log(
                level, '%s %s -> %s', request.method, path, status,
                extra={
                    'log_source': 'request', 'path': path, 'method': request.method,
                    'status': status, 'duration_ms': duration, 'request_id': request_id,
                    'user_id': log_store.user_id_var.get(None),
                },
            )
        return response

    from .request_limits import RequestConcurrencyLimit
    app.add_middleware(RequestConcurrencyLimit, limit=settings.request_concurrency, timeout=settings.request_queue_timeout)

    from .routers import (
        agent,
        agent_tokens,
        auth,
        checkin_import,
        checkins,
        dashboards,
        document_projects,
        files,
        health,
        memos,
        bookmarks,
        notes,
        preferences,
        tables,
        table_workspaces,
        workbook_files,
        targets,
        todos,
        transfers,
        whiteboards,
        translate,
        trash,
    )

    api = "/api/v1"
    from .routers import category_management
    app.include_router(category_management.router, prefix=api)
    app.include_router(health.router, prefix=api)
    app.include_router(auth.router, prefix=api)
    app.include_router(agent.router, prefix=api)
    from .routers import agent_changes
    app.include_router(agent_changes.router, prefix=api)
    from .routers import agent_runs
    app.include_router(agent_runs.router, prefix=api)
    app.include_router(agent_tokens.router, prefix=api)
    app.include_router(dashboards.router, prefix=api)
    app.include_router(preferences.router, prefix=api)
    app.include_router(targets.router, prefix=api)
    app.include_router(checkins.router, prefix=api)
    app.include_router(checkin_import.router, prefix=api)
    app.include_router(todos.router, prefix=api)
    app.include_router(tables.router, prefix=api)
    app.include_router(table_workspaces.router, prefix=api)
    app.include_router(workbook_files.router, prefix=api)
    app.include_router(transfers.router, prefix=api)
    app.include_router(files.router, prefix=api)
    app.include_router(whiteboards.router, prefix=api)
    app.include_router(document_projects.router, prefix=api)
    app.include_router(notes.router, prefix=api)
    app.include_router(memos.router, prefix=api)
    app.include_router(bookmarks.router, prefix=api)
    app.include_router(translate.router, prefix=api)
    from .routers import ai_tables
    app.include_router(ai_tables.router, prefix=api)
    app.include_router(trash.router, prefix=api)

    from .routers import workspace_tools
    app.include_router(workspace_tools.router,prefix=api)
    from .routers import logs as logs_router
    app.include_router(logs_router.router, prefix=api)
    from .routers import feedback as feedback_router
    app.include_router(feedback_router.router, prefix=api)

    _mount_spa(app)
    return app


def _validate_production_password(password: str) -> None:
    value = (password or "").strip()
    weak = {
        "admin12345", "password", "password123", "123456789012", "adminadmin",
        "请改成至少12位的强密码", "请改成至少 12 位的强密码", "changeme",
    }
    if (
        len(value) < 12
        or value.lower() in weak
        or "请改成" in value
        or "changeme" in value.lower()
    ):
        raise RuntimeError(
            "Production requires an administrator password of at least 12 characters "
            "that is not a documented placeholder or common weak password"
        )


def bootstrap() -> None:
    """初始化管理员、翻译服务占位、存储目录。"""
    if settings.env == "production":
        if not settings.encryption_key:
            raise RuntimeError("Production requires WB_ENCRYPTION_KEY")
        _validate_production_password(settings.admin_password)
        if settings.is_sqlite:
            raise RuntimeError("Production must use the configured PostgreSQL database")
    settings.storage_dir.mkdir(parents=True, exist_ok=True)
    with SessionLocal() as db:
        user = db.scalar(select(User).limit(1))
        if user is None:
            db.add(
                User(
                    username=settings.admin_username,
                    password_hash=hash_password(settings.admin_password),
                    theme="light",
                )
            )
            logger.info("已创建管理员账号 %s", settings.admin_username)
        existing = {c.provider for c in db.scalars(select(TranslationConnection)).all()}
        for provider in ("baidu", "youdao", "deepseek"):
            if provider not in existing:
                db.add(TranslationConnection(provider=provider, enabled=False))
        if db.scalar(select(FeedbackIntegration).limit(1)) is None:
            db.add(FeedbackIntegration(id=1, labels=[]))
        db.commit()


def _mount_spa(app: FastAPI) -> None:
    dist = Path(__file__).resolve().parents[2] / "web" / "dist"
    if not dist.exists():
        return
    if (dist / "assets").exists():
        from .static_assets import PrecompressedAssets
        app.mount("/assets", PrecompressedAssets(directory=dist / "assets"), name="assets")

    @app.get("/{full_path:path}", include_in_schema=False)
    async def _spa(full_path: str):
        if full_path.startswith("api/"):
            return JSONResponse(status_code=404, content=error_payload("NOT_FOUND", "接口不存在"))
        candidate = (dist / full_path).resolve()
        if not candidate.is_relative_to(dist.resolve()):
            return JSONResponse(status_code=404, content=error_payload("NOT_FOUND", "文件不存在"))
        if full_path and candidate.is_file():
            return FileResponse(candidate,headers={"Cache-Control":"no-store"} if candidate.name=="index.html" else None)
        return FileResponse(dist / "index.html",headers={"Cache-Control":"no-store"})


app = create_app()
