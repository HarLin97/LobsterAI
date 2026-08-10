import type { CoworkMessage, CoworkMessageMetadata } from '../../types/cowork';
import { parseUserMessageForDisplay } from '../../utils/userMessageDisplay';
import { MEDIA_TOKEN_DISPLAY_RE } from './messageDisplayUtils';
import { parseProposedPlanBlock } from './proposedPlanParser';

export const ConversationSearchStatus = {
  Idle: 'idle',
  Loading: 'loading',
  Ready: 'ready',
  Error: 'error',
} as const;

export type ConversationSearchStatus =
  typeof ConversationSearchStatus[keyof typeof ConversationSearchStatus];

export const ConversationSearchDirection = {
  Previous: 'previous',
  Next: 'next',
} as const;

export type ConversationSearchDirection =
  typeof ConversationSearchDirection[keyof typeof ConversationSearchDirection];

export const CONVERSATION_SEARCH_MATCH_LIMIT = 10_000;

export interface CoworkConversationSearchMatch {
  key: string;
  messageId: string;
  messageType: 'user' | 'assistant';
  absoluteMessageIndex: number;
  occurrenceIndex: number;
}

const MARKDOWN_IMAGE_RE = /!\[[^\]]*\]\((?:\\.|[^)])*\)/g;
const MARKDOWN_LINK_RE = /\[([^\]]+)\]\((?:\\.|[^)])*\)/g;
const AUTOLINK_RE = /<((?:https?:\/\/|mailto:)[^>]+)>/gi;
const HTML_TAG_RE = /<\/?[A-Za-z][^>]*>/g;
const FENCE_LINE_RE = /^\s*(?:```|~~~)[^\n]*$/gm;
const HEADING_OR_QUOTE_PREFIX_RE = /^\s{0,3}(?:#{1,6}|>)\s*/gm;
const LIST_PREFIX_RE = /^\s*(?:[-+*]|\d+[.)])\s+/gm;
const INLINE_CODE_RE = /`([^`]+)`/g;
const PAIRED_STRONG_OR_STRIKE_RE = /(\*\*|__|~~)(?=\S)([^\n]*?\S)\1/g;
const PAIRED_ASTERISK_EMPHASIS_RE = /(?<!\*)\*(?=\S)([^*\n]*?\S)\*(?!\*)/g;
const PAIRED_UNDERSCORE_EMPHASIS_RE = /(?<!_)_(?=\S)([^_\n]*?\S)_(?!_)/g;

export function normalizeConversationSearchQuery(query: string): string {
  return query.trim().replace(/\r\n?/g, '\n').toLowerCase();
}

/**
 * Produces the text users can reasonably see in rendered Markdown. It is not a
 * Markdown renderer; it only removes syntax that should not be required in a
 * literal conversation search.
 */
export function getVisibleMarkdownSearchText(content: string): string {
  return content
    .replace(/\r\n?/g, '\n')
    .replace(MARKDOWN_IMAGE_RE, '')
    .replace(MARKDOWN_LINK_RE, '$1')
    .replace(AUTOLINK_RE, '$1')
    .replace(FENCE_LINE_RE, '')
    .replace(HEADING_OR_QUOTE_PREFIX_RE, '')
    .replace(LIST_PREFIX_RE, '')
    .replace(INLINE_CODE_RE, '$1')
    .replace(PAIRED_STRONG_OR_STRIKE_RE, '$2')
    .replace(PAIRED_ASTERISK_EMPHASIS_RE, '$1')
    .replace(PAIRED_UNDERSCORE_EMPHASIS_RE, '$1')
    .replace(HTML_TAG_RE, '');
}

export function getConversationSearchMessageText(message: CoworkMessage): string | null {
  if (message.type === 'user') {
    const metadata = message.metadata as CoworkMessageMetadata | undefined;
    const displayContent = parseUserMessageForDisplay(message.content || '', {
      localMediaAttachments: Array.isArray(metadata?.localMediaAttachments)
        ? metadata.localMediaAttachments
        : [],
    });
    // UserMessageContent renders ordinary user text verbatim and only treats
    // standalone image lines as Markdown, so retain punctuation that is
    // genuinely visible in the user bubble.
    return displayContent.replace(/\r\n?/g, '\n').replace(MARKDOWN_IMAGE_RE, '');
  }

  if (message.type !== 'assistant' || message.metadata?.isThinking === true) {
    return null;
  }

  const rawContent = message.content || '';
  const proposedPlan = parseProposedPlanBlock(rawContent);
  const visibleText = proposedPlan.visibleText.replace(MEDIA_TOKEN_DISPLAY_RE, '').trimEnd();
  return [visibleText, proposedPlan.planText]
    .filter((part): part is string => Boolean(part))
    .map(getVisibleMarkdownSearchText)
    .join('\n\n');
}

export function findConversationSearchMatches(
  messages: CoworkMessage[],
  query: string,
  absoluteOffset = 0,
  maxMatches = Number.POSITIVE_INFINITY,
): CoworkConversationSearchMatch[] {
  const normalizedQuery = normalizeConversationSearchQuery(query);
  const boundedMaxMatches = Number.isFinite(maxMatches)
    ? Math.max(0, Math.floor(maxMatches))
    : Number.POSITIVE_INFINITY;
  if (!normalizedQuery || boundedMaxMatches === 0) return [];

  const matches: CoworkConversationSearchMatch[] = [];

  messages.forEach((message, messageIndex) => {
    const text = getConversationSearchMessageText(message);
    if (text === null) return;
    if (message.type !== 'user' && message.type !== 'assistant') return;

    const normalizedText = text.replace(/\r\n?/g, '\n').toLowerCase();
    let searchFrom = 0;
    let occurrenceIndex = 0;

    while (searchFrom <= normalizedText.length - normalizedQuery.length) {
      const matchIndex = normalizedText.indexOf(normalizedQuery, searchFrom);
      if (matchIndex < 0) break;

      matches.push({
        // Keep keys query-independent so a long query is not duplicated for
        // every match. Query changes already clear the active selection.
        key: `${message.id}:${occurrenceIndex}`,
        messageId: message.id,
        messageType: message.type,
        absoluteMessageIndex: absoluteOffset + messageIndex,
        occurrenceIndex,
      });

      if (matches.length >= boundedMaxMatches) return matches;

      occurrenceIndex += 1;
      searchFrom = matchIndex + normalizedQuery.length;
    }
  });

  return matches;
}
