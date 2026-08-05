import {
  ChevronLeftIcon,
  ChevronRightIcon,
} from '@heroicons/react/24/outline';
import React, {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
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
import { startDailyCheckInAutoRefresh } from './dailyCheckInAutoRefresh';
import {
  type DailyCheckInDismissState,
  getActivityBusinessDate,
  getDailyCheckInDismissKey,
  isDailyCheckInDismissedForDate,
  readDailyCheckInDismissState,
  saveDailyCheckInDismissState,
} from './dailyCheckInDismissState';
import SidebarAdBanner from './SidebarAdBanner';
import {
  type ClientBanner,
  getSidebarBannerVersion,
} from './sidebarAdBannerState';
import {
  getAdjacentSidebarCarouselKey,
  resolveSidebarCarouselIndex,
  shouldShowSidebarCarouselControls,
} from './sidebarExperienceCarouselState';
import { logSidebarExperienceDiagnostic } from './sidebarExperienceDiagnostics';
import {
  type DailyCheckInSnapshot,
  useDailyCheckInActivity,
} from './useDailyCheckInActivity';
import { useSidebarAdBanners } from './useSidebarAdBanners';

interface SidebarExperienceSlotProps {
  hidden?: boolean;
  onVisibleChange?: (visible: boolean) => void;
}

interface ActivityExperienceItem {
  kind: 'activity';
  key: string;
  snapshot: DailyCheckInSnapshot;
}

interface BannerExperienceItem {
  kind: 'banner';
  key: string;
  banner: ClientBanner;
}

type SidebarExperienceItem = ActivityExperienceItem | BannerExperienceItem;

interface LoadedActivityDismissState {
  key: string;
  state: DailyCheckInDismissState | null;
}

const CLAIM_SUCCESS_DURATION_MS = 1200;
const SIDEBAR_BANNER_ROTATION_MS = 5000;

const SidebarExperienceSlot: React.FC<SidebarExperienceSlotProps> = ({
  hidden = false,
  onVisibleChange,
}) => {
  const isLoggedIn = useSelector((state: RootState) => state.auth.isLoggedIn);
  const {
    snapshot,
    loading: activityLoading,
    claiming,
    refresh: refreshActivity,
    claim,
  } = useDailyCheckInActivity();
  const {
    visibleBanners,
    loading: bannersLoading,
    refresh: refreshBanners,
    dismissGroup: dismissBannerGroup,
  } = useSidebarAdBanners();
  const [activityDismissState, setActivityDismissState] = useState<
    LoadedActivityDismissState | null
  >(null);
  const [activeItemKey, setActiveItemKey] = useState<string | null>(null);
  const [loginModalOpen, setLoginModalOpen] = useState(false);
  const [successCredits, setSuccessCredits] = useState<number | null>(null);
  const successTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const previousActivityItemKeyRef = useRef<string | null>(null);

  const activityDismissKey = snapshot
    ? getDailyCheckInDismissKey(
      snapshot.descriptor.activityCode,
      snapshot.descriptor.configRevision,
    )
    : null;
  const activityBusinessDate = snapshot
    ? getActivityBusinessDate(
      snapshot.context.serverTime,
      snapshot.context.state.timezone,
    )
    : null;

  useEffect(() => () => {
    if (successTimerRef.current) clearTimeout(successTimerRef.current);
  }, []);

  useEffect(() => {
    if (!activityDismissKey) {
      setActivityDismissState(null);
      return undefined;
    }
    let isCurrent = true;
    void readDailyCheckInDismissState(activityDismissKey)
      .then(state => {
        if (isCurrent) {
          setActivityDismissState({
            key: activityDismissKey,
            state,
          });
        }
      })
      .catch(error => {
        if (!isCurrent) return;
        // Storage failure should not leave the entire experience slot loading forever.
        setActivityDismissState({
          key: activityDismissKey,
          state: null,
        });
        logSidebarExperienceDiagnostic(
          'warn',
          'failed to read daily check-in dismiss state; continuing without dismissal',
          error,
        );
      });
    return () => {
      isCurrent = false;
    };
  }, [activityDismissKey]);

  const activityDismissStateLoaded = !activityDismissKey
    || activityDismissState?.key === activityDismissKey;
  const activityDismissed = activityDismissStateLoaded
    && isDailyCheckInDismissedForDate(
      activityDismissState?.state ?? null,
      activityBusinessDate,
    );
  const stateAllowsSidebar = snapshot
    ? shouldShowDailyCheckInSidebar(snapshot.context)
    : false;
  const activityCanDisplay = Boolean(
    snapshot
      && activityDismissStateLoaded
      && !activityDismissed
      && (stateAllowsSidebar || successCredits !== null),
  );

  const activityItem = useMemo<ActivityExperienceItem | null>(() => (
    snapshot && activityCanDisplay
      ? {
        kind: 'activity',
        key: `activity:${snapshot.descriptor.activityCode}:${
          snapshot.descriptor.configRevision
        }`,
        snapshot,
      }
      : null
  ), [activityCanDisplay, snapshot]);
  const bannerItems = useMemo<BannerExperienceItem[]>(
    () => visibleBanners.map(banner => ({
      kind: 'banner',
      key: `banner:${getSidebarBannerVersion(banner)}`,
      banner,
    })),
    [visibleBanners],
  );
  const items = useMemo<SidebarExperienceItem[]>(
    () => activityItem ? [activityItem, ...bannerItems] : bannerItems,
    [activityItem, bannerItems],
  );
  const itemKeys = useMemo(
    () => items.map(item => item.key),
    [items],
  );
  const activeIndex = resolveSidebarCarouselIndex(itemKeys, activeItemKey);
  const activeItem = activeIndex >= 0 ? items[activeIndex] : null;
  const resolvedActiveItemKey = activeItem?.key ?? null;
  const showCarouselControls = shouldShowSidebarCarouselControls(items.length);
  const initialLoading = activityLoading
    || bannersLoading
    || Boolean(snapshot && !activityDismissStateLoaded);
  const displayed = Boolean(!hidden && !initialLoading && activeItem);

  useEffect(() => {
    setActiveItemKey(currentKey => (
      currentKey === resolvedActiveItemKey
        ? currentKey
        : resolvedActiveItemKey
    ));
  }, [resolvedActiveItemKey]);

  useEffect(() => {
    const nextActivityItemKey = activityItem?.key ?? null;
    if (nextActivityItemKey && !previousActivityItemKeyRef.current) {
      setActiveItemKey(nextActivityItemKey);
    }
    previousActivityItemKeyRef.current = nextActivityItemKey;
  }, [activityItem?.key]);

  useEffect(() => {
    if (hidden || isLoggedIn || !activityItem) setLoginModalOpen(false);
  }, [activityItem, hidden, isLoggedIn]);

  useLayoutEffect(() => {
    onVisibleChange?.(displayed);
    return () => onVisibleChange?.(false);
  }, [displayed, onVisibleChange]);

  const refreshExperiences = useCallback(async (): Promise<void> => {
    await Promise.allSettled([
      refreshActivity(),
      refreshBanners(),
    ]);
  }, [refreshActivity, refreshBanners]);

  useEffect(
    () => startDailyCheckInAutoRefresh(refreshExperiences),
    [refreshExperiences],
  );

  const changeActiveItem = useCallback((offset: number) => {
    setActiveItemKey(currentKey => getAdjacentSidebarCarouselKey(
      itemKeys,
      currentKey,
      offset,
    ));
  }, [itemKeys]);

  useEffect(() => {
    if (hidden || activityItem || bannerItems.length <= 1) return undefined;
    const timer = window.setInterval(() => {
      changeActiveItem(1);
    }, SIDEBAR_BANNER_ROTATION_MS);
    return () => window.clearInterval(timer);
  }, [
    activityItem,
    bannerItems.length,
    changeActiveItem,
    hidden,
  ]);

  const dismissActivity = useCallback(() => {
    if (!activityDismissKey || !activityBusinessDate) return;
    const dismissedAt = Date.now();
    const nextState = {
      businessDate: activityBusinessDate,
      dismissedAt,
    };
    setActivityDismissState({
      key: activityDismissKey,
      state: nextState,
    });
    setLoginModalOpen(false);
    void saveDailyCheckInDismissState(
      activityDismissKey,
      activityBusinessDate,
      dismissedAt,
    ).catch(error => {
      logSidebarExperienceDiagnostic(
        'warn',
        'failed to persist daily check-in dismiss state',
        error,
      );
    });
  }, [activityBusinessDate, activityDismissKey]);

  const handleClaim = useCallback(async () => {
    if (!snapshot) return;
    if (!isLoggedIn || !snapshot.context.authenticated) {
      setLoginModalOpen(true);
      return;
    }
    try {
      const response = await claim();
      logSidebarExperienceDiagnostic(
        'info',
        `daily check-in claimed; creditsGranted=${response.result.creditsGranted}`,
      );
      setSuccessCredits(response.result.creditsGranted);
      if (successTimerRef.current) clearTimeout(successTimerRef.current);
      successTimerRef.current = setTimeout(() => {
        setSuccessCredits(null);
        successTimerRef.current = null;
      }, CLAIM_SUCCESS_DURATION_MS);
    } catch (error) {
      logSidebarExperienceDiagnostic('warn', 'daily check-in claim failed', error);
      window.dispatchEvent(new CustomEvent('app:showToast', {
        detail: error instanceof Error
          ? error.message
          : i18nService.t('dailyCheckInClaimFailed'),
      }));
    }
  }, [claim, isLoggedIn, snapshot]);

  if (initialLoading || !activeItem) return null;

  return (
    <>
      <div
        aria-hidden={hidden || undefined}
        className={`pointer-events-none absolute inset-x-0 bottom-0 z-40 pl-[18px] pr-3.5 transition-[opacity,transform] motion-reduce:transition-none ${
          hidden
            ? 'translate-y-2 opacity-0 duration-0'
            : 'translate-y-0 opacity-100 duration-200 ease-out'
        }`}
      >
        <div className="relative">
          {activeItem.kind === 'activity' ? (
            <DailyCheckInSidebarCard
              snapshot={activeItem.snapshot}
              claiming={claiming}
              successCredits={successCredits}
              hidden={hidden}
              onClaim={() => void handleClaim()}
              onDismiss={dismissActivity}
            />
          ) : (
            <SidebarAdBanner
              banner={activeItem.banner}
              hidden={hidden}
              onDismiss={() => void dismissBannerGroup()}
            />
          )}
          {showCarouselControls && (
            <>
              <button
                type="button"
                tabIndex={hidden ? -1 : 0}
                aria-label={i18nService.t('sidebarCarouselPrevious')}
                onClick={() => changeActiveItem(-1)}
                className={`${hidden ? 'pointer-events-none' : 'pointer-events-auto'} absolute -left-2.5 top-1/2 z-30 flex h-5 w-5 -translate-y-1/2 items-center justify-center rounded-full bg-black/45 text-white shadow-sm transition-colors hover:bg-black/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/80`}
              >
                <ChevronLeftIcon className="h-3.5 w-3.5" />
              </button>
              <button
                type="button"
                tabIndex={hidden ? -1 : 0}
                aria-label={i18nService.t('sidebarCarouselNext')}
                onClick={() => changeActiveItem(1)}
                className={`${hidden ? 'pointer-events-none' : 'pointer-events-auto'} absolute -right-2.5 top-1/2 z-30 flex h-5 w-5 -translate-y-1/2 items-center justify-center rounded-full bg-black/45 text-white shadow-sm transition-colors hover:bg-black/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/80`}
              >
                <ChevronRightIcon className="h-3.5 w-3.5" />
              </button>
            </>
          )}
        </div>
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

export default SidebarExperienceSlot;
