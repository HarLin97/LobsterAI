import { createAccountOwnerKey } from '@shared/auth/accountOwner';
import {
  type AuthLifecycleEvent,
  AuthLifecycleEventType,
  type AuthSessionChangedEvent,
  AuthSessionStatus,
  AuthSubscriptionStatus,
} from '@shared/auth/constants';
import { EnterpriseAccountMode } from '@shared/enterpriseAccount/constants';
import { ProviderName } from '@shared/providers';
import type { ModelRuntimeProfile } from '@shared/providers/modelRuntimeProfiles';

import type { EnterpriseAccountContext } from '../../shared/enterpriseAccount/types';
import {
  applyEnterpriseAccountContext,
  refreshEnterpriseAccountContext,
} from '../features/enterpriseAccount/context';
import { store } from '../store';
import {
  clearProfileSummary,
  invalidateAuthAccountContext,
  setAuthExpired,
  setAuthLoading,
  setAuthTemporarilyUnavailable,
  setLoggedIn,
  setLoggedOut,
  setProfileSummary,
  updateQuota,
  type UserProfile,
  type UserQuota,
} from '../store/slices/authSlice';
import { clearMediaAccountState } from '../store/slices/coworkSlice';
import type { Model } from '../store/slices/modelSlice';
import {
  clearServerModels,
  setServerModels,
} from '../store/slices/modelSlice';
import { i18nService } from './i18n';
import { LogReporterAction, reportYdAnalyzer } from './logReporter';

interface AuthStateRefreshResult {
  isLoggedIn: boolean;
  user: UserProfile | null;
  quota: UserQuota | null;
  enterpriseContext: EnterpriseAccountContext | null;
}

interface AuthQuotaCheckResult {
  success: boolean;
  enterpriseQuotaAvailable: boolean;
}

export interface PricingCatalogTextModel {
  modelId?: string;
  modelName?: string;
  provider?: string;
  providerLabel?: string;
  description?: string;
  supportsImage?: boolean;
  supportsThinking?: boolean;
  contextWindow?: number | null;
  costMultiplier?: number;
}

export interface PricingCatalogResponse {
  textModels?: PricingCatalogTextModel[];
  imageModels?: unknown[];
  videoModels?: unknown[];
}

export interface AvailableServerModelEntry {
  modelId: string;
  modelName: string;
  provider: string;
  apiFormat: string;
  runtimeProfile?: ModelRuntimeProfile;
  supportsImage?: boolean;
  supportsVideo?: boolean;
  supportsThinking?: boolean;
  supportsToolCalling?: boolean;
  agenticReady?: boolean;
  contextWindow?: number;
  maxTokens?: number;
  explicitContextCache?: boolean;
  costMultiplier?: number;
  description?: string;
  accessible?: boolean;
  restrictionHint?: string;
}

const readString = (value: unknown): string => (
  typeof value === 'string' ? value.trim() : ''
);

const readPositiveNumber = (value: unknown): number | undefined => (
  typeof value === 'number' && Number.isFinite(value) && value > 0
    ? value
    : undefined
);

type AuthRendererLogLevel = 'debug' | 'info' | 'warn';

export interface AuthAccountRequestSnapshot {
  isLoggedIn: boolean;
  ownerAccountKey: string | null;
  accountGeneration: number;
}

export const isAuthAccountRequestCurrent = (
  expected: AuthAccountRequestSnapshot,
  current: AuthAccountRequestSnapshot,
): boolean => (
  current.isLoggedIn === expected.isLoggedIn
  && current.ownerAccountKey === expected.ownerAccountKey
  && current.accountGeneration === expected.accountGeneration
);

const writeAuthRendererLog = (
  level: AuthRendererLogLevel,
  message: string,
  error?: unknown,
): void => {
  if (level === 'warn') {
    if (error === undefined) {
      console.warn(`[Auth] ${message}`);
    } else {
      console.warn(`[Auth] ${message}:`, error);
    }
  } else if (level === 'debug') {
    console.debug(`[Auth] ${message}`);
  } else {
    console.log(`[Auth] ${message}`);
  }

  try {
    window.electron?.log?.fromRenderer?.(level, 'AuthService', message);
  } catch {
    // Logging is best-effort and must never interrupt authentication.
  }
};

const reportAuthLifecycleEvent = (event: AuthLifecycleEvent): void => {
  void reportYdAnalyzer({
    action: LogReporterAction.AuthLifecycle,
    event_type: event.eventType,
    outcome: event.outcome,
    reason: 'reason' in event ? event.reason : undefined,
    duration_ms: 'durationMs' in event ? event.durationMs : undefined,
    failure_kind: 'failureKind' in event ? event.failureKind : undefined,
    http_status: 'httpStatus' in event ? event.httpStatus : undefined,
    error_code: 'errorCode' in event ? event.errorCode : undefined,
    joined_requests: 'joinedRequests' in event ? event.joinedRequests : undefined,
  });
};

export function mapPricingCatalogTextModelsToServerModels(
  textModels: PricingCatalogTextModel[],
): Model[] {
  return textModels.flatMap((model): Model[] => {
    const modelId = readString(model.modelId);
    if (!modelId) return [];

    const modelName = readString(model.modelName) || modelId;
    const provider = readString(model.providerLabel)
      || readString(model.provider)
      || 'LobsterAI';
    const contextWindow = readPositiveNumber(model.contextWindow);
    const costMultiplier = readPositiveNumber(model.costMultiplier);

    return [{
      id: modelId,
      name: modelName,
      provider,
      providerKey: ProviderName.LobsteraiServer,
      isServerModel: true,
      supportsImage: model.supportsImage === true,
      supportsThinking: model.supportsThinking === true,
      description: readString(model.description) || undefined,
      costMultiplier,
      contextWindow,
      accessible: false,
    }];
  });
}

export function mapPricingCatalogToPublicServerModels(
  catalog: PricingCatalogResponse,
): Model[] {
  return mapPricingCatalogTextModelsToServerModels(
    Array.isArray(catalog.textModels) ? catalog.textModels : [],
  );
}

export function mapAvailableServerModelsToModels(
  models: AvailableServerModelEntry[],
): Model[] {
  return models.map(model => ({
    id: model.modelId,
    name: model.modelName,
    provider: model.provider,
    providerKey: ProviderName.LobsteraiServer,
    isServerModel: true,
    serverApiFormat: model.apiFormat,
    runtimeProfile: model.runtimeProfile,
    supportsImage: model.supportsImage ?? false,
    supportsVideo: model.supportsVideo ?? false,
    supportsThinking: model.supportsThinking ?? false,
    supportsToolCalling: model.supportsToolCalling,
    agenticReady: model.agenticReady,
    contextWindow: model.contextWindow,
    maxTokens: model.maxTokens,
    explicitContextCache: model.explicitContextCache ?? false,
    description: model.description,
    costMultiplier: model.costMultiplier,
    accessible: model.accessible ?? true,
    restrictionHint: model.restrictionHint ?? undefined,
  }));
}

class AuthService {
  private unsubCallback: (() => void) | null = null;
  private unsubLifecycleEvent: (() => void) | null = null;
  private unsubQuotaChanged: (() => void) | null = null;
  private unsubSessionChanged: (() => void) | null = null;
  private unsubEnterpriseContextInvalidated: (() => void) | null = null;
  private unsubWindowState: (() => void) | null = null;
  private pendingQuotaCheck: Promise<AuthQuotaCheckResult> | null = null;
  private lastRefreshTime = 0;
  private loginAttemptSequence = 0;

  private applyAuthenticatedState(
    user: UserProfile,
    quota: UserQuota | null | undefined,
    enterpriseContext: EnterpriseAccountContext | null | undefined,
  ): void {
    const isEnterpriseAccount = (
      user.accountMode === EnterpriseAccountMode.Enterprise
      || quota?.accountMode === EnterpriseAccountMode.Enterprise
      || quota?.subscriptionStatus === AuthSubscriptionStatus.Enterprise
    );
    const hasMismatchedEnterpriseId = (
      enterpriseContext !== null
      && enterpriseContext !== undefined
      && typeof quota?.enterpriseId === 'number'
      && quota.enterpriseId !== enterpriseContext.enterpriseId
    );
    const ownerAccountKey = createAccountOwnerKey({
      user,
      enterpriseId: enterpriseContext?.enterpriseId,
    });
    if (
      !ownerAccountKey
      || (isEnterpriseAccount && !enterpriseContext)
      || hasMismatchedEnterpriseId
    ) {
      this.clearAuthenticatedAccountState();
      throw new Error('Authenticated account context is missing or inconsistent');
    }
    if (store.getState().auth.ownerAccountKey !== ownerAccountKey) {
      store.dispatch(clearMediaAccountState());
    }
    store.dispatch(clearServerModels());
    store.dispatch(setLoggedIn({
      user,
      quota: quota ?? null,
      ownerAccountKey,
    }));
    const context = applyEnterpriseAccountContext(enterpriseContext);
    if (context) {
      store.dispatch(clearProfileSummary());
    }
  }

  private clearAuthenticatedAccountState(): void {
    store.dispatch(setLoggedOut());
    applyEnterpriseAccountContext(null);
    store.dispatch(clearServerModels());
    store.dispatch(clearMediaAccountState());
  }

  /**
   * Initialize: try to restore login state from persisted token.
   */
  async init() {
    // Clean up any existing listeners to prevent stacking on repeated init()
    this.destroy();

    store.dispatch(setAuthLoading(true));

    // Listen for OAuth callback from protocol handler
    this.unsubCallback = window.electron.auth.onCallback(async ({ code }) => {
      await this.handleCallback(code);
    });
    this.unsubSessionChanged = window.electron.auth.onSessionChanged(event => {
      void this.handleSessionChanged(event);
    });
    this.unsubLifecycleEvent = window.electron.auth.onLifecycleEvent(reportAuthLifecycleEvent);
    this.unsubEnterpriseContextInvalidated = window.electron.enterpriseAccount.onContextInvalidated(() => {
      this.clearAuthenticatedAccountState();
      writeAuthRendererLog(
        'warn',
        'Enterprise account context was invalidated by the server; account-scoped media state was cleared',
      );
    });

    try {
      const pendingCode = await window.electron.auth.getPendingCallback();
      let handledPendingCode = false;
      if (pendingCode) {
        handledPendingCode = await this.handleCallback(pendingCode);
      }
      if (!handledPendingCode) {
        await this.refreshAuthState({
          clearOnFailure: true,
          reportLifecycle: true,
        });
      }
    } catch {
      store.dispatch(setAuthTemporarilyUnavailable({ hasCredentials: false }));
      reportAuthLifecycleEvent({
        eventType: AuthLifecycleEventType.Restore,
        outcome: AuthSessionStatus.TemporarilyUnavailable,
      });
    }

    // Listen for quota changes (e.g. after cowork session using server model)
    this.unsubQuotaChanged = window.electron.auth.onQuotaChanged(() => {
      void this.checkQuota();
    });

    // Refresh quota and models when Electron window gains focus — user may have purchased on portal
    this.unsubWindowState = window.electron.window.onStateChanged((state) => {
      if (state.isFocused && store.getState().auth.isLoggedIn) {
        const now = Date.now();
        if (now - this.lastRefreshTime > 30_000) {
          this.lastRefreshTime = now;
          void this.checkQuota();
        }
      }
    });
  }

  /**
   * Initiate login (opens system browser).
   */
  async login() {
    const attemptId = ++this.loginAttemptSequence;
    writeAuthRendererLog('info', `login attempt ${attemptId} started`);

    try {
      const loginUrl = await this.fetchLoginUrl();
      const result = await window.electron.auth.login(loginUrl);
      if (result.success) {
        writeAuthRendererLog('info', `login attempt ${attemptId} handed off to the system browser`);
      } else {
        writeAuthRendererLog('warn', `login attempt ${attemptId} could not open the system browser`);
      }
    } catch (error) {
      writeAuthRendererLog('warn', `login attempt ${attemptId} failed before browser handoff`, error);
      throw error;
    }
  }

  /**
   * Fetch login URL from overmind, fallback to Portal login page.
   */
  private async fetchLoginUrl(): Promise<string> {
    const { getLoginOvermindUrl } = await import('./endpoints');
    const url = getLoginOvermindUrl();
    try {
      const response = await window.electron.api.fetch({
        url,
        method: 'GET',
        headers: { Accept: 'application/json' },
      });
      if (response.ok && typeof response.data === 'object' && response.data !== null) {
        const value = (response.data as any)?.data?.value;
        if (typeof value === 'string' && value.trim()) {
          writeAuthRendererLog('debug', 'resolved login URL from overmind');
          return value.trim();
        }
      }
    } catch (e) {
      writeAuthRendererLog('warn', 'failed to resolve login URL from overmind', e);
    }
    // Fallback: use Portal login page directly
    const { getPortalLoginUrl } = await import('./endpoints');
    writeAuthRendererLog('info', 'using fallback portal login URL');
    return getPortalLoginUrl();
  }

  /**
   * Handle OAuth callback with auth code.
   */
  async handleCallback(code: string): Promise<boolean> {
    writeAuthRendererLog('info', 'received login callback; starting token exchange');
    try {
      const result = await window.electron.auth.exchange(code);
      if (result.success && result.user) {
        writeAuthRendererLog('info', 'login callback exchange succeeded');
        store.dispatch(invalidateAuthAccountContext());
        store.dispatch(clearMediaAccountState());
        this.applyAuthenticatedState(
          result.user,
          result.quota,
          result.enterpriseContext,
        );
        await this.loadServerModels();
        void this.fetchProfileSummary();
        this.refreshQuota();
        return true;
      }
      writeAuthRendererLog('warn', 'login callback exchange was rejected');
    } catch (e) {
      writeAuthRendererLog('warn', 'login callback exchange failed', e);
    }
    return false;
  }

  /**
   * Refresh the full auth snapshot from persisted tokens.
   */
  async refreshAuthState(
    options: {
      clearOnFailure?: boolean;
      reportLifecycle?: boolean;
    } = {},
  ): Promise<AuthStateRefreshResult> {
    const authStateAtStart = store.getState().auth;
    try {
      const result = await window.electron.auth.getUser();
      if (!isAuthAccountRequestCurrent(authStateAtStart, store.getState().auth)) {
        writeAuthRendererLog(
          'debug',
          'discarded stale auth restoration response after auth state changed',
        );
        const current = store.getState().auth;
        return {
          isLoggedIn: current.isLoggedIn,
          user: current.user,
          quota: current.quota,
          enterpriseContext: store.getState().enterpriseAccount.context,
        };
      }
      if (result.success && result.user) {
        const enterpriseContext = result.enterpriseContext === undefined
          ? await refreshEnterpriseAccountContext({
            shouldApply: () => (
              isAuthAccountRequestCurrent(authStateAtStart, store.getState().auth)
            ),
          })
          : result.enterpriseContext;
        if (!isAuthAccountRequestCurrent(authStateAtStart, store.getState().auth)) {
          writeAuthRendererLog(
            'debug',
            'discarded stale auth restoration response after enterprise context refresh',
          );
          const current = store.getState().auth;
          return {
            isLoggedIn: current.isLoggedIn,
            user: current.user,
            quota: current.quota,
            enterpriseContext: store.getState().enterpriseAccount.context,
          };
        }
        this.applyAuthenticatedState(result.user, result.quota, enterpriseContext);
        await this.loadServerModels();
        void this.fetchProfileSummary();
        if (options.reportLifecycle) {
          reportAuthLifecycleEvent({
            eventType: AuthLifecycleEventType.Restore,
            outcome: AuthSessionStatus.Authenticated,
          });
        }
        return {
          isLoggedIn: true,
          user: result.user,
          quota: result.quota ?? null,
          enterpriseContext: enterpriseContext ?? null,
        };
      }

      const status = result.status ?? (
        result.hasCredentials
          ? AuthSessionStatus.TemporarilyUnavailable
          : AuthSessionStatus.Unauthenticated
      );
      if (options.reportLifecycle) {
        reportAuthLifecycleEvent({
          eventType: AuthLifecycleEventType.Restore,
          outcome: status,
        });
      }

      if (status === AuthSessionStatus.TemporarilyUnavailable) {
        store.dispatch(setAuthTemporarilyUnavailable({
          hasCredentials: result.hasCredentials === true,
          cachedUser: result.cachedUser ?? null,
        }));
      } else if (status === AuthSessionStatus.Expired) {
        await this.applyLoggedOutState(true);
      } else if (options.clearOnFailure) {
        await this.applyLoggedOutState(false);
      }
    } catch {
      store.dispatch(setAuthTemporarilyUnavailable({
        hasCredentials: store.getState().auth.isLoggedIn,
      }));
      if (options.reportLifecycle) {
        reportAuthLifecycleEvent({
          eventType: AuthLifecycleEventType.Restore,
          outcome: AuthSessionStatus.TemporarilyUnavailable,
        });
      }
    }

    const current = store.getState().auth;
    return {
      isLoggedIn: current.isLoggedIn,
      user: current.user,
      quota: current.quota,
      enterpriseContext: store.getState().enterpriseAccount.context,
    };
  }

  /**
   * Logout.
   */
  async logout() {
    await window.electron.auth.logout();
    await this.applyLoggedOutState(false);
  }

  /**
   * Refresh quota information.
   */
  async refreshQuota(): Promise<boolean> {
    const authStateAtStart = store.getState().auth;
    if (
      !authStateAtStart.isLoggedIn
      || !authStateAtStart.user
      || !authStateAtStart.ownerAccountKey
    ) {
      return false;
    }
    try {
      const result = await window.electron.auth.getQuota();
      const currentAuthState = store.getState().auth;
      if (
        !currentAuthState.isLoggedIn
        || currentAuthState.ownerAccountKey !== authStateAtStart.ownerAccountKey
        || currentAuthState.accountGeneration !== authStateAtStart.accountGeneration
      ) {
        const message = 'Discarded stale quota response after auth state changed';
        console.debug(`[Auth] ${message}`);
        window.electron?.log?.fromRenderer?.('debug', 'Auth', message);
        return false;
      }
      if (result.success) {
        if (result.quota) {
          store.dispatch(updateQuota(result.quota));
        }
        if (result.enterpriseContext !== undefined) {
          applyEnterpriseAccountContext(result.enterpriseContext);
        }
        return true;
      }
      return false;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.warn('[Auth] quota refresh failed:', error);
      window.electron?.log?.fromRenderer?.(
        'warn',
        'Auth',
        `Quota refresh failed: ${message.replace(/\s+/g, ' ').slice(0, 500)}`,
      );
      return false;
    }
  }

  async checkQuota(): Promise<AuthQuotaCheckResult> {
    if (this.pendingQuotaCheck) {
      writeAuthRendererLog('debug', 'joining the in-flight quota check');
      return this.pendingQuotaCheck;
    }

    const check = this.performQuotaCheck();
    this.pendingQuotaCheck = check;
    try {
      return await check;
    } finally {
      if (this.pendingQuotaCheck === check) {
        this.pendingQuotaCheck = null;
      }
    }
  }

  private async performQuotaCheck(): Promise<AuthQuotaCheckResult> {
    writeAuthRendererLog('debug', 'quota check started');
    try {
      const refreshed = await this.refreshQuota();
      if (!refreshed) {
        writeAuthRendererLog('warn', 'quota check could not refresh quota state');
        return {
          success: false,
          enterpriseQuotaAvailable: false,
        };
      }
      await Promise.all([
        this.fetchProfileSummary(),
        this.loadServerModels(),
      ]);
      const enterpriseContext = store.getState().enterpriseAccount.context;
      const enterpriseQuotaAvailable = (
        !enterpriseContext
        || enterpriseContext.quotaStatus.available !== false
      );
      writeAuthRendererLog(
        'debug',
        `quota check completed (enterprise quota available: ${enterpriseQuotaAvailable})`,
      );
      return {
        success: true,
        enterpriseQuotaAvailable,
      };
    } catch (error) {
      writeAuthRendererLog('warn', 'quota check failed unexpectedly', error);
      return {
        success: false,
        enterpriseQuotaAvailable: false,
      };
    }
  }

  /**
   * Fetch profile summary (credits breakdown).
   */
  async fetchProfileSummary() {
    if (store.getState().enterpriseAccount.context) {
      store.dispatch(clearProfileSummary());
      return;
    }
    const authStateAtStart = store.getState().auth;
    if (
      !authStateAtStart.isLoggedIn
      || !authStateAtStart.ownerAccountKey
    ) {
      return;
    }
    try {
      const result = await window.electron.auth.getProfileSummary();
      const currentAuthState = store.getState().auth;
      if (
        !isAuthAccountRequestCurrent(authStateAtStart, currentAuthState)
        || store.getState().enterpriseAccount.context
      ) {
        writeAuthRendererLog('debug', 'discarded stale profile summary response after auth state changed');
        return;
      }
      if (result.success && result.data) {
        store.dispatch(setProfileSummary(result.data));
      } else {
        writeAuthRendererLog('debug', 'profile summary refresh returned no data');
      }
    } catch (error) {
      writeAuthRendererLog('warn', 'profile summary refresh failed', error);
    }
  }

  /**
   * Get current access token (for proxy API calls).
   */
  async getAccessToken(): Promise<string | null> {
    try {
      return await window.electron.auth.getAccessToken();
    } catch {
      return null;
    }
  }

  destroy() {
    this.unsubCallback?.();
    this.unsubCallback = null;
    this.unsubLifecycleEvent?.();
    this.unsubLifecycleEvent = null;
    this.unsubQuotaChanged?.();
    this.unsubQuotaChanged = null;
    this.unsubSessionChanged?.();
    this.unsubSessionChanged = null;
    this.unsubEnterpriseContextInvalidated?.();
    this.unsubEnterpriseContextInvalidated = null;
    this.unsubWindowState?.();
    this.unsubWindowState = null;
  }

  private async handleSessionChanged(event: AuthSessionChangedEvent): Promise<void> {
    if (event.status !== AuthSessionStatus.Expired) return;
    writeAuthRendererLog('warn', `login session expired (${event.reason})`);
    const cleanup = this.applyLoggedOutState(true);
    window.dispatchEvent(new CustomEvent('app:showToast', {
      detail: i18nService.t('coworkErrorLobsterAILoginExpired'),
    }));
    await cleanup;
  }

  private async applyLoggedOutState(expired: boolean): Promise<void> {
    const targetStatus = expired
      ? AuthSessionStatus.Expired
      : AuthSessionStatus.Unauthenticated;
    const current = store.getState().auth;
    if (
      !current.isLoggedIn
      && !current.isLoading
      && current.sessionStatus === targetStatus
      && !store.getState().enterpriseAccount.context
    ) {
      return;
    }

    store.dispatch(expired ? setAuthExpired() : setLoggedOut());
    applyEnterpriseAccountContext(null);
    store.dispatch(clearServerModels());
    store.dispatch(clearMediaAccountState());
    await this.loadPublicPricingCatalogModels();
  }

  /**
   * Load available models from server and dispatch to store.
   */
  private async loadServerModels() {
    const authStateAtStart = store.getState().auth;
    if (
      !authStateAtStart.isLoggedIn
      || !authStateAtStart.ownerAccountKey
    ) {
      return;
    }
    try {
      const modelsResult = await window.electron.auth.getModels();
      if (!isAuthAccountRequestCurrent(authStateAtStart, store.getState().auth)) {
        writeAuthRendererLog('debug', 'discarded stale server model response after auth state changed');
        return;
      }
      if (modelsResult.success && modelsResult.models) {
        const serverModels = mapAvailableServerModelsToModels(modelsResult.models);
        store.dispatch(setServerModels(serverModels));
        console.debug(`[Auth] loaded ${serverModels.length} server model(s) into renderer state`);
      } else {
        console.debug('[Auth] server model load returned no models');
      }
    } catch (error) {
      console.warn('[Auth] failed to load server models:', error);
    }
  }

  /**
   * Load public pricing catalog models for unauthenticated read-only display.
   */
  private async loadPublicPricingCatalogModels() {
    const authStateAtStart = store.getState().auth;
    if (authStateAtStart.isLoggedIn || authStateAtStart.ownerAccountKey) {
      return;
    }
    try {
      const catalogResult = await window.electron.auth.getPricingCatalog();
      if (!isAuthAccountRequestCurrent(authStateAtStart, store.getState().auth)) {
        writeAuthRendererLog('debug', 'discarded stale public pricing catalog after auth state changed');
        return;
      }
      if (!catalogResult.success || !catalogResult.textModels) {
        return;
      }
      const serverModels = mapPricingCatalogToPublicServerModels({
        textModels: catalogResult.textModels,
      });
      store.dispatch(setServerModels(serverModels));
    } catch {
      // ignore — public catalog is optional
    }
  }
}

export const authService = new AuthService();
