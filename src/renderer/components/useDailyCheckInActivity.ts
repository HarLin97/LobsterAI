import {
  type ActivityActionResponse,
  type ActivityContextResponse,
  type ActivityDescriptor,
  ActivityLifecycleState,
  ActivityPlacement,
  type ActivityResult,
  ActivityServerErrorCode,
  ActivitySlotState,
} from '@shared/activity/constants';
import { useCallback, useEffect, useState } from 'react';
import { useSelector } from 'react-redux';

import { authService } from '../services/auth';
import type { RootState } from '../store';
import { isActiveDailyCheckInContext } from './dailyCheckInActivityState';

const DAILY_CHECK_IN_UPDATED_EVENT = 'lobster:daily-check-in-updated';

export interface DailyCheckInSnapshot {
  descriptor: ActivityDescriptor;
  context: ActivityContextResponse;
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

  const load = useCallback(async (retryRevision = true): Promise<void> => {
    if (!enabled) {
      setSnapshot(null);
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const slot = await window.electron.activity.getSlot({
        placement: ActivityPlacement.DesktopSidebar,
      });
      if (!slot.success
          || slot.data.slotState !== ActivitySlotState.Available
          || !slot.data.activity) {
        setSnapshot(null);
        return;
      }

      const descriptor = slot.data.activity;
      const context = await window.electron.activity.getContext({
        activityCode: descriptor.activityCode,
        configRevision: descriptor.configRevision,
      });
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
          || context.data.lifecycleState !== ActivityLifecycleState.Active) {
        setSnapshot(null);
        return;
      }
      setSnapshot({ descriptor, context: context.data });
    } catch (error) {
      console.warn('[DailyCheckIn] failed to load activity:', error);
      setSnapshot(null);
    } finally {
      setLoading(false);
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

  const claim = useCallback(async (): Promise<ActivityActionResponse> => {
    if (!snapshot) {
      throw new Error('Daily check-in activity is unavailable');
    }
    if (claiming) {
      throw new Error('Daily check-in is already in progress');
    }
    setClaiming(true);
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
          setSnapshot(null);
        }
        throw new DailyCheckInRequestError(result);
      }
      setSnapshot({
        descriptor: snapshot.descriptor,
        context: result.data.context,
      });
      window.dispatchEvent(new Event(DAILY_CHECK_IN_UPDATED_EVENT));
      void authService.fetchProfileSummary();
      return result.data;
    } finally {
      setClaiming(false);
    }
  }, [claiming, load, snapshot]);

  return {
    snapshot,
    loading,
    claiming,
    refresh: load,
    claim,
  };
}
