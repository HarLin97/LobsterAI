import { describe, expect, test } from 'vitest';

import {
  CoworkBtwProtocolFamily,
  sanitizeCoworkBtwResultText,
} from './coworkBtwResultSanitizer';

describe('sanitizeCoworkBtwResultText', () => {
  test.each([
    {
      name: 'ASCII DeepSeek DSML',
      input: [
        'Before',
        '<|DSML|tool_calls><|DSML|invoke name="read">',
        '<|DSML|parameter name="filePath">/secret/file</|DSML|parameter>',
        '</|DSML|invoke></|DSML|tool_calls>',
        'After',
      ].join('\n'),
      expected: 'Before\n\nAfter',
    },
    {
      name: 'full-width DeepSeek DSML with a mismatched close kind',
      input: 'Before<｜DSML｜tool_call>read</｜DSML｜tool_calls>After',
      expected: 'BeforeAfter',
    },
    {
      name: 'truncated DeepSeek DSML',
      input: 'Visible answer.<｜DSML｜tool_calls>private payload',
      expected: 'Visible answer.',
    },
  ])('removes $name', ({ input, expected }) => {
    const result = sanitizeCoworkBtwResultText(input);

    expect(result.text).toBe(expected);
    expect(result.detectedFamilies).toEqual([CoworkBtwProtocolFamily.DeepSeekDsml]);
  });

  test('removes known non-DSML tool protocol families', () => {
    const input = [
      'Visible',
      '<minimax:tool_call><invoke name="exec">private</invoke></minimax:tool_call>',
      '[TOOL_CALL]{tool => "read", args => {"path":"private"}}[/TOOL_CALL]',
      '<function_calls><invoke name="find">private</invoke></function_calls>',
      '[tool:read] {"path":"/private/file"}',
      'Done',
    ].join('\n');

    const result = sanitizeCoworkBtwResultText(input);

    expect(result.text).toBe('Visible\n\n\n\nDone');
    expect(result.detectedFamilies).toEqual([
      CoworkBtwProtocolFamily.MiniMaxXml,
      CoworkBtwProtocolFamily.LegacyBracket,
      CoworkBtwProtocolFamily.XmlToolCall,
      CoworkBtwProtocolFamily.PlainTextToolCall,
    ]);
  });

  test('preserves literal protocol examples inside inline and fenced code', () => {
    const input = [
      'Use `<|DSML|tool_calls>example</|DSML|tool_calls>` when documenting the protocol.',
      '```xml',
      '<function_calls><invoke name="read">example</invoke></function_calls>',
      '```',
    ].join('\n');

    expect(sanitizeCoworkBtwResultText(input)).toEqual({
      text: input,
      detectedFamilies: [],
    });
  });

  test('does not let an unmatched Markdown delimiter hide provider protocol', () => {
    const input = 'Visible `unfinished example\n<|DSML|tool_calls>private payload';

    expect(sanitizeCoworkBtwResultText(input)).toEqual({
      text: 'Visible `unfinished example\n',
      detectedFamilies: [CoworkBtwProtocolFamily.DeepSeekDsml],
    });
  });

  test('leaves ordinary answers unchanged', () => {
    const input = 'A normal answer with Markdown.\n\n- One\n- Two';

    expect(sanitizeCoworkBtwResultText(input)).toEqual({
      text: input,
      detectedFamilies: [],
    });
  });
});
