// Prueft die Allowlist in package.ps1 gegen das, was der Code tatsaechlich
// braucht.
//
// Zwei Fehlerarten sollen auffallen, bevor jemand ein kaputtes oder zu volles
// Paket hochlaedt:
//   - eine referenzierte Datei fehlt in der Allowlist  -> Erweiterung bricht
//   - die Allowlist listet etwas Nichtexistentes/Ueberfluessiges
//
// Die Allowlist ist bewusst eine Positivliste: im Projektordner liegen Tests,
// Doku und Test-Snapshots, die niemals mitverteilt werden duerfen.

const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const SRC = path.join(ROOT, "src");

// Die Allowlist ist relativ zu src/ gedacht: manifest.json muss in der Wurzel
// des ZIP liegen, nicht in einem src-Unterordner. Alles, was mit Paketinhalt
// zu tun hat, wird darum unter SRC aufgeloest - nur package.ps1 selbst liegt
// im Projektstamm.
const read = (f) => fs.readFileSync(path.join(SRC, f), "utf8");
const readRoot = (f) => fs.readFileSync(path.join(ROOT, f), "utf8");

// --- 1) Was braucht der Code? -------------------------------------------

const referenced = new Map(); // datei -> Begruendung
const add = (file, why) => {
  if (!file) return;
  const f = file.replace(/^\.\//, "");
  referenced.set(f, referenced.has(f) ? referenced.get(f) + ", " + why : why);
};

const mf = JSON.parse(read("manifest.json"));
add("manifest.json", "Paketwurzel");
Object.entries(mf.icons || {}).forEach(([s, p]) => add(p, `manifest.icons[${s}]`));
Object.entries((mf.action || {}).default_icon || {}).forEach(([s, p]) => add(p, `default_icon[${s}]`));
add(mf.action && mf.action.default_popup, "action.default_popup");
add(mf.background && mf.background.service_worker, "service_worker");
add(mf.options_page, "options_page");
if (mf.default_locale) {
  for (const loc of fs.readdirSync(path.join(SRC, "_locales"))) {
    add(`_locales/${loc}/messages.json`, `locale ${loc}`);
  }
}

for (const html of ["popup.html", "options.html", "offscreen.html"]) {
  const src = read(html);
  for (const m of src.matchAll(/(?:src|href)="([^"]+)"/g)) {
    const u = m[1];
    if (!/^(https?:|#|data:)/.test(u)) add(u, html);
  }
}

for (const js of ["background.js", "popup.js", "options.js", "offscreen.js", "common.js", "content-hints.js"]) {
  const src = read(js);
  for (const m of src.matchAll(/importScripts\("([^"]+)"\)/g)) add(m[1], `${js}: importScripts`);
  for (const m of src.matchAll(/js:\s*\[([^\]]+)\]/g)) {
    for (const f of m[1].matchAll(/"([^"]+)"/g)) add(f[1], `${js}: content script`);
  }
  for (const m of src.matchAll(/url:\s*"([^"]+\.html)"/g)) add(m[1], `${js}: offscreen`);
  for (const m of src.matchAll(/iconUrl:\s*"([^"]+)"/g)) add(m[1], `${js}: notification`);
}

// --- 2) Was listet die Allowlist? ---------------------------------------

const ps1 = readRoot("package.ps1");
const block = ps1.match(/\$allow\s*=\s*@\(([\s\S]*?)\)/);
if (!block) {
  console.log("FAIL  Allowlist in package.ps1 nicht gefunden");
  process.exit(1);
}
const allow = [...block[1].matchAll(/"([^"]+)"/g)].map((m) => m[1]);

const covers = (file) =>
  allow.some((entry) => file === entry || file.startsWith(entry.replace(/\/$/, "") + "/"));

// --- 3) Vergleich --------------------------------------------------------

let pass = 0;
let fail = 0;

const uncovered = [...referenced.keys()].filter((f) => !covers(f));
if (uncovered.length === 0) {
  console.log(`PASS  alle ${referenced.size} referenzierten Dateien sind in der Allowlist`);
  pass++;
} else {
  console.log("FAIL  nicht in der Allowlist (Erweiterung waere kaputt):");
  uncovered.forEach((f) => console.log(`        ${f}  <- ${referenced.get(f)}`));
  fail++;
}

const ghosts = allow.filter((e) => !fs.existsSync(path.join(SRC, e)));
if (ghosts.length === 0) {
  console.log(`PASS  alle ${allow.length} Allowlist-Eintraege existieren`);
  pass++;
} else {
  console.log("FAIL  Allowlist nennt nicht vorhandene Pfade:");
  ghosts.forEach((f) => console.log(`        ${f}`));
  fail++;
}

// Allowlist-Eintraege, die von nichts gebraucht werden (Ballast)
const unusedEntries = allow.filter((entry) => {
  const isDir = fs.existsSync(path.join(SRC, entry)) && fs.statSync(path.join(SRC, entry)).isDirectory();
  if (isDir) return ![...referenced.keys()].some((f) => f.startsWith(entry + "/"));
  return !referenced.has(entry);
});
if (unusedEntries.length === 0) {
  console.log("PASS  kein Ballast in der Allowlist");
  pass++;
} else {
  console.log("FAIL  Allowlist enthaelt Ungebrauchtes:");
  unusedEntries.forEach((f) => console.log(`        ${f}`));
  fail++;
}

// Sicherheitsnetz: Dateien, die NIE ins Paket duerfen
const forbidden = ["README.md", "PRIVACY.md", "STORE-LISTING.md", "package.ps1", "test", "dist", "docs", ".playwright-mcp"];
const leaked = forbidden.filter((f) => covers(f));
if (leaked.length === 0) {
  console.log("PASS  keine Doku-/Test-/Schluesseldateien von der Allowlist erfasst");
  pass++;
} else {
  console.log("FAIL  Allowlist wuerde Folgendes mitpacken:");
  leaked.forEach((f) => console.log(`        ${f}`));
  fail++;
}

console.log(`\n${pass}/${pass + fail}`);
process.exit(fail === 0 ? 0 : 1);
