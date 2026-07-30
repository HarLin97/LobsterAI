import { EnterpriseMemberRole } from '../../../shared/enterpriseAccount/constants';
import type { RootState } from '../../store';

export const selectEnterpriseAccountContext = (state: RootState) => (
  state.enterpriseAccount.context
);

export const selectIsEnterpriseSuperAdmin = (state: RootState): boolean => (
  state.enterpriseAccount.context?.role === EnterpriseMemberRole.SuperAdmin
);
