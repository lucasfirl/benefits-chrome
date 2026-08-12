// Prueft den lokalen Namensabgleich. Die Faelle sind bewusst so gewaehlt,
// dass sowohl echte Treffer als auch Fehltreffer abgedeckt sind - ein zu
// grosszuegiger Abgleich waere schlimmer als ein verpasster Treffer, weil er
// falsche Rabatte anzeigen wuerde.

const c = require("../src/common.js");

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

// Kandidaten aus dem Seitentitel duerfen nur exakt treffen. Der Fall aus der
// Praxis: github.com/lucasfirl/VM-Manager -> Titelbruchstueck "Manager" traf
// per Praefix-Regel die Marke "manager magazin".
const EXACT_CASES = [
  ["Manager", "manager magazin", false, "Titelbruchstueck darf keine laengere Marke treffen"],
  ["bosch", "Bosch Siemens Hausgeräte", false, "Praefix-Regel ist abgeschaltet"],
  ["Philips Deutschland", "Philips", false, "auch die umgekehrte Praefix-Regel"],
  ["Easy Airport Parking", "Easy Airport Parking", true, "exakt trifft weiterhin"],
  ["EASYAIRPORTPARKING", "easy airport parking", true, "Schreibweise bleibt egal"],
];
for (const [candidate, brand, want, why] of EXACT_CASES) {
  const got = c.namesMatch(candidate, brand, { exact: true });
  const ok = got === want;
  if (ok) pass++;
  console.log(
    `${ok ? "PASS" : "FAIL"}  ${String(got).padEnd(5)} ${(candidate + " ~ " + brand).padEnd(44)} exakt: ${why}`
  );
}

// matchCatalog nimmt beide Kandidatenformen entgegen
const mixed = c.matchCatalog(
  [{ id: "1", brand: "manager magazin" }, { id: "2", brand: "Bosch Siemens Hausgeräte" }],
  [{ term: "Manager", exact: true }, "bosch"]
);
const mixedOk = mixed.length === 1 && mixed[0].offer.id === "2" && mixed[0].matchedOn === "bosch";
console.log(`${mixedOk ? "PASS" : "FAIL"}  matchCatalog trennt exakte von lockeren Kandidaten`);
if (mixedOk) pass++;

const total = CASES.length + EXACT_CASES.length + 3;
console.log(`\n${pass}/${total}`);
process.exit(pass === total ? 0 : 1);
