// Prueft, dass eine abgelaufene Portal-Sitzung als solche erkannt wird -
// auch wenn das Portal nicht auf /login umleitet, sondern still auf die
// Startseite oder auf die Domain eines anderen Mandanten.

const fs = require("fs");
const vm = require("vm");
const path = require("path");
const test = require("node:test");
const assert = require("node:assert");

const EXT = path.join(__dirname, "..", "src");
const PORTAL = "https://example.mitarbeiterangebote.de";

function loadBackground() {
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
      runtime: { onMessage: { addListener() {} } },
      tabs: { onUpdated: noopEvent(), onActivated: noopEvent(), onRemoved: noopEvent() },
      storage: {
        sync: { get: async () => ({ cbPortalOrigin: PORTAL }) },
        session: { set: async () => {}, get: async () => ({}) },
        local: { get: async () => ({}), set: async () => {} },
      },
      permissions: { contains: async () => true },
      action: { setBadgeText() {}, setBadgeBackgroundColor() {} },
      scripting: {
        getRegisteredContentScripts: async () => [],
        registerContentScripts: async () => {},
        unregisterContentScripts: async () => {},
      },
      notifications: { onClicked: noopEvent(), onButtonClicked: noopEvent() },
      alarms: { create() {}, onAlarm: { addListener() {} } },
      i18n: { getMessage: (k) => k },
    },
    fetch: async () => {
      throw new Error("kein Netz im Test");
    },
    importScripts() {
      vm.runInContext(fs.readFileSync(path.join(EXT, "common.js"), "utf8"), sandbox, { filename: "common.js" });
    },
  };
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(path.join(EXT, "background.js"), "utf8"), sandbox, { filename: "background.js" });
  return sandbox;
}

test("Umleitungen, die eine abgelaufene Sitzung bedeuten", () => {
  const sandbox = loadBackground();
  const check = (p, url) => sandbox.isLoggedOutRedirect(PORTAL, p, url);

  // Genau der Fall aus dem Feld: /overview/41 landet auf der Startseite
  // eines anderen Mandanten.
  assert.equal(check("/overview/41", "https://other-tenant.mitarbeiterangebote.de/"), true);
  assert.equal(check("/", "https://other-tenant.mitarbeiterangebote.de/"), true);
  // Klassische Login-Umleitung.
  assert.equal(check("/overview/41", PORTAL + "/login?next=%2Foverview%2F41"), true);
  // Unterseite -> eigene Startseite: stille Abweisung.
  assert.equal(check("/overview/41", PORTAL + "/"), true);
  assert.equal(check("/search?s=Philips", PORTAL), true);
});

test("harmlose Umleitungen bleiben harmlos", () => {
  const sandbox = loadBackground();
  const check = (p, url) => sandbox.isLoggedOutRedirect(PORTAL, p, url);

  // Trailing-Slash und Pfadkanonisierung auf derselben Domain.
  assert.equal(check("/overview/41", PORTAL + "/overview/41/"), false);
  assert.equal(check("/overview/41", PORTAL + "/kategorie/reisen"), false);
  // Die Startseite darf auf der Startseite landen.
  assert.equal(check("/", PORTAL + "/"), false);
});
