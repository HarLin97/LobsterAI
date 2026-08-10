import { expect, test } from 'vitest';

import type { CoworkMessage } from '../../types/cowork';
import {
  buildConversationTurns,
  buildDisplayItems,
  chunkConsolidatedItemsForDisplay,
  type ConsolidatedItem,
  formatActivityDuration,
  formatStructuredText,
  getActivityCurrentActionText,
  getActivityGroupHeaderLabel,
  getActivityGroupSummary,
  getActivityStepDisplay,
  getStreamingActivityStatusText,
  getToolResultCollapsedDisplay,
  getToolResultDisplay,
  getTurnMessageIds,
  isActivityConsolidatedItem,
  STRUCTURED_TEXT_FORMAT_MAX_CHARS,
  TOOL_RESULT_COLLAPSED_FULL_DISPLAY_MAX_CHARS,
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

test('streaming activity status shows generic running before assistant content', () => {
  const messages: CoworkMessage[] = [{
    id: 'user-1',
    type: 'user',
    content: 'hello',
    timestamp: 1,
  }];

  expect(getStreamingActivityStatusText(messages)).toBe('执行中...');
});

test('streaming activity status keeps unresolved tool progress visible', () => {
  const messages: CoworkMessage[] = [{
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
  }];

  expect(getStreamingActivityStatusText(messages)).toBe('执行中 exec_command...');
});

test('streaming activity status shows context maintenance state', () => {
  expect(getStreamingActivityStatusText([], true)).toBe('正在整理上下文...');
});

test('streaming activity status shows a patient waiting hint after prolonged model silence', () => {
  const messages: CoworkMessage[] = [{
    id: 'user-1',
    type: 'user',
    content: 'hello',
    timestamp: 1,
  }];

  expect(getStreamingActivityStatusText(messages, false, true))
    .toBe('模型仍在响应，请耐心等待…');
});

test('streaming activity status keeps unresolved tool progress during a prolonged wait', () => {
  const messages: CoworkMessage[] = [{
    id: 'tool-1',
    type: 'tool_use',
    content: '',
    timestamp: 1,
    metadata: {
      toolUseId: 'tool-use-1',
      toolName: 'exec_command',
    },
  }];

  expect(getStreamingActivityStatusText(messages, false, true))
    .toBe('执行中 exec_command...');
});

// ── Activity grouping ────────────────────────────────────────────────────────

const activityToolItem = (
  id: string,
  toolName = 'Bash',
  timestamps?: { use?: number; result?: number },
  toolInput?: Record<string, unknown>,
): ConsolidatedItem => ({
  type: 'tool_group',
  group: {
    type: 'tool_group',
    toolUse: {
      id,
      type: 'tool_use',
      content: '',
      timestamp: timestamps?.use ?? 0,
      metadata: { toolName, ...(toolInput ? { toolInput } : {}) },
    },
    toolResult: timestamps?.result != null
      ? { id: `${id}-result`, type: 'tool_result', content: 'ok', timestamp: timestamps.result }
      : null,
  },
});

const activityThinkingItem = (id: string): ConsolidatedItem => ({
  type: 'assistant',
  message: {
    id,
    type: 'assistant',
    content: 'thinking...',
    timestamp: 0,
    metadata: { isThinking: true },
  },
});

const activityTextItem = (id: string): ConsolidatedItem => ({
  type: 'assistant',
  message: { id, type: 'assistant', content: 'answer', timestamp: 0 },
});

test('consecutive work items collapse into an activity group and text breaks the run', () => {
  const items: ConsolidatedItem[] = [
    activityThinkingItem('think-1'),
    activityToolItem('tool-1'),
    activityToolItem('tool-2'),
    activityTextItem('text-1'),
    activityToolItem('tool-3'),
  ];

  const chunks = chunkConsolidatedItemsForDisplay(items);

  expect(chunks).toHaveLength(3);
  expect(chunks[0].kind).toBe('activity_group');
  const group = chunks[0] as Extract<typeof chunks[number], { kind: 'activity_group' }>;
  expect(group.entries.map(entry => entry.index)).toEqual([0, 1, 2]);
  expect(chunks[1]).toMatchObject({ kind: 'item', index: 3 });
  // A single trailing work item stays visible on its own.
  expect(chunks[2]).toMatchObject({ kind: 'item', index: 4 });
});

test('activity grouping respects a custom groupable predicate', () => {
  const items: ConsolidatedItem[] = [
    activityToolItem('tool-1'),
    activityToolItem('tool-2'),
    activityToolItem('tool-3'),
    activityToolItem('tool-4'),
  ];

  const chunks = chunkConsolidatedItemsForDisplay(
    items,
    (item) => isActivityConsolidatedItem(item)
      && !(item.type === 'tool_group' && item.group.toolUse.id === 'tool-2'),
  );

  expect(chunks.map(chunk => chunk.kind)).toEqual(['item', 'item', 'activity_group']);
  const trailing = chunks[2] as Extract<typeof chunks[number], { kind: 'activity_group' }>;
  expect(trailing.entries.map(entry => entry.index)).toEqual([2, 3]);
});

test('activity summary counts steps and duration from timestamps', () => {
  const items: ConsolidatedItem[] = [
    activityThinkingItem('think-1'),
    activityToolItem('tool-1', 'Bash', { use: 1000, result: 8000 }),
    activityToolItem('tool-2', 'Bash', { use: 9000, result: 46000 }),
    activityToolItem('tool-3', 'read_file'),
  ];

  const summary = getActivityGroupSummary(items);

  expect(summary.stepCount).toBe(4);
  expect(summary.durationMs).toBe(45000);
  expect(formatActivityDuration(summary.durationMs)).toContain('45');
});

test('activity header label summarizes commands, reads, and edits in natural language', () => {
  expect(getActivityGroupHeaderLabel([
    activityThinkingItem('think-1'),
    activityToolItem('tool-1', 'Bash'),
    activityToolItem('tool-2', 'exec'),
    activityToolItem('tool-3', 'Bash'),
    activityToolItem('tool-4', 'read_file'),
    activityToolItem('tool-5', 'Read'),
  ])).toBe('运行了 3 个命令、读取了 2 个文件');

  expect(getActivityGroupHeaderLabel([
    activityToolItem('tool-1', 'Edit'),
    activityToolItem('tool-2', 'web_fetch'),
  ])).toBe('进行了 1 次编辑、调用了 1 次工具');

  // Thinking-only groups fall back to a dedicated label.
  expect(getActivityGroupHeaderLabel([
    activityThinkingItem('think-1'),
    activityThinkingItem('think-2'),
  ])).toBe('思考过程');
});

test('activity step display shortens file paths to basenames', () => {
  const readStep = getActivityStepDisplay(activityToolItem(
    'tool-1',
    'read_file',
    undefined,
    { file_path: '/Users/dev/project/src/renderer/App.tsx' },
  ));
  expect(readStep).toEqual({ name: 'Read', summary: 'App.tsx' });

  const bashStep = getActivityStepDisplay(activityToolItem(
    'tool-2',
    'Bash',
    undefined,
    { command: 'npm test -- cowork' },
  ));
  expect(bashStep).toEqual({ name: 'Bash', summary: 'npm test -- cowork' });
});

test('activity current action text mirrors the latest step', () => {
  expect(getActivityCurrentActionText(activityThinkingItem('think-1'))).toBe('思考中…');
  expect(getActivityCurrentActionText(activityToolItem(
    'tool-1',
    'read_file',
    undefined,
    { file_path: '/tmp/notes.md' },
  ))).toBe('Read notes.md');
});

test('activity summary omits sub-second and single-timestamp durations', () => {
  expect(getActivityGroupSummary([
    activityToolItem('tool-1', 'Bash', { use: 1000, result: 1500 }),
    activityToolItem('tool-2', 'Bash'),
  ]).durationMs).toBeNull();

  expect(getActivityGroupSummary([
    activityThinkingItem('think-1'),
    activityToolItem('tool-1'),
  ]).durationMs).toBeNull();

  expect(formatActivityDuration(null)).toBeNull();
});

test('media polling groups count their polls as steps', () => {
  const polls = [
    activityToolItem('poll-1', 'lobsterai_video_generate'),
    activityToolItem('poll-2', 'lobsterai_video_generate'),
    activityToolItem('poll-3', 'lobsterai_video_generate'),
  ].map(item => (item as Extract<ConsolidatedItem, { type: 'tool_group' }>).group);

  const mediaItem = {
    type: 'media_polling_group',
    group: {
      type: 'media_polling_group',
      toolName: 'lobsterai_video_generate',
      taskId: 'task-1',
      lastStatus: 'succeeded',
      pollCount: 3,
      polls,
      isComplete: true,
    },
  } as unknown as ConsolidatedItem;

  const summary = getActivityGroupSummary([mediaItem, activityToolItem('tool-1')]);

  expect(summary.stepCount).toBe(4);
});

