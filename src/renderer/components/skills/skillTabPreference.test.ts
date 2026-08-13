import { beforeEach, describe, expect, test } from 'vitest';

import { readInitialSkillTab, SKILL_ACTIVE_TAB_STORAGE_KEY, SkillTab } from './skillTabPreference';

const store = new Map<string, string>();

beforeEach(() => {
  store.clear();
  (globalThis as { window?: unknown }).window = {
    localStorage: {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => { store.set(key, value); },
    },
  };
});

describe('readInitialSkillTab', () => {
  test('lands on the marketplace when nothing was stored', () => {
    expect(readInitialSkillTab()).toBe(SkillTab.Marketplace);
  });

  test('restores whichever tab was last used', () => {
    store.set(SKILL_ACTIVE_TAB_STORAGE_KEY, SkillTab.Mine);
    expect(readInitialSkillTab()).toBe(SkillTab.Mine);
    store.set(SKILL_ACTIVE_TAB_STORAGE_KEY, SkillTab.BuiltIn);
    expect(readInitialSkillTab()).toBe(SkillTab.BuiltIn);
  });

  test('ignores values left behind by an older build', () => {
    // "installed" was the tab id before the three-tab split.
    store.set(SKILL_ACTIVE_TAB_STORAGE_KEY, 'installed');
    expect(readInitialSkillTab()).toBe(SkillTab.Marketplace);
  });

  test('ignores an empty stored value', () => {
    store.set(SKILL_ACTIVE_TAB_STORAGE_KEY, '');
    expect(readInitialSkillTab()).toBe(SkillTab.Marketplace);
  });

  test('falls back when localStorage throws', () => {
    (globalThis as { window?: unknown }).window = {
      localStorage: {
        getItem: () => { throw new Error('denied'); },
        setItem: () => { throw new Error('denied'); },
      },
    };
    expect(readInitialSkillTab()).toBe(SkillTab.Marketplace);
  });
});
