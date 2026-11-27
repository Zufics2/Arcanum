import { api } from "@/lib/api";
import {
  SALT_BYTES,
  decryptMasterKey,
  deriveKeys,
  encryptMasterKey,
  fromBase64,
  generateMasterKey,
  randomBytes,
  toBase64,
} from "@/lib/crypto";
import { useAuthStore } from "@/stores/authStore";

interface LoginResponse {
  access: string;
  refresh: string;
  encrypted_master_key: string;
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
  useAuthStore.getState().setSession({ username, access: data.access, refresh: data.refresh, masterKey });
}

export async function login(username: string, password: string): Promise<void> {
  const { data: saltData } = await api.post<{ salt: string }>("/auth/salt/", { username });
  const { authHash, userKey } = await deriveKeys(password, fromBase64(saltData.salt));

  const { data } = await api.post<LoginResponse>("/auth/login/", { username, auth_hash: authHash });
  const masterKey = await decryptMasterKey(data.encrypted_master_key, userKey);
  useAuthStore.getState().setSession({ username, access: data.access, refresh: data.refresh, masterKey });
}
