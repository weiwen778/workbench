"""Small public-web metadata reader. Never connects to private server networks."""
import http.client
import ipaddress
import socket
import ssl
import time
from html.parser import HTMLParser
from urllib.parse import urlsplit, urljoin

KNOWN = {'douyin.com': '抖音', 'bilibili.com': '哔哩哔哩', 'github.com': 'GitHub', 'taobao.com': '淘宝', 'jd.com': '京东', 'xiaohongshu.com': '小红书'}

def public_target(url):
    p = urlsplit(url)
    if p.scheme not in ('http', 'https') or not p.hostname or p.username is not None or p.password is not None:
        raise ValueError('Unsupported URL')
    port = p.port or (443 if p.scheme == 'https' else 80)
    if port not in (80, 443):
        raise ValueError('Only public web ports are supported')
    addresses = socket.getaddrinfo(p.hostname, port, type=socket.SOCK_STREAM)
    if not addresses or any(not ipaddress.ip_address(a[4][0]).is_global for a in addresses):
        raise ValueError('Private network address')
    return p, port, addresses[0][4][0]

def fetch_html(url):
    deadline = time.monotonic() + 10
    for _ in range(4):
        p, port, ip = public_target(url)
        remaining = deadline-time.monotonic()
        if remaining <= 0: raise TimeoutError()
        # Connect to the validated IP, preserving hostname for TLS and Host.
        conn = http.client.HTTPConnection(ip, port, timeout=min(3, remaining))
        try:
            conn.connect()
            if p.scheme == 'https':
                conn.sock = ssl.create_default_context().wrap_socket(conn.sock, server_hostname=p.hostname)
            conn.request('GET', (p.path or '/') + ('?' + p.query if p.query else ''),
                         headers={'Host': p.netloc, 'User-Agent': 'Mozilla/5.0 WorkbenchLinkPreview/1.0', 'Accept': 'text/html', 'Accept-Encoding': 'identity'})
            response = conn.getresponse()
            if response.status in (301,302,303,307,308):
                url = urljoin(url,response.getheader('Location',''))
                continue
            if response.status != 200 or 'text/html' not in response.getheader('Content-Type','').lower():
                raise ValueError('No public HTML')
            data = bytearray()
            while len(data) < 512000:
                remaining = deadline-time.monotonic()
                if remaining <= 0: raise TimeoutError()
                conn.sock.settimeout(min(3,remaining)) if conn.sock else None
                chunk=response.read1(min(16384,512000-len(data)))
                if not chunk: break
                data.extend(chunk)
            return url, bytes(data).decode('utf-8',errors='replace')
        finally:
            conn.close()
    raise ValueError('Too many redirects')

class MetadataParser(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.in_title=False; self.title=''; self.site=''; self.icon=''
    def handle_starttag(self,tag,attrs):
        a=dict(attrs)
        if tag=='title': self.in_title=True
        if tag=='meta' and (a.get('property') or a.get('name'))=='og:site_name': self.site=a.get('content','')
        if tag=='link' and 'icon' in (a.get('rel') or '').lower().split() and not self.icon: self.icon=a.get('href','')
    def handle_endtag(self,tag):
        if tag=='title': self.in_title=False
    def handle_data(self,data):
        if self.in_title: self.title+=data

def metadata(url):
    host=urlsplit(url).hostname or ''
    fallback=next((name for domain,name in KNOWN.items() if host==domain or host.endswith('.'+domain)),host)
    result={'title':fallback,'icon_url':urljoin(url,'/favicon.ico'),'source':'fallback'}
    try:
        final,html=fetch_html(url)
        parser=MetadataParser();parser.feed(html)
        name=' '.join((parser.site or parser.title).split())[:200]
        if name:
            result['title']=name;result['source']='page'
        icon=urljoin(final,parser.icon or '/favicon.ico')
        p=urlsplit(icon)
        if p.scheme in ('http','https') and p.hostname and not p.username and not p.password:
            result['icon_url']=icon[:2048]
    except (ValueError,OSError,http.client.HTTPException,UnicodeError):
        pass
    return result
