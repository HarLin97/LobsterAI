import {
  type AuthSessionChangedEvent,
  AuthSessionChangeReason,
  AuthSessionStatus,
} from '@shared/auth/constants';
import { ProviderName } from '@shared/providers';
import { afterEach, describe, expect, test, vi } from 'vitest';

import { store } from '../store';
import { setLoggedIn } from '../store/slices/authSlice';
import {
  authService,
  mapAvailableServerModelsToModels,
  mapPricingCatalogTextModelsToServerModels,
  mapPricingCatalogToPublicServerModels,
} from './auth';

afterEach(() => {
  authService.destroy();
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
        thinkingConfig: {
          levels: ['off', 'high', 'max'],
          defaultLevel: 'high',
        },
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
      thinkingConfig: {
        levels: ['off', 'high', 'max'],
        defaultLevel: 'high',
      },
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

describe('authenticated server model mapping', () => {
  test('preserves K3 runtime, modality, token, and agentic metadata', () => {
    const [model] = mapAvailableServerModelsToModels([{
      modelId: 'kimi-k3-YoudaoInner',
      modelName: 'Kimi K3',
      provider: 'moonshot',
      apiFormat: 'openai',
      runtimeProfile: 'moonshot-kimi-k3',
      supportsImage: true,
      supportsVideo: true,
      supportsThinking: true,
      thinkingConfig: {
        levels: ['off', 'high', 'max'],
        defaultLevel: 'high',
      },
      supportsToolCalling: true,
      agenticReady: false,
      contextWindow: 1_048_576,
      maxTokens: 8_192,
      accessible: true,
    }]);

    expect(model).toMatchObject({
      id: 'kimi-k3-YoudaoInner',
      providerKey: ProviderName.LobsteraiServer,
      isServerModel: true,
      serverApiFormat: 'openai',
      runtimeProfile: 'moonshot-kimi-k3',
      supportsImage: true,
      supportsVideo: true,
      supportsThinking: true,
      thinkingConfig: {
        levels: ['off', 'high', 'max'],
        defaultLevel: 'high',
      },
      supportsToolCalling: true,
      agenticReady: false,
      contextWindow: 1_048_576,
      maxTokens: 8_192,
      accessible: true,
    });
  });

  test('ignores malformed thinking configuration without hiding the model', () => {
    const [model] = mapAvailableServerModelsToModels([{
      modelId: 'deepseek-v4-flash',
      modelName: 'DeepSeek V4 Flash',
      provider: 'LobsterAI',
      apiFormat: 'openai',
      supportsThinking: true,
      thinkingConfig: {
        levels: ['off', 'high'],
        defaultLevel: 'max',
      },
    }]);

    expect(model.id).toBe('deepseek-v4-flash');
    expect(model.supportsThinking).toBe(true);
    expect(model.thinkingConfig).toBeUndefined();
  });
});

describe('login diagnostics', () => {
  test('persists renderer lifecycle logs without including the login URL', async () => {
    const fromRenderer = vi.fn();
    const loginResult = {
      success: true,
      redirectUrl: 'https://lobsterai.youdao.com/portal#/login?source=electron',
    };
    const login = vi.fn().mockResolvedValue(loginResult);
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

    await expect(authService.login()).resolves.toEqual(loginResult);

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

  test('returns the IPC failure result without throwing and records a warning', async () => {
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

    await expect(authService.login()).resolves.toEqual({
      success: false,
      error: 'open failed',
    });

    expect(fromRenderer).toHaveBeenCalledWith(
      'warn',
      'AuthService',
      expect.stringMatching(/^login attempt \d+ could not open the system browser$/),
    );
  });
});

describe('auth state restoration', () => {
  const user = {
    yid: 'user@example.com',
    nickname: 'Lobster User',
    avatarUrl: null,
  };
  const quota = {
    planName: '专业',
    subscriptionStatus: 'active',
    creditsLimit: 1_000,
    creditsUsed: 100,
    creditsRemaining: 900,
  };

  test('preserves the current login snapshot for a temporary verification failure', async () => {
    store.dispatch(setLoggedIn({ user, quota }));
    vi.stubGlobal('window', {
      electron: {
        auth: {
          getUser: vi.fn().mockResolvedValue({
            success: false,
            status: AuthSessionStatus.TemporarilyUnavailable,
            hasCredentials: true,
            cachedUser: user,
          }),
        },
      },
    });

    const result = await authService.refreshAuthState({ clearOnFailure: true });

    expect(result.isLoggedIn).toBe(true);
    expect(store.getState().auth).toMatchObject({
      isLoggedIn: true,
      sessionStatus: AuthSessionStatus.TemporarilyUnavailable,
      user,
      quota,
    });
  });

  test('clears the current login snapshot for terminal expiration', async () => {
    store.dispatch(setLoggedIn({ user, quota }));
    vi.stubGlobal('window', {
      electron: {
        auth: {
          getUser: vi.fn().mockResolvedValue({
            success: false,
            status: AuthSessionStatus.Expired,
            hasCredentials: false,
          }),
          getPricingCatalog: vi.fn().mockResolvedValue({
            success: true,
            textModels: [],
          }),
        },
      },
    });

    const result = await authService.refreshAuthState({ clearOnFailure: true });

    expect(result.isLoggedIn).toBe(false);
    expect(store.getState().auth).toMatchObject({
      isLoggedIn: false,
      sessionStatus: AuthSessionStatus.Expired,
      user: null,
      quota: null,
    });
  });

  test('shows a re-login toast when the main process reports terminal expiration', async () => {
    const dispatchEvent = vi.fn();
    store.dispatch(setLoggedIn({ user, quota }));
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.stubGlobal('window', {
      dispatchEvent,
      electron: {
        auth: {
          getPricingCatalog: vi.fn().mockResolvedValue({
            success: true,
            textModels: [],
          }),
        },
      },
    });

    const serviceWithSessionHandler = authService as unknown as {
      handleSessionChanged: (event: AuthSessionChangedEvent) => Promise<void>;
    };
    await serviceWithSessionHandler.handleSessionChanged({
      status: AuthSessionStatus.Expired,
      reason: AuthSessionChangeReason.RefreshRejected,
    });

    expect(store.getState().auth.sessionStatus).toBe(AuthSessionStatus.Expired);
    expect(dispatchEvent).toHaveBeenCalledOnce();
    const toastEvent = dispatchEvent.mock.calls[0][0] as CustomEvent<string>;
    expect(toastEvent.type).toBe('app:showToast');
    expect(toastEvent.detail).toContain('登录状态已过期');
  });
});
