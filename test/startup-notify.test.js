// Beim Browserstart werden alle Tabs der letzten Sitzung neu geladen und
// gescannt. Fuer diese Tabs darf KEINE Windows-Benachrichtigung erscheinen -
// der Nutzer hat keine dieser Seiten gerade geoeffnet. Die Zahl am Symbol
// muss trotzdem stimmen, und alles danach (neue Seite, Tabwechsel, Navigation
// im wiederhergestellten Tab) meldet sich wieder ganz normal.

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

// Zwei wiederhergestellte Hintergrundtabs plus der aktive Tab, den der Nutzer
// beim Start vor sich hat.
const RESTORED = [
  { id: 1, url: "https://shop.example/a", active: false },
  { id: 2, url: "https://shop.example/b", active: false },
  { id: 3, url: "https://shop.example/vorn", active: true },
];

function dealState(url) {
  return {
    status: "ok",
    url,
    portalOrigin: PORTAL,
    deals: [{ id: "1", title: "Shop", brand: "Shop", discount: "20%", url: PORTAL + "/o/1" }],
  };
}

function loadBackground() {
  const storage = makeStorage({ cbPortalOrigin: PORTAL, cbNotifyLevel: "notification" });
  const calls = { notification: 0, badge: 0 };
  const listeners = {};
  const captureEvent = (name) => ({
    addListener(fn) {
      listeners[name] = fn;
    },
  });

  const sandbox = {
    console: { log() {}, error() {}, warn() {} },
    setTimeout, clearTimeout, URL, Date, Set, Map, Number, String, JSON, Array, Object, Promise, Intl,
    chrome: {
      runtime: {
        onMessage: { addListener() {} },
        onStartup: captureEvent("startup"),
        onInstalled: captureEvent("installed"),
        getContexts: async () => [{}],
        sendMessage: async () => ({ ok: true, deals: [] }),
      },
      tabs: {
        onUpdated: noop(),
        onActivated: captureEvent("activated"),
        onRemoved: noop(),
        query: async () => RESTORED.map((t) => ({ ...t })),
        update: async () => {},
        get: (id, cb) => {
          const tab = RESTORED.find((t) => t.id === id);
          if (typeof cb === "function") return cb(tab ? { ...tab } : undefined);
          return Promise.resolve(tab ? { ...tab } : undefined);
        },
      },
      storage,
      permissions: { contains: async () => true },
      action: {
        setBadgeText() { calls.badge++; },
        setBadgeBackgroundColor() {},
        openPopup: async () => {},
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
  vm.runInContext("var __setState = setState;", sandbox);

  return {
    calls,
    listeners,
    // setState() geht ueber Badge und Meldung in einem - genau der Weg, den
    // ein echter Scan nimmt.
    async commit(tabId, url) {
      sandbox.__setState(tabId, dealState(url));
      await new Promise((r) => setTimeout(r, 20));
    },
  };
}

(async () => {
  // 1. Browserstart: wiederhergestellte Hintergrundtabs bleiben still.
  const bg = loadBackground();
  bg.listeners.startup();
  await bg.commit(1, "https://shop.example/a");
  await bg.commit(2, "https://shop.example/b");
  check(bg.calls.notification === 0, "Browserstart: keine Meldung fuer wiederhergestellte Tabs", JSON.stringify(bg.calls));
  check(bg.calls.badge === 2, "Browserstart: die Zahl am Symbol kommt trotzdem", JSON.stringify(bg.calls));

  // Der Tab, den der Nutzer beim Start vor sich hat, meldet sich einmal.
  await bg.commit(3, "https://shop.example/vorn");
  check(bg.calls.notification === 1, "der aktive Tab beim Start meldet sich", JSON.stringify(bg.calls));

  // 2. Danach neu aufgerufene Seiten melden sich normal.
  await bg.commit(4, "https://shop.example/neu");
  check(bg.calls.notification === 2, "eine danach geoeffnete Seite meldet sich", JSON.stringify(bg.calls));

  // 3. Navigiert ein wiederhergestellter Tab woanders hin, zaehlt das als
  //    Seitenaufruf.
  await bg.commit(1, "https://shop.example/anderswo");
  check(bg.calls.notification === 3, "Navigation im wiederhergestellten Tab meldet sich", JSON.stringify(bg.calls));

  // 4. Schaltet der Nutzer zu einem wiederhergestellten Tab, ist das ein
  //    bewusster Aufruf - beim naechsten Ergebnis darf es melden.
  bg.listeners.activated({ tabId: 2 });
  await new Promise((r) => setTimeout(r, 20));
  await bg.commit(2, "https://shop.example/b");
  check(bg.calls.notification === 4, "Hinschalten zum wiederhergestellten Tab meldet sich", JSON.stringify(bg.calls));

  // 5. Ohne Browserstart (normaler Betrieb) aendert sich nichts.
  const fresh = loadBackground();
  await fresh.commit(1, "https://shop.example/a");
  check(fresh.calls.notification === 1, "ohne Startereignis meldet sich jede Seite wie bisher", JSON.stringify(fresh.calls));

  console.log(results.every(Boolean) ? "\nALL PASS" : "\nFAILURES");
  process.exit(results.every(Boolean) ? 0 : 1);
})();
