import { expect, test } from 'vitest';

import type { CoworkMessage } from '../../types/cowork';
import {
  buildConversationTurns,
  buildDisplayItems,
  formatElapsedDuration,
  formatStructuredText,
  getActivityIndicatorStatusText,
  getToolResultCollapsedDisplay,
  getToolResultDisplay,
  getTurnActivityFingerprint,
  getTurnMessageIds,
  STRUCTURED_TEXT_FORMAT_MAX_CHARS,
  TOOL_RESULT_COLLAPSED_FULL_DISPLAY_MAX_CHARS,
  turnHasSelfIndicatingActivity,
} from './messageDisplayUtils';

const createToolResultMessage = (content: string): CoworkMessage => ({
  id: 'tool-result-test',
  type: 'tool_result',
  content,
  timestamp: 0,
});

test('turn message IDs include both the user and assistant messages', () => {
  const messages: CoworkMessage[] = [{
    id: 'user-1',
    type: 'user',
    content: 'question',
    timestamp: 1,
  }, {
    id: 'assistant-1',
    type: 'assistant',
    content: 'answer',
    timestamp: 2,
  }];

  const [turn] = buildConversationTurns(buildDisplayItems(messages));

  expect([...getTurnMessageIds(turn)]).toEqual(['user-1', 'assistant-1']);
});

test('orphan turn IDs stay unique across paged windows', () => {
  const firstWindow = buildConversationTurns(buildDisplayItems([{
    id: 'assistant-window-one',
    type: 'assistant',
    content: 'first window',
    timestamp: 1,
  }]));
  const secondWindow = buildConversationTurns(buildDisplayItems([{
    id: 'assistant-window-two',
    type: 'assistant',
    content: 'second window',
    timestamp: 2,
  }]));

  expect(firstWindow[0].id).toBe('orphan-assistant-window-one');
  expect(secondWindow[0].id).toBe('orphan-assistant-window-two');
  expect(secondWindow[0].id).not.toBe(firstWindow[0].id);
});

test('tool result display still formats small JSON output', () => {
  const message = createToolResultMessage('{"ok":true,"count":2}');

  expect(getToolResultDisplay(message)).toBe('{\n  "ok": true,\n  "count": 2\n}');
});

test('structured text formatting skips oversized JSON output', () => {
  const oversizedJson = `{"value":"${'x'.repeat(STRUCTURED_TEXT_FORMAT_MAX_CHARS)}"}`;

  expect(formatStructuredText(oversizedJson)).toBe(oversizedJson);
});

test('collapsed tool result display keeps small output details', () => {
  const collapsed = getToolResultCollapsedDisplay(createToolResultMessage('line one\nline two'));

  expect(collapsed.hasText).toBe(true);
  expect(collapsed.isLarge).toBe(false);
  expect(collapsed.lineCount).toBe(2);
  expect(collapsed.text).toBe('line one\nline two');
});

test('collapsed tool result display summarizes medium output without structured formatting', () => {
  const mediumJson = `{"value":"${'x'.repeat(TOOL_RESULT_COLLAPSED_FULL_DISPLAY_MAX_CHARS)}"}`;
  const collapsed = getToolResultCollapsedDisplay(createToolResultMessage(mediumJson));

  expect(collapsed.hasText).toBe(true);
  expect(collapsed.isLarge).toBe(true);
  expect(collapsed.sizeLabel).not.toBeNull();
  expect(collapsed.lineCount).toBe(0);
  expect(collapsed.text.length).toBeLessThan(mediumJson.length);
  expect(collapsed.text).not.toContain('\n  "value"');
});

test('collapsed tool result display summarizes large output without full formatting', () => {
  const largeOutput = `first line\n${'x'.repeat(TOOL_RESULT_COLLAPSED_FULL_DISPLAY_MAX_CHARS)}`;
  const collapsed = getToolResultCollapsedDisplay(createToolResultMessage(largeOutput));

  expect(collapsed.hasText).toBe(true);
  expect(collapsed.isLarge).toBe(true);
  expect(collapsed.sizeLabel).not.toBeNull();
  expect(collapsed.lineCount).toBe(0);
  expect(collapsed.text.length).toBeLessThan(largeOutput.length);
  expect(collapsed.text).toContain('first line');
});

test('activity indicator status defaults to thinking and escalates for long waits', () => {
  expect(getActivityIndicatorStatusText()).toBe('正在思考');
  expect(getActivityIndicatorStatusText(true)).toBe('正在整理上下文...');
  expect(getActivityIndicatorStatusText(false, true)).toBe('模型仍在响应，请耐心等待…');
});

test('elapsed duration formats seconds, minutes, and hours', () => {
  expect(formatElapsedDuration(-500)).toBe('0s');
  expect(formatElapsedDuration(8_400)).toBe('8s');
  expect(formatElapsedDuration(84_000)).toBe('1m 24s');
  expect(formatElapsedDuration(3_720_000)).toBe('1h 2m');
});

const buildTurn = (messages: CoworkMessage[]) =>
  buildConversationTurns(buildDisplayItems(messages))[0];

test('pending tool call counts as self-indicating activity', () => {
  const turn = buildTurn([{
    id: 'user-1',
    type: 'user',
    content: 'hello',
    timestamp: 1,
  }, {
    id: 'tool-1',
    type: 'tool_use',
    content: '',
    timestamp: 2,
    metadata: {
      toolUseId: 'tool-use-1',
      toolName: 'exec_command',
    },
  }]);

  expect(turnHasSelfIndicatingActivity(turn)).toBe(true);
});

test('resolved tool call is not self-indicating activity', () => {
  const turn = buildTurn([{
    id: 'user-1',
    type: 'user',
    content: 'hello',
    timestamp: 1,
  }, {
    id: 'tool-1',
    type: 'tool_use',
    content: '',
    timestamp: 2,
    metadata: {
      toolUseId: 'tool-use-1',
      toolName: 'exec_command',
    },
  }, {
    id: 'result-1',
    type: 'tool_result',
    content: 'done',
    timestamp: 3,
    metadata: {
      toolUseId: 'tool-use-1',
    },
  }]);

  expect(turnHasSelfIndicatingActivity(turn)).toBe(false);
});

test('streaming thinking block counts as self-indicating activity', () => {
  const turn = buildTurn([{
    id: 'user-1',
    type: 'user',
    content: 'hello',
    timestamp: 1,
  }, {
    id: 'thinking-1',
    type: 'assistant',
    content: 'pondering',
    timestamp: 2,
    metadata: {
      isThinking: true,
      isStreaming: true,
    },
  }]);

  expect(turnHasSelfIndicatingActivity(turn)).toBe(true);
});

test('turn activity fingerprint changes as streamed content grows', () => {
  const baseMessages: CoworkMessage[] = [{
    id: 'user-1',
    type: 'user',
    content: 'hello',
    timestamp: 1,
  }, {
    id: 'assistant-1',
    type: 'assistant',
    content: 'partial',
    timestamp: 2,
  }];
  const grownMessages: CoworkMessage[] = [
    baseMessages[0],
    { ...baseMessages[1], content: 'partial plus more text' },
  ];

  const before = getTurnActivityFingerprint(buildTurn(baseMessages));
  const after = getTurnActivityFingerprint(buildTurn(grownMessages));

  expect(before).not.toBe(after);
});
