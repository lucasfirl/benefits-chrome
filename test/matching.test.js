// Prueft den lokalen Namensabgleich. Die Faelle sind bewusst so gewaehlt,
// dass sowohl echte Treffer als auch Fehltreffer abgedeckt sind - ein zu
// grosszuegiger Abgleich waere schlimmer als ein verpasster Treffer, weil er
// falsche Rabatte anzeigen wuerde.

const c = require("../common.js");

const CASES = [
  // [Kandidat, Katalog-Marke, erwartet, Begruendung]
  ["easyairportparking", "Easy Airport Parking", true, "der urspruengliche Bug - Domain ohne Trenner"],
  ["Easy Airport Parking", "Easy Airport Parking", true, "exakte Uebereinstimmung"],
  ["EASYAIRPORTPARKING", "easy airport parking", true, "Gross-/Kleinschreibung egal"],
  ["bosch", "Bosch Siemens Hausgeräte", true, "Marke beginnt mit dem Kandidaten"],
  ["Philips Deutschland", "Philips", true, "Kandidat beginnt mit der Marke"],
  ["hausgeraete", "Hausgeräte", true, "Umlaut als ae geschrieben"],
  ["hausgerate", "Hausgeräte", true, "Umlaut ohne e geschrieben"],
  ["sixt", "SIXT Autovermietung", true, "Versalien in der Marke"],
  ["beyerdynamic", "beyerdynamic", true, "durchgehend klein"],

  ["on", "On", true, "kurze Marke exakt - muss treffen"],
  ["byd", "BYD", true, "kurze Marke exakt"],

  ["github", "Philips", false, "voellig verschieden"],
  ["onlineshop", "On", false, "kurze Marke darf NICHT per Praefix treffen"],
  ["onrunning", "On", false, "Praefix reicht bei kurzer Marke nicht"],
  ["boschhome", "Bosch Siemens Hausgeräte", false, "anderer Bosch-Shop, keine Praefixbeziehung"],
  ["ebay", "Bay", false, "Teilstring in der Mitte reicht nicht"],
];

let pass = 0;
for (const [candidate, brand, want, why] of CASES) {
  const got = c.namesMatch(candidate, brand);
  const ok = got === want;
  if (ok) pass++;
  console.log(
    `${ok ? "PASS" : "FAIL"}  ${String(got).padEnd(5)} ${(candidate + " ~ " + brand).padEnd(44)} ${why}`
  );
}

// matchCatalog: Reihenfolge der Kandidaten bestimmt die Reihenfolge der Treffer
const offers = [
  { id: "1", brand: "Philips" },
  { id: "2", brand: "Easy Airport Parking" },
];
const hits = c.matchCatalog(offers, ["Easy Airport Parking", "Philips"]);
const orderOk = hits.length === 2 && hits[0].offer.id === "2";
console.log(`${orderOk ? "PASS" : "FAIL"}  matchCatalog liefert bester Kandidat zuerst`);
if (orderOk) pass++;

// Keine Dubletten, wenn mehrere Kandidaten dasselbe Angebot treffen
const dupes = c.matchCatalog([{ id: "1", brand: "Philips" }], ["Philips", "philips", "Philips Deutschland"]);
const dupeOk = dupes.length === 1;
console.log(`${dupeOk ? "PASS" : "FAIL"}  keine Dubletten bei mehreren passenden Kandidaten`);
if (dupeOk) pass++;

const total = CASES.length + 2;
console.log(`\n${pass}/${total}`);
process.exit(pass === total ? 0 : 1);
