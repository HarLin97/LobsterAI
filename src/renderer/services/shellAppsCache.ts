/**
 * Renderer-side cache for "Open with" app lists.
 *
 * The main process resolves candidate apps via LaunchServices/registry probes
 * plus per-app icon rasterization, which takes noticeable time on first run.
 * Preview cards prefetch on mount through this module so the dropdown renders
 * instantly from cache instead of showing a loading state on open.
 */

export interface ShellAppInfo {
  name: string;
  path: string;
  isDefault: boolean;
  icon?: string;
}

const appListCache = new Map<string, ShellAppInfo[]>();
const pendingFetches = new Map<string, Promise<ShellAppInfo[] | null>>();

export function normalizeShellFilePath(filePath: string): string {
  let normalized = filePath;
  if (normalized.startsWith('file:///')) {
    normalized = normalized.slice(7);
  } else if (normalized.startsWith('file://')) {
    normalized = normalized.slice(7);
  } else if (normalized.startsWith('file:/')) {
    normalized = normalized.slice(5);
  }
  if (/^\/[A-Za-z]:/.test(normalized)) {
    normalized = normalized.slice(1);
  }
  return normalized;
}

// The main process resolves app lists per file extension, so cache on the
// same key to share entries across files of one type.
function fileCacheKey(filePath: string): string {
  const normalized = normalizeShellFilePath(filePath);
  const base = normalized.split(/[\\/]/).pop() ?? normalized;
  const dotIndex = base.lastIndexOf('.');
  const ext = dotIndex > 0 ? base.slice(dotIndex).toLowerCase() : '';
  return `file-ext:${ext || normalized.toLowerCase()}`;
}

function browserCacheKey(projectDirectory?: string): string {
  return `browser:${projectDirectory?.trim() || ''}`;
}

export function getCachedAppsForFile(filePath: string): ShellAppInfo[] | null {
  return appListCache.get(fileCacheKey(filePath)) ?? null;
}

export function getCachedBrowserApps(projectDirectory?: string): ShellAppInfo[] | null {
  return appListCache.get(browserCacheKey(projectDirectory)) ?? null;
}

type AppListResponse = { success: boolean; apps: ShellAppInfo[]; error?: string } | undefined;

function fetchIntoCache(
  key: string,
  startRequest: () => Promise<AppListResponse> | undefined,
): Promise<ShellAppInfo[] | null> {
  const cached = appListCache.get(key);
  if (cached) return Promise.resolve(cached);

  const pending = pendingFetches.get(key);
  if (pending) return pending;

  const request = startRequest();
  if (!request) return Promise.resolve(null);

  const fetchPromise = request
    .then(result => {
      if (result?.success && result.apps?.length > 0) {
        appListCache.set(key, result.apps);
        return result.apps;
      }
      return null;
    })
    .catch(() => null)
    .finally(() => {
      pendingFetches.delete(key);
    });
  pendingFetches.set(key, fetchPromise);
  return fetchPromise;
}

export function prefetchAppsForFile(filePath: string): Promise<ShellAppInfo[] | null> {
  return fetchIntoCache(
    fileCacheKey(filePath),
    () => window.electron?.shell?.getAppsForFile(normalizeShellFilePath(filePath)),
  );
}

export function prefetchBrowserApps(projectDirectory?: string): Promise<ShellAppInfo[] | null> {
  const trimmed = projectDirectory?.trim();
  return fetchIntoCache(
    browserCacheKey(trimmed),
    () => window.electron?.shell?.getBrowserApps(trimmed ? { projectDirectory: trimmed } : undefined),
  );
}
