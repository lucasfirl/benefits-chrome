// Loads the REAL background.js + common.js into a vm sandbox with stubbed
// chrome APIs, then replays the exact event orderings a browser produces,
// asserting that the accurate (hint-based) result is what ends up committed.

const fs = require("fs");
const vm = require("vm");
const path = require("path");

const EXT = path.join(__dirname, "..");
const PORTAL = "https://example.mitarbeiterangebote.de";

function makeChromeStub() {
  const noopEvent = () => ({ addListener() {} });
  return {
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
      sync: { get: async () => ({ cbPortalOrigin: PORTAL, cbNotifyLevel: "silent" }) },
      session: { set: async () => {}, get: async () => ({}) },
      // Kein Katalog hinterlegt -> scanTab muss auf die Live-Suche zurueckfallen.
      local: { get: async () => ({}), set: async () => {} },
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
  };
}

function loadBackground() {
  const sandbox = {
    chrome: makeChromeStub(),
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
      throw new Error("network should be stubbed via searchPortal override");
    },
    importScripts() {
      const src = fs.readFileSync(path.join(EXT, "common.js"), "utf8");
      vm.runInContext(src, sandbox, { filename: "common.js" });
    },
  };
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  const src = fs.readFileSync(path.join(EXT, "background.js"), "utf8");
  vm.runInContext(src, sandbox, { filename: "background.js" });

  // `const` bindings (tabResults) live in the script's declarative scope, not
  // on the context object - re-expose what the test needs as globals.
  vm.runInContext(
    "var __tabResults = tabResults; var __scheduleScan = scheduleScan;",
    sandbox
  );

  // Replace the network layer: only the real brand name yields a deal, exactly
  // like the live portal (domain guess "easyairportparking" finds nothing).
  const searched = [];
  sandbox.__stubSearch = async (origin, term) => {
    searched.push(term);
    await new Promise((r) => setTimeout(r, 10));
    if (term.toLowerCase() === "easy airport parking") {
      return [{ id: "39587", title: "Easy Airport Parking", discount: "15% Rabatt", url: "/offer/39587" }];
    }
    return [];
  };
  vm.runInContext("searchPortal = __stubSearch;", sandbox);

  return { sandbox, searched };
}

const PAGE_URL = "https://www.easyairportparking.de/parkplatz/berlin";
const ROOT_URL = "https://www.easyairportparking.de/";
const HINTS = ["Easy Airport Parking", "Parken am Flughafen"];
const TAB = 1699895076;

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

async function scenario(name, steps) {
  const { sandbox, searched } = loadBackground();
  await wait(5); // let the top-level auto-scan IIFE settle
  await steps(sandbox);
  await wait(400); // debounce (300ms) + stubbed network
  const state = sandbox.__tabResults.get(TAB);
  const deals = (state && state.deals) || [];
  const ok = deals.length === 1;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}`);
  console.log(`        searched terms : ${JSON.stringify(searched)}`);
  console.log(`        deals committed: ${deals.length}  brand: ${state && state.brand}`);
  return ok;
}

(async () => {
  const results = [];

  // The ordering that was broken: content script reports hints, then the tab's
  // "complete" event (or a tab switch) schedules a hintless scan right after.
  results.push(
    await scenario("hints first, then hintless tab-complete", async (s) => {
      s.__scheduleScan(TAB, PAGE_URL, HINTS);
      await wait(20);
      s.__scheduleScan(TAB, ROOT_URL); // onUpdated/onActivated, no hints
    })
  );

  // The reverse ordering (already worked, must not regress).
  results.push(
    await scenario("hintless tab-complete first, then hints", async (s) => {
      s.__scheduleScan(TAB, ROOT_URL);
      await wait(20);
      s.__scheduleScan(TAB, PAGE_URL, HINTS);
    })
  );

  // A later tab switch must still show the deal, not wipe the badge.
  results.push(
    await scenario("hints, settle, then tab re-activation", async (s) => {
      s.__scheduleScan(TAB, PAGE_URL, HINTS);
      await wait(400);
      s.__scheduleScan(TAB, ROOT_URL); // user switches back to this tab
    })
  );

  // Hints must NOT leak to a different site.
  const { sandbox } = loadBackground();
  await wait(5);
  sandbox.__scheduleScan(TAB, PAGE_URL, HINTS);
  await wait(400);
  sandbox.__scheduleScan(TAB, "https://www.example.com/");
  await wait(400);
  const leaked = (sandbox.__tabResults.get(TAB).deals || []).length;
  const noLeak = leaked === 0;
  console.log(`${noLeak ? "PASS" : "FAIL"}  hints do not leak to another hostname`);
  console.log(`        deals committed: ${leaked} (want 0)`);
  results.push(noLeak);

  console.log(results.every(Boolean) ? "\nALL PASS" : "\nSOME FAILED");
  process.exit(results.every(Boolean) ? 0 : 1);
})();
