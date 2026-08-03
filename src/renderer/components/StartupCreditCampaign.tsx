import { XMarkIcon } from '@heroicons/react/24/outline';
import {
  ActivityLifecycleState,
  ActivityPlacement,
  ActivityServerErrorCode,
  ActivitySlotState,
  OneTimeCreditAction,
  type StartupCreditActionResponse,
} from '@shared/activity/constants';
import { OpenClawEnginePhase } from '@shared/openclawEngine/constants';
import React, {
  useCallback,
  useEffect,
  useRef,
  useState,
} from 'react';
import { createPortal } from 'react-dom';
import { useSelector } from 'react-redux';

import { authService } from '../services/auth';
import { coworkService } from '../services/cowork';
import { i18nService } from '../services/i18n';
import { LogReporterAction } from '../services/logReporter';
import type { RootState } from '../store';
import {
  ActivityRendererLogSource,
  logActivityRendererDiagnostic,
} from './activityDiagnostics';
import {
  reportStartupCreditCampaignEvent,
  StartupCreditCampaignSource,
  type StartupCreditCampaignSource as StartupCreditCampaignSourceType,
} from './startupCreditCampaignAnalytics';
import {
  setStartupCreditCampaignEntry,
  STARTUP_CREDIT_OPEN_EVENT,
} from './startupCreditCampaignBridge';
import {
  buildStartupCreditPosterUrl,
  canClaimStartupCredit,
  clearPendingStartupCreditClaim,
  createStartupCreditIdempotencyKey,
  dismissStartupCreditAutoPopup,
  formatStartupCreditAmount,
  isActiveStartupCreditContext,
  isStartupCreditAutoDismissed,
  isStartupCreditAutoPopupActive,
  isStartupCreditContext,
  isStartupCreditDescriptor,
  readPendingStartupCreditClaim,
  type StartupCreditSnapshot,
  writePendingStartupCreditClaim,
} from './startupCreditCampaignState';

const STARTUP_CREDIT_REFRESH_INTERVAL_MS = 24 * 60 * 60 * 1000;
const STARTUP_POSTER_PRELOAD_TIMEOUT_MS = 15_000;
const STARTUP_POSTER_PRELOAD_CACHE_LIMIT = 12;
const startupPosterPreloadCache = new Map<string, Promise<boolean>>();

const CampaignModalView = {
  Offer: 'offer',
  Claiming: 'claiming',
  StartingLogin: 'starting_login',
  Success: 'success',
  AlreadyClaimed: 'already_claimed',
  Failed: 'failed',
  Ended: 'ended',
} as const;

type CampaignModalView =
  typeof CampaignModalView[keyof typeof CampaignModalView];

interface CampaignResult {
  credits: number;
  expiresAt?: string | null;
}

interface CampaignPosterLoadState {
  url: string | null;
  settled: boolean;
  failed: boolean;
}

interface StartupCreditCampaignProps {
  enabled?: boolean;
}

const preloadStartupCreditPoster = (url: string): Promise<boolean> => {
  const cached = startupPosterPreloadCache.get(url);
  if (cached) return cached;

  if (startupPosterPreloadCache.size >= STARTUP_POSTER_PRELOAD_CACHE_LIMIT) {
    const oldestKey = startupPosterPreloadCache.keys().next().value;
    if (oldestKey) startupPosterPreloadCache.delete(oldestKey);
  }

  const request = new Promise<boolean>((resolve) => {
    const image = new Image();
    let settled = false;
    const finish = (success: boolean): void => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timeout);
      image.onload = null;
      image.onerror = null;
      if (!success) image.src = '';
      resolve(success);
    };
    const timeout = window.setTimeout(
      () => finish(false),
      STARTUP_POSTER_PRELOAD_TIMEOUT_MS,
    );
    image.decoding = 'async';
    image.onload = () => {
      if (typeof image.decode !== 'function') {
        finish(true);
        return;
      }
      void image.decode()
        .then(() => finish(true))
        .catch(() => finish(true));
    };
    image.onerror = () => finish(false);
    image.src = url;
  });
  startupPosterPreloadCache.set(url, request);
  void request.then((success) => {
    if (!success && startupPosterPreloadCache.get(url) === request) {
      startupPosterPreloadCache.delete(url);
    }
  });
  return request;
};

const formatExpiry = (value: string | null | undefined): string | null => {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return new Intl.DateTimeFormat(
    i18nService.getLanguage() === 'en' ? 'en-US' : 'zh-CN',
    { year: 'numeric', month: '2-digit', day: '2-digit' },
  ).format(date);
};

const showToast = (message: string): void => {
  window.dispatchEvent(new CustomEvent('app:showToast', { detail: message }));
};

const logStartupCreditDiagnostic = (
  level: 'debug' | 'warn',
  message: string,
  error?: unknown,
): void => logActivityRendererDiagnostic(
  ActivityRendererLogSource.StartupCreditCampaign,
  level,
  message,
  error,
);

const reportClaimFailure = (
  snapshot: StartupCreditSnapshot,
  source: StartupCreditCampaignSourceType,
  errorCode: string | number,
  retryable: boolean,
): void => {
  reportStartupCreditCampaignEvent(
    LogReporterAction.ActivityClaimFail,
    snapshot.descriptor,
    {
      source,
      error_code: errorCode,
      retryable,
    },
  );
};

const StartupCreditCampaign: React.FC<StartupCreditCampaignProps> = ({
  enabled = true,
}) => {
  const {
    isLoggedIn,
    isLoading: authLoading,
    user,
  } = useSelector((state: RootState) => state.auth);
  const authIdentity = user?.yid ?? user?.userId ?? user?.id ?? null;
  const [snapshot, setSnapshot] = useState<StartupCreditSnapshot | null>(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [modalView, setModalView] = useState<CampaignModalView>(
    CampaignModalView.Offer,
  );
  const [result, setResult] = useState<CampaignResult | null>(null);
  const [failureMessage, setFailureMessage] = useState('');
  const [posterLoad, setPosterLoad] = useState<CampaignPosterLoadState>({
    url: null,
    settled: false,
    failed: false,
  });
  const [gatewayReady, setGatewayReady] = useState(
    () => coworkService.getOpenClawEngineStatusSnapshot()?.phase
      === OpenClawEnginePhase.Running,
  );
  const snapshotRef = useRef<StartupCreditSnapshot | null>(null);
  const mountedRef = useRef(true);
  const loadRequestRef = useRef(0);
  const continuationInFlightRef = useRef(false);
  const actionInFlightRef = useRef(false);
  const modalOpenRef = useRef(false);
  const offerSourceRef = useRef<StartupCreditCampaignSourceType>(
    StartupCreditCampaignSource.AutoPopup,
  );
  const exposureReportedRef = useRef(false);
  const exposureStartedAtRef = useRef<number | null>(null);
  const reportedLoginSuccessRef = useRef(new Set<string>());
  const posterUrl = snapshot
    ? buildStartupCreditPosterUrl(
        snapshot.descriptor.posterUrl,
        snapshot.descriptor.configRevision,
      )
    : null;

  const openOffer = useCallback((source: StartupCreditCampaignSourceType): void => {
    offerSourceRef.current = source;
    exposureReportedRef.current = false;
    exposureStartedAtRef.current = null;
    setResult(null);
    setFailureMessage('');
    setModalView(CampaignModalView.Offer);
    modalOpenRef.current = true;
    setModalOpen(true);
  }, []);

  const applySnapshot = useCallback((
    next: StartupCreditSnapshot | null,
    autoOpen: boolean,
  ): void => {
    snapshotRef.current = next;
    if (!mountedRef.current) return;
    setSnapshot(next);
    setStartupCreditCampaignEntry(next && !next.context.state.claimed
      ? { available: true, label: next.descriptor.cardTitle }
      : null);
    if (!next) {
      modalOpenRef.current = false;
      exposureStartedAtRef.current = null;
      setModalOpen(false);
      return;
    }
    if (!autoOpen || next.context.state.claimed) return;
    if (!isStartupCreditAutoPopupActive(next.descriptor) || modalOpenRef.current) {
      return;
    }
    if (isStartupCreditAutoDismissed(
      localStorage,
      next.descriptor.activityCode,
    )) {
      return;
    }
    openOffer(StartupCreditCampaignSource.AutoPopup);
  }, [openOffer]);

  const fetchCurrentSnapshot = useCallback(async (
    retryRevision = true,
  ): Promise<StartupCreditSnapshot | null> => {
    const slot = await window.electron.activity.getSlot({
      placement: ActivityPlacement.DesktopStartupModal,
    });
    if (!slot.success) {
      logStartupCreditDiagnostic(
        'warn',
        `slot request failed; code=${slot.code ?? 'unknown'}; httpStatus=${slot.httpStatus ?? 'unknown'}`,
      );
      return null;
    }
    if (slot.data.slotState !== ActivitySlotState.Available
        || !isStartupCreditDescriptor(slot.data.activity)) {
      return null;
    }
    const descriptor = slot.data.activity;
    const context = await window.electron.activity.getContext({
      placement: ActivityPlacement.DesktopStartupModal,
      activityCode: descriptor.activityCode,
      configRevision: descriptor.configRevision,
    });
    if (!context.success) {
      if (retryRevision
          && context.code === ActivityServerErrorCode.RevisionMismatch) {
        logStartupCreditDiagnostic('debug', 'context revision changed; retrying slot lookup');
        return fetchCurrentSnapshot(false);
      }
      logStartupCreditDiagnostic(
        'warn',
        `context request failed; code=${context.code ?? 'unknown'}; httpStatus=${context.httpStatus ?? 'unknown'}`,
      );
      return null;
    }
    if (!isActiveStartupCreditContext(context.data)
        || context.data.activityCode !== descriptor.activityCode
        || context.data.configRevision !== descriptor.configRevision) {
      return null;
    }
    return { descriptor, context: context.data };
  }, []);

  const load = useCallback(async (
    autoOpen: boolean,
  ): Promise<StartupCreditSnapshot | null> => {
    const requestId = ++loadRequestRef.current;
    if (!enabled) {
      applySnapshot(null, false);
      return null;
    }
    try {
      const next = await fetchCurrentSnapshot();
      if (!mountedRef.current || loadRequestRef.current !== requestId) {
        return null;
      }
      applySnapshot(next, autoOpen);
      return next;
    } catch (error) {
      if (mountedRef.current && loadRequestRef.current === requestId) {
        console.warn('[StartupCreditCampaign] failed to load activity:', error);
        applySnapshot(null, false);
      }
      return null;
    }
  }, [applySnapshot, enabled, fetchCurrentSnapshot]);

  const showTerminalView = useCallback((
    view: CampaignModalView,
    nextResult: CampaignResult | null = null,
    message = '',
  ): void => {
    if (!mountedRef.current) return;
    setResult(nextResult);
    setFailureMessage(message);
    setModalView(view);
    modalOpenRef.current = true;
    setModalOpen(true);
  }, []);

  const performClaim = useCallback(async (
    target: StartupCreditSnapshot,
    idempotencyKey: string,
  ): Promise<void> => {
    if (actionInFlightRef.current) return;
    actionInFlightRef.current = true;
    showTerminalView(CampaignModalView.Claiming);
    try {
      const execute = async (
        current: StartupCreditSnapshot,
        retryRevision: boolean,
      ): Promise<void> => {
        const response = await window.electron.activity.executeAction({
          placement: ActivityPlacement.DesktopStartupModal,
          activityCode: current.descriptor.activityCode,
          configRevision: current.descriptor.configRevision,
          actionId: OneTimeCreditAction.Claim,
          idempotencyKey,
        });
        if (!response.success) {
          logStartupCreditDiagnostic(
            'warn',
            `claim request failed; code=${response.code ?? 'unknown'}; httpStatus=${response.httpStatus ?? 'unknown'}`,
          );
          if (response.code === ActivityServerErrorCode.AlreadyClaimed) {
            reportClaimFailure(
              current,
              offerSourceRef.current,
              ActivityServerErrorCode.AlreadyClaimed,
              false,
            );
            clearPendingStartupCreditClaim(localStorage);
            const refreshed = await fetchCurrentSnapshot();
            if (refreshed) applySnapshot(refreshed, false);
            showTerminalView(CampaignModalView.AlreadyClaimed, refreshed
              ? {
                  credits: refreshed.context.state.rewardCredits,
                  expiresAt: refreshed.context.state.expiresAt,
                }
              : null);
            void authService.fetchProfileSummary();
            return;
          }
          if (retryRevision
              && response.code === ActivityServerErrorCode.RevisionMismatch) {
            const refreshed = await fetchCurrentSnapshot(false);
            if (refreshed
                && refreshed.descriptor.activityCode
                  === current.descriptor.activityCode
                && canClaimStartupCredit(refreshed.context)) {
              applySnapshot(refreshed, false);
              await execute(refreshed, false);
              return;
            }
          }
          if (response.code === ActivityServerErrorCode.NotActive
              || response.code === ActivityServerErrorCode.NotFound) {
            reportClaimFailure(
              current,
              offerSourceRef.current,
              response.code,
              false,
            );
            clearPendingStartupCreditClaim(localStorage);
            applySnapshot(null, false);
            showTerminalView(CampaignModalView.Ended);
            return;
          }
          reportClaimFailure(
            current,
            offerSourceRef.current,
            response.code ?? 'request_failed',
            true,
          );
          showTerminalView(
            CampaignModalView.Failed,
            null,
            response.error || i18nService.t('startupCreditClaimFailed'),
          );
          return;
        }
        const data = response.data;
        if (!isValidClaimResponse(data, current)) {
          reportClaimFailure(
            current,
            offerSourceRef.current,
            'invalid_response',
            true,
          );
          showTerminalView(
            CampaignModalView.Failed,
            null,
            i18nService.t('startupCreditClaimFailed'),
          );
          return;
        }
        clearPendingStartupCreditClaim(localStorage);
        const next: StartupCreditSnapshot = {
          descriptor: current.descriptor,
          context: data.context,
        };
        applySnapshot(next, false);
        reportStartupCreditCampaignEvent(
          LogReporterAction.ActivityClaimSuccess,
          current.descriptor,
          {
            source: offerSourceRef.current,
            reward_points: data.result.creditsGranted,
            validity_days: data.context.state.rewardValidityDays,
            replayed: data.replayed,
          },
        );
        showTerminalView(CampaignModalView.Success, {
          credits: data.result.creditsGranted,
          expiresAt: data.result.expiresAt,
        });
        logStartupCreditDiagnostic(
          'debug',
          `claim completed; replayed=${data.replayed}; revision=${current.descriptor.configRevision}`,
        );
        void authService.fetchProfileSummary();
      };

      await execute(target, true);
    } catch (error) {
      logStartupCreditDiagnostic('warn', 'claim IPC failed', error);
      reportClaimFailure(
        target,
        offerSourceRef.current,
        'network_error',
        true,
      );
      showTerminalView(
        CampaignModalView.Failed,
        null,
        error instanceof Error
          ? error.message
          : i18nService.t('startupCreditClaimFailed'),
      );
    } finally {
      actionInFlightRef.current = false;
    }
  }, [applySnapshot, fetchCurrentSnapshot, showTerminalView]);

  const resumePendingClaim = useCallback(async (): Promise<void> => {
    if (continuationInFlightRef.current) return;
    const pending = readPendingStartupCreditClaim(localStorage);
    if (!pending) {
      await load(true);
      return;
    }
    continuationInFlightRef.current = true;
    try {
      const current = await load(false);
      if (!current
          || current.descriptor.activityCode !== pending.activityCode) {
        clearPendingStartupCreditClaim(localStorage);
        showTerminalView(CampaignModalView.Ended);
        return;
      }
      offerSourceRef.current = StartupCreditCampaignSource.LoginReturn;
      if (!reportedLoginSuccessRef.current.has(pending.idempotencyKey)) {
        reportedLoginSuccessRef.current.add(pending.idempotencyKey);
        reportStartupCreditCampaignEvent(
          LogReporterAction.ActivityLoginSuccess,
          current.descriptor,
          {
            source: StartupCreditCampaignSource.LoginReturn,
            return_to: 'netease_user_bonus_activity',
            login_method: 'browser',
          },
        );
      }
      if (current.context.state.claimed) {
        reportClaimFailure(
          current,
          StartupCreditCampaignSource.LoginReturn,
          ActivityServerErrorCode.AlreadyClaimed,
          false,
        );
        clearPendingStartupCreditClaim(localStorage);
        showTerminalView(CampaignModalView.AlreadyClaimed, {
          credits: current.context.state.rewardCredits,
          expiresAt: current.context.state.expiresAt,
        });
        void authService.fetchProfileSummary();
        return;
      }
      if (!canClaimStartupCredit(current.context)) {
        reportClaimFailure(
          current,
          StartupCreditCampaignSource.LoginReturn,
          'not_claimable',
          false,
        );
        showTerminalView(
          CampaignModalView.Failed,
          null,
          i18nService.t('startupCreditClaimFailed'),
        );
        return;
      }
      await performClaim(current, pending.idempotencyKey);
    } finally {
      continuationInFlightRef.current = false;
    }
  }, [load, performClaim, showTerminalView]);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      loadRequestRef.current += 1;
      setStartupCreditCampaignEntry(null);
    };
  }, []);

  useEffect(() => {
    let active = true;
    void coworkService.getOpenClawEngineStatus()
      .then((status) => {
        if (active) {
          setGatewayReady(status?.phase === OpenClawEnginePhase.Running);
        }
      })
      .catch((error) => {
        logStartupCreditDiagnostic(
          'warn',
          'failed to read initial OpenClaw engine status; waiting for status events',
          error,
        );
      });
    const unsubscribe = coworkService.onOpenClawEngineStatus((status) => {
      if (active) {
        setGatewayReady(status.phase === OpenClawEnginePhase.Running);
      }
    });
    return () => {
      active = false;
      unsubscribe();
    };
  }, []);

  useEffect(() => {
    if (!posterUrl) {
      setPosterLoad({ url: null, settled: true, failed: false });
      return undefined;
    }
    let active = true;
    setPosterLoad(current => current.url === posterUrl && current.settled
      ? current
      : { url: posterUrl, settled: false, failed: false });
    void preloadStartupCreditPoster(posterUrl).then((success) => {
      if (!active) return;
      if (!success) {
        logStartupCreditDiagnostic(
          'warn',
          `poster preload failed; revision=${snapshotRef.current?.descriptor.configRevision ?? 'unknown'}`,
        );
      }
      setPosterLoad({
        url: posterUrl,
        settled: true,
        failed: !success,
      });
    });
    return () => {
      active = false;
    };
  }, [posterUrl]);

  useEffect(() => {
    if (authLoading) return;
    if (!enabled) {
      applySnapshot(null, false);
      modalOpenRef.current = false;
      setModalOpen(false);
      return;
    }
    if (isLoggedIn && readPendingStartupCreditClaim(localStorage)) {
      void resumePendingClaim();
      return;
    }
    void load(true);
  }, [
    applySnapshot,
    authIdentity,
    authLoading,
    enabled,
    isLoggedIn,
    load,
    resumePendingClaim,
  ]);

  useEffect(() => {
    const handleOpen = async (event: Event) => {
      const current = snapshotRef.current ?? await load(false);
      if (!current) {
        showToast(i18nService.t('startupCreditNotAvailable'));
        return;
      }
      const requestedSource = (event as CustomEvent<{
        source?: StartupCreditCampaignSourceType;
      }>).detail?.source;
      const source = requestedSource
        ?? StartupCreditCampaignSource.HomeNewConversation;
      reportStartupCreditCampaignEvent(
        LogReporterAction.ActivityEntryClick,
        current.descriptor,
        {
          entry_name: current.descriptor.cardTitle,
          source,
        },
      );
      if (current.context.state.claimed) {
        showTerminalView(CampaignModalView.AlreadyClaimed, {
            credits: current.context.state.rewardCredits,
            expiresAt: current.context.state.expiresAt,
        });
        return;
      }
      openOffer(source);
    };
    window.addEventListener(STARTUP_CREDIT_OPEN_EVENT, handleOpen);
    return () => window.removeEventListener(STARTUP_CREDIT_OPEN_EVENT, handleOpen);
  }, [load, openOffer, showTerminalView]);

  useEffect(() => {
    if (!snapshot) return undefined;
    const now = Date.now();
    const nextBoundary = [
      snapshot.descriptor.autoPopupStartAt,
      snapshot.descriptor.autoPopupEndAt,
      snapshot.descriptor.endAt,
    ]
      .map(value => Date.parse(value))
      .filter(value => Number.isFinite(value) && value > now)
      .sort((left, right) => left - right)[0];
    const untilRefresh = nextBoundary === undefined
      ? STARTUP_CREDIT_REFRESH_INTERVAL_MS
      : Math.max(1_000, nextBoundary - now + 1_000);
    const timer = setTimeout(
      () => void load(true),
      Math.min(untilRefresh, STARTUP_CREDIT_REFRESH_INTERVAL_MS),
    );
    return () => clearTimeout(timer);
  }, [load, snapshot]);

  const closeByUser = useCallback(() => {
    if (modalView === CampaignModalView.Claiming
        || modalView === CampaignModalView.StartingLogin) {
      return;
    }
    const current = snapshotRef.current;
    if (current) {
      if (exposureStartedAtRef.current !== null) {
        reportStartupCreditCampaignEvent(
          LogReporterAction.ActivityPopupClose,
          current.descriptor,
          {
            source: offerSourceRef.current,
            exposure_duration_ms: Math.max(
              0,
              Date.now() - exposureStartedAtRef.current,
            ),
            close_state: 'dismissed',
          },
        );
      }
      dismissStartupCreditAutoPopup(
        localStorage,
        current.descriptor.activityCode,
      );
    }
    exposureStartedAtRef.current = null;
    clearPendingStartupCreditClaim(localStorage);
    modalOpenRef.current = false;
    setModalOpen(false);
  }, [modalView]);

  useEffect(() => {
    if (!modalOpen
        || modalView === CampaignModalView.Claiming
        || modalView === CampaignModalView.StartingLogin) {
      return undefined;
    }
    const handleKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') closeByUser();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [closeByUser, modalOpen, modalView]);

  const handlePrimaryAction = useCallback(async () => {
    const current = snapshotRef.current;
    if (!current) {
      showTerminalView(CampaignModalView.Ended);
      return;
    }
    if (current.context.state.claimed) {
      showTerminalView(CampaignModalView.AlreadyClaimed, {
        credits: current.context.state.rewardCredits,
        expiresAt: current.context.state.expiresAt,
      });
      return;
    }

    reportStartupCreditCampaignEvent(
      LogReporterAction.ActivityClaimClick,
      current.descriptor,
      {
        source: offerSourceRef.current,
        login_status: isLoggedIn && current.context.authenticated
          ? 'logged_in'
          : 'logged_out',
        button_text: current.descriptor.actionText,
      },
    );
    exposureStartedAtRef.current = null;

    const existingPending = readPendingStartupCreditClaim(localStorage);
    const pending = existingPending?.activityCode === current.descriptor.activityCode
      ? existingPending
      : writePendingStartupCreditClaim(
          localStorage,
          current.descriptor,
          Date.now(),
          createStartupCreditIdempotencyKey(),
        );
    if (!isLoggedIn || !current.context.authenticated) {
      reportStartupCreditCampaignEvent(
        LogReporterAction.ActivityLoginRedirect,
        current.descriptor,
        {
          source: offerSourceRef.current,
          return_to: 'netease_user_bonus_activity',
          reason: 'claim_requires_login',
        },
      );
      showTerminalView(CampaignModalView.StartingLogin);
      try {
        await authService.login();
        if (mountedRef.current) setModalView(CampaignModalView.Offer);
      } catch (error) {
        logStartupCreditDiagnostic('warn', 'login redirect failed', error);
        reportClaimFailure(
          current,
          offerSourceRef.current,
          'login_redirect_failed',
          true,
        );
        clearPendingStartupCreditClaim(localStorage);
        showTerminalView(
          CampaignModalView.Failed,
          null,
          error instanceof Error
            ? error.message
            : i18nService.t('startupCreditLoginFailed'),
        );
      }
      return;
    }
    await performClaim(current, pending.idempotencyKey);
  }, [isLoggedIn, performClaim, showTerminalView]);

  const handleRetry = useCallback(async () => {
    const current = snapshotRef.current ?? await load(false);
    if (!current) {
      showTerminalView(CampaignModalView.Ended);
      return;
    }
    const pending = readPendingStartupCreditClaim(localStorage)
      ?? writePendingStartupCreditClaim(localStorage, current.descriptor);
    await performClaim(current, pending.idempotencyKey);
  }, [load, performClaim, showTerminalView]);

  const descriptor = snapshot?.descriptor ?? null;
  const activityState = snapshot?.context.state ?? null;
  const isBusy = modalView === CampaignModalView.Claiming
    || modalView === CampaignModalView.StartingLogin;
  const isOffer = modalView === CampaignModalView.Offer;
  const isSuccess = modalView === CampaignModalView.Success;
  const isAlreadyClaimed = modalView === CampaignModalView.AlreadyClaimed;
  const isFailure = modalView === CampaignModalView.Failed;
  const isEnded = modalView === CampaignModalView.Ended;
  const shouldShowPoster = Boolean(descriptor) && (isOffer || isBusy);
  const posterReady = !shouldShowPoster
    || (posterLoad.url === posterUrl && posterLoad.settled);

  useEffect(() => {
    if (!modalOpen
        || !gatewayReady
        || !posterReady
        || posterLoad.failed
        || !isOffer
        || !descriptor
        || exposureReportedRef.current) {
      return;
    }
    exposureReportedRef.current = true;
    exposureStartedAtRef.current = Date.now();
    reportStartupCreditCampaignEvent(
      LogReporterAction.ActivityPopupExposure,
      descriptor,
      {
        source: offerSourceRef.current,
        popup_type: 'startup_credit_offer',
        is_auto_popup: offerSourceRef.current
          === StartupCreditCampaignSource.AutoPopup,
        login_status: snapshot?.context.authenticated
          ? 'logged_in'
          : 'logged_out',
        close_state: isStartupCreditAutoDismissed(
          localStorage,
          descriptor.activityCode,
        ) ? 'dismissed' : 'open',
      },
    );
  }, [
    descriptor,
    gatewayReady,
    isOffer,
    modalOpen,
    posterLoad.failed,
    posterReady,
    snapshot?.context.authenticated,
  ]);

  if (!modalOpen || !gatewayReady || !posterReady) return null;
  if (!descriptor && (isOffer || isBusy || isSuccess || isAlreadyClaimed)) {
    return null;
  }
  const expiry = formatExpiry(result?.expiresAt);
  const resultCredits = formatStartupCreditAmount(
    result?.credits ?? activityState?.rewardCredits ?? 0,
  );
  const resultDescription = isSuccess
    ? expiry
      ? i18nService.t('startupCreditClaimSuccessDescription')
        .replace('{credits}', resultCredits)
        .replace('{date}', expiry)
      : i18nService.t('startupCreditExpiryUnknown')
        .replace('{days}', String(activityState?.rewardValidityDays ?? 30))
    : isAlreadyClaimed
      ? i18nService.t('startupCreditAlreadyClaimedDescription')
      : isEnded
        ? i18nService.t('startupCreditEndedDescription')
        : failureMessage || i18nService.t('startupCreditClaimFailed');

  return createPortal(
    <div
      className="non-draggable fixed inset-0 z-[210] flex items-center justify-center bg-black/50 p-6 backdrop-blur-[1px]"
      role="dialog"
      aria-modal="true"
      aria-label={descriptor?.modalTitle
        ?? i18nService.t(
          isEnded ? 'startupCreditEndedTitle' : 'startupCreditClaimFailedTitle',
        )}
    >
      <section className={`relative z-10 max-h-[calc(100vh-48px)] w-[min(432px,calc(100vw-48px))] overflow-x-hidden overflow-y-auto rounded-2xl shadow-modal ${
        shouldShowPoster
          ? 'bg-transparent'
          : 'border border-border bg-surface'
      }`}
      >
        <button
          type="button"
          className={`absolute right-3 top-3 z-10 flex h-8 w-8 items-center justify-center rounded-full transition-colors disabled:cursor-wait disabled:opacity-60 ${
            shouldShowPoster
              ? 'bg-black/35 text-white hover:bg-black/50'
              : 'bg-surface-raised text-secondary hover:text-foreground'
          }`}
          aria-label={i18nService.t('close')}
          onClick={closeByUser}
          disabled={isBusy}
        >
          <XMarkIcon className="h-5 w-5" />
        </button>
        {shouldShowPoster && descriptor && posterUrl ? (
          <div className="relative overflow-hidden rounded-2xl bg-surface">
            {!posterLoad.failed ? (
              <img
                src={posterUrl}
                alt={descriptor.posterAlt}
                onError={() => setPosterLoad(current => (
                  current.url === posterUrl
                    ? { ...current, settled: true, failed: true }
                    : current
                ))}
                className="block h-auto w-full"
              />
            ) : (
              <div className="flex min-h-56 items-center justify-center px-8 text-center text-sm text-secondary">
                {i18nService.t('startupCreditClaimFailed')}
              </div>
            )}
            {!posterLoad.failed && (
              <button
                type="button"
                disabled={isBusy}
                onClick={() => void handlePrimaryAction()}
                className="absolute inset-x-[13%] bottom-[7%] flex h-11 items-center justify-center rounded-lg bg-[#292c32] px-4 text-sm font-semibold text-white shadow-lg transition-colors hover:bg-black disabled:cursor-wait disabled:opacity-70"
              >
                {modalView === CampaignModalView.Claiming
                  ? i18nService.t('startupCreditClaiming')
                  : modalView === CampaignModalView.StartingLogin
                    ? i18nService.t('startupCreditStartingLogin')
                    : descriptor?.actionText}
              </button>
            )}
          </div>
        ) : (
          <div className="px-7 pb-6 pt-7 text-center">
            <h2 className="pr-5 text-xl font-semibold text-foreground">
              {isSuccess
                ? i18nService.t('startupCreditClaimSuccessTitle')
                : isAlreadyClaimed
                  ? i18nService.t('startupCreditAlreadyClaimedTitle')
                  : isEnded
                    ? i18nService.t('startupCreditEndedTitle')
                    : i18nService.t('startupCreditClaimFailedTitle')}
            </h2>
            <p className="mx-auto mt-2 max-w-[340px] text-sm leading-6 text-secondary">
              {resultDescription}
            </p>
            <button
              type="button"
              onClick={isFailure
                ? () => void handleRetry()
                : closeByUser}
              className="mt-5 flex h-11 w-full items-center justify-center rounded-xl bg-primary text-sm font-semibold text-primary-foreground transition-colors hover:bg-primary-hover"
            >
              {isFailure
                ? i18nService.t('startupCreditRetry')
                : i18nService.t('startupCreditDone')}
            </button>
          </div>
        )}
      </section>
    </div>,
    document.body,
  );
};

function isValidClaimResponse(
  value: unknown,
  current: StartupCreditSnapshot,
): value is StartupCreditActionResponse {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const response = value as Partial<StartupCreditActionResponse>;
  return typeof response.replayed === 'boolean'
    && response.result !== undefined
    && response.result.activityCode === current.descriptor.activityCode
    && response.result.actionId === OneTimeCreditAction.Claim
    && Number.isFinite(response.result.creditsGranted)
    && response.result.creditsGranted > 0
    && typeof response.result.claimedAt === 'string'
    && typeof response.result.expiresAt === 'string'
    && isStartupCreditContext(response.context)
    && response.context.activityCode === current.descriptor.activityCode
    && response.context.configRevision === current.descriptor.configRevision
    && response.context.lifecycleState === ActivityLifecycleState.Active
    && response.context.state.claimed;
}

export default StartupCreditCampaign;
