import type { CoworkConversationSearchMatch } from './conversationSearch';
import { logConversationSearchWarning } from './conversationSearchLogger';

const ConversationSearchHighlightName = {
  Match: 'cowork-conversation-search-match',
  Active: 'cowork-conversation-search-active',
} as const;

interface HighlightRegistryLike {
  set: (name: string, highlight: unknown) => void;
  delete: (name: string) => boolean;
}

type HighlightConstructor = new (...ranges: Range[]) => unknown;

export interface ConversationSearchHighlightResult {
  activeElement: HTMLElement | null;
  activeRange: Range | null;
}

interface TextNodeSpan {
  node: Text;
  start: number;
  end: number;
}

let hasLoggedHighlightFailure = false;

const logHighlightFailureOnce = (message: string, error: unknown): void => {
  if (hasLoggedHighlightFailure) return;
  hasLoggedHighlightFailure = true;
  logConversationSearchWarning(message, error);
};

const getHighlightApi = (): {
  registry: HighlightRegistryLike;
  HighlightClass: HighlightConstructor;
} | null => {
  if (typeof CSS === 'undefined' || typeof window === 'undefined') return null;
  const registry = (CSS as typeof CSS & { highlights?: HighlightRegistryLike }).highlights;
  const HighlightClass = (window as typeof window & { Highlight?: HighlightConstructor }).Highlight;
  if (!registry || !HighlightClass) return null;
  return { registry, HighlightClass };
};

const isExcludedTextNode = (node: Text, root: HTMLElement): boolean => {
  const parent = node.parentElement;
  if (!parent || !root.contains(parent)) return true;
  return Boolean(parent.closest([
    '[data-cowork-search-exclude="true"]',
    '[aria-hidden="true"]',
    'button',
    'script',
    'style',
  ].join(',')));
};

const collectTextNodeSpans = (root: HTMLElement): { text: string; spans: TextNodeSpan[] } => {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const spans: TextNodeSpan[] = [];
  const chunks: string[] = [];
  let offset = 0;

  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    if (!(node instanceof Text) || isExcludedTextNode(node, root)) continue;
    const value = node.data;
    if (!value) continue;
    chunks.push(value);
    spans.push({ node, start: offset, end: offset + value.length });
    offset += value.length;
  }

  return { text: chunks.join(''), spans };
};

const createRange = (
  spans: TextNodeSpan[],
  start: number,
  end: number,
): Range | null => {
  const startSpan = spans.find(span => start >= span.start && start < span.end);
  const endSpan = spans.find(span => end > span.start && end <= span.end);
  if (!startSpan || !endSpan) return null;

  const range = document.createRange();
  range.setStart(startSpan.node, start - startSpan.start);
  range.setEnd(endSpan.node, end - endSpan.start);
  return range;
};

export const getConversationSearchRanges = (
  root: HTMLElement,
  query: string,
): Range[] => {
  const normalizedQuery = query.trim().toLowerCase();
  if (!normalizedQuery) return [];

  const { text, spans } = collectTextNodeSpans(root);
  const normalizedText = text.toLowerCase();
  const ranges: Range[] = [];
  let searchFrom = 0;

  while (searchFrom <= normalizedText.length - normalizedQuery.length) {
    const matchIndex = normalizedText.indexOf(normalizedQuery, searchFrom);
    if (matchIndex < 0) break;
    const range = createRange(spans, matchIndex, matchIndex + normalizedQuery.length);
    if (range) ranges.push(range);
    searchFrom = matchIndex + normalizedQuery.length;
  }

  return ranges;
};

export function clearConversationSearchHighlights(): void {
  const api = getHighlightApi();
  if (!api) return;
  try {
    api.registry.delete(ConversationSearchHighlightName.Match);
    api.registry.delete(ConversationSearchHighlightName.Active);
  } catch (error) {
    logHighlightFailureOnce('Failed to clear browser search highlights.', error);
  }
}

export function applyConversationSearchHighlights(
  container: HTMLElement,
  query: string,
  matches: CoworkConversationSearchMatch[],
  activeMatchKey: string | null,
): ConversationSearchHighlightResult {
  try {
    clearConversationSearchHighlights();

    const api = getHighlightApi();
    const messageElements = new Map<string, HTMLElement>();
    for (const element of container.querySelectorAll<HTMLElement>('[data-cowork-search-message-id]')) {
      const messageId = element.dataset.coworkSearchMessageId;
      if (messageId) messageElements.set(messageId, element);
    }
    const groupedMatches = new Map<string, CoworkConversationSearchMatch[]>();
    for (const match of matches) {
      if (!messageElements.has(match.messageId)) continue;
      const messageMatches = groupedMatches.get(match.messageId) ?? [];
      messageMatches.push(match);
      groupedMatches.set(match.messageId, messageMatches);
    }

    const regularRanges: Range[] = [];
    const activeRanges: Range[] = [];
    let activeElement: HTMLElement | null = null;
    let activeRange: Range | null = null;

    for (const [messageId, messageMatches] of groupedMatches) {
      const element = messageElements.get(messageId);
      if (!element) continue;
      const ranges = getConversationSearchRanges(element, query);

      for (const match of messageMatches) {
        const range = ranges[match.occurrenceIndex];
        if (match.key === activeMatchKey) {
          activeElement = element;
          activeRange = range ?? null;
          if (range) activeRanges.push(range);
        } else if (range) {
          regularRanges.push(range);
        }
      }
    }

    if (api) {
      if (regularRanges.length > 0) {
        api.registry.set(
          ConversationSearchHighlightName.Match,
          new api.HighlightClass(...regularRanges),
        );
      }
      if (activeRanges.length > 0) {
        api.registry.set(
          ConversationSearchHighlightName.Active,
          new api.HighlightClass(...activeRanges),
        );
      }
    }

    hasLoggedHighlightFailure = false;
    return { activeElement, activeRange };
  } catch (error) {
    logHighlightFailureOnce('Failed to apply browser search highlights.', error);
    return { activeElement: null, activeRange: null };
  }
}
