import {
  ArrowDownIcon,
  ArrowUpIcon,
  MagnifyingGlassIcon,
  XMarkIcon,
} from '@heroicons/react/24/outline';
import React, { useEffect, useRef } from 'react';

import { i18nService } from '../../services/i18n';
import {
  ConversationSearchDirection,
  ConversationSearchStatus,
  type ConversationSearchStatus as ConversationSearchStatusValue,
} from './conversationSearch';

interface CoworkConversationSearchProps {
  query: string;
  status: ConversationSearchStatusValue;
  activeMatchIndex: number;
  resultCount: number;
  isResultLimitReached: boolean;
  focusRequestKey: number;
  onQueryChange: (query: string) => void;
  onNavigate: (direction: typeof ConversationSearchDirection[keyof typeof ConversationSearchDirection]) => void;
  onClose: () => void;
}

const CoworkConversationSearch: React.FC<CoworkConversationSearchProps> = ({
  query,
  status,
  activeMatchIndex,
  resultCount,
  isResultLimitReached,
  focusRequestKey,
  onQueryChange,
  onNavigate,
  onClose,
}) => {
  const inputRef = useRef<HTMLInputElement>(null);
  const hasResults = resultCount > 0;

  useEffect(() => {
    const frameId = window.requestAnimationFrame(() => {
      inputRef.current?.focus();
      inputRef.current?.select();
    });
    return () => window.cancelAnimationFrame(frameId);
  }, [focusRequestKey]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.isComposing || event.key !== 'Escape') return;
      event.preventDefault();
      onClose();
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

  const resultText = status === ConversationSearchStatus.Loading
    ? i18nService.t('coworkConversationSearchLoading')
    : status === ConversationSearchStatus.Error
      ? i18nService.t('coworkConversationSearchFailed')
      : query.trim()
        ? i18nService.t('coworkConversationSearchResults')
          .replace('{current}', String(hasResults ? activeMatchIndex + 1 : 0))
          .replace('{total}', `${resultCount}${isResultLimitReached ? '+' : ''}`)
        : '';

  return (
    <div
      className="non-draggable relative -mr-1 top-1 z-40 w-[340px] min-w-0 max-w-[calc(100vw_-_24px)] self-start overflow-hidden rounded-[20px] border border-border bg-background/95 text-foreground shadow-[0_6px_20px_rgba(15,23,42,0.10)] backdrop-blur-xl dark:shadow-[0_8px_24px_rgba(0,0,0,0.38)]"
      role="search"
      data-cowork-conversation-search="true"
    >
      <div className="flex h-12 items-center px-3.5">
        <MagnifyingGlassIcon className="h-4 w-4 shrink-0 text-secondary" aria-hidden="true" />
        <input
          ref={inputRef}
          type="text"
          value={query}
          onChange={event => onQueryChange(event.target.value)}
          onKeyDown={event => {
            if (event.nativeEvent.isComposing) return;
            if (event.key === 'Enter') {
              event.preventDefault();
              onNavigate(event.shiftKey
                ? ConversationSearchDirection.Previous
                : ConversationSearchDirection.Next);
              return;
            }
            if (event.key === 'Escape') {
              event.preventDefault();
              onClose();
            }
          }}
          className="min-w-0 flex-1 border-0 bg-transparent px-2.5 text-sm leading-5 text-foreground outline-none placeholder:text-muted focus:outline-none focus:ring-0"
          placeholder={i18nService.t('coworkConversationSearchPlaceholder')}
          aria-label={i18nService.t('coworkConversationSearchPlaceholder')}
          autoComplete="off"
          spellCheck={false}
        />
        <div className="mx-1 h-5 w-px shrink-0 bg-border" aria-hidden="true" />
        <button
          type="button"
          onClick={onClose}
          className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-secondary transition-colors hover:bg-surface-raised hover:text-foreground"
          aria-label={i18nService.t('coworkConversationSearchClose')}
          title={i18nService.t('coworkConversationSearchClose')}
        >
          <XMarkIcon className="h-4 w-4" aria-hidden="true" />
        </button>
      </div>
      <div className="flex h-8 items-center justify-between border-t border-border px-4 text-xs text-muted">
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => onNavigate(ConversationSearchDirection.Previous)}
            disabled={!hasResults}
            className="inline-flex h-6 w-5 items-center justify-center rounded text-secondary transition-colors hover:bg-surface-raised hover:text-foreground disabled:cursor-default disabled:opacity-30 disabled:hover:bg-transparent"
            aria-label={i18nService.t('coworkConversationSearchPrevious')}
            title={i18nService.t('coworkConversationSearchPrevious')}
          >
            <ArrowUpIcon className="h-3.5 w-3.5" aria-hidden="true" />
          </button>
          <button
            type="button"
            onClick={() => onNavigate(ConversationSearchDirection.Next)}
            disabled={!hasResults}
            className="inline-flex h-6 w-5 items-center justify-center rounded text-secondary transition-colors hover:bg-surface-raised hover:text-foreground disabled:cursor-default disabled:opacity-30 disabled:hover:bg-transparent"
            aria-label={i18nService.t('coworkConversationSearchNext')}
            title={i18nService.t('coworkConversationSearchNext')}
          >
            <ArrowDownIcon className="h-3.5 w-3.5" aria-hidden="true" />
          </button>
        </div>
        <div className="min-w-0 truncate pl-3 text-right" role="status" aria-live="polite">
          {resultText}
        </div>
      </div>
    </div>
  );
};

export default CoworkConversationSearch;
