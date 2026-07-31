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

const DAILY_CHECK_IN_UPDATED_EVENT = 'lobster:daily-check-in-updated';

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

class DailyCheckInRequestError extends Error {
  readonly code?: number;

  constructor(result: Extract<ActivityResult<never>, { success: false }>) {
    super(result.error);
    this.name = 'DailyCheckInRequestError';
    this.code = result.code;
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
      ?? null,
  );
  const [snapshot, setSnapshot] = useState<DailyCheckInSnapshot | null>(null);
  const [loading, setLoading] = useState(enabled);
  const [claiming, setClaiming] = useState(false);
  const loadRequestIdRef = useRef(0);
  const claimingRef = useRef(false);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      loadRequestIdRef.current += 1;
    };
  }, []);

  const load = useCallback(async (retryRevision = true): Promise<void> => {
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
    if (isCurrentRequest()) setLoading(true);
    try {
      const slot = await window.electron.activity.getSlot({
        placement: ActivityPlacement.DesktopSidebar,
      });
      if (!isCurrentRequest()) return;
      if (!slot.success
          || !slot.data
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
          await load(false);
          return;
        }
        setSnapshot(null);
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
        setSnapshot(null);
      }
    } finally {
      if (isCurrentRequest()) setLoading(false);
    }
  }, [enabled]);

  useEffect(() => {
    void load();
  }, [authIdentity, load]);

  useEffect(() => {
    if (!enabled) return undefined;
    const refresh = () => void load();
    window.addEventListener(DAILY_CHECK_IN_UPDATED_EVENT, refresh);
    return () => window.removeEventListener(DAILY_CHECK_IN_UPDATED_EVENT, refresh);
  }, [enabled, load]);

  const claim = useCallback(async (): Promise<DailyCheckInActionResponse> => {
    if (!snapshot) {
      throw new Error(i18nService.t('dailyCheckInClaimFailed'));
    }
    if (!canClaimDailyCheckIn(snapshot.context)) {
      throw new Error(i18nService.t('dailyCheckInClaimFailed'));
    }
    if (claimingRef.current) {
      throw new Error(i18nService.t('dailyCheckInClaimFailed'));
    }
    claimingRef.current = true;
    if (mountedRef.current) setClaiming(true);
    try {
      const result = await window.electron.activity.executeAction({
        placement: ActivityPlacement.DesktopSidebar,
        activityCode: snapshot.descriptor.activityCode,
        configRevision: snapshot.descriptor.configRevision,
        actionId: DailyCheckInAction.CheckIn,
        idempotencyKey: createIdempotencyKey(),
      });
      if (!result.success) {
        if (result.code === ActivityServerErrorCode.AlreadyClaimed) {
          await load();
        } else if (result.code === ActivityServerErrorCode.RevisionMismatch) {
          await load();
        } else if (result.code === ActivityServerErrorCode.NotActive
            || result.code === ActivityServerErrorCode.NotFound) {
          loadRequestIdRef.current += 1;
          if (mountedRef.current) setSnapshot(null);
        }
        throw new DailyCheckInRequestError(result);
      }
      if (!result.data
          || !isDailyCheckInContext(result.data.context)
          || result.data.context.activityCode !== snapshot.descriptor.activityCode
          || result.data.context.configRevision !== snapshot.descriptor.configRevision
          || !result.data.result
          || result.data.result.activityCode !== snapshot.descriptor.activityCode
          || result.data.result.actionId !== DailyCheckInAction.CheckIn
          || !Number.isFinite(result.data.result.creditsGranted)
          || result.data.result.creditsGranted < 0) {
        await load();
        throw new Error(i18nService.t('dailyCheckInClaimFailed'));
      }
      loadRequestIdRef.current += 1;
      if (mountedRef.current) {
        setSnapshot({
          descriptor: snapshot.descriptor,
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
  }, [load, snapshot]);

  return {
    snapshot,
    loading,
    claiming,
    refresh: load,
    claim,
  };
}
