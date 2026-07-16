import { afterEach, describe, expect, test, vi } from 'vitest';

import {
  EnterpriseAccountMode,
  EnterpriseApiErrorCode,
  EnterpriseMemberRole,
} from '../../shared/enterpriseAccount/constants';
import type { EnterpriseAccountContext } from '../../shared/enterpriseAccount/types';
import type { SqliteStore } from '../sqliteStore';
import {
  buildEnterpriseAccountRequestHeaders,
  fetchEnterpriseAccountContext,
  getPersistedEnterpriseAccountContext,
  normalizeEnterpriseAccountContext,
  persistEnterpriseAccountContext,
} from './context';

const createStore = (): SqliteStore => {
  const values = new Map<string, unknown>();
  return {
    get: (key: string) => values.get(key),
    set: (key: string, value: unknown) => {
      values.set(key, value);
    },
    delete: (key: string) => {
      values.delete(key);
    },
  } as unknown as SqliteStore;
};

const createContext = (enterpriseId = 1001): EnterpriseAccountContext => ({
  accountMode: EnterpriseAccountMode.Enterprise,
  enterpriseId,
  enterpriseName: 'Example Enterprise',
  role: EnterpriseMemberRole.SuperAdmin,
  permissions: {
    manageEnterprise: true,
    adjustMemberQuota: true,
    rechargeEnterprise: true,
  },
  memberQuota: { limit: 100, used: 40, remaining: 60 },
  enterprisePool: { total: 1000, used: 400, remaining: 600 },
});

const jsonResponse = (body: unknown, status = 200): Response => new Response(
  JSON.stringify(body),
  {
    status,
    headers: { 'Content-Type': 'application/json' },
  },
);

afterEach(() => {
  vi.restoreAllMocks();
});

describe('enterprise account context normalization', () => {
  test('normalizes nested context and safe role defaults', () => {
    expect(normalizeEnterpriseAccountContext({
      data: {
        accountMode: EnterpriseAccountMode.Enterprise,
        enterpriseId: '1001',
        enterpriseName: ' Example Enterprise ',
        role: EnterpriseMemberRole.SuperAdmin,
        memberQuota: { limit: 100, used: 40, remaining: 60 },
        enterprisePool: { total: 1000, used: 400, remaining: 600 },
      },
    })).toEqual(createContext());
  });

  test('prefers complete nested context over an incomplete profile summary', () => {
    expect(normalizeEnterpriseAccountContext({
      accountMode: EnterpriseAccountMode.Enterprise,
      enterpriseId: 1001,
      nickname: 'Member',
      enterpriseContext: createContext(),
    })).toEqual(createContext());
  });

  test('ignores stale nested enterprise data when the account is personal', () => {
    expect(normalizeEnterpriseAccountContext({
      accountMode: EnterpriseAccountMode.Personal,
      enterpriseContext: createContext(),
    })).toBeNull();
  });

  test('treats a missing or malformed persisted value as no context', () => {
    const store = createStore();
    expect(getPersistedEnterpriseAccountContext(store)).toBeNull();

    store.set('enterprise_account_context', { enterpriseId: -1 });
    expect(getPersistedEnterpriseAccountContext(store)).toBeNull();
    expect(buildEnterpriseAccountRequestHeaders(null)).toEqual({});
  });
});

describe('enterprise account context refresh', () => {
  test('persists a valid context and builds bounded request headers', async () => {
    const store = createStore();
    const context = createContext();
    const result = await fetchEnterpriseAccountContext({
      getServerBaseUrl: () => 'https://example.test',
      fetchWithAuth: async (_url, options) => {
        expect(options?.headers).toEqual({ Accept: 'application/json' });
        expect(options?.signal).toBeInstanceOf(AbortSignal);
        return jsonResponse({ code: 0, data: context });
      },
      store,
    });

    expect(result).toEqual({ success: true, context });
    expect(getPersistedEnterpriseAccountContext(store)).toEqual(context);
    expect(buildEnterpriseAccountRequestHeaders(context)).toEqual({
      'X-LobsterAI-Account-Mode': EnterpriseAccountMode.Enterprise,
      'X-LobsterAI-Enterprise-Id': '1001',
    });
  });

  test('clears persisted context when the server rejects the selected account', async () => {
    const store = createStore();
    persistEnterpriseAccountContext(store, createContext());
    const result = await fetchEnterpriseAccountContext({
      getServerBaseUrl: () => 'https://example.test',
      fetchWithAuth: async () => jsonResponse({
        code: String(EnterpriseApiErrorCode.AccountModeMismatch),
        message: 'Account changed',
      }),
      store,
    });

    expect(result.success).toBe(false);
    expect(result.context).toBeNull();
    expect(getPersistedEnterpriseAccountContext(store)).toBeNull();
  });

  test('does not overwrite a newer account after auth state changes', async () => {
    const store = createStore();
    const currentContext = createContext(2002);
    persistEnterpriseAccountContext(store, currentContext);
    const result = await fetchEnterpriseAccountContext({
      getServerBaseUrl: () => 'https://example.test',
      fetchWithAuth: async () => jsonResponse({ code: 0, data: createContext(1001) }),
      store,
      isRequestCurrent: () => false,
    });

    expect(result.success).toBe(false);
    expect(result.context).toEqual(currentContext);
    expect(getPersistedEnterpriseAccountContext(store)).toEqual(currentContext);
  });

  test('times out without discarding the last valid cached context', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const store = createStore();
    const cachedContext = createContext();
    persistEnterpriseAccountContext(store, cachedContext);
    const result = await fetchEnterpriseAccountContext({
      getServerBaseUrl: () => 'https://example.test',
      fetchWithAuth: async (_url, options) => new Promise<Response>((_resolve, reject) => {
        options?.signal?.addEventListener('abort', () => {
          reject(new DOMException('Aborted', 'AbortError'));
        }, { once: true });
      }),
      store,
      requestTimeoutMs: 5,
    });

    expect(result).toEqual({
      success: false,
      context: cachedContext,
      error: 'Enterprise account context request timed out',
    });
  });
});
