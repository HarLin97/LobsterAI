import React, {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from 'react';
import { useSelector } from 'react-redux';

import { i18nService } from '../services/i18n';
import type { RootState } from '../store';
import {
  DailyCheckInLoginModal,
  DailyCheckInSidebarCard,
} from './DailyCheckInActivity';
import { shouldShowDailyCheckInSidebar } from './dailyCheckInActivityState';
import SidebarAdBanner from './SidebarAdBanner';
import { useDailyCheckInActivity } from './useDailyCheckInActivity';

interface SidebarExperienceSlotProps {
  hidden?: boolean;
  onVisibleChange?: (visible: boolean) => void;
}

const SIDEBAR_DISMISS_KEY_PREFIX = 'daily_check_in_sidebar_session_dismissed';
const CLAIM_SUCCESS_DURATION_MS = 1200;

const getSidebarDismissKey = (
  activityCode: string,
  configRevision: number,
): string => (
  `${SIDEBAR_DISMISS_KEY_PREFIX}.${activityCode}.${configRevision}`
);

const SidebarExperienceSlot: React.FC<SidebarExperienceSlotProps> = ({
  hidden = false,
  onVisibleChange,
}) => {
  const isLoggedIn = useSelector((state: RootState) => state.auth.isLoggedIn);
  const {
    snapshot,
    loading,
    claiming,
    claim,
  } = useDailyCheckInActivity();
  const [dismissed, setDismissed] = useState(false);
  const [loginModalOpen, setLoginModalOpen] = useState(false);
  const [successCredits, setSuccessCredits] = useState<number | null>(null);
  const successTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const dismissKey = snapshot
    ? getSidebarDismissKey(
      snapshot.descriptor.activityCode,
      snapshot.descriptor.configRevision,
    )
    : null;

  useEffect(() => () => {
    if (successTimerRef.current) clearTimeout(successTimerRef.current);
  }, []);

  useEffect(() => {
    if (hidden || isLoggedIn) setLoginModalOpen(false);
  }, [hidden, isLoggedIn]);

  useLayoutEffect(() => {
    setDismissed(dismissKey
      ? sessionStorage.getItem(dismissKey) === '1'
      : false);
    setSuccessCredits(null);
  }, [dismissKey]);

  const stateAllowsSidebar = snapshot
    ? shouldShowDailyCheckInSidebar(snapshot.context)
    : false;
  const displayed = Boolean(
    snapshot
      && !hidden
      && !dismissed
      && (stateAllowsSidebar || successCredits !== null),
  );

  useLayoutEffect(() => {
    if (!snapshot) return undefined;
    onVisibleChange?.(displayed);
    return () => onVisibleChange?.(false);
  }, [displayed, onVisibleChange, snapshot]);

  const dismissEntry = useCallback(() => {
    if (!dismissKey) return;
    sessionStorage.setItem(dismissKey, '1');
    setLoginModalOpen(false);
    setDismissed(true);
  }, [dismissKey]);

  const handleClaim = useCallback(async () => {
    if (!snapshot) return;
    if (!isLoggedIn || !snapshot.context.authenticated) {
      setLoginModalOpen(true);
      return;
    }
    try {
      const response = await claim();
      setSuccessCredits(response.result.creditsGranted);
      if (successTimerRef.current) clearTimeout(successTimerRef.current);
      successTimerRef.current = setTimeout(() => {
        setSuccessCredits(null);
        successTimerRef.current = null;
      }, CLAIM_SUCCESS_DURATION_MS);
    } catch (error) {
      window.dispatchEvent(new CustomEvent('app:showToast', {
        detail: error instanceof Error
          ? error.message
          : i18nService.t('dailyCheckInClaimFailed'),
      }));
    }
  }, [claim, isLoggedIn, snapshot]);

  if (!snapshot) {
    if (loading) return null;
    return (
      <SidebarAdBanner
        hidden={hidden}
        onVisibleChange={onVisibleChange}
      />
    );
  }

  if (dismissed || (!stateAllowsSidebar && successCredits === null)) {
    return null;
  }

  return (
    <>
      <div
        aria-hidden={hidden || undefined}
        className={`pointer-events-none absolute inset-x-0 bottom-0 z-20 pl-[18px] pr-3.5 transition-[opacity,transform] motion-reduce:transition-none ${
          hidden
            ? 'translate-y-2 opacity-0 duration-0'
            : 'translate-y-0 opacity-100 duration-200 ease-out'
        }`}
      >
        <DailyCheckInSidebarCard
          snapshot={snapshot}
          claiming={claiming}
          successCredits={successCredits}
          hidden={hidden}
          onClaim={() => void handleClaim()}
          onDismiss={dismissEntry}
        />
      </div>
      {loginModalOpen && (
        <DailyCheckInLoginModal
          descriptor={snapshot.descriptor}
          onClose={() => setLoginModalOpen(false)}
        />
      )}
    </>
  );
};

export default SidebarExperienceSlot;
