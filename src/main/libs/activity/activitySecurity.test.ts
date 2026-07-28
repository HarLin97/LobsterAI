import { describe, expect, test } from 'vitest';

import { ActivityWebAppKey } from '../../../shared/activity/constants';
import {
  isAllowedActivityNavigation,
  isAllowedActivityResource,
  resolveActivityWebAppLocation,
  validateActivityBounds,
} from './activitySecurity';

describe('activitySecurity', () => {
  test('maps a server webAppKey to the environment-owned H5 URL', () => {
    const location = resolveActivityWebAppLocation({
      webAppKey: ActivityWebAppKey.GenericV1,
      activityCode: 'login-seven-days',
      configRevision: 3,
      locale: 'zh-CN',
      isPackaged: true,
      isTestMode: false,
    });

    expect(location.allowedBaseUrl).toBe(
      'https://lobsterai.youdao.com/activities/generic-v1/',
    );
    expect(location.url).toContain('activityCode=login-seven-days');
    expect(location.url).toContain('configRevision=3');
  });

  test('permits a loopback override only in an unpackaged build', () => {
    expect(resolveActivityWebAppLocation({
      webAppKey: ActivityWebAppKey.GenericV1,
      activityCode: 'activity',
      configRevision: 1,
      locale: 'en',
      isPackaged: false,
      isTestMode: true,
      developmentOverride: 'http://127.0.0.1:4178/',
    }).allowedBaseUrl).toBe('http://127.0.0.1:4178/');

    expect(() => resolveActivityWebAppLocation({
      webAppKey: ActivityWebAppKey.GenericV1,
      activityCode: 'activity',
      configRevision: 1,
      locale: 'en',
      isPackaged: false,
      isTestMode: true,
      developmentOverride: 'https://attacker.example/activity/',
    })).toThrow('loopback');
  });

  test('ignores development overrides in packaged builds', () => {
    const location = resolveActivityWebAppLocation({
      webAppKey: ActivityWebAppKey.GenericV1,
      activityCode: 'activity',
      configRevision: 1,
      locale: 'en',
      isPackaged: true,
      isTestMode: true,
      developmentOverride: 'http://127.0.0.1:4178/',
    });

    expect(location.allowedBaseUrl).toBe(
      'https://lobsterai.inner.youdao.com/activities/generic-v1/',
    );
  });

  test('allows navigation only inside the selected app origin and path prefix', () => {
    const base = 'https://lobsterai.youdao.com/activities/generic-v1/';
    expect(isAllowedActivityNavigation(
      'https://lobsterai.youdao.com/activities/generic-v1/detail?day=1',
      base,
    )).toBe(true);
    expect(isAllowedActivityNavigation(
      'https://lobsterai.youdao.com/activities/generic-v1-evil/',
      base,
    )).toBe(false);
    expect(isAllowedActivityNavigation(
      'https://attacker.example/activities/generic-v1/',
      base,
    )).toBe(false);
    expect(isAllowedActivityResource(
      'https://attacker.example/tracker.gif',
      base,
    )).toBe(false);
    expect(isAllowedActivityResource(
      'blob:https://lobsterai.youdao.com/activities/generic-v1/generated',
      base,
    )).toBe(true);
  });

  test('keeps the native view inside the main content bounds', () => {
    expect(validateActivityBounds(
      { x: 100, y: 50, width: 480, height: 560 },
      { x: 0, y: 0, width: 1200, height: 800 },
    )).toEqual({ x: 100, y: 50, width: 480, height: 560 });

    expect(() => validateActivityBounds(
      { x: 900, y: 50, width: 480, height: 560 },
      { x: 0, y: 0, width: 1200, height: 800 },
    )).toThrow('inside the main window');
  });
});
