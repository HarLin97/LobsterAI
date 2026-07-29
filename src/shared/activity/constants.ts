export const ActivityContainerApiVersion = {
  NativeDailyCheckInV1: 2,
} as const;

export type ActivityContainerApiVersion =
  typeof ActivityContainerApiVersion[keyof typeof ActivityContainerApiVersion];

export const ActivityPlacement = {
  DesktopSidebar: 'desktop_sidebar',
} as const;

export type ActivityPlacement = typeof ActivityPlacement[keyof typeof ActivityPlacement];

export const ActivitySlotState = {
  Empty: 'empty',
  Available: 'available',
} as const;

export type ActivitySlotState = typeof ActivitySlotState[keyof typeof ActivitySlotState];

export const ActivityLifecycleState = {
  Active: 'active',
  NotStarted: 'not_started',
  Ended: 'ended',
  Offline: 'offline',
  Superseded: 'superseded',
} as const;

export type ActivityLifecycleState =
  typeof ActivityLifecycleState[keyof typeof ActivityLifecycleState];

export const DailyCheckInAction = {
  CheckIn: 'check_in',
} as const;

export type DailyCheckInAction =
  typeof DailyCheckInAction[keyof typeof DailyCheckInAction];

export const ActivityServerErrorCode = {
  NotFound: 41700,
  NotActive: 41701,
  LoginRequired: 41702,
  ActionInvalid: 41703,
  AlreadyClaimed: 41704,
  ConfigInvalid: 41705,
  RevisionMismatch: 41706,
} as const;

export type ActivityServerErrorCode =
  typeof ActivityServerErrorCode[keyof typeof ActivityServerErrorCode];

export const ActivityIpc = {
  HostGetSlot: 'activity:host:get-slot',
  HostGetContext: 'activity:host:get-context',
  HostExecuteAction: 'activity:host:execute-action',
} as const;

export type ActivityIpc = typeof ActivityIpc[keyof typeof ActivityIpc];

export interface ActivityDescriptor {
  activityCode: string;
  configRevision: number;
  startAt: string;
  endAt: string;
  timezone: string;
  loginRequired: boolean;
  periodLabel: string;
  cardTitle: string;
  guestModalTitle: string;
  guestModalDescription: string;
  guestModalActionText: string;
}

export interface ActivitySlotResponse {
  slotState: ActivitySlotState;
  serverTime: string;
  activity?: ActivityDescriptor;
}

export interface DailyCheckInState {
  totalDays: number;
  claimedDays: number;
  remainingDays: number;
  claimedToday: boolean;
  completed: boolean;
  rewardCredits: number;
  claimedCredits: number;
  timezone: string;
}

export interface ActivityContextResponse {
  activityCode: string;
  configRevision: number;
  lifecycleState: ActivityLifecycleState;
  authenticated: boolean;
  loginRequired: boolean;
  serverTime: string;
  state: DailyCheckInState;
  actions: DailyCheckInAction[];
}

export interface DailyCheckInActionResult {
  activityCode: string;
  actionId: DailyCheckInAction;
  periodKey: string;
  creditsGranted: number;
  claimedAt: string;
  expiresAt: string;
  claimedDays: number;
  totalDays: number;
}

export interface ActivityActionResponse {
  replayed: boolean;
  result: DailyCheckInActionResult;
  context: ActivityContextResponse;
}

export type ActivityResult<T> =
  | { success: true; data: T }
  | { success: false; error: string; code?: number; httpStatus?: number };

export interface ActivityHostGetSlotInput {
  placement?: ActivityPlacement;
}

export interface ActivityHostGetContextInput {
  activityCode: string;
  configRevision: number;
}

export interface ActivityHostExecuteActionInput extends ActivityHostGetContextInput {
  idempotencyKey: string;
}
