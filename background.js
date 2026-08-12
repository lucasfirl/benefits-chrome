importScripts("common.js");

// In-memory cache of the latest scan result per tab. Mirrored into
// chrome.storage.session so a popup opened right after the service worker
// was suspended can still show something instead of a blank state.
const tabResults = new Map();

const STATUS = {
  NO_PORTAL: "no-portal",
  NO_PERMISSION: "no-permission",
  NOT_LOGGED_IN: "not-logged-in",
  NOT_APPLICABLE: "not-applicable", // chrome:// pages, the portal itself, etc.
  ERROR: "error",
  OK: "ok",
};

const scanDebounce = new Map(); // tabId -> timeout handle

// Multiple scans for the same tab can be in flight at once (e.g. the cheap
// domain-guess scan from a tab's "complete" event, and the more accurate
// hint-based scan the content script triggers moments later) - and since
// each does its own network fetch, they can finish in a different order
// than they started. Without a guard, a slower *earlier* scan can overwrite
// a faster *later* one's better result. So every scan is tagged with a
// generation number, and only the most-recently-started one for a tab is
// ever allowed to write its result.
let scanCounter = 0;
const latestScanId = new Map(); // tabId -> id of the most-recently-started scan

function nextScanId(tabId) {
  const id = ++scanCounter;
  latestScanId.set(tabId, id);
  return id;
}

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.status !== "complete") return;
  scheduleScan(tabId, tab.url);
});

chrome.tabs.onActivated.addListener(({ tabId }) => {
  // Zu einem Tab hinzuschalten ist eine bewusste Nutzeraktion - ab hier gilt
  // die Seite als "geoeffnet" und darf sich wieder melden.
  restoredTabs.delete(tabId);
  chrome.tabs.get(tabId, (tab) => {
    if (chrome.runtime.lastError || !tab) return;
    scheduleScan(tabId, tab.url);
  });
});

chrome.tabs.onRemoved.addListener((tabId) => {
  notifiedFor.delete(tabId);
  tabResults.delete(tabId);
  latestScanId.delete(tabId);
  pendingHints.delete(tabId);
  restoredTabs.delete(tabId);
});

// Brand hints only ever arrive with the content script's PAGE_HINTS message,
// but other triggers (a tab reaching "complete", the user switching tabs) also
// schedule scans for the same tab *without* hints. Because scheduling is
// debounced, whichever trigger lands last cancels the other - so a hintless
// trigger would cancel the pending hint-carrying scan and fall back to
// searching by domain alone. That's exactly what breaks sites whose domain
// isn't a readable brand name (easyairportparking.de).
// Caching the last hints per tab (scoped to the hostname they were captured
// for) means any later scan of the same site can still use them.
const pendingHints = new Map(); // tabId -> { hostname, hints }

function hostnameOf(url) {
  try {
    return new URL(url).hostname;
  } catch (e) {
    return null;
  }
}

function scheduleScan(tabId, url, hints) {
  const hostname = hostnameOf(url);
  if (hints && hints.length > 0 && hostname) {
    pendingHints.set(tabId, { hostname, hints });
  }

  clearTimeout(scanDebounce.get(tabId));
  scanDebounce.set(
    tabId,
    setTimeout(() => {
      scanDebounce.delete(tabId);

      let effectiveHints = hints;
      if ((!effectiveHints || effectiveHints.length === 0) && hostname) {
        const cached = pendingHints.get(tabId);
        // Only reuse hints captured for the site we're actually scanning.
        if (cached && cached.hostname === hostname) effectiveHints = cached.hints;
      }

      const scanId = nextScanId(tabId);
      scanTab(tabId, url, effectiveHints, scanId).catch((err) =>
        console.error("[CB Deal Finder] scan failed", err)
      );
    }, 300)
  );
}

// --- Automatic full-page scanning (opt-in) ---
// Off by default: it requires the broad "read every site" host permission.
// Once granted, this content script runs on every page and reports back a
// brand hint (page title / og:site_name only) so the badge can be accurate
// without the user opening the popup first.

const AUTO_SCAN_SCRIPT_ID = "cb-deal-finder-hints";

async function isAutoScanEnabled() {
  return await cbHasAutoScanPermission();
}

async function registerAutoScanContentScript() {
  try {
    const existing = await chrome.scripting.getRegisteredContentScripts({ ids: [AUTO_SCAN_SCRIPT_ID] });
    if (existing.length > 0) return;
  } catch (e) {
    /* ignore, try to register anyway */
  }
  await chrome.scripting.registerContentScripts([
    {
      id: AUTO_SCAN_SCRIPT_ID,
      matches: ["http://*/*", "https://*/*"],
      js: ["common.js", "content-hints.js"],
      runAt: "document_idle",
    },
  ]);
}

async function unregisterAutoScanContentScript() {
  try {
    await chrome.scripting.unregisterContentScripts({ ids: [AUTO_SCAN_SCRIPT_ID] });
  } catch (e) {
    /* not registered - fine */
  }
}

// Keep the registration in sync with the granted permission across browser
// restarts / extension updates (e.g. if the user revoked it via chrome://settings).
(async () => {
  if (await isAutoScanEnabled()) {
    await registerAutoScanContentScript();
  } else {
    await unregisterAutoScanContentScript();
  }
})();

// --- Notifications: how "disruptive" a new match should be ---

async function getNotifyLevel() {
  const stored = await chrome.storage.sync.get(CB_NOTIFY_KEY);
  return stored[CB_NOTIFY_KEY] || CB_NOTIFY_DEFAULT; // "silent" | "notification" | "popup"
}

const notifiedFor = new Map(); // tabId -> url already notified for

// --- Browserstart: keine Meldungsflut fuer wiederhergestellte Tabs ---
//
// Startet Chrome mit den Tabs der letzten Sitzung, laedt es sie alle - jeder
// loest einen Scan aus, und jeder Treffer wurde bisher zu einer eigenen
// Windows-Benachrichtigung. Der Nutzer hat aber keine dieser Seiten gerade
// geoeffnet; melden soll sich die Erweiterung nur, wenn eine Seite wirklich
// aufgerufen wird.
// Deshalb merken wir uns beim Start (und nach Installation/Update, wo die
// bereits offenen Tabs genauso wenig "gerade geoeffnet" sind) jeden nicht
// sichtbaren Tab mit seiner URL und halten genau diese Kombination stumm.
// Navigiert der Tab spaeter woanders hin oder schaltet der Nutzer zu ihm,
// zaehlt das wieder als Seitenaufruf - die Zahl am Symbol bleibt ohnehin
// die ganze Zeit ueber richtig.
const restoredTabs = new Map(); // tabId -> URL, die beim Start schon offen war
let restoredTabsReady = null;

function snapshotRestoredTabs() {
  restoredTabsReady = (async () => {
    try {
      const tabs = await chrome.tabs.query({});
      for (const tab of tabs) {
        // Der aktive Tab ist der, den der Nutzer beim Start vor sich hat -
        // eine einzelne Meldung dafuer ist gewollt.
        if (tab.id != null && tab.url && !tab.active) restoredTabs.set(tab.id, tab.url);
      }
    } catch (e) {
      /* ohne Momentaufnahme wird eben gemeldet - lieber zu viel als kaputt */
    }
  })();
  return restoredTabsReady;
}

if (chrome.runtime.onStartup) chrome.runtime.onStartup.addListener(snapshotRestoredTabs);
if (chrome.runtime.onInstalled) chrome.runtime.onInstalled.addListener(snapshotRestoredTabs);

// Das Popup gehoert immer zum *aktiven* Tab - es kann gar nichts anderes
// anzeigen. Oeffnet man es wegen eines Treffers in einem Hintergrundtab (beim
// Browserstart wird jeder wiederhergestellte Tab gescannt), erscheint es also
// mit dem Zustand der Startseite: "Hier gibt es nichts nachzuschlagen".
// Deshalb nur aufmachen, wenn der Treffer wirklich im sichtbaren Tab steckt;
// sonst faellt maybeNotify auf die Benachrichtigung zurueck.
async function isVisibleTab(tabId) {
  try {
    const tab = await chrome.tabs.get(tabId);
    if (!tab || !tab.active) return false;
    if (chrome.windows && chrome.windows.getLastFocused) {
      const win = await chrome.windows.getLastFocused();
      if (win && win.focused && win.id !== tab.windowId) return false;
    }
    return true;
  } catch (e) {
    return false;
  }
}

async function maybeNotify(tabId, state) {
  if (state.status !== STATUS.OK || !state.deals || state.deals.length === 0) return;
  if (notifiedFor.get(tabId) === state.url) return; // already notified for this exact page
  // Die Momentaufnahme laeuft parallel zu den ersten Scans nach dem Start -
  // erst abwarten, sonst waere sie fuer genau die Tabs zu spaet, um die es geht.
  if (restoredTabsReady) await restoredTabsReady;
  if (restoredTabs.get(tabId) === state.url) return; // beim Start wiederhergestellt
  const level = await getNotifyLevel();
  if (level === "silent") return;
  // Fuer diese Seite abgeschaltet (voruebergehend oder dauerhaft): die Zahl am
  // Symbol bleibt, aber nichts oeffnet sich von selbst.
  if ((await getSiteMute(hostnameOf(state.url))) !== "off") return;
  notifiedFor.set(tabId, state.url);

  if (level === "popup" && (await isVisibleTab(tabId))) {
    try {
      await chrome.action.openPopup();
      return; // popup covers it, no need for a notification too
    } catch (e) {
      // Chrome often refuses this outside a direct user gesture - fall back below.
    }
  }

  // Der Titel traegt die Zahl, nicht den Erweiterungsnamen - "40% on Philips"
  // sagt im Augenwinkel mehr als "CB Deal Finder".
  const deal = state.deals[0];
  const brand = displayBrand(state.brand || deal.brand || deal.title);
  const title = deal.discount
    ? chrome.i18n.getMessage("notifyDealTitle", [deal.discount, brand])
    : deal.title;
  const message =
    state.deals.length === 1
      ? chrome.i18n.getMessage("notifyOneDeal")
      : chrome.i18n.getMessage("notifyMultipleDeals", [String(state.deals.length)]);

  chrome.notifications.create("cb-deal-" + tabId, {
    type: "basic",
    iconUrl: "icons/icon128.png",
    title,
    message,
    buttons: [
      { title: chrome.i18n.getMessage("notifySeeDeals") },
      { title: chrome.i18n.getMessage("notifyDismiss") },
    ],
  });
}

function tabIdOfNotification(notificationId) {
  const tabId = Number(notificationId.replace("cb-deal-", ""));
  return Number.isNaN(tabId) ? null : tabId;
}

chrome.notifications.onClicked.addListener((notificationId) => {
  chrome.notifications.clear(notificationId);
  const tabId = tabIdOfNotification(notificationId);
  if (tabId != null) {
    chrome.tabs.update(tabId, { active: true }).catch(() => {});
  }
});

chrome.notifications.onButtonClicked.addListener((notificationId, buttonIndex) => {
  chrome.notifications.clear(notificationId);
  if (buttonIndex !== 0) return; // "Not now" - wegklicken reicht
  const tabId = tabIdOfNotification(notificationId);
  if (tabId != null) {
    chrome.tabs.update(tabId, { active: true }).catch(() => {});
  }
});

async function getPortalOrigin() {
  const stored = await chrome.storage.sync.get(CB_STORAGE_KEY);
  return stored[CB_STORAGE_KEY] || null;
}

/**
 * Vereinheitlicht die Kandidatenliste zu Eintraegen { term, exact } und wirft
 * Dubletten raus. Taucht derselbe Begriff aus beiden Quellen auf - "Bosch"
 * steht im Titel UND in der Domain -, gewinnt die grosszuegigere Regel;
 * sonst naehme der Titel der Domain ihre Praefix-Treffer weg.
 */
function dedupeCandidates(list) {
  const byKey = new Map();
  for (const raw of list) {
    const term = candidateTerm(raw).trim();
    if (!term) continue;
    const key = term.toLowerCase();
    const existing = byKey.get(key);
    if (existing) {
      if (existing.exact && !candidateIsExact(raw)) existing.exact = false;
      continue;
    }
    byKey.set(key, { term, exact: candidateIsExact(raw) });
  }
  return [...byKey.values()];
}

async function hasPortalPermission(portalOrigin) {
  if (!portalOrigin) return false;
  try {
    return await chrome.permissions.contains({ origins: [portalOrigin + "/*"] });
  } catch (e) {
    return false;
  }
}

async function scanTab(tabId, url, extraCandidates, scanId) {
  const state = { tabId, url, checkedAt: Date.now() };

  // Only the most-recently-started scan for this tab may write a result -
  // see the scanId/latestScanId comment above scheduleScan().
  const commit = (patch) => {
    if (scanId != null && latestScanId.get(tabId) !== scanId) return;
    setState(tabId, { ...state, ...patch });
  };

  // Fehlende Portal-URL zuerst pruefen: ohne sie ist die Erweiterung auf jeder
  // Seite nutzlos, also soll das Popup zur Einrichtung fuehren statt "nichts zu
  // scannen" zu melden.
  const portalOrigin = await getPortalOrigin();
  if (!portalOrigin) {
    commit({ status: STATUS.NO_PORTAL });
    return;
  }

  if (!url || !/^https?:\/\//i.test(url)) {
    commit({ status: STATUS.NOT_APPLICABLE });
    return;
  }

  const hostname = new URL(url).hostname;
  // Hostnamen exakt vergleichen. Ein blosses includes() auf dem Origin traf
  // auch Teilstrings - "te.de" steckt z.B. in "...angebote.de" - und haette
  // fremde Seiten faelschlich als das Portal selbst behandelt.
  if (hostnameOf(portalOrigin) === hostname) {
    commit({ status: STATUS.NOT_APPLICABLE });
    return;
  }

  if (!(await hasPortalPermission(portalOrigin))) {
    commit({ status: STATUS.NO_PERMISSION, portalOrigin });
    return;
  }

  // Der Seitentitel ist abschaltbar (Einstellungen). Bleibt er an, zaehlen
  // seine Begriffe nur als exakte Treffer - Titel werden an Trennzeichen
  // zerlegt und liefern oft Bruchstuecke, die keine Marke sind.
  const useTitle = (await getMatchSources()) !== "domain";
  const hintCandidates = useTitle
    ? (extraCandidates || []).map((term) => ({ term: candidateTerm(term), exact: true }))
    : [];
  const candidates = dedupeCandidates([...hintCandidates, ...guessBrandCandidates(hostname)]);
  if (candidates.length === 0) {
    commit({ status: STATUS.OK, portalOrigin, deals: [], brand: null });
    return;
  }

  // Bevorzugter Weg: lokal gegen den Katalog abgleichen - kostet null Anfragen.
  const catalog = await getCatalog();
  if (catalogIsFresh(catalog, portalOrigin)) {
    const hits = matchCatalog(catalog.offers, candidates);
    commit({
      status: STATUS.OK,
      portalOrigin,
      // Stand des Katalogs mitgeben - Rabatte koennen inzwischen veraltet sein.
      deals: hits.map((h) => Object.assign({}, h.offer, { cachedAt: catalog.fetchedAt })),
      brand: hits.length ? hits[0].matchedOn : null,
      source: "catalog",
    });
    return;
  }

  // Bekanntermassen abgemeldet: gar nicht erst anfragen, das Portal wuerde
  // ohnehin nur auf /login umleiten.
  if (Date.now() < loggedOutUntil) {
    commit({ status: STATUS.NOT_LOGGED_IN, portalOrigin });
    return;
  }

  // Kein oder veralteter Katalog: im Hintergrund nachladen und diesmal noch
  // live suchen, damit die Erweiterung vor dem ersten Sync nicht leer wirkt.
  if (Date.now() >= syncCooldownUntil) {
    syncCatalog().catch((err) => console.error("[CB Deal Finder] Katalog-Sync", err));
  }

  try {
    let deals = [];
    let brandUsed = null;
    for (const candidate of candidates) {
      const result = await searchPortal(portalOrigin, candidate.term);
      if (result === "not-logged-in") {
        noteLoggedOut();
        commit({ status: STATUS.NOT_LOGGED_IN, portalOrigin });
        return;
      }
      // Die Portalsuche ist grosszuegig - sie liefert zu "Manager" auch
      // "manager magazin". Fuer Titel-Kandidaten dieselbe strenge Regel
      // anlegen wie beim Katalogabgleich, sonst haengt das Ergebnis nur
      // davon ab, ob gerade ein Katalog vorliegt.
      const filtered = candidate.exact
        ? result.filter((d) => namesMatch(candidate.term, d.brand || d.title, { exact: true }))
        : result;
      if (filtered.length > 0) {
        deals = filtered;
        brandUsed = candidate.term;
        break;
      }
    }
    noteReachable();
    commit({ status: STATUS.OK, portalOrigin, deals, brand: brandUsed, source: "live" });
  } catch (err) {
    console.error("[CB Deal Finder] search failed", err);
    commit({ status: STATUS.ERROR, portalOrigin, error: String(err) });
  }
}

/**
 * Fetches a path from the portal using the user's existing session.
 * Returns "not-logged-in" if the portal redirected us away from the
 * requested page - to its login form, to another tenant's domain, or
 * back to the start page. Portale melden eine abgelaufene Sitzung nicht
 * einheitlich; ohne diese Pruefung haetten wir jede Umleitung als
 * gueltige (aber leere) Seite geparst und den Katalog stillschweigend
 * als "keine Angebote" abgehakt.
 */
async function fetchPortalHtml(portalOrigin, path) {
  const base = portalOrigin.replace(/\/+$/, "");
  const url = base + path;
  const response = await fetch(url, { credentials: "include", redirect: "follow" });
  if (response.redirected && isLoggedOutRedirect(base, path, response.url)) {
    return "not-logged-in";
  }
  if (!response.ok) {
    throw new Error("Portal returned HTTP " + response.status);
  }
  return response.text();
}

/**
 * Decides whether a followed redirect means "session gone" rather than a
 * harmless canonical redirect (z. B. Trailing-Slash oder http -> https).
 */
function isLoggedOutRedirect(base, requestedPath, finalUrl) {
  let final;
  let origin;
  try {
    final = new URL(finalUrl);
    origin = new URL(base);
  } catch (err) {
    return false;
  }
  // Anderer Mandant / andere Domain -> unsere Sitzung gilt dort nicht.
  if (final.origin !== origin.origin) return true;
  if (/\/(login|signin|anmelden|logout)(\/|\?|$)/i.test(final.pathname)) return true;
  // Unterseite -> Startseite ist die uebliche stille Abweisung.
  const wanted = requestedPath.split("?")[0].replace(/\/+$/, "");
  const landed = final.pathname.replace(/\/+$/, "");
  return wanted !== "" && landed === "";
}

/**
 * Fetches and parses the portal's search results for a term.
 * Returns "not-logged-in" if the portal redirected to its login page,
 * otherwise an array of deal objects (possibly empty).
 */
async function searchPortal(portalOrigin, term) {
  const html = await fetchPortalHtml(portalOrigin, "/search?s=" + encodeURIComponent(term));
  if (html === "not-logged-in") return "not-logged-in";
  return parseHtmlForDeals(html, portalOrigin);
}

// Chrome darf das Offscreen-Dokument jederzeit beenden. Ein dauerhaft
// gemerktes "ist schon da" wuerde nach so einem Abbau dazu fuehren, dass wir
// die Erstellung ueberspringen und jede Auswertung fehlschlaegt, bis der
// Service Worker neu startet. Deshalb wird der Zustand jedes Mal geprueft;
// nur die laufende Erstellung wird gebuendelt.
let offscreenCreating = null;
async function ensureOffscreenDocument() {
  const existing = await chrome.runtime.getContexts({ contextTypes: ["OFFSCREEN_DOCUMENT"] });
  if (existing.length > 0) return;
  if (!offscreenCreating) {
    offscreenCreating = chrome.offscreen
      .createDocument({
        url: "offscreen.html",
        reasons: ["DOM_PARSER"],
        justification: "Parse HTML from the corporate benefits portal's search results.",
      })
      .catch((err) => {
        // Parallel bereits erstellt -> kein Fehlerfall.
        if (!String(err).includes("Only a single offscreen")) throw err;
      })
      .finally(() => {
        offscreenCreating = null;
      });
  }
  return offscreenCreating;
}


async function askOffscreen(type, payload) {
  await ensureOffscreenDocument();
  const response = await chrome.runtime.sendMessage(
    Object.assign({ target: "offscreen", type }, payload)
  );
  if (!response || !response.ok) {
    throw new Error((response && response.error) || "Failed to parse portal HTML");
  }
  return response;
}

async function parseHtmlForDeals(html, portalOrigin) {
  return (await askOffscreen("PARSE_OFFERS", { html, portalOrigin })).deals;
}

// --- Katalog: einmal taeglich alle Angebote holen, danach lokal abgleichen ---
//
// Statt bei jedem Seitenaufruf das Portal zu fragen (das waren ~600 Anfragen
// pro Nutzer und Tag), wird der Katalog einmal geladen und im Browser
// vorgehalten. Der Abgleich passiert danach offline - unabhaengig davon, wie
// viel jemand surft.

const CATALOG_ALARM = "cb-catalog-sync";
const CATALOG_FETCH_DELAY_MS = 1500; // gestaffelt statt als Schwall

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function getCatalog() {
  const stored = await chrome.storage.local.get(CB_CATALOG_KEY);
  return stored[CB_CATALOG_KEY] || null;
}

function catalogIsFresh(catalog, portalOrigin) {
  return (
    !!catalog &&
    catalog.portalOrigin === portalOrigin &&
    Array.isArray(catalog.offers) &&
    catalog.offers.length > 0 &&
    Date.now() - catalog.fetchedAt < CB_CATALOG_MAX_AGE_MS
  );
}

// Nach einem Fehlschlag nicht sofort wieder versuchen. Ohne diese Sperre
// stiess JEDER Seitenaufruf einen neuen Sync an, solange kein gueltiger
// Katalog vorlag - bei abgelaufener Anmeldung also hunderte vergebliche
// Anfragen pro Tag, genau gegen den Zweck des Katalogs.
const SYNC_RETRY_COOLDOWN_MS = 30 * 60 * 1000;
const LOGGED_OUT_COOLDOWN_MS = 5 * 60 * 1000;

let syncCooldownUntil = 0;
let loggedOutUntil = 0;

/** Merkt sich, dass das Portal uns gerade als abgemeldet behandelt. */
function noteLoggedOut() {
  loggedOutUntil = Date.now() + LOGGED_OUT_COOLDOWN_MS;
}

/** Nach erfolgreicher Antwort die Sperren aufheben. */
function noteReachable() {
  loggedOutUntil = 0;
  syncCooldownUntil = 0;
}

/** Explizite Nutzeraktion (Button) hebt jede Wartezeit auf. */
function clearCooldowns() {
  syncCooldownUntil = 0;
  loggedOutUntil = 0;
}

let syncInFlight = null;

async function syncCatalog(options) {
  const force = !!(options && options.force);
  if (force) clearCooldowns();
  if (!force && Date.now() < syncCooldownUntil) {
    return { ok: false, error: "cooldown" };
  }
  if (syncInFlight) return syncInFlight;
  syncInFlight = (async () => {
    const portalOrigin = await getPortalOrigin();
    if (!portalOrigin) return { ok: false, error: "no-portal" };
    if (!(await hasPortalPermission(portalOrigin))) return { ok: false, error: "no-permission" };

    const existing = await getCatalog();
    if (!force && catalogIsFresh(existing, portalOrigin)) {
      return { ok: true, cached: true, count: existing.offers.length };
    }

    // Kategorien nicht hartcodieren - jedes Firmenportal kann andere haben.
    const homeHtml = await fetchPortalHtml(portalOrigin, "/");
    if (homeHtml === "not-logged-in") return { ok: false, error: "not-logged-in", portalOrigin };
    const { categoryIds } = await askOffscreen("PARSE_CATEGORY_IDS", { html: homeHtml });
    if (!categoryIds || categoryIds.length === 0) {
      return { ok: false, error: "no-categories" };
    }

    const byId = new Map();
    let failed = 0;
    for (let i = 0; i < categoryIds.length; i++) {
      try {
        const html = await fetchPortalHtml(portalOrigin, "/overview/" + categoryIds[i]);
        if (html === "not-logged-in") return { ok: false, error: "not-logged-in", portalOrigin };
        const offers = await parseHtmlForDeals(html, portalOrigin);
        offers.forEach((o) => byId.set(o.id, o));
      } catch (err) {
        failed++;
        console.warn("[CB Deal Finder] Kategorie fehlgeschlagen", categoryIds[i], err);
      }
      if (i < categoryIds.length - 1) await sleep(CATALOG_FETCH_DELAY_MS);
    }

    if (byId.size === 0) return { ok: false, error: "empty" };

    const catalog = {
      fetchedAt: Date.now(),
      portalOrigin,
      categoryCount: categoryIds.length,
      offers: [...byId.values()],
    };
    await chrome.storage.local.set({ [CB_CATALOG_KEY]: catalog });
    return { ok: true, count: catalog.offers.length, categories: categoryIds.length, failed };
  })();

  try {
    const result = await syncInFlight;
    if (result && result.ok) {
      noteReachable();
    } else {
      // Fehlgeschlagen -> erst nach der Sperrfrist erneut versuchen.
      syncCooldownUntil = Date.now() + SYNC_RETRY_COOLDOWN_MS;
      if (result && result.error === "not-logged-in") noteLoggedOut();
    }
    return result;
  } catch (err) {
    syncCooldownUntil = Date.now() + SYNC_RETRY_COOLDOWN_MS;
    throw err;
  } finally {
    syncInFlight = null;
  }
}

if (chrome.alarms) {
  chrome.alarms.create(CATALOG_ALARM, { periodInMinutes: 60 * 12 });
  chrome.alarms.onAlarm.addListener((alarm) => {
    if (alarm.name === CATALOG_ALARM) {
      syncCatalog().catch((err) => console.error("[CB Deal Finder] Katalog-Sync", err));
    }
  });
}

function setState(tabId, state) {
  tabResults.set(tabId, state);
  chrome.storage.session.set({ ["tabResult:" + tabId]: state }).catch(() => {});
  updateBadge(tabId, state);
  maybeNotify(tabId, state).catch((err) => console.error("[CB Deal Finder] notify failed", err));
}

function updateBadge(tabId, state) {
  let text = "";
  let color = "#2563eb";
  if (state.status === STATUS.OK) {
    const count = (state.deals || []).length;
    text = count > 0 ? String(count) : "";
  } else if (state.status === STATUS.NOT_LOGGED_IN || state.status === STATUS.NO_PERMISSION) {
    text = "!";
    color = "#d97706";
  } else if (state.status === STATUS.ERROR) {
    text = "!";
    color = "#dc2626";
  } else {
    text = "";
  }
  chrome.action.setBadgeText({ tabId, text });
  chrome.action.setBadgeBackgroundColor({ tabId, color });
}

// --- Messaging with popup / options ---

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!message || message.target !== "background") return false;

  if (message.type === "GET_TAB_STATE") {
    (async () => {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      // Ohne Portal-URL ist der Seitenzustand egal - immer zur Einrichtung fuehren.
      if (!(await getPortalOrigin())) {
        return sendResponse({
          status: STATUS.NO_PORTAL,
          url: tab ? tab.url : undefined,
          tabId: tab ? tab.id : undefined,
        });
      }
      if (!tab) return sendResponse({ status: STATUS.NOT_APPLICABLE });
      let state = tabResults.get(tab.id);
      if (!state) {
        const stored = await chrome.storage.session.get("tabResult:" + tab.id);
        state = stored["tabResult:" + tab.id] || null;
      }
      sendResponse(state || { status: STATUS.NOT_APPLICABLE, url: tab.url, tabId: tab.id });
    })();
    return true;
  }

  if (message.type === "RESCAN") {
    (async () => {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (!tab) return sendResponse({ ok: false });
      await scanTab(tab.id, tab.url, message.hints, nextScanId(tab.id));
      sendResponse({ ok: true });
    })();
    return true;
  }

  if (message.type === "PAGE_HINTS") {
    // Sent by the opt-in content script (content-hints.js) on every page.
    const tabId = sender.tab && sender.tab.id;
    const url = sender.tab && sender.tab.url;
    if (tabId != null && url) {
      scheduleScan(tabId, url, message.hints);
    }
    return false;
  }

  if (message.type === "SET_AUTO_SCAN") {
    (async () => {
      if (message.enabled) {
        await registerAutoScanContentScript();
      } else {
        await unregisterAutoScanContentScript();
      }
      sendResponse({ ok: true });
    })();
    return true;
  }

  // Everything the options page's standing status panel shows, in one call:
  // portal, session, catalogue, auto-scanning, and how many requests a week
  // the portal actually sees from us.
  if (message.type === "GET_STATUS") {
    (async () => {
      const portalOrigin = await getPortalOrigin();
      const catalog = await getCatalog();
      sendResponse({
        portalOrigin,
        hasPermission: await hasPortalPermission(portalOrigin),
        autoScan: await isAutoScanEnabled(),
        // Wir wissen nur dann sicher etwas ueber die Sitzung, wenn das Portal
        // uns gerade abgewiesen hat oder ein Abruf zuletzt geklappt hat.
        loggedOut: Date.now() < loggedOutUntil,
        catalog: catalog
          ? {
              count: catalog.offers.length,
              fetchedAt: catalog.fetchedAt,
              // Ein Sync ist eine Anfrage fuer die Startseite plus eine je Kategorie.
              requestsPerSync: (catalog.categoryCount || 0) + 1,
              fresh: catalogIsFresh(catalog, portalOrigin),
            }
          : null,
      });
    })();
    return true;
  }

  if (message.type === "GET_CATALOG_STATUS") {
    (async () => {
      const portalOrigin = await getPortalOrigin();
      const catalog = await getCatalog();
      sendResponse({
        hasCatalog: !!catalog,
        fresh: catalogIsFresh(catalog, portalOrigin),
        count: catalog ? catalog.offers.length : 0,
        fetchedAt: catalog ? catalog.fetchedAt : null,
        syncing: !!syncInFlight,
      });
    })();
    return true;
  }

  // Einzelne Probeanfrage nach dem Speichern der Portaladresse. Ein voller
  // Sync dauert ueber zwanzig Sekunden - viel zu lang fuer eine Rueckmeldung
  // am Eingabefeld. Hier zaehlt nur: Antwortet dort ueberhaupt ein Portal,
  // fuer das wir angemeldet sind?
  if (message.type === "PROBE_PORTAL") {
    (async () => {
      const portalOrigin = message.portalOrigin || (await getPortalOrigin());
      if (!portalOrigin) return sendResponse({ ok: false, error: "no-portal" });
      if (!(await hasPortalPermission(portalOrigin))) {
        return sendResponse({ ok: false, error: "no-permission" });
      }
      let html;
      try {
        html = await fetchPortalHtml(portalOrigin, "/");
      } catch (err) {
        // Unbekannter Host, kein DNS, kein Zertifikat, HTTP-Fehler.
        return sendResponse({ ok: false, error: "unreachable", detail: String(err), portalOrigin });
      }
      if (html === "not-logged-in") {
        return sendResponse({ ok: false, error: "not-logged-in", portalOrigin });
      }
      try {
        const { categoryIds } = await askOffscreen("PARSE_CATEGORY_IDS", { html });
        if (!categoryIds || categoryIds.length === 0) {
          // Erreichbar, aber ohne Kategorien - das ist kein CB-Portal.
          return sendResponse({ ok: false, error: "not-a-portal", portalOrigin });
        }
        sendResponse({ ok: true, categories: categoryIds.length, portalOrigin });
      } catch (err) {
        sendResponse({ ok: false, error: "unreachable", detail: String(err), portalOrigin });
      }
    })();
    return true;
  }

  if (message.type === "SYNC_CATALOG") {
    (async () => {
      try {
        sendResponse(await syncCatalog({ force: true }));
      } catch (err) {
        sendResponse({ ok: false, error: String(err) });
      }
    })();
    return true;
  }

  if (message.type === "MANUAL_SEARCH") {
    (async () => {
      try {
        const portalOrigin = await getPortalOrigin();
        if (!portalOrigin) return sendResponse({ ok: false, error: "no-portal" });
        if (!(await hasPortalPermission(portalOrigin))) {
          return sendResponse({ ok: false, error: "no-permission" });
        }
        const result = await searchPortal(portalOrigin, message.term);
        if (result === "not-logged-in") {
          return sendResponse({ ok: false, error: "not-logged-in" });
        }
        sendResponse({ ok: true, deals: result });
      } catch (err) {
        sendResponse({ ok: false, error: String(err) });
      }
    })();
    return true;
  }

  return false;
});
