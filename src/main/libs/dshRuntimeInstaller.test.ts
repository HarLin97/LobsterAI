import { spawnSync } from 'child_process';
import * as crypto from 'crypto';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { afterAll, describe, expect, test } from 'vitest';

import {
  installDshRuntime,
  isHttpSource,
  parseDshRuntimeManifest,
  resolveDshArtifactFromConfig,
  resolveDshArtifactFromManifest,
  resolveInstalledDshRuntime,
} from './dshRuntimeInstaller';

const tempRoots: string[] = [];

function makeTempDir(prefix: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  tempRoots.push(dir);
  return dir;
}

afterAll(() => {
  for (const dir of tempRoots) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// Minimal tree that passes validateDshRuntimeLayout.
function writeFakeRuntime(dir: string): void {
  fs.mkdirSync(path.join(dir, 'lib'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'lib', 'bin.js'), 'console.log("fake dsh")\n');
  const frontendDist = path.join(dir, 'node_modules', '@deepseek-ai', 'dsh-web-frontend', 'dist');
  fs.mkdirSync(frontendDist, { recursive: true });
  fs.writeFileSync(path.join(frontendDist, 'index.html'), '<!doctype html>\n');
}

function packFakeRuntime(runtimeDir: string, distDir: string, version: string, target: string): string {
  const archiveName = `dsh-runtime-${version}-${target}.tar.gz`;
  const archivePath = path.join(distDir, archiveName);
  const result = spawnSync('tar', ['-czf', archivePath, '-C', runtimeDir, '.']);
  expect(result.status).toBe(0);
  const bytes = fs.readFileSync(archivePath);
  const manifestName = `dsh-runtime-${version}-${target}.manifest.json`;
  fs.writeFileSync(
    path.join(distDir, manifestName),
    JSON.stringify({
      version,
      target,
      archive: archiveName,
      sha256: crypto.createHash('sha256').update(bytes).digest('hex'),
      size: bytes.length,
    })
  );
  return manifestName;
}

describe('parseDshRuntimeManifest', () => {
  test('accepts a complete manifest and lowercases the digest', () => {
    const manifest = parseDshRuntimeManifest(
      JSON.stringify({ version: '1.0.0', target: 'mac-arm64', archive: 'a.tar.gz', sha256: 'ABCD', size: 10 })
    );
    expect(manifest).toMatchObject({ version: '1.0.0', target: 'mac-arm64', sha256: 'abcd', size: 10 });
  });

  test('rejects missing fields, path traversal, and invalid JSON', () => {
    expect(parseDshRuntimeManifest(JSON.stringify({ version: '1' }))).toBeNull();
    expect(
      parseDshRuntimeManifest(
        JSON.stringify({ version: '1', target: 't', archive: '../evil.tar.gz', sha256: 'a', size: 1 })
      )
    ).toBeNull();
    expect(parseDshRuntimeManifest('{nope')).toBeNull();
  });
});

describe('isHttpSource', () => {
  test('distinguishes URLs from local paths', () => {
    expect(isHttpSource('https://cdn.example.com/dsh')).toBe(true);
    expect(isHttpSource('http://127.0.0.1:8080')).toBe(true);
    expect(isHttpSource('/Users/me/vendor/dsh-dist')).toBe(false);
    expect(isHttpSource('C:\\dist')).toBe(false);
  });
});

describe('resolveDshArtifactFromConfig', () => {
  const sha = 'a'.repeat(64);

  test('accepts one absolute URL per target, appending nothing to it', () => {
    const artifact = resolveDshArtifactFromConfig(
      { 'mac-arm64': { url: 'https://cdn.example.com/opaque/xyz?token=1', sha256: sha.toUpperCase(), size: 10 } },
      'mac-arm64',
      '1.2.3'
    );
    expect(artifact).toEqual({
      version: '1.2.3',
      target: 'mac-arm64',
      sha256: sha,
      size: 10,
      url: 'https://cdn.example.com/opaque/xyz?token=1',
    });
  });

  test('returns null for an unconfigured target', () => {
    expect(resolveDshArtifactFromConfig({ 'mac-arm64': { url: 'https://x/y', sha256: sha, size: 1 } }, 'win-x64', '1')).toBeNull();
  });

  // A descriptor that cannot be trusted must not install anything.
  test('rejects a non-http url, a malformed digest, and a bad size', () => {
    expect(resolveDshArtifactFromConfig({ t: { url: 'file:///tmp/x', sha256: sha, size: 1 } }, 't', '1')).toBeNull();
    expect(resolveDshArtifactFromConfig({ t: { url: 'https://x/y', sha256: 'nope', size: 1 } }, 't', '1')).toBeNull();
    expect(resolveDshArtifactFromConfig({ t: { url: 'https://x/y', sha256: sha, size: 0 } }, 't', '1')).toBeNull();
    expect(resolveDshArtifactFromConfig(null, 't', '1')).toBeNull();
  });
});

describe('installDshRuntime (local source round-trip)', () => {
  test('installs, is idempotent, and repairs a torn install', async () => {
    const runtimeDir = makeTempDir('dsh-inst-src-');
    const distDir = makeTempDir('dsh-inst-dist-');
    const baseDir = makeTempDir('dsh-inst-dest-');
    writeFakeRuntime(runtimeDir);
    const manifestName = packFakeRuntime(runtimeDir, distDir, '9.9.9', 'mac-arm64');

    const phases: string[] = [];
    const artifact = resolveDshArtifactFromManifest(distDir, manifestName);
    const first = await installDshRuntime({
      artifact,
      baseDir,
      expectedTarget: 'mac-arm64',
      onProgress: (p) => phases.push(p.phase),
    });
    expect(first.alreadyInstalled).toBe(false);
    expect(fs.existsSync(path.join(first.root, 'lib', 'bin.js'))).toBe(true);
    expect(phases).toContain('download');
    expect(phases).toContain('verify');
    expect(phases).toContain('extract');
    expect(resolveInstalledDshRuntime(baseDir, '9.9.9')).toBe(first.root);

    const second = await installDshRuntime({ artifact, baseDir, expectedTarget: 'mac-arm64' });
    expect(second.alreadyInstalled).toBe(true);
    expect(second.root).toBe(first.root);

    // A torn install (missing node_modules) must not count as installed and
    // must be repaired by the next install call.
    fs.rmSync(path.join(first.root, 'node_modules'), { recursive: true, force: true });
    expect(resolveInstalledDshRuntime(baseDir, '9.9.9')).toBeNull();
    const third = await installDshRuntime({ artifact, baseDir, expectedTarget: 'mac-arm64' });
    expect(third.alreadyInstalled).toBe(false);
    expect(resolveInstalledDshRuntime(baseDir, '9.9.9')).toBe(third.root);
  });

  test('rejects a target mismatch and a corrupted archive', async () => {
    const runtimeDir = makeTempDir('dsh-inst-src2-');
    const distDir = makeTempDir('dsh-inst-dist2-');
    const baseDir = makeTempDir('dsh-inst-dest2-');
    writeFakeRuntime(runtimeDir);
    const manifestName = packFakeRuntime(runtimeDir, distDir, '9.9.8', 'win-x64');

    await expect(
      installDshRuntime({
        artifact: resolveDshArtifactFromManifest(distDir, manifestName),
        baseDir,
        expectedTarget: 'mac-arm64',
      })
    ).rejects.toThrow(/target/);

    // Corrupt the archive after the manifest recorded its hash.
    const manifest = JSON.parse(fs.readFileSync(path.join(distDir, manifestName), 'utf8')) as { archive: string };
    fs.appendFileSync(path.join(distDir, manifest.archive), 'garbage');
    await expect(
      installDshRuntime({
        artifact: resolveDshArtifactFromManifest(distDir, manifestName),
        baseDir,
        expectedTarget: 'win-x64',
      })
    ).rejects.toThrow(/size mismatch|sha256 mismatch/);
    expect(resolveInstalledDshRuntime(baseDir, '9.9.8')).toBeNull();
  });
});
