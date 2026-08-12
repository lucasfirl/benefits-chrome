// Prueft den Katalog-Pfad: liegt ein frischer Katalog vor, muss der Abgleich
// rein lokal passieren - also OHNE eine einzige Portalanfrage.

const fs = require("fs");
const vm = require("vm");
const path = require("path");

const EXT = path.join(__dirname, "..", "src");
const PORTAL = "https://example.mitarbeiterangebote.de";

function loadBackground(catalog) {
  const noopEvent = () => ({ addListener() {} });
  const sandbox = {
    console: { log() {}, error() {}, warn() {} },
    setTimeout,
    clearTimeout,
    URL,
    Date,
    Set,
    Map,
    Number,
    String,
    JSON,
    Array,
    Object,
    Promise,
    chrome: {
      runtime: { onMessage: { addListener() {} }, getContexts: async () => [{}], sendMessage: async () => ({ ok: true, deals: [] }), lastError: null },
      tabs: { onUpdated: noopEvent(), onActivated: noopEvent(), onRemoved: noopEvent(), get() {}, query: async () => [], update: async () => {} },
      storage: {
        sync: { get: async () => ({ cbPortalOrigin: PORTAL, cbNotifyLevel: "silent" }) },
        session: { set: async () => {}, get: async () => ({}) },
        local: { get: async () => (catalog ? { cbCatalog: catalog } : {}), set: async () => {} },
      },
      permissions: { contains: async () => true },
      action: { setBadgeText() {}, setBadgeBackgroundColor() {}, openPopup: async () => {} },
      scripting: { getRegisteredContentScripts: async () => [], registerContentScripts: async () => {}, unregisterContentScripts: async () => {} },
      notifications: { create() {}, clear() {}, onClicked: noopEvent(), onButtonClicked: noopEvent() },
      offscreen: { createDocument: async () => {} },
      alarms: { create() {}, onAlarm: { addListener() {} } },
      i18n: { getMessage: (k) => k },
    },
    fetch: async () => {
      throw new Error("KEINE Netzwerkanfrage erwartet");
    },
    importScripts() {
      vm.runInContext(fs.readFileSync(path.join(EXT, "common.js"), "utf8"), sandbox, { filename: "common.js" });
    },
  };
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(path.join(EXT, "background.js"), "utf8"), sandbox, { filename: "background.js" });
  vm.runInContext("var __tabResults = tabResults; var __scheduleScan = scheduleScan;", sandbox);

  // Jede Portalanfrage zaehlen - im Katalogfall muss der Zaehler 0 bleiben.
  const calls = { search: 0, sync: 0 };
  sandbox.__stubSearch = async () => {
    calls.search++;
    return [];
  };
  sandbox.__stubSync = async () => {
    calls.sync++;
    return { ok: true };
  };
  vm.runInContext("searchPortal = __stubSearch; syncCatalog = __stubSync;", sandbox);

  return { sandbox, calls };
}

const freshCatalog = (offers) => ({
  fetchedAt: Date.now(),
  portalOrigin: PORTAL,
  categoryCount: 13,
  offers,
});

const OFFERS = [
  { id: "39587", brand: "Easy Airport Parking", title: "Easy Airport Parking", discount: "15% Rabatt", url: PORTAL + "/offer/39587" },
  { id: "1001877", brand: "Philips", title: "Philips", discount: "< 20% Rabatt", url: PORTAL + "/offer/1001877" },
  { id: "1006152", brand: "Bosch Siemens Hausgeräte", title: "Bosch Siemens Hausgeräte - August-Special", discount: "7%", url: PORTAL + "/offer/1006152" },
];

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const TAB = 42;

// Laesst die (gestubbte) Live-Suche einen Treffer liefern, um den
// Fallback-Pfad mit Ergebnis zu pruefen.
function vmSearchReturnsDeal(sandbox) {
  sandbox.__stubSearch2 = async () => [{ id: "1001877", brand: "Philips", title: "Philips", discount: "< 20% Rabatt" }];
  vm.runInContext("searchPortal = __stubSearch2;", sandbox);
}

async function scenario(name, catalog, url, hints, expect) {
  const { sandbox, calls } = loadBackground(catalog);
  await wait(5);
  sandbox.__scheduleScan(TAB, url, hints);
  await wait(450);
  const state = sandbox.__tabResults.get(TAB) || {};
  const deals = state.deals || [];
  const ok =
    deals.length === expect.deals &&
    calls.search === expect.searchCalls &&
    (expect.source ? state.source === expect.source : true);
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}`);
  console.log(
    `        Treffer: ${deals.length} (erwartet ${expect.deals}) | ` +
      `Portalanfragen: ${calls.search} (erwartet ${expect.searchCalls}) | Quelle: ${state.source}`
  );
  return ok;
}

(async () => {
  const results = [];

  results.push(
    await scenario(
      "Katalog vorhanden -> lokaler Treffer, NULL Anfragen",
      freshCatalog(OFFERS),
      "https://www.easyairportparking.de/parkplatz/berlin",
      ["Easy Airport Parking"],
      { deals: 1, searchCalls: 0, source: "catalog" }
    )
  );

  results.push(
    await scenario(
      "Katalog vorhanden, Domain allein reicht -> NULL Anfragen",
      freshCatalog(OFFERS),
      "https://www.easyairportparking.de/",
      null,
      { deals: 1, searchCalls: 0, source: "catalog" }
    )
  );

  results.push(
    await scenario(
      "Katalog vorhanden, kein Treffer -> trotzdem NULL Anfragen",
      freshCatalog(OFFERS),
      "https://www.github.com/",
      ["GitHub"],
      { deals: 0, searchCalls: 0, source: "catalog" }
    )
  );

  // Grenze ist eine Woche - beide Seiten davon pruefen.
  const DAY = 24 * 60 * 60 * 1000;

  const sixDays = freshCatalog(OFFERS);
  sixDays.fetchedAt = Date.now() - 6 * DAY;
  results.push(
    await scenario(
      "Katalog 6 Tage alt -> noch gueltig, NULL Anfragen",
      sixDays,
      "https://www.philips.de/",
      ["Philips"],
      { deals: 1, searchCalls: 0, source: "catalog" }
    )
  );

  const eightDays = freshCatalog(OFFERS);
  eightDays.fetchedAt = Date.now() - 8 * DAY;
  results.push(
    await scenario(
      "Katalog 8 Tage alt -> Live-Suche als Rueckfallebene",
      eightDays,
      "https://www.philips.de/",
      ["Philips"],
      { deals: 0, searchCalls: 1, source: "live" }
    )
  );

  // Jeder Katalogtreffer muss den Stand des Katalogs mitbringen, damit im
  // Popup "Angebot vom ..." angezeigt werden kann. Live-Treffer duerfen ihn
  // NICHT haben - die sind ja gerade frisch geholt.
  {
    const cat = freshCatalog(OFFERS);
    const { sandbox } = loadBackground(cat);
    await wait(5);
    sandbox.__scheduleScan(TAB, "https://www.easyairportparking.de/", null);
    await wait(450);
    const deals = (sandbox.__tabResults.get(TAB) || {}).deals || [];
    const ok = deals.length === 1 && deals[0].cachedAt === cat.fetchedAt;
    console.log(`${ok ? "PASS" : "FAIL"}  Katalogtreffer tragen den Katalogstand (cachedAt)`);
    console.log(`        cachedAt: ${deals[0] && deals[0].cachedAt} | Katalog: ${cat.fetchedAt}`);
    results.push(ok);
  }
  {
    const stale = freshCatalog(OFFERS);
    stale.fetchedAt = Date.now() - 8 * 24 * 60 * 60 * 1000;
    const { sandbox } = loadBackground(stale);
    await wait(5);
    vmSearchReturnsDeal(sandbox);
    sandbox.__scheduleScan(TAB, "https://www.philips.de/", ["Philips"]);
    await wait(450);
    const deals = (sandbox.__tabResults.get(TAB) || {}).deals || [];
    const ok = deals.length === 1 && deals[0].cachedAt === undefined;
    console.log(`${ok ? "PASS" : "FAIL"}  Live-Treffer tragen KEINEN Katalogstand`);
    results.push(ok);
  }

  // Formatierung: aus dem Zeitstempel muss ein lesbares Datum werden
  {
    const c = require("../src/common.js");
    const ts = new Date(2026, 7, 8, 12, 44).getTime();
    const text = c.formatCachedAt(ts, "de-DE");
    const ok = text === "08.08.26 12:44";
    console.log(`${ok ? "PASS" : "FAIL"}  formatCachedAt -> "${text}" (erwartet "08.08.26 12:44")`);
    results.push(ok);
  }

  // Die Konstante selbst festnageln, damit sie nicht unbemerkt driftet.
  const c = require("../src/common.js");
  const ttlOk = c.CB_CATALOG_MAX_AGE_MS === 7 * DAY;
  console.log(`${ttlOk ? "PASS" : "FAIL"}  Cache-Dauer ist eine Woche (${c.CB_CATALOG_MAX_AGE_MS / DAY} Tage)`);
  results.push(ttlOk);

  console.log(results.every(Boolean) ? "\nALL PASS" : "\nSOME FAILED");
  process.exit(results.every(Boolean) ? 0 : 1);
})();
