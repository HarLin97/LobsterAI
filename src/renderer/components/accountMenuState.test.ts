import { describe, expect, test } from 'vitest';

import type {
  CreditItem,
  CreditsResetCampaignStatus,
  FreeCreditsReward,
} from '../store/slices/authSlice';
import {
  getAccountPlanPresentation,
  getFinalRewards,
} from './accountMenuState';

const creditItem = (
  overrides: Partial<CreditItem> = {},
): CreditItem => ({
  type: 'free',
  label: '每周免费积分',
  labelEn: 'Weekly free credits',
  creditsRemaining: 100,
  expiresAt: null,
  ...overrides,
});

const reward = (
  campaignCode: string,
  claimDeadline: string,
): FreeCreditsReward => ({
  campaignCode,
  credits: 500,
  claimDeadline,
  validityDays: 30,
});

describe('accountMenuState', () => {
  test('uses the subscription item for the account plan even when its credits are exhausted', () => {
    const plan = getAccountPlanPresentation([
      creditItem(),
      creditItem({
        type: 'subscription',
        label: '标准',
        labelEn: 'Standard',
        creditsRemaining: 0,
        expiresAt: '2026-08-06',
      }),
    ], false);

    expect(plan).toEqual({
      label: '标准',
      expiresAt: '2026-08-06',
    });
  });

  test('uses the English plan label and hides the plan row for users without a subscription', () => {
    expect(getAccountPlanPresentation([
      creditItem({
        type: 'subscription',
        label: '标准',
        labelEn: 'Standard',
      }),
    ], true)?.label).toBe('Standard');
    expect(getAccountPlanPresentation([creditItem()], false)).toBeNull();
  });

  test('returns every available final reward ordered by claim deadline', () => {
    const status = {
      freeCreditsRewards: [
        reward('reward-later', '2026-08-31T16:00:00Z'),
        reward('reward-sooner', '2026-08-20T16:00:00Z'),
      ],
    } as CreditsResetCampaignStatus;

    expect(getFinalRewards(status).map(item => item.campaignCode)).toEqual([
      'reward-sooner',
      'reward-later',
    ]);
  });

  test('keeps compatibility with the legacy single final reward field', () => {
    const legacyReward = reward('legacy-reward', '2026-08-20T16:00:00Z');
    const status = {
      freeCreditsReward: legacyReward,
    } as CreditsResetCampaignStatus;

    expect(getFinalRewards(status)).toEqual([legacyReward]);
  });
});
