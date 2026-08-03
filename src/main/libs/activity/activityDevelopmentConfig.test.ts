import { describe, expect, test } from 'vitest';

import { resolveActivityServerBaseUrl } from './activityDevelopmentConfig';

const defaultBaseUrl = 'https://lobsterai-server.inner.youdao.com';

describe('activityDevelopmentConfig', () => {
  test('uses a loopback activity server in an unpackaged development build', () => {
    expect(resolveActivityServerBaseUrl({
      defaultBaseUrl,
      developmentOverride: ' http://127.0.0.1:18878/ ',
      isDev: true,
      isPackaged: false,
    })).toBe('http://127.0.0.1:18878');

    expect(resolveActivityServerBaseUrl({
      defaultBaseUrl,
      developmentOverride: 'https://[::1]:18878',
      isDev: true,
      isPackaged: false,
    })).toBe('https://[::1]:18878');
  });

  test('keeps the default server outside an unpackaged development build', () => {
    expect(resolveActivityServerBaseUrl({
      defaultBaseUrl,
      developmentOverride: 'http://localhost:18878',
      isDev: false,
      isPackaged: false,
    })).toBe(defaultBaseUrl);

    expect(resolveActivityServerBaseUrl({
      defaultBaseUrl,
      developmentOverride: 'http://localhost:18878',
      isDev: true,
      isPackaged: true,
    })).toBe(defaultBaseUrl);
  });

  test('rejects non-loopback and non-HTTP development servers', () => {
    expect(() => resolveActivityServerBaseUrl({
      defaultBaseUrl,
      developmentOverride: 'https://activity.example.com',
      isDev: true,
      isPackaged: false,
    })).toThrow('loopback HTTP(S)');

    expect(() => resolveActivityServerBaseUrl({
      defaultBaseUrl,
      developmentOverride: 'file:///tmp/activity',
      isDev: true,
      isPackaged: false,
    })).toThrow('loopback HTTP(S)');
  });

  test('rejects credentials, paths, queries and fragments', () => {
    for (const developmentOverride of [
      'http://user:secret@localhost:18878',
      'http://localhost:18878/prefix',
      'http://localhost:18878?mode=test',
      'http://localhost:18878#test',
    ]) {
      expect(() => resolveActivityServerBaseUrl({
        defaultBaseUrl,
        developmentOverride,
        isDev: true,
        isPackaged: false,
      })).toThrow('credential-free origin URL');
    }
  });
});
