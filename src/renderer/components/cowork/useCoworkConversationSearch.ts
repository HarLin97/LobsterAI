import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import type { CoworkMessage } from '../../types/cowork';
import {
  ConversationSearchDirection,
  type ConversationSearchDirection as ConversationSearchDirectionValue,
  ConversationSearchStatus,
  type ConversationSearchStatus as ConversationSearchStatusValue,
  type CoworkConversationSearchMatch,
  findConversationSearchMatches,
} from './conversationSearch';
import {
  logConversationSearchDebug,
  logConversationSearchWarning,
} from './conversationSearchLogger';
import { mergeCoworkTextExportMessages } from './sessionExport';

const STREAM_MESSAGE_MERGE_THROTTLE_MS = 250;
const SEARCH_MESSAGE_BATCH_SIZE = 200;

const findConversationSearchMatchesInBatches = async (
  messages: CoworkMessage[],
  query: string,
  isRequestCurrent: () => boolean,
): Promise<CoworkConversationSearchMatch[] | null> => {
  const matches: CoworkConversationSearchMatch[] = [];

  for (let startIndex = 0; startIndex < messages.length; startIndex += SEARCH_MESSAGE_BATCH_SIZE) {
    if (!isRequestCurrent()) return null;

    const endIndex = Math.min(startIndex + SEARCH_MESSAGE_BATCH_SIZE, messages.length);
    matches.push(...findConversationSearchMatches(
      messages.slice(startIndex, endIndex),
      query,
      startIndex,
    ));

    if (endIndex < messages.length) {
      await new Promise<void>(resolve => window.setTimeout(resolve, 0));
    }
  }

  return isRequestCurrent() ? matches : null;
};

interface UseCoworkConversationSearchOptions {
  sessionId?: string;
  currentMessages: CoworkMessage[];
  loadFullMessages: () => Promise<CoworkMessage[]>;
  debounceMs?: number;
}

export interface CoworkConversationSearchController {
  isOpen: boolean;
  query: string;
  status: ConversationSearchStatusValue;
  matches: CoworkConversationSearchMatch[];
  activeMatch: CoworkConversationSearchMatch | null;
  activeMatchIndex: number;
  focusRequestKey: number;
  open: () => void;
  close: () => void;
  setQuery: (query: string) => void;
  navigate: (direction: ConversationSearchDirectionValue) => void;
}

export function useCoworkConversationSearch({
  sessionId,
  currentMessages,
  loadFullMessages,
  debounceMs = 120,
}: UseCoworkConversationSearchOptions): CoworkConversationSearchController {
  const [isOpen, setIsOpen] = useState(false);
  const [query, setQueryState] = useState('');
  const [status, setStatus] = useState<ConversationSearchStatusValue>(ConversationSearchStatus.Idle);
  const [fullMessages, setFullMessages] = useState<CoworkMessage[]>([]);
  const [matches, setMatches] = useState<CoworkConversationSearchMatch[]>([]);
  const [activeMatchKey, setActiveMatchKey] = useState<string | null>(null);
  const [focusRequestKey, setFocusRequestKey] = useState(0);
  const loadRequestRef = useRef(0);
  const searchRequestRef = useRef(0);
  const streamMergeTimerRef = useRef<number | null>(null);
  const latestCurrentMessagesRef = useRef(currentMessages);
  const isOpenRef = useRef(false);
  const statusRef = useRef<ConversationSearchStatusValue>(ConversationSearchStatus.Idle);
  const fullMessagesRef = useRef<CoworkMessage[]>([]);
  const loadFullMessagesRef = useRef(loadFullMessages);
  const previousSessionIdRef = useRef(sessionId);

  latestCurrentMessagesRef.current = currentMessages;
  isOpenRef.current = isOpen;
  statusRef.current = status;
  fullMessagesRef.current = fullMessages;

  useEffect(() => {
    loadFullMessagesRef.current = loadFullMessages;
  }, [loadFullMessages]);

  const reset = useCallback(() => {
    loadRequestRef.current += 1;
    searchRequestRef.current += 1;
    if (streamMergeTimerRef.current !== null) {
      window.clearTimeout(streamMergeTimerRef.current);
      streamMergeTimerRef.current = null;
    }
    isOpenRef.current = false;
    statusRef.current = ConversationSearchStatus.Idle;
    fullMessagesRef.current = [];
    setIsOpen(false);
    setQueryState('');
    setStatus(ConversationSearchStatus.Idle);
    setFullMessages([]);
    setMatches([]);
    setActiveMatchKey(null);
  }, []);

  useEffect(() => () => {
    loadRequestRef.current += 1;
    searchRequestRef.current += 1;
    isOpenRef.current = false;
    if (streamMergeTimerRef.current !== null) {
      window.clearTimeout(streamMergeTimerRef.current);
      streamMergeTimerRef.current = null;
    }
  }, []);

  useEffect(() => {
    if (previousSessionIdRef.current === sessionId) return;
    if (isOpenRef.current) {
      logConversationSearchDebug('Resetting conversation search after session change.');
    }
    previousSessionIdRef.current = sessionId;
    reset();
  }, [reset, sessionId]);

  useEffect(() => {
    if (
      !isOpen
      || status !== ConversationSearchStatus.Ready
      || currentMessages.length === 0
    ) return;
    if (streamMergeTimerRef.current !== null) return;

    streamMergeTimerRef.current = window.setTimeout(() => {
      streamMergeTimerRef.current = null;
      if (!isOpenRef.current || statusRef.current !== ConversationSearchStatus.Ready) return;

      setFullMessages(previous => {
        const nextMessages = mergeCoworkTextExportMessages(
          previous,
          latestCurrentMessagesRef.current,
        );
        const unchanged = nextMessages.length === previous.length
          && nextMessages.every((message, index) => message === previous[index]);
        if (unchanged) return previous;
        fullMessagesRef.current = nextMessages;
        return nextMessages;
      });
    }, STREAM_MESSAGE_MERGE_THROTTLE_MS);
  }, [currentMessages, isOpen, status]);

  const open = useCallback(() => {
    if (!sessionId) return;
    if (!isOpenRef.current) {
      logConversationSearchDebug('Opening conversation search.');
    }
    isOpenRef.current = true;
    setIsOpen(true);
    setFocusRequestKey(value => value + 1);

    if (
      fullMessagesRef.current.length > 0
      || statusRef.current === ConversationSearchStatus.Loading
      || statusRef.current === ConversationSearchStatus.Ready
    ) return;

    const requestId = ++loadRequestRef.current;
    statusRef.current = ConversationSearchStatus.Loading;
    setStatus(ConversationSearchStatus.Loading);
    void loadFullMessagesRef.current().then(messages => {
      if (requestId !== loadRequestRef.current) return;
      fullMessagesRef.current = messages;
      statusRef.current = ConversationSearchStatus.Ready;
      setFullMessages(messages);
      setStatus(ConversationSearchStatus.Ready);
      logConversationSearchDebug(`Loaded conversation history; messageCount=${messages.length}.`);
    }).catch((error: unknown) => {
      if (requestId !== loadRequestRef.current) return;
      statusRef.current = ConversationSearchStatus.Error;
      logConversationSearchWarning('Failed to load conversation history.', error);
      setStatus(ConversationSearchStatus.Error);
    });
  }, [sessionId]);

  const close = useCallback(() => {
    if (isOpenRef.current) {
      logConversationSearchDebug('Closing conversation search and releasing cached history.');
    }
    reset();
  }, [reset]);

  const setQuery = useCallback((nextQuery: string) => {
    searchRequestRef.current += 1;
    setQueryState(nextQuery);
    setMatches([]);
    setActiveMatchKey(null);
  }, []);

  useEffect(() => {
    if (!isOpen) return undefined;

    const trimmedQuery = query.trim();
    if (!trimmedQuery) {
      searchRequestRef.current += 1;
      setMatches([]);
      setActiveMatchKey(null);
      if (status !== ConversationSearchStatus.Loading && status !== ConversationSearchStatus.Error) {
        setStatus(ConversationSearchStatus.Ready);
      }
      return undefined;
    }

    if (status === ConversationSearchStatus.Loading || status === ConversationSearchStatus.Error) {
      return undefined;
    }

    const requestId = ++searchRequestRef.current;
    const timer = window.setTimeout(() => {
      void findConversationSearchMatchesInBatches(
        fullMessages,
        trimmedQuery,
        () => requestId === searchRequestRef.current,
      ).then(nextMatches => {
        if (!nextMatches || requestId !== searchRequestRef.current) return;

        setMatches(nextMatches);
        setActiveMatchKey(previousKey => {
          if (previousKey && nextMatches.some(match => match.key === previousKey)) {
            return previousKey;
          }
          return nextMatches[0]?.key ?? null;
        });
        setStatus(ConversationSearchStatus.Ready);
      }).catch((error: unknown) => {
        if (requestId !== searchRequestRef.current) return;
        logConversationSearchWarning('Failed to search conversation history.', error);
        statusRef.current = ConversationSearchStatus.Error;
        setStatus(ConversationSearchStatus.Error);
      });
    }, debounceMs);

    return () => window.clearTimeout(timer);
  }, [debounceMs, fullMessages, isOpen, query, status]);

  const activeMatchIndex = useMemo(() => {
    if (!activeMatchKey) return -1;
    return matches.findIndex(match => match.key === activeMatchKey);
  }, [activeMatchKey, matches]);

  const activeMatch = activeMatchIndex >= 0 ? matches[activeMatchIndex] : null;

  const navigate = useCallback((direction: ConversationSearchDirectionValue) => {
    if (matches.length === 0) return;

    const currentIndex = activeMatchKey
      ? matches.findIndex(match => match.key === activeMatchKey)
      : -1;
    const nextIndex = direction === ConversationSearchDirection.Previous
      ? (currentIndex <= 0 ? matches.length - 1 : currentIndex - 1)
      : (currentIndex < 0 || currentIndex >= matches.length - 1 ? 0 : currentIndex + 1);
    setActiveMatchKey(matches[nextIndex].key);
  }, [activeMatchKey, matches]);

  // Effects reset state immediately after a session switch. Hide the stale
  // controller state during the intervening render so it cannot navigate the
  // new session using an old message index.
  const isSessionStateCurrent = previousSessionIdRef.current === sessionId;

  return {
    isOpen: isSessionStateCurrent ? isOpen : false,
    query: isSessionStateCurrent ? query : '',
    status: isSessionStateCurrent ? status : ConversationSearchStatus.Idle,
    matches: isSessionStateCurrent ? matches : [],
    activeMatch: isSessionStateCurrent ? activeMatch : null,
    activeMatchIndex: isSessionStateCurrent ? activeMatchIndex : -1,
    focusRequestKey,
    open,
    close,
    setQuery,
    navigate,
  };
}
