import {
  type ActivityContextResponse,
  ActivityLifecycleState,
  DailyCheckInAction,
  type DailyCheckInState,
} from '../../shared/activity/constants';

const isFiniteNonNegative = (value: unknown): value is number => (
  typeof value === 'number' && Number.isFinite(value) && value >= 0
);

export function isDailyCheckInState(value: unknown): value is DailyCheckInState {
  if (!value || typeof value !== 'object') return false;
  const state = value as Partial<DailyCheckInState>;
  return Number.isInteger(state.totalDays)
    && (state.totalDays ?? 0) > 0
    && Number.isInteger(state.claimedDays)
    && (state.claimedDays ?? -1) >= 0
    && Number.isInteger(state.remainingDays)
    && (state.remainingDays ?? -1) >= 0
    && typeof state.claimedToday === 'boolean'
    && typeof state.completed === 'boolean'
    && isFiniteNonNegative(state.rewardCredits)
    && state.rewardCredits > 0
    && isFiniteNonNegative(state.claimedCredits)
    && typeof state.timezone === 'string'
    && state.timezone.trim().length > 0;
}

export function isActiveDailyCheckInContext(
  context: ActivityContextResponse,
): boolean {
  return context.lifecycleState === ActivityLifecycleState.Active
    && isDailyCheckInState(context.state);
}

export function canClaimDailyCheckIn(context: ActivityContextResponse): boolean {
  return isActiveDailyCheckInContext(context)
    && context.authenticated
    && !context.state.claimedToday
    && !context.state.completed
    && context.actions.includes(DailyCheckInAction.CheckIn);
}

export function shouldShowDailyCheckInSidebar(
  context: ActivityContextResponse,
): boolean {
  return isActiveDailyCheckInContext(context)
    && !context.state.claimedToday
    && !context.state.completed;
}

export function formatDailyCheckInCredits(value: number): string {
  return Number(value).toLocaleString(undefined, {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  });
}
