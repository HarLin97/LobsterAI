export const ActivityRendererLogSource = {
  DailyCheckIn: 'DailyCheckIn',
  StartupCreditCampaign: 'StartupCreditCampaign',
} as const;

export type ActivityRendererLogSource =
  typeof ActivityRendererLogSource[keyof typeof ActivityRendererLogSource];

export type ActivityRendererLogLevel = 'debug' | 'warn';

const formatDiagnosticError = (error: unknown): string => {
  try {
    const message = error instanceof Error ? error.message : String(error);
    return message.replace(/\s+/g, ' ').trim().slice(0, 500);
  } catch {
    return 'unserializable error';
  }
};

export const logActivityRendererDiagnostic = (
  source: ActivityRendererLogSource,
  level: ActivityRendererLogLevel,
  message: string,
  error?: unknown,
): void => {
  const persistedMessage = error === undefined
    ? message
    : `${message}: ${formatDiagnosticError(error)}`;
  if (level === 'warn') {
    console.warn(`[${source}] ${message}`, ...(error === undefined ? [] : [error]));
  } else {
    console.debug(`[${source}] ${message}`);
  }
  try {
    window.electron?.log?.fromRenderer?.(level, source, persistedMessage);
  } catch {
    // Diagnostics must never interrupt an activity request or user action.
  }
};
