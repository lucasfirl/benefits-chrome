# CB Deal Finder – Installation

Diese Erweiterung zeigt dir beim Surfen an, ob es für die Seite, auf der du
gerade bist, ein Angebot in unserem Mitarbeiterportal gibt.

**Sie fragt dich nie nach deinem Passwort.** Sie nutzt die Anmeldung, die du
ohnehin schon im Browser hast, und ruft damit die ganz normale Suchfunktion
des Portals auf. Es werden keinerlei Daten an Dritte gesendet – nur Anfragen
an das Portal selbst.

## Installation (ca. 2 Minuten)

1. Die ZIP-Datei in einen Ordner entpacken, in dem sie **dauerhaft liegen
   bleiben kann** (z. B. `C:\Tools\cb-deal-finder`). Wird der Ordner später
   gelöscht oder verschoben, funktioniert die Erweiterung nicht mehr.
2. In Chrome `chrome://extensions` öffnen.
3. Oben rechts **Entwicklermodus** einschalten.
4. Auf **Entpackte Erweiterung laden** klicken und den entpackten Ordner
   auswählen (den Ordner, in dem `manifest.json` liegt).
5. Auf das Puzzle-Symbol in der Toolbar klicken und die Erweiterung
   anpinnen, damit du sie immer siehst.

## Einrichtung

1. Rechtsklick auf das Symbol der Erweiterung → **Optionen**
   (oder Symbol anklicken → Zahnrad).
2. Die Portal-Adresse steht normalerweise schon da. Falls nicht:

   ```
   https://other-tenant.mitarbeiterangebote.de
   ```

3. Auf **Speichern & Zugriff erlauben** klicken und die Nachfrage von Chrome
   bestätigen. Damit erlaubst du der Erweiterung den Zugriff **nur** auf
   diese eine Portal-Adresse.
4. Sicherstellen, dass du in einem normalen Tab im Portal angemeldet bist.

### Optional: automatisch statt auf Klick

Standardmäßig prüft die Erweiterung eine Seite erst, wenn du auf das Symbol
klickst. Wenn sie von allein prüfen soll:

- In den Optionen **Automatisches Scannen aktivieren**. Chrome fragt dann
  nach einer weitergehenden Berechtigung – die ist nötig, weil die
  Erweiterung sonst ohne deinen Klick den Seitentitel nicht lesen darf.
  Gelesen wird ausschließlich der Seitentitel, sonst nichts vom Seiteninhalt.
- Darunter lässt sich einstellen, wie auffällig ein Treffer gemeldet wird:
  nur die Zahl am Symbol, eine Desktop-Benachrichtigung, oder der Versuch,
  das Popup automatisch zu öffnen.

## Benutzung

- **Zahl am Symbol** = so viele passende Angebote gibt es für diese Seite.
- **Klick auf das Symbol** = Liste der Treffer, ein Klick führt direkt zum
  Angebot im Portal.
- Im Popup unten kannst du außerdem jede beliebige Marke direkt suchen,
  egal auf welcher Seite du gerade bist.

## Wenn etwas nicht geht

| Meldung | Lösung |
|---|---|
| „Du bist nicht bei deinem CB-Portal angemeldet" | Im Portal einloggen, dann Popup erneut öffnen |
| Keine Zahl am Symbol | Seite einmal neu laden (F5) |
| Gar nichts passiert | `chrome://extensions` → bei der Erweiterung auf das Neu-laden-Symbol klicken |

## Bitte beachten

Die Angebote und Rabattcodes im Portal sind laut Nutzungsbedingungen
**vertraulich** und nur für berechtigte Mitarbeiter bestimmt. Diese
Erweiterung ändert daran nichts – bitte keine Screenshots von Angeboten oder
Codes öffentlich posten und die Codes nicht nach außen weitergeben.

**Die Erweiterung ist ein privates, inoffizielles Hilfsmittel.** Sie steht in
keiner Verbindung zur corporate benefits Germany GmbH und wird von dieser
weder betrieben noch unterstützt oder geprüft. Alle Marken- und Produktnamen
gehören ihren jeweiligen Inhabern.

Der Angebotskatalog wird bewusst nur einmal pro Woche geladen und danach
ausschließlich lokal im Browser abgeglichen – ausdrücklich, um die Server von
corporate benefits so wenig wie möglich zu belasten. Statt bei jedem
Seitenaufruf eine Suchanfrage zu stellen, fallen nur wenige Anfragen pro Woche
an.

Die angezeigten Rabatte stammen aus einem lokalen Zwischenspeicher und können
veraltet sein — verbindlich ist immer nur die Angebotsseite im Portal selbst.
Nutzung auf eigene Verantwortung, ohne Gewähr.
