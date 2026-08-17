import React, { useCallback, useEffect, useRef, useState } from 'react';

import { DshEnginePhase } from '../../shared/dshEngine/constants';
import { i18nService } from '../services/i18n';

interface DshEngineStateView {
  phase: string;
  version: string | null;
  errorCode: string | null;
  sessionStoreShared?: boolean;
}

const PHASE_LABEL_KEY: Record<string, string> = {
  [DshEnginePhase.Ready]: 'dshStatusReady',
  [DshEnginePhase.Starting]: 'dshStatusStarting',
  [DshEnginePhase.Stopped]: 'dshStatusStopped',
  [DshEnginePhase.Failed]: 'dshStatusFailed',
  [DshEnginePhase.NotInstalled]: 'dshStatusNotInstalled',
};

export const DshExperimentalSettings: React.FC = () => {
  const [enabled, setEnabled] = useState(false);
  const [engineState, setEngineState] = useState<DshEngineStateView>({ phase: DshEnginePhase.Stopped, version: null, errorCode: null });
  const [opening, setOpening] = useState(false);
  const [openError, setOpenError] = useState<string | null>(null);
  const mountedRef = useRef(true);

  const refresh = useCallback(async () => {
    try {
      const [config, state] = await Promise.all([window.electron.dsh.getConfig(), window.electron.dsh.getState()]);
      if (!mountedRef.current) return;
      setEnabled(config.enabled);
      setEngineState(state);
    } catch {
      // Bridge unavailable (old main process) — leave defaults.
    }
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    void refresh();
    const timer = window.setInterval(() => void refresh(), 3000);
    return () => {
      mountedRef.current = false;
      window.clearInterval(timer);
    };
  }, [refresh]);

  const handleToggle = useCallback(async () => {
    const next = !enabled;
    setEnabled(next);
    setOpenError(null);
    try {
      await window.electron.dsh.setEnabled(next);
    } finally {
      void refresh();
    }
  }, [enabled, refresh]);

  const handleOpenWorkbench = useCallback(async () => {
    setOpening(true);
    setOpenError(null);
    try {
      await window.electron.dsh.openWorkbench();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setOpenError(i18nService.t('dshOpenFailed').replace('{error}', message));
    } finally {
      if (mountedRef.current) setOpening(false);
      void refresh();
    }
  }, [refresh]);

  const phaseLabel = i18nService.t(PHASE_LABEL_KEY[engineState.phase] ?? 'dshStatusStopped');
  const phaseDotClass =
    engineState.phase === DshEnginePhase.Ready
      ? 'bg-emerald-500'
      : engineState.phase === DshEnginePhase.Starting
        ? 'bg-amber-400'
        : engineState.phase === DshEnginePhase.Failed
          ? 'bg-red-500'
          : 'bg-muted-foreground/40';

  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-border bg-card p-5">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <h4 className="text-sm font-semibold text-foreground">{i18nService.t('dshSettingsTitle')}</h4>
              <span className="rounded-full border border-amber-400/50 bg-amber-400/10 px-2 py-0.5 text-[10px] font-medium text-amber-600 dark:text-amber-400">
                {i18nService.t('dshExperimentalBadge')}
              </span>
            </div>
            <p className="mt-2 text-xs leading-5 text-muted-foreground">{i18nService.t('dshSettingsDesc')}</p>
          </div>
          <button
            type="button"
            role="switch"
            aria-checked={enabled}
            aria-label={i18nService.t('dshEnableLabel')}
            onClick={() => void handleToggle()}
            className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors ${
              enabled ? 'bg-primary' : 'bg-muted'
            }`}
          >
            <span
              className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform ${
                enabled ? 'translate-x-6' : 'translate-x-1'
              }`}
            />
          </button>
        </div>

        {enabled && (
          <p className="mt-4 border-t border-border pt-4 text-[11px] leading-4 text-muted-foreground">
            {i18nService.t('dshSharedDataNote')}
          </p>
        )}

        {enabled && engineState.sessionStoreShared === false && (
          <p className="mt-2 rounded-lg border border-amber-400/40 bg-amber-400/10 px-3 py-2 text-[11px] leading-4 text-amber-700 dark:text-amber-400">
            {i18nService.t('dshSessionStoreIsolatedNote')}
          </p>
        )}

        {enabled && (
          <div className="mt-4 flex items-center justify-between gap-4 border-t border-border pt-4">
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <span className={`h-2 w-2 rounded-full ${phaseDotClass}`} />
              <span>{phaseLabel}</span>
              {engineState.version && <span className="text-muted-foreground/60">dsh {engineState.version}</span>}
            </div>
            <button
              type="button"
              onClick={() => void handleOpenWorkbench()}
              disabled={opening}
              className="rounded-lg bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-50"
            >
              {opening ? i18nService.t('dshOpening') : i18nService.t('dshOpenWorkbench')}
            </button>
          </div>
        )}

        {openError && <p className="mt-3 text-xs text-red-500">{openError}</p>}
      </div>
    </div>
  );
};

export default DshExperimentalSettings;
