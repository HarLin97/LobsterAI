export const LobsterAIThinkingLevel = {
  Off: 'off',
  Minimal: 'minimal',
  Low: 'low',
  Medium: 'medium',
  High: 'high',
  XHigh: 'xhigh',
  Max: 'max',
} as const;

export type LobsterAIThinkingLevel =
  typeof LobsterAIThinkingLevel[keyof typeof LobsterAIThinkingLevel];

export type LobsterAIThinkingProfile = {
  levels: LobsterAIThinkingLevel[];
  defaultLevel: LobsterAIThinkingLevel;
};

export type LobsterAIThinkingProfileMap = Record<string, LobsterAIThinkingProfile>;

const LEVELS = new Set<string>(Object.values(LobsterAIThinkingLevel));

const isRecord = (value: unknown): value is Record<string, unknown> => (
  !!value && typeof value === 'object' && !Array.isArray(value)
);

const isModelRef = (value: string): boolean => {
  const separatorIndex = value.indexOf('/');
  return separatorIndex > 0
    && separatorIndex < value.length - 1
    && !/\s/.test(value);
};

const parseThinkingProfile = (value: unknown): LobsterAIThinkingProfile | undefined => {
  if (!isRecord(value) || !Array.isArray(value.levels) || value.levels.length === 0) {
    return undefined;
  }
  const levels: LobsterAIThinkingLevel[] = [];
  const seen = new Set<string>();
  for (const rawLevel of value.levels) {
    if (typeof rawLevel !== 'string' || !LEVELS.has(rawLevel) || seen.has(rawLevel)) {
      return undefined;
    }
    seen.add(rawLevel);
    levels.push(rawLevel as LobsterAIThinkingLevel);
  }
  if (levels.length === 1 && levels[0] === LobsterAIThinkingLevel.Off) {
    return undefined;
  }
  if (typeof value.defaultLevel !== 'string' || !seen.has(value.defaultLevel)) {
    return undefined;
  }
  return {
    levels,
    defaultLevel: value.defaultLevel as LobsterAIThinkingLevel,
  };
};

export const parseThinkingProfileMap = (value: unknown): LobsterAIThinkingProfileMap => {
  if (!isRecord(value)) return {};
  const result: LobsterAIThinkingProfileMap = {};
  for (const [modelRef, rawProfile] of Object.entries(value).sort(([left], [right]) =>
    left.localeCompare(right))) {
    const profile = parseThinkingProfile(rawProfile);
    if (isModelRef(modelRef) && profile) {
      result[modelRef] = profile;
    }
  }
  return result;
};
