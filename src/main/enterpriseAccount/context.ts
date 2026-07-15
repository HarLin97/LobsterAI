import {
  EnterpriseAccountMode,
  EnterpriseAccountRequestHeader,
  EnterpriseAccountStoreKey,
  EnterpriseApiErrorCode,
  EnterpriseMemberRole,
} from '../../shared/enterpriseAccount/constants';
import type {
  EnterpriseAccountContext,
  EnterpriseAccountContextResult,
  EnterpriseAccountPermissions,
  EnterpriseCreditPool,
  EnterpriseMemberQuota,
} from '../../shared/enterpriseAccount/types';
import type { SqliteStore } from '../sqliteStore';

type JsonRecord = Record<string, unknown>;

export interface EnterpriseAccountContextApiDeps {
  getServerBaseUrl: () => string;
  fetchWithAuth: (url: string, options?: RequestInit) => Promise<Response>;
  store: SqliteStore;
}

function isRecord(value: unknown): value is JsonRecord {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function readString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function readNonNegativeNumber(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value)
    ? Math.max(0, value)
    : 0;
}

function readEnterpriseId(value: unknown): number | null {
  if (typeof value === 'number' && Number.isInteger(value) && value > 0) {
    return value;
  }
  if (typeof value === 'string' && /^\d+$/.test(value.trim())) {
    const parsed = Number(value.trim());
    return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
  }
  return null;
}

function readRole(value: unknown): EnterpriseAccountContext['role'] | null {
  const normalized = readString(value).toLowerCase();
  if (normalized === EnterpriseMemberRole.SuperAdmin) {
    return EnterpriseMemberRole.SuperAdmin;
  }
  if (normalized === EnterpriseMemberRole.Member) {
    return EnterpriseMemberRole.Member;
  }
  return null;
}

function readPermissions(
  value: unknown,
  role: EnterpriseAccountContext['role'],
): EnterpriseAccountPermissions {
  const record = isRecord(value) ? value : {};
  const isSuperAdmin = role === EnterpriseMemberRole.SuperAdmin;
  return {
    manageEnterprise: typeof record.manageEnterprise === 'boolean'
      ? record.manageEnterprise
      : isSuperAdmin,
    adjustMemberQuota: typeof record.adjustMemberQuota === 'boolean'
      ? record.adjustMemberQuota
      : isSuperAdmin,
    rechargeEnterprise: typeof record.rechargeEnterprise === 'boolean'
      ? record.rechargeEnterprise
      : isSuperAdmin,
  };
}

function readMemberQuota(value: unknown): EnterpriseMemberQuota {
  const record = isRecord(value) ? value : {};
  return {
    limit: readNonNegativeNumber(record.limit),
    used: readNonNegativeNumber(record.used),
    remaining: readNonNegativeNumber(record.remaining),
  };
}

function readEnterprisePool(value: unknown): EnterpriseCreditPool {
  const record = isRecord(value) ? value : {};
  return {
    total: readNonNegativeNumber(record.total),
    used: readNonNegativeNumber(record.used),
    remaining: readNonNegativeNumber(record.remaining),
  };
}

function findContextCandidate(value: unknown): JsonRecord | null {
  if (!isRecord(value)) return null;

  const directMode = readString(value.accountMode).toLowerCase();
  if (directMode === EnterpriseAccountMode.Personal) {
    return null;
  }
  if (value.enterpriseId != null) {
    return value;
  }

  for (const key of [
    'enterpriseContext',
    'accountContext',
    'organizationContext',
    'context',
    'user',
    'data',
  ]) {
    const candidate = findContextCandidate(value[key]);
    if (candidate) return candidate;
  }
  return directMode === EnterpriseAccountMode.Enterprise ? value : null;
}

export function readAccountMode(value: unknown): string | null {
  if (!isRecord(value)) return null;
  const direct = readString(value.accountMode).toLowerCase();
  if (direct) return direct;
  for (const key of ['enterpriseContext', 'accountContext', 'organizationContext', 'context', 'user', 'data']) {
    const nested = readAccountMode(value[key]);
    if (nested) return nested;
  }
  return null;
}

export function normalizeEnterpriseAccountContext(
  value: unknown,
): EnterpriseAccountContext | null {
  const candidate = findContextCandidate(value);
  if (!candidate) return null;

  const enterpriseId = readEnterpriseId(candidate.enterpriseId);
  const enterpriseName = readString(candidate.enterpriseName);
  const role = readRole(candidate.role);
  if (enterpriseId === null || !enterpriseName || role === null) {
    return null;
  }

  return {
    accountMode: EnterpriseAccountMode.Enterprise,
    enterpriseId,
    enterpriseName,
    role,
    permissions: readPermissions(candidate.permissions, role),
    memberQuota: readMemberQuota(candidate.memberQuota),
    enterprisePool: readEnterprisePool(candidate.enterprisePool),
  };
}

export function getPersistedEnterpriseAccountContext(
  store: SqliteStore,
): EnterpriseAccountContext | null {
  const persisted = store.get<unknown>(EnterpriseAccountStoreKey.Context);
  return normalizeEnterpriseAccountContext(persisted);
}

export function persistEnterpriseAccountContext(
  store: SqliteStore,
  context: EnterpriseAccountContext,
): void {
  store.set(EnterpriseAccountStoreKey.Context, context);
}

export function clearEnterpriseAccountContext(store: SqliteStore): void {
  store.delete(EnterpriseAccountStoreKey.Context);
}

export function buildEnterpriseAccountRequestHeaders(
  context: EnterpriseAccountContext | null,
): Record<string, string> {
  if (!context) return {};
  return {
    [EnterpriseAccountRequestHeader.AccountMode]: context.accountMode,
    [EnterpriseAccountRequestHeader.EnterpriseId]: String(context.enterpriseId),
  };
}

export async function fetchEnterpriseAccountContext(
  deps: EnterpriseAccountContextApiDeps,
): Promise<EnterpriseAccountContextResult> {
  const url = `${deps.getServerBaseUrl()}/api/enterprise/context`;
  try {
    const response = await deps.fetchWithAuth(url, {
      headers: { Accept: 'application/json' },
    });
    const body = await response.json() as {
      code?: number;
      message?: string;
      data?: unknown;
    };
    if (!response.ok || body.code !== 0) {
      if (
        body.code === EnterpriseApiErrorCode.NotFound
        || body.code === EnterpriseApiErrorCode.NotMember
        || body.code === EnterpriseApiErrorCode.AccountModeMismatch
      ) {
        clearEnterpriseAccountContext(deps.store);
      }
      return {
        success: false,
        context: getPersistedEnterpriseAccountContext(deps.store),
        error: body.message || `HTTP ${response.status}`,
      };
    }

    const context = normalizeEnterpriseAccountContext(body.data);
    if (context) {
      persistEnterpriseAccountContext(deps.store, context);
    } else {
      clearEnterpriseAccountContext(deps.store);
    }
    return { success: true, context };
  } catch (error) {
    return {
      success: false,
      context: getPersistedEnterpriseAccountContext(deps.store),
      error: error instanceof Error ? error.message : 'Failed to load enterprise account context',
    };
  }
}
