"""Run modal UI regression in a disposable SQLite application, never the live workspace.
Usage: server/.venv/bin/python e2e/run-modal-layout.py
Requires web/dist and the existing e2e Playwright dependencies / Chromium.
"""
import os
from pathlib import Path
import socket
import subprocess
import sys
import tempfile
import time
import urllib.request

ROOT = Path(__file__).resolve().parents[1]
PORT = 18192
if not (ROOT / 'web/dist/index.html').is_file():
    raise SystemExit('Build the frontend first: cd web && npm run build')
with socket.socket() as probe:
    try:
        probe.bind(('127.0.0.1', PORT))
    except OSError:
        raise SystemExit(f'Port {PORT} is already in use; existing service left untouched')
artifacts = ROOT / '.run'
artifacts.mkdir(exist_ok=True)
with tempfile.TemporaryDirectory(prefix='wb_modal_layout_') as name:
    temporary = Path(name)
    env = {key: value for key, value in os.environ.items() if not key.startswith('WB_')}
    env.update(
        WB_ENV='test',
        WB_DATABASE_URL='sqlite:///' + (temporary / 'test.db').as_posix(),
        WB_STORAGE_DIR=str(temporary / 'storage'),
        WB_BACKUP_DIR=str(temporary / 'backups'),
        WB_BACKUP_ENABLED='false',
        WB_COOKIE_SECURE='false',
        WB_ADMIN_USERNAME='admin',
        WB_ADMIN_PASSWORD='admin12345',
        # Public deterministic test key, never a deployment credential.
        WB_ENCRYPTION_KEY='MDEyMzQ1Njc4OWFiY2RlZjAxMjM0NTY3ODlhYmNkZWY=',
    )
    with (artifacts / 'modal-browser-server.log').open('w') as log:
        child = subprocess.Popen(
            [sys.executable, '-m', 'uvicorn', 'app.main:app', '--host', '127.0.0.1', '--port', str(PORT)],
            cwd=ROOT / 'server', env=env, stdout=log, stderr=subprocess.STDOUT,
        )
        try:
            ready = False
            for _ in range(150):
                if child.poll() is not None:
                    raise RuntimeError('Isolated server exited; inspect .run/modal-browser-server.log')
                try:
                    with urllib.request.urlopen(f'http://127.0.0.1:{PORT}/api/v1/health', timeout=1) as response:
                        ready = response.status == 200
                    if ready:
                        break
                except OSError:
                    pass
                time.sleep(.2)
            if not ready:
                raise RuntimeError('Isolated server did not become ready')
            result = subprocess.run(['node', str(ROOT / 'e2e/modal-layout.mjs')], cwd=ROOT, env=env)
        finally:
            child.terminate()
            try:
                child.wait(timeout=10)
            except subprocess.TimeoutExpired:
                child.kill()
                child.wait(timeout=5)
    raise SystemExit(result.returncode)
