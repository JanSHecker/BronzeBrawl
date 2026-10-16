"""Local, per-launch Live Client snapshots, kept verbatim for later tests."""
from datetime import datetime, timezone
from pathlib import Path
import secrets
import threading

from replay import atomic_json


class LiveCapture:
    def __init__(self, root):
        self.started_at = datetime.now(timezone.utc)
        run = self.started_at.strftime('%Y%m%dT%H%M%S.%fZ') + '-' + secrets.token_hex(6)
        self.directory = Path(root) / 'captures' / run
        self.lock = threading.Lock()
        self.saved = 0
        self.sequence = 0
        self.error = None

    def save(self, data):
        # The browser relay can fetch concurrently with the direct sender.
        # Serialize numbering and atomic writes, including identical paused frames.
        with self.lock:
            self.sequence += 1
            captured_at = datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%S.%fZ')
            try:
                self.directory.mkdir(parents=True, exist_ok=True)
                if not (self.directory / 'run.json').exists():
                    atomic_json(self.directory / 'run.json', {
                        'schemaVersion': 1,
                        'startedAt': self.started_at.isoformat(),
                        'source': 'https://127.0.0.1:2999/liveclientdata/allgamedata',
                        'snapshotPattern': 'snapshot-*.json',
                    })
                atomic_json(self.directory / f'snapshot-{self.sequence:08d}-{captured_at}.json', data)
            except (OSError, ValueError, TypeError):
                # Never stop forwarding because the disk is full or unwritable,
                # and never echo payloads or credentials through error messages.
                self.error = 'Live-Aufzeichnung fehlgeschlagen. Speicherplatz und Schreibrechte prüfen; Versand läuft weiter.'
            else:
                self.saved += 1
                self.error = None

    def status(self):
        with self.lock:
            return {'directory': str(self.directory), 'saved': self.saved, 'error': self.error}
