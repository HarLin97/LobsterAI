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
  isRequestCurrent?: () => boolean;
  requestTimeoutMs?: number;
}

const DEFAULT_ENTERPRISE_CONTEXT_REQUEST_TIMEOUT_MS = 10_000;

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

function readInteger(value: unknown): number | null {
  if (typeof value === 'number' && Number.isInteger(value)) {
    return value;
  }
  if (typeof value === 'string' && /^-?\d+$/.test(value.trim())) {
    const parsed = Number(value.trim());
    return Number.isSafeInteger(parsed) ? parsed : null;
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
  if (
    value.enterpriseId != null
    && readString(value.enterpriseName)
    && readRole(value.role) !== null
  ) {
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
  try {
    const persisted = store.get<unknown>(EnterpriseAccountStoreKey.Context);
    return normalizeEnterpriseAccountContext(persisted);
  } catch (error) {
    console.warn('[EnterpriseAccount] failed to read persisted account context', error);
    return null;
  }
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
  const requestTimeoutMs = typeof deps.requestTimeoutMs === 'number'
    && Number.isFinite(deps.requestTimeoutMs)
    && deps.requestTimeoutMs > 0
    ? deps.requestTimeoutMs
    : DEFAULT_ENTERPRISE_CONTEXT_REQUEST_TIMEOUT_MS;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), requestTimeoutMs);
  try {
    console.debug('[EnterpriseAccount] refreshing account context');
    const response = await deps.fetchWithAuth(url, {
      headers: { Accept: 'application/json' },
      signal: controller.signal,
    });
    const rawBody = await response.json() as unknown;
    const body = isRecord(rawBody) ? rawBody : {};
    const code = readInteger(body.code);
    const message = readString(body.message);

    if (deps.isRequestCurrent?.() === false) {
      console.debug('[EnterpriseAccount] discarded context response after auth state changed');
      return {
        success: false,
        context: getPersistedEnterpriseAccountContext(deps.store),
        error: 'Authentication state changed during enterprise context refresh',
      };
    }

    if (!response.ok || code !== 0) {
      if (
        code === EnterpriseApiErrorCode.NotFound
        || code === EnterpriseApiErrorCode.NotMember
        || code === EnterpriseApiErrorCode.AccountModeMismatch
      ) {
        clearEnterpriseAccountContext(deps.store);
        console.log(`[EnterpriseAccount] cleared stale account context after server code ${code}`);
      } else {
        console.warn(`[EnterpriseAccount] context refresh rejected (HTTP ${response.status}, code ${code ?? 'unknown'})`);
      }
      return {
        success: false,
        context: getPersistedEnterpriseAccountContext(deps.store),
        error: message || `HTTP ${response.status}`,
      };
    }

    const context = normalizeEnterpriseAccountContext(body.data);
    if (context) {
      persistEnterpriseAccountContext(deps.store, context);
      console.debug(`[EnterpriseAccount] refreshed context for enterprise ${context.enterpriseId} with role ${context.role}`);
    } else {
      clearEnterpriseAccountContext(deps.store);
      console.debug('[EnterpriseAccount] refreshed personal account context');
    }
    return { success: true, context };
  } catch (error) {
    const timedOut = controller.signal.aborted;
    console.warn(
      timedOut
        ? `[EnterpriseAccount] context refresh timed out after ${requestTimeoutMs}ms`
        : '[EnterpriseAccount] context refresh failed',
      error,
    );
    return {
      success: false,
      context: getPersistedEnterpriseAccountContext(deps.store),
      error: timedOut
        ? 'Enterprise account context request timed out'
        : error instanceof Error
          ? error.message
          : 'Failed to load enterprise account context',
    };
  } finally {
    clearTimeout(timeout);
  }
}
