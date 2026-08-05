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
  getDailyCheckInAuthScopeKey,
  isActiveDailyCheckInContext,
  isDailyCheckInContext,
  isDailyCheckInDescriptor,
} from './dailyCheckInActivityState';
import { startDailyCheckInAutoRefresh } from './dailyCheckInAutoRefresh';
import { logSidebarExperienceDiagnostic } from './sidebarExperienceDiagnostics';

const DAILY_CHECK_IN_UPDATED_EVENT = 'lobster:daily-check-in-updated';

interface DailyCheckInLoadOptions {
  retryRevision?: boolean;
  silent?: boolean;
}

export interface DailyCheckInSnapshot {
  descriptor: DailyCheckInDescriptor;
  context: DailyCheckInContextResponse;
}

interface ScopedDailyCheckInSnapshot {
  accountScope: string;
  snapshot: DailyCheckInSnapshot;
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
  {
    enabled = true,
    autoRefresh = false,
  }: UseDailyCheckInActivityOptions = {},
): UseDailyCheckInActivityResult {
  const authAccountScope = useSelector(
    (state: RootState) => getDailyCheckInAuthScopeKey(
      state.auth.ownerAccountKey,
      state.auth.accountGeneration,
    ),
  );
  const [scopedSnapshot, setScopedSnapshot] = useState<ScopedDailyCheckInSnapshot | null>(null);
  const snapshot = scopedSnapshot?.accountScope === authAccountScope
    ? scopedSnapshot.snapshot
    : null;
  const [loading, setLoading] = useState(enabled);
  const [claiming, setClaiming] = useState(false);
  const loadRequestIdRef = useRef(0);
  const claimingRef = useRef(false);
  const mountedRef = useRef(true);
  const authAccountScopeRef = useRef(authAccountScope);
  authAccountScopeRef.current = authAccountScope;

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
    const requestAccountScope = authAccountScope;
    const requestId = ++loadRequestIdRef.current;
    const isCurrentRequest = () => (
      mountedRef.current && loadRequestIdRef.current === requestId
      && authAccountScopeRef.current === requestAccountScope
    );
    if (!enabled) {
      if (isCurrentRequest()) {
        setScopedSnapshot(null);
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
      if (!slot.success
          || !slot.data
          || slot.data.slotState !== ActivitySlotState.Available
          || !isDailyCheckInDescriptor(slot.data.activity)) {
        setScopedSnapshot(null);
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
        setScopedSnapshot(null);
        return;
      }
      if (!isActiveDailyCheckInContext(context.data)
          || context.data.activityCode !== descriptor.activityCode
          || context.data.configRevision !== descriptor.configRevision) {
        setScopedSnapshot(null);
        return;
      }
      setScopedSnapshot({
        accountScope: requestAccountScope,
        snapshot: { descriptor, context: context.data },
      });
    } catch (error) {
      if (isCurrentRequest()) {
        logSidebarExperienceDiagnostic('warn', 'failed to load daily check-in activity', error);
        setScopedSnapshot(null);
      }
    } finally {
      if (isCurrentRequest()) setLoading(false);
    }
  }, [authAccountScope, enabled]);

  const refresh = useCallback(
    () => load({ silent: true }),
    [load],
  );

  useEffect(() => {
    void load();
  }, [authAccountScope, load]);

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
    const requestAccountScope = authAccountScope;
    if (mountedRef.current) setClaiming(true);
    try {
      const result = await window.electron.activity.executeAction({
        placement: ActivityPlacement.DesktopSidebar,
        activityCode: snapshot.descriptor.activityCode,
        configRevision: snapshot.descriptor.configRevision,
        actionId: DailyCheckInAction.CheckIn,
        idempotencyKey: createIdempotencyKey(),
      });
      if (!mountedRef.current || authAccountScopeRef.current !== requestAccountScope) {
        throw new Error(i18nService.t('dailyCheckInClaimFailed'));
      }
      if (!result.success) {
        if (result.code === ActivityServerErrorCode.AlreadyClaimed) {
          await load();
        } else if (result.code === ActivityServerErrorCode.RevisionMismatch) {
          await load();
        } else if (result.code === ActivityServerErrorCode.NotActive
            || result.code === ActivityServerErrorCode.NotFound) {
          loadRequestIdRef.current += 1;
          if (mountedRef.current) setScopedSnapshot(null);
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
        setScopedSnapshot({
          accountScope: requestAccountScope,
          snapshot: {
            descriptor: snapshot.descriptor,
            context: result.data.context,
          },
        });
      }
      window.dispatchEvent(new Event(DAILY_CHECK_IN_UPDATED_EVENT));
      void authService.fetchProfileSummary();
      return result.data as DailyCheckInActionResponse;
    } finally {
      claimingRef.current = false;
      if (mountedRef.current) setClaiming(false);
    }
  }, [authAccountScope, load, snapshot]);

  return {
    snapshot,
    loading,
    claiming,
    refresh,
    claim,
  };
}
