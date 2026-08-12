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

  // Lange Liste: der Deckel greift, und zwar von vorn.
  const many = makeStorage({ cbMutedHosts: Array.from({ length: 250 }, (_, i) => `s${i}.example`) });
  const cm = loadCommon(many);
  await cm.setSiteMute("neu.example", "always");
  const list = many.sync.data.cbMutedHosts;
  check(
    list.length === 250 && list[list.length - 1] === "neu.example" && list[0] === "s1.example",
    "ueber dem Deckel faellt der aelteste Eintrag raus",
    `${list.length} Eintraege, erster ${list[0]}, letzter ${list[list.length - 1]}`
  );
  check((await cm.getSiteMute("s0.example")) === "off", "der verdraengte Eintrag meldet sich wieder");

  await cm.clearSiteMutes();
  check(
    many.sync.data.cbMutedHosts.length === 0 && many.session.data.cbMutedHostsSession.length === 0,
    "alle wieder einschalten leert beide Bereiche"
  );

  // --- Muster mit Platzhalter --------------------------------------------

  const pat = loadCommon(makeStorage({}));

  const matches = (pattern, host) => pat.muteEntryMatches(pattern, host);
  check(
    matches("*.google.com", "google.com") &&
      matches("*.google.com", "mail.google.com") &&
      matches("*.google.com", "www.google.com") &&
      matches("*.google.com", "a.b.google.com"),
    "*.google.com trifft die Domain selbst und jede Unterebene"
  );
  check(
    !matches("*.google.com", "evilgoogle.com") &&
      !matches("*.google.com", "google.com.beispiel.de") &&
      !matches("*.google.com", "google.de"),
    "*.google.com trifft keine fremde Domain, die nur so aussieht"
  );
  check(
    matches("google.*", "google.de") && matches("google.*", "google.co.uk") && matches("google.*", "www.google.com"),
    "google.* trifft die Laenderendungen"
  );
  check(
    !matches("google.*", "mail.google.de") && !matches("google.*", "notgoogle.de"),
    "google.* bleibt beim Namen selbst"
  );
  check(
    matches("*.google.*", "google.com") &&
      matches("*.google.*", "mail.google.de") &&
      matches("*.google.*", "docs.google.co.uk") &&
      matches("*.google.*", "a.b.google.fr"),
    "*.google.* deckt Unterebenen und Endungen zugleich ab"
  );
  check(
    !matches("*.google.*", "google.fremde-seite.de") && !matches("google.*", "google.fremde-seite.de"),
    "eine Endung, keine fremde Domain: google.fremde-seite.de bleibt aussen vor"
  );
  check(
    matches("*shop*.de", "meinshoponline.de") && !matches("*shop*.de", "shop.beispiel.de"),
    "* in der Mitte bleibt innerhalb eines Namensteils"
  );
  check(
    pat.muteEntryKey("https://mail.google.com/mail/u/0?x=1") === "mail.google.com",
    "eine eingefuegte URL wird zum Host",
    pat.muteEntryKey("https://mail.google.com/mail/u/0?x=1")
  );
  check(pat.domainMutePattern("mail.google.com") === "*.google.com", "Vorschlag fuer die ganze Domain");
  check(pat.domainMutePattern("shop.beispiel.co.uk") === "*.beispiel.co.uk", "zweiteilige Endung bleibt beisammen");
  check(
    pat.isValidMuteEntry("*.google.com") && !pat.isValidMuteEntry("google") && !pat.isValidMuteEntry("a b.de"),
    "Eingabepruefung laesst nur Hostnamen und Muster durch"
  );

  // Wirkung im Speicher: ein Muster stellt alle passenden Seiten still und
  // raeumt die Einzeleintraege weg, die es ohnehin abdeckt.
  const ps = makeStorage({ cbMutedHosts: ["mail.google.com", "beispiel.de"] });
  const pc = loadCommon(ps);
  await pc.setSiteMute("*.google.com", "always");
  check(
    ps.sync.data.cbMutedHosts.join() === "beispiel.de,*.google.com",
    "das Muster ersetzt die abgedeckten Einzeleintraege",
    JSON.stringify(ps.sync.data.cbMutedHosts)
  );
  check((await pc.getSiteMute("docs.google.com")) === "always", "nie besuchte Unterseiten sind mit abgeschaltet");
  const hit = await pc.getSiteMuteMatch("docs.google.com");
  check(hit.entry === "*.google.com", "der ausloesende Eintrag wird mitgeliefert", JSON.stringify(hit));
  check((await pc.getSiteMute("beispiel.de")) === "always", "der fremde Einzeleintrag bleibt stehen");

  await pc.setSiteMute(hit.entry, "off");
  check(
    (await pc.getSiteMute("docs.google.com")) === "off" && ps.sync.data.cbMutedHosts.join() === "beispiel.de",
    "wieder einschalten loescht das Muster, nicht den Hostnamen"
  );

  // --- background.js: meldet sich nicht mehr, zaehlt aber weiter ----------

  for (const [mode, wantPopup] of [["off", true], ["session", false], ["always", false], ["pattern", false]]) {
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
  // Die Seite selbst steht nicht in der Liste - nur ein Muster, das sie deckt.
  if (mode === "pattern") storage.sync.data.cbMutedHosts = ["*.example"];

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
