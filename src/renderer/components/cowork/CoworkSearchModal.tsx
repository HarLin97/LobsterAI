import { XMarkIcon } from '@heroicons/react/24/outline';
import { AgentId } from '@shared/agent';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useSelector } from 'react-redux';

import { coworkService } from '../../services/cowork';
import { i18nService } from '../../services/i18n';
import { LogReporterAction, reportYdAnalyzer } from '../../services/logReporter';
import { RootState } from '../../store';
import { CoworkSessionStatusValue, type CoworkSessionSummary } from '../../types/cowork';
import { getAgentDisplayNameById } from '../../utils/agentDisplay';
import Modal from '../common/Modal';

const SEARCH_SESSION_LIMIT = 100;
const SEARCH_DEBOUNCE_MS = 180;
const TASK_SEARCH_ANALYTICS_SOURCE = 'home_task_search';

const getSessionAgentId = (session: CoworkSessionSummary) => {
  return session.agentId?.trim() || AgentId.Main;
};

const getSessionAgentType = (session: CoworkSessionSummary): 'main' | 'custom' => (
  getSessionAgentId(session) === AgentId.Main ? 'main' : 'custom'
);

const reportTaskSearchAction = (
  actionType: string,
  options: {
    agentType?: 'main' | 'custom';
    hasQuery?: boolean;
    isCurrentSession?: boolean;
    resultCount?: number;
    sessionStatus?: string;
  } = {},
): void => {
  console.debug('[CoworkSearch] reporting task search analytics');
  void reportYdAnalyzer({
    action: LogReporterAction.TaskSearchAction,
    source: TASK_SEARCH_ANALYTICS_SOURCE,
    actionType,
    hasQuery: options.hasQuery,
    resultCount: options.resultCount,
    isCurrentSession: options.isCurrentSession,
    sessionStatus: options.sessionStatus,
    agentType: options.agentType,
  });
};

const mergeUniqueSessions = (
  primary: CoworkSessionSummary[],
  secondary: CoworkSessionSummary[],
): CoworkSessionSummary[] => {
  const seen = new Set<string>();
  const result: CoworkSessionSummary[] = [];
  [...primary, ...secondary].forEach((session) => {
    if (seen.has(session.id)) return;
    seen.add(session.id);
    result.push(session);
  });
  return result;
};

interface CoworkSearchModalProps {
  isOpen: boolean;
  onClose: () => void;
  sessions: CoworkSessionSummary[];
  currentSessionId: string | null;
  onSelectSession: (session: CoworkSessionSummary) => void | Promise<void>;
}

const CoworkSearchModal: React.FC<CoworkSearchModalProps> = ({
  isOpen,
  onClose,
  sessions,
  currentSessionId,
  onSelectSession,
}) => {
  const agents = useSelector((state: RootState) => state.agent.agents);
  const [searchQuery, setSearchQuery] = useState('');
  const [debouncedSearchQuery, setDebouncedSearchQuery] = useState('');
  const [searchResultQuery, setSearchResultQuery] = useState('');
  const [searchSessions, setSearchSessions] = useState<CoworkSessionSummary[]>(sessions);
  const [recentSessions, setRecentSessions] = useState<CoworkSessionSummary[]>(sessions);
  const [isLoading, setIsLoading] = useState(false);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const requestIdRef = useRef(0);
  const reportedOpenRef = useRef(false);
  const reportedEmptyResultKeyRef = useRef<string | null>(null);

  const displayedSessions = useMemo(() => {
    const trimmedQuery = searchQuery.trim().toLowerCase();
    if (!trimmedQuery) return recentSessions;
    const resultQuery = searchResultQuery.trim().toLowerCase();
    const titleMatches = resultQuery === trimmedQuery ? searchSessions : [];

    const recentMatches = recentSessions.filter((session) => {
      const agentId = getSessionAgentId(session);
      const agentName = getAgentDisplayNameById(agentId, agents) ?? agentId;
      return session.title.toLowerCase().includes(trimmedQuery)
        || agentName.toLowerCase().includes(trimmedQuery);
    });

    return mergeUniqueSessions(titleMatches, recentMatches);
  }, [agents, recentSessions, searchQuery, searchResultQuery, searchSessions]);

  const agentNameBySessionId = useMemo(() => {
    const names = new Map<string, string>();
    displayedSessions.forEach((session) => {
      const agentId = getSessionAgentId(session);
      names.set(session.id, getAgentDisplayNameById(agentId, agents) ?? agentId);
    });
    return names;
  }, [agents, displayedSessions]);

  useEffect(() => {
    if (isOpen) {
      if (!reportedOpenRef.current) {
        reportedOpenRef.current = true;
        reportTaskSearchAction('open', {
          hasQuery: false,
          resultCount: sessions.length,
        });
      }
      requestAnimationFrame(() => {
        searchInputRef.current?.focus();
        searchInputRef.current?.select();
      });
      return;
    }
    setSearchQuery('');
    setDebouncedSearchQuery('');
    setSearchResultQuery('');
    reportedOpenRef.current = false;
    reportedEmptyResultKeyRef.current = null;
  }, [isOpen, sessions.length]);

  useEffect(() => {
    if (!isOpen) {
      setSearchSessions(sessions);
      setRecentSessions(sessions);
      setSearchResultQuery('');
    }
  }, [isOpen, sessions]);

  useEffect(() => {
    if (!isOpen) return;
    const timer = window.setTimeout(() => {
      setDebouncedSearchQuery(searchQuery.trim());
    }, SEARCH_DEBOUNCE_MS);
    return () => window.clearTimeout(timer);
  }, [isOpen, searchQuery]);

  useEffect(() => {
    if (!isOpen) return;
    const requestId = requestIdRef.current + 1;
    requestIdRef.current = requestId;
    const query = debouncedSearchQuery.trim();
    setIsLoading(true);
    void coworkService.listSessionsForSearch(SEARCH_SESSION_LIMIT, 0, query)
      .then((result) => {
        if (requestId !== requestIdRef.current) return;
        if (!result.success || !result.sessions) {
          console.warn('[CoworkSearch] failed to load task search results:', result.error);
          setSearchSessions([]);
          setSearchResultQuery(query);
          return;
        }
        setSearchSessions(result.sessions);
        setSearchResultQuery(query);
        if (!query) {
          setRecentSessions(result.sessions);
        }
      })
      .finally(() => {
        if (requestId === requestIdRef.current) {
          setIsLoading(false);
        }
      });
  }, [debouncedSearchQuery, isOpen]);

  useEffect(() => {
    if (!isOpen) return;
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        reportTaskSearchAction('close', {
          hasQuery: searchQuery.trim().length > 0,
          resultCount: displayedSessions.length,
        });
        onClose();
      }
    };
    document.addEventListener('keydown', handleEscape);
    return () => document.removeEventListener('keydown', handleEscape);
  }, [displayedSessions.length, isOpen, onClose, searchQuery]);

  const handleSelectSession = async (session: CoworkSessionSummary) => {
    reportTaskSearchAction('select_result', {
      agentType: getSessionAgentType(session),
      hasQuery: searchQuery.trim().length > 0,
      isCurrentSession: session.id === currentSessionId,
      resultCount: displayedSessions.length,
      sessionStatus: session.status,
    });
    await onSelectSession(session);
    onClose();
  };

  const handleClose = () => {
    reportTaskSearchAction('close', {
      hasQuery: searchQuery.trim().length > 0,
      resultCount: displayedSessions.length,
    });
    onClose();
  };

  useEffect(() => {
    if (!isOpen || isLoading || displayedSessions.length > 0) return;
    const emptyResultKey = `${searchQuery.trim().length > 0 ? 'query' : 'recent'}:${searchResultQuery}`;
    if (reportedEmptyResultKeyRef.current === emptyResultKey) return;
    reportedEmptyResultKeyRef.current = emptyResultKey;
    reportTaskSearchAction('empty_result', {
      hasQuery: searchQuery.trim().length > 0,
      resultCount: 0,
    });
  }, [displayedSessions.length, isLoading, isOpen, searchQuery, searchResultQuery]);

  if (!isOpen) return null;

  return (
    <Modal
      onClose={handleClose}
      overlayClassName="fixed inset-0 z-50 flex items-start justify-center bg-black/10 px-6 pt-[18vh] backdrop-blur-[1px] dark:bg-black/30"
      className="modal-content w-full max-w-[520px] overflow-hidden rounded-[18px] border border-border bg-white shadow-modal dark:bg-surface"
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={i18nService.t('search')}
      >
        <div className="flex items-center justify-between gap-3 px-4 pb-2 pt-4">
          <div className="min-w-0 text-base font-semibold text-foreground">
            {i18nService.t('search')}
          </div>
          <button
            type="button"
            onClick={handleClose}
            aria-label={i18nService.t('close')}
            title={i18nService.t('close')}
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-secondary transition-colors hover:bg-black/[0.04] hover:text-foreground dark:hover:bg-white/[0.06]"
          >
            <XMarkIcon className="h-5 w-5" />
          </button>
        </div>
        <div className="px-4 pb-3">
          <input
            ref={searchInputRef}
            value={searchQuery}
            onChange={(event) => setSearchQuery(event.target.value)}
            placeholder={i18nService.t('searchConversations')}
            aria-label={i18nService.t('search')}
            className="h-10 w-full rounded-xl border border-border bg-background px-3 text-[13px] text-foreground placeholder-secondary outline-none transition-colors focus:border-primary focus:ring-2 focus:ring-primary/20"
          />
        </div>
        <div className="px-2 pb-2">
          <div className="px-2 pb-1 text-[12px] text-secondary">
            {i18nService.t('searchRecentTasks')}
          </div>
          <div className="max-h-[320px] overflow-y-auto">
            {displayedSessions.length === 0 ? (
              <div className="py-10 text-center text-sm text-secondary">
                {isLoading ? i18nService.t('loading') : i18nService.t('searchNoResults')}
              </div>
            ) : (
              displayedSessions.map((session) => {
                const agentName = agentNameBySessionId.get(session.id) ?? getSessionAgentId(session);
                const isSelected = session.id === currentSessionId;
                const isRunning = session.status === CoworkSessionStatusValue.Running;
                return (
                  <button
                    key={session.id}
                    type="button"
                    onClick={() => void handleSelectSession(session)}
                    className={`group flex h-8 w-full items-center gap-2 rounded-lg px-2 text-left text-[13px] transition-colors ${
                      isSelected
                        ? 'bg-black/[0.06] text-foreground dark:bg-white/[0.07]'
                        : 'text-secondary hover:bg-black/[0.04] hover:text-foreground dark:hover:bg-white/[0.06]'
                      }`}
                  >
                    {isRunning && (
                      <span
                        className="inline-flex h-3 w-3 shrink-0 items-center justify-center"
                        title={i18nService.t('myAgentSidebarRunning')}
                        aria-label={i18nService.t('myAgentSidebarRunning')}
                      >
                        <svg className="h-3 w-3 animate-spin text-primary" viewBox="0 0 24 24" fill="none">
                          <circle
                            className="opacity-25"
                            cx="12"
                            cy="12"
                            r="10"
                            stroke="currentColor"
                            strokeWidth="4"
                          />
                          <path
                            className="opacity-75"
                            fill="currentColor"
                            d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z"
                          />
                        </svg>
                      </span>
                    )}
                    <span className="min-w-0 flex-1 truncate font-medium">
                      {session.title}
                    </span>
                    <span className="max-w-[136px] shrink-0 truncate text-[12px] text-secondary/75">
                      {agentName}
                    </span>
                  </button>
                );
              })
            )}
          </div>
        </div>
      </div>
    </Modal>
  );
};

export default CoworkSearchModal;
