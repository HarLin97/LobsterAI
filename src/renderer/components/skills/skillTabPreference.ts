export const SkillTab = {
  Mine: 'mine',
  Marketplace: 'marketplace',
  BuiltIn: 'builtIn',
} as const;
export type SkillTab = typeof SkillTab[keyof typeof SkillTab];

export const SKILL_TAB_ORDER: SkillTab[] = [SkillTab.Marketplace, SkillTab.BuiltIn, SkillTab.Mine];

export const SKILL_TAB_LABEL_KEYS: Record<SkillTab, string> = {
  [SkillTab.Mine]: 'skillGroupMine',
  [SkillTab.Marketplace]: 'skillMarketplace',
  [SkillTab.BuiltIn]: 'skillGroupBuiltIn',
};

export const SKILL_ACTIVE_TAB_STORAGE_KEY = 'skillsManager.activeTab';

/**
 * Reopen on whichever tab was last used; first-time visitors land on the
 * marketplace. Values left by an older build fall back to the default too.
 */
export const readInitialSkillTab = (): SkillTab => {
  try {
    const stored = window.localStorage.getItem(SKILL_ACTIVE_TAB_STORAGE_KEY);
    if (stored && SKILL_TAB_ORDER.includes(stored as SkillTab)) {
      return stored as SkillTab;
    }
  } catch {
    // localStorage unavailable; fall back to the default tab.
  }
  return SkillTab.Marketplace;
};

export const persistSkillTab = (tab: SkillTab): void => {
  try {
    window.localStorage.setItem(SKILL_ACTIVE_TAB_STORAGE_KEY, tab);
  } catch {
    // localStorage unavailable; the tab just won't persist.
  }
};
