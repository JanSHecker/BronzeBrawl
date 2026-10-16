# BronzeBrawl Companion

Eine kleine **Terminal-App**: Replays holen und LoL-Livedaten regelmäßig direkt
per HTTPS an BronzeBrawl senden. Keine Weboberfläche oder Browser-Netzwerkfreigabe.

## Starten

`start.cmd` doppelt anklicken. Python **3.11 oder neuer** genügt; keine zusätzlichen
Pakete. Alternativ im Companion-Ordner: `python companion.py`.

```text
BronzeBrawl Companion
Direkt-Feed: Companion → HTTPS → BronzeBrawl. Kein lokaler Webserver erforderlich.
v = App verbinden | t = Verbindungsstatus | r = Replays holen | l = Rankings anzeigen | s = Sortierung | q = Beenden
Sortieren: s kills | s gold | s carry | s momentum (optional: auf/ab)
```

## Einmal mit dem Spiel verbinden

1. In der BronzeBrawl-Web-App ein Spiel erstellen und **Companion verbinden** öffnen.
2. **Neuen Verbindungscode erstellen** anklicken und den Code kopieren.
3. Im Companion **`v`** eingeben und den vollständigen Code einfügen. Die Eingabe
   bleibt verborgen; mit Enter bestätigen.

Danach holt der Companion alle drei Sekunden echte Daten von LoL und sendet sie
selbst an den Server — auch wenn die Website geschlossen ist. Der Browser liest
nur den Verbindungsstatus vom Backend, nicht vom lokalen PC. Der Companion startet
im Terminal-Modus **keinen lokalen HTTP-Server**.

Beide Seiten zeigen getrennt an, ob die Verbindung besteht und ob LoL Daten
liefert. Ein Lebenszeichen wird auch ohne laufendes LoL-Spiel gesendet. Nach
15 Sekunden ohne Lebenszeichen zeigt die Website „nicht verbunden“. Bei einem
Netzwerkausfall versucht der Companion automatisch erneut; **`t`** zeigt den Status
und die Zahl gesendeter Snapshots. Statusänderungen erscheinen automatisch.

**HTTP 413 / „Live-Snapshot zu groß“:** Kein neuer Verbindungscode nötig.
Der Server akzeptiert bis zu **4 MiB** pro JSON-Anfrage einschließlich Spiel-ID.
Backend und vorgeschalteter Proxy müssen dieses Limit erlauben; bei dieser
Meldung die Server-Konfiguration prüfen lassen. Der Companion bleibt aktiv und
versucht den Versand mit frischen Daten automatisch erneut (bis zu 12 Sekunden
Abstand). Erfolgreiche Lebenszeichen bedeuten weiterhin „verbunden“, auch wenn
ein Snapshot abgelehnt wurde; die Zahl gesendeter Snapshots steigt dann nicht.

Die Verbindung wird in `%LOCALAPPDATA%\BronzeBrawl\companion\connection.json`
gespeichert und beim Neustart wieder aufgenommen. Die Datei enthält ausschließlich
den eingeschränkten Feed-Schlüssel, keinen Host- oder LoL-Token: nicht weitergeben.
**Companion-Zugriff widerrufen** in der Website oder ein neuer Verbindungscode
sperrt den alten Schlüssel sofort. Nach Widerruf muss ein neuer Code mit `v`
hinterlegt werden. Für ein neues BronzeBrawl-Spiel ebenfalls einen neuen Code
verwenden. Ein Spielwechsel oder Zurückspulen wird nicht als dasselbe Spiel
weitergesendet; der Verbindungsstatus meldet den Konflikt.

## Live-Daten für spätere Tests aufzeichnen

Jeder erfolgreiche Abruf der lokalen LoL-API wird automatisch als vollständige
JSON-Datei gespeichert — unabhängig davon, ob der Server die Daten annimmt.
Auch identische Snapshots bei pausierter Spielzeit, Spielwechsel und unvollständige
JSON-Antworten bleiben erhalten. Fehlgeschlagene Abrufe ohne JSON-Antwort erzeugen
keine Datei. Das gilt für den Direkt-Feed und den alten Browser-Relay-Modus.

Jeder Companion-Start erhält einen eigenen Ordner unter:

```text
%LOCALAPPDATA%\BronzeBrawl\companion\captures\<UTC-Startzeit>-<Zufallskennung>\
  run.json
  snapshot-00000001-<UTC-Abrufzeit>.json
  snapshot-00000002-<UTC-Abrufzeit>.json
```

Der Ordner wird erst beim ersten erfolgreichen Abruf angelegt. Neustarts erzeugen
neue Ordner; Stoppen/Starten des Feeds oder erneutes Verbinden innerhalb desselben
Companion-Laufs verwendet denselben Ordner. Ein Lauf kann daher mehrere Spiele
enthalten. Dateinamen sind nach Abrufreihenfolge nummeriert; `run.json` enthält
Startzeit und Quell-URL. Snapshots enthalten direkt das unveränderte JSON-Objekt
der API, ohne zusätzlichen Wrapper, und lassen sich später als Backend-`input`
verwenden. Es werden keine Ereignisse rekonstruiert oder synthetische Daten erzeugt.

Der Speicherort erscheint beim Terminal-Start. **`t`** zeigt zusätzlich die Zahl
lokal gespeicherter Snapshots. Schreibfehler werden separat gemeldet und beim
nächsten Abruf erneut versucht; der Versand läuft weiter. Dateien werden atomar
geschrieben, damit fertige JSON-Dateien nicht halb geschrieben sichtbar werden.

**Datenschutz und Speicherplatz:** Aufzeichnungen enthalten Spielernamen und alle
weiteren von der Live-API gelieferten Felder. Companion-Verbindungsschlüssel,
HTTP-Header und LoL-Client-Zugangsdaten werden nicht hinzugefügt. Vor Weitergabe
oder Aufnahme ins Repository prüfen und gegebenenfalls anonymisieren. Die Dateien
bleiben lokal, werden nicht automatisch hochgeladen oder gelöscht und können bei
langen Sitzungen viel Speicher beanspruchen. Nicht mehr benötigte Laufordner bei
beendetem Companion manuell entfernen.

## Lokale Befehle

- **`r`** sucht **fremde Summoner’s-Rift-Replays (Karte 11)** über die öffentliche
  Challenger-Solo/Duo-Rangliste deiner LoL-Region, nicht über deinen Verlauf.
  Pro Durchlauf werden **zufällig ausgewählte** fremde Konten geprüft, nicht
  immer die ersten fünf der Rangliste. Noch nicht geprüfte Spieler kommen zuerst;
  danach die am längsten nicht geprüften. Je Konto werden die letzten 20 Spiele
  geprüft, zunächst fünf Konten. Wenn dabei keine neuen Matches gefunden werden,
  folgen höchstens zwei weitere Fünfer-Batches (maximal 15 Konten pro Suche).
  Andere Karten, alte Patches, doppelte Matches und Matches mit deiner
  PUUID werden ausgeschlossen. Es gibt keine zusätzliche Drei-Download-Grenze.
  Version und Match-Daten kommen automatisch aus dem geöffneten League Client;
  ein zusätzlicher Riot-Key ist nicht nötig. Die Originaldateien
  bleiben im League-Replay-Ordner. Kein Pool-Token, Upload oder Reservieren.
  Die Suche ist kein vollständiger globaler Katalog; der Client kann einzelne
  Replays wegen Ablauf oder fehlender Download-Berechtigung ablehnen. Es gibt
  keinen Rückfall auf deine eigenen Spiele.
  Bereits gefundene Match-IDs werden **auch nach einem Neustart ausgeschlossen**.
  Bekannte Rankings aus der bisherigen Version werden beim Umstieg übernommen.
  Wenn der geprüfte Ausschnitt keine neuen Spiele enthält, wird das ausdrücklich
  gemeldet, statt alte Spiele zurückzugeben; die letzte Rangliste bleibt sichtbar.
  Die nächste Suche prüft andere bzw. länger nicht geprüfte Spieler. Das garantiert
  keine neuen Matches: Die Quelle bleibt die Challenger-Rangliste deiner Region.
- **Live-Feed:** Läuft nach dem einmaligen Verbinden automatisch im Hintergrund,
  unabhängig von Replay-Suche und Downloads. Keine Ereignisrekonstruktion.
- **`q`** oder **Strg+C** beendet die App und den Versand. Spätestens nach
  15 Sekunden erkennt die Website die unterbrochene Verbindung.

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
Gesamtbewertung mehr. Beide zeigen ausschließlich den Prozentwert aus
**kleinerer Teamwert / größerer Teamwert × 100 %**, ohne absolute Teamzahlen:

```text
Kills: 66,67 %
Gold:  86,00 %
```

Kills verwendet die aufsummierten Spieler-Kills je Team; Gold die Summe
`goldEarned` je Team **am Spielende**, nicht Gold im Inventar oder den Mittelwert
der Timeline. `100 %` heißt gleich viel, `50 %` halb so viel. `0 / 0` bleibt
**nicht verfügbar** (Anzeige `–`, nicht `0 %`). Absteigend sortiert stehen die ähnlichsten Teamwerte oben;
aufsteigend die ungleichsten. Sortiert wird mit dem ungerundeten Quotienten.
Standard ist `s kills`; es erfolgt keine Normalisierung gegenüber anderen Matches.

**Carry und Momentum** bleiben Werte von 0–100 nach Backend-Formel v1.
Carry misst Kill-Konzentration und Spieler-Dominanz, nicht Ausgeglichenheit.
Momentum verwendet echte Gold-Timelines mit 1000-Gold-Deadband für Führungswechsel.
Ohne gültige Timeline bleibt Momentum **nicht verfügbar**; die beiden Endstand-
Verhältnisse bleiben davon unabhängig. Keine Nullen als Ersatz für fehlende
Daten und keine ROFL-Ereignisrekonstruktion. Das lokale Schema v2 in `ranking.py`
ersetzt den alten v1-Cache durch neu berechnete Metriken. Der separate geschützte
Server-Pool wird von der deployten App nicht mehr eingebunden.

Bewertungen bleiben lokal in `%LOCALAPPDATA%\BronzeBrawl\companion\rankings.json`.
Der Wiederholungsschutz liegt daneben in `discovery.json`: pro Patch maximal
50.000 gefundene Match-IDs und 2.000 zuletzt geprüfte Spieler-Hashes, keine
Spielernamen, PUUIDs oder Zugangsdaten. Bei einem neuen Patch beginnt die Auswahl
neu; zufällige Reihenfolge und Wiederholungsschutz gelten auch für die Startsuche.
Vollständige Bewertungen werden wiederverwendet; bei anderem Konto oder Patch
wird neu geprüft. Spieler-PUUIDs und Zugangsdaten werden nicht in der Rangliste
gespeichert oder angezeigt. Es gibt keine Ranking-Weboberfläche oder Ranking-
HTTP-API. Replays und Rankings bleiben ausschließlich im Companion.

Ohne laufendes LoL-Spiel wird „warte auf LoL-Livedaten“ gemeldet. Sobald echte
Daten verfügbar sind, beginnt der Versand automatisch, ohne Neuverbinden.
Der Companion rekonstruiert und erfindet keine Replay-Ereignisse.

Der Companion liest ausschließlich die feste lokale LoL-API auf `127.0.0.1:2999`.
Nur diese lokale TLS-Verbindung erlaubt LoLs selbstsigniertes Zertifikat;
die öffentliche Verbindung prüft HTTPS-Zertifikate und folgt keinen Redirects.
LoL-Zugangsdaten verlassen den lokalen Client nicht. Der Feed-Schlüssel erlaubt
weder Spielverwaltung noch Spieleraktionen oder den Zugriff auf andere Spiele.

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
