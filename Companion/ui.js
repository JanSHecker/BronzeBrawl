'use strict';
(() => {
  let token = '';
  let replayJob = null;
  let pollTimer;
  let closed = false;
  const $ = id => document.getElementById(id);
  const show = (id, message, error = false) => {
    $(id).textContent = message;
    $(id).classList.toggle('error', error);
    $(id).setAttribute('role', error ? 'alert' : 'status');
  };
  async function api(path, data) {
    const response = await fetch(path, {
      cache: 'no-store', credentials: 'omit', signal: AbortSignal.timeout(30000),
      ...(data === undefined ? {} : {
        method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Companion-Token': token },
        body: JSON.stringify(data),
      }),
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || 'Companion nicht erreichbar.');
    return result;
  }
  async function refresh() {
    const status = await api('/api/status');
    if (closed) return;
    const feed = status.feed;
    if (!status.gamePaired) show('feedStatus', 'Bereit. Für Live-Daten dein Spiel unter Einrichtung verbinden.');
    else if (!feed.enabled && feed.error) show('feedStatus', feed.error, true);
    else if (feed.enabled && !feed.error && feed.lastSuccess) show('feedStatus', 'Live-Daten werden weitergeleitet.');
    else show('feedStatus', 'Wartet auf ein laufendes Spiel. Verbindet sich automatisch.');

    const job = status.jobs.find(item => item.id === replayJob);
    if (job?.state === 'done' || job?.state === 'failed') {
      replayJob = null;
      $('fetchReplays').disabled = false;
      $('fetchReplays').textContent = 'Replays holen';
      if (job.state === 'failed') show('replayStatus', job.error, true);
      else {
        const files = job.result.items || [];
        show('replayStatus', job.result.message);
        $('replayFiles').replaceChildren(...files.map(item => {
          const line = document.createElement('li'); line.textContent = item.filename; return line;
        }));
        $('replayFiles').hidden = !files.length;
      }
    }
    return status;
  }
  $('fetchReplays').addEventListener('click', async () => {
    if (replayJob || $('fetchReplays').disabled) return;
    $('fetchReplays').disabled = true;
    $('fetchReplays').textContent = 'Replays werden geholt …';
    show('replayStatus', 'League Client wird abgefragt …');
    try { replayJob = (await api('/api/jobs/fetch-replays', {})).jobId; }
    catch (error) {
      $('fetchReplays').disabled = false; $('fetchReplays').textContent = 'Replays holen';
      show('replayStatus', error.message, true);
    }
  });
  $('config').addEventListener('submit', async event => {
    event.preventDefault();
    if ($('saveConfig').disabled) return;
    $('saveConfig').disabled = true;
    const data = Object.fromEntries(new FormData($('config')));
    if (data.gameId) data.gameId = Number(data.gameId); else delete data.gameId;
    try {
      await api('/api/config', data);
      $('hostToken').value = '';
      const status = await refresh();
      show('configStatus', status?.gamePaired
        ? 'Verbunden. Live-Daten werden automatisch weitergeleitet, sobald ein Spiel läuft.'
        : 'Einrichtung gespeichert. Für Live-Daten noch dein Spiel verbinden.');
    } catch (error) { show('configStatus', error.message, true); }
    finally { $('saveConfig').disabled = false; }
  });
  $('forget').addEventListener('click', async () => {
    $('forget').disabled = true;
    try {
      await api('/api/forget', {});
      $('hostToken').value = ''; $('gameId').value = '';
      show('configStatus', 'Spielverbindung getrennt.'); await refresh();
    } catch (error) { show('configStatus', error.message, true); }
    finally { $('forget').disabled = false; }
  });
  async function poll() {
    try { await refresh(); }
    catch { show('feedStatus', 'Companion nicht erreichbar. Verbindung wird erneut versucht.', true); }
    if (!closed) pollTimer = setTimeout(poll, 1500);
  }
  (async () => {
    try {
      const bootstrap = await api('/api/bootstrap'); token = bootstrap.token;
      const settings = bootstrap.settings || {};
      for (const key of ['backendUrl', 'leagueDir', 'gameId']) {
        if (settings[key] !== undefined && settings[key] !== null) $(key).value = settings[key];
      }
      $('fetchReplays').disabled = false;
      show('replayStatus', 'League Client öffnen und auf „Replays holen“ klicken.');
      await poll();
    } catch { show('replayStatus', 'Companion nicht erreichbar. App erneut öffnen.', true); }
  })();
  window.addEventListener('pagehide', () => { closed = true; clearTimeout(pollTimer); });
})();
