export const ModelThinkingLevel = {
  Off: 'off',
  Minimal: 'minimal',
  Low: 'low',
  Medium: 'medium',
  High: 'high',
  XHigh: 'xhigh',
  Max: 'max',
} as const;

export type ModelThinkingLevel =
  typeof ModelThinkingLevel[keyof typeof ModelThinkingLevel];

export interface ModelThinkingConfig {
  levels: ModelThinkingLevel[];
  defaultLevel: ModelThinkingLevel;
}

const MODEL_THINKING_LEVEL_VALUES = new Set<string>(
  Object.values(ModelThinkingLevel),
);

export const parseModelThinkingLevel = (
  value: unknown,
): ModelThinkingLevel | undefined => (
  typeof value === 'string' && MODEL_THINKING_LEVEL_VALUES.has(value)
    ? value as ModelThinkingLevel
    : undefined
);

export const parseModelThinkingConfig = (
  value: unknown,
): ModelThinkingConfig | undefined => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return undefined;
  }

  const candidate = value as Record<string, unknown>;
  if (!Array.isArray(candidate.levels) || candidate.levels.length === 0) {
    return undefined;
  }

  const levels: ModelThinkingLevel[] = [];
  const seen = new Set<ModelThinkingLevel>();
  for (const rawLevel of candidate.levels) {
    const level = parseModelThinkingLevel(rawLevel);
    if (!level || seen.has(level)) {
      return undefined;
    }
    seen.add(level);
    levels.push(level);
  }
  if (levels.length === 1 && levels[0] === ModelThinkingLevel.Off) {
    return undefined;
  }

  const defaultLevel = parseModelThinkingLevel(candidate.defaultLevel);
  if (!defaultLevel || !seen.has(defaultLevel)) {
    return undefined;
  }

  return { levels, defaultLevel };
};
