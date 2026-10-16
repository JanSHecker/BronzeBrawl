"""In-place terminal dashboard. Only the UI thread touches Textual widgets."""
import time

from textual.app import App as TextualApp, ComposeResult
from textual.binding import Binding
from textual.containers import Horizontal, Vertical, VerticalScroll
from textual.message import Message
from textual.screen import ModalScreen
from textual.widgets import Button, DataTable, Footer, Input, Label, Select, Static, Switch
from rich.text import Text

from companion import RANKING_LABELS, format_team_ratio, safe_error
from ranking import sort_rankings
from replay import ReplayError


class Dialog(ModalScreen):
    BINDINGS = [('escape', 'cancel', 'Zurück')]

    def action_cancel(self):
        self.dismiss(None)


class MessageDialog(Dialog):
    def __init__(self, title, text, confirm=False):
        super().__init__()
        self.heading = title; self.text = text; self.confirm = confirm

    def compose(self) -> ComposeResult:
        with Vertical(classes='dialog'):
            yield Label(self.heading, classes='dialog-title', markup=False)
            with VerticalScroll(classes='dialog-body'):
                yield Static(self.text, markup=False)
            with Horizontal(classes='dialog-buttons'):
                if self.confirm:
                    yield Button('Abbrechen', id='cancel')
                    yield Button('Laden und starten', variant='primary', id='accept')
                else:
                    yield Button('Schließen', variant='primary', id='accept')

    def on_button_pressed(self, event: Button.Pressed):
        self.dismiss(event.button.id == 'accept')


class ConnectionDialog(Dialog):
    def compose(self) -> ComposeResult:
        with Vertical(classes='dialog'):
            yield Label('App verbinden', classes='dialog-title')
            yield Static('Verbindungscode aus der BronzeBrawl-Web-App einfügen.\nDie Eingabe bleibt verborgen.')
            yield Input(password=True, placeholder='BB1.…', id='connection-code')
            with Horizontal(classes='dialog-buttons'):
                yield Button('Abbrechen', id='cancel')
                yield Button('Verbinden', variant='primary', id='accept')

    def on_mount(self):
        self.query_one(Input).focus()

    def submit_code(self):
        field = self.query_one(Input)
        code = field.value.strip()
        field.value = ''
        self.dismiss(code)

    def on_input_submitted(self, event: Input.Submitted):
        self.submit_code()

    def on_button_pressed(self, event: Button.Pressed):
        if event.button.id == 'accept':
            self.submit_code()
        else:
            self.query_one(Input).value = ''
            self.dismiss(None)


class SortDialog(Dialog):
    def __init__(self, sort_by, descending):
        super().__init__()
        self.sort_by = sort_by; self.descending = descending

    def compose(self) -> ComposeResult:
        with Vertical(classes='dialog'):
            yield Label('Rankings sortieren', classes='dialog-title')
            yield Select([(label, key) for key, label in RANKING_LABELS.items()],
                         value=self.sort_by, allow_blank=False, id='sort-key')
            with Horizontal(classes='sort-direction'):
                yield Switch(value=self.descending, id='descending')
                yield Label('Absteigend (größte Werte zuerst)')
            with Horizontal(classes='dialog-buttons'):
                yield Button('Abbrechen', id='cancel')
                yield Button('Übernehmen', variant='primary', id='accept')

    def on_button_pressed(self, event: Button.Pressed):
        if event.button.id == 'accept':
            self.dismiss((self.query_one(Select).value, self.query_one(Switch).value))
        else:
            self.dismiss(None)


class WorkDone(Message):
    def __init__(self, kind, result=None, error=None):
        super().__init__()
        self.kind = kind; self.result = result; self.error = error


class CompanionTUI(TextualApp):
    TITLE = 'BronzeBrawl Companion'
    CSS = '''
    Screen { background: #11151b; color: #e4e7eb; }
    #title { height: 1; margin: 1 2 0 2; color: #d8ac69; text-style: bold; }
    #connection { height: auto; margin: 1 2; }
    #summary { height: auto; margin: 0 2; color: #d8ac69; }
    #rankings { height: 1fr; min-height: 4; margin: 0 1; border: round #735c3e; }
    #legend { height: auto; margin: 0 2 1 2; color: #a4acb8; }
    DataTable > .datatable--cursor { background: #5b472e; color: #ffffff; }
    DataTable > .datatable--header { background: #202731; color: #d8ac69; }
    Footer { background: #202731; }
    Dialog { align: center middle; background: #000000 65%; }
    .dialog { width: 70; max-width: 95%; height: auto; max-height: 90%;
              border: round #d8ac69; background: #202731; padding: 1 2; }
    .dialog-title { text-style: bold; color: #d8ac69; margin-bottom: 1; }
    .dialog-body { height: auto; max-height: 16; }
    .dialog-buttons { height: auto; align-horizontal: right; margin-top: 1; }
    .dialog-buttons Button { margin-left: 1; }
    Input, Select { margin-top: 1; }
    .sort-direction { height: auto; margin-top: 1; align-vertical: middle; }
    .sort-direction Label { margin: 1; }
    '''
    BINDINGS = [
        Binding('v', 'connect', 'Verbinden'),
        Binding('r', 'fetch', 'Replays holen'),
        Binding('f5', 'refresh', 'Stats/API prüfen'),
        Binding('s', 'sort', 'Sortieren'),
        Binding('enter', 'open', 'Replay starten', show=False),
        Binding('question_mark', 'help', 'Hilfe'),
        Binding('q', 'quit', 'Beenden'),
        Binding('ctrl+c', 'quit', show=False, priority=True),
    ]

    def __init__(self, backend):
        super().__init__()
        self.backend = backend
        self.sort_by = 'kills'; self.descending = True
        self.busy = None; self.busy_match = None; self.connecting = False
        self.items = []; self.rows = []; self.table_signature = None

    def compose(self) -> ComposeResult:
        yield Static('BRONZEBRAWL COMPANION', id='title')
        yield Static('', id='connection', markup=False)
        yield Static('', id='summary', markup=False)
        yield DataTable(id='rankings', cursor_type='row', zebra_stripes=True)
        yield Static('Kills/Gold: kleinerer ÷ größerer Teamwert. 100 % = gleich.\n'
                     'Carry/Momentum: 0–100 · – = nicht verfügbar · ↑↓ Auswahl · Enter Replay starten',
                     id='legend', markup=False)
        yield Footer()

    def on_mount(self):
        table = self.query_one(DataTable)
        self.table = table
        self.connection_widget = self.query_one('#connection', Static)
        self.summary_widget = self.query_one('#summary', Static)
        table.border_title = 'REPLAY-RANKING'
        table.add_columns('Match', 'Kills', 'Gold (Ende)', 'Carry', 'Momentum', 'Objectives', 'Datei', 'Stats-API')
        self.refresh_dashboard()
        table.focus()
        self.backend.start_workers(feed_only=True)
        self.set_interval(0.5, self.refresh_dashboard)
        self.start_task('rank', self.backend.rank_replays)

    def on_unmount(self):
        # Workers check this before downloads/launching; run_dashboard joins feed workers.
        self.backend.stop_event.set()
        self.backend.feed_wake.set()

    def check_action(self, action, parameters):
        if isinstance(self.screen, ModalScreen):
            return action == 'quit'
        return True

    def selected_match(self):
        table = self.table
        index = table.cursor_row
        return self.rows[index]['matchId'] if 0 <= index < len(self.rows) else None

    def refresh_dashboard(self):
        # Read only cheap in-memory state here, never status() or a client/network API.
        with self.backend.lock:
            feed = dict(self.backend.feed)
            gid = self.backend.game_id
            rankings = self.backend.rankings()
        connected = bool(feed.get('connected') and time.time() - (feed.get('lastHeartbeat') or 0) <= 15)
        app_status = '● Verbunden' if connected else ('◌ Verbindung wird aufgebaut …' if feed['enabled'] else '○ Nicht verbunden · V zum Verbinden')
        if feed['enabled'] and not connected and feed.get('failures'):
            app_status = '◌ Verbindung unterbrochen · erneuter Versuch automatisch'
        live_status = {'live': '● Daten verfügbar', 'conflict': '⚠ Spiel gewechselt · neues Spiel verbinden'}.get(feed.get('availability'), '○ Warte auf LoL-Livedaten')
        if feed.get('gameState') == 'ended':
            live_status = '○ Spiel beendet · für das nächste Spiel neu verbinden'
        last = feed.get('lastSuccess')
        age = f'vor {max(0, int(time.time() - last))} s' if last else 'noch kein Versand'
        text = f'APP   {app_status}' + (f' · Spiel #{gid}' if gid else '')
        text += f'\nLIVE  {live_status}\nFEED  {feed["sent"]} Snapshots · {age}'
        if feed.get('error'):
            text += '\n' + feed['error']
        recording = self.backend.recording.status()
        if recording['error']:
            text += '\n' + recording['error']
        self.connection_widget.update(text)
        # Keep the last full table visible until a background analysis finishes.
        if not rankings['running']:
            self.items = [dict(item) for item in rankings['items']]
        direction = '↓' if self.descending else '↑'
        phases = {'rank': 'Bewertungen aktualisieren …', 'refresh': 'Stats und API-Zugriff neu prüfen …', 'fetch': 'Replays suchen / laden …', 'open': 'Replay vorbereiten …'}
        summary = f'Sortierung: {RANKING_LABELS[self.sort_by]} {direction} · {len(self.items)} Matches'
        if self.busy:
            summary += ' · ' + phases[self.busy]
        if rankings.get('skipped'):
            recheck = self.busy == 'refresh' or (rankings.get('notice') or '').startswith('Neu geprüft:')
            summary += f' · {rankings["skipped"]} ' + ('nicht aktualisiert' if recheck else 'ausgeschlossen')
        if not self.busy and (rankings.get('notice') or '').startswith('Neu geprüft:'):
            summary += '\n' + rankings['notice']
        self.summary_widget.update(summary)
        self.render_table()

    def render_table(self):
        table = self.table
        selected = self.selected_match()
        old_row = table.cursor_row
        rows = sort_rankings(self.items, self.sort_by, self.descending)
        cells = []
        for item in rows:
            scores = item['scores']
            state = 'lokal' if item.get('downloaded') else 'fehlt'
            if item['matchId'] == self.busy_match:
                state = 'startet …'
            points = ['–' if scores[key] is None else f'{scores[key]:.1f}'.replace('.', ',') for key in ('carry', 'momentum')]
            source = item.get('objectiveSource', {})
            availability = {'ready': f"✓ {source.get('count', 0)}", 'unavailable': 'fehlt'}.get(source.get('status'), 'ungeprüft')
            stats_api = {'ready': '✓', 'unavailable': 'fehlt · alte Werte'}.get(item.get('statsSource', {}).get('status'), 'Cache / ungeprüft')
            cells.append((item['matchId'], format_team_ratio(scores['metrics']['killsRatio']),
                          format_team_ratio(scores['metrics']['goldRatio']), *points, availability, state, stats_api))
        signature = tuple(cells)
        if signature == self.table_signature:
            return
        self.table_signature = signature
        table.clear()
        self.rows = rows
        for row in cells:
            table.add_row(*(Text(cell) for cell in row), key=row[0])
        table.border_subtitle = '' if rows else 'Noch keine bewertbaren Matches · R für neue Replays'
        if rows:
            index = next((index for index, item in enumerate(rows) if item['matchId'] == selected), min(old_row, len(rows) - 1))
            table.move_cursor(row=index, column=0)

    def start_task(self, kind, operation, identity=None):
        if self.busy:
            return
        self.busy = kind; self.busy_match = identity
        self.refresh_dashboard()
        self.run_worker(lambda: self.perform(kind, operation), thread=True, group='replays')

    def perform(self, kind, operation):
        try:
            if kind == 'connect':
                result = operation()
            else:
                if not self.backend.replay_lock.acquire(blocking=False):
                    raise ReplayError('Ein Replay-Vorgang läuft bereits. Bitte kurz warten.')
                try:
                    result = operation()
                finally:
                    self.backend.replay_lock.release()
            self.post_message(WorkDone(kind, result=result))
        except Exception as exc:
            self.post_message(WorkDone(kind, error=safe_error(exc)))

    def on_work_done(self, event: WorkDone):
        if event.kind == 'connect':
            self.connecting = False
        else:
            self.busy = None; self.busy_match = None
        self.refresh_dashboard()
        result = event.result or {}
        error = event.error or result.get('error') or result.get('rankings', {}).get('error')
        if error:
            self.push_screen(MessageDialog('Vorgang nicht möglich', error))
        elif result.get('requiresDownload'):
            identity = result['matchId']
            self.push_screen(MessageDialog('Replay herunterladen?',
                             f'{identity} liegt noch nicht lokal vor. Herunterladen und anschließend im League Client starten?',
                             confirm=True), lambda accepted: self.confirm_download(identity, accepted))
        elif event.kind != 'refresh' and (result.get('message') or result.get('notice')):
            self.push_screen(MessageDialog('Replay', result.get('message') or result['notice']))

    def action_connect(self):
        if not self.connecting:
            self.push_screen(ConnectionDialog(), self.connect)

    def connect(self, code):
        if code is not None:
            self.connecting = True
            self.run_worker(lambda: self.perform('connect', lambda: self.backend.connect_code(code)),
                            thread=True, group='connection')

    def action_fetch(self):
        self.start_task('fetch', self.backend.fetch_replays)

    def action_refresh(self):
        self.start_task('refresh', self.backend.refresh_rankings)

    def action_sort(self):
        self.push_screen(SortDialog(self.sort_by, self.descending), self.apply_sort)

    def apply_sort(self, selection):
        if selection:
            self.sort_by, self.descending = selection
            self.refresh_dashboard()

    def action_open(self):
        identity = self.selected_match()
        if identity:
            self.start_task('open', lambda: self.backend.open_replay(identity), identity)

    def on_data_table_row_selected(self, event: DataTable.RowSelected):
        self.action_open()

    def confirm_download(self, identity, accepted):
        if accepted:
            self.start_task('open', lambda: self.backend.open_replay(identity, download=True), identity)

    def action_help(self):
        recording = self.backend.recording.status()
        self.push_screen(MessageDialog('Hilfe',
            '↑/↓: Replay auswählen · Bild↑/Bild↓: scrollen\n'
            'Enter: ausgewähltes Replay im League Client starten\n'
            'V: Verbindungscode eingeben · R: neue Replays holen\n'
            'F5: Stats und Objective-API aller gelisteten Replays frisch prüfen\n'
            'S: Sortierung und Richtung wählen · Q/Strg+C: beenden\n\n'
            'Für Suche, Download und Wiedergabe League öffnen und einloggen. '
            'Die Wiedergabe benötigt einen kompatiblen Client-Patch. '
            'Ein gestartetes Replay garantiert keine LoL-Livedaten.\n\n'
            'Kills/Gold: kleinerer ÷ größerer Teamwert × 100 %. '
            'Gold = goldEarned am Spielende. Fehlende Werte bleiben am Ende.\n\n'
            f'Lokale Live-Aufzeichnungen: {recording["saved"]}\n{recording["directory"]}\n'
            'Enthält Spielernamen; nicht ungeprüft teilen.'))

    def action_quit(self):
        self.backend.stop_event.set()
        self.backend.feed_wake.set()
        self.exit()
