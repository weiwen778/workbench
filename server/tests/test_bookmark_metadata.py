import socket
from unittest.mock import patch
import pytest
from app.services.bookmark_metadata import metadata, public_target

def test_title_icon_and_relative_url():
    with patch('app.services.bookmark_metadata.fetch_html',return_value=('https://example.com/sub/', '<title>A &amp; B</title><link rel="shortcut icon" href="../logo.png">')):
        data=metadata('https://example.com')
    assert data['title']=='A & B'
    assert data['icon_url']=='https://example.com/logo.png'
    assert data['source']=='page'

def test_fallback_without_network_and_private_resolution():
    with patch('app.services.bookmark_metadata.fetch_html',side_effect=OSError()):
        assert metadata('https://www.douyin.com/')['title']=='抖音'
        assert metadata('https://notdouyin.com/')['title']=='notdouyin.com'
    with patch('socket.getaddrinfo',return_value=[(socket.AF_INET,socket.SOCK_STREAM,6,'',('127.0.0.1',443))]):
        with pytest.raises(ValueError): public_target('https://example.com')
    with pytest.raises(ValueError): public_target('file:///etc/passwd')

def test_authenticated_metadata_endpoint(auth):
    with patch('app.services.bookmark_metadata.fetch_html',return_value=('https://example.com/','<title>Example</title>')):
        response=auth.post('/api/v1/bookmarks/metadata',json={'url':'https://example.com/'})
    assert response.status_code==200
    assert response.json()['title']=='Example'
    created=auth.post('/api/v1/bookmarks',json={'url':'https://example.com/','icon_url':response.json()['icon_url']})
    assert created.status_code==201
    assert created.json()['icon_url']=='https://example.com/favicon.ico'
    assert auth.post('/api/v1/bookmarks',json={'url':'https://example.com','icon_url':'javascript:alert(1)'}).status_code==422
