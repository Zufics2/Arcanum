import { api } from "@/lib/api";
import { decryptBytes, encryptBytes } from "@/lib/crypto";
import { activeSession } from "@/stores/authStore";

export interface Me {
  username: string;
  default_avatar: string;
  has_custom_avatar: boolean;
  has_recovery_key: boolean;
  storage_used: number;
  storage_quota: number;
}

const AVATAR_SIZE = 256;

function requireMasterKey(): CryptoKey {
  const key = activeSession()?.masterKey;
  if (!key) throw new Error("Not logged in");
  return key;
}

export async function getMe(): Promise<Me> {
  return (await api.get<Me>("/me/")).data;
}

export async function setDefaultAvatar(name: string): Promise<void> {
  await api.patch("/me/", { default_avatar: name });
}

/** Center-crops and scales an image to a small square JPEG, so the encrypted avatar stays tiny. */
async function resizeImage(file: File): Promise<Uint8Array<ArrayBuffer>> {
  const bitmap = await createImageBitmap(file);
  const side = Math.min(bitmap.width, bitmap.height);
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = AVATAR_SIZE;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas is not supported");
  ctx.fillStyle = "#ffffff"; // background for transparent PNGs
  ctx.fillRect(0, 0, AVATAR_SIZE, AVATAR_SIZE);
  ctx.drawImage(
    bitmap,
    (bitmap.width - side) / 2,
    (bitmap.height - side) / 2,
    side,
    side,
    0,
    0,
    AVATAR_SIZE,
    AVATAR_SIZE,
  );
  bitmap.close();
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.9));
  if (!blob) throw new Error("Could not encode image");
  return new Uint8Array(await blob.arrayBuffer());
}

/** The picture is encrypted with masterKey before upload: the server never sees it. */
export async function uploadAvatar(file: File): Promise<void> {
  const ciphertext = await encryptBytes(requireMasterKey(), await resizeImage(file));
  const form = new FormData();
  form.append("blob", new Blob([ciphertext], { type: "application/octet-stream" }), "blob");
  await api.put("/me/avatar/", form);
}

export async function deleteAvatar(): Promise<void> {
  await api.delete("/me/avatar/");
}

/** Downloads and decrypts the custom avatar; returns an object URL for <img>. */
export async function fetchCustomAvatarUrl(): Promise<string> {
  const { data } = await api.get<ArrayBuffer>("/me/avatar/", { responseType: "arraybuffer" });
  const plain = await decryptBytes(requireMasterKey(), new Uint8Array(data));
  return URL.createObjectURL(new Blob([plain], { type: "image/jpeg" }));
}
