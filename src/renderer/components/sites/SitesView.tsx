import {
  ArrowLeftIcon,
  ArrowPathIcon,
  ArrowTopRightOnSquareIcon,
  ArrowUpTrayIcon,
  ChartBarIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  ClipboardDocumentIcon,
  GlobeAltIcon,
  LockClosedIcon,
  MagnifyingGlassIcon,
  PlusIcon,
  TrashIcon,
  XMarkIcon,
} from '@heroicons/react/24/outline';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { HtmlShareAccessMode, HtmlShareStatus } from '../../../shared/htmlShare/constants';
import {
  SiteAction,
  type SiteAnalytics,
  type SiteDetail,
  SiteErrorCode,
  SiteFilterStatus,
  type SiteFilterStatus as SiteFilterStatusValue,
  SiteKind,
  type SiteListData,
  type SiteListItem,
  SiteStatus,
  type SiteStatus as SiteStatusValue,
} from '../../../shared/site/constants';
import { copyTextToClipboard } from '../../services/clipboard';
import { i18nService } from '../../services/i18n';
import Modal from '../common/Modal';
import Cog6ToothIcon from '../icons/Cog6ToothIcon';
import EllipsisHorizontalIcon from '../icons/EllipsisHorizontalIcon';
import SidebarToggleIcon from '../icons/SidebarToggleIcon';
import SiteAnalyticsChart from './SiteAnalyticsChart';
import SiteDefaultIcon from './SiteDefaultIcon';

interface SitesViewProps {
  isAuthenticated: boolean;
  onCreateSiteByChat: (prompt: string) => void;
  isSidebarCollapsed: boolean;
  onToggleSidebar: () => void;
  updateBadge?: React.ReactNode;
  readOnly?: boolean;
}

type DetailTab = 'analytics' | 'settings';
type ConfirmAction = 'stop' | 'resume' | null;
type AnalyticsRange = 7 | 30;

interface SiteActionMenuState {
  site: SiteListItem;
  top: number;
  right: number;
}

const PAGE_SIZE = 10;
const DEPLOYING_STATUSES = new Set(['queued', 'building', 'deploying', 'health_checking']);

const statusTheme: Record<SiteStatusValue, string> = {
  [SiteStatus.Online]: 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-300',
  [SiteStatus.Deploying]: 'bg-primary/10 text-primary',
  [SiteStatus.AccessStopped]: 'bg-slate-500/10 text-secondary',
  [SiteStatus.RedeployRequired]: 'bg-amber-500/10 text-amber-700 dark:text-amber-300',
  [SiteStatus.Blocked]: 'bg-red-500/10 text-red-700 dark:text-red-300',
  [SiteStatus.Failed]: 'bg-red-500/10 text-red-700 dark:text-red-300',
};

const formatDateTime = (value?: string | null): string => {
  if (!value) return i18nService.t('sitesNever');
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat(i18nService.getLanguage() === 'zh' ? 'zh-CN' : 'en-US', {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date);
};

const toLocalDateValue = (date: Date): string => {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};

const analyticsDateValues = (range: AnalyticsRange): { from: string; to: string } => {
  const to = new Date();
  const from = new Date();
  from.setDate(from.getDate() - (range - 1));
  return { from: toLocalDateValue(from), to: toLocalDateValue(to) };
};

const formatAnalyticsDate = (value: string): string => {
  const date = new Date(`${value}T00:00:00`);
  return new Intl.DateTimeFormat(i18nService.getLanguage() === 'zh' ? 'zh-CN' : 'en-US', {
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
  }).format(date);
};

const SiteStatusBadge: React.FC<{ status: SiteStatusValue }> = ({ status }) => (
  <span
    className={`inline-flex shrink-0 items-center gap-1 whitespace-nowrap rounded-full px-2 py-0.5 text-[11px] font-medium ${statusTheme[status]}`}
  >
    {status === SiteStatus.Online && <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />}
    {status === SiteStatus.Deploying && <ArrowPathIcon className="h-3 w-3 animate-spin" />}
    {i18nService.t(`sitesStatus_${status}`)}
  </span>
);

const SitesTopBar: React.FC<{
  isSidebarCollapsed: boolean;
  onToggleSidebar: () => void;
  updateBadge?: React.ReactNode;
}> = ({ isSidebarCollapsed, onToggleSidebar, updateBadge }) => {
  const isMac = window.electron.platform === 'darwin';
  const isWindows = window.electron.platform === 'win32';

  return (
    <div className="draggable flex h-12 shrink-0 items-center border-b border-border px-4">
      <div className="flex h-8 items-center gap-3">
        {isSidebarCollapsed && !isWindows && (
          <div className={`non-draggable flex items-center gap-1 ${isMac ? 'pl-[68px]' : ''}`}>
            <button
              type="button"
              onClick={onToggleSidebar}
              className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-secondary transition-colors hover:bg-surface-raised"
            >
              <SidebarToggleIcon className="h-4 w-4" isCollapsed />
            </button>
            {updateBadge}
          </div>
        )}
        <h1 className="text-lg font-semibold text-foreground">{i18nService.t('sitesTitle')}</h1>
      </div>
    </div>
  );
};

const EmptyState: React.FC<{
  onCreateSiteByChat: (prompt: string) => void;
  readOnly: boolean;
}> = ({ onCreateSiteByChat, readOnly }) => {
  const templates = [
    ['sitesTemplateResume', 'sitesTemplateResumeDescription', 'sitesTemplateResumePrompt'],
    ['sitesTemplateShop', 'sitesTemplateShopDescription', 'sitesTemplateShopPrompt'],
    ['sitesTemplateEvent', 'sitesTemplateEventDescription', 'sitesTemplateEventPrompt'],
    ['sitesTemplateSurvey', 'sitesTemplateSurveyDescription', 'sitesTemplateSurveyPrompt'],
  ];
  return (
    <div className="mx-auto mt-12 max-w-3xl rounded-xl border border-border bg-surface p-7 text-center">
      <div className="mx-auto flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10 text-primary">
        <GlobeAltIcon className="h-5 w-5" />
      </div>
      <h2 className="mt-3 text-sm font-semibold text-foreground">
        {i18nService.t('sitesEmptyTitle')}
      </h2>
      <div className="mt-5 text-left">
        <p className="mb-2 text-xs font-semibold text-foreground">
          {i18nService.t('sitesCreateFromTemplate')}
        </p>
        <div className="grid grid-cols-2 gap-2">
          {templates.map(([title, description, prompt]) => (
            <button
              key={title}
              type="button"
              disabled={readOnly}
              onClick={() => onCreateSiteByChat(i18nService.t(prompt))}
              className="rounded-lg border border-border bg-background px-3.5 py-2.5 text-left transition-colors hover:border-primary/50 hover:bg-primary/5 disabled:cursor-not-allowed disabled:opacity-50"
            >
              <span className="block text-sm font-medium text-foreground">
                {i18nService.t(title)}
              </span>
              <span className="mt-0.5 block text-xs leading-5 text-secondary">
                {i18nService.t(description)}
              </span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
};

const SitesView: React.FC<SitesViewProps> = ({
  isAuthenticated,
  onCreateSiteByChat,
  isSidebarCollapsed,
  onToggleSidebar,
  updateBadge,
  readOnly = false,
}) => {
  const [keywordInput, setKeywordInput] = useState('');
  const [keyword, setKeyword] = useState('');
  const [statusFilter, setStatusFilter] = useState<SiteFilterStatusValue | undefined>();
  const [page, setPage] = useState(1);
  const [listData, setListData] = useState<SiteListData>({
    list: [],
    total: 0,
    page: 1,
    pageSize: PAGE_SIZE,
  });
  const [listLoading, setListLoading] = useState(false);
  const [listError, setListError] = useState<string | null>(null);
  const [selectedSite, setSelectedSite] = useState<SiteDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailTab, setDetailTab] = useState<DetailTab>('analytics');
  const [analytics, setAnalytics] = useState<SiteAnalytics | null>(null);
  const [analyticsRange, setAnalyticsRange] = useState<AnalyticsRange>(7);
  const [analyticsLoading, setAnalyticsLoading] = useState(false);
  const [actionLoading, setActionLoading] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [confirmAction, setConfirmAction] = useState<ConfirmAction>(null);
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  const [deleteConfirmText, setDeleteConfirmText] = useState('');
  const [leaveConfirmOpen, setLeaveConfirmOpen] = useState(false);
  const [siteActionMenu, setSiteActionMenu] = useState<SiteActionMenuState | null>(null);
  const [shareSite, setShareSite] = useState<SiteListItem | null>(null);
  const [shareSiteDetail, setShareSiteDetail] = useState<SiteDetail | null>(null);
  const [shareAccessModeDraft, setShareAccessModeDraft] = useState<HtmlShareAccessMode>(
    HtmlShareAccessMode.Public,
  );
  const [shareDialogLoading, setShareDialogLoading] = useState(false);
  const [shareActionLoading, setShareActionLoading] = useState(false);
  const [shareError, setShareError] = useState<string | null>(null);
  const [shareLinkCopied, setShareLinkCopied] = useState(false);
  const [titleDraft, setTitleDraft] = useState('');
  const [accessModeDraft, setAccessModeDraft] = useState<HtmlShareAccessMode>(
    HtmlShareAccessMode.Public,
  );
  const listRequestRef = useRef(0);
  const detailRequestRef = useRef(0);
  const analyticsRequestRef = useRef(0);
  const shareRequestRef = useRef(0);
  const siteActionMenuRef = useRef<HTMLDivElement>(null);
  const requestedAnalyticsDates = useMemo(
    () => analyticsDateValues(analyticsRange),
    [analyticsRange],
  );

  useEffect(() => {
    if (!siteActionMenu) return undefined;
    const closeMenu = () => setSiteActionMenu(null);
    const handlePointerDown = (event: PointerEvent) => {
      if (siteActionMenuRef.current?.contains(event.target as Node)) return;
      closeMenu();
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') closeMenu();
    };
    document.addEventListener('pointerdown', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);
    window.addEventListener('resize', closeMenu);
    window.addEventListener('scroll', closeMenu, true);
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('resize', closeMenu);
      window.removeEventListener('scroll', closeMenu, true);
    };
  }, [siteActionMenu]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setPage(1);
      setKeyword(keywordInput.trim());
    }, 250);
    return () => window.clearTimeout(timer);
  }, [keywordInput]);

  const loadSites = useCallback(
    async (background = false) => {
      if (!isAuthenticated) return;
      const requestId = ++listRequestRef.current;
      if (!background) setListLoading(true);
      setListError(null);
      const result = await window.electron.sites.list({
        page,
        pageSize: PAGE_SIZE,
        keyword: keyword || undefined,
        siteStatus: statusFilter,
      });
      if (requestId !== listRequestRef.current) return;
      if (result.success && result.data) {
        setListData(result.data);
      } else {
        setListError(result.error || i18nService.t('sitesLoadFailed'));
      }
      setListLoading(false);
    },
    [isAuthenticated, keyword, page, statusFilter],
  );

  useEffect(() => {
    void loadSites();
  }, [loadSites]);

  const hasDeployingSite = useMemo(
    () =>
      listData.list.some(
        site =>
          site.siteStatus === SiteStatus.Deploying ||
          Boolean(site.deploymentStatus && DEPLOYING_STATUSES.has(site.deploymentStatus)),
      ),
    [listData.list],
  );

  useEffect(() => {
    if (!hasDeployingSite || selectedSite) return undefined;
    const timer = window.setInterval(() => {
      if (document.visibilityState === 'visible') void loadSites(true);
    }, 5000);
    return () => window.clearInterval(timer);
  }, [hasDeployingSite, loadSites, selectedSite]);

  const openSiteDetail = useCallback(async (site: SiteListItem, tab: DetailTab = 'analytics') => {
    setSiteActionMenu(null);
    const requestId = ++detailRequestRef.current;
    setDetailLoading(true);
    setActionError(null);
    setDetailTab(tab);
    const result = await window.electron.sites.get(site.shareId);
    if (requestId !== detailRequestRef.current) return;
    if (result.success && result.data) {
      setSelectedSite(result.data);
      setTitleDraft(result.data.title);
      setAccessModeDraft(result.data.accessMode);
      setAnalytics(null);
    } else {
      setListError(result.error || i18nService.t('sitesLoadFailed'));
    }
    setDetailLoading(false);
  }, []);

  const closeShareDialog = useCallback(() => {
    shareRequestRef.current += 1;
    setShareSite(null);
    setShareSiteDetail(null);
    setShareDialogLoading(false);
    setShareActionLoading(false);
    setShareError(null);
    setShareLinkCopied(false);
  }, []);

  const openShareDialog = useCallback(async (site: SiteListItem) => {
    setSiteActionMenu(null);
    setShareSite(site);
    setShareSiteDetail(null);
    setShareAccessModeDraft(site.accessMode);
    setShareDialogLoading(true);
    setShareActionLoading(false);
    setShareError(null);
    setShareLinkCopied(false);
    const requestId = ++shareRequestRef.current;
    const result = await window.electron.sites.get(site.shareId);
    if (requestId !== shareRequestRef.current) return;
    if (result.success && result.data) {
      setShareSiteDetail(result.data);
      setShareAccessModeDraft(result.data.accessMode);
    } else {
      setShareError(result.error || i18nService.t('sitesShareLoadFailed'));
    }
    setShareDialogLoading(false);
  }, []);

  const loadAnalytics = useCallback(async () => {
    if (!selectedSite) return;
    const requestId = ++analyticsRequestRef.current;
    setAnalyticsLoading(true);
    setActionError(null);
    const analyticsDates = analyticsDateValues(analyticsRange);
    const result = await window.electron.sites.getAnalytics(selectedSite.shareId, {
      ...analyticsDates,
      limit: 10,
    });
    if (requestId !== analyticsRequestRef.current) return;
    if (result.success && result.data) {
      setAnalytics(result.data);
    } else {
      setActionError(result.error || i18nService.t('sitesAnalyticsLoadFailed'));
    }
    setAnalyticsLoading(false);
  }, [analyticsRange, selectedSite]);

  useEffect(() => {
    analyticsRequestRef.current += 1;
    setAnalytics(null);
  }, [analyticsRange]);

  useEffect(() => {
    if (detailTab === 'analytics' && selectedSite && !analytics && !analyticsLoading) {
      void loadAnalytics();
    }
  }, [analytics, analyticsLoading, detailTab, loadAnalytics, selectedSite]);

  const applyUpdatedSite = useCallback(
    (site: SiteDetail) => {
      setSelectedSite(site);
      setTitleDraft(site.title);
      setAccessModeDraft(site.accessMode);
      void loadSites(true);
    },
    [loadSites],
  );

  const saveTitle = async () => {
    if (readOnly || !selectedSite || !titleDraft.trim() || titleDraft.trim() === selectedSite.title)
      return;
    setActionLoading(true);
    setActionError(null);
    const result = await window.electron.sites.updateTitle({
      shareId: selectedSite.shareId,
      title: titleDraft.trim(),
    });
    if (result.success && result.data) applyUpdatedSite(result.data);
    else setActionError(result.error || i18nService.t('sitesUpdateFailed'));
    setActionLoading(false);
  };

  const saveAccessMode = async () => {
    if (readOnly || !selectedSite || accessModeDraft === selectedSite.accessMode) return;
    setActionLoading(true);
    setActionError(null);
    const result = await window.electron.sites.updateAccessMode({
      shareId: selectedSite.shareId,
      accessMode: accessModeDraft,
    });
    if (result.success && result.data) applyUpdatedSite(result.data);
    else setActionError(result.error || i18nService.t('sitesUpdateFailed'));
    setActionLoading(false);
  };

  const updateShareAccessMode = async () => {
    if (
      !shareSite ||
      !shareSiteDetail ||
      shareActionLoading ||
      shareAccessModeDraft === shareSiteDetail.accessMode
    )
      return;
    setShareActionLoading(true);
    setShareError(null);
    setShareLinkCopied(false);

    const result = await window.electron.sites.updateAccessMode({
      shareId: shareSite.shareId,
      accessMode: shareAccessModeDraft,
    });
    if (!result.success || !result.data) {
      setShareError(result.error || i18nService.t('sitesUpdateFailed'));
      setShareActionLoading(false);
      return;
    }
    setShareSite(result.data);
    setShareSiteDetail(result.data);
    void loadSites(true);
    setShareActionLoading(false);
  };

  const copyShareLink = async () => {
    if (!shareSite || shareActionLoading) return;
    setShareActionLoading(true);
    setShareError(null);
    setShareLinkCopied(false);

    const siteToShare = shareSiteDetail || shareSite;
    const shareCode = shareSiteDetail?.shareCode?.trim();
    if (siteToShare.accessMode === HtmlShareAccessMode.Code && !shareCode) {
      setShareError(i18nService.t('sitesShareCodeCopyUnavailable'));
      setShareActionLoading(false);
      return;
    }
    const clipboardText =
      siteToShare.accessMode === HtmlShareAccessMode.Code
        ? `${i18nService.t('htmlShareClipboardLinkLabel')}: ${siteToShare.url}\n${i18nService.t('sitesShareCode')}: ${shareCode}`
        : siteToShare.url;
    const copied = await copyTextToClipboard(clipboardText);
    if (copied) setShareLinkCopied(true);
    else setShareError(i18nService.t('copyFailed'));
    setShareActionLoading(false);
  };

  const updateAccessStatus = async () => {
    if (readOnly || !selectedSite || !confirmAction) return;
    setActionLoading(true);
    setActionError(null);
    const result = await window.electron.sites.updateAccessStatus({
      shareId: selectedSite.shareId,
      status: confirmAction === 'stop' ? HtmlShareStatus.Disabled : HtmlShareStatus.Live,
    });
    if (result.success && result.data) {
      applyUpdatedSite(result.data);
      setConfirmAction(null);
    } else {
      setActionError(result.error || i18nService.t('sitesUpdateFailed'));
    }
    setActionLoading(false);
  };

  const deleteSelectedSite = async () => {
    if (readOnly || !selectedSite || deleteConfirmText !== selectedSite.title || actionLoading)
      return;
    setActionLoading(true);
    setActionError(null);
    const result = await window.electron.sites.delete(selectedSite.shareId);
    if (result.success) {
      setDeleteConfirmOpen(false);
      setDeleteConfirmText('');
      setSelectedSite(null);
      setAnalytics(null);
      if (page === 1) void loadSites(true);
      else setPage(1);
    } else {
      setActionError(
        result.code === SiteErrorCode.DeleteRequiresStopped
          ? i18nService.t('sitesDeleteRequiresStopped')
          : result.error || i18nService.t('sitesDeleteFailed'),
      );
    }
    setActionLoading(false);
  };

  if (!isAuthenticated) {
    return (
      <div
        data-skin-management-page="true"
        className="relative z-10 flex h-full flex-col bg-background"
      >
        <SitesTopBar
          isSidebarCollapsed={isSidebarCollapsed}
          onToggleSidebar={onToggleSidebar}
          updateBadge={updateBadge}
        />
        <div className="flex flex-1 items-center justify-center p-8">
          <div className="max-w-sm text-center">
            <LockClosedIcon className="mx-auto h-10 w-10 text-secondary" />
            <h1 className="mt-4 text-xl font-semibold text-foreground">
              {i18nService.t('sitesLoginTitle')}
            </h1>
            <p className="mt-2 text-sm text-secondary">{i18nService.t('sitesLoginDescription')}</p>
          </div>
        </div>
      </div>
    );
  }

  if (selectedSite) {
    const isNode = selectedSite.siteKind === SiteKind.NodeService;
    const canStop = !readOnly && selectedSite.editableActions.includes(SiteAction.StopAccess);
    const canResume = !readOnly && selectedSite.editableActions.includes(SiteAction.ResumeAccess);
    const canDelete = !readOnly && selectedSite.editableActions.includes(SiteAction.Delete);
    const requiresResourceRelease =
      isNode && selectedSite.siteStatus === SiteStatus.Blocked && canStop;
    const hasUnsavedSettings =
      titleDraft.trim() !== selectedSite.title || accessModeDraft !== selectedSite.accessMode;
    const canVisit = selectedSite.siteStatus === SiteStatus.Online;
    const leaveSiteDetail = () => {
      if (hasUnsavedSettings) {
        setLeaveConfirmOpen(true);
        return;
      }
      setSelectedSite(null);
    };
    return (
      <div
        data-skin-management-page="true"
        className="relative z-10 flex h-full min-h-0 flex-col bg-background"
      >
        <SitesTopBar
          isSidebarCollapsed={isSidebarCollapsed}
          onToggleSidebar={onToggleSidebar}
          updateBadge={updateBadge}
        />
        <header className="flex h-[52px] shrink-0 items-center gap-2 border-b border-border px-4">
          <button
            type="button"
            onClick={leaveSiteDetail}
            className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-secondary transition-colors hover:bg-surface-raised hover:text-foreground"
            aria-label={i18nService.t('sitesBack')}
            title={i18nService.t('sitesBack')}
          >
            <ArrowLeftIcon className="h-4 w-4" />
          </button>
          <div
            className="flex min-w-0 max-w-[320px] items-center gap-2 px-1"
            title={selectedSite.url}
          >
            <h1 className="truncate text-sm font-semibold text-foreground">{selectedSite.title}</h1>
            <SiteStatusBadge status={selectedSite.siteStatus} />
          </div>
          <span className="mx-2 h-5 w-px shrink-0 bg-border" aria-hidden="true" />
          <nav
            className="flex h-full shrink-0 items-center gap-1"
            aria-label={i18nService.t('sitesTitle')}
          >
            {(['analytics', 'settings'] as DetailTab[]).map(tab => (
              <button
                key={tab}
                type="button"
                onClick={() => setDetailTab(tab)}
                className={`h-full border-b-2 px-3 text-sm transition-colors ${detailTab === tab ? 'border-primary font-medium text-foreground' : 'border-transparent text-secondary hover:text-foreground'}`}
              >
                {i18nService.t(`sitesTab_${tab}`)}
              </button>
            ))}
          </nav>
          <div className="min-w-0 flex-1" />
          <button
            type="button"
            disabled={!canVisit}
            onClick={() => void window.electron.shell.openExternal(selectedSite.url)}
            className="inline-flex h-8 shrink-0 items-center gap-1.5 rounded-lg border border-border px-2.5 text-xs font-medium text-foreground transition-colors hover:bg-surface-raised disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent"
            title={!canVisit ? i18nService.t('sitesVisitUnavailable') : undefined}
          >
            <ArrowTopRightOnSquareIcon className="h-4 w-4" />
            {i18nService.t('sitesVisit')}
          </button>
        </header>
        <main className="min-h-0 flex-1 overflow-y-auto p-6">
          {actionError && (
            <div className="mb-4 rounded-lg border border-red-500/20 bg-red-500/5 px-3 py-2 text-sm text-red-600">
              {actionError}
            </div>
          )}
          {readOnly && detailTab === 'settings' && (
            <div className="mx-auto mb-4 max-w-3xl rounded-lg border border-amber-500/20 bg-amber-500/5 px-3 py-2 text-sm text-amber-700 dark:text-amber-300">
              {i18nService.t('sitesReadOnlyNotice')}
            </div>
          )}
          {detailTab === 'analytics' && (
            <div className="mx-auto max-w-5xl space-y-3">
              <div className="flex min-h-9 items-center justify-between gap-4 px-0.5">
                <div>
                  <h2 className="text-sm font-semibold text-foreground">
                    {i18nService.t('sitesPerformance')}
                  </h2>
                  <p className="mt-1 text-xs text-secondary">
                    {formatAnalyticsDate(analytics?.meta.from ?? requestedAnalyticsDates.from)}
                    {' – '}
                    {formatAnalyticsDate(analytics?.meta.to ?? requestedAnalyticsDates.to)}
                  </p>
                </div>
                <select
                  value={analyticsRange}
                  onChange={event =>
                    setAnalyticsRange(Number(event.target.value) as AnalyticsRange)
                  }
                  className="h-8 min-w-28 rounded-lg border border-border bg-surface px-3 text-xs text-foreground outline-none transition-colors hover:bg-surface-raised focus:border-primary"
                  aria-label={i18nService.t('sitesAnalyticsDateRange')}
                >
                  <option value={7}>{i18nService.t('sitesPast7Days')}</option>
                  <option value={30}>{i18nService.t('sitesPast30Days')}</option>
                </select>
              </div>
              {analyticsLoading && !analytics ? (
                <div className="flex h-56 items-center justify-center text-sm text-secondary">
                  <ArrowPathIcon className="mr-2 h-4 w-4 animate-spin" />
                  {i18nService.t('loading')}
                </div>
              ) : (
                analytics && (
                  <>
                    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                      <div className="rounded-xl border border-border bg-surface p-4">
                        <p className="text-xs text-secondary">
                          {i18nService.t('sitesUniqueVisitors')}
                        </p>
                        <p className="mt-1.5 text-2xl font-semibold leading-none text-foreground">
                          {analytics.summary.uniqueVisitors}
                        </p>
                      </div>
                      <div className="rounded-xl border border-border bg-surface p-4">
                        <p className="text-xs text-secondary">{i18nService.t('sitesPageViews')}</p>
                        <p className="mt-1.5 text-2xl font-semibold leading-none text-foreground">
                          {analytics.summary.pageViews}
                        </p>
                      </div>
                    </div>
                    <SiteAnalyticsChart trend={analytics.trend} />
                    <section className="rounded-xl border border-border bg-surface p-4">
                      <h2 className="text-sm font-semibold text-foreground">
                        {i18nService.t('sitesPopularPages')}
                      </h2>
                      <div className="mt-2.5">
                        <div className="grid grid-cols-[minmax(0,1fr)_96px_96px] border-b border-border pb-2 text-xs text-secondary sm:grid-cols-[minmax(0,1fr)_120px_120px]">
                          <span>{i18nService.t('sitesPage')}</span>
                          <span className="text-right">{i18nService.t('sitesPageViews')}</span>
                          <span className="text-right">{i18nService.t('sitesUniqueVisitors')}</span>
                        </div>
                        {analytics.topPages.length === 0 ? (
                          <p className="py-5 text-center text-xs text-secondary">
                            {i18nService.t('sitesNoAnalyticsData')}
                          </p>
                        ) : (
                          analytics.topPages.map(item => (
                            <div
                              key={item.path}
                              className="grid grid-cols-[minmax(0,1fr)_96px_96px] border-b border-border/60 py-2.5 text-sm last:border-0 sm:grid-cols-[minmax(0,1fr)_120px_120px]"
                            >
                              <span className="truncate font-mono text-xs text-foreground">
                                {item.path}
                              </span>
                              <span className="text-right text-secondary">{item.pageViews}</span>
                              <span className="text-right text-secondary">
                                {item.uniqueVisitors}
                              </span>
                            </div>
                          ))
                        )}
                      </div>
                    </section>
                  </>
                )
              )}
            </div>
          )}
          {detailTab === 'settings' && (
            <div className="mx-auto max-w-3xl space-y-3">
              <section className="rounded-xl border border-border bg-surface p-4">
                <h2 className="text-sm font-semibold text-foreground">
                  {i18nService.t('sitesBasicInfo')}
                </h2>
                <div className="mt-4 grid grid-cols-[72px_minmax(0,1fr)_auto] items-center gap-3">
                  <label className="text-xs font-medium text-secondary">
                    {i18nService.t('sitesName')}
                  </label>
                  <input
                    value={titleDraft}
                    maxLength={100}
                    disabled={readOnly}
                    onChange={event => setTitleDraft(event.target.value)}
                    className="h-9 flex-1 rounded-lg border border-border bg-background px-3 text-sm text-foreground outline-none focus:border-primary"
                  />
                  <button
                    type="button"
                    disabled={
                      readOnly ||
                      actionLoading ||
                      !titleDraft.trim() ||
                      titleDraft.trim() === selectedSite.title
                    }
                    onClick={() => void saveTitle()}
                    className="h-9 rounded-lg bg-primary px-4 text-sm font-medium text-primary-foreground hover:bg-primary-hover disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    {i18nService.t('save')}
                  </button>
                </div>
                <div className="mt-3 grid grid-cols-[72px_minmax(0,1fr)_auto] items-center gap-3 border-t border-border pt-3">
                  <span className="text-xs font-medium text-secondary">
                    {i18nService.t('sitesUrl')}
                  </span>
                  <span
                    className="min-w-0 truncate text-sm text-foreground"
                    title={selectedSite.url}
                  >
                    {selectedSite.url}
                  </span>
                  <button
                    type="button"
                    onClick={() => void window.electron.clipboard.writeText(selectedSite.url)}
                    className="rounded-lg p-2 text-secondary hover:bg-background hover:text-foreground"
                    aria-label={i18nService.t('copy')}
                    title={i18nService.t('copy')}
                  >
                    <ClipboardDocumentIcon className="h-4 w-4" />
                  </button>
                </div>
              </section>
              <section className="rounded-xl border border-border bg-surface p-4">
                <h2 className="text-sm font-semibold text-foreground">
                  {i18nService.t('sitesAccessMode')}
                </h2>
                <p className="mt-1 text-xs text-secondary">
                  {i18nService.t('sitesAccessModeDescription')}
                </p>
                <div className="mt-3 grid grid-cols-2 gap-2">
                  {[HtmlShareAccessMode.Public, HtmlShareAccessMode.Code].map(mode => (
                    <button
                      key={mode}
                      type="button"
                      disabled={readOnly}
                      onClick={() => setAccessModeDraft(mode)}
                      className={`rounded-lg border p-3 text-left transition-colors disabled:cursor-not-allowed disabled:opacity-60 ${accessModeDraft === mode ? 'border-primary bg-primary/5' : 'border-border bg-background hover:border-primary/50'}`}
                    >
                      <span className="flex items-center gap-2 text-sm font-medium text-foreground">
                        {mode === HtmlShareAccessMode.Public ? (
                          <GlobeAltIcon className="h-4 w-4" />
                        ) : (
                          <LockClosedIcon className="h-4 w-4" />
                        )}
                        {mode === HtmlShareAccessMode.Public
                          ? i18nService.t('sitesPublicAccess')
                          : i18nService.t('sitesCodeAccess')}
                      </span>
                      <span className="mt-1 block text-xs text-secondary">
                        {mode === HtmlShareAccessMode.Public
                          ? i18nService.t('sitesPublicAccessDescription')
                          : i18nService.t('sitesCodeAccessDescription')}
                      </span>
                    </button>
                  ))}
                </div>
                {selectedSite.shareCode && accessModeDraft === HtmlShareAccessMode.Code && (
                  <div className="mt-2 flex items-center justify-between rounded-lg bg-background px-3 py-2 text-sm">
                    <span>
                      <span className="mr-2 text-xs text-secondary">
                        {i18nService.t('sitesShareCode')}
                      </span>
                      <span className="font-mono text-foreground">{selectedSite.shareCode}</span>
                    </span>
                    <button
                      type="button"
                      onClick={() =>
                        void window.electron.clipboard.writeText(selectedSite.shareCode || '')
                      }
                      className="rounded p-1 text-secondary hover:bg-surface-raised"
                      aria-label={i18nService.t('copy')}
                      title={i18nService.t('copy')}
                    >
                      <ClipboardDocumentIcon className="h-4 w-4" />
                    </button>
                  </div>
                )}
                {accessModeDraft !== selectedSite.accessMode && (
                  <div className="mt-3 flex items-center justify-between rounded-lg border border-primary/20 bg-primary/5 px-3 py-2">
                    <p className="text-xs text-secondary">{i18nService.t('sitesUnsavedChanges')}</p>
                    <div className="flex gap-2">
                      <button
                        type="button"
                        disabled={actionLoading}
                        onClick={() => setAccessModeDraft(selectedSite.accessMode)}
                        className="h-8 rounded-lg border border-border bg-surface px-3 text-xs text-foreground hover:bg-background disabled:opacity-40"
                      >
                        {i18nService.t('sitesDiscardChanges')}
                      </button>
                      <button
                        type="button"
                        disabled={readOnly || actionLoading}
                        onClick={() => void saveAccessMode()}
                        className="h-8 rounded-lg bg-primary px-3 text-xs font-medium text-primary-foreground hover:bg-primary-hover disabled:cursor-not-allowed disabled:opacity-40"
                      >
                        {actionLoading
                          ? i18nService.t('saving')
                          : i18nService.t('sitesApplyChanges')}
                      </button>
                    </div>
                  </div>
                )}
              </section>
              <section className="flex items-center justify-between gap-6 rounded-xl border border-red-500/20 bg-surface p-4">
                <div className="min-w-0">
                  <h2 className="text-sm font-semibold text-foreground">
                    {i18nService.t('sitesAccessControl')}
                  </h2>
                  <p className="mt-1 text-xs text-secondary">
                    {requiresResourceRelease
                      ? i18nService.t('sitesReleaseResourcesDescription')
                      : isNode
                      ? i18nService.t('sitesNodeStopDescription')
                      : i18nService.t('sitesStaticStopDescription')}
                  </p>
                </div>
                <div className="flex shrink-0 gap-2">
                  {canStop && (
                    <button
                      type="button"
                      onClick={() => setConfirmAction('stop')}
                      className="h-9 rounded-lg border border-red-500/40 px-3 text-sm font-medium text-red-600 hover:bg-red-500/5"
                    >
                      {i18nService.t(
                        requiresResourceRelease ? 'sitesReleaseResources' : 'sitesStopAccess',
                      )}
                    </button>
                  )}
                  {canResume && (
                    <button
                      type="button"
                      onClick={() => setConfirmAction('resume')}
                      className="h-9 rounded-lg bg-primary px-3 text-sm font-medium text-primary-foreground hover:bg-primary-hover"
                    >
                      {i18nService.t('sitesResumeAccess')}
                    </button>
                  )}
                  {!canStop && !canResume && (
                    <span className="text-sm text-secondary">
                      {i18nService.t(
                        `sitesReason_${selectedSite.statusReason || 'site_blocked_system'}`,
                      )}
                    </span>
                  )}
                </div>
              </section>
              <section className="flex items-center justify-between gap-6 rounded-xl border border-red-500/25 bg-red-500/[0.025] p-4">
                <div className="min-w-0">
                  <h2 className="text-sm font-semibold text-red-600">
                    {i18nService.t('sitesDeleteTitle')}
                  </h2>
                  <p className="mt-1 text-xs leading-5 text-secondary">
                    {canDelete
                      ? i18nService.t('sitesDeleteDescription')
                      : i18nService.t('sitesDeleteRequiresStopped')}
                  </p>
                </div>
                <button
                  type="button"
                  disabled={!canDelete || actionLoading}
                  onClick={() => {
                    setActionError(null);
                    setDeleteConfirmText('');
                    setDeleteConfirmOpen(true);
                  }}
                  className="inline-flex h-9 shrink-0 items-center gap-1.5 rounded-lg border border-red-500/40 px-3 text-sm font-medium text-red-600 transition-colors hover:bg-red-500/5 disabled:cursor-not-allowed disabled:opacity-40"
                >
                  <TrashIcon className="h-4 w-4" />
                  {i18nService.t('sitesDeleteAction')}
                </button>
              </section>
            </div>
          )}
        </main>
        <Modal
          isOpen={confirmAction !== null}
          onClose={() => !actionLoading && setConfirmAction(null)}
          className="w-[430px] rounded-2xl border border-border bg-background p-6 shadow-2xl"
        >
          <h2 className="text-base font-semibold text-foreground">
            {confirmAction === 'stop'
              ? i18nService.t(
                  requiresResourceRelease
                    ? 'sitesReleaseResourcesConfirmTitle'
                    : 'sitesStopConfirmTitle',
                )
              : i18nService.t('sitesResumeConfirmTitle')}
          </h2>
          <p className="mt-2 text-sm leading-6 text-secondary">
            {confirmAction === 'stop'
              ? requiresResourceRelease
                ? i18nService.t('sitesReleaseResourcesConfirm')
                : isNode
                ? i18nService.t('sitesNodeStopConfirm')
                : i18nService.t('sitesStaticStopConfirm')
              : i18nService.t('sitesResumeConfirm')}
          </p>
          {actionError && <p className="mt-3 text-sm text-red-600">{actionError}</p>}
          <div className="mt-6 flex justify-end gap-2">
            <button
              type="button"
              disabled={actionLoading}
              onClick={() => setConfirmAction(null)}
              className="rounded-lg border border-border px-4 py-2 text-sm text-foreground hover:bg-surface-raised"
            >
              {i18nService.t('cancel')}
            </button>
            <button
              type="button"
              disabled={actionLoading}
              onClick={() => void updateAccessStatus()}
              className={`rounded-lg px-4 py-2 text-sm font-medium ${confirmAction === 'stop' ? 'bg-red-600 text-white' : 'bg-primary text-primary-foreground hover:bg-primary-hover'}`}
            >
              {actionLoading
                ? i18nService.t('saving')
                : i18nService.t(
                    confirmAction === 'stop'
                      ? requiresResourceRelease
                        ? 'sitesConfirmReleaseResources'
                        : 'sitesConfirmStopAccess'
                      : 'sitesConfirmResumeAccess',
                  )}
            </button>
          </div>
        </Modal>
        <Modal
          isOpen={deleteConfirmOpen}
          onClose={() => {
            if (actionLoading) return;
            setDeleteConfirmOpen(false);
            setDeleteConfirmText('');
            setActionError(null);
          }}
          className="w-[460px] rounded-2xl border border-border bg-background p-6 shadow-2xl"
        >
          <div className="flex h-10 w-10 items-center justify-center rounded-full bg-red-500/10 text-red-600">
            <TrashIcon className="h-5 w-5" />
          </div>
          <h2 className="mt-4 text-base font-semibold text-foreground">
            {i18nService.t('sitesDeleteConfirmTitle')}
          </h2>
          <p className="mt-2 text-sm leading-6 text-secondary">
            {i18nService.t('sitesDeleteConfirmDescription')}
          </p>
          {isNode && selectedSite.persistence?.enabled && (
            <p className="mt-2 rounded-lg border border-red-500/20 bg-red-500/5 px-3 py-2 text-xs leading-5 text-red-700 dark:text-red-300">
              {i18nService.t('sitesDeletePersistenceWarning')}
            </p>
          )}
          <label
            className="mt-4 block text-xs font-medium text-secondary"
            htmlFor="site-delete-confirm"
          >
            {i18nService.t('sitesDeleteConfirmInputLabel').replace('{name}', selectedSite.title)}
          </label>
          <input
            id="site-delete-confirm"
            value={deleteConfirmText}
            disabled={actionLoading}
            onChange={event => setDeleteConfirmText(event.target.value)}
            autoComplete="off"
            className="mt-2 h-10 w-full rounded-lg border border-border bg-surface px-3 text-sm text-foreground outline-none transition-colors focus:border-red-500"
          />
          {actionError && <p className="mt-3 text-sm text-red-600">{actionError}</p>}
          <div className="mt-6 flex justify-end gap-2">
            <button
              type="button"
              disabled={actionLoading}
              onClick={() => {
                setDeleteConfirmOpen(false);
                setDeleteConfirmText('');
                setActionError(null);
              }}
              className="rounded-lg border border-border px-4 py-2 text-sm text-foreground hover:bg-surface-raised disabled:opacity-40"
            >
              {i18nService.t('cancel')}
            </button>
            <button
              type="button"
              disabled={actionLoading || deleteConfirmText !== selectedSite.title}
              onClick={() => void deleteSelectedSite()}
              aria-busy={actionLoading}
              className="inline-flex min-w-[104px] items-center justify-center gap-1.5 rounded-lg bg-red-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-red-700 disabled:cursor-not-allowed disabled:opacity-40"
            >
              {actionLoading ? (
                <>
                  <ArrowPathIcon className="h-4 w-4 animate-spin" />
                  {i18nService.t('sitesDeleting')}
                </>
              ) : (
                i18nService.t('sitesDeletePermanently')
              )}
            </button>
          </div>
        </Modal>
        <Modal
          isOpen={leaveConfirmOpen}
          onClose={() => setLeaveConfirmOpen(false)}
          className="w-[430px] rounded-2xl border border-border bg-background p-6 shadow-2xl"
        >
          <h2 className="text-base font-semibold text-foreground">
            {i18nService.t('sitesDiscardConfirmTitle')}
          </h2>
          <p className="mt-2 text-sm leading-6 text-secondary">
            {i18nService.t('sitesDiscardConfirmDescription')}
          </p>
          <div className="mt-6 flex justify-end gap-2">
            <button
              type="button"
              onClick={() => setLeaveConfirmOpen(false)}
              className="rounded-lg border border-border px-4 py-2 text-sm text-foreground hover:bg-surface-raised"
            >
              {i18nService.t('cancel')}
            </button>
            <button
              type="button"
              onClick={() => {
                setLeaveConfirmOpen(false);
                setSelectedSite(null);
              }}
              className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary-hover"
            >
              {i18nService.t('sitesDiscardAndLeave')}
            </button>
          </div>
        </Modal>
      </div>
    );
  }

  const totalPages = Math.max(1, Math.ceil(listData.total / PAGE_SIZE));
  const isUnfilteredEmpty = !keyword && !statusFilter && listData.total === 0;
  const shareCanChangeAccess =
    !readOnly &&
    Boolean(shareSiteDetail?.editableActions.includes(SiteAction.ChangeAccessMode));
  const shareHasAccessChange =
    Boolean(shareSiteDetail) && shareAccessModeDraft !== shareSiteDetail?.accessMode;
  const shareCommittedAccessMode = shareSiteDetail?.accessMode ?? shareSite?.accessMode;
  const shareCopyUnavailable =
    !shareHasAccessChange &&
    shareCommittedAccessMode === HtmlShareAccessMode.Code &&
    !shareSiteDetail?.shareCode;
  const createSiteButton = (compact: boolean) => (
    <button
      type="button"
      disabled={readOnly}
      onClick={() => onCreateSiteByChat(i18nService.t('sitesCreatePrompt'))}
      className={`inline-flex shrink-0 items-center rounded-lg bg-primary font-medium text-primary-foreground transition-colors hover:bg-primary-hover disabled:cursor-not-allowed disabled:opacity-40 ${compact ? 'h-8 gap-1 px-2.5 text-xs' : 'h-9 gap-1.5 px-3.5 text-sm shadow-sm'}`}
    >
      <PlusIcon className={compact ? 'h-3.5 w-3.5' : 'h-4 w-4'} />
      {i18nService.t(compact ? 'sitesCreateShort' : 'sitesCreate')}
    </button>
  );
  return (
    <div
      data-skin-management-page="true"
      className="relative z-10 flex h-full min-h-0 flex-col overflow-x-auto overflow-y-hidden bg-background"
    >
      <div className="min-w-[720px] shrink-0">
        <SitesTopBar
          isSidebarCollapsed={isSidebarCollapsed}
          onToggleSidebar={onToggleSidebar}
          updateBadge={updateBadge}
        />
      </div>
      <header className="mx-auto w-full min-w-[720px] max-w-[840px] shrink-0 px-6 py-4">
        <div className="flex items-center justify-between gap-4">
          <p className="text-sm text-secondary">{i18nService.t('sitesSubtitle')}</p>
          {isUnfilteredEmpty && createSiteButton(true)}
        </div>
        {!isUnfilteredEmpty && (
          <div className="mt-3 flex flex-nowrap items-center gap-2.5">
            <div className="relative min-w-[280px] flex-1">
              <MagnifyingGlassIcon className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-secondary" />
              <input
                value={keywordInput}
                onChange={event => setKeywordInput(event.target.value)}
                placeholder={i18nService.t('sitesSearchPlaceholder')}
                className="h-9 w-full rounded-lg border border-border bg-surface pl-9 pr-3 text-sm text-foreground outline-none placeholder:text-secondary focus:border-primary"
              />
            </div>
            <div className="flex h-9 rounded-lg border border-border bg-surface p-0.5">
              {(
                [
                  { value: undefined, key: 'sitesFilterAll' },
                  { value: SiteStatus.Online, key: 'sitesFilterOnline' },
                  { value: SiteFilterStatus.Unavailable, key: 'sitesFilterUnavailable' },
                ] as Array<{ value: SiteFilterStatusValue | undefined; key: string }>
              ).map(option => (
                <button
                  key={option.key}
                  type="button"
                  onClick={() => {
                    setPage(1);
                    setStatusFilter(option.value);
                  }}
                  aria-pressed={statusFilter === option.value}
                  className={`rounded-md px-3 text-xs ${statusFilter === option.value ? 'bg-background font-medium text-foreground shadow-sm' : 'text-secondary hover:text-foreground'}`}
                >
                  {i18nService.t(option.key)}
                </button>
              ))}
            </div>
            <button
              type="button"
              aria-label={i18nService.t('refresh')}
              onClick={() => void loadSites()}
              className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-border bg-surface text-secondary hover:bg-surface-raised hover:text-foreground"
            >
              <ArrowPathIcon className={`h-4 w-4 ${listLoading ? 'animate-spin' : ''}`} />
            </button>
            {createSiteButton(true)}
          </div>
        )}
      </header>
      <main className="min-h-0 w-full min-w-[720px] flex-1 overflow-y-auto [scrollbar-gutter:stable]">
        <div className="mx-auto w-full max-w-[840px] px-6 pb-6">
          {listError && (
            <div className="mb-3 flex items-center justify-between rounded-lg border border-red-500/20 bg-red-500/5 px-3 py-2 text-sm text-red-600">
              <span>{listError}</span>
              <button type="button" onClick={() => void loadSites()} className="font-medium">
                {i18nService.t('retry')}
              </button>
            </div>
          )}
          {listLoading && listData.list.length === 0 ? (
            <div className="flex h-64 items-center justify-center text-sm text-secondary">
              <ArrowPathIcon className="mr-2 h-4 w-4 animate-spin" />
              {i18nService.t('loading')}
            </div>
          ) : isUnfilteredEmpty ? (
            <EmptyState onCreateSiteByChat={onCreateSiteByChat} readOnly={readOnly} />
          ) : listData.list.length === 0 ? (
            <div className="flex h-56 flex-col items-center justify-center text-sm text-secondary">
              <MagnifyingGlassIcon className="mb-3 h-8 w-8" />
              {i18nService.t('sitesNoResults')}
            </div>
          ) : (
            <div>
              <div className="flex items-center border-b border-border px-3 pb-2">
                <h2 className="min-w-0 flex-1 text-xs font-medium text-secondary">
                  {i18nService.t('sitesMySites')}
                </h2>
                <span className="w-[140px] shrink-0 px-3 text-xs text-secondary">
                  {i18nService.t('sitesAccessMode')}
                </span>
                <span className="w-[116px] shrink-0" aria-hidden="true" />
              </div>
              <div>
                {listData.list.map(site => (
                  <div
                    key={site.shareId}
                    className="group flex w-full items-center rounded-lg border-b border-border/70 text-left transition-colors last:border-b-0 hover:bg-surface-raised/40"
                  >
                    <button
                      type="button"
                      onClick={() => void openSiteDetail(site)}
                      className="flex min-w-0 flex-1 items-center gap-4 rounded-lg px-3 py-3 text-left outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary/30"
                    >
                      <SiteDefaultIcon />
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <h3 className="truncate text-sm font-semibold text-foreground">
                            {site.title}
                          </h3>
                          <SiteStatusBadge status={site.siteStatus} />
                        </div>
                        <div className="mt-1.5 flex items-center gap-2 whitespace-nowrap text-[11px] text-secondary">
                          <span>
                            {site.siteKind === SiteKind.NodeService
                              ? i18nService.t('sitesNodeService')
                              : i18nService.t('sitesStaticSite')}
                          </span>
                          <span>·</span>
                          <span>{formatDateTime(site.updatedAt)}</span>
                        </div>
                      </div>
                      <div className="flex w-[140px] shrink-0 items-center gap-2 px-3 text-xs text-foreground">
                        {site.accessMode === HtmlShareAccessMode.Code ? (
                          <LockClosedIcon className="h-4 w-4 shrink-0 text-secondary" />
                        ) : (
                          <GlobeAltIcon className="h-4 w-4 shrink-0 text-secondary" />
                        )}
                        <span className="truncate">
                          {site.accessMode === HtmlShareAccessMode.Code
                            ? i18nService.t('sitesCodeAccess')
                            : i18nService.t('sitesPublicAccess')}
                        </span>
                      </div>
                    </button>
                    <div className="flex w-[116px] shrink-0 items-center justify-end gap-2">
                      <button
                        type="button"
                        onClick={() => void openShareDialog(site)}
                        className="inline-flex h-8 shrink-0 items-center gap-1.5 rounded-lg border border-border px-2.5 text-xs font-medium text-foreground transition-colors hover:bg-surface-raised"
                        aria-label={i18nService.t('sitesShare')}
                        title={i18nService.t('sitesShare')}
                      >
                        <ArrowUpTrayIcon className="h-4 w-4" />
                        <span>{i18nService.t('sitesShare')}</span>
                      </button>
                      <button
                        type="button"
                        onClick={event => {
                          if (siteActionMenu?.site.shareId === site.shareId) {
                            setSiteActionMenu(null);
                            return;
                          }
                          const rect = event.currentTarget.getBoundingClientRect();
                          const menuHeight = 84;
                          const gap = 6;
                          setSiteActionMenu({
                            site,
                            top:
                              rect.bottom + gap + menuHeight > window.innerHeight
                                ? Math.max(8, rect.top - menuHeight - gap)
                                : rect.bottom + gap,
                            right: Math.max(8, window.innerWidth - rect.right),
                          });
                        }}
                        className={`inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-foreground/70 transition-colors hover:bg-surface-raised hover:text-foreground ${siteActionMenu?.site.shareId === site.shareId ? 'bg-surface-raised text-foreground' : ''}`}
                        aria-label={i18nService.t('sitesActions')}
                        aria-haspopup="menu"
                        aria-expanded={siteActionMenu?.site.shareId === site.shareId}
                      >
                        <EllipsisHorizontalIcon className="h-4 w-4" />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </main>
      {listData.total > PAGE_SIZE && (
        <footer className="flex h-14 min-w-[720px] shrink-0 items-center justify-center gap-3 border-t border-border">
          <button
            type="button"
            disabled={page <= 1 || listLoading}
            onClick={() => setPage(current => Math.max(1, current - 1))}
            className="rounded-lg border border-border p-1.5 text-secondary disabled:opacity-30"
            aria-label={i18nService.t('sitesPreviousPage')}
            title={i18nService.t('sitesPreviousPage')}
          >
            <ChevronLeftIcon className="h-4 w-4" />
          </button>
          <span className="text-xs text-secondary">
            {i18nService
              .t('sitesPageIndicator')
              .replace('{current}', String(page))
              .replace('{total}', String(totalPages))}
          </span>
          <button
            type="button"
            disabled={page >= totalPages || listLoading}
            onClick={() => setPage(current => Math.min(totalPages, current + 1))}
            className="rounded-lg border border-border p-1.5 text-secondary disabled:opacity-30"
            aria-label={i18nService.t('sitesNextPage')}
            title={i18nService.t('sitesNextPage')}
          >
            <ChevronRightIcon className="h-4 w-4" />
          </button>
        </footer>
      )}
      <Modal
        isOpen={Boolean(shareSite)}
        onClose={() => {
          if (!shareActionLoading) closeShareDialog();
        }}
        className="w-[440px] max-w-[calc(100vw-32px)] rounded-2xl border border-border bg-background p-5 shadow-2xl"
      >
        {shareSite && (
          <>
            <div className="flex items-start justify-between gap-4">
              <div>
                <h2 className="text-base font-semibold text-foreground">
                  {i18nService.t('sitesShareTitle')}
                </h2>
                <p className="mt-1 text-xs leading-5 text-secondary">
                  {i18nService.t('sitesShareDescription')}
                </p>
              </div>
              <button
                type="button"
                disabled={shareActionLoading}
                onClick={closeShareDialog}
                className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-secondary transition-colors hover:bg-surface-raised hover:text-foreground disabled:opacity-40"
                aria-label={i18nService.t('close')}
              >
                <XMarkIcon className="h-4 w-4" />
              </button>
            </div>

            <div className="mt-4 flex items-center gap-3 rounded-xl border border-border bg-surface p-3">
              <SiteDefaultIcon />
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <h3 className="truncate text-sm font-semibold text-foreground">
                    {shareSite.title}
                  </h3>
                  <SiteStatusBadge status={shareSite.siteStatus} />
                </div>
                <p className="mt-1 truncate text-xs text-secondary" title={shareSite.url}>
                  {shareSite.url}
                </p>
              </div>
            </div>

            <div className="mt-4">
              <div className="flex items-center justify-between">
                <h3 className="text-xs font-semibold text-foreground">
                  {i18nService.t('sitesWhoCanAccess')}
                </h3>
                {shareDialogLoading && <ArrowPathIcon className="h-4 w-4 animate-spin text-secondary" />}
              </div>
              <div className="mt-2 grid grid-cols-2 gap-2">
                {[HtmlShareAccessMode.Public, HtmlShareAccessMode.Code].map(mode => (
                  <button
                    key={mode}
                    type="button"
                    disabled={!shareCanChangeAccess || shareDialogLoading || shareActionLoading}
                    onClick={() => {
                      setShareAccessModeDraft(mode);
                      setShareLinkCopied(false);
                      setShareError(null);
                    }}
                    className={`rounded-xl border p-3 text-left transition-colors disabled:cursor-not-allowed disabled:opacity-60 ${
                      shareAccessModeDraft === mode
                        ? 'border-primary bg-primary/5'
                        : 'border-border bg-surface hover:border-primary/50'
                    }`}
                  >
                    <span className="flex items-center gap-2 text-sm font-medium text-foreground">
                      {mode === HtmlShareAccessMode.Public ? (
                        <GlobeAltIcon className="h-4 w-4" />
                      ) : (
                        <LockClosedIcon className="h-4 w-4" />
                      )}
                      {mode === HtmlShareAccessMode.Public
                        ? i18nService.t('sitesPublicAccess')
                        : i18nService.t('sitesCodeAccess')}
                    </span>
                    <span className="mt-1 block text-[11px] leading-4 text-secondary">
                      {mode === HtmlShareAccessMode.Public
                        ? i18nService.t('sitesPublicAccessDescription')
                        : i18nService.t('sitesCodeAccessDescription')}
                    </span>
                  </button>
                ))}
              </div>
              {shareHasAccessChange && (
                <p className="mt-2 text-xs text-secondary">
                  {i18nService.t('sitesShareAccessHint')}
                </p>
              )}
            </div>

            {shareAccessModeDraft === HtmlShareAccessMode.Code &&
              shareSiteDetail?.shareCode && (
                <div className="mt-3 flex items-center justify-between rounded-lg bg-surface px-3 py-2">
                  <span className="text-xs text-secondary">
                    {i18nService.t('sitesShareCode')}
                    <span className="ml-2 font-mono text-sm text-foreground">
                      {shareSiteDetail.shareCode}
                    </span>
                  </span>
                  <button
                    type="button"
                    onClick={() =>
                      void copyTextToClipboard(shareSiteDetail.shareCode || '')
                    }
                    className="rounded-lg p-1.5 text-secondary transition-colors hover:bg-surface-raised hover:text-foreground"
                    aria-label={i18nService.t('copy')}
                    title={i18nService.t('copy')}
                  >
                    <ClipboardDocumentIcon className="h-4 w-4" />
                  </button>
                </div>
              )}
            {shareAccessModeDraft === HtmlShareAccessMode.Code &&
              shareSiteDetail &&
              !shareSiteDetail.shareCode && (
                <p className="mt-3 text-xs text-amber-700 dark:text-amber-300">
                  {i18nService.t('sitesShareCodeCopyUnavailable')}
                </p>
              )}

            {shareError && <p className="mt-3 text-xs text-red-600">{shareError}</p>}

            <div className="mt-5 flex justify-end gap-2 border-t border-border pt-4">
              <button
                type="button"
                disabled={shareActionLoading}
                onClick={closeShareDialog}
                className="h-9 rounded-lg border border-border px-3.5 text-sm text-foreground transition-colors hover:bg-surface-raised disabled:opacity-40"
              >
                {i18nService.t('cancel')}
              </button>
              <button
                type="button"
                disabled={shareDialogLoading || shareActionLoading || shareCopyUnavailable}
                onClick={() =>
                  void (shareHasAccessChange ? updateShareAccessMode() : copyShareLink())
                }
                className="inline-flex h-9 min-w-[104px] items-center justify-center gap-1.5 rounded-lg bg-primary px-3.5 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary-hover disabled:cursor-not-allowed disabled:opacity-40"
              >
                {shareActionLoading && <ArrowPathIcon className="h-4 w-4 animate-spin" />}
                {!shareActionLoading &&
                  (shareHasAccessChange ? (
                    <GlobeAltIcon className="h-4 w-4" />
                  ) : (
                    <ClipboardDocumentIcon className="h-4 w-4" />
                  ))}
                {shareActionLoading
                  ? i18nService.t('saving')
                  : shareLinkCopied
                    ? i18nService.t('sitesLinkCopied')
                    : shareHasAccessChange
                      ? i18nService.t('sitesUpdateAccessMode')
                      : shareCommittedAccessMode === HtmlShareAccessMode.Code
                        ? i18nService.t('sitesCopyLinkAndCode')
                        : i18nService.t('sitesCopyLink')}
              </button>
            </div>
          </>
        )}
      </Modal>
      {detailLoading && (
        <div className="absolute inset-0 z-20 flex items-center justify-center bg-background/60 backdrop-blur-[1px]">
          <ArrowPathIcon className="h-5 w-5 animate-spin text-secondary" />
        </div>
      )}
      {siteActionMenu && (
        <div
          ref={siteActionMenuRef}
          role="menu"
          className="fixed z-50 min-w-[132px] overflow-hidden rounded-lg border border-border bg-surface py-1 shadow-lg"
          style={{ top: siteActionMenu.top, right: siteActionMenu.right }}
        >
          <button
            type="button"
            role="menuitem"
            onClick={() => void openSiteDetail(siteActionMenu.site, 'analytics')}
            className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-foreground transition-colors hover:bg-surface-raised"
          >
            <ChartBarIcon className="h-4 w-4 text-secondary" />
            {i18nService.t('sitesViewAnalytics')}
          </button>
          <button
            type="button"
            role="menuitem"
            onClick={() => void openSiteDetail(siteActionMenu.site, 'settings')}
            className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-foreground transition-colors hover:bg-surface-raised"
          >
            <Cog6ToothIcon className="h-4 w-4 text-secondary" />
            {i18nService.t('sitesOpenSettings')}
          </button>
        </div>
      )}
    </div>
  );
};

export default SitesView;
