// Shared helpers used by background.js, popup.js and options.js.
// Loaded via <script src="common.js"> in pages and importScripts() in the
// service worker, so it must stay plain ES5/ES2017-ish (no ES modules).

const CB_STORAGE_KEY = "cbPortalOrigin";

// Optionale Vorbelegung der Portal-URL. Leer lassen fuer eine allgemeine
// Version; package.ps1 -DefaultPortal "..." traegt hier beim Bauen die
// Adresse ein, wenn die Erweiterung innerhalb einer Firma verteilt wird.
// Wird nur als Vorschlag ins Eingabefeld gesetzt - gespeichert (und damit
// die Berechtigung angefragt) wird weiterhin erst per Klick des Nutzers.
const CB_DEFAULT_PORTAL = "";

// Two-part public suffixes we know about, so "example.co.uk" doesn't guess
// the brand as "co". Not exhaustive - good enough for a domain heuristic.
const TWO_PART_TLDS = new Set([
  "co.uk", "org.uk", "ac.uk", "gov.uk",
  "co.at", "or.at",
  "com.au", "net.au",
  "co.nz"
]);

/**
 * Normalizes a user-entered portal URL/slug into an origin string like
 * "https://deinefirma.mitarbeiterangebote.de".
 * Returns null if the input can't be parsed into a usable origin.
 */
function normalizePortalInput(input) {
  if (!input) return null;
  let value = input.trim();
  if (!value) return null;
  if (!/^https?:\/\//i.test(value)) {
    value = "https://" + value;
  }
  try {
    const url = new URL(value);
    if (!url.hostname.includes(".")) return null;
    return url.origin;
  } catch (e) {
    return null;
  }
}

/**
 * Guesses one or more brand-name search terms from a website hostname,
 * e.g. "www.on-running.com" -> ["on running", "on"].
 * Returns them ordered from most to least specific.
 */
function guessBrandCandidates(hostname) {
  if (!hostname) return [];
  let host = hostname.toLowerCase();
  if (host.startsWith("www.")) host = host.slice(4);

  const labels = host.split(".").filter(Boolean);
  if (labels.length < 2) return [];

  // Strip the TLD (handling a small list of known two-part TLDs).
  let root;
  const lastTwo = labels.slice(-2).join(".");
  if (labels.length >= 3 && TWO_PART_TLDS.has(lastTwo)) {
    root = labels[labels.length - 3];
  } else {
    root = labels[labels.length - 2];
  }

  const candidates = [];
  const spaced = root.replace(/[-_]+/g, " ").trim();
  if (spaced) candidates.push(spaced);

  const firstWord = spaced.split(" ")[0];
  if (firstWord && firstWord !== spaced) candidates.push(firstWord);

  return candidates;
}

/**
 * Builds the search URL for a given portal origin + query term.
 */
function buildSearchUrl(portalOrigin, term) {
  return portalOrigin.replace(/\/+$/, "") + "/search?s=" + encodeURIComponent(term);
}

/**
 * Derives brand-name search candidates from a page's title and og:site_name
 * meta tag. Much more reliable than the domain heuristic for brands whose
 * domain doesn't split into words (e.g. "easyairportparking.de").
 */
function deriveHintCandidates({ title, ogSiteName } = {}) {
  const candidates = [];
  if (ogSiteName && ogSiteName.trim()) candidates.push(ogSiteName.trim());
  if (title) {
    const segments = title
      .split(/[|·•\-–—:]/)
      .map((s) => s.trim())
      .filter((s) => s.length >= 2 && s.length <= 40);
    // Brand names commonly sit at either end of a page title.
    if (segments.length > 1) {
      candidates.push(segments[segments.length - 1]);
      candidates.push(segments[0]);
    } else if (segments.length === 1) {
      candidates.push(segments[0]);
    }
  }
  return [...new Set(candidates.filter(Boolean))];
}

const CB_NOTIFY_KEY = "cbNotifyLevel"; // "silent" | "notification" | "popup"

// Standard: das Popup direkt oeffnen. Chrome laesst das nicht immer zu -
// dann faellt maybeNotify() auf eine Desktop-Benachrichtigung zurueck.
const CB_NOTIFY_DEFAULT = "popup";
const CB_AUTO_SCAN_ORIGINS = ["https://*/*", "http://*/*"];

// Erteilt der Nutzer den Zugriff nicht ueber unseren Schalter, sondern ueber
// Chromes eigene Oberflaeche ("Auf allen Websites" im Symbolmenue, oder
// chrome://extensions), steht in getAll() ein anderes Muster als das, was wir
// angefragt haben - contains() sagt dann trotz erteiltem Vollzugriff "nein".
// Deshalb zusaetzlich pruefen, ob irgendein erteiltes Muster alle Seiten deckt.
const CB_ALL_SITES_PATTERNS = new Set([
  "<all_urls>",
  "*://*/*",
  "https://*/*",
  "http://*/*",
]);

async function cbHasAutoScanPermission() {
  try {
    if (await chrome.permissions.contains({ origins: CB_AUTO_SCAN_ORIGINS })) return true;
    const all = await chrome.permissions.getAll();
    return (all.origins || []).some((o) => CB_ALL_SITES_PATTERNS.has(o));
  } catch (e) {
    return false;
  }
}

// --- Pro Seite: automatisches Melden abschalten ---------------------------
//
// Die Einstellung "Wenn ein Treffer gefunden wird" gilt global. Auf einzelnen
// Seiten stoert das trotzdem (die Seite, auf der man den ganzen Tag arbeitet),
// deshalb laesst sich das automatische Popup je Seite abschalten - entweder
// nur bis der Browser geschlossen wird ("session", chrome.storage.session
// raeumt sich dann von selbst auf) oder dauerhaft ("always", storage.sync,
// also auch auf anderen Rechnern desselben Profils).
const CB_MUTED_KEY = "cbMutedHosts"; // dauerhaft, synchronisiert
const CB_MUTED_SESSION_KEY = "cbMutedHostsSession"; // bis zum Browserende

/** Vergleichsform eines Hostnamens: klein, ohne "www.". */
function muteHostKey(hostname) {
  if (!hostname) return "";
  return String(hostname).trim().toLowerCase().replace(/^www\./, "");
}

// --- Muster mit Platzhalter ----------------------------------------------
//
// Eine Liste aus lauter einzelnen Hostnamen wird bei grossen Anbietern zur
// Fleissarbeit: mail.google.com, docs.google.com, google.de ... jedes Mal
// dasselbe "Nie". Deshalb darf ein Eintrag auch ein Muster sein:
//
//   *.google.com  -> google.com und jede Unterseite davon
//   google.*      -> google.de, google.com, google.co.uk
//   *shop*.de     -> jeder .de-Host, in dem "shop" vorkommt
//
// Ein "*" steht fuer beliebige Zeichen innerhalb EINES Namensteils; nur die
// beiden Sonderfaelle am Anfang ("*.") und am Ende (".*") duerfen mehrere
// Teile ueberspringen. Sonst wuerde "*.google.com" auch auf
// "google.com.beispiel.de" passen - eine fremde Seite.

/** Enthaelt der Eintrag einen Platzhalter? */
function isMutePattern(entry) {
  return !!entry && String(entry).includes("*");
}

/**
 * Vergleichsform eines Listeneintrags. Nimmt auch eine eingefuegte volle URL
 * entgegen ("https://mail.google.com/mail/u/0") und macht den Host daraus.
 * "www." faellt nur bei einfachen Hostnamen weg - in einem Muster hat der
 * Nutzer es bewusst hingeschrieben.
 */
function muteEntryKey(value) {
  if (!value) return "";
  let key = String(value)
    .trim()
    .toLowerCase()
    .replace(/^[a-z][a-z0-9+.-]*:\/\//, "") // Schema
    .replace(/^[^/]*@/, "") // Anmeldedaten in der URL
    .replace(/[/?#].*$/, "") // Pfad, Query, Anker
    .replace(/:\d+$/, "") // Port
    .replace(/\.+$/, ""); // abschliessender Punkt der Wurzelzone
  if (!key) return "";
  return isMutePattern(key) ? key : key.replace(/^www\./, "");
}

/**
 * Prueft, ob ein Eintrag als Muster taugt. Bewusst streng: alles, was kein
 * Hostname sein kann, waere ein Muster, das nie trifft - und der Nutzer
 * saehe nur, dass sich nichts aendert.
 */
function isValidMuteEntry(value) {
  const key = muteEntryKey(value);
  if (!key) return false;
  if (key === "*") return true; // "alles" - zulaessig, aber Absicht
  if (!/^[a-z0-9*.-]+$/.test(key)) return false;
  if (key.includes("..")) return false;
  // Ohne Punkt bliebe nur ein einzelner Namensteil - keine Webseite.
  return key.includes(".");
}

const escapeForRegExp = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

// Muster aendern sich selten, Seitenaufrufe sind viele - einmal uebersetzen
// reicht.
const mutePatternCache = new Map();

function mutePatternToRegExp(pattern) {
  const cached = mutePatternCache.get(pattern);
  if (cached) return cached;

  let regex;
  if (pattern === "*") {
    regex = /^.+$/;
  } else {
    let rest = pattern;
    let prefix = "";
    let suffix = "";
    if (rest.startsWith("*.")) {
      prefix = "(?:[^.]+\\.)*"; // beliebig viele Unterebenen - auch keine
      rest = rest.slice(2);
    }
    if (rest.endsWith(".*")) {
      // Genau eine Endung - ".de" ebenso wie ".co.uk", aber nichts anderes
      // Zweiteiliges. Sonst deckte "google.*" auch "google.fremde-seite.de"
      // ab, also einen Host, der jemand anderem gehoert. Zwei Namensteile
      // sind darum nur erlaubt, wenn sie eine bekannte zweiteilige Endung
      // sind - dieselbe Liste, die schon den Markennamen aus der Domain holt.
      const twoPart = [...TWO_PART_TLDS].map(escapeForRegExp).join("|");
      suffix = "(?:\\.(?:" + twoPart + ")|\\.[^.]+)";
      rest = rest.slice(0, -2);
    }
    const middle = rest.split("*").map(escapeForRegExp).join("[^.]*");
    regex = new RegExp("^" + prefix + middle + suffix + "$");
  }

  mutePatternCache.set(pattern, regex);
  return regex;
}

/** Trifft ein Listeneintrag (Host oder Muster) auf diesen Hostnamen zu? */
function muteEntryMatches(entry, hostname) {
  const key = muteEntryKey(entry);
  const host = muteHostKey(hostname);
  if (!key || !host) return false;
  if (!isMutePattern(key)) return key === host;
  return mutePatternToRegExp(key).test(host);
}

/**
 * Die registrierbare Domain eines Hosts - "mail.google.com" -> "google.com",
 * "shop.example.co.uk" -> "example.co.uk". Daraus baut das Popup den
 * Vorschlag "*.google.com" fuer den Umfang "ganze Domain".
 */
function baseDomainOf(hostname) {
  const host = muteHostKey(hostname);
  if (!host || isMutePattern(host)) return host;
  const labels = host.split(".").filter(Boolean);
  if (labels.length < 2) return host;
  const lastTwo = labels.slice(-2).join(".");
  if (labels.length >= 3 && TWO_PART_TLDS.has(lastTwo)) return labels.slice(-3).join(".");
  return labels.slice(-2).join(".");
}

/** Das Muster, das eine ganze Domain samt Unterseiten abdeckt. */
function domainMutePattern(hostname) {
  const base = baseDomainOf(hostname);
  return base ? "*." + base : "";
}

async function readMutedHosts() {
  const [sync, session] = await Promise.all([
    chrome.storage.sync.get(CB_MUTED_KEY),
    chrome.storage.session.get(CB_MUTED_SESSION_KEY),
  ]);
  return {
    always: new Set(sync[CB_MUTED_KEY] || []),
    session: new Set(session[CB_MUTED_SESSION_KEY] || []),
  };
}

/** Erster Eintrag einer Liste, der auf den Hostnamen passt - sonst null. */
function findMuteEntry(entries, hostname) {
  for (const entry of entries) {
    if (muteEntryMatches(entry, hostname)) return entry;
  }
  return null;
}

/**
 * Liefert Modus und den Eintrag, der ihn ausloest. Der Eintrag zaehlt fuer die
 * Anzeige: steht die Seite wegen "*.google.com" still, soll das Popup genau
 * das zeigen und nicht so tun, als waere "mail.google.com" einzeln gesetzt.
 */
async function getSiteMuteMatch(hostname) {
  const key = muteHostKey(hostname);
  if (!key) return { mode: "off", entry: null };
  const { always, session } = await readMutedHosts();
  const hit = findMuteEntry(always, key);
  if (hit) return { mode: "always", entry: hit };
  const paused = findMuteEntry(session, key);
  if (paused) return { mode: "session", entry: paused };
  return { mode: "off", entry: null };
}

/** Liefert "off" | "session" | "always" fuer einen Hostnamen. */
async function getSiteMute(hostname) {
  return (await getSiteMuteMatch(hostname)).mode;
}

// chrome.storage.sync erlaubt nur 8 KB je Eintrag - bei etwa 350 Hostnamen
// waere Schluss, und zwar mit einem Schreibfehler statt einer Warnung. Deshalb
// ein Deckel weit darunter: ist er erreicht, faellt der aelteste Eintrag raus
// (Sets behalten die Einfuegereihenfolge). Wer so viele Seiten abschaltet, hat
// die erste vor Monaten gesetzt und vermisst sie nicht.
const CB_MUTED_MAX = 250;

/**
 * Setzt genau einen der drei Zustaende fuer einen Hostnamen ODER ein Muster;
 * die anderen beiden werden geloescht.
 *
 * Kommt ein Muster dazu, fallen die Einzeleintraege weg, die es ohnehin
 * abdeckt: wer "*.google.com" setzt, will nicht danach noch drei tote Zeilen
 * fuer mail./docs./www.google.com in den Einstellungen stehen haben.
 */
async function setSiteMute(hostname, mode) {
  const key = muteEntryKey(hostname);
  if (!key) return;
  const { always, session } = await readMutedHosts();
  always.delete(key);
  session.delete(key);

  if (mode === "always" || mode === "session") {
    if (isMutePattern(key)) {
      for (const list of [always, session]) {
        for (const existing of [...list]) {
          if (existing !== key && muteEntryMatches(key, existing)) list.delete(existing);
        }
      }
    }
    (mode === "always" ? always : session).add(key);
  }

  let alwaysList = [...always];
  if (alwaysList.length > CB_MUTED_MAX) alwaysList = alwaysList.slice(-CB_MUTED_MAX);

  await Promise.all([
    chrome.storage.sync.set({ [CB_MUTED_KEY]: alwaysList }),
    chrome.storage.session.set({ [CB_MUTED_SESSION_KEY]: [...session] }),
  ]);
}

/**
 * Schaltet alle Seiten auf einmal wieder ein. Bewusst ein einziger Schreib-
 * vorgang je Bereich: storage.sync begrenzt die Schreibzugriffe pro Minute,
 * eine Schleife ueber setSiteMute() liefe bei langen Listen dagegen.
 */
async function clearSiteMutes() {
  await Promise.all([
    chrome.storage.sync.set({ [CB_MUTED_KEY]: [] }),
    chrome.storage.session.set({ [CB_MUTED_SESSION_KEY]: [] }),
  ]);
}

const CB_CATALOG_KEY = "cbCatalog";

// Eine Woche. Die Marken im Katalog aendern sich kaum - was sich aendert,
// sind Rabatthoehen und Monats-Specials. Deshalb wird das Alter des Katalogs
// im Popup angezeigt und laesst sich dort jederzeit manuell erneuern.
const CB_CATALOG_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * Formatiert einen Zeitpunkt als "08.08.26 12:44" (bzw. der Schreibweise der
 * Browsersprache). Wird pro Angebot angezeigt, damit sichtbar ist, von wann
 * der zwischengespeicherte Rabatt stammt.
 */
function formatCachedAt(timestamp, locale) {
  const date = new Date(timestamp);
  try {
    const text = new Intl.DateTimeFormat(locale || undefined, {
      day: "2-digit",
      month: "2-digit",
      year: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    }).format(date);
    // Intl trennt Datum und Uhrzeit mit Komma - fuer die Anzeige stoert das.
    return text.replace(", ", " ");
  } catch (e) {
    return date.toLocaleString();
  }
}

/**
 * Formatiert ein Alter in Millisekunden als "12 Min." / "5 Std." / "3 Tagen".
 * `t` ist die Uebersetzungsfunktion (chrome.i18n.getMessage).
 */
function formatCatalogAge(ms, t) {
  const minutes = Math.max(0, Math.round(ms / 60000));
  if (minutes < 60) return t("catalogAgeMinutes", [String(minutes)]);
  const hours = Math.round(minutes / 60);
  if (hours < 24) return t("catalogAgeHours", [String(hours)]);
  return t("catalogAgeDays", [String(Math.round(hours / 24))]);
}

/**
 * Kurzform desselben Alters ohne Leerzeichen ("2D", "5H", "12M") - fuer die
 * einzeilige Katalogleiste im Popup, wo "1284 OFFERS · 2D OLD" in eine Zeile
 * passen muss.
 */
function formatCatalogAgeShort(ms, t) {
  const minutes = Math.max(0, Math.round(ms / 60000));
  if (minutes < 60) return t("catalogAgeShortMinutes", [String(minutes)]);
  const hours = Math.round(minutes / 60);
  if (hours < 24) return t("catalogAgeShortHours", [String(hours)]);
  return t("catalogAgeShortDays", [String(Math.round(hours / 24))]);
}

/**
 * Formatiert einen Zeitpunkt als "04 AUG" - der Stand, der einmal unter der
 * ganzen Trefferliste steht statt an jedem einzelnen Angebot.
 */
function formatAsOfDate(timestamp, locale) {
  try {
    return new Intl.DateTimeFormat(locale || undefined, {
      day: "2-digit",
      month: "short",
    })
      .format(new Date(timestamp))
      .toUpperCase();
  } catch (e) {
    return new Date(timestamp).toLocaleDateString();
  }
}

/**
 * Macht aus einem geratenen Suchbegriff eine anzeigbare Marke: "philips" ->
 * "Philips", "on running" -> "On Running". Begriffe, die schon Grossbuchstaben
 * enthalten (SIXT), bleiben unangetastet.
 */
function displayBrand(value) {
  if (!value) return "";
  return String(value)
    .trim()
    .split(/\s+/)
    .map((word) => (/[A-Z]/.test(word) ? word : word.charAt(0).toUpperCase() + word.slice(1)))
    .join(" ");
}

/**
 * Reduziert einen Namen auf eine vergleichbare Form: Kleinschreibung, ohne
 * Umlaute/Akzente, ohne Leer- und Sonderzeichen.
 *
 * Genau das laesst "easyairportparking.de" auf "Easy Airport Parking" passen -
 * der Fall, der ueber die Portalsuche nur ueber den Seitentitel gefunden wurde.
 *
 * Umlaute sind zweideutig ("Hausgeraete" vs. "Hausgerate"), deshalb liefert
 * die Funktion beide Schreibweisen zurueck; getroffen wird, wenn irgendein
 * Paar passt.
 */
function normalizeNameVariants(value) {
  if (!value) return [];
  const base = String(value).toLowerCase().trim();
  if (!base) return [];

  const strip = (s) =>
    s
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[^a-z0-9]/g, "");

  // Variante 1: deutsche Umschrift (ä -> ae)
  const german = strip(
    base.replace(/ä/g, "ae").replace(/ö/g, "oe").replace(/ü/g, "ue").replace(/ß/g, "ss")
  );
  // Variante 2: blosses Weglassen der Diakritika (ä -> a)
  const plain = strip(base.replace(/ß/g, "ss"));

  return [...new Set([german, plain])].filter(Boolean);
}

/** Bequemer Einzelwert, wo nur eine Form gebraucht wird. */
function normalizeName(value) {
  return normalizeNameVariants(value)[0] || "";
}

/**
 * Prueft, ob ein geratener Markenname (aus Domain/Titel) zu einem
 * Katalog-Markennamen passt. Bewusst konservativ, damit nicht jede Domain
 * zufaellig auf eine kurze Marke wie "On" oder "BYD" passt.
 *
 * `options.exact` schaltet die beiden Praefix-Regeln ab. Das ist fuer
 * Kandidaten aus dem Seitentitel gedacht: die entstehen durch Zerlegen an
 * Trennzeichen und sind darum haeufig gar keine Marke. "lucasfirl/VM-Manager"
 * liefert das Bruchstueck "Manager" - mit Praefix-Regel traefe das "manager
 * magazin", also ein Angebot, das mit der Seite nichts zu tun hat.
 */
function namesMatch(candidate, brand, options) {
  const exactOnly = !!(options && options.exact);
  const cs = normalizeNameVariants(candidate);
  const bs = normalizeNameVariants(brand);
  for (const c of cs) {
    if (c.length < 2) continue;
    for (const b of bs) {
      if (b.length < 2) continue;
      // Exakt: auch kurze Marken wie "On" oder "BYD" duerfen treffen.
      if (c === b) return true;
      if (exactOnly) continue;
      // "bosch" trifft "boschsiemenshausgeraete" - beide Seiten muessen lang
      // genug sein, sonst passt "on" auf jede Marke, die mit "on" beginnt.
      if (c.length >= 4 && b.length >= 4 && b.startsWith(c)) return true;
      // "philipsdeutschland" trifft "philips"
      if (b.length >= 5 && c.startsWith(b)) return true;
    }
  }
  return false;
}

// Ein Kandidat ist entweder ein blosser Suchbegriff oder ein Objekt
// { term, exact } - letzteres fuer Begriffe aus dem Seitentitel, die nur
// exakt treffen duerfen (siehe namesMatch).
function candidateTerm(entry) {
  if (!entry) return "";
  return typeof entry === "string" ? entry : String(entry.term || "");
}

function candidateIsExact(entry) {
  return !!(entry && typeof entry === "object" && entry.exact);
}

/**
 * Gleicht Kandidaten (Domain, Seitentitel, ...) lokal gegen den Katalog ab.
 * Ergebnis ist nach Kandidatenreihenfolge sortiert, d.h. der beste Treffer
 * zuerst.
 */
function matchCatalog(offers, candidates) {
  const hits = [];
  const seen = new Set();
  for (const candidate of candidates || []) {
    const term = candidateTerm(candidate);
    if (!term) continue;
    const options = { exact: candidateIsExact(candidate) };
    for (const offer of offers || []) {
      if (seen.has(offer.id)) continue;
      if (namesMatch(term, offer.brand || offer.title, options)) {
        seen.add(offer.id);
        hits.push({ offer, matchedOn: term });
      }
    }
  }
  return hits;
}

// --- Woraus der Markenname geraten wird -----------------------------------
//
// Die Domain ist die verlaessliche Quelle: sie gehoert dem Anbieter. Der
// Seitentitel ist die ergiebigere, aber unsauberere - er faengt Marken, deren
// Domain sich nicht in Woerter zerlegen laesst ("easyairportparking.de"),
// bringt aber auf Seiten wie GitHub oder in Foren Bruchstuecke mit, die keine
// Marke sind. Wem das zu viel ist, der schaltet den Titel hier ab.
const CB_MATCH_SOURCES_KEY = "cbMatchSources"; // "domain" | "domain+title"
const CB_MATCH_SOURCES_DEFAULT = "domain+title";

async function getMatchSources() {
  try {
    const stored = await chrome.storage.sync.get(CB_MATCH_SOURCES_KEY);
    return stored[CB_MATCH_SOURCES_KEY] === "domain" ? "domain" : CB_MATCH_SOURCES_DEFAULT;
  } catch (e) {
    return CB_MATCH_SOURCES_DEFAULT;
  }
}

/**
 * Applies chrome.i18n messages to any element carrying data-i18n(-title|-placeholder)
 * attributes. Chrome auto-picks the locale from the browser's UI language, falling
 * back to the manifest's default_locale (English) for anything untranslated.
 */
function applyI18n(root) {
  const scope = root || document;
  scope.querySelectorAll("[data-i18n]").forEach((elt) => {
    const msg = chrome.i18n.getMessage(elt.dataset.i18n);
    if (msg) elt.textContent = msg;
  });
  scope.querySelectorAll("[data-i18n-title]").forEach((elt) => {
    const msg = chrome.i18n.getMessage(elt.dataset.i18nTitle);
    if (msg) elt.title = msg;
  });
  scope.querySelectorAll("[data-i18n-placeholder]").forEach((elt) => {
    const msg = chrome.i18n.getMessage(elt.dataset.i18nPlaceholder);
    if (msg) elt.placeholder = msg;
  });
  scope.querySelectorAll("[data-i18n-aria-label]").forEach((elt) => {
    const msg = chrome.i18n.getMessage(elt.dataset.i18nAriaLabel);
    if (msg) elt.setAttribute("aria-label", msg);
  });
}

if (typeof module !== "undefined") {
  module.exports = {
    normalizePortalInput,
    guessBrandCandidates,
    buildSearchUrl,
    deriveHintCandidates,
    normalizeName,
    normalizeNameVariants,
    namesMatch,
    matchCatalog,
    candidateTerm,
    candidateIsExact,
    CB_MATCH_SOURCES_KEY,
    CB_MATCH_SOURCES_DEFAULT,
    formatCatalogAge,
    formatCatalogAgeShort,
    formatCachedAt,
    formatAsOfDate,
    displayBrand,
    muteHostKey,
    muteEntryKey,
    muteEntryMatches,
    isMutePattern,
    isValidMuteEntry,
    baseDomainOf,
    domainMutePattern,
    CB_CATALOG_MAX_AGE_MS,
  };
}
