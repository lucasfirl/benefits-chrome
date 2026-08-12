// Fuehrt alle Testdateien aus und fasst das Ergebnis zusammen.
//   node test/run-all.js

const { execFileSync } = require("child_process");
const fs = require("fs");
const path = require("path");

const dir = __dirname;
const files = fs
  .readdirSync(dir)
  .filter((f) => f.endsWith(".test.js"))
  .sort();

let failed = 0;
for (const file of files) {
  process.stdout.write(`\n### ${file}\n`);
  try {
    process.stdout.write(execFileSync(process.execPath, [path.join(dir, file)], { encoding: "utf8" }));
  } catch (err) {
    failed++;
    process.stdout.write((err.stdout || "") + (err.stderr || ""));
    process.stdout.write(`--> ${file} FEHLGESCHLAGEN\n`);
  }
}

console.log(
  failed === 0 ? `\n==> alle ${files.length} Suiten bestanden` : `\n==> ${failed} von ${files.length} Suiten fehlgeschlagen`
);
process.exit(failed === 0 ? 0 : 1);
