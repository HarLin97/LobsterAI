import { describe, expect, test } from 'vitest';

import {
  type ActivityDescriptor,
  ActivityEntrySurface,
  ActivityWebAppKey,
} from '../../shared/activity/constants';
import {
  hasActivityEntrySurface,
  resolveActivityEntryModel,
  resolveActivityEntrySurfaces,
  resolveActivityModalDimensions,
  resolveActivityModalTitle,
} from './activityExperienceState';

const descriptor = (overrides: Partial<ActivityDescriptor> = {}): ActivityDescriptor => ({
  activityCode: 'login-seven-days',
  configRevision: 1,
  activityType: 'daily_check_in',
  webAppKey: ActivityWebAppKey.RemoteH5V1,
  webAppUrl: 'https://activity.example.com/',
  templateKey: 'daily_credits_v1',
  sizePreset: 'compact',
  loginRequired: true,
  entryConfig: {
    title: 'Sign in for credits',
    description: 'Seven daily rewards',
    imageUrl: 'https://assets.example.com/card.png',
    accentColor: '#FF7043',
  },
  presentationConfig: { title: 'Seven-day sign-in' },
  ...overrides,
});

describe('activityExperienceState', () => {
  test('creates a native entry model from controlled activity config', () => {
    expect(resolveActivityEntryModel(descriptor())).toEqual({
      title: 'Sign in for credits',
      description: 'Seven daily rewards',
      badgeText: undefined,
      ctaText: undefined,
      imageUrl: 'https://assets.example.com/card.png',
      accentColor: '#FF7043',
    });
  });

  test('drops unsafe image and color values', () => {
    const model = resolveActivityEntryModel(descriptor({
      entryConfig: {
        title: 'Activity',
        imageUrl: 'file:///etc/passwd',
        accentColor: 'url(javascript:alert(1))',
      },
    }));

    expect(model?.imageUrl).toBeUndefined();
    expect(model?.accentColor).toBe('#FF6B35');

    expect(resolveActivityEntryModel(descriptor({
      entryConfig: {
        title: 'Activity',
        imageUrl: 'https://127.0.0.1/private.png',
      },
    }))?.imageUrl).toBeUndefined();

    expect(resolveActivityEntryModel(descriptor({
      entryConfig: {
        title: 'Activity',
        imageUrl: 'https://user:secret@assets.example.com/card.png',
      },
    }))?.imageUrl).toBeUndefined();
  });

  test('uses presentation title as a fallback and maps size presets', () => {
    const value = descriptor({
      entryConfig: {},
      presentationConfig: { title: 'Fallback title' },
      sizePreset: 'medium',
    });

    expect(resolveActivityEntryModel(value)?.title).toBe('Fallback title');
    expect(resolveActivityModalTitle(value)).toBe('Fallback title');
    expect(resolveActivityModalDimensions(value.sizePreset)).toEqual({
      width: 560,
      height: 620,
    });
  });

  test('keeps legacy activities in the sidebar when entry surfaces are absent', () => {
    const value = descriptor();

    expect(resolveActivityEntrySurfaces(value)).toEqual([
      ActivityEntrySurface.DesktopSidebar,
    ]);
    expect(hasActivityEntrySurface(
      value,
      ActivityEntrySurface.ProfileMenu,
    )).toBe(false);
  });

  test('resolves configured entry surfaces and drops unsupported values', () => {
    const value = descriptor({
      entryConfig: {
        title: 'Activity',
        entrySurfaces: [
          ActivityEntrySurface.DesktopSidebar,
          ActivityEntrySurface.ProfileMenu,
          'system_browser',
        ],
      },
    });

    expect(resolveActivityEntrySurfaces(value)).toEqual([
      ActivityEntrySurface.DesktopSidebar,
      ActivityEntrySurface.ProfileMenu,
    ]);
  });
});
