import { describe, expect, test } from 'vitest';

import {
  type ActivityContextResponse,
  ActivityLifecycleState,
  DailyCheckInAction,
} from '../../shared/activity/constants';
import {
  canClaimDailyCheckIn,
  formatDailyCheckInCredits,
  isDailyCheckInState,
  shouldShowDailyCheckInSidebar,
} from './dailyCheckInActivityState';

const context = (
  overrides: Partial<ActivityContextResponse['state']> = {},
): ActivityContextResponse => ({
  activityCode: 'login-seven-days-native-1',
  configRevision: 1,
  lifecycleState: ActivityLifecycleState.Active,
  authenticated: true,
  loginRequired: true,
  serverTime: '2026-07-28T04:00:00Z',
  state: {
    totalDays: 7,
    claimedDays: 2,
    remainingDays: 5,
    claimedToday: false,
    completed: false,
    rewardCredits: 100,
    claimedCredits: 200,
    timezone: 'Asia/Shanghai',
    ...overrides,
  },
  actions: [DailyCheckInAction.CheckIn],
});

describe('dailyCheckInActivityState', () => {
  test('allows an authenticated active user to claim', () => {
    expect(canClaimDailyCheckIn(context())).toBe(true);
    expect(shouldShowDailyCheckInSidebar(context())).toBe(true);
  });

  test('hides the sidebar after today is claimed but keeps valid profile state', () => {
    const claimed = context({ claimedToday: true });

    expect(canClaimDailyCheckIn(claimed)).toBe(false);
    expect(shouldShowDailyCheckInSidebar(claimed)).toBe(false);
    expect(isDailyCheckInState(claimed.state)).toBe(true);
  });

  test('rejects malformed remote state and formats decimal credits', () => {
    expect(isDailyCheckInState({
      ...context().state,
      claimedDays: -1,
    })).toBe(false);
    expect(formatDailyCheckInCredits(100)).toBe('100');
    expect(formatDailyCheckInCredits(12.5)).toBe('12.5');
  });
});
