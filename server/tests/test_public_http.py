import socket
from types import SimpleNamespace

from app.services.public_http import public_target, read_set_cookies


def test_set_cookie_values_are_not_collapsed():
    response = SimpleNamespace(getheaders=lambda: [
        ("Set-Cookie", "_m_h5_tk=abc_123; Path=/"),
        ("Set-Cookie", "_m_h5_tk_enc=xyz; Path=/"),
    ])
    assert read_set_cookies(response) == [
        "_m_h5_tk=abc_123; Path=/",
        "_m_h5_tk_enc=xyz; Path=/",
    ]


def test_public_target_prefers_ipv4(monkeypatch):
    infos = [
        (socket.AF_INET6, socket.SOCK_STREAM, 6, "", ("2606:2800:220:1:248:1893:25c8:1946", 443, 0, 0)),
        (socket.AF_INET, socket.SOCK_STREAM, 6, "", ("93.184.216.34", 443)),
    ]
    monkeypatch.setattr(socket, "getaddrinfo", lambda *args, **kwargs: infos)
    _, _, address = public_target("https://example.com/")
    assert address == "93.184.216.34"
