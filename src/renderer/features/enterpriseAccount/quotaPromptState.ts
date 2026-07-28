import type { EnterpriseQuotaReason } from '../../../shared/enterpriseAccount/constants';
import { EnterpriseQuotaMessageMetadataKey } from '../../../shared/enterpriseAccount/constants';
import { isEnterpriseQuotaReason } from '../../../shared/enterpriseAccount/quotaError';
import type { EnterpriseAccountContext } from '../../../shared/enterpriseAccount/types';
import type { Model } from '../../store/slices/modelSlice';
import {
  type CoworkSession,
  CoworkSessionStatusValue,
} from '../../types/cowork';
import { resolveBlockingEnterpriseQuotaReason } from './modelQuotaGate';

export interface EnterpriseQuotaSignal {
  messageId: string;
  reason: EnterpriseQuotaReason;
}

export const findCurrentEnterpriseQuotaSignal = (
  session: CoworkSession | null,
): EnterpriseQuotaSignal | null => {
  if (!session || session.status !== CoworkSessionStatusValue.Error) {
    return null;
  }

  for (let index = session.messages.length - 1; index >= 0; index -= 1) {
    const message = session.messages[index];
    if (message.type !== 'system' || typeof message.metadata?.error !== 'string') {
      continue;
    }

    const reason = message.metadata[EnterpriseQuotaMessageMetadataKey.Reason];
    return isEnterpriseQuotaReason(reason)
      ? { messageId: message.id, reason }
      : null;
  }

  return null;
};

export const resolveActiveEnterpriseQuotaSignal = (
  historicalSignal: EnterpriseQuotaSignal | null,
  context: EnterpriseAccountContext | null,
  model: Pick<Model, 'isServerModel' | 'providerKey'> | null | undefined,
): EnterpriseQuotaSignal | null => {
  if (
    !historicalSignal
    || !context
    || context.quotaStatus.available !== false
  ) {
    return null;
  }

  const blockingReason = resolveBlockingEnterpriseQuotaReason(
    context.quotaStatus.reason,
    model,
  );
  return blockingReason
    ? { messageId: historicalSignal.messageId, reason: blockingReason }
    : null;
};
