export default function CompanionSetup() {
  return (
    <section className="replay-panel" aria-labelledby="companion-heading" id="companion-setup">
      <h2 id="companion-heading">Companion einrichten</h2>
      <ol>
        <li><a href="/downloads/bronze-brawl-companion.zip" download>Companion-Quellcode herunterladen (.zip)</a>, entpacken und die enthaltene README befolgen. Python 3.11 oder neuer ist erforderlich; dies ist kein fertiges Windows-Programm.</li>
        <li><code>start.cmd</code> auf dem LoL-PC öffnen. Der Companion läuft im Terminal, nicht im Browser.</li>
        <li><code>r</code> holt fremde Summoner’s-Rift-Replays des aktuellen Patches; Version und Match-Daten kommen automatisch aus LoL. Der lokale Live-Feed läuft sofort mit, ohne Spiel-ID oder Token-Eingabe. <code>q</code> beendet die App.</li>
      </ol>
      <p>Die Haupt-App holt den lokalen Live-Feed automatisch ab. Kein zusätzliches Verbinden im Companion und kein Pool-Token für lokale Replays nötig.</p>
      <p>Gefundene Matches werden beim Companion-Start und nach dem Holen automatisch bewertet. Anzeige und Sortierung der Rankings erfolgen ausschließlich im Terminal: <code>l</code> zeigt die Liste, <code>s momentum</code> sortiert beispielsweise nach Momentum. Kein Server-Upload nötig.</p>
      <p>Replay-Quelle: die öffentliche Challenger-Solo/Duo-Rangliste deiner LoL-Region. Geprüft werden die letzten 20 Spiele von bis zu fünf fremden Konten — nur Summoner’s Rift (Karte 11), aktueller Patch, keine eigenen Spiele. Einzelne Downloads können im Client nicht mehr verfügbar sein.</p>
    </section>
  );
}
