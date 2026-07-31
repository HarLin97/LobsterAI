export const CoworkBtwProtocolFamily = {
  DeepSeekDsml: 'deepseek_dsml',
  MiniMaxXml: 'minimax_xml',
  XmlToolCall: 'xml_tool_call',
  LegacyBracket: 'legacy_bracket',
  PlainTextToolCall: 'plain_text_tool_call',
} as const;

export type CoworkBtwProtocolFamily =
  typeof CoworkBtwProtocolFamily[keyof typeof CoworkBtwProtocolFamily];

export interface CoworkBtwSanitizedResult {
  text: string;
  detectedFamilies: CoworkBtwProtocolFamily[];
}

type SegmentSanitizer = (value: string) => string;

const DEEPSEEK_DSML_OPEN_RE =
  /<\s*[|｜]\s*DSML\s*[|｜]\s*(?:tool_use_error|tool_calls?|function_calls)\s*>/gi;
const DEEPSEEK_DSML_CLOSE_RE =
  /<\s*\/\s*[|｜]\s*DSML\s*[|｜]\s*(?:tool_use_error|tool_calls?|function_calls)\s*>/gi;
const MINIMAX_TOOL_OPEN_RE = /<\s*minimax:tool_call\b[^>]*>/gi;
const MINIMAX_TOOL_CLOSE_RE = /<\s*\/\s*minimax:tool_call\s*>/gi;
const XML_TOOL_OPEN_RE =
  /<\s*(?:tool_calls?|tool_result|function_calls?|function_response)\b[^>]*>/gi;
const XML_TOOL_CLOSE_RE =
  /<\s*\/\s*(?:tool_calls?|tool_result|function_calls?|function_response)\s*>/gi;
const LEGACY_BRACKET_OPEN_RE = /\[\s*TOOL_(?:CALL|RESULT)\s*\]/gi;
const LEGACY_BRACKET_CLOSE_RE = /\[\s*\/\s*TOOL_(?:CALL|RESULT)\s*\]/gi;
const PLAIN_TEXT_TOOL_CALL_LINE_RE =
  /^[ \t]*\[tool:[A-Za-z_][A-Za-z0-9_.:-]{0,119}\][^\r\n]*(?:\r?\n|$)/gim;

const resetRegex = (regex: RegExp, lastIndex: number): void => {
  regex.lastIndex = lastIndex;
};

const stripDelimitedProtocolBlocks = (
  value: string,
  openPattern: RegExp,
  closePattern: RegExp,
): string => {
  let result = '';
  let cursor = 0;

  while (cursor < value.length) {
    resetRegex(openPattern, cursor);
    const openMatch = openPattern.exec(value);
    if (!openMatch || openMatch.index === undefined) {
      result += value.slice(cursor);
      break;
    }

    result += value.slice(cursor, openMatch.index);
    resetRegex(closePattern, openPattern.lastIndex);
    const closeMatch = closePattern.exec(value);
    cursor = closeMatch
      ? closePattern.lastIndex
      : value.length;
  }

  return result;
};

const sanitizeOutsideMarkdownCode = (
  value: string,
  sanitize: SegmentSanitizer,
): string => {
  let result = '';
  let cursor = 0;
  let index = 0;

  while (index < value.length) {
    if (value[index] !== '`') {
      index += 1;
      continue;
    }

    let delimiterLength = 1;
    while (value[index + delimiterLength] === '`') {
      delimiterLength += 1;
    }
    const delimiter = '`'.repeat(delimiterLength);
    const closeIndex = value.indexOf(delimiter, index + delimiterLength);
    if (closeIndex < 0) {
      result += sanitize(value.slice(cursor));
      return result;
    }

    result += sanitize(value.slice(cursor, index));
    const codeEnd = closeIndex + delimiterLength;
    result += value.slice(index, codeEnd);
    cursor = codeEnd;
    index = codeEnd;
  }

  result += sanitize(value.slice(cursor));
  return result;
};

const sanitizeFamily = (
  value: string,
  family: CoworkBtwProtocolFamily,
  detectedFamilies: Set<CoworkBtwProtocolFamily>,
  sanitize: SegmentSanitizer,
): string => {
  const sanitized = sanitizeOutsideMarkdownCode(value, sanitize);
  if (sanitized !== value) {
    detectedFamilies.add(family);
  }
  return sanitized;
};

export const sanitizeCoworkBtwResultText = (
  value: string,
): CoworkBtwSanitizedResult => {
  const detectedFamilies = new Set<CoworkBtwProtocolFamily>();
  let text = value;

  text = sanitizeFamily(
    text,
    CoworkBtwProtocolFamily.DeepSeekDsml,
    detectedFamilies,
    segment => stripDelimitedProtocolBlocks(
      segment,
      DEEPSEEK_DSML_OPEN_RE,
      DEEPSEEK_DSML_CLOSE_RE,
    ),
  );
  text = sanitizeFamily(
    text,
    CoworkBtwProtocolFamily.MiniMaxXml,
    detectedFamilies,
    segment => stripDelimitedProtocolBlocks(
      segment,
      MINIMAX_TOOL_OPEN_RE,
      MINIMAX_TOOL_CLOSE_RE,
    ),
  );
  text = sanitizeFamily(
    text,
    CoworkBtwProtocolFamily.LegacyBracket,
    detectedFamilies,
    segment => stripDelimitedProtocolBlocks(
      segment,
      LEGACY_BRACKET_OPEN_RE,
      LEGACY_BRACKET_CLOSE_RE,
    ),
  );
  text = sanitizeFamily(
    text,
    CoworkBtwProtocolFamily.XmlToolCall,
    detectedFamilies,
    segment => stripDelimitedProtocolBlocks(
      segment,
      XML_TOOL_OPEN_RE,
      XML_TOOL_CLOSE_RE,
    ),
  );
  text = sanitizeFamily(
    text,
    CoworkBtwProtocolFamily.PlainTextToolCall,
    detectedFamilies,
    segment => segment.replace(PLAIN_TEXT_TOOL_CALL_LINE_RE, ''),
  );

  return {
    text,
    detectedFamilies: Array.from(detectedFamilies),
  };
};
