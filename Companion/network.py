"""Bounded stdlib networking. No redirects or ambient proxies; credentials stay scoped."""
import json
from pathlib import Path
import ssl
import urllib.error
import urllib.parse
import urllib.request

MAX_FILE = 150 * 1024 * 1024


class RemoteError(Exception):
    def __init__(self, status=0):
        self.status = status
        super().__init__(f'Verbindung fehlgeschlagen (HTTP {status or "offline"}).')


def validate_backend(url, allow_http_local=False):
    if not isinstance(url, str) or len(url) > 2048 or any(c.isspace() for c in url):
        raise ValueError('Ungültige Backend-Adresse.')
    p = urllib.parse.urlsplit(url)
    try:
        port = p.port
    except ValueError:
        raise ValueError('Ungültiger Port.') from None
    if not p.hostname or p.username or p.password or p.query or p.fragment or '\\' in url:
        raise ValueError('Backend ohne Zugangsdaten, Query oder Fragment eingeben.')
    if p.scheme != 'https' and not (allow_http_local and p.scheme == 'http' and p.hostname in ('127.0.0.1', 'localhost', '::1')):
        raise ValueError('HTTPS erforderlich (HTTP nur mit explizitem lokalen Entwicklungsmodus).')
    if port is not None and not 1 <= port <= 65535:
        raise ValueError('Ungültiger Port.')
    return url.rstrip('/')


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


class Network:
    def __init__(self, timeout=8):
        self.timeout = timeout

    def _open(self, method, url, headers=None, body=None, local=False):
        parsed = urllib.parse.urlsplit(url)
        if local and (parsed.scheme != 'https' or parsed.hostname != '127.0.0.1' or parsed.username or parsed.password):
            raise ValueError('Lokale TLS-Ausnahme nur für festes HTTPS-Loopback.')
        context = ssl._create_unverified_context() if local else ssl.create_default_context()
        # Deliberately ignore HTTPS_PROXY / proxy auto-config for both credentials and loopback.
        opener = urllib.request.build_opener(urllib.request.ProxyHandler({}), NoRedirect(), urllib.request.HTTPSHandler(context=context))
        h = dict(headers or {})
        if isinstance(body, (dict, list)):
            body = json.dumps(body, allow_nan=False).encode()
            h['Content-Type'] = 'application/json'
        request = urllib.request.Request(url, data=body, headers=h, method=method)
        return opener.open(request, timeout=self.timeout)

    def request(self, method, url, headers=None, body=None, local=False):
        stream = None
        try:
            h = dict(headers or {})
            if isinstance(body, Path):
                if not 0 < body.stat().st_size <= MAX_FILE:
                    raise ValueError('Replay zu groß oder leer.')
                h['Content-Type'] = 'application/octet-stream'
                h['Content-Length'] = str(body.stat().st_size)
                stream = body.open('rb'); body = stream
            with self._open(method, url, h, body, local) as response:
                raw = response.read(4 * 1024 * 1024 + 1)
                if len(raw) > 4 * 1024 * 1024:
                    raise RemoteError(502)
                return json.loads(raw) if raw else None
        except urllib.error.HTTPError as e:
            raise RemoteError(e.code) from None
        except (OSError, urllib.error.URLError, ValueError) as e:
            raise RemoteError() from None
        finally:
            if stream:
                stream.close()

    def download(self, url, target, headers=None):
        try:
            with self._open('GET', url, headers) as response, Path(target).open('wb') as out:
                count = 0
                while True:
                    chunk = response.read(64 * 1024)
                    if not chunk:
                        break
                    count += len(chunk)
                    if count > MAX_FILE:
                        raise RemoteError(413)
                    out.write(chunk)
        except urllib.error.HTTPError as e:
            raise RemoteError(e.code) from None
        except (OSError, urllib.error.URLError):
            raise RemoteError() from None
