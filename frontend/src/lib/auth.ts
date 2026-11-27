import { api } from "@/lib/api";
import {
  SALT_BYTES,
  decryptMasterKey,
  deriveKeys,
  deriveRecoveryKeys,
  encryptMasterKey,
  formatRecoveryKey,
  fromBase64,
  generateMasterKey,
  generateRecoveryKey,
  parseRecoveryKey,
  randomBytes,
  toBase64,
} from "@/lib/crypto";
import { useAuthStore, type LockedUser } from "@/stores/authStore";

interface LoginResponse {
  access: string;
  refresh: string;
  encrypted_master_key: string;
  default_avatar: string;
}

async function authHashFor(username: string, password: string) {
  const { data } = await api.post<{ salt: string }>("/auth/salt/", { username });
  return deriveKeys(password, fromBase64(data.salt));
}

/** Creates the account. The password itself never leaves the browser. */
export async function register(username: string, password: string): Promise<void> {
  const salt = randomBytes(SALT_BYTES);
  const { authHash, userKey } = await deriveKeys(password, salt);
  const masterKey = await generateMasterKey();
  const encryptedMasterKey = await encryptMasterKey(masterKey, userKey);

  await api.post("/auth/register/", {
    username,
    auth_hash: authHash,
    salt: toBase64(salt),
    encrypted_master_key: encryptedMasterKey,
  });

  const { data } = await api.post<LoginResponse>("/auth/login/", { username, auth_hash: authHash });
  useAuthStore.getState().addSession({
    username,
    access: data.access,
    refresh: data.refresh,
    masterKey,
    defaultAvatar: data.default_avatar,
  });
}

/** Logs in (also used to unlock after a reload: keys can only come from the password). */
export async function login(username: string, password: string): Promise<void> {
  const { authHash, userKey } = await authHashFor(username, password);
  const { data } = await api.post<LoginResponse>("/auth/login/", { username, auth_hash: authHash });
  const masterKey = await decryptMasterKey(data.encrypted_master_key, userKey);
  useAuthStore.getState().addSession({
    username,
    access: data.access,
    refresh: data.refresh,
    masterKey,
    defaultAvatar: data.default_avatar,
  });
}

/** On page load: ask the server who the session cookie belongs to. */
export async function restoreSession(): Promise<void> {
  const store = useAuthStore.getState();
  try {
    const { data } = await api.get<{ username: string; default_avatar: string }>("/auth/session/");
    store.setLocked({ username: data.username, defaultAvatar: data.default_avatar } satisfies LockedUser);
  } catch {
    store.setLocked(null);
  } finally {
    store.setRestoring(false);
  }
}

/** Logs out of the active account. Another unlocked account (if any) takes over. */
export async function logout(): Promise<void> {
  const { others, endActive } = useAuthStore.getState();
  const next = others[0];
  // Point the session cookie at the next account, or clear it.
  await (next ? api.post("/auth/session/", { refresh: next.refresh }) : api.post("/auth/logout/")).catch(() => {});
  endActive();
}

export async function switchAccount(username: string): Promise<void> {
  const { others, switchTo, dropOther } = useAuthStore.getState();
  const target = others.find((o) => o.username === username);
  if (!target) return;
  try {
    await api.post("/auth/session/", { refresh: target.refresh });
  } catch (err) {
    dropOther(username); // its refresh token expired: that account needs a fresh login
    throw err;
  }
  switchTo(username);
}

/** "Log in to another account" on the unlock screen: forget the remembered session. */
export async function forgetLockedSession(): Promise<void> {
  await api.post("/auth/logout/").catch(() => {});
  useAuthStore.getState().setLocked(null);
}

/**
 * Changes the password without touching any file: the same masterKey is re-encrypted
 * with a key derived from the new password (and a fresh salt).
 */
export async function changePassword(oldPassword: string, newPassword: string): Promise<void> {
  const session = useAuthStore.getState().session;
  if (!session) throw new Error("Not logged in");

  const { authHash: oldAuthHash } = await authHashFor(session.username, oldPassword);
  const newSalt = randomBytes(SALT_BYTES);
  const { authHash: newAuthHash, userKey: newUserKey } = await deriveKeys(newPassword, newSalt);

  await api.post("/auth/change-password/", {
    old_auth_hash: oldAuthHash,
    new_auth_hash: newAuthHash,
    new_salt: toBase64(newSalt),
    new_encrypted_master_key: await encryptMasterKey(session.masterKey, newUserKey),
  });
}

// ---------- recovery key ----------

function requireSession() {
  const session = useAuthStore.getState().session;
  if (!session) throw new Error("Not logged in");
  return session;
}

/**
 * Creates (or replaces) the recovery key and returns it for the user to save.
 * The server gets only a hash derived from it and a copy of masterKey encrypted under it.
 */
export async function setupRecoveryKey(password: string): Promise<string> {
  const session = requireSession();
  const { authHash } = await authHashFor(session.username, password);
  const recoveryKey = generateRecoveryKey();
  const { authHash: recoveryAuthHash, encKey } = await deriveRecoveryKeys(recoveryKey);

  await api.post("/auth/recovery/", {
    auth_hash: authHash,
    recovery_auth_hash: recoveryAuthHash,
    recovery_encrypted_master_key: await encryptMasterKey(session.masterKey, encKey),
  });
  return formatRecoveryKey(recoveryKey);
}

export async function disableRecoveryKey(password: string): Promise<void> {
  const session = requireSession();
  const { authHash } = await authHashFor(session.username, password);
  await api.delete("/auth/recovery/", { data: { auth_hash: authHash } });
}

/**
 * Forgotten password: the recovery key unlocks the copy of masterKey, which is then
 * re-encrypted under the new password. Files are not touched. Logs in afterwards.
 */
export async function recoverAccount(username: string, recoveryKeyText: string, newPassword: string): Promise<void> {
  const { authHash: recoveryAuthHash, encKey } = await deriveRecoveryKeys(parseRecoveryKey(recoveryKeyText));

  const { data } = await api.post<{ recovery_encrypted_master_key: string }>("/auth/recovery/verify/", {
    username,
    recovery_auth_hash: recoveryAuthHash,
  });
  const masterKey = await decryptMasterKey(data.recovery_encrypted_master_key, encKey);

  const newSalt = randomBytes(SALT_BYTES);
  const { authHash: newAuthHash, userKey } = await deriveKeys(newPassword, newSalt);
  await api.post("/auth/recovery/reset/", {
    username,
    recovery_auth_hash: recoveryAuthHash,
    new_auth_hash: newAuthHash,
    new_salt: toBase64(newSalt),
    new_encrypted_master_key: await encryptMasterKey(masterKey, userKey),
  });

  await login(username, newPassword);
}
