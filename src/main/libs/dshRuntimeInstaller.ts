// Installs a packed dsh runtime archive into a writable base directory (the
// packaged app uses userData/dsh-runtime).
//
// An install is driven by a self-contained artifact descriptor — version,
// target, sha256, size, and exactly one source (an absolute URL or a local
// file). Nothing is derived by joining paths, so each archive can live at an
// arbitrary, unrelated URL.
//
// Production descriptors ship inside the app (package.json `dsh.runtimes`)
// rather than being fetched next to the archive. That is what makes the digest
// check meaningful: a digest fetched from the same host as the archive can be
// replaced together with it.
//
// No Electron imports here so the whole install path stays scriptable and
// unit testable.

import { spawnSync } from 'child_process';
import * as crypto from 'crypto';
import * as fs from 'fs';
import * as http from 'http';
import * as https from 'https';
import * as path from 'path';

import { validateDshRuntimeLayout } from './dshRuntime';

const INSTALL_SENTINEL = '.lobsterai-install-ok.json';
const MAX_REDIRECTS = 5;
const DOWNLOAD_TIMEOUT_MS = 10 * 60_000;

export interface DshRuntimeManifest {
  version: string;
  target: string;
  archive: string;
  sha256: string;
  size: number;
  patchHash?: string;
}

/** Everything needed to fetch and trust one runtime archive. */
export interface DshRuntimeArtifact {
  version: string;
  target: string;
  sha256: string;
  size: number;
  /** Absolute http(s) URL of the archive; no path is appended to it. */
  url?: string;
  /** Local archive path, used by dev builds and offline packaging. */
  filePath?: string;
}

export interface DshRuntimeInstallResult {
  root: string;
  version: string;
  alreadyInstalled: boolean;
}

export type DshInstallProgress =
  | { phase: 'manifest' }
  | { phase: 'download'; receivedBytes: number; totalBytes: number }
  | { phase: 'verify' }
  | { phase: 'extract' };

export function parseDshRuntimeManifest(raw: string): DshRuntimeManifest | null {
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return null;
    const record = parsed as Record<string, unknown>;
    if (
      typeof record.version !== 'string' ||
      typeof record.target !== 'string' ||
      typeof record.archive !== 'string' ||
      typeof record.sha256 !== 'string' ||
      typeof record.size !== 'number'
    ) {
      return null;
    }
    if (record.archive.includes('/') || record.archive.includes('\\') || record.archive.includes('..')) {
      return null;
    }
    return {
      version: record.version,
      target: record.target,
      archive: record.archive,
      sha256: record.sha256.toLowerCase(),
      size: record.size,
      patchHash: typeof record.patchHash === 'string' ? record.patchHash : undefined,
    };
  } catch {
    return null;
  }
}

export function isHttpSource(base: string): boolean {
  return /^https?:\/\//i.test(base);
}

export function installedDshRuntimeRoot(baseDir: string, version: string): string {
  return path.join(baseDir, version);
}

// Scan the install base for the newest valid runtime (semver-ish string sort
// is fine for dsh's 0.x.y-rc.N scheme at pin granularity — the app only ever
// installs the one pinned version, so multiple entries mean an upgrade).
export function resolveNewestInstalledDshRuntime(baseDir: string): { root: string; version: string } | null {
  let entries: string[];
  try {
    entries = fs.readdirSync(baseDir);
  } catch {
    return null;
  }
  const valid = entries
    .filter((name) => !name.endsWith('.staging') && resolveInstalledDshRuntime(baseDir, name) !== null)
    .sort()
    .reverse();
  if (valid.length === 0) return null;
  const version = valid[0];
  return { root: installedDshRuntimeRoot(baseDir, version), version };
}

// A runtime counts as installed only when the install sentinel exists and the
// layout still passes — a torn extract or a user-deleted node_modules must
// read as "not installed" so the next install repairs it.
export function resolveInstalledDshRuntime(baseDir: string, version: string): string | null {
  const root = installedDshRuntimeRoot(baseDir, version);
  if (!fs.existsSync(path.join(root, INSTALL_SENTINEL))) return null;
  const layout = validateDshRuntimeLayout(root, fs.existsSync, path.join);
  return layout.ok ? root : null;
}

// Builds an artifact from the app's own configuration (package.json
// `dsh.runtimes[target]`), the production path. Each target names one absolute
// URL, so a CDN that hands out an unrelated URL per file works unchanged.
export function resolveDshArtifactFromConfig(
  runtimes: unknown,
  target: string,
  version: string
): DshRuntimeArtifact | null {
  if (!runtimes || typeof runtimes !== 'object') return null;
  const entry = (runtimes as Record<string, unknown>)[target];
  if (!entry || typeof entry !== 'object') return null;
  const record = entry as Record<string, unknown>;
  if (typeof record.url !== 'string' || !isHttpSource(record.url)) return null;
  if (typeof record.sha256 !== 'string' || !/^[0-9a-f]{64}$/i.test(record.sha256)) return null;
  if (typeof record.size !== 'number' || !Number.isInteger(record.size) || record.size <= 0) return null;
  return { version, target, sha256: record.sha256.toLowerCase(), size: record.size, url: record.url };
}

// Builds an artifact from a manifest written by scripts/pack-dsh-runtime.cjs.
// Used for dev builds, offline packaging, and the end-to-end test, where the
// archive really does sit beside its manifest.
export function resolveDshArtifactFromManifest(distDir: string, manifestName: string): DshRuntimeArtifact {
  const manifestPath = path.join(distDir, manifestName);
  const manifest = parseDshRuntimeManifest(fs.readFileSync(manifestPath, 'utf8'));
  if (!manifest) throw new Error(`Invalid dsh runtime manifest at ${manifestPath}`);
  return {
    version: manifest.version,
    target: manifest.target,
    sha256: manifest.sha256,
    size: manifest.size,
    filePath: path.join(distDir, manifest.archive),
  };
}

export async function installDshRuntime(options: {
  artifact: DshRuntimeArtifact;
  baseDir: string;
  expectedTarget: string;
  onProgress?: (progress: DshInstallProgress) => void;
}): Promise<DshRuntimeInstallResult> {
  const { artifact, baseDir, expectedTarget, onProgress } = options;

  if (artifact.target !== expectedTarget) {
    throw new Error(`Artifact target ${artifact.target} does not match expected ${expectedTarget}`);
  }
  if (!artifact.url && !artifact.filePath) {
    throw new Error(`Artifact for ${artifact.target} names neither a url nor a filePath`);
  }

  const existing = resolveInstalledDshRuntime(baseDir, artifact.version);
  if (existing) {
    return { root: existing, version: artifact.version, alreadyInstalled: true };
  }

  fs.mkdirSync(baseDir, { recursive: true });
  const archiveTempPath = path.join(baseDir, `.download-${process.pid}-${artifact.version}-${artifact.target}.tar.gz`);
  const stagingRoot = `${installedDshRuntimeRoot(baseDir, artifact.version)}.staging`;
  try {
    onProgress?.({ phase: 'manifest' });
    if (artifact.url) {
      await httpGetToFile(artifact.url, archiveTempPath, artifact.size, onProgress);
    } else {
      await fs.promises.copyFile(artifact.filePath as string, archiveTempPath);
      onProgress?.({ phase: 'download', receivedBytes: artifact.size, totalBytes: artifact.size });
    }

    onProgress?.({ phase: 'verify' });
    const actualSize = fs.statSync(archiveTempPath).size;
    if (actualSize !== artifact.size) {
      throw new Error(`Archive size mismatch: expected ${artifact.size}, got ${actualSize}`);
    }
    const actualSha = await sha256OfFile(archiveTempPath);
    if (actualSha !== artifact.sha256) {
      throw new Error(`Archive sha256 mismatch: expected ${artifact.sha256}, got ${actualSha}`);
    }

    onProgress?.({ phase: 'extract' });
    fs.rmSync(stagingRoot, { recursive: true, force: true });
    fs.mkdirSync(stagingRoot, { recursive: true });
    const tarResult = spawnSync('tar', ['-xzf', archiveTempPath, '-C', stagingRoot], {
      stdio: ['ignore', 'ignore', 'pipe'],
      shell: process.platform === 'win32',
    });
    if (tarResult.status !== 0) {
      throw new Error(`tar extract failed: ${String(tarResult.stderr ?? '').slice(0, 500)}`);
    }

    const layout = validateDshRuntimeLayout(stagingRoot, fs.existsSync, path.join);
    if (!layout.ok) {
      throw new Error(`Extracted runtime is incomplete, missing: ${layout.missing.join(', ')}`);
    }

    fs.writeFileSync(
      path.join(stagingRoot, INSTALL_SENTINEL),
      `${JSON.stringify({ installedAt: new Date().toISOString(), version: artifact.version, sha256: artifact.sha256 }, null, 2)}\n`
    );

    const finalRoot = installedDshRuntimeRoot(baseDir, artifact.version);
    fs.rmSync(finalRoot, { recursive: true, force: true });
    fs.renameSync(stagingRoot, finalRoot);
    return { root: finalRoot, version: artifact.version, alreadyInstalled: false };
  } finally {
    fs.rmSync(archiveTempPath, { force: true });
    fs.rmSync(stagingRoot, { recursive: true, force: true });
  }
}

function sha256OfFile(filePath: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash('sha256');
    const stream = fs.createReadStream(filePath);
    stream.on('error', reject);
    stream.on('data', (chunk) => hash.update(chunk));
    stream.on('end', () => resolve(hash.digest('hex')));
  });
}

function httpGetToFile(
  url: string,
  destPath: string,
  totalBytes: number,
  onProgress?: (progress: DshInstallProgress) => void,
  redirectsLeft = MAX_REDIRECTS
): Promise<void> {
  return new Promise((resolve, reject) => {
    const client = url.startsWith('https:') ? https : http;
    const request = client.get(url, { timeout: DOWNLOAD_TIMEOUT_MS }, (response) => {
      const status = response.statusCode ?? 0;
      if (status >= 300 && status < 400 && response.headers.location && redirectsLeft > 0) {
        response.resume();
        resolve(httpGetToFile(new URL(response.headers.location, url).toString(), destPath, totalBytes, onProgress, redirectsLeft - 1));
        return;
      }
      if (status !== 200) {
        response.resume();
        reject(new Error(`HTTP ${status} for ${url}`));
        return;
      }
      const file = fs.createWriteStream(destPath);
      let received = 0;
      response.on('data', (chunk: Buffer) => {
        received += chunk.length;
        onProgress?.({ phase: 'download', receivedBytes: received, totalBytes });
      });
      response.pipe(file);
      file.on('finish', () => file.close(() => resolve()));
      file.on('error', reject);
      response.on('error', reject);
    });
    request.on('timeout', () => request.destroy(new Error(`Timeout downloading ${url}`)));
    request.on('error', reject);
  });
}
