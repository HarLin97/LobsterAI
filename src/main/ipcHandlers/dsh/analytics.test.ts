import { describe, expect, test } from 'vitest';

import { LogReporterAction, LogReporterSource } from '../../../shared/analytics/constants';
import { DshEngineErrorCode, DshEnginePhase } from '../../../shared/dshEngine/constants';
import {
  buildDshEnabledChangedEvent,
  buildDshOpenWorkbenchEvent,
  DSH_ANALYTICS_ERROR_DETAIL_MAX_LENGTH,
  DshAnalyticsActionType,
  DshAnalyticsErrorCode,
  DshAnalyticsResult,
  DshAnalyticsSettingKey,
  resolveDshEngineErrorCode,
  sanitizeDshErrorDetail,
} from './analytics';

const MAC_HOME = '/Users/jane doe';
const WIN_HOME = 'C:\\Users\\Jane Doe';

describe('sanitizeDshErrorDetail', () => {
  test('replaces the home directory with ~ and keeps the tail for diagnosis', () => {
    const error = new Error(`Invalid dsh runtime manifest at ${MAC_HOME}/Library/Application Support/LobsterAI/dsh/manifest.json`);
    expect(sanitizeDshErrorDetail(error, MAC_HOME)).toBe(
      'Invalid dsh runtime manifest at ~/Library/Application Support/LobsterAI/dsh/manifest.json'
    );
  });

  test('masks absolute posix paths outside the home directory', () => {
    const error = new Error('spawn /opt/homebrew/bin/tar ENOENT');
    expect(sanitizeDshErrorDetail(error, MAC_HOME)).toBe('spawn <path> ENOENT');
  });

  test('masks another user home even when it is not the current one', () => {
    const error = new Error('Another dsh is using /Users/someone-else/.dsh (lock_held)');
    expect(sanitizeDshErrorDetail(error, MAC_HOME)).toBe('Another dsh is using <path> (lock_held)');
  });

  test('recognises a windows home logged with either separator', () => {
    expect(sanitizeDshErrorDetail(new Error(`EPERM: ${WIN_HOME}\\AppData\\Roaming\\LobsterAI\\dsh`), WIN_HOME)).toBe(
      'EPERM: ~\\AppData\\Roaming\\LobsterAI\\dsh'
    );
    expect(sanitizeDshErrorDetail(new Error('EPERM: c:/users/jane doe/AppData/Roaming'), WIN_HOME)).toBe(
      'EPERM: ~/AppData/Roaming'
    );
  });

  test('masks drive-letter windows paths outside the home directory', () => {
    const error = new Error('tar not found at D:\\Tools\\tar.exe');
    expect(sanitizeDshErrorDetail(error, WIN_HOME)).toBe('tar not found at <path>');
  });

  test('drops url queries and fragments but keeps the origin and path', () => {
    const error = new Error('HTTP 403 from https://dl.example.com/dsh/rc7.tgz?token=secret#frag');
    expect(sanitizeDshErrorDetail(error, MAC_HOME)).toBe('HTTP 403 from https://dl.example.com/dsh/rc7.tgz');
  });

  test('keeps structured messages untouched', () => {
    const error = new Error('DeepSeek Harness engine failed to start (phase=failed, error=ready_timeout)');
    expect(sanitizeDshErrorDetail(error, MAC_HOME)).toBe(
      'DeepSeek Harness engine failed to start (phase=failed, error=ready_timeout)'
    );
    expect(sanitizeDshErrorDetail(new Error('Archive sha256 mismatch: expected abc, got def'), MAC_HOME)).toBe(
      'Archive sha256 mismatch: expected abc, got def'
    );
  });

  test('collapses whitespace and truncates long messages', () => {
    const error = new Error(`first line\n  second\tline ${'x'.repeat(400)}`);
    const detail = sanitizeDshErrorDetail(error, MAC_HOME);
    expect(detail.startsWith('first line second line xxx')).toBe(true);
    expect(detail).toHaveLength(DSH_ANALYTICS_ERROR_DETAIL_MAX_LENGTH);
    expect(detail.endsWith('…')).toBe(true);
  });

  test('accepts non-Error values and an empty home directory', () => {
    expect(sanitizeDshErrorDetail('plain string failure', '')).toBe('plain string failure');
    expect(sanitizeDshErrorDetail({ code: 42 }, '')).toBe('[object Object]');
    expect(sanitizeDshErrorDetail(undefined, '')).toBe('undefined');
  });
});

describe('buildDshEnabledChangedEvent', () => {
  test('reports an actual toggle with previous and next values', () => {
    expect(buildDshEnabledChangedEvent(false, true)).toEqual({
      action: LogReporterAction.ExperimentalSettingChanged,
      settingKey: DshAnalyticsSettingKey.Enabled,
      settingValue: true,
      previousValue: false,
      source: LogReporterSource.SettingsExperimental,
    });
    expect(buildDshEnabledChangedEvent(true, false)?.settingValue).toBe(false);
  });

  test('returns null when the value did not change', () => {
    expect(buildDshEnabledChangedEvent(true, true)).toBeNull();
    expect(buildDshEnabledChangedEvent(false, false)).toBeNull();
  });
});

describe('resolveDshEngineErrorCode', () => {
  test('uses the engine code only in terminal failure phases', () => {
    expect(resolveDshEngineErrorCode({ phase: DshEnginePhase.Failed, errorCode: DshEngineErrorCode.InstallFailed }))
      .toBe(DshEngineErrorCode.InstallFailed);
    expect(resolveDshEngineErrorCode({ phase: DshEnginePhase.NotInstalled, errorCode: DshEngineErrorCode.RuntimeMissing }))
      .toBe(DshEngineErrorCode.RuntimeMissing);
  });

  test('falls back to unknown when the phase carries no code for this failure', () => {
    expect(resolveDshEngineErrorCode({ phase: DshEnginePhase.Failed, errorCode: null })).toBe(DshAnalyticsErrorCode.Unknown);
    expect(resolveDshEngineErrorCode({ phase: DshEnginePhase.Ready, errorCode: DshEngineErrorCode.InstallFailed }))
      .toBe(DshAnalyticsErrorCode.Unknown);
    expect(resolveDshEngineErrorCode({ phase: DshEnginePhase.Stopped, errorCode: null })).toBe(DshAnalyticsErrorCode.Unknown);
  });
});

describe('buildDshOpenWorkbenchEvent', () => {
  test('omits error fields on success', () => {
    expect(buildDshOpenWorkbenchEvent({ phaseBefore: DshEnginePhase.Ready, result: DshAnalyticsResult.Success })).toEqual({
      action: LogReporterAction.DshAction,
      actionType: DshAnalyticsActionType.OpenWorkbench,
      source: LogReporterSource.SettingsExperimental,
      phaseBefore: DshEnginePhase.Ready,
      result: DshAnalyticsResult.Success,
      errorCode: undefined,
      errorDetail: undefined,
    });
  });

  test('carries the error class and a masked detail on failure', () => {
    const event = buildDshOpenWorkbenchEvent({
      phaseBefore: DshEnginePhase.NotInstalled,
      result: DshAnalyticsResult.Failed,
      errorCode: DshEngineErrorCode.InstallFailed,
      error: new Error(`Extracted runtime is incomplete at ${MAC_HOME}/Library/dsh, missing: bin/dsh`),
      homeDir: MAC_HOME,
    });
    expect(event.result).toBe(DshAnalyticsResult.Failed);
    expect(event.errorCode).toBe(DshEngineErrorCode.InstallFailed);
    expect(event.errorDetail).toBe('Extracted runtime is incomplete at ~/Library/dsh, missing: bin/dsh');
  });

  test('defaults a failure without a class to unknown and skips detail without an error', () => {
    const event = buildDshOpenWorkbenchEvent({ phaseBefore: DshEnginePhase.Stopped, result: DshAnalyticsResult.Failed });
    expect(event.errorCode).toBe(DshAnalyticsErrorCode.Unknown);
    expect(event.errorDetail).toBeUndefined();
  });
});
