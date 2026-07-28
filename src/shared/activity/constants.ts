export const ActivityContainerApiVersion = {
  V1: 1,
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

export const ActivityWebAppKey = {
  GenericV1: 'generic_activity_v1',
} as const;

export type ActivityWebAppKey = typeof ActivityWebAppKey[keyof typeof ActivityWebAppKey];

export const ActivityIpc = {
  HostGetSlot: 'activity:host:get-slot',
  HostOpen: 'activity:host:open',
  HostSetBounds: 'activity:host:set-bounds',
  HostClose: 'activity:host:close',
  GuestGetRuntimeContext: 'activity:guest:get-runtime-context',
  GuestGetActivityContext: 'activity:guest:get-activity-context',
  GuestExecuteAction: 'activity:guest:execute-action',
  GuestRequestLogin: 'activity:guest:request-login',
  GuestClose: 'activity:guest:close',
  GuestAuthChanged: 'activity:guest:auth-changed',
} as const;

export type ActivityIpc = typeof ActivityIpc[keyof typeof ActivityIpc];

export interface ActivityBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface ActivityDescriptor {
  activityCode: string;
  configRevision: number;
  activityType: string;
  webAppKey: ActivityWebAppKey;
  templateKey: string;
  sizePreset: string;
  loginRequired: boolean;
  entryConfig: Record<string, unknown>;
  presentationConfig: Record<string, unknown>;
}

export interface ActivitySlotResponse {
  slotState: ActivitySlotState;
  serverTime: string;
  activity?: ActivityDescriptor;
}

export interface ActivityContextResponse {
  activityCode: string;
  configRevision: number;
  lifecycleState: ActivityLifecycleState;
  authenticated: boolean;
  loginRequired: boolean;
  serverTime: string;
  presentationConfig: Record<string, unknown>;
  state: Record<string, unknown>;
  actions: string[];
}

export interface ActivityActionResponse {
  replayed: boolean;
  result: Record<string, unknown>;
  context: ActivityContextResponse;
}

export type ActivityResult<T> =
  | { success: true; data: T }
  | { success: false; error: string; code?: number; httpStatus?: number };

export interface ActivityHostGetSlotInput {
  placement?: ActivityPlacement;
}

export interface ActivityHostOpenInput {
  activityCode: string;
  configRevision: number;
  placement?: ActivityPlacement;
  bounds: ActivityBounds;
}

export interface ActivityGuestActionInput {
  actionId: string;
  idempotencyKey: string;
  payload?: Record<string, unknown>;
}

export interface ActivityRuntimeContext {
  containerApiVersion: ActivityContainerApiVersion;
  activityCode: string;
  configRevision: number;
  clientVersion: string;
  platform: string;
  locale: string;
  authenticated: boolean;
}

export interface ActivityAuthChangedEvent {
  authenticated: boolean;
}
