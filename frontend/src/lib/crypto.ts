/**
 * All client-side cryptography for Arcanum. Uses only the built-in Web Crypto API.
 *
 *   password ─PBKDF2(salt || "auth")─► authHash  → sent to the server as the "password"
 *            └PBKDF2(salt || "enc") ─► userKey   → never leaves the browser
 *
 *   userKey   (AES-256-GCM) encrypts masterKey (random, stored on the server encrypted)
 *   masterKey (AES-256-GCM) encrypts per-file keys and folder names
 *
 * Encrypted payload format: iv (12 bytes) || ciphertext+tag, base64-encoded in the API.
 */

export const PBKDF2_ITERATIONS = 600_000;
export const SALT_BYTES = 16;
const IV_BYTES = 12;
const KEY_BITS = 256;

const encoder = new TextEncoder();
const decoder = new TextDecoder();

// ---------- encoding helpers ----------

export function toBase64(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary);
}

export function fromBase64(value: string): Uint8Array<ArrayBuffer> {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

export function randomBytes(length: number): Uint8Array<ArrayBuffer> {
  return crypto.getRandomValues(new Uint8Array(length));
}

function concat(...parts: Uint8Array[]): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(parts.reduce((sum, p) => sum + p.length, 0));
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

// ---------- password-derived keys ----------

export interface DerivedKeys {
  /** base64, sent to the server instead of the password. */
  authHash: string;
  /** Non-extractable AES-GCM key used only to encrypt/decrypt the masterKey. */
  userKey: CryptoKey;
}

/** Derives authHash and userKey from the password. Takes ~1 s by design (600k iterations each). */
export async function deriveKeys(password: string, salt: Uint8Array): Promise<DerivedKeys> {
  const baseKey = await crypto.subtle.importKey("raw", encoder.encode(password), "PBKDF2", false, [
    "deriveBits",
    "deriveKey",
  ]);

  const pbkdf2 = (purpose: string): Pbkdf2Params => ({
    name: "PBKDF2",
    hash: "SHA-256",
    iterations: PBKDF2_ITERATIONS,
    salt: concat(salt, encoder.encode(purpose)),
  });

  const [authBits, userKey] = await Promise.all([
    crypto.subtle.deriveBits(pbkdf2("auth"), baseKey, KEY_BITS),
    crypto.subtle.deriveKey(pbkdf2("enc"), baseKey, { name: "AES-GCM", length: KEY_BITS }, false, [
      "encrypt",
      "decrypt",
    ]),
  ]);

  return { authHash: toBase64(new Uint8Array(authBits)), userKey };
}

// ---------- generic AES-GCM ----------

/** Encrypts bytes, returning iv || ciphertext. */
export async function encryptBytes(key: CryptoKey, data: Uint8Array<ArrayBuffer>): Promise<Uint8Array<ArrayBuffer>> {
  const iv = randomBytes(IV_BYTES);
  const ciphertext = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, data);
  return concat(iv, new Uint8Array(ciphertext));
}

/** Decrypts iv || ciphertext. Throws if the key is wrong or data was tampered with. */
export async function decryptBytes(key: CryptoKey, payload: Uint8Array<ArrayBuffer>): Promise<Uint8Array<ArrayBuffer>> {
  const iv = payload.subarray(0, IV_BYTES);
  const ciphertext = payload.subarray(IV_BYTES);
  const plain = await crypto.subtle.decrypt({ name: "AES-GCM", iv }, key, ciphertext);
  return new Uint8Array(plain);
}

/** Encrypts a UTF-8 string to base64(iv || ciphertext). */
export async function encryptString(key: CryptoKey, text: string): Promise<string> {
  return toBase64(await encryptBytes(key, encoder.encode(text)));
}

/** Decrypts base64(iv || ciphertext) to a UTF-8 string. */
export async function decryptString(key: CryptoKey, payload: string): Promise<string> {
  return decoder.decode(await decryptBytes(key, fromBase64(payload)));
}

// ---------- master key ----------

// The masterKey is extractable only so it can be re-encrypted with a new userKey on password change.
// It is held in memory (zustand) and never persisted in the browser.
async function importMasterKey(raw: Uint8Array<ArrayBuffer>): Promise<CryptoKey> {
  return crypto.subtle.importKey("raw", raw, { name: "AES-GCM" }, true, ["encrypt", "decrypt"]);
}

export async function generateMasterKey(): Promise<CryptoKey> {
  return importMasterKey(randomBytes(KEY_BITS / 8));
}

/** Returns base64(iv || encrypted raw masterKey). */
export async function encryptMasterKey(masterKey: CryptoKey, userKey: CryptoKey): Promise<string> {
  const raw = new Uint8Array(await crypto.subtle.exportKey("raw", masterKey));
  return toBase64(await encryptBytes(userKey, raw));
}

export async function decryptMasterKey(encrypted: string, userKey: CryptoKey): Promise<CryptoKey> {
  return importMasterKey(await decryptBytes(userKey, fromBase64(encrypted)));
}

// ---------- file keys ----------

/** Plaintext size limit: files are encrypted whole in memory. */
export const MAX_FILE_BYTES = 200 * 1024 * 1024;
/** Bytes added by encryption: 12-byte IV + 16-byte GCM tag. */
export const ENCRYPTION_OVERHEAD_BYTES = IV_BYTES + 16;

// A fileKey is extractable so it can be put into a share link (#fragment) later.
async function importFileKey(raw: Uint8Array<ArrayBuffer>): Promise<CryptoKey> {
  return crypto.subtle.importKey("raw", raw, { name: "AES-GCM" }, true, ["encrypt", "decrypt"]);
}

/** A fresh random key for one file (encrypts its content and its name). */
export async function generateFileKey(): Promise<CryptoKey> {
  return importFileKey(randomBytes(KEY_BITS / 8));
}

/** Returns base64(iv || fileKey encrypted with masterKey). */
export async function encryptFileKey(fileKey: CryptoKey, masterKey: CryptoKey): Promise<string> {
  const raw = new Uint8Array(await crypto.subtle.exportKey("raw", fileKey));
  return toBase64(await encryptBytes(masterKey, raw));
}

export async function decryptFileKey(encrypted: string, masterKey: CryptoKey): Promise<CryptoKey> {
  return importFileKey(await decryptBytes(masterKey, fromBase64(encrypted)));
}

// ---------- share links ----------
// The fileKey goes into the URL fragment (#…), which the browser never sends to the server.

export function toBase64Url(bytes: Uint8Array): string {
  return toBase64(bytes).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function fromBase64Url(value: string): Uint8Array<ArrayBuffer> {
  const b64 = value.replace(/-/g, "+").replace(/_/g, "/");
  return fromBase64(b64 + "=".repeat((4 - (b64.length % 4)) % 4));
}

/** Raw fileKey as base64url, for the #fragment of a share link. */
export async function exportFileKey(fileKey: CryptoKey): Promise<string> {
  return toBase64Url(new Uint8Array(await crypto.subtle.exportKey("raw", fileKey)));
}

export class InvalidShareKeyError extends Error {}

/** Imports the key from a share link fragment (non-extractable: the recipient only decrypts). */
export async function importSharedFileKey(fragment: string): Promise<CryptoKey> {
  let raw: Uint8Array<ArrayBuffer>;
  try {
    raw = fromBase64Url(fragment);
  } catch {
    throw new InvalidShareKeyError();
  }
  if (raw.length !== KEY_BITS / 8) throw new InvalidShareKeyError();
  return crypto.subtle.importKey("raw", raw, { name: "AES-GCM" }, false, ["decrypt"]);
}

// ---------- recovery key ----------
//
// A random 256-bit key the user writes down. Like the password, it yields two values (via HKDF):
//   recoveryKey ─HKDF("arcanum-recovery-auth")─► recoveryAuthHash → server (Django hashes it again)
//               └HKDF("arcanum-recovery-enc") ─► recoveryEncKey   → encrypts a copy of masterKey
// No slow KDF is needed: 256 random bits cannot be brute-forced, unlike a human password.

export const RECOVERY_KEY_BYTES = 32;
const BASE32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

export function generateRecoveryKey(): Uint8Array<ArrayBuffer> {
  return randomBytes(RECOVERY_KEY_BYTES);
}

/** Human-friendly form: base32 in groups of 4, e.g. "ABCD-EFGH-…" (52 characters). */
export function formatRecoveryKey(bytes: Uint8Array): string {
  let bits = 0;
  let value = 0;
  let out = "";
  for (const byte of bytes) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += BASE32[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += BASE32[(value << (5 - bits)) & 31];
  return out.match(/.{1,4}/g)!.join("-");
}

export class InvalidRecoveryKeyError extends Error {}

/** Parses what the user typed: case, spaces and dashes don't matter. */
export function parseRecoveryKey(text: string): Uint8Array<ArrayBuffer> {
  const clean = text.toUpperCase().replace(/[^A-Z2-7]/g, "");
  if (clean.length !== Math.ceil((RECOVERY_KEY_BYTES * 8) / 5)) throw new InvalidRecoveryKeyError();
  const out = new Uint8Array(RECOVERY_KEY_BYTES);
  let bits = 0;
  let value = 0;
  let index = 0;
  for (const char of clean) {
    value = (value << 5) | BASE32.indexOf(char);
    bits += 5;
    if (bits >= 8) {
      if (index < out.length) out[index++] = (value >>> (bits - 8)) & 255;
      bits -= 8;
    }
  }
  return out;
}

export interface RecoveryKeys {
  authHash: string;
  encKey: CryptoKey;
}

export async function deriveRecoveryKeys(recoveryKey: Uint8Array<ArrayBuffer>): Promise<RecoveryKeys> {
  const base = await crypto.subtle.importKey("raw", recoveryKey, "HKDF", false, ["deriveBits", "deriveKey"]);
  const hkdf = (info: string): HkdfParams => ({
    name: "HKDF",
    hash: "SHA-256",
    salt: new Uint8Array(0),
    info: encoder.encode(info),
  });
  const [authBits, encKey] = await Promise.all([
    crypto.subtle.deriveBits(hkdf("arcanum-recovery-auth"), base, KEY_BITS),
    crypto.subtle.deriveKey(hkdf("arcanum-recovery-enc"), base, { name: "AES-GCM", length: KEY_BITS }, false, [
      "encrypt",
      "decrypt",
    ]),
  ]);
  return { authHash: toBase64(new Uint8Array(authBits)), encKey };
}
