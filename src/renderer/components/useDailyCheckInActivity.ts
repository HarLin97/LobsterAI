import {
  type ActivityActionResponse,
  type ActivityContextResponse,
  type ActivityDescriptor,
  type ActivityResult,
  ActivityServerErrorCode,
  ActivitySlotState,
  DailyCheckInAction,
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
import { startDailyCheckInAutoRefresh } from './dailyCheckInAutoRefresh';

const DAILY_CHECK_IN_UPDATED_EVENT = 'lobster:daily-check-in-updated';

interface DailyCheckInLoadOptions {
  retryRevision?: boolean;
  silent?: boolean;
}

export interface DailyCheckInSnapshot {
  descriptor: ActivityDescriptor;
  context: ActivityContextResponse;
}

export interface UseDailyCheckInActivityOptions {
  enabled?: boolean;
  autoRefresh?: boolean;
}

export interface UseDailyCheckInActivityResult {
  snapshot: DailyCheckInSnapshot | null;
  loading: boolean;
  claiming: boolean;
  refresh: () => Promise<void>;
  claim: () => Promise<ActivityActionResponse>;
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
  {
    enabled = true,
    autoRefresh = false,
  }: UseDailyCheckInActivityOptions = {},
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
      const slot = await window.electron.activity.getSlot();
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

  const refresh = useCallback(
    () => load({ silent: true }),
    [load],
  );

  useEffect(() => {
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
    if (!enabled || !autoRefresh) return undefined;
    return startDailyCheckInAutoRefresh(refresh);
  }, [autoRefresh, enabled, refresh]);

  const claim = useCallback(async (): Promise<ActivityActionResponse> => {
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
        activityCode: snapshot.descriptor.activityCode,
        configRevision: snapshot.descriptor.configRevision,
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
      return result.data;
    } finally {
      claimingRef.current = false;
      if (mountedRef.current) setClaiming(false);
    }
  }, [load, snapshot]);

  return {
    snapshot,
    loading,
    claiming,
    refresh,
    claim,
  };
}
