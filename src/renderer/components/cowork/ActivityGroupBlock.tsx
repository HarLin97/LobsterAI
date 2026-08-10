import { ChevronRightIcon } from '@heroicons/react/24/outline';
import React, { useMemo, useState } from 'react';

import { bucketCount, reportConversationBlockAction } from './conversationAnalytics';
import {
  type ActivityChunkEntry,
  type ConsolidatedItem,
  formatActivityDuration,
  getActivityCurrentActionText,
  getActivityGroupHeaderLabel,
  getActivityGroupSummary,
  isMediaGenerateRunning,
  isMediaStatusPollRunning,
} from './messageDisplayUtils';

// Mirrors turnHasSelfIndicatingActivity: whether the step still carries its
// own running state. While live, the header shimmers and the turn-level
// activity indicator stays hidden; in quiet gaps the header goes static and
// the indicator takes over, keeping a single animation on screen.
const isItemLive = (item: ConsolidatedItem): boolean => {
  if (item.type === 'tool_group') {
    return !item.group.toolResult
      || isMediaGenerateRunning(item.group)
      || isMediaStatusPollRunning(item.group);
  }
  if (item.type === 'media_polling_group') {
    return !item.group.isComplete;
  }
  return item.type === 'assistant' && Boolean(item.message.metadata?.isStreaming);
};

/**
 * Collapses a run of consecutive agent work items (tool calls, thinking,
 * media polling) behind a single summary line, following the Codex /
 * Claude Code app pattern: while streaming the header mirrors the latest
 * step; once done it becomes a natural-language summary ("Ran 3 commands,
 * read 2 files"). Expanding reveals a card with one row per step, and each
 * row can be expanded again for full detail.
 */
const ActivityGroupBlock: React.FC<{
  entries: ActivityChunkEntry[];
  isStreamingTail?: boolean;
  renderEntry: (entry: ActivityChunkEntry) => React.ReactNode;
}> = ({ entries, isStreamingTail = false, renderEntry }) => {
  const [isExpanded, setIsExpanded] = useState(false);

  const items = useMemo(() => entries.map((entry) => entry.item), [entries]);
  const summary = useMemo(() => getActivityGroupSummary(items), [items]);

  const lastItem = items[items.length - 1];
  const showLiveAction = isStreamingTail && isItemLive(lastItem);
  const headerLabel = showLiveAction
    ? getActivityCurrentActionText(lastItem)
    : getActivityGroupHeaderLabel(items);
  const durationText = isStreamingTail ? null : formatActivityDuration(summary.durationMs);

  const handleToggle = () => {
    const nextExpanded = !isExpanded;
    reportConversationBlockAction({
      actionType: nextExpanded ? 'activity_group_expand' : 'activity_group_collapse',
      blockType: 'activity_group',
      params: {
        stepCount: summary.stepCount,
        stepCountBucket: bucketCount(summary.stepCount),
        itemCount: entries.length,
        isStreaming: isStreamingTail,
      },
    });
    setIsExpanded(nextExpanded);
  };

  return (
    <div className="py-1">
      <button
        onClick={handleToggle}
        className="flex max-w-full items-center gap-1.5 text-left group"
        aria-expanded={isExpanded}
      >
        <span className={`min-w-0 truncate text-sm text-secondary group-hover:text-foreground transition-colors ${
          showLiveAction ? 'shimmer-text' : ''
        }`}>
          {headerLabel}
        </span>
        {durationText && (
          <span className="text-xs text-muted flex-shrink-0">· {durationText}</span>
        )}
        <ChevronRightIcon
          className={`h-3.5 w-3.5 text-muted group-hover:text-secondary flex-shrink-0 transition-transform duration-200 ${
            isExpanded ? 'rotate-90' : ''
          }`}
        />
      </button>
      {isExpanded && (
        <div className="mt-2 w-full overflow-hidden rounded-lg border border-border divide-y divide-border">
          {entries.map((entry) => renderEntry(entry))}
        </div>
      )}
    </div>
  );
};

export default ActivityGroupBlock;
