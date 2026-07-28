import { XMarkIcon } from '@heroicons/react/24/outline';
import type {
  ActivityBounds,
  ActivityDescriptor,
} from '@shared/activity/constants';
import {
  ActivityPlacement,
  ActivitySlotState,
} from '@shared/activity/constants';
import React, {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { createPortal } from 'react-dom';
import { useSelector } from 'react-redux';

import { i18nService } from '../services/i18n';
import type { RootState } from '../store';
import {
  resolveActivityEntryModel,
  resolveActivityModalDimensions,
  resolveActivityModalTitle,
} from './activityExperienceState';
import SidebarAdBanner from './SidebarAdBanner';

interface SidebarExperienceSlotProps {
  hidden?: boolean;
  onVisibleChange?: (visible: boolean) => void;
}

interface ActivityModalProps {
  descriptor: ActivityDescriptor;
  onRequestClose: () => void;
}

const toActivityBounds = (element: HTMLElement): ActivityBounds => {
  const rect = element.getBoundingClientRect();
  return {
    x: Math.round(rect.left),
    y: Math.round(rect.top),
    width: Math.round(rect.width),
    height: Math.round(rect.height),
  };
};

const ActivityModal: React.FC<ActivityModalProps> = ({
  descriptor,
  onRequestClose,
}) => {
  const contentRef = useRef<HTMLDivElement>(null);
  const openedRef = useRef(false);
  const [attempt, setAttempt] = useState(0);
  const [phase, setPhase] = useState<'opening' | 'open' | 'error'>('opening');
  const dimensions = resolveActivityModalDimensions(descriptor.sizePreset);
  const title = resolveActivityModalTitle(descriptor)
    || i18nService.t('activityDefaultTitle');

  useEffect(() => window.electron.activity.onClosed((event) => {
    if (event.activityCode === descriptor.activityCode
        && event.configRevision === descriptor.configRevision) {
      onRequestClose();
    }
  }), [
    descriptor.activityCode,
    descriptor.configRevision,
    onRequestClose,
  ]);

  useLayoutEffect(() => {
    let cancelled = false;
    let resizeObserver: ResizeObserver | null = null;
    let frameId = 0;
    openedRef.current = false;
    setPhase('opening');

    const syncBounds = () => {
      if (!openedRef.current || !contentRef.current) return;
      void window.electron.activity.setBounds(
        toActivityBounds(contentRef.current),
      ).then((result) => {
        if (!result.success) {
          console.warn('[Activity] failed to update view bounds:', result.error);
        }
      });
    };

    const open = async () => {
      if (!contentRef.current || cancelled) return;
      const result = await window.electron.activity.open({
        activityCode: descriptor.activityCode,
        configRevision: descriptor.configRevision,
        placement: ActivityPlacement.DesktopSidebar,
        bounds: toActivityBounds(contentRef.current),
      });
      if (cancelled) return;
      if (!result.success) {
        console.warn('[Activity] failed to open remote H5:', result.error);
        setPhase('error');
        return;
      }
      openedRef.current = true;
      setPhase('open');
      syncBounds();
      if (contentRef.current) {
        resizeObserver = new ResizeObserver(syncBounds);
        resizeObserver.observe(contentRef.current);
      }
      window.addEventListener('resize', syncBounds);
    };

    frameId = window.requestAnimationFrame(() => {
      frameId = window.requestAnimationFrame(() => void open());
    });

    return () => {
      cancelled = true;
      openedRef.current = false;
      window.cancelAnimationFrame(frameId);
      resizeObserver?.disconnect();
      window.removeEventListener('resize', syncBounds);
      void window.electron.activity.close();
    };
  }, [
    attempt,
    descriptor.activityCode,
    descriptor.configRevision,
  ]);

  return createPortal(
    <div
      className="non-draggable fixed inset-0 z-[100] flex items-center justify-center bg-black/35 p-6 backdrop-blur-[1px]"
      role="dialog"
      aria-modal="true"
      aria-label={title}
    >
      <button
        type="button"
        className="absolute inset-0 cursor-default"
        aria-label={i18nService.t('close')}
        onClick={onRequestClose}
      />
      <section
        className="relative z-10 flex max-h-[calc(100vh-32px)] overflow-hidden rounded-2xl border border-black/10 bg-white shadow-2xl dark:border-white/10 dark:bg-[#202124]"
        style={{
          width: `min(${dimensions.width}px, calc(100vw - 48px))`,
          height: `min(${dimensions.height + 48}px, calc(100vh - 32px))`,
        }}
      >
        <div className="flex min-h-0 w-full flex-col">
          <header className="flex h-12 shrink-0 items-center justify-between border-b border-black/5 px-4 dark:border-white/10">
            <h2 className="min-w-0 truncate pr-3 text-sm font-medium text-foreground">
              {title}
            </h2>
            <button
              type="button"
              className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-secondary transition-colors hover:bg-black/5 hover:text-foreground dark:hover:bg-white/10"
              aria-label={i18nService.t('close')}
              onClick={onRequestClose}
            >
              <XMarkIcon className="h-4 w-4" />
            </button>
          </header>
          <div
            ref={contentRef}
            className="relative min-h-[240px] min-w-[320px] flex-1 overflow-hidden bg-[#FFF9F4]"
          >
            {phase === 'opening' && (
              <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 text-secondary">
                <div className="h-6 w-6 animate-spin rounded-full border-2 border-black/10 border-t-primary dark:border-white/10" />
                <span className="text-sm">{i18nService.t('activityLoading')}</span>
              </div>
            )}
            {phase === 'error' && (
              <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 px-8 text-center">
                <p className="text-sm font-medium text-foreground">
                  {i18nService.t('activityLoadFailed')}
                </p>
                <button
                  type="button"
                  className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-white transition-opacity hover:opacity-90"
                  onClick={() => setAttempt(value => value + 1)}
                >
                  {i18nService.t('retry')}
                </button>
              </div>
            )}
          </div>
        </div>
      </section>
    </div>,
    document.body,
  );
};

const SidebarExperienceSlot: React.FC<SidebarExperienceSlotProps> = ({
  hidden = false,
  onVisibleChange,
}) => {
  const authIdentity = useSelector(
    (state: RootState) => state.auth.user?.yid ?? null,
  );
  const [descriptor, setDescriptor] = useState<ActivityDescriptor | null>(null);
  const [openedDescriptor, setOpenedDescriptor] = useState<ActivityDescriptor | null>(null);

  useEffect(() => {
    let current = true;
    const load = async () => {
      try {
        const result = await window.electron.activity.getSlot({
          placement: ActivityPlacement.DesktopSidebar,
        });
        if (!current) return;
        if (result.success
            && result.data.slotState === ActivitySlotState.Available
            && result.data.activity) {
          setDescriptor(result.data.activity);
          return;
        }
      } catch (error) {
        console.warn('[Activity] failed to load experience slot:', error);
      }
      if (current) setDescriptor(null);
    };
    void load();
    return () => {
      current = false;
    };
  }, [authIdentity]);

  useEffect(() => {
    if (hidden) setOpenedDescriptor(null);
  }, [hidden]);

  const entry = useMemo(
    () => descriptor ? resolveActivityEntryModel(descriptor) : null,
    [descriptor],
  );
  const usesDynamicActivity = Boolean(descriptor && entry);
  const displayed = usesDynamicActivity && !hidden;

  useLayoutEffect(() => {
    if (!usesDynamicActivity) return undefined;
    onVisibleChange?.(displayed);
    return () => onVisibleChange?.(false);
  }, [displayed, onVisibleChange, usesDynamicActivity]);

  const closeModal = useCallback(() => setOpenedDescriptor(null), []);

  if (!descriptor || !entry) {
    return (
      <SidebarAdBanner
        hidden={hidden}
        onVisibleChange={onVisibleChange}
      />
    );
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
        <button
          type="button"
          tabIndex={hidden ? -1 : 0}
          onClick={() => setOpenedDescriptor(descriptor)}
          className={`${hidden ? 'pointer-events-none' : 'pointer-events-auto'} group relative flex min-h-[84px] w-full overflow-hidden rounded-xl border border-black/[0.05] px-3 py-2.5 text-left shadow-[0_5px_14px_rgba(44,35,28,0.12)] transition-transform hover:-translate-y-0.5 dark:border-white/10`}
          style={{
            background: `linear-gradient(115deg, color-mix(in srgb, ${entry.accentColor} 16%, white), color-mix(in srgb, ${entry.accentColor} 5%, white))`,
          }}
          aria-label={entry.title}
        >
          <span className="relative z-10 flex min-w-0 flex-1 flex-col justify-center pr-2">
            {entry.badgeText && (
              <span
                className="mb-1 w-fit rounded-full px-2 py-0.5 text-[10px] font-semibold text-white"
                style={{ backgroundColor: entry.accentColor }}
              >
                {entry.badgeText}
              </span>
            )}
            <span className="truncate text-sm font-semibold text-[#2C211B]">
              {entry.title}
            </span>
            {entry.description && (
              <span className="mt-0.5 line-clamp-2 text-[11px] leading-4 text-[#745E52]">
                {entry.description}
              </span>
            )}
            <span
              className="mt-1 text-[11px] font-medium"
              style={{ color: entry.accentColor }}
            >
              {entry.ctaText ?? i18nService.t('activityViewNow')}
              <span aria-hidden="true"> →</span>
            </span>
          </span>
          {entry.imageUrl && (
            <img
              src={entry.imageUrl}
              alt=""
              aria-hidden="true"
              className="h-16 w-16 shrink-0 self-center object-contain"
            />
          )}
        </button>
      </div>
      {openedDescriptor && (
        <ActivityModal
          descriptor={openedDescriptor}
          onRequestClose={closeModal}
        />
      )}
    </>
  );
};

export default SidebarExperienceSlot;
