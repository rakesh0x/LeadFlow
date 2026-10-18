/**
 * api keys are encrypted at rest with aes-256-gcm.
 *
 * the key itself comes from LEADFLOW_ENCRYPTION_KEY if you set one. if you do not,
 * a random key is generated once and written to data/.credentials.key, which is
 * gitignored and chmod 600. either way, the plaintext key is never stored in the
 * database, never logged, and never sent back to the browser.
 */
import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const ALGO = "aes-256-gcm";

function keyFilePath(): string {
  return path.join(process.cwd(), "data", ".credentials.key");
}

/** sha-256 turns any passphrase into a valid 32 byte aes key. */
function deriveKey(passphrase: string): Buffer {
  return createHash("sha256").update(passphrase, "utf8").digest();
}

function loadKey(): Buffer {
  const fromEnv = process.env.LEADFLOW_ENCRYPTION_KEY;
  if (fromEnv && fromEnv.length >= 8) return deriveKey(fromEnv);

  const file = keyFilePath();
  if (fs.existsSync(file)) {
    const hex = fs.readFileSync(file, "utf8").trim();
    if (hex.length === 64) return Buffer.from(hex, "hex");
  }

  const generated = randomBytes(32);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, generated.toString("hex"), { mode: 0o600 });
  try {
    fs.chmodSync(file, 0o600);
  } catch {
    // best effort; the file is gitignored either way
  }
  return generated;
}

export interface Sealed {
  ciphertext: string;
  iv: string;
  tag: string;
}

export function seal(plaintext: string): Sealed {
  const iv = randomBytes(12);
  const cipher = createCipheriv(ALGO, loadKey(), iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  return {
    ciphertext: ciphertext.toString("base64"),
    iv: iv.toString("base64"),
    tag: cipher.getAuthTag().toString("base64"),
  };
}

export function open(sealed: Sealed): string {
  const decipher = createDecipheriv(ALGO, loadKey(), Buffer.from(sealed.iv, "base64"));
  decipher.setAuthTag(Buffer.from(sealed.tag, "base64"));
  return Buffer.concat([decipher.update(Buffer.from(sealed.ciphertext, "base64")), decipher.final()]).toString("utf8");
}

/** the last four characters, so someone can tell which key is saved without seeing it. */
export function keyHint(secret: string): string {
  const trimmed = secret.trim();
  if (trimmed.length <= 4) return "••••";
  return `••••${trimmed.slice(-4)}`;
}

/** environment keys win, so a deployment can override anything saved in the database. */
export function envKey(provider: "apollo" | "pdl"): string | null {
  const value = provider === "apollo" ? process.env.LEADFLOW_APOLLO_API_KEY : process.env.LEADFLOW_PDL_API_KEY;
  return value && value.trim() ? value.trim() : null;
}