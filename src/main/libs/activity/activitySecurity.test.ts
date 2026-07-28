import { describe, expect, test } from 'vitest';

import { ActivityWebAppKey } from '../../../shared/activity/constants';
import {
  isAllowedActivityNavigation,
  isAllowedActivityResource,
  resolveActivityWebAppLocation,
  validateActivityBounds,
} from './activitySecurity';

describe('activitySecurity', () => {
  test('uses provider-neutral remote H5 URLs delivered by the activity revision', () => {
    const location = resolveActivityWebAppLocation({
      webAppKey: ActivityWebAppKey.RemoteH5V1,
      webAppUrl: 'https://login-points.campaign.example.com/v1/index.html',
      resourceBaseUrls: ['https://cdn.example.net/login-points/v1/'],
      activityCode: 'login-seven-days',
      configRevision: 3,
      locale: 'zh-CN',
      isPackaged: true,
      isTestMode: false,
    });

    expect(location.navigationBaseUrl).toBe(
      'https://login-points.campaign.example.com/v1/',
    );
    expect(location.resourceBaseUrls).toEqual([
      'https://login-points.campaign.example.com/v1/',
      'https://cdn.example.net/login-points/v1/',
    ]);
    expect(location.url).toContain('activityCode=login-seven-days');
    expect(location.url).toContain('configRevision=3');
  });

  test('keeps the phase-one generic key compatible', () => {
    const location = resolveActivityWebAppLocation({
      webAppKey: ActivityWebAppKey.GenericV1,
      activityCode: 'login-seven-days',
      configRevision: 3,
      locale: 'zh-CN',
      isPackaged: true,
      isTestMode: false,
    });

    expect(location.navigationBaseUrl).toBe(
      'https://lobsterai.youdao.com/activities/generic-v1/',
    );
  });

  test('permits a loopback override only in an unpackaged build', () => {
    expect(resolveActivityWebAppLocation({
      webAppKey: ActivityWebAppKey.RemoteH5V1,
      webAppUrl: 'https://activity.example.com/',
      activityCode: 'activity',
      configRevision: 1,
      locale: 'en',
      isPackaged: false,
      isTestMode: true,
      developmentOverride: 'http://127.0.0.1:4178/',
    }).navigationBaseUrl).toBe('http://127.0.0.1:4178/');

    expect(() => resolveActivityWebAppLocation({
      webAppKey: ActivityWebAppKey.RemoteH5V1,
      webAppUrl: 'https://activity.example.com/',
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
      webAppKey: ActivityWebAppKey.RemoteH5V1,
      webAppUrl: 'https://activity.example.com/releases/v1/',
      activityCode: 'activity',
      configRevision: 1,
      locale: 'en',
      isPackaged: true,
      isTestMode: true,
      developmentOverride: 'http://127.0.0.1:4178/',
    });

    expect(location.navigationBaseUrl).toBe(
      'https://activity.example.com/releases/v1/',
    );
  });

  test('rejects local, IP, credential and non-HTTPS remote URLs', () => {
    const baseInput = {
      webAppKey: ActivityWebAppKey.RemoteH5V1,
      activityCode: 'activity',
      configRevision: 1,
      locale: 'en',
      isPackaged: true,
      isTestMode: true,
    };
    expect(() => resolveActivityWebAppLocation({
      ...baseInput,
      webAppUrl: 'http://activity.example.com/',
    })).toThrow('public HTTPS');
    expect(() => resolveActivityWebAppLocation({
      ...baseInput,
      webAppUrl: 'https://user:secret@activity.example.com/',
    })).toThrow('public HTTPS');
    expect(() => resolveActivityWebAppLocation({
      ...baseInput,
      webAppUrl: 'https://127.0.0.1/',
    })).toThrow('public DNS');
    expect(() => resolveActivityWebAppLocation({
      ...baseInput,
      webAppUrl: 'https://localhost/',
    })).toThrow('public DNS');
  });

  test('allows navigation only inside the declared prefix and resources inside their prefixes', () => {
    const navigationBase = 'https://activity.example.com/releases/v1/';
    const resources = [
      navigationBase,
      'https://cdn.example.net/login-points/v1/',
    ];
    expect(isAllowedActivityNavigation(
      'https://activity.example.com/releases/v1/detail?day=1',
      navigationBase,
    )).toBe(true);
    expect(isAllowedActivityNavigation(
      'https://activity.example.com/releases/v1-evil/',
      navigationBase,
    )).toBe(false);
    expect(isAllowedActivityResource(
      'https://cdn.example.net/login-points/v1/theme.css',
      resources,
    )).toBe(true);
    expect(isAllowedActivityResource(
      'https://attacker.example/tracker.gif',
      resources,
    )).toBe(false);
    expect(isAllowedActivityResource(
      'blob:https://activity.example.com/generated',
      resources,
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
