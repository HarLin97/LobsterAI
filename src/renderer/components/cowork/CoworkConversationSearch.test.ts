import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { expect, test } from 'vitest';

import {
  CONVERSATION_SEARCH_MATCH_LIMIT,
  ConversationSearchStatus,
} from './conversationSearch';
import CoworkConversationSearch from './CoworkConversationSearch';

test('renders the Codex-style two-row search surface and result count', () => {
  const html = renderToStaticMarkup(React.createElement(CoworkConversationSearch, {
    query: 'needle',
    status: ConversationSearchStatus.Ready,
    activeMatchIndex: 1,
    resultCount: 7,
    isResultLimitReached: false,
    focusRequestKey: 1,
    onQueryChange: () => undefined,
    onNavigate: () => undefined,
    onClose: () => undefined,
  }));

  expect(html).toContain('data-cowork-conversation-search="true"');
  expect(html).toContain('value="needle"');
  expect(html).toMatch(/2 \/ 7 (?:个结果|results)/);
  expect(html).toContain('border-t');
});

test('disables navigation buttons when the query has no results', () => {
  const html = renderToStaticMarkup(React.createElement(CoworkConversationSearch, {
    query: 'missing',
    status: ConversationSearchStatus.Ready,
    activeMatchIndex: -1,
    resultCount: 0,
    isResultLimitReached: false,
    focusRequestKey: 1,
    onQueryChange: () => undefined,
    onNavigate: () => undefined,
    onClose: () => undefined,
  }));

  expect(html.match(/disabled=""/g)).toHaveLength(2);
  expect(html).toMatch(/0 \/ 0 (?:个结果|results)/);
});

test('marks a capped result count', () => {
  const html = renderToStaticMarkup(React.createElement(CoworkConversationSearch, {
    query: 'x',
    status: ConversationSearchStatus.Ready,
    activeMatchIndex: 0,
    resultCount: CONVERSATION_SEARCH_MATCH_LIMIT,
    isResultLimitReached: true,
    focusRequestKey: 1,
    onQueryChange: () => undefined,
    onNavigate: () => undefined,
    onClose: () => undefined,
  }));

  expect(html).toMatch(new RegExp(
    `1 / ${CONVERSATION_SEARCH_MATCH_LIMIT}\\+ (?:个结果|results)`,
  ));
});
