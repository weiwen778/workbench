import socket
from types import SimpleNamespace

import pytest

from app.services import providers
from app.services.public_http import is_public_ip, public_target, read_set_cookies


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


def test_fake_ip_is_rejected_by_default():
    assert is_public_ip("198.18.0.169") is False


def test_fake_ip_can_be_allowed_explicitly():
    assert is_public_ip("198.18.0.169", allow_fake_ip=True) is True
    assert is_public_ip("198.19.255.254", allow_fake_ip=True) is True
    assert is_public_ip("10.0.0.1", allow_fake_ip=True) is False


def test_public_target_allows_fake_ip_when_enabled(monkeypatch):
    infos = [(socket.AF_INET, socket.SOCK_STREAM, 6, "", ("198.18.0.169", 443))]
    monkeypatch.setattr(socket, "getaddrinfo", lambda *args, **kwargs: infos)
    _, _, address = public_target("https://fanyi-api.baidu.com/", allow_fake_ip=True)
    assert address == "198.18.0.169"


def test_validate_base_url_explains_fake_ip(monkeypatch):
    infos = [(socket.AF_INET, socket.SOCK_STREAM, 6, "", ("198.18.0.169", 443))]
    monkeypatch.setattr(socket, "getaddrinfo", lambda *args, **kwargs: infos)
    monkeypatch.setattr(providers.settings, "allow_fake_ip_upstream", False)
    with pytest.raises(providers.UpstreamError) as error:
        providers.validate_base_url("https://fanyi-api.baidu.com/api/trans/vip/translate")
    assert "fake-IP" in str(error.value)
    monkeypatch.setattr(providers.settings, "allow_fake_ip_upstream", True)
    assert providers.validate_base_url("https://fanyi-api.baidu.com/api/trans/vip/translate")
