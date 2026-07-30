import type { EnterpriseQuotaReason } from '../../../shared/enterpriseAccount/constants';
import { EnterpriseQuotaMessageMetadataKey } from '../../../shared/enterpriseAccount/constants';
import { isEnterpriseQuotaReason } from '../../../shared/enterpriseAccount/quotaError';
import {
  type CoworkSession,
  CoworkSessionStatusValue,
} from '../../types/cowork';

export interface EnterpriseQuotaSignal {
  messageId: string;
  reason: EnterpriseQuotaReason;
}

export const findCurrentEnterpriseQuotaSignal = (
  session: CoworkSession | null,
): EnterpriseQuotaSignal | null => {
  if (!session) return null;

  for (let index = session.messages.length - 1; index >= 0; index -= 1) {
    const message = session.messages[index];
    if (message.type === 'user') return null;

    if (message.type === 'tool_result' && message.metadata?.isError === true) {
      const details = message.metadata.toolResultDetails;
      const detailsRecord = details && typeof details === 'object' && !Array.isArray(details)
        ? details as Record<string, unknown>
        : null;
      const reason = detailsRecord?.[EnterpriseQuotaMessageMetadataKey.Reason]
        ?? message.metadata[EnterpriseQuotaMessageMetadataKey.Reason];
      return isEnterpriseQuotaReason(reason)
        ? { messageId: message.id, reason }
        : null;
    }

    if (message.type !== 'system' || typeof message.metadata?.error !== 'string') {
      continue;
    }

    if (session.status !== CoworkSessionStatusValue.Error) return null;
    const reason = message.metadata[EnterpriseQuotaMessageMetadataKey.Reason];
    return isEnterpriseQuotaReason(reason)
      ? { messageId: message.id, reason }
      : null;
  }

  return null;
};
