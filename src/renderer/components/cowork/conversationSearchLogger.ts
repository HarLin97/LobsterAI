type ConversationSearchLogLevel = 'debug' | 'warn';

const persistConversationSearchLog = (
  level: ConversationSearchLogLevel,
  message: string,
): void => {
  try {
    window.electron?.log?.fromRenderer?.(level, 'ConversationSearch', message);
  } catch {
    // Renderer logging is best-effort and must never affect search behavior.
  }
};

export const logConversationSearchDebug = (message: string): void => {
  console.debug(`[ConversationSearch] ${message}`);
  persistConversationSearchLog('debug', message);
};

export const logConversationSearchWarning = (
  message: string,
  error?: unknown,
): void => {
  if (error === undefined) {
    console.warn(`[ConversationSearch] ${message}`);
  } else {
    console.warn(`[ConversationSearch] ${message}`, error);
  }
  persistConversationSearchLog('warn', message);
};
