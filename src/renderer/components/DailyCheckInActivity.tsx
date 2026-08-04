import {
  CheckCircleIcon,
  XMarkIcon,
} from '@heroicons/react/24/outline';
import type { DailyCheckInDescriptor } from '@shared/activity/constants';
import React, { useState } from 'react';
import { createPortal } from 'react-dom';

import dailyCheckInGiftUrl from '../assets/daily-check-in-gift.png';
import { authService } from '../services/auth';
import { i18nService } from '../services/i18n';
import {
  canClaimDailyCheckIn,
  formatDailyCheckInCredits,
} from './dailyCheckInActivityState';
import type { DailyCheckInSnapshot } from './useDailyCheckInActivity';

const GiftIcon: React.FC<{ className?: string }> = ({ className = '' }) => (
  <svg
    viewBox="0 0 24 24"
    fill="none"
    className={className}
    aria-hidden="true"
  >
    <path
      d="M4.5 9.25h15v10.25a1 1 0 0 1-1 1h-13a1 1 0 0 1-1-1V9.25Z"
      fill="currentColor"
      opacity="0.14"
    />
    <path
      d="M3.5 6.75h17v3.5h-17v-3.5Zm8.5 0v13.5M7.1 6.6C5.7 5.75 5.5 3.5 7.2 3.1c1.75-.4 3.7 2.35 4.8 3.65M16.9 6.6c1.4-.85 1.6-3.1-.1-3.5-1.75-.4-3.7 2.35-4.8 3.65"
      stroke="currentColor"
      strokeWidth="1.45"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </svg>
);

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
      await authService.login();
      onClose();
    } catch (error) {
      window.dispatchEvent(new CustomEvent('app:showToast', {
        detail: error instanceof Error
          ? error.message
          : i18nService.t('dailyCheckInLoginFailed'),
      }));
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

interface DailyCheckInSidebarCardProps {
  snapshot: DailyCheckInSnapshot;
  claiming: boolean;
  successCredits: number | null;
  hidden: boolean;
  onClaim: () => void;
  onDismiss: () => void;
}

export const DailyCheckInSidebarCard: React.FC<DailyCheckInSidebarCardProps> = ({
  snapshot,
  claiming,
  successCredits,
  hidden,
  onClaim,
  onDismiss,
}) => {
  const { descriptor, context } = snapshot;
  const { state } = context;
  const rewardCredits = formatDailyCheckInCredits(state.rewardCredits);
  const claimedCredits = formatDailyCheckInCredits(state.claimedCredits);
  const claimDisabled = claiming
    || successCredits !== null
    || (context.authenticated && !canClaimDailyCheckIn(context));

  return (
    <div
      className={`${hidden ? 'pointer-events-none' : 'pointer-events-auto'} relative w-full overflow-hidden rounded-xl border border-[#F2DACC] bg-[linear-gradient(145deg,#FFF8F3,#FFFFFF)] p-2.5 text-[#35251D] shadow-[0_5px_14px_rgba(77,42,25,0.12)]`}
    >
      <div className="flex items-center gap-1.5 pr-5">
        <img
          src={dailyCheckInGiftUrl}
          alt=""
          aria-hidden="true"
          className="h-5 w-5 shrink-0 object-contain"
        />
        <span className="truncate text-[11px] font-semibold">
          {descriptor.cardTitle}
        </span>
        <span className="ml-auto shrink-0 rounded-full bg-[#FFF0E6] px-1.5 py-0.5 text-[8px] text-[#A95A31]">
          {descriptor.periodLabel}
        </span>
      </div>
      <button
        type="button"
        tabIndex={hidden ? -1 : 0}
        onClick={onDismiss}
        className="absolute right-1.5 top-1.5 flex h-5 w-5 items-center justify-center rounded-full text-[#9D7F6E] transition-colors hover:bg-[#FFF0E6] hover:text-[#4A3023]"
        aria-label={i18nService.t('close')}
      >
        <XMarkIcon className="h-3.5 w-3.5" />
      </button>
      <div className="mt-2 text-[13px] font-bold">
        {i18nService.t('dailyCheckInRewardPerDay')
          .replace('{credits}', rewardCredits)}
      </div>
      <div className="mt-0.5 text-[9px] text-[#806A5D]">
        {i18nService.t('dailyCheckInProgress')
          .replace('{claimed}', String(state.claimedDays))
          .replace('{total}', String(state.totalDays))
          .replace('{credits}', claimedCredits)}
      </div>
      <button
        type="button"
        tabIndex={hidden ? -1 : 0}
        disabled={claimDisabled}
        onClick={onClaim}
        className={`mt-2 flex h-8 w-full items-center justify-center gap-1 rounded-lg text-[11px] font-semibold text-white transition-colors disabled:cursor-default ${
          successCredits !== null
            ? 'bg-[#F08A58]'
            : 'bg-[#303136] hover:bg-[#202126] disabled:bg-[#696A6E]'
        }`}
      >
        {successCredits !== null && <CheckCircleIcon className="h-3.5 w-3.5" />}
        {successCredits !== null
          ? i18nService.t('dailyCheckInClaimedCredits')
            .replace('{credits}', formatDailyCheckInCredits(successCredits))
          : claiming
            ? i18nService.t('dailyCheckInClaiming')
            : i18nService.t('dailyCheckInClaimNow')}
      </button>
    </div>
  );
};

interface DailyCheckInProfileCardProps {
  snapshot: DailyCheckInSnapshot;
  claiming: boolean;
  onClaim: () => Promise<void>;
}

export const DailyCheckInProfileCard: React.FC<DailyCheckInProfileCardProps> = ({
  snapshot,
  claiming,
  onClaim,
}) => {
  const { descriptor, context } = snapshot;
  const { state } = context;
  const disabled = claiming || !canClaimDailyCheckIn(context);
  const actionText = state.completed
    ? i18nService.t('dailyCheckInCompleted')
    : state.claimedToday
      ? i18nService.t('dailyCheckInTodayClaimed')
      : claiming
        ? i18nService.t('dailyCheckInClaiming')
        : i18nService.t('dailyCheckInClaimNow');

  return (
    <div className="mx-2 my-1.5 rounded-xl border border-[#F1D7C8] bg-[linear-gradient(145deg,#FFF8F2,#FFFDFB)] p-2.5 text-[#35251D]">
      <div className="flex items-center gap-1.5">
        <GiftIcon className="h-3.5 w-3.5 text-[#E86A30]" />
        <span className="text-[11px] font-semibold">{descriptor.cardTitle}</span>
        <span className="ml-auto rounded-full bg-[#FFF0E6] px-1.5 py-0.5 text-[8px] text-[#A95A31]">
          {descriptor.periodLabel}
        </span>
      </div>
      <div className="mt-2 flex items-end justify-between gap-2">
        <div className="min-w-0">
          <div className="text-[11px] font-semibold">
            {i18nService.t('dailyCheckInRewardPerDay').replace(
              '{credits}',
              formatDailyCheckInCredits(state.rewardCredits),
            )}
          </div>
          <div className="mt-0.5 truncate text-[9px] text-[#806A5D]">
            {i18nService.t('dailyCheckInProgress')
              .replace('{claimed}', String(state.claimedDays))
              .replace('{total}', String(state.totalDays))
              .replace(
                '{credits}',
                formatDailyCheckInCredits(state.claimedCredits),
              )}
          </div>
        </div>
        <button
          type="button"
          disabled={disabled}
          onClick={() => void onClaim()}
          className="shrink-0 rounded-md border border-[#F0CDB9] bg-[#FFF1E8] px-2 py-1 text-[9px] font-semibold text-[#C45D28] transition-colors hover:bg-[#FFE7D7] disabled:cursor-default disabled:opacity-80"
        >
          {actionText}
        </button>
      </div>
    </div>
  );
};
