// Prueft die Einstellung "Woraus der Markenname geraten wird" am echten
// background.js: einmal mit Seitentitel (Standard), einmal ohne.
//
// Der Anlass war ein Fehltreffer auf github.com/lucasfirl/VM-Manager: der
// Seitentitel wird an Trennzeichen zerlegt, das Bruchstueck "Manager" traf
// per Praefix-Regel die Marke "manager magazin".

const fs = require("fs");
const vm = require("vm");
const path = require("path");

const EXT = path.join(__dirname, "..");
const PORTAL = "https://example.mitarbeiterangebote.de";

const CATALOG = {
  portalOrigin: PORTAL,
  fetchedAt: Date.now(),
  offers: [
    { id: "1", brand: "manager magazin", title: "manager magazin", discount: "55%" },
    { id: "2", brand: "Easy Airport Parking", title: "Easy Airport Parking", discount: "15%" },
  ],
};

function loadBackground(matchSources) {
  const noopEvent = () => ({ addListener() {} });
  const sync = { cbPortalOrigin: PORTAL, cbNotifyLevel: "silent" };
  if (matchSources) sync.cbMatchSources = matchSources;

  const sandbox = {
    chrome: {
      runtime: {
        onMessage: { addListener() {} },
        getContexts: async () => [{}],
        sendMessage: async () => ({ ok: true, deals: [] }),
        lastError: null,
      },
      tabs: {
        onUpdated: noopEvent(),
        onActivated: noopEvent(),
        onRemoved: noopEvent(),
        get() {},
        query: async () => [],
        update: async () => {},
      },
      storage: {
        sync: { get: async () => sync },
        session: { set: async () => {}, get: async () => ({}) },
        local: { get: async () => ({ cbCatalog: CATALOG }), set: async () => {} },
      },
      alarms: { create() {}, onAlarm: { addListener() {} } },
      permissions: { contains: async () => true },
      action: { setBadgeText() {}, setBadgeBackgroundColor() {}, openPopup: async () => {} },
      scripting: {
        getRegisteredContentScripts: async () => [],
        registerContentScripts: async () => {},
        unregisterContentScripts: async () => {},
      },
      notifications: { create() {}, clear() {}, onClicked: noopEvent(), onButtonClicked: noopEvent() },
      offscreen: { createDocument: async () => {} },
      i18n: { getMessage: (k) => k },
    },
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
    fetch: async () => {
      throw new Error("der Katalog ist frisch - es darf nichts geladen werden");
    },
    importScripts() {
      vm.runInContext(fs.readFileSync(path.join(EXT, "common.js"), "utf8"), sandbox, {
        filename: "common.js",
      });
    },
  };
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(path.join(EXT, "background.js"), "utf8"), sandbox, {
    filename: "background.js",
  });
  vm.runInContext("var __tabResults = tabResults; var __scheduleScan = scheduleScan;", sandbox);
  return sandbox;
}

const TAB = 42;
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

async function scan({ matchSources, url, hints }) {
  const sandbox = loadBackground(matchSources);
  await wait(5); // die Auto-Scan-IIFE am Dateiende durchlaufen lassen
  sandbox.__scheduleScan(TAB, url, hints);
  await wait(400); // Entprellung (300 ms) + Katalogabgleich
  const state = sandbox.__tabResults.get(TAB) || {};
  return (state.deals || []).map((d) => d.brand);
}

const CASES = [
  {
    name: "Standard: Titelbruchstueck 'Manager' trifft 'manager magazin' NICHT",
    matchSources: null,
    url: "https://github.com/lucasfirl/VM-Manager",
    // genau das, was deriveHintCandidates aus "lucasfirl/VM-Manager" macht
    hints: ["Manager", "lucasfirl/VM"],
    want: [],
  },
  {
    name: "Standard: exakter Titel findet die Marke weiterhin",
    matchSources: null,
    url: "https://www.easyairportparking.de/parkplatz/berlin",
    hints: ["Easy Airport Parking"],
    want: ["Easy Airport Parking"],
  },
  {
    name: "Standard: die Domain trifft auch ohne Titel",
    matchSources: null,
    url: "https://www.easyairportparking.de/",
    hints: undefined,
    want: ["Easy Airport Parking"],
  },
  {
    name: "Nur Domain: der Seitentitel wird gar nicht erst angesehen",
    matchSources: "domain",
    url: "https://intranet.example.org/wiki/Easy_Airport_Parking",
    hints: ["Easy Airport Parking"],
    want: [],
  },
  {
    name: "Nur Domain: die Domain selbst trifft unveraendert",
    matchSources: "domain",
    url: "https://www.easyairportparking.de/",
    hints: ["Easy Airport Parking"],
    want: ["Easy Airport Parking"],
  },
];

(async () => {
  let pass = 0;
  for (const testCase of CASES) {
    const got = await scan(testCase);
    const ok = JSON.stringify(got) === JSON.stringify(testCase.want);
    if (ok) pass++;
    console.log(`${ok ? "PASS" : "FAIL"}  ${testCase.name}`);
    console.log(`        Treffer: ${JSON.stringify(got)}  (erwartet ${JSON.stringify(testCase.want)})`);
  }
  console.log(pass === CASES.length ? "\nALL PASS" : "\nSOME FAILED");
  process.exit(pass === CASES.length ? 0 : 1);
})();
