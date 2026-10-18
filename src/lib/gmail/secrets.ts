/**
 * Gmail OAuth token encryption and management.
 * Uses the same encryption infrastructure as prospecting secrets.
 */
import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const ALGO = "aes-256-gcm";

function keyFilePath(): string {
  return path.join(process.cwd(), "data", ".credentials.key");
}

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

/** the last four characters, so someone can tell which token is saved without seeing it. */
export function keyHint(secret: string): string {
  const trimmed = secret.trim();
  if (trimmed.length <= 4) return "••••";
  return `••••${trimmed.slice(-4)}`;
}

/** seals OAuth tokens for storage */
export function sealTokens(tokens: { access_token: string; refresh_token?: string; expires_at: number }): {
  access_token: Sealed;
  refresh_token: Sealed | null;
} {
  return {
    access_token: seal(tokens.access_token),
    refresh_token: tokens.refresh_token ? seal(tokens.refresh_token) : null,
  };
}

/** opens OAuth tokens for use */
export function openTokens(sealed: { access_token: Sealed; refresh_token: Sealed | null }): {
  access_token: string;
  refresh_token: string | undefined;
  expires_at: number; // note: we don't store expires_at in sealed, it's stored separately
} {
  return {
    access_token: open(sealed.access_token),
    refresh_token: sealed.refresh_token ? open(sealed.refresh_token) : undefined,
    expires_at: 0, // placeholder, actual expiry stored separately in DB
  };
}

/** checks if tokens are expired or about to expire (within 5 minutes) */
export function isTokenExpired(expiresAt: number | string | null): boolean {
  if (!expiresAt) return true;
  const expiry = typeof expiresAt === "string" ? parseInt(expiresAt, 10) : expiresAt;
  const buffer = 5 * 60 * 1000; // 5 minute buffer
  return Date.now() >= expiry - buffer;
}

/** gets time until token expiry in milliseconds */
export function timeUntilExpiry(expiresAt: number | string | null): number {
  if (!expiresAt) return 0;
  const expiry = typeof expiresAt === "string" ? parseInt(expiresAt, 10) : expiresAt;
  return Math.max(0, expiry - Date.now());
}