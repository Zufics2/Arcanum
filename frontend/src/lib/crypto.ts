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
