import { useState } from "react";
import { axios, getGameId } from "../api";
import useReplayAdmin, { replayUrl } from "./useReplayAdmin";
import CompanionSetup from "./CompanionSetup";
import "./replays.css";

const scoreKeys = { overall: "Gesamt", balance: "Balance", carry: "Carry", momentum: "Momentum" };
const numberScore = (item, key) => typeof item.scores?.[key] === "number" && Number.isFinite(item.scores[key]) ? item.scores[key] : null;
const fullVersion = /^\d+\.\d+\.\d+\.\d+$/;
const matchIdPattern = /^(BR1|EUN1|EUW1|JP1|KR|LA1|LA2|ME1|NA1|OC1|PH2|RU|SG2|TH2|TR1|TW2|VN2)_[1-9]\d*$/;
const display = (value) => value == null ? "Nicht verfügbar" : typeof value === "object" ? JSON.stringify(value, null, 2) : String(value);

function Metrics({ metrics }) {
  const known = new Set(["gold", "teams"]);
  const rows = [];
  if (metrics.gold && typeof metrics.gold === "object") {
    if (metrics.gold.swing !== undefined) rows.push(["Gold-Schwankung", metrics.gold.swing]);
    if (metrics.gold.leadChanges !== undefined) rows.push(["Führungswechsel", metrics.gold.leadChanges]);
  }
  if (metrics.teams !== undefined) rows.push(["Kill-Verteilung (Teams / Spieler)", metrics.teams]);
  Object.entries(metrics).forEach(([key, value]) => {
    if (!known.has(key)) rows.push([key, value]);
  });
  return <dl className="replay-metrics">{rows.map(([key, value]) => <div key={key}><dt>{key}</dt><dd><pre>{display(value)}</pre></dd></div>)}</dl>;
}

function ReplayCard({ item, busy, perform }) {
  const path = `/${encodeURIComponent(item.matchId)}`;
  const reserved = item.reservedGameId != null;
  const retry = () => perform(async ({ config }) => {
    await axios.post(replayUrl(`${path}/analyze`), {}, config);
    return `Analyse für ${item.matchId} angefordert.`;
  });
  const download = () => perform(async (context) => {
    const response = await axios.get(replayUrl(`${path}/file`), { ...context.config, responseType: "blob", timeout: 120000 });
    if (!context.active) return;
    const url = URL.createObjectURL(response.data);
    context.urls.add(url);
    const link = document.createElement("a");
    link.href = url; link.download = `${item.matchId}.rofl`;
    document.body.appendChild(link); link.click(); link.remove();
    // Keep the object URL alive long enough for the browser's download handler.
    window.setTimeout(() => { if (context.urls.delete(url)) URL.revokeObjectURL(url); }, 1000);
    return `Download für ${item.matchId} gestartet.`;
  });
  const remove = () => {
    if (!window.confirm(`Replay ${item.matchId} und seine Datei endgültig löschen?`)) return;
    perform(async ({ config }) => { await axios.delete(replayUrl(path), config); return `${item.matchId} gelöscht.`; });
  };
  const release = () => perform(async ({ config }) => {
    await axios.post(replayUrl(`${path}/release`), { gameId: item.reservedGameId }, config);
    return `${item.matchId} freigegeben.`;
  });

  return (
    <article className="replay-panel" data-match-id={item.matchId} aria-label={item.matchId}>
      <h3>{item.matchId}</h3>
      <p>Patch {item.patch} · Version {item.gameVersion}</p>
      <p>{Number.isFinite(item.sizeBytes) ? `${(item.sizeBytes / 1048576).toFixed(2)} MiB` : "Dateigröße unbekannt"} · Gespeichert: {item.createdAt ? new Date(item.createdAt).toLocaleString("de-DE") : "Nicht verfügbar"}</p>
      <p>Analyse: {({ pending: "Ausstehend", ready: "Bereit", failed: "Fehlgeschlagen" })[item.analysisStatus] || "Unbekannt"}</p>
      {item.analysisError && <p className="replay-error">{item.analysisError}</p>}
      <dl className="replay-scores">
        {Object.entries(scoreKeys).map(([key, label]) => <div key={key}><dt>{label}</dt><dd>{display(numberScore(item, key))}</dd></div>)}
      </dl>
      {item.scores && numberScore(item, "momentum") === null && <p>Teilbewertung: keine Timeline bzw. kein Momentum verfügbar. Goldwerte werden nicht als 0 ergänzt.</p>}
      {!item.scores && <p>Noch keine Bewertung verfügbar; gespeicherte Datei und Analyse sind getrennt.</p>}
      <details>
        <summary>Metriken und Datei-Details</summary>
        <p>Gold-Schwankungen, Führungswechsel und Kill-Verteilung (kill spread) laut Server. Fehlende Timeline bedeutet: keine verlässlichen Gold- oder Momentumwerte.</p>
        {item.scores?.metrics && Object.keys(item.scores.metrics).length > 0 ? <Metrics metrics={item.scores.metrics} /> : <p>Keine Metriken verfügbar.</p>}
        <p>Score-Version: {display(item.scores?.version)}</p>
        <p>SHA-256: <code>{item.sha256 || "Nicht verfügbar"}</code></p>
      </details>
      <p>{reserved ? `Reserviert für Spiel ${item.reservedGameId}` : "Nicht reserviert"}</p>
      <div className="replay-actions">
        <button disabled={busy} onClick={download}>Datei herunterladen</button>
        <button disabled={busy} onClick={retry}>Analyse wiederholen</button>
        <button disabled={busy || reserved} onClick={remove}>Löschen</button>
        {reserved && <button disabled={busy} onClick={release}>Freigeben</button>}
      </div>
    </article>
  );
}

export default function ReplaysPage() {
  const admin = useReplayAdmin();
  const [credential, setCredential] = useState("");
  const [patch, setPatch] = useState("");
  const [sortBy, setSortBy] = useState("overall");
  const [matchId, setMatchId] = useState("");
  const [uploadVersion, setUploadVersion] = useState("");
  const [file, setFile] = useState(null);
  const [gameId, setGameId] = useState(() => getGameId() || "");
  const [gameVersion, setGameVersion] = useState("");
  const upload = (event) => {
    event.preventDefault();
    const id = matchId.trim(); const version = uploadVersion.trim();
    if (!matchIdPattern.test(id)) { admin.setError("Vollständige Match-ID mit Plattform angeben, z. B. EUW1_123."); return; }
    if (!fullVersion.test(version)) { admin.setError("Vollständige Upload-Version angeben, z. B. 16.20.123.456."); return; }
    if (!file || !/\.rofl$/i.test(file.name) || !file.size) { admin.setError("Bitte eine nicht leere .rofl-Datei auswählen."); return; }
    admin.perform(async ({ config }) => {
      await axios.put(replayUrl(`/${encodeURIComponent(id)}/file`), file, { ...config, timeout: 120000, headers: { ...config.headers, "Content-Type": "application/octet-stream", "X-Replay-Version": version } });
      return `${id} hochgeladen; Analyse kann noch ausstehen.`;
    });
  };
  const reserve = (event) => {
    event.preventDefault();
    const id = Number(gameId); const version = gameVersion.trim();
    if (!Number.isSafeInteger(id) || id <= 0 || !fullVersion.test(version)) { admin.setError("Positive Spiel-ID und vollständige Spielversion angeben."); return; }
    admin.perform(async ({ config }) => {
      const response = await axios.post(replayUrl("/reserve"), { gameId: id, gameVersion: version, sortBy }, config);
      if (typeof response.data?.item?.matchId !== "string") throw { invalidReplayResponse: true };
      return `${response.data.item.matchId} für Spiel ${id} reserviert. LoL wurde nicht gestartet.`;
    });
  };
  const items = (admin.data?.items || []).filter(item => !patch || item.patch === patch).slice().sort((a, b) => {
    const left = numberScore(a, sortBy), right = numberScore(b, sortBy);
    if (left === null) return right === null ? a.matchId.localeCompare(b.matchId) : 1;
    if (right === null) return -1;
    return right - left || a.matchId.localeCompare(b.matchId);
  });

  return (
    <main className="replays-page" lang="de">
      <header><a href="/">Zur Spiel-Erstellung</a><h1>Replay-Verwaltung</h1><p>Geschützter Server-Pool. Die lokalen Replay-Rankings werden ausschließlich im Companion-Terminal angezeigt und sortiert.</p></header>
      <CompanionSetup />
      {admin.error && <p role="alert" className="replay-error">{admin.error}</p>}
      {admin.notice && <p role="status">{admin.notice}</p>}
      {!admin.hasToken ? <form className="replay-panel" onSubmit={(event) => { event.preventDefault(); admin.unlock(credential); setCredential(""); }}>
        <h2>Verwaltung entsperren</h2><p>Replay-Token bleibt nur in dieser Browser-Sitzung, nie in Links. Kein öffentlicher Katalog.</p>
        <label htmlFor="replay-token">Replay-Token</label><input id="replay-token" type="password" value={credential} onChange={event => setCredential(event.target.value)} autoComplete="off" spellCheck={false} />
        <button type="submit">Entsperren</button>
      </form> : <div className="replay-actions"><button onClick={admin.lock}>Sperren</button><button onClick={admin.refresh} disabled={admin.loading || admin.busy}>Erneut laden</button></div>}
      {admin.loading && !admin.data && <p role="status">Lade geschützte Replay-Liste …</p>}
      {admin.hasToken && admin.data && <>
        <section className="replay-panel" aria-label="Bewertungshinweise">
          <h2>Pool und Bewertungen</h2>
          <p>Riot-Key: {admin.data.riotConfigured ? "konfiguriert, nicht validiert" : "nicht konfiguriert"}. Konfiguration bestätigt keine gültige Riot-Berechtigung. Ohne gültigen Key kann die Analyse fehlschlagen; Dateien bleiben gespeichert.</p>
          <p>Alle Scores sind getrennte Werte von 0–100. Balance hoch = ausgeglichene Teams. Carry hoch = konzentrierte Spieler-Kills, nicht Balance. Momentum bewertet Gold-Schwankungen und Führungswechsel. Gesamt kombiniert die serverseitige Bewertung; Gewichtung und Kontext stehen in den Metriken.</p>
          <div className="replay-fields">
            <label>Patch<select value={patch} onChange={event => setPatch(event.target.value)}><option value="">Alle Patches</option>{[...new Set(admin.data.items.map(item => item.patch))].sort().map(value => <option key={value} value={value}>{value}</option>)}</select></label>
            <label>Sortierung<select value={sortBy} onChange={event => setSortBy(event.target.value)}>{Object.entries(scoreKeys).map(([key, label]) => <option key={key} value={key}>{label} absteigend</option>)}</select></label>
          </div>
          <p>Fehlende Scores zuletzt; unbekannt ist nicht 0. Liste aktualisiert sich seriell etwa alle 5 Sekunden.{admin.loading ? " Aktualisierung läuft …" : ""}</p>
          {admin.error && <p>Letzter erfolgreicher Stand; aktuelle Anfrage fehlgeschlagen.</p>}
        </section>
        <form className="replay-panel" onSubmit={upload} noValidate>
          <h2>Replay manuell hochladen</h2>
          <div className="replay-fields">
            <label>Match-ID<input value={matchId} onChange={event => setMatchId(event.target.value)} placeholder="EUW1_123" /></label>
            <label>Upload-Version<input value={uploadVersion} onChange={event => setUploadVersion(event.target.value)} placeholder="16.20.123.456" /></label>
            <label>Replay-Datei (.rofl)<input type="file" accept=".rofl" onChange={event => setFile(event.target.files?.[0] || null)} /></label>
          </div><button disabled={admin.busy} type="submit">Hochladen</button>
        </form>
        <form className="replay-panel" onSubmit={reserve} noValidate>
          <h2>Replay reservieren</h2>
          <p>Bestehende Spiel-ID verwenden oder manuell angeben. Es wird kein Spiel erstellt. Die Reservierung wählt einen passenden analysierten Replay der Spielversion nach obiger Sortierung; sie startet weder LoL noch eine Wiedergabe. Wiedergabe nur lokal im Companion starten. Freigeben macht einen Replay wieder verfügbar.</p>
          <div className="replay-fields"><label>Spiel-ID<input type="number" min="1" step="1" value={gameId} onChange={event => setGameId(event.target.value)} /></label><label>Spielversion<input value={gameVersion} onChange={event => setGameVersion(event.target.value)} placeholder="16.20.123.456" /></label></div>
          <button type="submit" disabled={admin.busy}>Reservieren</button>
        </form>
        <section aria-label="Replay-Liste" aria-busy={admin.busy}>
          <h2>Gespeicherte Replays</h2>
          {items.length === 0 && <p>{admin.data.items.length === 0 ? "Keine Replays vorhanden." : "Keine Replays für diesen Patch."}</p>}
          {items.map(item => <ReplayCard key={item.matchId} item={item} busy={admin.busy} perform={admin.perform} />)}
        </section>
      </>}
    </main>
  );
}
