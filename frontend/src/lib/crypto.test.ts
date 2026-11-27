/**
 * Tests for the browser crypto module, run with Node's built-in test runner (`npm test`).
 * Node implements the same Web Crypto API as browsers. Reference vectors were computed
 * independently with Python's hashlib/hmac (PBKDF2, RFC 5869 HKDF, RFC 4648 base32).
 */
import assert from "node:assert/strict";
import { describe, test } from "node:test";

import * as c from "./crypto.ts";

const enc = new TextEncoder();
const dec = new TextDecoder();
const raw = async (key: CryptoKey) => new Uint8Array(await crypto.subtle.exportKey("raw", key));

describe("password-derived keys", () => {
  test("authHash matches PBKDF2-SHA256(password, salt || 'auth', 600k) computed in Python", async () => {
    const { authHash } = await c.deriveKeys("correct horse", new Uint8Array(16).fill(7));
    assert.equal(authHash, "pEpETvGTwkMTu5O8IID8IqcjCnk2sm+ezND02xnTngU=");
  });

  test("userKey is non-extractable and different salts give different hashes", async () => {
    const a = await c.deriveKeys("pw", new Uint8Array(16).fill(1));
    const b = await c.deriveKeys("pw", new Uint8Array(16).fill(2));
    assert.equal(a.userKey.extractable, false);
    assert.notEqual(a.authHash, b.authHash);
  });

  test("masterKey round-trips through userKey; wrong password fails", async () => {
    const salt = c.randomBytes(c.SALT_BYTES);
    const { userKey } = await c.deriveKeys("right", salt);
    const masterKey = await c.generateMasterKey();
    const wrapped = await c.encryptMasterKey(masterKey, userKey);

    assert.equal(c.fromBase64(wrapped).length, 12 + 32 + 16);
    const restored = await c.decryptMasterKey(wrapped, (await c.deriveKeys("right", salt)).userKey);
    assert.deepEqual(await raw(restored), await raw(masterKey));
    await assert.rejects(c.decryptMasterKey(wrapped, (await c.deriveKeys("wrong", salt)).userKey));
  });
});

describe("AES-GCM payloads", () => {
  test("strings round-trip and every encryption uses a fresh IV", async () => {
    const key = await c.generateFileKey();
    const a = await c.encryptString(key, "отчёт.pdf");
    const b = await c.encryptString(key, "отчёт.pdf");
    assert.notEqual(a, b);
    assert.equal(await c.decryptString(key, a), "отчёт.pdf");
  });

  test("overhead is exactly IV + tag", async () => {
    const key = await c.generateFileKey();
    const data = enc.encode("x".repeat(1000));
    assert.equal((await c.encryptBytes(key, data)).length - data.length, c.ENCRYPTION_OVERHEAD_BYTES);
  });

  test("tampered ciphertext is rejected", async () => {
    const key = await c.generateFileKey();
    const payload = await c.encryptBytes(key, enc.encode("secret"));
    payload[payload.length - 1] ^= 1;
    await assert.rejects(c.decryptBytes(key, payload));
  });

  test("fileKey round-trips through masterKey", async () => {
    const masterKey = await c.generateMasterKey();
    const fileKey = await c.generateFileKey();
    const wrapped = await c.encryptFileKey(fileKey, masterKey);
    assert.deepEqual(await raw(await c.decryptFileKey(wrapped, masterKey)), await raw(fileKey));
  });
});

describe("share links", () => {
  test("fragment is URL-safe and decrypts on the recipient side", async () => {
    const fileKey = await c.generateFileKey();
    const fragment = await c.exportFileKey(fileKey);
    assert.match(fragment, /^[A-Za-z0-9_-]{43}$/);

    const payload = await c.encryptBytes(fileKey, enc.encode("hello"));
    const recipientKey = await c.importSharedFileKey(fragment);
    assert.equal(recipientKey.extractable, false);
    assert.equal(dec.decode(await c.decryptBytes(recipientKey, payload)), "hello");
  });

  test("malformed fragments are rejected", async () => {
    for (const bad of ["", "abc", "!!!!", "A".repeat(42)]) {
      await assert.rejects(c.importSharedFileKey(bad), c.InvalidShareKeyError);
    }
  });
});

describe("recovery key", () => {
  const key = new Uint8Array(32).map((_, i) => i);

  test("formatting matches RFC 4648 base32 (Python base64.b32encode)", () => {
    assert.equal(
      c.formatRecoveryKey(key),
      "AAAQ-EAYE-AUDA-OCAJ-BIFQ-YDIO-B4IB-CEQT-CQKR-MFYY-DENB-WHA5-DYPQ",
    );
  });

  test("parsing ignores case, spaces and dashes; rejects wrong length", () => {
    const sloppy = " aaaq eaye-auda ocaj bifq ydio b4ib ceqt cqkr mfyy denb wha5 dypq ";
    assert.deepEqual(c.parseRecoveryKey(sloppy), key);
    assert.throws(() => c.parseRecoveryKey("AAAQ-EAYE"), c.InvalidRecoveryKeyError);
  });

  test("recoveryAuthHash matches RFC 5869 HKDF-SHA256 computed in Python", async () => {
    const { authHash } = await c.deriveRecoveryKeys(key);
    assert.equal(authHash, "FcUa1KMuOGUx16yHn49geTLzDE362UnkY9oPh33dIdk=");
  });

  test("masterKey can be recovered with the recovery key only", async () => {
    const masterKey = await c.generateMasterKey();
    const recoveryKey = c.generateRecoveryKey();
    const wrapped = await c.encryptMasterKey(masterKey, (await c.deriveRecoveryKeys(recoveryKey)).encKey);

    const typed = c.formatRecoveryKey(recoveryKey).toLowerCase();
    const { encKey } = await c.deriveRecoveryKeys(c.parseRecoveryKey(typed));
    assert.deepEqual(await raw(await c.decryptMasterKey(wrapped, encKey)), await raw(masterKey));
  });

  test("password and recovery derivations are independent", async () => {
    const { authHash } = await c.deriveRecoveryKeys(key);
    const { encKey } = await c.deriveRecoveryKeys(key);
    const payload = await c.encryptBytes(encKey, enc.encode("x"));
    // The value sent to the server cannot decrypt what the browser-only key encrypted.
    const serverSide = await crypto.subtle.importKey("raw", c.fromBase64(authHash), "AES-GCM", false, ["decrypt"]);
    await assert.rejects(c.decryptBytes(serverSide, payload));
  });
});
