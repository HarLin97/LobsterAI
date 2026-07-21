import {
  ArrowRightStartOnRectangleIcon,
  BuildingOffice2Icon,
  ChartBarIcon,
} from '@heroicons/react/24/outline';
import { type ReactNode, useEffect, useState } from 'react';
import { useSelector } from 'react-redux';

import { EnterpriseMemberRole } from '../../../../shared/enterpriseAccount/constants';
import type {
  EnterpriseAccountContext,
  EnterpriseAccountIdentity,
} from '../../../../shared/enterpriseAccount/types';
import { authService } from '../../../services/auth';
import {
  getEnterpriseMemberProfileUrl,
  getEnterpriseOverviewUrl,
} from '../../../services/endpoints';
import { i18nService } from '../../../services/i18n';
import type { RootState } from '../../../store';
import { logEnterpriseAccountDiagnostic } from '../diagnostics';

interface EnterpriseAccountMenuProps {
  context: EnterpriseAccountContext;
  onClose: () => void;
}

interface MenuActionProps {
  icon: ReactNode;
  label: string;
  onClick: () => void | Promise<void>;
}

const MenuAction = ({ icon, label, onClick }: MenuActionProps) => (
  <button
    type="button"
    onClick={() => void onClick()}
    className="flex w-full cursor-pointer items-center gap-2 px-4 py-2 text-left text-sm text-foreground transition-colors hover:bg-surface-raised"
  >
    {icon}
    <span>{label}</span>
  </button>
);

const actionIconClassName = 'h-4 w-4 shrink-0 text-secondary';

const formatCredits = (credits: number): string => (
  Number.isInteger(credits) ? String(credits) : credits.toFixed(2)
);

export const EnterpriseAccountMenu = ({
  context,
  onClose,
}: EnterpriseAccountMenuProps) => {
  const user = useSelector((state: RootState) => state.auth.user);
  const isSuperAdmin = context.role === EnterpriseMemberRole.SuperAdmin;
  const phoneSuffix = user?.phone ? user.phone.slice(-4) : '';
  const [identities, setIdentities] = useState<EnterpriseAccountIdentity[]>([]);

  useEffect(() => {
    let active = true;
    void window.electron.enterpriseAccount.getIdentities().then(result => {
      if (!active) return;
      if (result.success) {
        setIdentities(result.identities);
      } else {
        logEnterpriseAccountDiagnostic(
          'warn',
          'enterprise identity list request returned an error',
          result.error,
        );
      }
    }).catch(error => {
      logEnterpriseAccountDiagnostic('warn', 'enterprise identity list request failed', error);
    });
    return () => {
      active = false;
    };
  }, []);

  const openPortalUrl = async (url: string, action: string) => {
    logEnterpriseAccountDiagnostic('debug', action);
    try {
      await window.electron.shell.openExternal(url);
      onClose();
    } catch (error) {
      logEnterpriseAccountDiagnostic('warn', `${action} failed`, error);
    }
  };

  const handleLogout = async () => {
    logEnterpriseAccountDiagnostic('debug', 'logging out from enterprise account menu');
    try {
      await authService.logout();
      onClose();
    } catch (error) {
      logEnterpriseAccountDiagnostic('warn', 'enterprise account logout failed', error);
    }
  };

  const openEnterpriseIdentity = async (identity: EnterpriseAccountIdentity) => {
    const url = identity.role === EnterpriseMemberRole.SuperAdmin
      ? getEnterpriseOverviewUrl(identity.enterpriseId)
      : getEnterpriseMemberProfileUrl(identity.enterpriseId);
    await openPortalUrl(url, `opening enterprise ${identity.enterpriseId} from identity list`);
  };

  return (
    <div className="absolute bottom-full left-[-0.5rem] z-50 mb-1 max-h-[calc(100vh-3rem)] w-[15.5rem] max-w-[calc(100vw-1rem)] overflow-y-auto rounded-xl border border-border bg-surface shadow-popover popover-enter">
      <div className="border-b border-border px-4 py-3">
        <div className="truncate text-sm font-medium text-foreground">
          {user?.nickname || (phoneSuffix ? `****${phoneSuffix}` : context.enterpriseName)}
        </div>
        <div className="mt-1 break-words text-xs text-secondary">
          {i18nService.t('enterpriseAccountBelongsTo').replace('{name}', context.enterpriseName)}
        </div>
        <span className={`mt-2 inline-flex rounded px-1.5 py-0.5 text-[10px] font-medium ${
          isSuperAdmin
            ? 'bg-primary/10 text-primary'
            : 'bg-surface-raised text-secondary'
        }`}>
          {i18nService.t(
            isSuperAdmin
              ? 'enterpriseAccountRoleSuperAdmin'
              : 'enterpriseAccountRoleMember',
          )}
        </span>
      </div>

      <div className="border-b border-border px-4 py-2.5">
        <div className="flex items-center justify-between gap-3 text-xs">
          <span className="text-secondary">{i18nService.t('enterpriseAccountQuota')}</span>
          <strong className="font-medium text-foreground">
            {formatCredits(context.memberQuota.remaining)}
            <span className="font-normal text-secondary">
              {' / '}{formatCredits(context.memberQuota.limit)} {i18nService.t('authCreditsUnit')}
            </span>
          </strong>
        </div>
      </div>

      <div className="py-1">
        {isSuperAdmin && context.permissions.manageEnterprise ? (
          <MenuAction
            icon={<BuildingOffice2Icon className={actionIconClassName} />}
            label={i18nService.t('enterpriseAccountManagement')}
            onClick={() => openPortalUrl(
              getEnterpriseOverviewUrl(context.enterpriseId),
              'opening enterprise overview from account menu',
            )}
          />
        ) : null}
        <MenuAction
          icon={<ChartBarIcon className={actionIconClassName} />}
          label={i18nService.t('authUsageOverview')}
          onClick={() => openPortalUrl(
            getEnterpriseMemberProfileUrl(context.enterpriseId),
            'opening usage overview from enterprise account menu',
          )}
        />
        <MenuAction
          icon={<ArrowRightStartOnRectangleIcon className={actionIconClassName} />}
          label={i18nService.t('authLogout')}
          onClick={handleLogout}
        />
      </div>

      {identities.length > 1 ? (
        <div className="border-t border-border">
          <div className="border-b border-border px-4 py-2.5 text-xs font-medium text-secondary">
            {i18nService.t('enterpriseAccountChooseEnterprise')}
          </div>
          <div className="max-h-[18rem] overflow-y-auto py-1">
            {identities.map(identity => (
              <button
                key={identity.enterpriseId}
                type="button"
                onClick={() => void openEnterpriseIdentity(identity)}
                className="flex w-full items-center justify-between gap-3 px-4 py-2 text-left transition-colors hover:bg-surface-raised"
              >
                <span className="min-w-0">
                  <strong className="block truncate text-sm font-medium text-foreground">
                    {identity.enterpriseName}
                  </strong>
                  <span className="mt-0.5 block text-[11px] text-secondary">
                    {i18nService.t(
                      identity.role === EnterpriseMemberRole.SuperAdmin
                        ? 'enterpriseAccountRoleSuperAdmin'
                        : 'enterpriseAccountRoleMember',
                    )}
                  </span>
                </span>
                <span className="shrink-0 text-xs font-medium text-primary">
                  {i18nService.t('enterpriseAccountEnter')}
                </span>
              </button>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
};
