# 📊 LSS Statistik-Dashboard

Ein kostenloses, inoffizielles Tampermonkey-Script für das Browserspiel [Leitstellenspiel.de](https://www.leitstellenspiel.de/).

Das Script ermöglicht eine umfangreiche statistische Auswertung der eigenen Gebäude, Fahrzeuge und Erweiterungen. Es wurde insbesondere für Spieler mit sehr großen Accounts entwickelt, bei denen herkömmliche Statistik-Dashboards aufgrund der hohen Datenmengen möglicherweise nicht mehr zuverlässig funktionieren.

Das Dashboard ist ein privates Projekt, das mithilfe künstlicher Intelligenz (OpenAI ChatGPT) nach meinen persönlichen Anforderungen und Vorgaben erstellt wurde.

<img width="2403" height="1228" alt="Screenshot 2026-11-20 174151" src="https://github.com/user-attachments/assets/3bc203b0-31c8-4578-b12a-63e0f6334578" />


## ✨ Funktionen

### 🏢 Gebäudeübersicht
- Gesamtanzahl aller Gebäude
- Aufschlüsselung nach Organisation und Gebäudetyp
- Zusammenfassung normaler und kleiner Feuer-, Rettungs- und Polizeiwachen
- Aufklappbare Unterteilung in normale Wachen und Kleinwachen
- Interaktive Kreisdiagramme für Feuerwehr, Rettungsdienst, Polizei und THW
- Umschaltung zwischen absoluten und relativen Werten

<img width="2404" height="1226" alt="Screenshot 2026-11-20 175124" src="https://github.com/user-attachments/assets/3d406afb-bf73-423b-a058-750d4ea8716d" />

### 🚒 Fahrzeugübersicht
- Gesamtanzahl aller Fahrzeuge
- Aufschlüsselung nach Fahrzeugtypen
- Interaktive Kreisdiagramme
- Anklickbare Fahrzeugtypen mit detaillierter Fahrzeugliste
- Anzeige des FMS-Status zum Zeitpunkt der Datenerfassung
- Anzeige der zugehörigen Wache
- Direktlinks zu Fahrzeugen und Gebäuden

<img width="2405" height="1233" alt="Screenshot 2026-11-20 175212" src="https://github.com/user-attachments/assets/b77e09c9-3f39-4e35-8e2a-8296897b553b" />
<img width="2403" height="1231" alt="Screenshot 2026-11-20 175230" src="https://github.com/user-attachments/assets/b4fe9791-5355-4690-8525-a431a4e37da8" />

### 🛠️ Erweiterungsstatistik
- Auflistung gekaufter Erweiterungen
- Gruppierung nach Organisation, Gebäudetyp und Erweiterungsart
- Gegenüberstellung **Aktiviert / Gekauft**
- Bereits gekaufte Erweiterungen im Bau werden mitgezählt
- Anklickbare Erweiterungen mit einer Liste der betreffenden Wachen
- Anzeige des jeweiligen Erweiterungsstatus
- Filterung nach Leitstellenbereichen

<img width="2403" height="1229" alt="Screenshot 2026-11-20 175408" src="https://github.com/user-attachments/assets/773ba51d-15dc-4eac-be8d-ef10026b6fca" />
<img width="2413" height="1232" alt="Screenshot 2026-11-20 175418" src="https://github.com/user-attachments/assets/6ab09879-89b1-45fc-a203-86bdb577cbdf" />

### 📍 Weitere Funktionen
- Auswertung einzelner Wachen und ihrer Fahrzeugbestände
- Statistiken nach Leitstellenbereichen
- Suchfunktion für die Tabellen
- Seitenweise Darstellung großer Datenmengen
- CSV-Export zur weiteren Verarbeitung, beispielsweise in Excel
- Manuelles Aktualisieren der Statistiken
- Automatische Anpassung an das im Leitstellenspiel gewählte Hell- oder Dunkeldesign
- Rote Akzente in Anlehnung an das Leitstellenspiel

<img width="2402" height="1232" alt="Screenshot 2026-11-20 175534" src="https://github.com/user-attachments/assets/d3a2e4bc-d6c9-495d-b4d0-4a534bb49676" />
<img width="2404" height="1228" alt="Screenshot 2026-11-20 175548" src="https://github.com/user-attachments/assets/0f9fc7b2-4f05-4bd0-9a01-d7f1d1afb197" />

## 📥 Installation

**Voraussetzung:** Ein Browser mit installierter Userscript-Erweiterung, beispielsweise [Tampermonkey](https://www.tampermonkey.net/).

1. Installiere Tampermonkey, falls noch nicht vorhanden.
2. Öffne die [Scriptdatei auf GitHub](https://github.com/cpu99/Leitstellenspiel/blob/main/LSS-Statistik-Dashboard.user.js).
3. Klicke auf **Raw**, um die unveränderte Scriptdatei aufzurufen.
4. Bestätige die Installation in Tampermonkey, sofern der Installationsdialog erscheint.
5. Öffne das Leitstellenspiel und lade die Seite neu.

Unten links erscheint anschließend der Button **📊 Statistik**, über den das Dashboard geöffnet werden kann.

Alternativ kann der vollständige Script-Code manuell in ein neues Tampermonkey-Script kopiert werden.

## ⚙️ Konfiguration

Einige Einstellungen lassen sich direkt am Anfang des Scripts verändern:

```javascript
const MIN_CHART_COUNT = 10;
const PAGE_LIMIT = 4000;
const PAGE_ROWS = 100;
```

| Einstellung | Beschreibung |
|---|---|
| `MIN_CHART_COUNT` | Mindestanzahl für die separate Darstellung eines Typs im Kreisdiagramm. Kleinere Kategorien werden unter „Sonstige“ zusammengefasst. |
| `PAGE_LIMIT` | Anzahl der Datensätze, die maximal pro API-Anfrage abgerufen werden. |
| `PAGE_ROWS` | Anzahl der angezeigten Tabellenzeilen pro Seite. |

Die Standardeinstellungen sind auf die Verarbeitung größerer Fahrzeug- und Gebäudebestände ausgelegt.

## 📊 Daten und Aktualisierung

Das Script verwendet Schnittstellen des Leitstellenspiels zur Erfassung der Gebäude-, Fahrzeug- und Erweiterungsdaten.

Zur Zuordnung der Gebäude- und Fahrzeugtypen werden zusätzlich Metadaten des LSS-Managers verwendet.

Die Daten werden beim Anklicken von **„Daten laden / aktualisieren“** neu abgerufen.

Die angezeigten Werte stellen daher eine Momentaufnahme dar. Änderungen im Spiel, beispielsweise Fahrzeugstatus oder neu gekaufte Gebäude, werden erst nach einer erneuten Aktualisierung berücksichtigt.

Das Script verändert keine Fahrzeuge, Gebäude oder Erweiterungen im Spiel.

## ⚠️ Bekannte Einschränkungen

- Die Vollständigkeit und Richtigkeit sämtlicher Auswertungen kann nicht garantiert werden.
- Änderungen an den APIs des Leitstellenspiels können die Funktionsfähigkeit beeinträchtigen.
- Die Zuordnung zu Organisationen erfolgt anhand der Gebäudetypen und kann bei bestimmten Sondergebäuden abweichen.
- Die Fahrzeugstatuswerte werden nicht live aktualisiert.
- Die Statistik unterscheidet bei Erweiterungen zwischen gekauften und aktivierten Erweiterungen. Noch im Bau befindliche Erweiterungen zählen bereits als gekauft.
- Bei sehr großen Accounts kann die vollständige Datenerfassung abhängig von Serverauslastung, Verbindung und Geräteleistung einige Zeit beanspruchen.
- Eine vollständige Kompatibilität mit anderen Userscripts kann nicht gewährleistet werden.

## 🤖 Entwicklung mit künstlicher Intelligenz

Dieses Script wurde mithilfe von **OpenAI ChatGPT** entwickelt.

Die Funktionen, Anforderungen und gewünschten Anpassungen wurden von mir beschrieben. Die eigentliche Programmierung erfolgte überwiegend durch die KI.

Mein eigener Beitrag besteht insbesondere aus der Formulierung der Anforderungen und Prompts, dem Testen der Funktionen, der Rückmeldung zu Fehlern sowie kleineren manuellen Anpassungen.

Ich verfüge nicht über eine umfassende Ausbildung in JavaScript-Entwicklung. Daher können trotz durchgeführter Tests Fehler oder technische Schwachstellen vorhanden sein.

Das Projekt wird privat und ohne kommerzielle Absichten betrieben.

## ⚖️ Haftungsausschluss

**1. Erstellung und Verantwortung**

Dieses Script wurde mithilfe künstlicher Intelligenz (OpenAI ChatGPT) auf Grundlage meiner persönlichen Anforderungen, Ideen und Vorgaben erstellt und weiterentwickelt. Mein eigener Beitrag beschränkt sich im Wesentlichen auf die Formulierung der Anforderungen und Prompts sowie auf Tests, Rückmeldungen und kleinere Anpassungen.

Es handelt sich um ein privates, inoffizielles Projekt ohne kommerzielle Absichten.

**2. Gewährleistung und Funktionsfähigkeit**

Das Script wird in seinem jeweils aktuellen Entwicklungsstand und ohne Zusicherung bestimmter Eigenschaften zur Verfügung gestellt.

Es wird keine Gewähr für die Richtigkeit, Vollständigkeit, Aktualität, Zuverlässigkeit, Verfügbarkeit oder Funktionsfähigkeit des Scripts und der dargestellten Informationen übernommen.

Insbesondere kann nicht garantiert werden, dass:

- sämtliche Gebäude, Fahrzeuge und Erweiterungen vollständig und korrekt erfasst werden,
- die angezeigten Statistiken jederzeit den tatsächlichen Spieldaten entsprechen,
- die Zuordnung von Gebäuden, Fahrzeugen und Erweiterungen fehlerfrei erfolgt,
- das Script mit sämtlichen Spielversionen, Browsern und anderen Userscripts kompatibel ist,
- das Script dauerhaft und ohne Unterbrechungen funktioniert.

Fehlerhafte Berechnungen, unvollständige Daten, technische Störungen und unerwartetes Verhalten können nicht ausgeschlossen werden.

**3. Nutzung auf eigene Verantwortung**

Die Verwendung des Scripts erfolgt freiwillig und auf eigenes Risiko.

Vor einer Verwendung wird empfohlen, das Script eigenständig zu überprüfen und wichtige Angaben gegebenenfalls direkt im Spiel zu kontrollieren.

Soweit gesetzlich zulässig, wird eine Haftung für Schäden oder Nachteile ausgeschlossen, die durch die Verwendung oder Nichtverfügbarkeit des Scripts entstehen. Gesetzlich zwingende Haftungsansprüche bleiben unberührt.

**4. Änderungen am Leitstellenspiel**

Das Script greift auf Daten und Schnittstellen des Leitstellenspiels sowie gegebenenfalls auf externe Metadaten zurück.

Änderungen an diesen Schnittstellen, den Datenstrukturen oder der Website können jederzeit dazu führen, dass einzelne Funktionen eingeschränkt werden oder das Script nicht mehr funktioniert.

Ein Anspruch auf Fehlerbehebung, Aktualisierung, Weiterentwicklung oder technischen Support besteht nicht.

**5. Unabhängigkeit von den Spieleentwicklern**

Dieses Script ist ein inoffizielles Fanprojekt und steht in keiner offiziellen Verbindung zu den Betreibern oder Entwicklern des Leitstellenspiels oder des LSS-Managers.

Es wird weder von diesen entwickelt noch offiziell unterstützt oder betreut.

**6. Datenschutz und externe Schnittstellen**

Das Script verarbeitet Spieldaten zur Erstellung statistischer Auswertungen. Hierzu werden Informationen über Gebäude, Fahrzeuge und Erweiterungen abgerufen.

Zusätzlich können externe Schnittstellen zur Ermittlung von Gebäude- und Fahrzeugbezeichnungen verwendet werden.

Eine dauerhafte Speicherung oder bewusste Übermittlung persönlicher Spieldaten an eigene Server ist in der vorgesehenen Funktionsweise nicht enthalten. Datenübertragungen an die jeweils angesprochenen Schnittstellen sind hiervon ausgenommen.

**7. Änderungen und Weitergabe**

Das Script kann jederzeit ohne vorherige Ankündigung verändert, erweitert oder eingestellt werden.

Bei einer Weitergabe sollte dieser Haftungsausschluss erhalten bleiben. Änderungen durch Dritte erfolgen in deren eigener Verantwortung.

**8. Abschließender Hinweis**

Dieses Script dient ausschließlich der vereinfachten Darstellung und statistischen Auswertung von Spieldaten.

Es erhebt keinen Anspruch auf Fehlerfreiheit oder Vollständigkeit und ersetzt keine Überprüfung der tatsächlichen Daten im Leitstellenspiel.

## 📜 Lizenz

Dieses Projekt ist unter der MIT-Lizenz veröffentlicht, sofern die entsprechende `LICENSE`-Datei im Repository hinterlegt ist und die erforderlichen Nutzungsrechte bestehen.

Weitere Informationen befinden sich in der Datei `LICENSE`.

---

**Entwickelt für die Community des Leitstellenspiels.** 🚒🚑🚓
