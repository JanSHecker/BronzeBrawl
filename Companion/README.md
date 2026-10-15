# BronzeBrawl Companion

Eine kleine **Terminal-App**: Replays holen und den lokalen Livegame-Feed
bereitstellen. Keine Weboberfläche, kein Spiel verbinden, keine Token-Eingabe.

## Starten

`start.cmd` doppelt anklicken. Python **3.11 oder neuer** genügt; keine zusätzlichen
Pakete. Alternativ im Companion-Ordner: `python companion.py`.

```text
BronzeBrawl Companion
Live-Feed bereit: http://127.0.0.1:3002/lol-data
r = Replays holen | l = Rankings anzeigen | s = Sortierung | q = Beenden
Sortieren: s kills | s gold | s carry | s momentum (optional: auf/ab)
```

- **`r`** sucht **fremde Summoner’s-Rift-Replays (Karte 11)** über die öffentliche
  Challenger-Solo/Duo-Rangliste deiner LoL-Region, nicht über deinen Verlauf.
  Pro Durchlauf werden die letzten 20 Spiele von bis zu fünf fremden Konten
  geprüft. Andere Karten, alte Patches, doppelte Matches und Matches mit deiner
  PUUID werden ausgeschlossen. Es gibt keine zusätzliche Drei-Download-Grenze.
  Version und Match-Daten kommen automatisch aus dem geöffneten League Client;
  ein zusätzlicher Riot-Key ist nicht nötig. Die Originaldateien
  bleiben im League-Replay-Ordner. Kein Pool-Token, Upload oder Reservieren.
  Die Suche ist kein vollständiger globaler Katalog; der Client kann einzelne
  Replays wegen Ablauf oder fehlender Download-Berechtigung ablehnen. Es gibt
  keinen Rückfall auf deine eigenen Spiele.
- **Live-Feed:** Läuft automatisch ab dem Start. `GET /lol-data` liefert echte
  LoL-Liveclient-Daten; `GET /health` meldet die Verfügbarkeit des Companions.
  Die Haupt-App holt den Feed automatisch ab, sobald dort ein Host-Spiel besteht.
  Es gibt keine Spiel-ID, Paarung und keinen Startknopf im Companion.
- **`q`** oder **Strg+C** beendet die App und den lokalen Feed.

## Replay-Rankings

Beim Start werden die gefundenen fremden Matches bewertet, nach `r` erneut.
Bewertung und Download sind getrennt: Die sortierte Liste erscheint bereits vor
dem Download **ausschließlich im Terminal**, ohne Token-Eingabe oder Upload.
Gespeicherte Rankings werden direkt beim Start angezeigt, danach im Hintergrund
aktualisiert. **`l`** zeigt die Liste erneut, ohne neue Downloads oder Analyse.

Sortierung direkt im Terminal (standardmäßig absteigend):

```text
s kills
s gold
s carry
s momentum
s gold auf
```

**`s`** alleine fragt die gewünschte Sortierung ab. `auf` / `ab` wählt die
Richtung; fehlende Scores bleiben immer am Ende und werden nie als 0 behandelt.
Die Auswahl bleibt auch nach einer Hintergrundaktualisierung oder `r` erhalten.
Alle Sortierbefehle und ein Beispiel stehen direkt unter jeder Rangliste.
Der League Client muss geöffnet sein. Karte 11, aktueller Patch und fremde
Spieler werden vor der Bewertung erneut geprüft; unvollständige oder eigene
Matches werden ausgeschlossen. Die Datei-Spalte zeigt, was bereits lokal liegt;
beim Abgleich werden maximal 500 Dateien im League-Replay-Ordner geprüft.

**Kills und Gold sind getrennte Verhältnisse**, keine gemischte Balance oder
Gesamtbewertung mehr. Beide zeigen **kleinerer Teamwert / größerer Teamwert**:

```text
Kills: 20 / 30 = 0,67
Gold:  43000 / 50000 = 0,86
```

Kills verwendet die aufsummierten Spieler-Kills je Team; Gold die Summe
`goldEarned` je Team **am Spielende**, nicht Gold im Inventar oder den Mittelwert
der Timeline. `1,00` heißt gleich viel, `0,50` halb so viel. `0 / 0` bleibt
**nicht verfügbar**. Absteigend sortiert stehen die ähnlichsten Teamwerte oben;
aufsteigend die ungleichsten. Sortiert wird mit dem ungerundeten Quotienten.
Standard ist `s kills`; es erfolgt keine Normalisierung gegenüber anderen Matches.

**Carry und Momentum** bleiben Werte von 0–100 nach Backend-Formel v1.
Carry misst Kill-Konzentration und Spieler-Dominanz, nicht Ausgeglichenheit.
Momentum verwendet echte Gold-Timelines mit 1000-Gold-Deadband für Führungswechsel.
Ohne gültige Timeline bleibt Momentum **nicht verfügbar**; die beiden Endstand-
Verhältnisse bleiben davon unabhängig. Keine Nullen als Ersatz für fehlende
Daten und keine ROFL-Ereignisrekonstruktion. Das lokale Schema v2 in `ranking.py`
ersetzt den alten v1-Cache durch neu berechnete Metriken. Der separate geschützte
Server-Pool bleibt unverändert.

Bewertungen bleiben lokal in `%LOCALAPPDATA%\BronzeBrawl\companion\rankings.json`.
Vollständige Bewertungen werden wiederverwendet; bei anderem Konto oder Patch
wird neu geprüft. Spieler-PUUIDs und Zugangsdaten werden nicht in der Rangliste
gespeichert oder angezeigt. Es gibt keine Ranking-Weboberfläche oder Ranking-
HTTP-API; der lokale HTTP-Endpunkt bleibt ausschließlich für den Live-Feed.

Ohne laufendes LoL-Spiel liefert `/lol-data` HTTP 503. Sobald echte Daten
verfügbar sind, liefert derselbe Endpunkt wieder HTTP 200, ohne Neuverbinden.
Der Companion rekonstruiert und erfindet keine Replay-Ereignisse.

Der Feed ist nur auf `127.0.0.1` erreichbar. Die öffentliche BronzeBrawl-Seite
darf ihn lesen; fremde Websites nicht. Es gibt keine Management- oder Schreib-
API im Terminal-Modus. Backend-Spielberechtigungen bleiben Sache der Website,
nicht des Companions. LoL-Zugangsdaten verlassen den lokalen Client nicht.

Normalerweise wird alles automatisch gefunden. Nur falls nötig:

```powershell
python companion.py --league-dir "D:\Riot Games\League of Legends"
```

## Entwicklung

```powershell
python -m unittest discover -s tests -v
```

Tests verwenden Fake-Transporte und strukturelle Dateien, keine echten Match-
Aufzeichnungen. Alte Verwaltungs-Schnittstellen sind nur noch mit dem expliziten
Kompatibilitätsmodus `--web --no-browser` verfügbar, nicht beim normalen Start.
