import {
  ArrowTopRightOnSquareIcon,
  ExclamationTriangleIcon,
  XMarkIcon,
} from '@heroicons/react/24/outline';
import { useEffect, useState } from 'react';
import { useSelector } from 'react-redux';

import {
  EnterpriseMemberRole,
  EnterpriseQuotaReason,
} from '../../../../shared/enterpriseAccount/constants';
import {
  getEnterpriseOverviewUrl,
  getEnterpriseRechargeUrl,
  getEnterpriseUsageUrl,
} from '../../../services/endpoints';
import { i18nService } from '../../../services/i18n';
import { logEnterpriseAccountDiagnostic } from '../diagnostics';
import type { EnterpriseQuotaSignal } from '../quotaPromptState';
import { selectEnterpriseAccountContext } from '../selectors';

interface EnterpriseQuotaPromptProps {
  signal: EnterpriseQuotaSignal | null;
}

interface PromptAction {
  label: string;
  url: string;
  diagnosticAction: string;
}

export const EnterpriseQuotaPrompt = ({ signal }: EnterpriseQuotaPromptProps) => {
  const context = useSelector(selectEnterpriseAccountContext);
  const [dismissedMessageId, setDismissedMessageId] = useState<string | null>(null);
  const contextRole = context?.role;
  const signalMessageId = signal?.messageId;
  const signalReason = signal?.reason;

  useEffect(() => {
    if (!contextRole || !signalMessageId || !signalReason || dismissedMessageId === signalMessageId) {
      return;
    }
    logEnterpriseAccountDiagnostic(
      'debug',
      `showing quota prompt for reason ${signalReason} and role ${contextRole}`,
    );
  }, [contextRole, dismissedMessageId, signalMessageId, signalReason]);

  if (
    !context
    || !signal
    || dismissedMessageId === signal.messageId
  ) {
    return null;
  }

  const isSuperAdmin = context.role === EnterpriseMemberRole.SuperAdmin;
  let title = '';
  let description = '';
  const actions: PromptAction[] = [];

  switch (signal.reason) {
    case EnterpriseQuotaReason.MemberMonthlyQuotaExhausted:
      title = i18nService.t(
        isSuperAdmin ? 'enterpriseQuotaMemberAdminTitle' : 'enterpriseQuotaMemberTitle',
      );
      description = i18nService.t(
        isSuperAdmin ? 'enterpriseQuotaMemberAdminDesc' : 'enterpriseQuotaMemberMemberDesc',
      );
      if (isSuperAdmin && context.permissions.adjustMemberQuota) {
        actions.push({
          label: i18nService.t('enterpriseAccountAdjustQuota'),
          url: getEnterpriseUsageUrl(context.enterpriseId),
          diagnosticAction: 'open usage and quotas',
        });
      }
      break;
    case EnterpriseQuotaReason.EnterprisePoolExhausted:
      title = i18nService.t('enterpriseQuotaPoolTitle');
      description = i18nService.t(
        isSuperAdmin ? 'enterpriseQuotaPoolAdminDesc' : 'enterpriseQuotaPoolMemberDesc',
      );
      if (isSuperAdmin && context.permissions.manageEnterprise) {
        actions.push({
          label: i18nService.t('enterpriseQuotaGoAdmin'),
          url: getEnterpriseOverviewUrl(context.enterpriseId),
          diagnosticAction: 'open enterprise overview',
        });
      }
      if (isSuperAdmin && context.permissions.rechargeEnterprise) {
        actions.push({
          label: i18nService.t('enterpriseQuotaRechargeOrAdjust'),
          url: getEnterpriseRechargeUrl(context.enterpriseId),
          diagnosticAction: 'open enterprise recharge',
        });
      }
      break;
    case EnterpriseQuotaReason.EnterpriseCreditBatchesExpired:
      title = i18nService.t('enterpriseQuotaExpiredTitle');
      description = i18nService.t(
        isSuperAdmin ? 'enterpriseQuotaExpiredAdminDesc' : 'enterpriseQuotaExpiredMemberDesc',
      );
      if (isSuperAdmin && context.permissions.manageEnterprise) {
        actions.push({
          label: i18nService.t('enterpriseQuotaGoAdmin'),
          url: getEnterpriseOverviewUrl(context.enterpriseId),
          diagnosticAction: 'open enterprise overview',
        });
      }
      if (isSuperAdmin && context.permissions.rechargeEnterprise) {
        actions.push({
          label: i18nService.t('enterpriseQuotaRechargeOrAdjust'),
          url: getEnterpriseRechargeUrl(context.enterpriseId),
          diagnosticAction: 'open enterprise recharge',
        });
      }
      break;
  }

  const openPortalUrl = async (action: PromptAction) => {
    logEnterpriseAccountDiagnostic('debug', action.diagnosticAction);
    try {
      await window.electron.shell.openExternal(action.url);
    } catch (error) {
      logEnterpriseAccountDiagnostic('warn', `${action.diagnosticAction} failed`, error);
    }
  };

  return (
    <div
      className="mb-3 rounded-xl border border-warning/30 bg-warning/10 px-4 py-3 shadow-sm"
      role="alert"
      aria-live="assertive"
    >
      <div className="flex items-start gap-3">
        <ExclamationTriangleIcon
          className="mt-0.5 h-5 w-5 shrink-0 text-warning"
          aria-hidden="true"
        />
        <div className="min-w-0 flex-1">
          <div className="text-sm font-semibold text-foreground">{title}</div>
          <div className="mt-1 text-xs leading-5 text-secondary">{description}</div>
          {actions.length > 0 ? (
            <div className="mt-3 flex flex-wrap gap-2">
              {actions.map(action => (
                <button
                  key={action.url}
                  type="button"
                  onClick={() => void openPortalUrl(action)}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-primary-hover"
                >
                  {action.label}
                  <ArrowTopRightOnSquareIcon className="h-3.5 w-3.5" aria-hidden="true" />
                </button>
              ))}
            </div>
          ) : null}
        </div>
        <button
          type="button"
          onClick={() => {
            logEnterpriseAccountDiagnostic('debug', 'dismissed quota prompt');
            setDismissedMessageId(signal.messageId);
          }}
          className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-secondary transition-colors hover:bg-black/5 hover:text-foreground dark:hover:bg-white/10"
          aria-label={i18nService.t('enterpriseQuotaDismiss')}
        >
          <XMarkIcon className="h-4 w-4" aria-hidden="true" />
        </button>
      </div>
    </div>
  );
};
