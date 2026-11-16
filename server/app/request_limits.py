"""Queue requests asynchronously before synchronous dependencies hold DB connections."""
import asyncio
from weakref import WeakKeyDictionary

from starlette.responses import JSONResponse


class RequestConcurrencyLimit:
    def __init__(self, app, limit: int, timeout: float):
        self.app = app
        self.limit = limit
        self.timeout = timeout
        # A TestClient can run the same app on several event loops. A semaphore
        # must only be awaited on the loop which owns it.
        self._slots = WeakKeyDictionary()
        self._heavy_slots = WeakKeyDictionary()

    async def __call__(self, scope, receive, send):
        from .agent_runtime import execution
        if execution.get() is not None:
            return await self.app(scope, receive, send)
        if scope['type'] == 'lifespan':
            loop = asyncio.get_running_loop()
            try:
                return await self.app(scope, receive, send)
            finally:
                self._slots.pop(loop, None)
                self._heavy_slots.pop(loop, None)
        if scope['type'] != 'http' or not scope.get('path', '').startswith('/api/') or scope['path'] == '/api/v1/health':
            return await self.app(scope, receive, send)
        loop = asyncio.get_running_loop()
        slots = self._slots.get(loop)
        if slots is None:
            slots = self._slots[loop] = asyncio.Semaphore(self.limit)
        heavy = None
        path = scope['path']
        if path.endswith('/ai/extract') or path.startswith('/api/v1/virtual-tables') or path.startswith('/api/v1/imports/') or path.endswith('/export') or path.endswith('/workbook') and scope.get('method') == 'PUT':
            heavy = self._heavy_slots.get(loop)
            if heavy is None:
                heavy = self._heavy_slots[loop] = asyncio.Semaphore(min(2, self.limit))
        acquired_heavy = False
        try:
            if heavy is not None:
                await asyncio.wait_for(heavy.acquire(), timeout=self.timeout)
                acquired_heavy = True
            await asyncio.wait_for(slots.acquire(), timeout=self.timeout)
        except (asyncio.TimeoutError, asyncio.CancelledError) as error:
            if acquired_heavy:
                heavy.release()
            if isinstance(error, asyncio.CancelledError):
                raise
            response = JSONResponse(status_code=503, headers={'Retry-After': '1'}, content={
                'code': 'SERVER_BUSY', 'message': '当前请求较多，请稍后重试', 'details': {},
            })
            return await response(scope, receive, send)
        try:
            # Hold the slot through response streaming and dependency cleanup,
            # not just until response headers become available.
            await self.app(scope, receive, send)
        finally:
            slots.release()
            if acquired_heavy:
                heavy.release()
