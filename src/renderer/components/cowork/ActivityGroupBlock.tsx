import { ChevronRightIcon } from '@heroicons/react/24/outline';
import React, { useMemo, useState } from 'react';

import { bucketCount, reportConversationBlockAction } from './conversationAnalytics';
import {
  type ActivityChunkEntry,
  formatActivityDuration,
  getActivityCurrentActionText,
  getActivityGroupHeaderLabel,
  getActivityGroupSummary,
} from './messageDisplayUtils';

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

  const headerLabel = isStreamingTail
    ? getActivityCurrentActionText(items[items.length - 1])
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
        <span className="min-w-0 truncate text-sm text-secondary group-hover:text-foreground transition-colors">
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
        {isStreamingTail && (
          <span className="w-1.5 h-1.5 rounded-full bg-blue-500 animate-pulse flex-shrink-0" />
        )}
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
