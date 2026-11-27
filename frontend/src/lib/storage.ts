/**
 * Drive operations. Everything the server receives is already encrypted;
 * everything it returns is decrypted here, in the browser.
 */
import type { AxiosProgressEvent } from "axios";

import { api } from "@/lib/api";
import {
  ENCRYPTION_OVERHEAD_BYTES,
  MAX_FILE_BYTES,
  decryptBytes,
  decryptFileKey,
  decryptString,
  encryptBytes,
  encryptFileKey,
  encryptString,
  generateFileKey,
} from "@/lib/crypto";
import { activeSession } from "@/stores/authStore";

// API Shapes

interface FolderDto {
  id: string;
  parent: string | null;
  encrypted_name: string;
  created_at: string;
}

interface FileDto {
  id: string;
  folder: string | null;
  encrypted_name: string;
  encrypted_file_key: string;
  size: number;
  created_at: string;
}

interface FolderContentsDto {
  folder: FolderDto | null;
  path: { id: string; encrypted_name: string }[];
  folders: FolderDto[];
  files: FileDto[];
}

// ---------- decrypted view models ----------

export interface DriveFolder {
  kind: "folder";
  id: string;
  parentId: string | null;
  /** null if the name could not be decrypted. */
  name: string | null;
  createdAt: string;
  encryptedName: string;
}

export interface DriveFile {
  kind: "file";
  id: string;
  folderId: string | null;
  name: string | null;
  /** Plaintext size (ciphertext size minus IV and tag). */
  size: number;
  encryptedSize: number;
  createdAt: string;
  encryptedName: string;
  encryptedFileKey: string;
}

export type DriveItem = DriveFolder | DriveFile;

export interface FolderContents {
  folder: DriveFolder | null;
  path: { id: string; name: string | null; encryptedName: string }[];
  items: DriveItem[];
}

export interface FolderNode {
  id: string;
  parentId: string | null;
  name: string | null;
}

function requireMasterKey(): CryptoKey {
  const masterKey = activeSession()?.masterKey;
  if (!masterKey) throw new Error("Not logged in");
  return masterKey;
}

async function tryDecrypt(key: CryptoKey | Promise<CryptoKey>, payload: string): Promise<string | null> {
  try {
    return await decryptString(await key, payload);
  } catch {
    return null;
  }
}

async function toFolder(dto: FolderDto, masterKey: CryptoKey): Promise<DriveFolder> {
  return {
    kind: "folder",
    id: dto.id,
    parentId: dto.parent,
    name: await tryDecrypt(masterKey, dto.encrypted_name),
    createdAt: dto.created_at,
    encryptedName: dto.encrypted_name,
  };
}

async function toFile(dto: FileDto, masterKey: CryptoKey): Promise<DriveFile> {
  return {
    kind: "file",
    id: dto.id,
    folderId: dto.folder,
    // The name is encrypted with the file's own key, which is itself encrypted with masterKey.
    name: await tryDecrypt(decryptFileKey(dto.encrypted_file_key, masterKey), dto.encrypted_name),
    size: Math.max(0, dto.size - ENCRYPTION_OVERHEAD_BYTES),
    encryptedSize: dto.size,
    createdAt: dto.created_at,
    encryptedName: dto.encrypted_name,
    encryptedFileKey: dto.encrypted_file_key,
  };
}

// ---------- folders ----------

export async function listFolder(folderId: string | null): Promise<FolderContents> {
  const masterKey = requireMasterKey();
  const { data } = await api.get<FolderContentsDto>("/folders/", {
    params: folderId ? { parent: folderId } : undefined,
  });

  const [folder, path, folders, files] = await Promise.all([
    data.folder ? toFolder(data.folder, masterKey) : null,
    Promise.all(
      data.path.map(async (p) => ({
        id: p.id,
        name: await tryDecrypt(masterKey, p.encrypted_name),
        encryptedName: p.encrypted_name,
      })),
    ),
    Promise.all(data.folders.map((f) => toFolder(f, masterKey))),
    Promise.all(data.files.map((f) => toFile(f, masterKey))),
  ]);

  return { folder, path, items: [...folders, ...files] };
}

export async function listFolderTree(): Promise<FolderNode[]> {
  const masterKey = requireMasterKey();
  const { data } = await api.get<FolderDto[]>("/folders/tree/");
  return Promise.all(
    data.map(async (f) => ({ id: f.id, parentId: f.parent, name: await tryDecrypt(masterKey, f.encrypted_name) })),
  );
}

export async function createFolder(name: string, parentId: string | null): Promise<void> {
  const encryptedName = await encryptString(requireMasterKey(), name);
  await api.post("/folders/", { encrypted_name: encryptedName, parent: parentId });
}

export async function renameFolder(id: string, name: string): Promise<void> {
  const encryptedName = await encryptString(requireMasterKey(), name);
  await api.patch(`/folders/${id}/`, { encrypted_name: encryptedName });
}

export async function moveFolder(id: string, parentId: string | null): Promise<void> {
  await api.patch(`/folders/${id}/`, { parent: parentId });
}

export async function deleteFolder(id: string): Promise<void> {
  await api.delete(`/folders/${id}/`);
}

// ---------- files ----------

export class FileTooLargeError extends Error {}

/**
 * Encrypts a file in memory and uploads the ciphertext.
 * The multipart filename is always "blob", so the real name never reaches the server.
 */
export async function uploadFile(
  file: File,
  folderId: string | null,
  onProgress?: (percent: number) => void,
): Promise<void> {
  if (file.size > MAX_FILE_BYTES) throw new FileTooLargeError();
  const masterKey = requireMasterKey();

  const fileKey = await generateFileKey();
  const plaintext = new Uint8Array(await file.arrayBuffer());
  const [ciphertext, encryptedName, encryptedFileKey] = await Promise.all([
    encryptBytes(fileKey, plaintext),
    encryptString(fileKey, file.name),
    encryptFileKey(fileKey, masterKey),
  ]);

  const form = new FormData();
  form.append("blob", new Blob([ciphertext], { type: "application/octet-stream" }), "blob");
  form.append("encrypted_name", encryptedName);
  form.append("encrypted_file_key", encryptedFileKey);
  if (folderId) form.append("folder", folderId);

  await api.post("/files/", form, {
    onUploadProgress: (e: AxiosProgressEvent) => {
      if (onProgress && e.total) onProgress(Math.round((e.loaded / e.total) * 100));
    },
  });
}

/** Downloads the ciphertext, decrypts it and returns the plaintext as a Blob (of the given MIME type). */
export async function downloadFile(file: DriveFile, mime = ""): Promise<Blob> {
  const fileKey = await decryptFileKey(file.encryptedFileKey, requireMasterKey());
  const { data } = await api.get<ArrayBuffer>(`/files/${file.id}/download/`, { responseType: "arraybuffer" });
  const plaintext = await decryptBytes(fileKey, new Uint8Array(data));
  return new Blob([plaintext], { type: mime });
}

/** The first bytes of the stored ciphertext, without decrypting: what the server actually holds. */
export async function fetchCiphertextHead(id: string, bytes = 512): Promise<Uint8Array> {
  const { data } = await api.get<ArrayBuffer>(`/files/${id}/download/`, {
    params: { head: bytes },
    responseType: "arraybuffer",
  });
  return new Uint8Array(data);
}

/** Triggers the browser "Save as" for a Blob. */
export function saveBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  // Give the browser a moment to start the download before releasing the memory.
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

export async function renameFile(file: DriveFile, name: string): Promise<void> {
  // A file's name is encrypted with its own fileKey (so a share link can show it later).
  const fileKey = await decryptFileKey(file.encryptedFileKey, requireMasterKey());
  await api.patch(`/files/${file.id}/`, { encrypted_name: await encryptString(fileKey, name) });
}

export async function moveFile(id: string, folderId: string | null): Promise<void> {
  await api.patch(`/files/${id}/`, { folder: folderId });
}

export async function deleteFile(id: string): Promise<void> {
  await api.delete(`/files/${id}/`);
}

// search (entirely in the browser)
// Names are encrypted on the server, so it cannot search them. The browser fetches all metadata,
// decrypts the names locally and filters them; the query itself never leaves the browser
export interface SearchIndex {
  items: DriveItem[];
  /** "Мой диск / A / B" for a folder id (null = root). */
  pathOf: (folderId: string | null) => string;
}

export async function buildSearchIndex(): Promise<SearchIndex> {
  const masterKey = requireMasterKey();
  const [{ data: folderDtos }, { data: fileDtos }] = await Promise.all([
    api.get<FolderDto[]>("/folders/tree/"),
    api.get<FileDto[]>("/files/"),
  ]);
  const [folders, files] = await Promise.all([
    Promise.all(folderDtos.map((f) => toFolder(f, masterKey))),
    Promise.all(fileDtos.map((f) => toFile(f, masterKey))),
  ]);

  const byId = new Map(folders.map((f) => [f.id, f]));
  const cache = new Map<string | null, string>([[null, "Мой диск"]]);
  const pathOf = (folderId: string | null): string => {
    const cached = cache.get(folderId);
    if (cached !== undefined) return cached;
    const folder = folderId ? byId.get(folderId) : undefined;
    const path = folder ? `${pathOf(folder.parentId)} / ${folder.name ?? "…"}` : "Мой диск";
    cache.set(folderId, path);
    return path;
  };

  return { items: [...folders, ...files], pathOf };
}

const normalize = (text: string) => text.toLocaleLowerCase("ru").replace(/ё/g, "е");

/** Case-insensitive substring match on decrypted names ("ё" = "е"). */
export function searchItems(index: SearchIndex, query: string): DriveItem[] {
  const needle = normalize(query.trim());
  if (!needle) return [];
  return index.items.filter((item) => item.name !== null && normalize(item.name).includes(needle));
}

export function parentOf(item: DriveItem): string | null {
  return item.kind === "folder" ? item.parentId : item.folderId;
}