import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';

import {
  type ClientBanner,
  createSidebarBannerDismissState,
  readSidebarBannerDismissState,
  saveSidebarBannerDismissState,
  shouldShowSidebarBanners,
  type SidebarBannerDismissState,
} from './sidebarAdBannerState';
import { logSidebarExperienceDiagnostic } from './sidebarExperienceDiagnostics';

interface SidebarBannerLoadOptions {
  silent?: boolean;
}

export interface UseSidebarAdBannersResult {
  visibleBanners: ClientBanner[];
  loading: boolean;
  refresh: () => Promise<void>;
  dismissGroup: () => Promise<void>;
}

export const useSidebarAdBanners = (): UseSidebarAdBannersResult => {
  const [banners, setBanners] = useState<ClientBanner[]>([]);
  const [dismissState, setDismissState] = useState<
    SidebarBannerDismissState | null
  >(null);
  const [loading, setLoading] = useState(true);
  const loadRequestIdRef = useRef(0);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      loadRequestIdRef.current += 1;
    };
  }, []);

  const load = useCallback(async ({
    silent = false,
  }: SidebarBannerLoadOptions = {}): Promise<void> => {
    const requestId = ++loadRequestIdRef.current;
    const isCurrentRequest = () => (
      mountedRef.current && loadRequestIdRef.current === requestId
    );
    if (isCurrentRequest() && !silent) setLoading(true);

    try {
      const result = await window.electron.auth.getActiveClientBanners();
      if (!isCurrentRequest()) return;
      if (!result.success || !Array.isArray(result.data)) {
        if (!silent) {
          setBanners([]);
          setDismissState(null);
        }
        return;
      }

      const nextBanners = result.data as ClientBanner[];
      const nextDismissState = await readSidebarBannerDismissState(nextBanners);
      if (!isCurrentRequest()) return;
      setBanners(nextBanners);
      setDismissState(nextDismissState);
    } catch (error) {
      if (isCurrentRequest()) {
        logSidebarExperienceDiagnostic('warn', 'failed to load sidebar banners', error);
        if (!silent) {
          setBanners([]);
          setDismissState(null);
        }
      }
    } finally {
      if (isCurrentRequest()) setLoading(false);
    }
  }, []);

  const refresh = useCallback(
    () => load({ silent: true }),
    [load],
  );

  useEffect(() => {
    void load();
  }, [load]);

  const dismissGroup = useCallback(async (): Promise<void> => {
    if (banners.length === 0) return;
    loadRequestIdRef.current += 1;
    const nextState = createSidebarBannerDismissState(
      banners,
      dismissState,
    );
    setDismissState(nextState);
    try {
      await saveSidebarBannerDismissState(nextState);
    } catch (error) {
      logSidebarExperienceDiagnostic('warn', 'failed to persist sidebar banner dismiss state', error);
    }
  }, [banners, dismissState]);

  const visibleBanners = useMemo(
    () => (
      shouldShowSidebarBanners(banners, dismissState)
        ? banners
        : []
    ),
    [banners, dismissState],
  );

  return {
    visibleBanners,
    loading,
    refresh,
    dismissGroup,
  };
};
