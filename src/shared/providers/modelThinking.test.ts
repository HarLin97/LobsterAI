import { describe, expect, test } from 'vitest';

import {
  ModelThinkingLevel,
  parseModelThinkingConfig,
} from './modelThinking';

describe('parseModelThinkingConfig', () => {
  test('accepts canonical levels in server order', () => {
    expect(parseModelThinkingConfig({
      levels: ['off', 'high', 'max'],
      defaultLevel: 'high',
    })).toEqual({
      levels: [
        ModelThinkingLevel.Off,
        ModelThinkingLevel.High,
        ModelThinkingLevel.Max,
      ],
      defaultLevel: ModelThinkingLevel.High,
    });
  });

  test.each([
    null,
    { levels: [], defaultLevel: 'high' },
    { levels: ['off'], defaultLevel: 'off' },
    { levels: ['off', 'high', 'high'], defaultLevel: 'high' },
    { levels: ['off', 'high'], defaultLevel: 'max' },
    { levels: ['off', 'future'], defaultLevel: 'future' },
  ])('rejects malformed config %#', (value) => {
    expect(parseModelThinkingConfig(value)).toBeUndefined();
  });
});
