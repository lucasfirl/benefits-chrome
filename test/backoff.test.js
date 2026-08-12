// Prueft die Sperrfristen nach Fehlschlaegen.
//
// Ohne sie stiess jeder Seitenaufruf ohne gueltigen Katalog einen neuen
// Katalog-Sync an. Bei abgelaufener Anmeldung waren das zwei vergebliche
// Portalanfragen pro besuchter Seite - dauerhaft, und ausgerechnet gegen ein
// Portal, das sie ohnehin abweist.

const fs = require("fs");
const vm = require("vm");
const path = require("path");

const EXT = path.join(__dirname, "..");
const PORTAL = "https://example.mitarbeiterangebote.de";
const noop = () => ({ addListener() {} });

function load({ catalog = null } = {}) {
  const sandbox = {
    console: { log() {}, error() {}, warn() {} },
    setTimeout, clearTimeout, URL, Date, Set, Map, Number, String, JSON, Array, Object, Promise,
    chrome: {
      runtime: { onMessage: { addListener() {} }, getContexts: async () => [{}], sendMessage: async () => ({ ok: true, deals: [] }), lastError: null },
      tabs: { onUpdated: noop(), onActivated: noop(), onRemoved: noop(), get() {}, query: async () => [], update: async () => {} },
      storage: {
        sync: { get: async () => ({ cbPortalOrigin: PORTAL, cbNotifyLevel: "silent" }) },
        session: { set: async () => {}, get: async () => ({}) },
        local: { get: async () => (catalog ? { cbCatalog: catalog } : {}), set: async () => {} },
      },
      permissions: { contains: async () => true },
      action: { setBadgeText() {}, setBadgeBackgroundColor() {}, openPopup: async () => {} },
      scripting: { getRegisteredContentScripts: async () => [], registerContentScripts: async () => {}, unregisterContentScripts: async () => {} },
      notifications: { create() {}, clear() {}, onClicked: noop(), onButtonClicked: noop() },
      offscreen: { createDocument: async () => {} },
      alarms: { create() {}, onAlarm: { addListener() {} } },
      i18n: { getMessage: (k) => k },
    },
    fetch: async () => { throw new Error("darf hier nicht aufgerufen werden"); },
    importScripts() {
      vm.runInContext(fs.readFileSync(path.join(EXT, "common.js"), "utf8"), sandbox, { filename: "common.js" });
    },
  };
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(path.join(EXT, "background.js"), "utf8"), sandbox, { filename: "background.js" });
  vm.runInContext("var __scheduleScan = scheduleScan; var __tabResults = tabResults; var __syncCatalog = syncCatalog;", sandbox);

  const calls = { sync: 0, search: 0 };
  sandbox.__sync = async () => { calls.sync++; return { ok: false, error: "not-logged-in", portalOrigin: PORTAL }; };
  sandbox.__search = async () => { calls.search++; return "not-logged-in"; };
  vm.runInContext("syncCatalog = __sync; searchPortal = __search;", sandbox);
  return { sandbox, calls };
}

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const results = [];
const check = (ok, label, detail) => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}`);
  if (detail) console.log(`        ${detail}`);
  results.push(ok);
};

(async () => {
  // 1) Ausgeloggt, 5 Seiten: nur der erste Aufruf darf ans Portal gehen.
  {
    const { sandbox, calls } = load();
    await wait(20);
    for (let i = 0; i < 5; i++) {
      sandbox.__scheduleScan(100 + i, `https://shop${i}.example.com/`, null);
      await wait(400);
    }
    check(
      calls.search === 1 && calls.sync <= 1,
      "ausgeloggt: 5 Seitenaufrufe erzeugen hoechstens 1 Anfragerunde",
      `syncCatalog: ${calls.sync}, searchPortal: ${calls.search} (vorher je 5)`
    );
  }

  // 2) Trotz Sperre muss der Status weiterhin korrekt gemeldet werden.
  {
    const { sandbox } = load();
    await wait(20);
    sandbox.__scheduleScan(200, "https://a.example.com/", null);
    await wait(400);
    sandbox.__scheduleScan(201, "https://b.example.com/", null);
    await wait(400);
    const st = sandbox.__tabResults.get(201) || {};
    check(st.status === "not-logged-in", "gesperrter Scan meldet trotzdem 'nicht angemeldet'", `status=${st.status}`);
  }

  // 3) Klick des Nutzers (force) muss die Sperre aufheben.
  {
    const { sandbox, calls } = load();
    await wait(20);
    sandbox.__scheduleScan(300, "https://a.example.com/", null);
    await wait(400);
    const before = calls.sync;
    await vm.runInContext("syncCatalog({force:true})", sandbox);
    check(calls.sync === before + 1, "expliziter Refresh ignoriert die Sperre", `sync ${before} -> ${calls.sync}`);
  }

  // 4) Hostname-Vergleich: fremde Seite darf nicht als Portal gelten.
  {
    const { sandbox } = load();
    await wait(20);
    // "te.de" steckt als Teilstring in "example.mitarbeiterangebote.de"
    sandbox.__scheduleScan(400, "https://te.de/", null);
    await wait(400);
    const st = sandbox.__tabResults.get(400) || {};
    check(st.status !== "not-applicable", "Teilstring-Domain wird nicht als Portal behandelt", `status=${st.status}`);
  }

  // 5) Das echte Portal selbst muss weiterhin uebersprungen werden.
  {
    const { sandbox } = load();
    await wait(20);
    sandbox.__scheduleScan(500, PORTAL + "/offer/123", null);
    await wait(400);
    const st = sandbox.__tabResults.get(500) || {};
    check(st.status === "not-applicable", "das Portal selbst wird uebersprungen", `status=${st.status}`);
  }

  console.log(`\n${results.filter(Boolean).length}/${results.length}`);
  process.exit(results.every(Boolean) ? 0 : 1);
})();
