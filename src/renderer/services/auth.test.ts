import { ProviderName } from '@shared/providers';
import { afterEach, describe, expect, test, vi } from 'vitest';

import {
  EnterpriseMemberRole,
  EnterpriseQuotaReason,
} from '../../shared/enterpriseAccount/constants';
import { setEnterpriseAccountContext } from '../features/enterpriseAccount/enterpriseAccountSlice';
import { store } from '../store';
import { setLoggedIn, setLoggedOut } from '../store/slices/authSlice';
import { clearServerModels } from '../store/slices/modelSlice';
import {
  authService,
  mapPricingCatalogTextModelsToServerModels,
  mapPricingCatalogToPublicServerModels,
} from './auth';

afterEach(() => {
  store.dispatch(setLoggedOut());
  store.dispatch(clearServerModels());
  store.dispatch(setEnterpriseAccountContext(null));
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('pricing catalog model mapping', () => {
  test('maps public text models to locked server models', () => {
    const [model] = mapPricingCatalogTextModelsToServerModels([
      {
        modelId: 'qwen3.7-plus',
        modelName: 'Qwen3.7-Plus',
        provider: 'LobsterAI',
        providerLabel: 'LobsterAI Plan',
        description: 'Strong multimodal model',
        supportsImage: true,
        supportsThinking: true,
        contextWindow: 1_000_000,
        costMultiplier: 1.6,
      },
    ]);

    expect(model).toMatchObject({
      id: 'qwen3.7-plus',
      name: 'Qwen3.7-Plus',
      provider: 'LobsterAI Plan',
      providerKey: ProviderName.LobsteraiServer,
      isServerModel: true,
      accessible: false,
      description: 'Strong multimodal model',
      supportsImage: true,
      supportsThinking: true,
      contextWindow: 1_000_000,
      costMultiplier: 1.6,
    });
  });

  test('maps only textModels from the pricing catalog', () => {
    const models = mapPricingCatalogToPublicServerModels({
      textModels: [
        {
          modelId: 'MiniMax-M3',
          modelName: 'MiniMax M3',
        },
      ],
      imageModels: [
        {
          modelId: 'image-01',
          modelName: 'MiniMax-Image-01',
        },
      ],
      videoModels: [
        {
          modelId: 'happyhorse-1.0-i2v',
          modelName: 'HappyHorse',
        },
      ],
    });

    expect(models.map(model => model.id)).toEqual(['MiniMax-M3']);
    expect(models[0].accessible).toBe(false);
  });
});

describe('login diagnostics', () => {
  test('persists renderer lifecycle logs without including the login URL', async () => {
    const fromRenderer = vi.fn();
    const login = vi.fn().mockResolvedValue({ success: true });
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'debug').mockImplementation(() => {});
    vi.stubGlobal('window', {
      electron: {
        api: {
          fetch: vi.fn().mockResolvedValue({
            ok: true,
            data: { data: { value: 'https://lobsterai.youdao.com/portal#/login' } },
          }),
        },
        auth: { login },
        log: { fromRenderer },
      },
    });

    await authService.login();

    expect(login).toHaveBeenCalledWith('https://lobsterai.youdao.com/portal#/login');
    expect(fromRenderer).toHaveBeenCalledWith(
      'info',
      'AuthService',
      expect.stringMatching(/^login attempt \d+ started$/),
    );
    expect(fromRenderer).toHaveBeenCalledWith(
      'info',
      'AuthService',
      expect.stringMatching(/^login attempt \d+ handed off to the system browser$/),
    );
    expect(fromRenderer.mock.calls.flat().join(' ')).not.toContain('lobsterai.youdao.com');
  });

  test('records a warning while preserving the existing non-throwing IPC failure behavior', async () => {
    const fromRenderer = vi.fn();
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(console, 'debug').mockImplementation(() => {});
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.stubGlobal('window', {
      electron: {
        api: {
          fetch: vi.fn().mockResolvedValue({
            ok: true,
            data: { data: { value: 'https://lobsterai.youdao.com/portal#/login' } },
          }),
        },
        auth: { login: vi.fn().mockResolvedValue({ success: false, error: 'open failed' }) },
        log: { fromRenderer },
      },
    });

    await expect(authService.login()).resolves.toBeUndefined();

    expect(fromRenderer).toHaveBeenCalledWith(
      'warn',
      'AuthService',
      expect.stringMatching(/^login attempt \d+ could not open the system browser$/),
    );
  });
});

describe('quota checks', () => {
  test('returns a failure without issuing IPC requests when logged out', async () => {
    const getQuota = vi.fn();
    vi.stubGlobal('window', {
      electron: {
        auth: { getQuota },
        log: { fromRenderer: vi.fn() },
      },
    });

    await expect(authService.checkQuota()).resolves.toEqual({
      success: false,
      enterpriseQuotaAvailable: false,
    });
    expect(getQuota).not.toHaveBeenCalled();
  });

  test('refreshes quota, profile summary, and server model accessibility together', async () => {
    const getQuota = vi.fn().mockResolvedValue({
      success: true,
      quota: {
        planName: 'Enterprise',
        subscriptionStatus: 'active',
        creditsLimit: 100,
        creditsUsed: 10,
        creditsRemaining: 90,
      },
      enterpriseContext: null,
    });
    const getProfileSummary = vi.fn().mockResolvedValue({
      success: true,
      data: {
        id: 1,
        nickname: 'Tester',
        avatarUrl: null,
        totalCreditsRemaining: 90,
        creditItems: [],
      },
    });
    const getModels = vi.fn().mockResolvedValue({
      success: true,
      models: [{
        modelId: 'qwen3.7-plus',
        modelName: 'Qwen3.7 Plus',
        provider: 'LobsterAI',
        apiFormat: 'openai',
        accessible: true,
      }],
    });
    vi.stubGlobal('window', {
      electron: {
        auth: {
          getQuota,
          getProfileSummary,
          getModels,
        },
      },
    });
    store.dispatch(setLoggedIn({
      user: {
        yid: 'tester',
        nickname: 'Tester',
        avatarUrl: null,
      },
      quota: null,
    }));

    await expect(authService.checkQuota()).resolves.toEqual({
      success: true,
      enterpriseQuotaAvailable: true,
    });

    expect(getQuota).toHaveBeenCalledOnce();
    expect(getProfileSummary).toHaveBeenCalledOnce();
    expect(getModels).toHaveBeenCalledOnce();
    expect(store.getState().auth.quota?.creditsRemaining).toBe(90);
    expect(store.getState().model.availableModels).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: 'qwen3.7-plus',
        providerKey: ProviderName.LobsteraiServer,
        accessible: true,
      }),
    ]));
  });

  test('shares concurrent quota checks to avoid duplicate IPC requests', async () => {
    let resolveQuota: ((value: {
      success: boolean;
      quota: null;
      enterpriseContext: null;
    }) => void) | undefined;
    const quotaResponse = new Promise<{
      success: boolean;
      quota: null;
      enterpriseContext: null;
    }>((resolve) => {
      resolveQuota = resolve;
    });
    const getQuota = vi.fn().mockReturnValue(quotaResponse);
    const getProfileSummary = vi.fn().mockResolvedValue({ success: true, data: null });
    const getModels = vi.fn().mockResolvedValue({ success: true, models: [] });
    vi.stubGlobal('window', {
      electron: {
        auth: {
          getQuota,
          getProfileSummary,
          getModels,
        },
        log: { fromRenderer: vi.fn() },
      },
    });
    store.dispatch(setLoggedIn({
      user: {
        yid: 'tester',
        nickname: 'Tester',
        avatarUrl: null,
      },
      quota: null,
    }));

    const firstCheck = authService.checkQuota();
    const secondCheck = authService.checkQuota();
    resolveQuota?.({
      success: true,
      quota: null,
      enterpriseContext: null,
    });

    await expect(Promise.all([firstCheck, secondCheck])).resolves.toEqual([
      { success: true, enterpriseQuotaAvailable: true },
      { success: true, enterpriseQuotaAvailable: true },
    ]);
    expect(getQuota).toHaveBeenCalledOnce();
    expect(getProfileSummary).toHaveBeenCalledOnce();
    expect(getModels).toHaveBeenCalledOnce();
  });

  test('reports the refreshed enterprise quota as unavailable', async () => {
    const getQuota = vi.fn().mockResolvedValue({
      success: true,
      quota: null,
      enterpriseContext: {
        accountMode: 'enterprise',
        enterpriseId: 1001,
        memberId: 2001,
        enterpriseName: 'Example enterprise',
        role: EnterpriseMemberRole.Member,
        permissions: {
          manageEnterprise: false,
          adjustMemberQuota: false,
          rechargeEnterprise: false,
        },
        memberQuota: { limit: 100, used: 100, remaining: 0 },
        enterprisePool: { total: 1000, used: 400, remaining: 600 },
        quotaStatus: {
          available: false,
          reason: EnterpriseQuotaReason.MemberMonthlyQuotaExhausted,
          errorCode: 41606,
        },
      },
    });
    vi.stubGlobal('window', {
      electron: {
        auth: {
          getQuota,
          getProfileSummary: vi.fn(),
          getModels: vi.fn().mockResolvedValue({ success: true, models: [] }),
        },
        log: { fromRenderer: vi.fn() },
      },
    });
    store.dispatch(setLoggedIn({
      user: {
        yid: 'tester',
        nickname: 'Tester',
        avatarUrl: null,
      },
      quota: null,
    }));

    await expect(authService.checkQuota()).resolves.toEqual({
      success: true,
      enterpriseQuotaAvailable: false,
    });
    expect(store.getState().enterpriseAccount.context?.quotaStatus.reason)
      .toBe(EnterpriseQuotaReason.MemberMonthlyQuotaExhausted);
  });
});
