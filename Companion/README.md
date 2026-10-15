# Bronze Brawl Companion

Lokale Windows-Begleitanwendung für Bronze Brawl. Sie liest Daten vom League Client, verwaltet lokale `.rofl`-Dateien und kann den Game-Feed direkt an den Bronze-Brawl-Server senden.

## Voraussetzungen

- Windows-PC mit installiertem League of Legends Client
- Python **3.11 oder neuer**
- League Client muss für lokale Discovery/Downloads geöffnet und eingeloggt sein
- Für Serverzugriff: gültiges Bronze-Brawl-Replay-Token
- Für Direkt-Feed: Bronze-Brawl-Spiel-ID und das zugehörige Host-Spiel-Token

Der Companion benötigt keine Python-Pakete von Drittanbietern.

## Start

1. ZIP vollständig entpacken.
2. `start.cmd` doppelt anklicken oder in einer Eingabeaufforderung ausführen.
3. Die lokale Verwaltung öffnet sich unter `http://127.0.0.1:3002`.
4. Backend-URL, Replay-Pool-Token und optional Spiel-ID/Host-Token eingeben.

Alternativ:

```powershell
py -3.11 companion.py
```

`--no-browser` verhindert das automatische Öffnen eines Browserfensters.

## Sicherheitsmodell

- Der lokale HTTP-Server bindet ausschließlich an `127.0.0.1`.
- Replay-Pool-Token und Host-Spiel-Token werden nur im Prozessspeicher gehalten und nach Neustart erneut abgefragt.
- LoL-Lockfile-Zugangsdaten werden ausschließlich für feste HTTPS-Loopback-Anfragen zum lokalen League Client verwendet.
- Keine Tokens werden in URLs, Statusantworten oder Logs ausgegeben.
- Server-TLS wird validiert; die Zertifikatsausnahme gilt nur für den lokalen LoL-Client.
- Der Direkt-Feed und das Browser-Relay dürfen nicht gleichzeitig laufen.

## Replay-Beschaffung

Die Discovery ist absichtlich begrenzt:

- letzte 20 Spiele des aktuell lokal eingeloggten Kontos
- nur der aktuelle Client-Patch
- maximal drei Downloads pro Refill-Durchlauf
- echter Downloadabschluss wird abgewartet und anschließend validiert

Der Companion nutzt die lokale League-Client-Schnittstelle. Das ist kein unabhängiger serverseitiger Replay-Provider. Wenn der League Client geschlossen ist, kann der Pool weiterhin verwendet werden, aber der lokale Refill kann nicht laufen.

## Format- und Wiedergabegrenzen

- Der aktuelle Stand unterstützt und validiert nur den historischen `RIOT/ROFL1`-Container.
- `ROFL2/RLR` wird ausdrücklich abgelehnt, nicht stillschweigend als gültig behandelt.
- Eine erfolgreich gestartete Wiedergabe beweist nicht, dass `liveclientdata` auch Replay-Ereignisse liefert.
- Es werden keine Events erfunden oder aus einer Replay-Datei rekonstruiert.
- Wiedergabe benötigt denselben bzw. einen kompatiblen League-Client-Patch.

## Server-Workflow

1. Replay im lokalen Client entdecken oder aus dem Client-Replayordner importieren.
2. Datei lokal prüfen und im Cache speichern.
3. Datei mit dem separaten Replay-Pool-Token zum Backend hochladen.
4. Server analysiert Datei und Match-Daten; Scores werden niemals vom Companion geliefert.
5. Für ein Spiel ein vorbereitetes Replay reservieren und wieder in den lokalen Cache laden.
6. Wiedergabe über die lokale League-Client-API anfordern.

## Entwicklung und Tests

```powershell
py -3.11 -m unittest discover -s tests -v
```

Die Tests verwenden ausschließlich strukturelle Fixture-Dateien und Fake-Transporte. Ein grüner Testlauf beweist daher nicht die Funktion eines echten Windows-LoL-Clients.

## Noch nicht enthalten

- keine signierte Windows-EXE
- kein automatisch installierter Windows-Service
- keine ROFL2/RLR-Unterstützung
- kein Beweis, dass Replay-Wiedergabe auf jedem Client `liveclientdata` bereitstellt
