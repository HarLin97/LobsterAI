import {
  ArrowRightStartOnRectangleIcon,
  BuildingOffice2Icon,
  ChartBarIcon,
} from '@heroicons/react/24/outline';
import type { ReactNode } from 'react';
import { useSelector } from 'react-redux';

import { EnterpriseMemberRole } from '../../../../shared/enterpriseAccount/constants';
import type { EnterpriseAccountContext } from '../../../../shared/enterpriseAccount/types';
import { authService } from '../../../services/auth';
import {
  getEnterpriseOverviewUrl,
  getPortalProfileUrl,
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

export const EnterpriseAccountMenu = ({
  context,
  onClose,
}: EnterpriseAccountMenuProps) => {
  const user = useSelector((state: RootState) => state.auth.user);
  const isSuperAdmin = context.role === EnterpriseMemberRole.SuperAdmin;
  const phoneSuffix = user?.phone ? user.phone.slice(-4) : '';

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

  return (
    <div className="absolute bottom-full left-[-0.5rem] z-50 mb-1 max-h-[min(70vh,24rem)] w-[15.5rem] max-w-[calc(100vw-1rem)] overflow-y-auto rounded-xl border border-border bg-surface shadow-popover popover-enter">
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
            getPortalProfileUrl(),
            'opening usage overview from enterprise account menu',
          )}
        />
        <MenuAction
          icon={<ArrowRightStartOnRectangleIcon className={actionIconClassName} />}
          label={i18nService.t('authLogout')}
          onClick={handleLogout}
        />
      </div>
    </div>
  );
};
