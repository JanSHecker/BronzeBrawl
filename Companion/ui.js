'use strict';
// Session capability stays in this closure, never in URL/localStorage/console.
(() => {
  let token = '';
  let lastStatus = null;
  const $ = id => document.getElementById(id);
  const notice = (text, error = false) => { $('notice').textContent = text; $('notice').className = error ? 'error' : 'success'; };
  async function api(path, data, extra = {}) {
    const init = data === undefined ? {} : { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Companion-Token': token }, body: JSON.stringify(data) };
    const r = await fetch(path, { ...init, ...extra, cache: 'no-store', credentials: 'omit' });
    const out = await r.json();
    if (!r.ok) throw new Error(out.error || 'Lokaler Vorgang fehlgeschlagen.');
    return out;
  }
  const wrap = f => async event => { if (event) event.preventDefault(); try { await f(event); } catch (e) { notice(e.message, true); } };
  const form = id => Object.fromEntries(new FormData($(id)));
  async function action(name, data = {}) {
    const out = await api('/api/jobs/' + name, data);
    notice('Auftrag angenommen: ' + out.jobId + '. Fortschritt unten.');
    await refresh();
  }
  function button(text, run) {
    const b = document.createElement('button'); b.type = 'button'; b.textContent = text; b.addEventListener('click', wrap(run)); return b;
  }
  function text(parent, tag, value) {
    const el = document.createElement(tag); el.textContent = value; parent.append(el); return el;
  }
  function cards(id, items, render) {
    const box = $(id); box.replaceChildren();
    if (!items.length) { text(box, 'p', 'Keine Einträge.'); return; }
    items.forEach(item => { const card = document.createElement('article'); render(card, item); box.append(card); });
  }
  async function refresh() {
    const status = await api('/api/status'); lastStatus = status;
    $('paired').textContent = 'Pool: ' + (status.poolPaired ? 'gepaart' : 'Token fehlt') + ' · Spiel: ' + (status.gamePaired ? 'gepaart' : 'Paarung fehlt');
    $('feedStatus').textContent = (status.feed.enabled ? 'DIREKT-FEED AKTIV — Browser-Relay aus' : 'Direkt-Feed aus') + '\nLoL: ' + status.feed.availability + '\nErfolgreich gesendet: ' + status.feed.sent + '\n' + (status.feed.error || 'Kein Feed-Fehler.');
    $('refillStatus').textContent = (status.refill.enabled ? 'Hintergrund-Refill aktiv' : 'Hintergrund-Refill aus') + '\nKompatible unreservierte Server-Replays: ' + (status.refill.compatibleUnreserved ?? 'noch nicht geprüft') + '\n' + (status.refill.error || 'Kein Refill-Fehler.');
    $('refillToggle').checked = status.refill.enabled;
    cards('candidates', status.candidates, (card, item) => { text(card, 'h3', item.matchId); text(card, 'p', item.gameVersion); card.append(button('Herunterladen', () => action('acquire', item))); });
    cards('localItems', status.localItems, (card, item) => {
      text(card, 'h3', item.matchId); text(card, 'p', item.gameVersion + ' · ' + (item.sizeBytes / 1024 / 1024).toFixed(1) + ' MiB · ' + item.format);
      text(card, 'small', 'SHA256: ' + item.sha256);
      const actions = document.createElement('div'); actions.className = 'buttons'; card.append(actions);
      actions.append(button('Zum Server hochladen', () => action('upload', { matchId: item.matchId })), button('Im League Client abspielen', () => action('watch', { matchId: item.matchId })), button('Cache-Datei löschen', async () => { if (confirm('Nur lokale Cache-Datei löschen? Client- und Server-Datei bleiben erhalten.')) await action('delete-local', { matchId: item.matchId }); }));
    });
    cards('jobs', status.jobs.slice().reverse(), (card, job) => {
      text(card, 'strong', job.action + ': ' + job.state);
      if (job.error) text(card, 'p', job.error).className = 'error';
      if (job.result) text(card, 'pre', JSON.stringify(job.result, null, 2));
    });
  }
  async function serverList() {
    const result = await api('/api/server-replays');
    $('riotStatus').textContent = result.riotConfigured ? 'Riot-Analyse auf dem Server konfiguriert.' : 'Riot-Key auf dem Server fehlt: Dateien bleiben echt gespeichert; Scores können fehlen.';
    cards('serverItems', result.items, (card, item) => {
      text(card, 'h3', item.matchId); text(card, 'p', item.gameVersion + ' · Analyse: ' + item.analysisStatus + ' · Reserviert: ' + (item.reservedGameId ?? 'nein'));
      if (item.analysisError) text(card, 'p', item.analysisError).className = 'error';
      text(card, 'pre', item.scores ? JSON.stringify(item.scores, null, 2) : 'Scores: nicht verfügbar (keine erfundenen Werte)');
      const a = document.createElement('div'); a.className = 'buttons'; card.append(a);
      a.append(button('In lokalen Cache laden', () => action('server-download', { matchId: item.matchId })), button('Analyse erneut anfordern', () => action('analyze', { matchId: item.matchId })));
      if (item.reservedGameId !== null && item.reservedGameId !== undefined) a.append(button('Reservierung freigeben', async () => { if (confirm('Reservierung für Spiel ' + item.reservedGameId + ' gezielt freigeben?')) await action('release', { matchId: item.matchId, gameId: item.reservedGameId }); }));
    });
    notice('Server-Liste geladen.');
  }
  $('config').addEventListener('submit', wrap(async () => {
    const data = form('config'); data.target = Number(data.target);
    if (data.gameId) data.gameId = Number(data.gameId); else delete data.gameId;
    await api('/api/config', data);
    $('config').elements.poolToken.value = ''; $('config').elements.hostToken.value = '';
    notice('Einstellungen gespeichert; Tokens nur im Speicher.'); await refresh();
  }));
  $('forget').addEventListener('click', wrap(async () => { await api('/api/forget', {}); notice('Tokens vergessen; Feed und Refill gestoppt.'); await refresh(); }));
  $('feedStart').addEventListener('click', wrap(async () => { await api('/api/feed/start', {}); notice('Direkt-Feed angefordert. Browser-Relay deaktivieren!'); await refresh(); }));
  $('feedStop').addEventListener('click', wrap(async () => { await api('/api/feed/stop', {}); await refresh(); }));
  $('probe').addEventListener('click', wrap(async () => { const data = await api('/lol-data'); notice('Echte LoL-Daten verfügbar: ' + data.allPlayers.length + ' Spieler, Spielzeit ' + data.gameData.gameTime); await refresh(); }));
  $('discover').addEventListener('click', wrap(() => action('discover')));
  $('scan').addEventListener('click', wrap(() => action('scan')));
  $('refillOnce').addEventListener('click', wrap(() => action('refill')));
  $('refillToggle').addEventListener('change', wrap(async () => { await api('/api/refill', { enabled: $('refillToggle').checked }); await refresh(); }));
  $('acquire').addEventListener('submit', wrap(() => action('acquire', form('acquire'))));
  $('reserve').addEventListener('submit', wrap(async () => { const data = form('reserve'); data.gameId = Number(data.gameId); if (!data.gameVersion) delete data.gameVersion; await action('reserve', data); }));
  $('serverRefresh').addEventListener('click', wrap(serverList));
  $('import').addEventListener('submit', wrap(async () => {
    const data = new FormData($('import')); const file = data.get('file');
    if (!file || !file.size || file.size > 150 * 1024 * 1024) throw new Error('Datei leer oder größer als 150 MiB.');
    await api('/api/import', undefined, { method: 'POST', headers: { 'Content-Type': 'application/octet-stream', 'X-Companion-Token': token, 'X-Replay-Match': data.get('matchId'), 'X-Replay-Version': data.get('gameVersion') }, body: file });
    notice('Validierte Datei im lokalen Cache.'); await refresh();
  }));
  (async () => {
    try { token = (await api('/api/bootstrap')).token; await refresh(); notice('Companion bereit. Zuerst Paarung eingeben.'); }
    catch (e) { notice(e.message, true); }
    // Poll only local status. Feed/refill are Python workers, never browser timers.
    setInterval(() => refresh().catch(() => notice('Lokaler Companion nicht erreichbar. Fenster von start.cmd prüfen.', true)), 3000);
  })();
})();
