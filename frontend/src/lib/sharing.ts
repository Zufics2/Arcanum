/**
 * Share links: /s/{id}#{fileKey}. The part after # never reaches the server,
 * so the server can serve the ciphertext but cannot decrypt it.
 */
import axios, { type AxiosProgressEvent } from "axios";

import { api } from "@/lib/api";
import { API_URL } from "@/lib/config";
import {
  ENCRYPTION_OVERHEAD_BYTES,
  decryptBytes,
  decryptFileKey,
  decryptString,
  exportFileKey,
  importSharedFileKey,
} from "@/lib/crypto";
import type { DriveFile } from "@/lib/storage";
import { activeSession } from "@/stores/authStore";

// ---------- owner side ----------

export interface ShareLink {
  id: string;
  url: string;
  expiresAt: string | null;
  maxDownloads: number | null;
  downloadCount: number;
  downloadsLeft: number | null;
  createdAt: string;
}

interface ShareLinkDto {
  id: string;
  file: string;
  expires_at: string | null;
  max_downloads: number | null;
  download_count: number;
  downloads_left: number | null;
  created_at: string;
}

/** The fragment is rebuilt from the file key, so old links can be copied again at any time. */
async function linkFragment(file: DriveFile): Promise<string> {
  const masterKey = activeSession()?.masterKey;
  if (!masterKey) throw new Error("Not logged in");
  return exportFileKey(await decryptFileKey(file.encryptedFileKey, masterKey));
}

function toLink(dto: ShareLinkDto, fragment: string): ShareLink {
  return {
    id: dto.id,
    url: `${window.location.origin}/s/${dto.id}#${fragment}`,
    expiresAt: dto.expires_at,
    maxDownloads: dto.max_downloads,
    downloadCount: dto.download_count,
    downloadsLeft: dto.downloads_left,
    createdAt: dto.created_at,
  };
}

export async function listShareLinks(file: DriveFile): Promise<ShareLink[]> {
  const [{ data }, fragment] = await Promise.all([
    api.get<ShareLinkDto[]>("/share/", { params: { file: file.id } }),
    linkFragment(file),
  ]);
  return data.map((dto) => toLink(dto, fragment));
}

export async function createShareLink(
  file: DriveFile,
  options: { expiresInHours: number | null; maxDownloads: number | null },
): Promise<ShareLink> {
  const expiresAt =
    options.expiresInHours === null ? null : new Date(Date.now() + options.expiresInHours * 3600_000).toISOString();
  const [{ data }, fragment] = await Promise.all([
    api.post<ShareLinkDto>("/share/", { file: file.id, expires_at: expiresAt, max_downloads: options.maxDownloads }),
    linkFragment(file),
  ]);
  return toLink(data, fragment);
}

export async function deleteShareLink(id: string): Promise<void> {
  await api.delete(`/share/${id}/`);
}

// ---------- recipient side (public, no account) ----------

export interface SharedFile {
  name: string;
  size: number;
  expiresAt: string | null;
  downloadsLeft: number | null;
}

interface PublicShareDto {
  encrypted_name: string;
  size: number;
  expires_at: string | null;
  downloads_left: number | null;
}

export class WrongShareKeyError extends Error {}

// Plain axios: the recipient may not have an account, and must not send anyone's tokens.
const publicApi = axios.create({ baseURL: API_URL });

export async function getSharedFile(id: string, key: CryptoKey): Promise<SharedFile> {
  const { data } = await publicApi.get<PublicShareDto>(`/share/${encodeURIComponent(id)}/`);
  let name: string;
  try {
    name = await decryptString(key, data.encrypted_name);
  } catch {
    throw new WrongShareKeyError();
  }
  return {
    name,
    size: Math.max(0, data.size - ENCRYPTION_OVERHEAD_BYTES),
    expiresAt: data.expires_at,
    downloadsLeft: data.downloads_left,
  };
}

/** Downloads (this counts towards the link's limit) and decrypts the file. */
export async function downloadSharedFile(
  id: string,
  key: CryptoKey,
  onProgress?: (percent: number) => void,
): Promise<Blob> {
  const { data } = await publicApi.get<ArrayBuffer>(`/share/${encodeURIComponent(id)}/download/`, {
    responseType: "arraybuffer",
    onDownloadProgress: (e: AxiosProgressEvent) => {
      if (onProgress && e.total) onProgress(Math.round((e.loaded / e.total) * 100));
    },
  });
  try {
    return new Blob([await decryptBytes(key, new Uint8Array(data))]);
  } catch {
    throw new WrongShareKeyError();
  }
}

export { importSharedFileKey };
