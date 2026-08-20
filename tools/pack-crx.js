// Signs a ZIP into a CRX3 package for the Chrome Web Store's verified uploads.
//   node tools/pack-crx.js <in.zip> <out.crx> [key.pem]
// Without a key file the private key is read from $CRX_PRIVATE_KEY, which is
// how CI passes it - the key never touches the runner's disk that way.
//
// CRX3 layout: "Cr24" | uint32 version | uint32 header length | header | zip.
// The header is a protobuf (CrxFileHeader); only the few fields Chrome needs
// are written here, by hand, so this stays dependency-free like the rest of
// the repo.

const crypto = require("crypto");
const fs = require("fs");

const [zipPath, crxPath, keyPath] = process.argv.slice(2);
if (!zipPath || !crxPath) {
  process.stderr.write("usage: node tools/pack-crx.js <in.zip> <out.crx> [key.pem]\n");
  process.exit(2);
}

const pem = keyPath ? fs.readFileSync(keyPath, "utf8") : process.env.CRX_PRIVATE_KEY;
if (!pem) {
  process.stderr.write("no private key: pass a key file or set CRX_PRIVATE_KEY\n");
  process.exit(2);
}

// Protobuf wire format, length-delimited fields only (wire type 2).
function varint(value) {
  const bytes = [];
  while (value > 127) {
    bytes.push((value & 0x7f) | 0x80);
    value = Math.floor(value / 128);
  }
  bytes.push(value);
  return Buffer.from(bytes);
}

function field(number, payload) {
  return Buffer.concat([varint(number * 8 + 2), varint(payload.length), payload]);
}

const privateKey = crypto.createPrivateKey(pem);
const publicKey = crypto.createPublicKey(privateKey).export({ type: "spki", format: "der" });

// The extension id Chrome derives from the key: the first 16 bytes of the
// public key's SHA-256. Also what the store checks the upload's signature
// against.
const crxId = crypto.createHash("sha256").update(publicKey).digest().subarray(0, 16);
const signedHeaderData = field(1, crxId); // SignedData { bytes crx_id = 1; }

const zip = fs.readFileSync(zipPath);
const signature = crypto
  .createSign("sha256")
  .update(Buffer.from("CRX3 SignedData\x00", "binary"))
  .update(varint32(signedHeaderData.length))
  .update(signedHeaderData)
  .update(zip)
  .sign(privateKey);

// CrxFileHeader { repeated AsymmetricKeyProof sha256_with_rsa = 2;
//                 bytes signed_header_data = 10000; }
const proof = Buffer.concat([field(1, publicKey), field(2, signature)]);
const header = Buffer.concat([field(2, proof), field(10000, signedHeaderData)]);

fs.writeFileSync(
  crxPath,
  Buffer.concat([
    Buffer.from("Cr24", "binary"),
    varint32(3), // format version
    varint32(header.length),
    header,
    zip,
  ]),
);

function varint32(value) {
  const buf = Buffer.alloc(4);
  buf.writeUInt32LE(value);
  return buf;
}

process.stdout.write(`${crxPath} signed, extension id ${idFrom(crxId)}\n`);

// Chrome renders the id in its own base16 alphabet: 0-9a-f mapped onto a-p.
function idFrom(bytes) {
  return [...bytes]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("")
    .replace(/[0-9a-f]/g, (c) => "abcdefghijklmnop"[parseInt(c, 16)]);
}
