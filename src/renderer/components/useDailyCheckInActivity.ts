import {
  ActivityPlacement,
  type ActivityResult,
  ActivityServerErrorCode,
  ActivitySlotState,
  DailyCheckInAction,
  type DailyCheckInActionResponse,
  type DailyCheckInContextResponse,
  type DailyCheckInDescriptor,
} from '@shared/activity/constants';
import {
  useCallback,
  useEffect,
  useRef,
  useState,
} from 'react';
import { useSelector } from 'react-redux';

import { authService } from '../services/auth';
import { i18nService } from '../services/i18n';
import type { RootState } from '../store';
import {
  canClaimDailyCheckIn,
  isActiveDailyCheckInContext,
  isDailyCheckInContext,
  isDailyCheckInDescriptor,
} from './dailyCheckInActivityState';
import {
  getDailyCheckInDayBoundaryDelay,
  startDailyCheckInAutoRefresh,
} from './dailyCheckInAutoRefresh';

const DAILY_CHECK_IN_UPDATED_EVENT = 'lobster:daily-check-in-updated';

interface DailyCheckInLoadOptions {
  retryRevision?: boolean;
  silent?: boolean;
}

export interface DailyCheckInSnapshot {
  descriptor: DailyCheckInDescriptor;
  context: DailyCheckInContextResponse;
}

export interface UseDailyCheckInActivityResult {
  snapshot: DailyCheckInSnapshot | null;
  loading: boolean;
  claiming: boolean;
  refresh: () => Promise<void>;
  claim: () => Promise<DailyCheckInActionResponse>;
}

export class DailyCheckInRequestError extends Error {
  readonly code?: number;

  constructor(result: Extract<ActivityResult<never>, { success: false }>) {
    super(result.error);
    this.name = 'DailyCheckInRequestError';
    this.code = result.code;
  }
}

export class DailyCheckInStaleRequestError extends Error {
  constructor() {
    super('Daily check-in request no longer belongs to the active account');
    this.name = 'DailyCheckInStaleRequestError';
  }
}

function createIdempotencyKey(): string {
  const suffix = globalThis.crypto?.randomUUID?.()
    ?? `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  return `daily-check-in-${suffix}`.slice(0, 64);
}

export function useDailyCheckInActivity(
  enabled = true,
): UseDailyCheckInActivityResult {
  const authIdentity = useSelector(
    (state: RootState) => state.auth.user?.yid
      ?? state.auth.user?.userId
      ?? state.auth.user?.id
      ?? null,
  );
  const [snapshot, setSnapshot] = useState<DailyCheckInSnapshot | null>(null);
  const [loading, setLoading] = useState(enabled);
  const [claiming, setClaiming] = useState(false);
  const loadRequestIdRef = useRef(0);
  const claimingRef = useRef(false);
  const mountedRef = useRef(true);
  const authIdentityRef = useRef(authIdentity);
  authIdentityRef.current = authIdentity;

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      loadRequestIdRef.current += 1;
    };
  }, []);

  const load = useCallback(async ({
    retryRevision = true,
    silent = false,
  }: DailyCheckInLoadOptions = {}): Promise<void> => {
    const requestId = ++loadRequestIdRef.current;
    const isCurrentRequest = () => (
      mountedRef.current && loadRequestIdRef.current === requestId
    );
    if (!enabled) {
      if (isCurrentRequest()) {
        setSnapshot(null);
        setLoading(false);
      }
      return;
    }
    if (isCurrentRequest() && !silent) setLoading(true);
    try {
      const slot = await window.electron.activity.getSlot({
        placement: ActivityPlacement.DesktopSidebar,
      });
      if (!isCurrentRequest()) return;
      if (!slot.success) {
        if (!silent) setSnapshot(null);
        return;
      }
      if (!slot.data
          || slot.data.slotState !== ActivitySlotState.Available
          || !isDailyCheckInDescriptor(slot.data.activity)) {
        setSnapshot(null);
        return;
      }

      const descriptor = slot.data.activity;
      const context = await window.electron.activity.getContext({
        placement: ActivityPlacement.DesktopSidebar,
        activityCode: descriptor.activityCode,
        configRevision: descriptor.configRevision,
      });
      if (!isCurrentRequest()) return;
      if (!context.success) {
        if (retryRevision
            && context.code === ActivityServerErrorCode.RevisionMismatch) {
          await load({ retryRevision: false, silent });
          return;
        }
        if (!silent
            || context.code === ActivityServerErrorCode.NotActive
            || context.code === ActivityServerErrorCode.NotFound) {
          setSnapshot(null);
        }
        return;
      }
      if (!isActiveDailyCheckInContext(context.data)
          || context.data.activityCode !== descriptor.activityCode
          || context.data.configRevision !== descriptor.configRevision) {
        setSnapshot(null);
        return;
      }
      setSnapshot({ descriptor, context: context.data });
    } catch (error) {
      if (isCurrentRequest()) {
        console.warn('[DailyCheckIn] failed to load activity:', error);
        if (!silent) setSnapshot(null);
      }
    } finally {
      if (isCurrentRequest()) setLoading(false);
    }
  }, [enabled]);

  const refresh = useCallback(
    () => load({ silent: true }),
    [load],
  );

  useEffect(() => {
    loadRequestIdRef.current += 1;
    setSnapshot(null);
    void load();
  }, [authIdentity, load]);

  useEffect(() => {
    if (!enabled) return undefined;
    const handleActivityUpdate = () => void refresh();
    window.addEventListener(
      DAILY_CHECK_IN_UPDATED_EVENT,
      handleActivityUpdate,
    );
    return () => window.removeEventListener(
      DAILY_CHECK_IN_UPDATED_EVENT,
      handleActivityUpdate,
    );
  }, [enabled, refresh]);

  useEffect(() => {
    if (!enabled) return undefined;
    return startDailyCheckInAutoRefresh(refresh);
  }, [enabled, refresh]);

  useEffect(() => {
    if (!enabled || !snapshot) return undefined;
    const delay = getDailyCheckInDayBoundaryDelay(
      snapshot.context.serverTime,
      snapshot.context.state.timezone,
    );
    if (delay === null) return undefined;
    const timer = setTimeout(() => void refresh(), delay);
    return () => clearTimeout(timer);
  }, [enabled, refresh, snapshot]);

  const claim = useCallback(async (): Promise<DailyCheckInActionResponse> => {
    const target = snapshot;
    if (!target || !canClaimDailyCheckIn(target.context)) {
      throw new Error(i18nService.t('dailyCheckInClaimFailed'));
    }
    if (claimingRef.current) {
      throw new Error(i18nService.t('dailyCheckInClaimFailed'));
    }
    const ownerIdentity = authIdentityRef.current;
    claimingRef.current = true;
    if (mountedRef.current) setClaiming(true);
    try {
      const result = await window.electron.activity.executeAction({
        placement: ActivityPlacement.DesktopSidebar,
        activityCode: target.descriptor.activityCode,
        configRevision: target.descriptor.configRevision,
        actionId: DailyCheckInAction.CheckIn,
        idempotencyKey: createIdempotencyKey(),
      });
      if (authIdentityRef.current !== ownerIdentity) {
        throw new DailyCheckInStaleRequestError();
      }
      if (!result.success) {
        if (result.code === ActivityServerErrorCode.AlreadyClaimed
            || result.code === ActivityServerErrorCode.RevisionMismatch
            || result.code === ActivityServerErrorCode.LoginRequired) {
          await refresh();
        } else if (result.code === ActivityServerErrorCode.NotActive
            || result.code === ActivityServerErrorCode.NotFound) {
          loadRequestIdRef.current += 1;
          if (mountedRef.current) setSnapshot(null);
        }
        throw new DailyCheckInRequestError(result);
      }
      if (!result.data
          || !isDailyCheckInContext(result.data.context)
          || result.data.context.activityCode !== target.descriptor.activityCode
          || result.data.context.configRevision !== target.descriptor.configRevision
          || !result.data.result
          || result.data.result.activityCode !== target.descriptor.activityCode
          || result.data.result.actionId !== DailyCheckInAction.CheckIn
          || !Number.isFinite(result.data.result.creditsGranted)
          || result.data.result.creditsGranted <= 0) {
        await refresh();
        throw new Error(i18nService.t('dailyCheckInClaimFailed'));
      }
      loadRequestIdRef.current += 1;
      if (mountedRef.current) {
        setSnapshot({
          descriptor: target.descriptor,
          context: result.data.context,
        });
      }
      window.dispatchEvent(new Event(DAILY_CHECK_IN_UPDATED_EVENT));
      void authService.fetchProfileSummary();
      return result.data as DailyCheckInActionResponse;
    } finally {
      claimingRef.current = false;
      if (mountedRef.current) setClaiming(false);
    }
  }, [refresh, snapshot]);

  return {
    snapshot,
    loading,
    claiming,
    refresh,
    claim,
  };
}
