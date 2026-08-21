// Usage-analytics event builders for the experimental DeepSeek Harness
// feature. Kept pure and Electron-free so the error-detail masking rules are
// unit-testable; handlers.ts hands the results to the main-process reporter.

import { LogReporterAction, LogReporterSource } from '../../../shared/analytics/constants';
import { type DshEngineErrorCode, DshEnginePhase } from '../../../shared/dshEngine/constants';
import type { MainLogEventParams } from '../../libs/mainLogReporter';

export const DshAnalyticsActionType = {
  OpenWorkbench: 'open_workbench',
} as const;
export type DshAnalyticsActionType = typeof DshAnalyticsActionType[keyof typeof DshAnalyticsActionType];

export const DshAnalyticsSettingKey = {
  Enabled: 'dshEnabled',
} as const;
export type DshAnalyticsSettingKey = typeof DshAnalyticsSettingKey[keyof typeof DshAnalyticsSettingKey];

export const DshAnalyticsResult = {
  Success: 'success',
  Failed: 'failed',
} as const;
export type DshAnalyticsResult = typeof DshAnalyticsResult[keyof typeof DshAnalyticsResult];

// Failure classes that do not come from the engine state machine.
export const DshAnalyticsErrorCode = {
  NotEnabled: 'not_enabled',
  Unknown: 'unknown',
} as const;
export type DshAnalyticsErrorCode = typeof DshAnalyticsErrorCode[keyof typeof DshAnalyticsErrorCode];

export const DSH_ANALYTICS_ERROR_DETAIL_MAX_LENGTH = 200;

const HOME_PLACEHOLDER = '~';
const PATH_PLACEHOLDER = '<path>';

// Query strings and fragments are where URLs carry tokens; the origin and
// path of a loopback URL are harmless and useful.
const URL_QUERY_PATTERN = /(https?:\/\/[^\s?#'"]+)[?#][^\s'"]*/gi;
// Two or more POSIX segments not already attached to `~`, a word, or another
// slash (so a `~/Library/...` tail and the `//host/path` part of a URL survive).
const POSIX_PATH_PATTERN = /(?<![\w~/])(?:\/[^\s/:'"`,;()[\]<>]+){2,}\/?/g;
// Drive-letter Windows paths, either separator.
const WINDOWS_PATH_PATTERN = /(?<![\w~])[A-Za-z]:[\\/](?:[^\s\\/:'"`,;()[\]<>]+[\\/]?)+/g;

const escapeRegExp = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// Matches the home directory with either separator style so a Windows path
// that was logged with forward slashes is still recognised.
const buildHomeDirPattern = (homeDir: string): RegExp | null => {
  const trimmed = homeDir.trim().replace(/[\\/]+$/, '');
  if (!trimmed) return null;
  const source = trimmed
    .split(/[\\/]+/)
    .map(escapeRegExp)
    .join('[\\\\/]+');
  return new RegExp(source, 'gi');
};

const errorMessage = (error: unknown): string => {
  if (error instanceof Error) return error.message;
  if (typeof error === 'string') return error;
  try {
    return String(error);
  } catch {
    return '';
  }
};

/**
 * Reduces an error to a short diagnostic string safe to ship with an event:
 * the user's home directory becomes `~`, other absolute paths become
 * `<path>`, URL queries are dropped, whitespace is collapsed, and the result
 * is capped at DSH_ANALYTICS_ERROR_DETAIL_MAX_LENGTH characters.
 */
export function sanitizeDshErrorDetail(error: unknown, homeDir: string): string {
  let detail = errorMessage(error).replace(URL_QUERY_PATTERN, '$1');
  const homePattern = buildHomeDirPattern(homeDir);
  if (homePattern) {
    detail = detail.replace(homePattern, HOME_PLACEHOLDER);
  }
  detail = detail
    .replace(WINDOWS_PATH_PATTERN, PATH_PLACEHOLDER)
    .replace(POSIX_PATH_PATTERN, PATH_PLACEHOLDER)
    .replace(/\s+/g, ' ')
    .trim();
  if (detail.length > DSH_ANALYTICS_ERROR_DETAIL_MAX_LENGTH) {
    detail = `${detail.slice(0, DSH_ANALYTICS_ERROR_DETAIL_MAX_LENGTH - 1)}…`;
  }
  return detail;
}

/** Null when nothing changed, so a repeated toggle to the same value is not counted. */
export function buildDshEnabledChangedEvent(previous: boolean, next: boolean): MainLogEventParams | null {
  if (previous === next) return null;
  return {
    action: LogReporterAction.ExperimentalSettingChanged,
    settingKey: DshAnalyticsSettingKey.Enabled,
    settingValue: next,
    previousValue: previous,
    source: LogReporterSource.SettingsExperimental,
  };
}

// Only the terminal phases carry a code that describes *this* failure; in
// any other phase the field is either null or left over from an earlier run.
export function resolveDshEngineErrorCode(state: {
  phase: DshEnginePhase;
  errorCode: DshEngineErrorCode | null;
}): string {
  if (state.phase === DshEnginePhase.Failed || state.phase === DshEnginePhase.NotInstalled) {
    return state.errorCode ?? DshAnalyticsErrorCode.Unknown;
  }
  return DshAnalyticsErrorCode.Unknown;
}

export interface DshOpenWorkbenchEventInput {
  /** Engine phase when the user clicked, before any install/start ran. */
  phaseBefore: string;
  result: DshAnalyticsResult;
  /** Failure class; required for failed results. */
  errorCode?: string;
  /** Raw error; only a masked, truncated form of its message is reported. */
  error?: unknown;
  homeDir?: string;
}

export function buildDshOpenWorkbenchEvent(input: DshOpenWorkbenchEventInput): MainLogEventParams {
  const failed = input.result === DshAnalyticsResult.Failed;
  const errorDetail = failed && input.error !== undefined
    ? sanitizeDshErrorDetail(input.error, input.homeDir ?? '')
    : '';
  return {
    action: LogReporterAction.DshAction,
    actionType: DshAnalyticsActionType.OpenWorkbench,
    source: LogReporterSource.SettingsExperimental,
    phaseBefore: input.phaseBefore,
    result: input.result,
    errorCode: failed ? (input.errorCode ?? DshAnalyticsErrorCode.Unknown) : undefined,
    errorDetail: errorDetail || undefined,
  };
}
