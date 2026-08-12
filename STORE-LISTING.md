# Chrome Web Store — Einreichungsunterlagen

Fertige Texte zum Kopieren. **Vor dem Einreichen die drei Punkte unter
"Vorher entscheiden" klären.**

---

## Vorher entscheiden

### 1. Neutral bauen — nicht der Firmen-Build

```powershell
.\package.ps1          # OHNE -DefaultPortal
```

Mit `-DefaultPortal` steht dein Arbeitgeber im Code und wäre öffentlich
identifizierbar. Der neutrale Build ist verifiziert frei davon.

### 2. Name und Icon

„CB Deal Finder" ist nah an der Marke *corporate benefits*. Die Store-Policy
verbietet, Zugehörigkeit zu einem fremden Anbieter zu suggerieren, und
markenrechtlich ist es angreifbar. Empfehlung: neutral umbenennen, z. B.

- **Benefit Spotter**
- **Perk Finder**
- **Mitarbeitervorteile-Finder**

Der Name steckt in `_locales/*/messages.json` unter `appName` — an einer
Stelle änderbar.

### 3. Screenshots — die wichtigste Falle

Die Nutzungsbedingungen des Portals stellen Angebote und Konditionen
ausdrücklich unter Vertraulichkeit und nennen **Screenshots namentlich**
(500 € Vertragsstrafe pro Verstoß). Ein Store-Screenshot mit echten Rabatten
wäre eine öffentliche Wiedergabe.

→ **Screenshots ausschließlich mit erfundenen Marken und Prozentsätzen.**
Auch bei „nicht gelistet" ist die Seite für jeden mit Link sichtbar.

---

## Store-Eintrag

### Single purpose (Pflichtfeld)

> Show the user which offers from their own employee-benefits portal apply to
> the website they are currently viewing.

### Kurzbeschreibung (max. 132 Zeichen)

> Shows you when the site you're on has an offer in your employee benefits
> portal. Unofficial, works with your own account.

### Ausführliche Beschreibung

```
Browsing a shop and wondering whether your employer's benefits portal has a
discount for it? This extension checks for you.

HOW IT WORKS
• You enter your employer's benefits portal address once.
• The extension uses the login session you already have with that portal —
  it never asks for or stores a password.
• When you visit a site, it matches the brand against your portal's offers
  and shows a badge if there is one. One click takes you to the offer.

BUILT TO BE GENTLE ON THE PORTAL
Rather than querying the portal on every page you visit, the extension
downloads the offer catalogue once a week — staggered, not in a burst — and
matches everything locally in your browser afterwards. That reduces requests
by orders of magnitude compared with a naive implementation.

PRIVACY
• No analytics, no tracking, no third-party servers, no remote code.
• Requests go only to the portal you approve.
• Only the page title and og:site_name of a page are read — never page
  content, form fields, or cookies.
• Everything is stored locally in your browser.

REQUIREMENTS
You need an existing, valid account on an employee-benefits portal and must
be logged in to it in this browser. The extension does not create accounts
and cannot grant access to offers you are not already entitled to.

DISCLAIMER
This is a private, unofficial tool. It is not affiliated with, operated by,
endorsed by, or reviewed by corporate benefits Germany GmbH or any other
benefits provider. All brand names and logos belong to their respective
owners. Discount figures come from the local cache and may be out of date —
the portal's own offer page is always authoritative. No warranty, no
liability.
```

### Kategorie
Productivity (oder Shopping)

### Datenschutzerklärung-URL
Pflichtfeld. `PRIVACY.md` öffentlich hosten (GitHub Pages, Gist oder eigene
Domain) und die URL hier eintragen. **Vorher die Kontakt-E-Mail eintragen.**

---

## Berechtigungs-Begründungen (jede einzeln Pflicht)

| Berechtigung | Begründung zum Kopieren |
|---|---|
| `storage` | Stores the user's portal address, their notification preference, and the locally cached offer catalogue. All local; nothing is transmitted. |
| `tabs` | Needed to know when the active tab has finished loading or changed, so the toolbar badge can reflect the site currently being viewed. |
| `activeTab` | When the user clicks the extension icon, the current tab's title and og:site_name are read to derive the brand name. No other page data is accessed. |
| `scripting` | Used to read only the page title and og:site_name — via executeScript on the active tab when the popup is opened, and via an optional registered content script if the user enables automatic scanning. |
| `offscreen` | Manifest V3 service workers have no DOM. An offscreen document is used to parse the portal's returned HTML with DOMParser instead of regular expressions. |
| `alarms` | Schedules the weekly refresh of the cached offer catalogue. |
| `notifications` | Used to tell the user about a match on the page they are on — either because they chose "desktop notification", or as the fallback for the default "open the popup automatically" mode, which Chrome often blocks. Can be turned down to a silent toolbar badge in the options. |
| `host_permissions` (optional, all sites) | **Not requested at install.** Only requested if the user explicitly enables "Automatic scanning" in the options page, and used solely to read a page's title and og:site_name so the badge is accurate without opening the popup. The user's own portal origin is likewise requested at runtime, only after they enter and confirm it. |

### Remote code
**No.** All code ships in the package; nothing is fetched or evaluated at
runtime.

### Datennutzung (Data usage disclosures)
Ankreuzen: **keine** der Datenkategorien wird erhoben oder übertragen.
Die drei Bestätigungen unterschreiben:
- Daten werden nicht an Dritte verkauft ✔
- Daten werden nicht zweckfremd genutzt ✔
- Daten werden nicht für Bonitätsprüfung/Kreditvergabe genutzt ✔

---

## Hinweise für die Prüfer (Feld "Notes for reviewers")

Wichtig — ohne diese Notiz kann das Team die Erweiterung nicht testen:

```
This extension requires an existing account on a third-party employee-benefits
portal (e.g. *.mitarbeiterangebote.de), which is issued by an employer. We
cannot provide test credentials, as accounts are tied to real employment.

Expected behaviour without an account:
1. Open the options page, enter any portal address, approve the host permission.
2. The extension will attempt one request to that origin and detect the
   redirect to the portal's login page.
3. The popup then shows "You're not logged in to your CB portal" — this is the
   correct, handled state, not an error.

All functionality is local: the extension reads only a page's <title> and
og:site_name, stores data only in chrome.storage, and makes network requests
exclusively to the single portal origin the user approves. No remote code, no
analytics, no third-party endpoints.
```

---

## Ablauf

1. Entwicklerkonto anlegen: <https://chrome.google.com/webstore/devconsole> —
   einmalig **5 USD**.
2. Neutrales ZIP bauen (`.\package.ps1`) und hochladen.
3. Listing ausfüllen (Texte oben), Icon 128×128 ist im Paket enthalten.
4. Mindestens **einen Screenshot** (1280×800 oder 640×400) — mit Fantasiedaten.
5. Datenschutz-URL, Berechtigungs-Begründungen, Datennutzung, Prüfer-Notiz.
6. Sichtbarkeit wählen:
   - **Nicht gelistet** — nur per Link erreichbar, nicht auffindbar.
     Empfohlen: automatische Updates ohne öffentliche Sichtbarkeit.
   - **Öffentlich** — auffindbar; rechne mit Installationen von Leuten ohne
     Portalkonto und entsprechenden Bewertungen.
   - **Privat** — nur innerhalb einer Google-Workspace-Organisation.
     Ideal, falls deine Firma Workspace nutzt.
7. Einreichen. Prüfung dauert meist 1–3 Werktage; bei breiten
   Host-Berechtigungen gelegentlich länger.

## Nach der Veröffentlichung

Für jedes Update `version` in `manifest.json` erhöhen — der Store lehnt
identische Versionsnummern ab.
