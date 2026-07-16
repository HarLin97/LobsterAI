import { describe, expect, test } from 'vitest';

import {
  EnterpriseQuotaMessageMetadataKey,
  EnterpriseQuotaReason,
} from '../../../shared/enterpriseAccount/constants';
import type { CoworkMessage, CoworkSession } from '../../types/cowork';
import { CoworkSessionStatusValue } from '../../types/cowork';
import { findCurrentEnterpriseQuotaSignal } from './quotaPromptState';

const createErrorMessage = (
  id: string,
  reason?: EnterpriseQuotaReason,
): CoworkMessage => ({
  id,
  type: 'system',
  content: 'Request failed',
  timestamp: Date.now(),
  metadata: {
    error: 'Request failed',
    ...(reason ? { [EnterpriseQuotaMessageMetadataKey.Reason]: reason } : {}),
  },
});

const createSession = (
  status: CoworkSession['status'],
  messages: CoworkMessage[],
): CoworkSession => ({
  id: 'session-1',
  title: 'Session',
  claudeSessionId: null,
  status,
  pinned: false,
  cwd: '/tmp',
  systemPrompt: '',
  modelOverride: '',
  executionMode: 'auto',
  activeSkillIds: [],
  agentId: 'main',
  messages,
  messagesOffset: 0,
  totalMessages: messages.length,
  createdAt: Date.now(),
  updatedAt: Date.now(),
});

describe('findCurrentEnterpriseQuotaSignal', () => {
  test('returns the structured reason from the latest terminal error', () => {
    const signal = findCurrentEnterpriseQuotaSignal(createSession(
      CoworkSessionStatusValue.Error,
      [createErrorMessage('quota-error', EnterpriseQuotaReason.EnterprisePoolExhausted)],
    ));

    expect(signal).toEqual({
      messageId: 'quota-error',
      reason: EnterpriseQuotaReason.EnterprisePoolExhausted,
    });
  });

  test('does not revive an old quota prompt after a later unrelated error', () => {
    const signal = findCurrentEnterpriseQuotaSignal(createSession(
      CoworkSessionStatusValue.Error,
      [
        createErrorMessage('old-quota', EnterpriseQuotaReason.MemberMonthlyQuotaExhausted),
        createErrorMessage('current-network-error'),
      ],
    ));

    expect(signal).toBeNull();
  });

  test('does not show quota prompts for a recovered session', () => {
    const signal = findCurrentEnterpriseQuotaSignal(createSession(
      CoworkSessionStatusValue.Completed,
      [createErrorMessage('old-quota', EnterpriseQuotaReason.EnterpriseCreditBatchesExpired)],
    ));

    expect(signal).toBeNull();
  });
});
