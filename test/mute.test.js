// Prueft das Abschalten der automatischen Meldung je Seite.
//
// Zwei Dinge duerfen nicht verrutschen: "Pause" darf nur in der Sitzung
// stehen (sonst ueberlebt es den Browserstart und wirkt dauerhaft), und
// "Nie" muss in storage.sync landen. Und die Meldung selbst muss beides
// respektieren - die Zahl am Symbol bleibt davon unberuehrt.

const fs = require("fs");
const vm = require("vm");
const path = require("path");

const EXT = path.join(__dirname, "..");
const PORTAL = "https://example.mitarbeiterangebote.de";
const noop = () => ({ addListener() {} });

const results = [];
const check = (ok, label, detail) => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}`);
  if (detail) console.log(`        ${detail}`);
  results.push(ok);
};

/** Minimaler chrome.storage-Ersatz mit echtem Zustand. */
function makeStorage(initialSync) {
  const area = (data) => ({
    data,
    async get(key) {
      if (key == null) return { ...data };
      const keys = Array.isArray(key) ? key : [key];
      const out = {};
      keys.forEach((k) => {
        if (k in data) out[k] = data[k];
      });
      return out;
    },
    async set(patch) {
      Object.assign(data, patch);
    },
  });
  return { sync: area({ ...initialSync }), session: area({}), local: area({}) };
}

function loadCommon(storage) {
  const sandbox = { chrome: { storage }, Set, Promise, Object, Array, String, Date, Intl, URL, console };
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(path.join(EXT, "common.js"), "utf8"), sandbox, { filename: "common.js" });
  return sandbox;
}

// --- common.js: die Zustaende selbst --------------------------------------

(async () => {
  const storage = makeStorage({});
  const c = loadCommon(storage);

  check((await c.getSiteMute("www.example.com")) === "off", "unbekannte Seite ist nicht abgeschaltet");

  await c.setSiteMute("www.Example.com", "session");
  check(
    storage.session.data.cbMutedHostsSession.join() === "example.com" &&
      !(storage.sync.data.cbMutedHosts || []).length,
    "Pause steht nur in der Sitzung, ohne www. und klein",
    JSON.stringify({ session: storage.session.data, sync: storage.sync.data })
  );
  check((await c.getSiteMute("example.com")) === "session", "Pause wird zurueckgelesen");

  await c.setSiteMute("example.com", "always");
  check(
    storage.sync.data.cbMutedHosts.join() === "example.com" &&
      storage.session.data.cbMutedHostsSession.length === 0,
    "Nie ersetzt die Pause statt sich zu stapeln",
    JSON.stringify({ session: storage.session.data, sync: storage.sync.data })
  );
  check((await c.getSiteMute("www.example.com")) === "always", "Nie gilt auch fuer die www-Schreibweise");

  await c.setSiteMute("example.com", "off");
  check(
    (await c.getSiteMute("example.com")) === "off" && storage.sync.data.cbMutedHosts.length === 0,
    "wieder einschalten raeumt beide Listen"
  );

  await c.setSiteMute("other.example", "always");
  check((await c.getSiteMute("example.com")) === "off", "andere Seiten bleiben unberuehrt");

  // --- background.js: meldet sich nicht mehr, zaehlt aber weiter ----------

  for (const [mode, wantPopup] of [["off", true], ["session", false], ["always", false]]) {
    const bg = loadBackground(mode);
    await bg.notify();
    check(
      bg.calls.popup === (wantPopup ? 1 : 0) && bg.calls.notification === 0,
      `Modus "${mode}": Popup ${wantPopup ? "oeffnet" : "bleibt zu"}`,
      JSON.stringify(bg.calls)
    );
    check(bg.calls.badge > 0, `Modus "${mode}": Zahl am Symbol bleibt`);
  }

  console.log(results.every(Boolean) ? "\nALL PASS" : "\nFAILURES");
  process.exit(results.every(Boolean) ? 0 : 1);
})();

function loadBackground(mode) {
  const storage = makeStorage({ cbPortalOrigin: PORTAL, cbNotifyLevel: "popup" });
  if (mode === "session") storage.session.data.cbMutedHostsSession = ["shop.example"];
  if (mode === "always") storage.sync.data.cbMutedHosts = ["shop.example"];

  const calls = { popup: 0, notification: 0, badge: 0 };
  const sandbox = {
    console: { log() {}, error() {}, warn() {} },
    setTimeout, clearTimeout, URL, Date, Set, Map, Number, String, JSON, Array, Object, Promise, Intl,
    chrome: {
      runtime: { onMessage: { addListener() {} }, getContexts: async () => [{}], sendMessage: async () => ({ ok: true, deals: [] }) },
      tabs: {
        onUpdated: noop(), onActivated: noop(), onRemoved: noop(), query: async () => [], update: async () => {},
        get: async () => ({ id: 1, active: true, windowId: 1, url: "https://shop.example/x" }),
      },
      storage,
      permissions: { contains: async () => true },
      action: {
        setBadgeText() { calls.badge++; },
        setBadgeBackgroundColor() {},
        openPopup: async () => { calls.popup++; },
      },
      scripting: { getRegisteredContentScripts: async () => [], registerContentScripts: async () => {}, unregisterContentScripts: async () => {} },
      notifications: { create() { calls.notification++; }, clear() {}, onClicked: noop(), onButtonClicked: noop() },
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

  const state = {
    status: "ok",
    url: "https://shop.example/x",
    portalOrigin: PORTAL,
    deals: [{ id: "1", title: "Shop", brand: "Shop", discount: "20%", url: PORTAL + "/o/1" }],
  };
  // setState() geht ueber Badge und Meldung in einem - genau der Weg, den ein
  // echter Scan nimmt.
  vm.runInContext("var __setState = setState;", sandbox);
  return {
    calls,
    notify: async () => {
      sandbox.__setState(1, state);
      // maybeNotify() laeuft ungebremst neben setState() - kurz warten.
      await new Promise((r) => setTimeout(r, 20));
    },
  };
}
