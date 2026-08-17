import * as path from 'path';
import { describe, expect, test } from 'vitest';

import {
  buildDshSpawnEnv,
  buildDshWebArgs,
  DSH_NODE_EXEC_ARGV,
  DSH_RUNTIME_ENTRY_RELPATH,
  parseDshRuntimeBuildInfo,
  resolveDshRuntimeCandidates,
  resolveDshWorkingDirectory,
  validateDshRuntimeLayout,
} from './dshRuntime';

describe('parseDshRuntimeBuildInfo', () => {
  test('parses a valid build info payload', () => {
    const info = parseDshRuntimeBuildInfo(
      JSON.stringify({ target: 'mac-arm64', dshVersion: '0.1.0-rc.6', patchHash: 'none', builtAt: '2026-08-16T00:00:00Z' })
    );
    expect(info).toEqual({ target: 'mac-arm64', dshVersion: '0.1.0-rc.6', patchHash: 'none', builtAt: '2026-08-16T00:00:00Z' });
  });

  test('rejects payloads missing required fields', () => {
    expect(parseDshRuntimeBuildInfo(JSON.stringify({ target: 'mac-arm64' }))).toBeNull();
    expect(parseDshRuntimeBuildInfo(JSON.stringify(['not', 'an', 'object']))).toBeNull();
  });

  test('rejects invalid JSON', () => {
    expect(parseDshRuntimeBuildInfo('{oops')).toBeNull();
  });
});

describe('resolveDshRuntimeCandidates', () => {
  test('packaged apps read only the resources copy', () => {
    const candidates = resolveDshRuntimeCandidates({
      isPackaged: true,
      resourcesPath: '/app/Resources',
      appPath: '/app',
      cwd: '/somewhere',
      joinPath: path.posix.join,
    });
    expect(candidates).toEqual(['/app/Resources/dsh']);
  });

  test('dev builds read vendor/dsh-runtime/current from app path and cwd', () => {
    const candidates = resolveDshRuntimeCandidates({
      isPackaged: false,
      resourcesPath: '/unused',
      appPath: '/repo',
      cwd: '/elsewhere',
      joinPath: path.posix.join,
    });
    expect(candidates).toEqual(['/repo/vendor/dsh-runtime/current', '/elsewhere/vendor/dsh-runtime/current']);
  });

  test('deduplicates when app path and cwd match', () => {
    const candidates = resolveDshRuntimeCandidates({
      isPackaged: false,
      resourcesPath: '/unused',
      appPath: '/repo',
      cwd: '/repo',
      joinPath: path.posix.join,
    });
    expect(candidates).toEqual(['/repo/vendor/dsh-runtime/current']);
  });
});

describe('validateDshRuntimeLayout', () => {
  test('accepts a complete runtime', () => {
    const present = new Set([
      '/rt/lib/bin.js',
      '/rt/node_modules',
      '/rt/node_modules/@deepseek-ai/dsh-web-frontend/dist/index.html',
    ]);
    const check = validateDshRuntimeLayout('/rt', (p) => present.has(p), path.posix.join);
    expect(check).toEqual({ ok: true, missing: [] });
  });

  test('reports every missing path', () => {
    const check = validateDshRuntimeLayout('/rt', () => false, path.posix.join);
    expect(check.ok).toBe(false);
    expect(check.missing).toContain(DSH_RUNTIME_ENTRY_RELPATH);
    expect(check.missing).toHaveLength(3);
  });
});

describe('buildDshSpawnEnv', () => {
  test('sets DSH_HOME, disables telemetry by default, and drops undefined entries', () => {
    const env = buildDshSpawnEnv({
      baseEnv: { PATH: '/usr/bin', DROPPED: undefined },
      dshHome: '/home/user/data/dsh',
    });
    expect(env.DSH_HOME).toBe('/home/user/data/dsh');
    expect(env.DSH_TELEMETRY_DISABLED).toBe('1');
    expect(env.PATH).toBe('/usr/bin');
    expect('DROPPED' in env).toBe(false);
  });

  test('only fills TZ when the base environment has none', () => {
    const withTz = buildDshSpawnEnv({ baseEnv: { TZ: 'UTC' }, dshHome: '/d', timeZone: 'Asia/Shanghai' });
    expect(withTz.TZ).toBe('UTC');
    const withoutTz = buildDshSpawnEnv({ baseEnv: {}, dshHome: '/d', timeZone: 'Asia/Shanghai' });
    expect(withoutTz.TZ).toBe('Asia/Shanghai');
  });

  test('can keep telemetry enabled explicitly', () => {
    const env = buildDshSpawnEnv({ baseEnv: {}, dshHome: '/d', telemetryDisabled: false });
    expect('DSH_TELEMETRY_DISABLED' in env).toBe(false);
  });
});

describe('resolveDshWorkingDirectory', () => {
  const existing = new Set(['/work/project', '/Users/me']);
  const isDirectory = (candidate: string) => existing.has(candidate);

  test('takes the first candidate that exists', () => {
    expect(resolveDshWorkingDirectory(['/work/project', '/Users/me'], isDirectory, '/runtime')).toBe('/work/project');
  });

  test('skips blank, missing, and whitespace-only candidates', () => {
    expect(resolveDshWorkingDirectory([undefined, '', '   ', '/gone', '/Users/me'], isDirectory, '/runtime')).toBe('/Users/me');
  });

  // The fallback is the runtime install directory: usable, but it must never
  // win over a real working directory.
  test('falls back only when nothing else resolves', () => {
    expect(resolveDshWorkingDirectory([undefined, '/gone'], isDirectory, '/runtime')).toBe('/runtime');
  });
});

describe('spawn argument helpers', () => {
  test('buildDshWebArgs produces the web invocation', () => {
    expect(buildDshWebArgs('/rt/lib/bin.js', 31163)).toEqual(['/rt/lib/bin.js', 'web', '--port', '31163']);
  });

  test('exec argv carries the loader internals flag', () => {
    expect(DSH_NODE_EXEC_ARGV).toContain('--expose-internals');
  });
});
