export default function CompanionSetup() {
  return (
    <section className="replay-panel" aria-labelledby="companion-heading" id="companion-setup">
      <h2 id="companion-heading">Companion einrichten</h2>
      <ol>
        <li><a href="/downloads/bronze-brawl-companion.zip" download>Companion-Quellcode herunterladen (.zip)</a>, entpacken und die enthaltene README befolgen. Python 3.11 oder neuer ist erforderlich; dies ist kein fertiges Windows-Programm.</li>
        <li>Companion lokal auf dem LoL-PC starten. Dann <a href="http://localhost:3002" target="_blank" rel="noopener noreferrer">Lokale Verwaltung öffnen (localhost:3002)</a>. Der Link wird nur auf Klick geöffnet, es gibt hier keine automatische Verbindung.</li>
        <li>In der lokalen Verwaltung Server, Replay-Token und für den Live-Feed die bestehende Spiel-ID mit Host-Token einrichten. Host-Token und Replay-Token sind unterschiedliche Berechtigungen. Keine LoL-Anmeldedaten an den Server senden.</li>
      </ol>
      <p><strong>Ein Feed-Modus zur Zeit:</strong> Companion-Direktmodus sendet ohne Browser-Tab. Den <a href="/lolApi">Browser-Relay / LoL-Monitor</a> nur alternativ öffnen, nachdem der Direktmodus deaktiviert wurde. Nie beide gleichzeitig betreiben; hier wird kein Feed aktiviert.</p>
      <p>HTTPS-Seiten können localhost je nach Browser wegen Mixed Content, CORS oder lokalen Netzwerkberechtigungen blockieren. Die lokale Verwaltung deshalb unabhängig in einem eigenen Tab öffnen. Replay-Wiedergabe und Live-Daten hängen vom lokalen LoL-Client und der passenden Version ab; keine garantierte Datenverfügbarkeit.</p>
    </section>
  );
}
