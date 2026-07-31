import {
  CheckCircleIcon,
  ExclamationTriangleIcon,
  XMarkIcon,
} from '@heroicons/react/24/outline';
import {
  ActivityLifecycleState,
  ActivityPlacement,
  ActivityServerErrorCode,
  ActivitySlotState,
  OneTimeCreditAction,
  type StartupCreditActionResponse,
} from '@shared/activity/constants';
import React, {
  useCallback,
  useEffect,
  useRef,
  useState,
} from 'react';
import { createPortal } from 'react-dom';
import { useSelector } from 'react-redux';

import { authService } from '../services/auth';
import { i18nService } from '../services/i18n';
import type { RootState } from '../store';
import {
  setStartupCreditCampaignEntry,
  STARTUP_CREDIT_OPEN_EVENT,
} from './startupCreditCampaignBridge';
import {
  canClaimStartupCredit,
  clearPendingStartupCreditClaim,
  createStartupCreditIdempotencyKey,
  dismissStartupCreditAutoPopup,
  formatStartupCreditAmount,
  isActiveStartupCreditContext,
  isStartupCreditAutoDismissed,
  isStartupCreditContext,
  isStartupCreditDescriptor,
  readPendingStartupCreditClaim,
  type StartupCreditSnapshot,
  writePendingStartupCreditClaim,
} from './startupCreditCampaignState';

const STARTUP_CREDIT_REFRESH_INTERVAL_MS = 24 * 60 * 60 * 1000;

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

interface StartupCreditCampaignProps {
  enabled?: boolean;
}

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
  const [posterFailed, setPosterFailed] = useState(false);
  const snapshotRef = useRef<StartupCreditSnapshot | null>(null);
  const mountedRef = useRef(true);
  const loadRequestRef = useRef(0);
  const continuationInFlightRef = useRef(false);
  const actionInFlightRef = useRef(false);

  const applySnapshot = useCallback((
    next: StartupCreditSnapshot | null,
    autoOpen: boolean,
  ): void => {
    snapshotRef.current = next;
    if (!mountedRef.current) return;
    setSnapshot(next);
    setPosterFailed(false);
    setStartupCreditCampaignEntry(next
      ? { available: true, label: next.descriptor.cardTitle }
      : null);
    if (!autoOpen || !next || next.context.state.claimed) return;
    if (isStartupCreditAutoDismissed(
      localStorage,
      next.descriptor.activityCode,
    )) {
      return;
    }
    setResult(null);
    setFailureMessage('');
    setModalView(CampaignModalView.Offer);
    setModalOpen(true);
  }, []);

  const fetchCurrentSnapshot = useCallback(async (
    retryRevision = true,
  ): Promise<StartupCreditSnapshot | null> => {
    const slot = await window.electron.activity.getSlot({
      placement: ActivityPlacement.DesktopStartupModal,
    });
    if (!slot.success
        || slot.data.slotState !== ActivitySlotState.Available
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
        return fetchCurrentSnapshot(false);
      }
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
          if (response.code === ActivityServerErrorCode.AlreadyClaimed) {
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
            clearPendingStartupCreditClaim(localStorage);
            applySnapshot(null, false);
            showTerminalView(CampaignModalView.Ended);
            return;
          }
          showTerminalView(
            CampaignModalView.Failed,
            null,
            response.error || i18nService.t('startupCreditClaimFailed'),
          );
          return;
        }
        const data = response.data;
        if (!isValidClaimResponse(data, current)) {
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
        showTerminalView(CampaignModalView.Success, {
          credits: data.result.creditsGranted,
          expiresAt: data.result.expiresAt,
        });
        void authService.fetchProfileSummary();
      };

      await execute(target, true);
    } catch (error) {
      console.warn('[StartupCreditCampaign] failed to claim activity:', error);
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
      if (current.context.state.claimed) {
        clearPendingStartupCreditClaim(localStorage);
        showTerminalView(CampaignModalView.AlreadyClaimed, {
          credits: current.context.state.rewardCredits,
          expiresAt: current.context.state.expiresAt,
        });
        void authService.fetchProfileSummary();
        return;
      }
      if (!canClaimStartupCredit(current.context)) {
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
    if (authLoading) return;
    if (!enabled) {
      applySnapshot(null, false);
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
    const handleOpen = async () => {
      const current = snapshotRef.current ?? await load(false);
      if (!current) {
        showToast(i18nService.t('startupCreditNotAvailable'));
        return;
      }
      setResult(current.context.state.claimed
        ? {
            credits: current.context.state.rewardCredits,
            expiresAt: current.context.state.expiresAt,
          }
        : null);
      setFailureMessage('');
      setModalView(current.context.state.claimed
        ? CampaignModalView.AlreadyClaimed
        : CampaignModalView.Offer);
      setModalOpen(true);
    };
    window.addEventListener(STARTUP_CREDIT_OPEN_EVENT, handleOpen);
    return () => window.removeEventListener(STARTUP_CREDIT_OPEN_EVENT, handleOpen);
  }, [load]);

  useEffect(() => {
    if (!snapshot) return undefined;
    const endAt = Date.parse(snapshot.descriptor.endAt);
    const untilEnd = Number.isFinite(endAt)
      ? Math.max(1_000, endAt - Date.now() + 1_000)
      : STARTUP_CREDIT_REFRESH_INTERVAL_MS;
    const timer = setTimeout(
      () => void load(false),
      Math.min(untilEnd, STARTUP_CREDIT_REFRESH_INTERVAL_MS),
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
      dismissStartupCreditAutoPopup(
        localStorage,
        current.descriptor.activityCode,
      );
    }
    clearPendingStartupCreditClaim(localStorage);
    setModalOpen(false);
  }, [modalView]);

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
      showTerminalView(CampaignModalView.StartingLogin);
      try {
        await authService.login();
        if (mountedRef.current) setModalView(CampaignModalView.Offer);
      } catch (error) {
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

  if (!modalOpen) return null;

  const descriptor = snapshot?.descriptor ?? null;
  const activityState = snapshot?.context.state ?? null;
  const isBusy = modalView === CampaignModalView.Claiming
    || modalView === CampaignModalView.StartingLogin;
  const isOffer = modalView === CampaignModalView.Offer;
  const isSuccess = modalView === CampaignModalView.Success;
  const isAlreadyClaimed = modalView === CampaignModalView.AlreadyClaimed;
  const isFailure = modalView === CampaignModalView.Failed;
  const isEnded = modalView === CampaignModalView.Ended;
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
      <button
        type="button"
        className="absolute inset-0 cursor-default"
        aria-label={i18nService.t('close')}
        onClick={closeByUser}
        disabled={isBusy}
      />
      <section className="relative z-10 w-[min(430px,calc(100vw-48px))] overflow-hidden rounded-2xl border border-black/10 bg-white shadow-2xl dark:border-white/10 dark:bg-[#202124]">
        <button
          type="button"
          className="absolute right-3 top-3 z-10 flex h-8 w-8 items-center justify-center rounded-full bg-black/35 text-white transition-colors hover:bg-black/50 disabled:cursor-wait disabled:opacity-60"
          aria-label={i18nService.t('close')}
          onClick={closeByUser}
          disabled={isBusy}
        >
          <XMarkIcon className="h-5 w-5" />
        </button>
        {descriptor && !posterFailed && (
          <img
            src={descriptor.posterUrl}
            alt={descriptor.posterAlt}
            onError={() => setPosterFailed(true)}
            className="block max-h-[300px] w-full bg-[#FFF4EA] object-contain"
          />
        )}
        <div className="px-7 pb-6 pt-5 text-center">
          {isOffer || isBusy ? (
            <>
              <h2 className="text-xl font-semibold text-foreground">
                {descriptor?.modalTitle}
              </h2>
              <p className="mx-auto mt-2 max-w-[340px] text-sm leading-6 text-secondary">
                {descriptor?.modalDescription}
              </p>
              <button
                type="button"
                disabled={isBusy}
                onClick={() => void handlePrimaryAction()}
                className="mt-5 flex h-11 w-full items-center justify-center rounded-xl bg-[linear-gradient(90deg,#ED773D,#EE9855)] text-sm font-semibold text-white shadow-[0_8px_20px_rgba(224,111,54,0.28)] transition-opacity hover:opacity-90 disabled:cursor-wait disabled:opacity-70"
              >
                {modalView === CampaignModalView.Claiming
                  ? i18nService.t('startupCreditClaiming')
                  : modalView === CampaignModalView.StartingLogin
                    ? i18nService.t('startupCreditStartingLogin')
                    : descriptor?.actionText}
              </button>
            </>
          ) : (
            <>
              <div className={`mx-auto flex h-14 w-14 items-center justify-center rounded-full ${
                isFailure || isEnded
                  ? 'bg-amber-50 text-amber-600 dark:bg-amber-950/40'
                  : 'bg-emerald-50 text-emerald-600 dark:bg-emerald-950/40'
              }`}
              >
                {isFailure || isEnded
                  ? <ExclamationTriangleIcon className="h-8 w-8" />
                  : <CheckCircleIcon className="h-8 w-8" />}
              </div>
              <h2 className="mt-3 text-xl font-semibold text-foreground">
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
                className="mt-5 flex h-11 w-full items-center justify-center rounded-xl bg-[#303136] text-sm font-semibold text-white transition-colors hover:bg-[#202126]"
              >
                {isFailure
                  ? i18nService.t('startupCreditRetry')
                  : i18nService.t('startupCreditDone')}
              </button>
            </>
          )}
        </div>
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
