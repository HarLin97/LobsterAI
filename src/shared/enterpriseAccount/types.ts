import type {
  EnterpriseMemberRole,
  EnterpriseQuotaReason,
} from './constants';

export interface EnterpriseAccountPermissions {
  manageEnterprise: boolean;
  adjustMemberQuota: boolean;
  rechargeEnterprise: boolean;
}

export interface EnterpriseMemberQuota {
  limit: number;
  used: number;
  remaining: number;
}

export interface EnterpriseCreditPool {
  total: number;
  used: number;
  remaining: number;
}

export interface EnterpriseAccountContext {
  accountMode: 'enterprise';
  enterpriseId: number;
  enterpriseName: string;
  role: EnterpriseMemberRole;
  permissions: EnterpriseAccountPermissions;
  memberQuota: EnterpriseMemberQuota;
  enterprisePool: EnterpriseCreditPool;
}

export interface EnterpriseQuotaErrorDetails {
  code: number;
  reason: EnterpriseQuotaReason;
}

export interface EnterpriseAccountContextResult {
  success: boolean;
  context: EnterpriseAccountContext | null;
  error?: string;
}
