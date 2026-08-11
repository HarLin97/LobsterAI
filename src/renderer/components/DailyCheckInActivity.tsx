import {
  CheckCircleIcon,
  XMarkIcon,
} from '@heroicons/react/24/outline';
import {
  ActivityServerErrorCode,
  type DailyCheckInDescriptor,
} from '@shared/activity/constants';
import React, {
  useCallback,
  useEffect,
  useRef,
  useState,
} from 'react';
import { createPortal } from 'react-dom';
import { useSelector } from 'react-redux';

import dailyCheckInGiftUrl from '../assets/daily-check-in-gift.png';
import { authService } from '../services/auth';
import { i18nService } from '../services/i18n';
import type { RootState } from '../store';
import {
  formatDailyCheckInCredits,
  shouldShowDailyCheckInEntry,
} from './dailyCheckInActivityState';
import {
  DailyCheckInRequestError,
  DailyCheckInStaleRequestError,
  useDailyCheckInActivity,
} from './useDailyCheckInActivity';

const CLAIM_SUCCESS_DURATION_MS = 2200;
const MILLISECONDS_PER_DAY = 24 * 60 * 60 * 1000;

const showToast = (message: string): void => {
  window.dispatchEvent(new CustomEvent('app:showToast', { detail: message }));
};

const getRewardValidityDays = (
  claimedAt: string,
  expiresAt: string,
): number | null => {
  const claimedAtMs = Date.parse(claimedAt);
  const expiresAtMs = Date.parse(expiresAt);
  if (!Number.isFinite(claimedAtMs)
      || !Number.isFinite(expiresAtMs)
      || expiresAtMs <= claimedAtMs) {
    return null;
  }
  return Math.max(1, Math.round(
    (expiresAtMs - claimedAtMs) / MILLISECONDS_PER_DAY,
  ));
};

interface DailyCheckInLoginModalProps {
  descriptor: DailyCheckInDescriptor;
  onClose: () => void;
}

export const DailyCheckInLoginModal: React.FC<DailyCheckInLoginModalProps> = ({
  descriptor,
  onClose,
}) => {
  const [startingLogin, setStartingLogin] = useState(false);

  const startLogin = async () => {
    if (startingLogin) return;
    setStartingLogin(true);
    try {
      const result = await authService.login();
      if (!result.success) {
        throw new Error(result.error || i18nService.t('dailyCheckInLoginFailed'));
      }
      onClose();
    } catch (error) {
      showToast(error instanceof Error
        ? error.message
        : i18nService.t('dailyCheckInLoginFailed'));
    } finally {
      setStartingLogin(false);
    }
  };

  return createPortal(
    <div
      className="non-draggable fixed inset-0 z-[110] flex items-center justify-center bg-black/30 p-6 backdrop-blur-[1px]"
      role="dialog"
      aria-modal="true"
      aria-label={descriptor.guestModalTitle}
    >
      <button
        type="button"
        className="absolute inset-0 cursor-default"
        aria-label={i18nService.t('close')}
        onClick={onClose}
      />
      <section className="relative z-10 w-[320px] overflow-hidden rounded-2xl border border-black/10 bg-white px-5 pb-4 pt-5 text-center shadow-2xl dark:border-white/10 dark:bg-[#202124]">
        <button
          type="button"
          className="absolute right-3 top-3 flex h-7 w-7 items-center justify-center rounded-full text-secondary transition-colors hover:bg-black/5 hover:text-foreground dark:hover:bg-white/10"
          aria-label={i18nService.t('close')}
          onClick={onClose}
        >
          <XMarkIcon className="h-4 w-4" />
        </button>
        <img
          src={dailyCheckInGiftUrl}
          alt=""
          aria-hidden="true"
          className="mx-auto -mt-1 mb-3 h-[78px] w-[92px] object-contain drop-shadow-lg"
        />
        <h2 className="text-base font-semibold text-foreground">
          {descriptor.guestModalTitle}
        </h2>
        <p className="mx-auto mt-2 max-w-[260px] text-xs leading-5 text-secondary">
          {descriptor.guestModalDescription}
        </p>
        <button
          type="button"
          disabled={startingLogin}
          onClick={() => void startLogin()}
          className="mt-5 flex h-10 w-full items-center justify-center rounded-lg bg-[#4D73E8] text-sm font-semibold text-white transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {startingLogin
            ? i18nService.t('dailyCheckInStartingLogin')
            : descriptor.guestModalActionText}
        </button>
        <p className="mt-2 text-[10px] leading-4 text-secondary/80">
          {i18nService.t('dailyCheckInLoginHint')}
        </p>
      </section>
    </div>,
    document.body,
  );
};

interface DailyCheckInHeaderEntryProps {
  suppressed?: boolean;
}

interface DailyCheckInSuccessState {
  credits: number;
  validityDays: number | null;
}

export const DailyCheckInHeaderEntry: React.FC<
  DailyCheckInHeaderEntryProps
> = ({ suppressed = false }) => {
  const isLoggedIn = useSelector((state: RootState) => state.auth.isLoggedIn);
  const {
    snapshot,
    claiming,
    claim,
  } = useDailyCheckInActivity();
  const [loginModalOpen, setLoginModalOpen] = useState(false);
  const [success, setSuccess] = useState<DailyCheckInSuccessState | null>(null);
  const successTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearSuccessTimer = useCallback(() => {
    if (!successTimerRef.current) return;
    clearTimeout(successTimerRef.current);
    successTimerRef.current = null;
  }, []);

  const showSuccess = useCallback((next: DailyCheckInSuccessState) => {
    clearSuccessTimer();
    setSuccess(next);
    successTimerRef.current = setTimeout(() => {
      setSuccess(null);
      successTimerRef.current = null;
    }, CLAIM_SUCCESS_DURATION_MS);
  }, [clearSuccessTimer]);

  useEffect(() => () => clearSuccessTimer(), [clearSuccessTimer]);

  useEffect(() => {
    if (suppressed) {
      setLoginModalOpen(false);
      clearSuccessTimer();
      setSuccess(null);
    }
  }, [clearSuccessTimer, suppressed]);

  useEffect(() => {
    if (isLoggedIn) setLoginModalOpen(false);
  }, [isLoggedIn]);

  const handleClaim = useCallback(async () => {
    if (!snapshot || claiming || success) return;
    if (!isLoggedIn || !snapshot.context.authenticated) {
      setLoginModalOpen(true);
      return;
    }

    try {
      const response = await claim();
      showSuccess({
        credits: response.result.creditsGranted,
        validityDays: getRewardValidityDays(
          response.result.claimedAt,
          response.result.expiresAt,
        ),
      });
    } catch (error) {
      if (error instanceof DailyCheckInStaleRequestError) return;
      if (error instanceof DailyCheckInRequestError) {
        if (error.code === ActivityServerErrorCode.AlreadyClaimed) {
          showSuccess({
            credits: snapshot.context.state.rewardCredits,
            validityDays: null,
          });
          return;
        }
        if (error.code === ActivityServerErrorCode.LoginRequired) {
          setLoginModalOpen(true);
          return;
        }
        if (error.code === ActivityServerErrorCode.NotActive
            || error.code === ActivityServerErrorCode.NotFound) {
          return;
        }
      }
      showToast(i18nService.t('dailyCheckInClaimFailed'));
    }
  }, [claim, claiming, isLoggedIn, showSuccess, snapshot, success]);

  const stateAllowsEntry = snapshot
    ? shouldShowDailyCheckInEntry(snapshot.context)
    : false;
  if (suppressed || (!stateAllowsEntry && !success)) return null;

  const entryLabel = snapshot?.descriptor.cardTitle
    || i18nService.t('dailyCheckInEntry');
  const buttonLabel = success
    ? i18nService.t('dailyCheckInTodayClaimed')
    : claiming
      ? i18nService.t('dailyCheckInClaiming')
      : entryLabel;

  return (
    <>
      <div className="relative mr-2">
        <button
          type="button"
          disabled={claiming || success !== null}
          onClick={() => void handleClaim()}
          className="inline-flex h-8 max-w-[240px] items-center gap-1.5 rounded-full border border-[#F1D3C0] bg-[#FFF8F3] px-3 text-xs font-medium text-[#7C4328] shadow-subtle transition-colors hover:bg-[#FFF0E6] disabled:cursor-default dark:border-[#704530] dark:bg-[#352A25] dark:text-[#F5C4A5] dark:hover:bg-[#403029]"
        >
          {success ? (
            <CheckCircleIcon className="h-4 w-4 shrink-0 text-[#E36E32]" />
          ) : (
            <img
              src={dailyCheckInGiftUrl}
              alt=""
              aria-hidden="true"
              className="h-4 w-4 shrink-0 object-contain"
            />
          )}
          <span className="truncate">{buttonLabel}</span>
        </button>

        {success && (
          <section
            role="status"
            aria-live="polite"
            className="absolute right-0 top-10 z-50 flex w-[226px] items-center gap-3 rounded-xl border border-[#F1D3C0] bg-[#FFF9F5] p-3 text-[#59321F] shadow-popover dark:border-[#704530] dark:bg-[#302621] dark:text-[#F7D5C1]"
          >
            <img
              src={dailyCheckInGiftUrl}
              alt=""
              aria-hidden="true"
              className="h-12 w-12 shrink-0 object-contain"
            />
            <div className="min-w-0">
              <div className="text-sm font-semibold">
                {i18nService.t('dailyCheckInRewardReceived')}
              </div>
              <div className="mt-0.5 text-base font-bold text-[#E36E32]">
                {i18nService.t('dailyCheckInRewardCredits').replace(
                  '{credits}',
                  formatDailyCheckInCredits(success.credits),
                )}
              </div>
              {success.validityDays !== null && (
                <div className="mt-0.5 text-[10px] text-[#8A6756] dark:text-[#C6A28E]">
                  {i18nService.t('dailyCheckInValidityDays').replace(
                    '{days}',
                    String(success.validityDays),
                  )}
                </div>
              )}
            </div>
          </section>
        )}
      </div>

      {loginModalOpen && snapshot && (
        <DailyCheckInLoginModal
          descriptor={snapshot.descriptor}
          onClose={() => setLoginModalOpen(false)}
        />
      )}
    </>
  );
};
