import { describe, expect, test } from 'vitest';

import { parseThinkingProfileMap } from '../../../openclaw-extensions/lobsterai-model-compat/thinkingProfileMapping';

describe('parseThinkingProfileMap', () => {
  test('keeps valid model profiles and drops malformed entries', () => {
    expect(parseThinkingProfileMap({
      'lobsterai-server/deepseek-v4-flash': {
        levels: ['off', 'high', 'max'],
        defaultLevel: 'high',
        requestOptionsVersion: 1,
      },
      'missing-separator': {
        levels: ['high'],
        defaultLevel: 'high',
      },
      'lobsterai-server/invalid': {
        levels: ['off', 'future'],
        defaultLevel: 'future',
      },
    })).toEqual({
      'lobsterai-server/deepseek-v4-flash': {
        levels: ['off', 'high', 'max'],
        defaultLevel: 'high',
        requestOptionsVersion: 1,
      },
    });
  });
});
