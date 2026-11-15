from __future__ import annotations

import http.client
import ipaddress
import json
import os
import shlex
import socket
import subprocess
import sys
import time
from pathlib import Path

import pytest
import yaml


ROOT = Path(__file__).resolve().parents[2]


def test_compose_trust_is_limited_to_the_nginx_address():
    compose = yaml.safe_load((ROOT / "docker-compose.yml").read_text())
    api = compose["services"]["api"]
    web = compose["services"]["web"]
    assert api["ports"] == ["127.0.0.1:${WB_API_PORT:-8000}:8000"]
    assert web["ports"] == ["${WB_BIND_ADDRESS:-0.0.0.0}:${WB_HTTP_PORT:-18743}:80"]

    trusted_ip = api["environment"]["FORWARDED_ALLOW_IPS"]
    nginx_ip = web["networks"]["proxy"]["ipv4_address"]
    subnet = compose["networks"]["proxy"]["ipam"]["config"][0]["subnet"]
    assert trusted_ip == nginx_ip
    assert ipaddress.IPv4Address(nginx_ip.rsplit(":-", 1)[1][:-1]) in ipaddress.IPv4Network(
        subnet.rsplit(":-", 1)[1][:-1]
    )
    assert set(api["networks"]) == {"default", "proxy"}
    assert "proxy" not in compose["services"]["db"].get("networks", {})


@pytest.mark.skipif(sys.platform != "linux", reason="Requires Linux loopback source addresses")
def test_container_uvicorn_ignores_forwarded_headers_from_untrusted_peers(tmp_path):
    dockerfile = (ROOT / "server" / "Dockerfile").read_text()
    command = next(line for line in dockerfile.splitlines() if line.startswith("CMD "))
    startup = json.loads(command.removeprefix("CMD "))[-1]
    uvicorn_options = shlex.split(startup.split("exec uvicorn app.main:app ", 1)[1])
    (tmp_path / "probe.py").write_text(
        "from fastapi import FastAPI, Request\n"
        "app = FastAPI()\n"
        "@app.get('/')\n"
        "async def peer(request: Request):\n"
        "    return {'host': request.client.host, 'scheme': request.url.scheme}\n"
    )

    with socket.socket() as listener:
        listener.bind(("127.0.0.1", 0))
        port = listener.getsockname()[1]
        process = subprocess.Popen(
            [sys.executable, "-m", "uvicorn", "probe:app", *uvicorn_options, "--fd", str(listener.fileno())],
            cwd=tmp_path, env={**os.environ, "FORWARDED_ALLOW_IPS": "127.0.0.2"},
            pass_fds=(listener.fileno(),), stdout=subprocess.DEVNULL, stderr=subprocess.PIPE,
        )
        try:
            def request(source):
                connection = http.client.HTTPConnection("127.0.0.1", port, timeout=0.3, source_address=(source, 0))
                try:
                    connection.request("GET", "/", headers={
                        "X-Forwarded-For": "203.0.113.4", "X-Forwarded-Proto": "https",
                    })
                    response = connection.getresponse()
                    assert response.status == 200
                    return json.loads(response.read())
                finally:
                    connection.close()

            deadline = time.monotonic() + 5
            while True:
                try:
                    untrusted = request("127.0.0.3")
                    break
                except OSError:
                    if process.poll() is not None:
                        pytest.fail(process.stderr.read().decode())
                    if time.monotonic() >= deadline:
                        raise
                    time.sleep(0.05)

            assert untrusted == {"host": "127.0.0.3", "scheme": "http"}
            assert request("127.0.0.2") == {"host": "203.0.113.4", "scheme": "https"}
        finally:
            process.terminate()
            try:
                process.communicate(timeout=5)
            except subprocess.TimeoutExpired:
                process.kill()
                process.communicate()
