import { invoke } from "@tauri-apps/api/core";

interface AndroidStorageBridge {
  archiveDirectory: (
    rootUri: string,
    sourceRelativePath: string,
    archiveRelativePath: string,
  ) => string;
  deleteChildrenExcept: (
    rootUri: string,
    relativePath: string,
    keepName: string,
  ) => string;
  deletePath: (rootUri: string, relativePath: string) => string;
  deleteRootChildren: (rootUri: string) => string;
  pathSize: (rootUri: string, relativePath: string) => string;
  pickMediaStorageRoot: (requestId: string) => void;
  readBase64: (rootUri: string, relativePath: string) => string;
  readContentUriBase64: (uri: string) => string;
  readText: (rootUri: string, relativePath: string) => string;
  readZipEntryBase64: (
    rootUri: string,
    archiveRelativePath: string,
    entryName: string,
  ) => string;
  writeContentUriFile: (
    uri: string,
    inputPath: string,
    mimeType: string,
  ) => string;
  writeBytes: (
    rootUri: string,
    relativePath: string,
    base64: string,
    mimeType: string,
  ) => string;
  writeContentUriBytes: (
    uri: string,
    base64: string,
    mimeType: string,
  ) => string;
  writeText: (rootUri: string, relativePath: string, text: string) => string;
  zipEntryExists: (
    rootUri: string,
    archiveRelativePath: string,
    entryName: string,
  ) => string;
}

interface AndroidStoragePickPayload {
  cancelled?: boolean;
  error?: string;
  ok: boolean;
  root?: string;
}

interface AndroidStorageResponse {
  error?: string;
  ok: boolean;
}

interface AndroidStorageTextResponse extends AndroidStorageResponse {
  text?: string;
}

interface AndroidStorageBase64Response extends AndroidStorageResponse {
  base64?: string;
  mimeType?: string;
}

interface AndroidStorageSizeResponse extends AndroidStorageResponse {
  bytes?: number;
}

interface AndroidStorageExistsResponse extends AndroidStorageResponse {
  exists?: boolean;
}

const ANDROID_STORAGE_NOT_SELECTED =
  "Android media storage folder has not been selected.";
const CONTENTS_NOMEDIA_PATH = "contents/.nomedia";

const pickResolvers = new Map<
  string,
  (payload: AndroidStoragePickPayload) => void
>();
const nomediaRoots = new Set<string>();

declare global {
  interface Window {
    __lnrResolveAndroidStoragePick?: (
      requestId: string,
      payload: AndroidStoragePickPayload,
    ) => void;
    __NoreaAndroidStorage?: AndroidStorageBridge;
  }
}

function androidStorageBridge(): AndroidStorageBridge {
  const bridge = window.__NoreaAndroidStorage;
  if (!bridge) {
    throw new Error("Android storage bridge is unavailable.");
  }
  return bridge;
}

function parseStorageResponse<T extends AndroidStorageResponse>(raw: string): T {
  const payload = JSON.parse(raw) as T;
  if (!payload.ok) {
    throw new Error(payload.error ?? "Android storage operation failed.");
  }
  return payload;
}

function bytesToBase64(bytes: number[]): string {
  let binary = "";
  const chunkSize = 0x8000;
  for (let index = 0; index < bytes.length; index += chunkSize) {
    const chunk = bytes.slice(index, index + chunkSize);
    binary += String.fromCharCode(...chunk);
  }
  return btoa(binary);
}

function base64ToBytes(base64: string): number[] {
  const binary = atob(base64);
  const bytes = new Array<number>(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

function makeRequestId(): string {
  return `${Date.now().toString(36)}-${Math.random()
    .toString(36)
    .slice(2, 10)}`;
}

async function ensureAndroidStorageNomedia(root: string): Promise<void> {
  if (nomediaRoots.has(root)) return;
  parseStorageResponse(
    androidStorageBridge().writeBytes(
      root,
      CONTENTS_NOMEDIA_PATH,
      "",
      "application/octet-stream",
    ),
  );
  nomediaRoots.add(root);
}

async function androidStorageRoot(): Promise<string> {
  const root = (await invoke<string | null>(
    "chapter_media_get_storage_root",
  ))?.trim();
  if (!root) {
    throw new Error(ANDROID_STORAGE_NOT_SELECTED);
  }
  if (!root.startsWith("content://")) {
    throw new Error("Android media storage folder must be selected again.");
  }
  await ensureAndroidStorageNomedia(root);
  return root;
}

function ensurePickResolver(): void {
  window.__lnrResolveAndroidStoragePick ??= (
    requestId: string,
    payload: AndroidStoragePickPayload,
  ) => {
    const resolve = pickResolvers.get(requestId);
    if (!resolve) return;
    pickResolvers.delete(requestId);
    resolve(payload);
  };
}

export async function selectAndroidStorageRoot(): Promise<string | null> {
  ensurePickResolver();
  const requestId = makeRequestId();
  const payload = await new Promise<AndroidStoragePickPayload>((resolve) => {
    pickResolvers.set(requestId, resolve);
    try {
      androidStorageBridge().pickMediaStorageRoot(requestId);
    } catch (error) {
      pickResolvers.delete(requestId);
      throw error;
    }
  });
  if (payload.cancelled) return null;
  if (!payload.ok || !payload.root) {
    throw new Error(payload.error ?? "Android storage folder was not selected.");
  }
  const root = await invoke<string>("chapter_media_set_storage_root", {
    root: payload.root,
  });
  await ensureAndroidStorageNomedia(root);
  return root;
}

export async function writeAndroidStorageBytes(
  relativePath: string,
  body: number[],
  mimeType: string,
): Promise<void> {
  const root = await androidStorageRoot();
  parseStorageResponse(
    androidStorageBridge().writeBytes(
      root,
      relativePath,
      bytesToBase64(body),
      mimeType,
    ),
  );
}

export async function writeAndroidContentUriBytes(
  uri: string,
  body: number[],
  mimeType: string,
): Promise<void> {
  parseStorageResponse(
    androidStorageBridge().writeContentUriBytes(
      uri,
      bytesToBase64(body),
      mimeType,
    ),
  );
}

export async function writeAndroidContentUriFile(
  uri: string,
  inputPath: string,
  mimeType: string,
): Promise<void> {
  parseStorageResponse(
    androidStorageBridge().writeContentUriFile(uri, inputPath, mimeType),
  );
}

export async function readAndroidContentUriBytes(uri: string): Promise<number[]> {
  const response = parseStorageResponse<AndroidStorageBase64Response>(
    androidStorageBridge().readContentUriBase64(uri),
  );
  return base64ToBytes(response.base64 ?? "");
}

export async function writeAndroidStorageText(
  relativePath: string,
  text: string,
): Promise<void> {
  const root = await androidStorageRoot();
  parseStorageResponse(
    androidStorageBridge().writeText(root, relativePath, text),
  );
}

export async function archiveAndroidStorageDirectory(
  sourceRelativePath: string,
  archiveRelativePath: string,
): Promise<number> {
  const root = await androidStorageRoot();
  const response = parseStorageResponse<AndroidStorageSizeResponse>(
    androidStorageBridge().archiveDirectory(
      root,
      sourceRelativePath,
      archiveRelativePath,
    ),
  );
  return response.bytes ?? 0;
}

export async function readAndroidStorageText(
  relativePath: string,
): Promise<string | null> {
  const root = await androidStorageRoot();
  try {
    const response = parseStorageResponse<AndroidStorageTextResponse>(
      androidStorageBridge().readText(root, relativePath),
    );
    return response.text ?? "";
  } catch (error) {
    if (error instanceof Error && /not found/i.test(error.message)) return null;
    throw error;
  }
}

export async function readAndroidStorageDataUrl(
  relativePath: string,
): Promise<string | null> {
  const root = await androidStorageRoot();
  try {
    const response = parseStorageResponse<AndroidStorageBase64Response>(
      androidStorageBridge().readBase64(root, relativePath),
    );
    if (!response.base64) return null;
    return `data:${response.mimeType ?? "application/octet-stream"};base64,${
      response.base64
    }`;
  } catch (error) {
    if (error instanceof Error && /not found/i.test(error.message)) return null;
    throw error;
  }
}

export async function readAndroidStorageZipEntryDataUrl(
  archiveRelativePath: string,
  entryName: string,
): Promise<string | null> {
  const root = await androidStorageRoot();
  try {
    const response = parseStorageResponse<AndroidStorageBase64Response>(
      androidStorageBridge().readZipEntryBase64(
        root,
        archiveRelativePath,
        entryName,
      ),
    );
    if (!response.base64) return null;
    return `data:${response.mimeType ?? "application/octet-stream"};base64,${
      response.base64
    }`;
  } catch (error) {
    if (error instanceof Error && /not found/i.test(error.message)) return null;
    throw error;
  }
}

export async function androidStoragePathSize(
  relativePath: string,
): Promise<number> {
  const root = await androidStorageRoot();
  const response = parseStorageResponse<AndroidStorageSizeResponse>(
    androidStorageBridge().pathSize(root, relativePath),
  );
  return response.bytes ?? 0;
}

export async function androidStorageZipEntryExists(
  archiveRelativePath: string,
  entryName: string,
): Promise<boolean> {
  const root = await androidStorageRoot();
  const response = parseStorageResponse<AndroidStorageExistsResponse>(
    androidStorageBridge().zipEntryExists(root, archiveRelativePath, entryName),
  );
  return response.exists ?? false;
}

export async function deleteAndroidStoragePath(
  relativePath: string,
): Promise<void> {
  const root = await androidStorageRoot();
  parseStorageResponse(androidStorageBridge().deletePath(root, relativePath));
}

export async function deleteAndroidStorageChildrenExcept(
  relativePath: string,
  keepName: string,
): Promise<void> {
  const root = await androidStorageRoot();
  parseStorageResponse(
    androidStorageBridge().deleteChildrenExcept(root, relativePath, keepName),
  );
}

export async function clearAndroidStorageRoot(): Promise<void> {
  const root = await androidStorageRoot();
  parseStorageResponse(androidStorageBridge().deleteRootChildren(root));
  nomediaRoots.delete(root);
  await ensureAndroidStorageNomedia(root);
}
