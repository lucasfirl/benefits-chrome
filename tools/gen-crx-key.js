// Creates the signing key pair for verified CRX uploads.
//   node tools/gen-crx-key.js [out.pem]
// Writes the private key to out.pem (default crx-key.pem, git-ignored) and
// prints the public key. Paste the public key into the Chrome Web Store's
// "Enable verified CRX uploads" form and store the private key as the
// CRX_PRIVATE_KEY repository secret. Losing it means the item can no longer
// be updated without support, so keep a copy somewhere safe and off this box.

const crypto = require("crypto");
const fs = require("fs");

const out = process.argv[2] || "crx-key.pem";
if (fs.existsSync(out)) {
  process.stderr.write(`${out} already exists - refusing to overwrite a signing key\n`);
  process.exit(2);
}

const { privateKey, publicKey } = crypto.generateKeyPairSync("rsa", {
  modulusLength: 2048,
  privateKeyEncoding: { type: "pkcs8", format: "pem" },
  publicKeyEncoding: { type: "spki", format: "pem" },
});

fs.writeFileSync(out, privateKey, { mode: 0o600 });
process.stdout.write(`private key written to ${out} - keep it secret, never commit it\n\n`);
process.stdout.write(`${publicKey}\n`);
