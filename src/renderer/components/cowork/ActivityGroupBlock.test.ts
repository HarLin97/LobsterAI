import { describe, expect, test } from 'vitest';

import { activityItemHasError } from './ActivityGroupBlock';
import type { ConsolidatedItem } from './messageDisplayUtils';

const makeToolItem = (metadata: Record<string, unknown>): ConsolidatedItem => ({
  type: 'tool_group',
  group: {
    type: 'tool_group',
    toolUse: {
      id: 'tool-use',
      type: 'tool_use',
      content: '',
      timestamp: 1,
      metadata: {},
    },
    toolResult: {
      id: 'tool-result',
      type: 'tool_result',
      content: '',
      timestamp: 2,
      metadata,
    },
  },
});

describe('activityItemHasError', () => {
  test('surfaces completed tool failures at the activity and process headers', () => {
    expect(activityItemHasError(makeToolItem({ isError: true }))).toBe(true);
    expect(activityItemHasError(makeToolItem({ error: 'command failed' }))).toBe(true);
    expect(activityItemHasError(makeToolItem({ isFinal: true }))).toBe(false);
  });
});
