import { describe, expect, test } from 'vitest';

import {
  EnterpriseMemberRole,
  EnterpriseQuotaMessageMetadataKey,
  EnterpriseQuotaReason,
} from '../../../shared/enterpriseAccount/constants';
import type { EnterpriseAccountContext } from '../../../shared/enterpriseAccount/types';
import { ProviderName } from '../../../shared/providers/constants';
import type { CoworkMessage, CoworkSession } from '../../types/cowork';
import { CoworkSessionStatusValue } from '../../types/cowork';
import {
  findCurrentEnterpriseQuotaSignal,
  resolveActiveEnterpriseQuotaSignal,
} from './quotaPromptState';

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

const createEnterpriseContext = (
  available: boolean,
  reason: EnterpriseQuotaReason | null,
  enterpriseId = 1001,
): EnterpriseAccountContext => ({
  accountMode: 'enterprise',
  enterpriseId,
  memberId: 2001,
  enterpriseName: 'Example enterprise',
  role: EnterpriseMemberRole.Member,
  permissions: {
    manageEnterprise: false,
    adjustMemberQuota: false,
    rechargeEnterprise: false,
  },
  memberQuota: { limit: 100, used: available ? 40 : 100, remaining: available ? 60 : 0 },
  enterprisePool: { total: 1000, used: available ? 400 : 1000, remaining: available ? 600 : 0 },
  quotaStatus: {
    available,
    reason,
    errorCode: reason ? 41606 : null,
  },
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

describe('resolveActiveEnterpriseQuotaSignal', () => {
  const historicalSignal = {
    messageId: 'quota-error',
    reason: EnterpriseQuotaReason.MemberMonthlyQuotaExhausted,
  };
  const serverModel = {
    providerKey: ProviderName.LobsteraiServer,
    isServerModel: true,
  };

  test('keeps the historical signal active while the current server-model quota is unavailable', () => {
    expect(resolveActiveEnterpriseQuotaSignal(
      historicalSignal,
      createEnterpriseContext(false, EnterpriseQuotaReason.EnterprisePoolExhausted),
      serverModel,
    )).toEqual({
      messageId: 'quota-error',
      reason: EnterpriseQuotaReason.EnterprisePoolExhausted,
    });
  });

  test('clears the gate after an administrator restores the current quota', () => {
    expect(resolveActiveEnterpriseQuotaSignal(
      historicalSignal,
      createEnterpriseContext(true, null),
      serverModel,
    )).toBeNull();
  });

  test('clears the gate after switching away from the enterprise account', () => {
    expect(resolveActiveEnterpriseQuotaSignal(
      historicalSignal,
      null,
      serverModel,
    )).toBeNull();
  });

  test('clears the gate after switching to another enterprise account with quota', () => {
    expect(resolveActiveEnterpriseQuotaSignal(
      historicalSignal,
      createEnterpriseContext(true, null, 3001),
      serverModel,
    )).toBeNull();
  });

  test('clears the gate after switching the session to a custom model', () => {
    expect(resolveActiveEnterpriseQuotaSignal(
      historicalSignal,
      createEnterpriseContext(false, EnterpriseQuotaReason.MemberMonthlyQuotaExhausted),
      {
        providerKey: ProviderName.Qwen,
        isServerModel: false,
      },
    )).toBeNull();
  });
});
