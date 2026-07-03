import { EyeIcon, EyeSlashIcon, XCircleIcon as XCircleIconSolid } from '@heroicons/react/20/solid';
import {
  CheckCircleIcon,
  PlusIcon,
  SignalIcon,
  SparklesIcon,
  StarIcon,
  TrashIcon,
  XCircleIcon,
} from '@heroicons/react/24/outline';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { i18nService } from '../../services/i18n';
import { LogReporterAction, reportYdAnalyzer } from '../../services/logReporter';
import { type EmailSkillAccountConfig, type EmailSkillAccountsConfig, skillService } from '../../services/skill';

const SKILL_ID = 'imap-smtp-email';
const EMAIL_ANALYTICS_SOURCE = 'settings_email';

interface ProviderPreset {
  label: string;
  imapHost: string;
  imapPort: number;
  smtpHost: string;
  smtpPort: number;
  smtpSecure: boolean;
  hint?: string;
}

type EmailConnectivityCheck = {
  code: 'imap_connection' | 'smtp_connection';
  level: 'pass' | 'fail';
  message: string;
  durationMs: number;
};

type EmailConnectivityTestResult = {
  testedAt: number;
  verdict: 'pass' | 'fail';
  checks: EmailConnectivityCheck[];
};

const PROVIDER_PRESETS: Record<string, ProviderPreset> = {
  gmail: {
    label: 'Gmail',
    imapHost: 'imap.gmail.com',
    imapPort: 993,
    smtpHost: 'smtp.gmail.com',
    smtpPort: 587,
    smtpSecure: false,
    hint: 'emailHintGmail',
  },
  outlook: {
    label: 'Outlook',
    imapHost: 'outlook.office365.com',
    imapPort: 993,
    smtpHost: 'smtp.office365.com',
    smtpPort: 587,
    smtpSecure: false,
  },
  '163': {
    label: '163.com',
    imapHost: 'imap.163.com',
    imapPort: 993,
    smtpHost: 'smtp.163.com',
    smtpPort: 465,
    smtpSecure: true,
    hint: 'emailHint163',
  },
  '126': {
    label: '126.com',
    imapHost: 'imap.126.com',
    imapPort: 993,
    smtpHost: 'smtp.126.com',
    smtpPort: 465,
    smtpSecure: true,
    hint: 'emailHint163',
  },
  qq: {
    label: 'QQ Mail',
    imapHost: 'imap.qq.com',
    imapPort: 993,
    smtpHost: 'smtp.qq.com',
    smtpPort: 587,
    smtpSecure: false,
    hint: 'emailHintQQ',
  },
  custom: {
    label: '',
    imapHost: '',
    imapPort: 993,
    smtpHost: '',
    smtpPort: 587,
    smtpSecure: false,
  },
};

const createEmptyAccount = (index: number): EmailSkillAccountConfig => ({
  id: `account-${index}`,
  name: `${i18nService.t('emailAccount')} ${index}`,
  enabled: false,
  provider: '',
  email: '',
  password: '',
  imapHost: '',
  imapPort: 993,
  imapTls: true,
  imapRejectUnauthorized: true,
  smtpHost: '',
  smtpPort: 587,
  smtpSecure: false,
  smtpRejectUnauthorized: true,
  smtpFrom: '',
  mailbox: 'INBOX',
  requireSendConfirmation: true,
});

const normalizeConfig = (config: EmailSkillAccountsConfig): EmailSkillAccountsConfig => {
  const accounts = config.accounts.map((account, index) => ({
    ...createEmptyAccount(index + 1),
    ...account,
    id: account.id || `account-${index + 1}`,
    name: account.name || account.email?.split('@')[0] || `account-${index + 1}`,
  }));
  const defaultAccount = accounts.find(account => account.id === config.defaultAccountId && account.enabled)
    ?? accounts.find(account => account.enabled)
    ?? accounts[0];
  return {
    version: 1,
    defaultAccountId: defaultAccount?.id ?? '',
    accounts,
  };
};

const nextAccountId = (accounts: EmailSkillAccountConfig[]): string => {
  let index = accounts.length + 1;
  const used = new Set(accounts.map(account => account.id));
  while (used.has(`account-${index}`)) index += 1;
  return `account-${index}`;
};

const getAccountDisplayName = (account: EmailSkillAccountConfig): string => {
  if (account.id === 'default' && (account.name === 'Default' || account.name === 'default')) {
    return i18nService.t('emailDefaultAccountDisplayName');
  }
  return account.name || account.email || account.id;
};

const getChangedAccountKeys = (patch: Partial<EmailSkillAccountConfig>): string => {
  const fieldMappings: Array<[keyof EmailSkillAccountConfig, string]> = [
    ['provider', 'provider'],
    ['email', 'email'],
    ['password', 'password'],
    ['imapHost', 'imap_host'],
    ['imapPort', 'imap_port'],
    ['imapTls', 'imap_tls'],
    ['imapRejectUnauthorized', 'allow_insecure_cert'],
    ['smtpHost', 'smtp_host'],
    ['smtpPort', 'smtp_port'],
    ['smtpSecure', 'smtp_secure'],
    ['smtpRejectUnauthorized', 'allow_insecure_cert'],
    ['smtpFrom', 'email'],
    ['mailbox', 'mailbox'],
    ['enabled', 'enabled'],
    ['requireSendConfirmation', 'send_confirmation'],
  ];
  const changedKeys = new Set<string>();
  fieldMappings.forEach(([field, key]) => {
    if (Object.prototype.hasOwnProperty.call(patch, field)) {
      changedKeys.add(key);
    }
  });
  return Array.from(changedKeys).join(',');
};

const buildEmailSkillAnalyticsParams = (
  config: EmailSkillAccountsConfig,
  account: EmailSkillAccountConfig | null,
) => ({
  source: EMAIL_ANALYTICS_SOURCE,
  skillId: SKILL_ID,
  provider: account?.provider ?? '',
  accountCount: config.accounts.length,
  enabledAccountCount: config.accounts.filter(item => item.enabled).length,
  hasEmail: Boolean(account?.email?.trim()),
  hasPassword: Boolean(account?.password?.trim()),
  hasImapHost: Boolean(account?.imapHost?.trim()),
  hasSmtpHost: Boolean(account?.smtpHost?.trim()),
  imapTlsEnabled: account?.imapTls !== false,
  smtpSslEnabled: account?.smtpSecure === true,
  allowInsecureCert: account?.imapRejectUnauthorized === false || account?.smtpRejectUnauthorized === false,
  mailboxCustomized: Boolean(account?.mailbox && account.mailbox !== 'INBOX'),
});

interface EmailSkillConfigProps {
  onClose?: () => void;
}

const EmailSkillConfig: React.FC<EmailSkillConfigProps> = ({ onClose }) => {
  const [config, setConfig] = useState<EmailSkillAccountsConfig>({
    version: 1,
    defaultAccountId: '',
    accounts: [],
  });
  const [activeAccountId, setActiveAccountId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [persisting, setPersisting] = useState(false);
  const [persistError, setPersistError] = useState<string | null>(null);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [testingAccountId, setTestingAccountId] = useState<string | null>(null);
  const [connectivityResults, setConnectivityResults] = useState<Record<string, EmailConnectivityTestResult>>({});
  const [connectivityError, setConnectivityError] = useState<string | null>(null);
  const isMountedRef = useRef(true);
  const persistQueueRef = useRef(Promise.resolve());
  const persistPendingCountRef = useRef(0);

  useEffect(() => {
    isMountedRef.current = true;
    const loadConfig = async () => {
      try {
        console.debug('[EmailSkillConfig] loading email accounts config');
        const loaded = normalizeConfig(await skillService.getEmailAccountsConfig(SKILL_ID));
        if (!isMountedRef.current) return;
        setConfig(loaded);
        setActiveAccountId(loaded.defaultAccountId || loaded.accounts[0]?.id || null);
        setLoadError(null);
        console.debug('[EmailSkillConfig] loaded email accounts config', {
          accountCount: loaded.accounts.length,
          enabledAccountCount: loaded.accounts.filter(account => account.enabled).length,
          defaultAccountId: loaded.defaultAccountId,
        });
      } catch (error) {
        console.error('[EmailSkillConfig] failed to load email accounts config:', error);
        if (!isMountedRef.current) return;
        setLoadError(i18nService.t('emailConfigLoadError'));
      } finally {
        if (isMountedRef.current) {
          setLoading(false);
        }
      }
    };
    void loadConfig();
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  const activeAccount = useMemo(
    () => config.accounts.find(account => account.id === activeAccountId) ?? null,
    [activeAccountId, config.accounts],
  );

  const persistConfig = useCallback(async (
    nextConfig: EmailSkillAccountsConfig,
    analyticsChangedKeys = '',
  ) => {
    const normalized = normalizeConfig(nextConfig);
    if (isMountedRef.current) {
      setConfig(normalized);
    }
    persistPendingCountRef.current += 1;
    if (isMountedRef.current) {
      setPersisting(true);
    }
    console.debug('[EmailSkillConfig] persisting email accounts config', {
      accountCount: normalized.accounts.length,
      enabledAccountCount: normalized.accounts.filter(account => account.enabled).length,
      defaultAccountId: normalized.defaultAccountId,
      changedKeys: analyticsChangedKeys,
    });
    const persistTask = persistQueueRef.current
      .catch(() => undefined)
      .then(() => skillService.setEmailAccountsConfig(SKILL_ID, normalized));
    persistQueueRef.current = persistTask.then(() => undefined, () => undefined);
    const success = await persistTask;
    persistPendingCountRef.current = Math.max(0, persistPendingCountRef.current - 1);
    if (isMountedRef.current && persistPendingCountRef.current === 0) {
      setPersisting(false);
    }
    if (isMountedRef.current) {
      setPersistError(success ? null : i18nService.t('emailConfigError'));
    }
    if (success) {
      console.debug('[EmailSkillConfig] persisted email accounts config', {
        accountCount: normalized.accounts.length,
        enabledAccountCount: normalized.accounts.filter(account => account.enabled).length,
        defaultAccountId: normalized.defaultAccountId,
      });
    } else {
      console.warn('[EmailSkillConfig] failed to persist email accounts config', {
        accountCount: normalized.accounts.length,
        defaultAccountId: normalized.defaultAccountId,
      });
    }
    if (success && analyticsChangedKeys) {
      const analyticsAccount = normalized.accounts.find(account => account.id === activeAccountId)
        ?? normalized.accounts.find(account => account.id === normalized.defaultAccountId)
        ?? null;
      void reportYdAnalyzer({
        action: LogReporterAction.EmailSkillSettingsSaved,
        ...buildEmailSkillAnalyticsParams(normalized, analyticsAccount),
        changedKeys: analyticsChangedKeys,
      });
    }
    return success;
  }, [activeAccountId]);

  const updateActiveAccount = useCallback((patch: Partial<EmailSkillAccountConfig>) => {
    if (!activeAccount) return;
    setConfig(prev => ({
      ...prev,
      accounts: prev.accounts.map(account =>
        account.id === activeAccount.id ? { ...account, ...patch } : account,
      ),
    }));
  }, [activeAccount]);

  const persistActiveAccount = useCallback(async (patch: Partial<EmailSkillAccountConfig> = {}) => {
    if (!activeAccount) return;
    const nextAccounts = config.accounts.map(account =>
      account.id === activeAccount.id ? { ...account, ...patch } : account,
    );
    await persistConfig({ ...config, accounts: nextAccounts }, getChangedAccountKeys(patch) || 'account');
  }, [activeAccount, config, persistConfig]);

  const handleAddAccount = async () => {
    const id = nextAccountId(config.accounts);
    const account = { ...createEmptyAccount(config.accounts.length + 1), id };
    const nextConfig = normalizeConfig({
      ...config,
      defaultAccountId: config.defaultAccountId || id,
      accounts: [...config.accounts, account],
    });
    setActiveAccountId(id);
    await persistConfig(nextConfig, 'account_added');
  };

  const handleDeleteAccount = async (accountId: string) => {
    const accounts = config.accounts.filter(account => account.id !== accountId);
    const defaultAccountId = config.defaultAccountId === accountId
      ? (accounts.find(account => account.enabled)?.id ?? accounts[0]?.id ?? '')
      : config.defaultAccountId;
    const nextConfig = normalizeConfig({ ...config, accounts, defaultAccountId });
    setActiveAccountId(nextConfig.defaultAccountId || nextConfig.accounts[0]?.id || null);
    await persistConfig(nextConfig, 'account_deleted');
  };

  const handleSetDefault = async (accountId: string) => {
    await persistConfig({ ...config, defaultAccountId: accountId }, 'default_account');
  };

  const handleProviderChange = (provider: string) => {
    const preset = PROVIDER_PRESETS[provider];
    updateActiveAccount({
      provider,
      ...(preset && provider !== 'custom'
        ? {
            imapHost: preset.imapHost,
            imapPort: preset.imapPort,
            imapTls: true,
            smtpHost: preset.smtpHost,
            smtpPort: preset.smtpPort,
            smtpSecure: preset.smtpSecure,
          }
        : {}),
    });
  };

  const handleEmailBlur = async () => {
    if (!activeAccount) return;
    const email = activeAccount.email.trim();
    await persistActiveAccount({
      email,
      smtpFrom: activeAccount.smtpFrom || email,
      name: activeAccount.name || email.split('@')[0] || activeAccount.id,
    });
  };

  const canTest = Boolean(
    activeAccount?.email
      && activeAccount.password
      && activeAccount.imapHost
      && activeAccount.smtpHost,
  );

  const handleConnectivityTest = async () => {
    if (!activeAccount) return;
    setConnectivityError(null);
    setTestingAccountId(activeAccount.id);
    console.debug('[EmailSkillConfig] testing email account connectivity', {
      accountId: activeAccount.id,
      hasEmail: Boolean(activeAccount.email),
      hasPassword: Boolean(activeAccount.password),
      hasImapHost: Boolean(activeAccount.imapHost),
      hasSmtpHost: Boolean(activeAccount.smtpHost),
    });
    try {
      const result = await skillService.testEmailAccountConnectivity(SKILL_ID, activeAccount);
      if (!isMountedRef.current) return;
      if (result) {
        setConnectivityResults(prev => ({ ...prev, [activeAccount.id]: result }));
        const imapCheck = result.checks.find(check => check.code === 'imap_connection');
        const smtpCheck = result.checks.find(check => check.code === 'smtp_connection');
        void reportYdAnalyzer({
          action: LogReporterAction.EmailSkillConnectionTested,
          ...buildEmailSkillAnalyticsParams(config, activeAccount),
          result: result.verdict,
          imapResult: imapCheck?.level ?? '',
          smtpResult: smtpCheck?.level ?? '',
        });
        console.debug('[EmailSkillConfig] email account connectivity test completed', {
          accountId: activeAccount.id,
          verdict: result.verdict,
        });
      } else {
        setConnectivityError(i18nService.t('connectionFailed'));
        void reportYdAnalyzer({
          action: LogReporterAction.EmailSkillConnectionTested,
          ...buildEmailSkillAnalyticsParams(config, activeAccount),
          result: 'fail',
          imapResult: '',
          smtpResult: '',
        });
        console.warn('[EmailSkillConfig] email account connectivity test returned no result', {
          accountId: activeAccount.id,
        });
      }
    } catch (error) {
      console.error('[EmailSkillConfig] email account connectivity test failed:', error);
      if (!isMountedRef.current) return;
      setConnectivityError(i18nService.t('connectionFailed'));
      void reportYdAnalyzer({
        action: LogReporterAction.EmailSkillConnectionTested,
        ...buildEmailSkillAnalyticsParams(config, activeAccount),
        result: 'fail',
        imapResult: '',
        smtpResult: '',
      });
    } finally {
      if (isMountedRef.current) {
        setTestingAccountId(null);
      }
    }
  };

  const buildAskAIPrompt = useCallback((result: EmailConnectivityTestResult | null): string => {
    const account = activeAccount;
    const lines: string[] = [];
    lines.push('我在配置邮件的 IMAP/SMTP 连接时遇到了问题，请帮我排查并给出解决方案。');
    if (account) {
      lines.push(`邮箱账号：${getAccountDisplayName(account)}`);
      lines.push(`邮箱地址：${account.email}`);
      lines.push(`IMAP 服务器：${account.imapHost}:${account.imapPort}`);
      lines.push(`SMTP 服务器：${account.smtpHost}:${account.smtpPort}`);
    }
    lines.push('连接测试失败，错误信息如下：');
    if (result) {
      result.checks.forEach(check => {
        const label = check.code === 'imap_connection' ? 'IMAP' : 'SMTP';
        const status = check.level === 'pass' ? '成功' : '失败';
        lines.push(`- ${label} 连接${status}：${check.message}（耗时 ${check.durationMs}ms）`);
      });
    } else if (connectivityError) {
      lines.push(`- ${connectivityError}`);
    }
    return lines.join('\n');
  }, [activeAccount, connectivityError]);

  const handleAskAI = (result: EmailConnectivityTestResult | null) => {
    window.dispatchEvent(new CustomEvent('app:ask-ai', { detail: buildAskAIPrompt(result) }));
  };

  const inputClassName =
    'block h-9 w-full rounded-lg bg-surface-inset border border-border focus:border-primary focus:ring-1 focus:ring-primary/30 text-foreground px-3 text-xs';
  const labelClassName = 'block text-[11px] font-medium text-secondary mb-1.5';

  if (loading) {
    return <div className="p-4 text-xs text-secondary">{i18nService.t('loading')}...</div>;
  }

  const activeResult = activeAccount ? connectivityResults[activeAccount.id] : null;
  const connectivityPassed = activeResult?.verdict === 'pass';
  const currentPreset = activeAccount?.provider ? PROVIDER_PRESETS[activeAccount.provider] : null;

  return (
    <div className="rounded-lg border border-border-subtle bg-surface overflow-hidden">
      <div className="flex items-start justify-between gap-4 border-b border-border-subtle px-5 py-4">
        <div className="min-w-0">
          <h4 className="text-sm font-medium text-foreground">{i18nService.t('emailConfig')}</h4>
          <p className="mt-1 text-xs leading-5 text-secondary">{i18nService.t('emailAccountsHint')}</p>
        </div>
        {onClose && (
          <button
            type="button"
            onClick={onClose}
            className="flex-shrink-0 text-xs text-secondary hover:text-primary transition-colors"
          >
            {i18nService.t('collapse')}
          </button>
        )}
      </div>

      {(loadError || persistError || persisting) && (
        <div className="border-b border-border-subtle px-5 py-2 text-xs">
          {loadError ? (
            <span className="text-red-600 dark:text-red-400">{loadError}</span>
          ) : persistError ? (
            <span className="text-red-600 dark:text-red-400">{persistError}</span>
          ) : persisting ? (
            <span className="text-secondary">{i18nService.t('saving')}...</span>
          ) : null}
        </div>
      )}

      <div className="grid grid-cols-[240px_minmax(0,1fr)] gap-0 max-md:grid-cols-1">
        <div className="border-r border-border-subtle bg-surface-raised/30 p-4 max-md:border-r-0 max-md:border-b">
          <div className="space-y-2 max-h-[min(460px,60vh)] overflow-y-auto pr-1">
          {config.accounts.map(account => {
            const isActive = account.id === activeAccountId;
            const isDefault = account.id === config.defaultAccountId;
            const result = connectivityResults[account.id];
            const accountDisplayName = getAccountDisplayName(account);
            return (
              <button
                type="button"
                key={account.id}
                onClick={() => setActiveAccountId(account.id)}
                className={`w-full rounded-lg border px-3 py-2.5 text-left transition-colors ${
                  isActive
                    ? 'border-primary/80 bg-primary/5 shadow-sm ring-1 ring-primary/10'
                    : 'border-border-subtle bg-surface hover:border-border hover:bg-surface-raised'
                }`}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="truncate text-xs font-medium text-foreground">{accountDisplayName}</span>
                  {isDefault && <StarIcon className="h-3.5 w-3.5 text-yellow-500 flex-shrink-0" />}
                </div>
                <div className="mt-1 truncate text-[11px] leading-4 text-secondary">{account.email || account.id}</div>
                <div className="mt-1.5 flex items-center gap-1.5 text-[11px] text-secondary">
                  <span>{account.enabled ? i18nService.t('enabled') : i18nService.t('disabled')}</span>
                  {result && <span>{result.verdict === 'pass' ? i18nService.t('connectionSuccess') : i18nService.t('connectionFailed')}</span>}
                </div>
              </button>
            );
          })}

          <button
            type="button"
            onClick={() => void handleAddAccount()}
            className="inline-flex h-10 w-full items-center justify-center gap-1.5 rounded-lg border border-dashed border-border bg-surface px-3 text-xs text-secondary transition-colors hover:bg-surface-raised hover:text-primary"
          >
            <PlusIcon className="h-3.5 w-3.5" />
            {i18nService.t('emailAddAccount')}
          </button>
          </div>
        </div>

        {activeAccount ? (
          <div className="space-y-4 p-5">
            <div className="flex items-start justify-between gap-4 border-b border-border-subtle pb-4">
              <div className="min-w-0">
                <div className="text-sm font-medium text-foreground truncate">{getAccountDisplayName(activeAccount)}</div>
                <div className="mt-0.5 text-xs text-secondary truncate">{activeAccount.id}</div>
              </div>
              <div className="flex flex-wrap items-center justify-end gap-2">
                <button
                  type="button"
                  onClick={() => void handleSetDefault(activeAccount.id)}
                  className="inline-flex h-8 items-center gap-1 rounded-lg border border-border px-2.5 text-xs text-foreground transition-colors hover:bg-surface-raised"
                >
                  <StarIcon className="h-3.5 w-3.5" />
                  {activeAccount.id === config.defaultAccountId ? i18nService.t('emailDefaultAccount') : i18nService.t('emailSetDefault')}
                </button>
                <button
                  type="button"
                  onClick={() => void persistActiveAccount({ enabled: !activeAccount.enabled })}
                  className="h-8 rounded-lg border border-border px-2.5 text-xs text-foreground transition-colors hover:bg-surface-raised"
                >
                  {activeAccount.enabled ? i18nService.t('disable') : i18nService.t('enable')}
                </button>
                <button
                  type="button"
                  onClick={() => void handleDeleteAccount(activeAccount.id)}
                  className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-red-500/40 text-red-600 transition-colors hover:bg-red-500/10"
                >
                  <TrashIcon className="h-3.5 w-3.5" />
                </button>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-x-4 gap-y-3 max-md:grid-cols-1">
              <div>
                <label className={labelClassName}>{i18nService.t('emailAccountName')}</label>
                <input
                  type="text"
                  value={activeAccount.name}
                  onChange={e => updateActiveAccount({ name: e.target.value })}
                  onBlur={() => void persistActiveAccount()}
                  className={inputClassName}
                />
              </div>
              <div>
                <label className={labelClassName}>{i18nService.t('emailProvider')}</label>
                <select
                  value={activeAccount.provider ?? ''}
                  onChange={e => handleProviderChange(e.target.value)}
                  onBlur={() => void persistActiveAccount()}
                  className={inputClassName}
                >
                  <option value="">{i18nService.t('emailSelectProvider')}</option>
                  {Object.entries(PROVIDER_PRESETS).map(([key, preset]) => (
                    <option key={key} value={key}>
                      {key === 'custom' ? i18nService.t('emailCustomProvider') : preset.label}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            {currentPreset?.hint && (
              <div className="text-xs text-secondary bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-lg px-3 py-2">
                {i18nService.t(currentPreset.hint)}
              </div>
            )}

            <div className="grid grid-cols-2 gap-x-4 gap-y-3 max-md:grid-cols-1">
              <div>
                <label className={labelClassName}>{i18nService.t('emailAddress')}<span className="text-red-500 ml-0.5">*</span></label>
                <input
                  type="email"
                  value={activeAccount.email}
                  onChange={e => updateActiveAccount({ email: e.target.value })}
                  onBlur={() => void handleEmailBlur()}
                  className={inputClassName}
                  placeholder={i18nService.t('emailAddressPlaceholder')}
                />
              </div>
              <div>
                <label className={labelClassName}>{i18nService.t('emailPassword')}<span className="text-red-500 ml-0.5">*</span></label>
                <div className="relative">
                  <input
                    type={showPassword ? 'text' : 'password'}
                    value={activeAccount.password ?? ''}
                    onChange={e => updateActiveAccount({ password: e.target.value })}
                    onBlur={() => void persistActiveAccount()}
                    className={`${inputClassName} pr-16`}
                    placeholder={i18nService.t('emailPasswordPlaceholder')}
                  />
                  <div className="absolute right-2 top-1/2 -translate-y-1/2 flex items-center gap-1">
                    {activeAccount.password && (
                      <button
                        type="button"
                        onClick={() => {
                          updateActiveAccount({ password: '' });
                          void persistActiveAccount({ password: '' });
                        }}
                        className="p-0.5 rounded text-secondary hover:text-primary transition-colors"
                      >
                        <XCircleIconSolid className="h-4 w-4" />
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => setShowPassword(!showPassword)}
                      className="p-0.5 rounded text-secondary hover:text-primary transition-colors"
                    >
                      {showPassword ? <EyeIcon className="h-4 w-4" /> : <EyeSlashIcon className="h-4 w-4" />}
                    </button>
                  </div>
                </div>
              </div>
            </div>

            <button
              type="button"
              onClick={() => setShowAdvanced(!showAdvanced)}
              className="text-xs text-secondary transition-colors hover:text-primary"
            >
              {showAdvanced ? i18nService.t('collapse') : i18nService.t('emailAdvancedSettings')}
            </button>

            {showAdvanced && (
              <div className="space-y-3 border-l border-border-subtle pl-4">
                <div className="grid grid-cols-2 gap-x-4 gap-y-3 max-md:grid-cols-1">
                  <div>
                    <label className={labelClassName}>{i18nService.t('emailImapHost')}</label>
                    <input
                      type="text"
                      value={activeAccount.imapHost ?? ''}
                      onChange={e => updateActiveAccount({ imapHost: e.target.value })}
                      onBlur={() => void persistActiveAccount()}
                      className={inputClassName}
                    />
                  </div>
                  <div>
                    <label className={labelClassName}>{i18nService.t('emailImapPort')}</label>
                    <input
                      type="number"
                      value={activeAccount.imapPort ?? 993}
                      onChange={e => updateActiveAccount({ imapPort: parseInt(e.target.value, 10) || 993 })}
                      onBlur={() => void persistActiveAccount()}
                      className={inputClassName}
                    />
                  </div>
                  <div>
                    <label className={labelClassName}>{i18nService.t('emailSmtpHost')}</label>
                    <input
                      type="text"
                      value={activeAccount.smtpHost ?? ''}
                      onChange={e => updateActiveAccount({ smtpHost: e.target.value })}
                      onBlur={() => void persistActiveAccount()}
                      className={inputClassName}
                    />
                  </div>
                  <div>
                    <label className={labelClassName}>{i18nService.t('emailSmtpPort')}</label>
                    <input
                      type="number"
                      value={activeAccount.smtpPort ?? 587}
                      onChange={e => updateActiveAccount({ smtpPort: parseInt(e.target.value, 10) || 587 })}
                      onBlur={() => void persistActiveAccount()}
                      className={inputClassName}
                    />
                  </div>
                </div>

                <div>
                  <label className={labelClassName}>{i18nService.t('emailMailbox')}</label>
                  <input
                    type="text"
                    value={activeAccount.mailbox ?? 'INBOX'}
                    onChange={e => updateActiveAccount({ mailbox: e.target.value })}
                    onBlur={() => void persistActiveAccount()}
                    className={inputClassName}
                  />
                </div>

                <div className="grid grid-cols-2 gap-2 max-md:grid-cols-1">
                  <label className="flex min-h-8 items-center gap-2 rounded-lg border border-border-subtle px-3 text-xs text-foreground">
                    <input
                      type="checkbox"
                      checked={activeAccount.imapTls !== false}
                      onChange={e => {
                        const imapTls = e.target.checked;
                        updateActiveAccount({ imapTls });
                        void persistActiveAccount({ imapTls });
                      }}
                      className="h-3.5 w-3.5 text-primary focus:ring-primary rounded"
                    />
                    IMAP TLS
                  </label>
                  <label className="flex min-h-8 items-center gap-2 rounded-lg border border-border-subtle px-3 text-xs text-foreground">
                    <input
                      type="checkbox"
                      checked={activeAccount.smtpSecure === true}
                      onChange={e => {
                        const smtpSecure = e.target.checked;
                        updateActiveAccount({ smtpSecure });
                        void persistActiveAccount({ smtpSecure });
                      }}
                      className="h-3.5 w-3.5 text-primary focus:ring-primary rounded"
                    />
                    SMTP SSL
                  </label>
                  <label className="flex min-h-8 items-center gap-2 rounded-lg border border-border-subtle px-3 text-xs text-foreground">
                    <input
                      type="checkbox"
                      checked={activeAccount.imapRejectUnauthorized === false || activeAccount.smtpRejectUnauthorized === false}
                      onChange={e => {
                        const rejectUnauthorized = !e.target.checked;
                        updateActiveAccount({
                          imapRejectUnauthorized: rejectUnauthorized,
                          smtpRejectUnauthorized: rejectUnauthorized,
                        });
                        void persistActiveAccount({
                          imapRejectUnauthorized: rejectUnauthorized,
                          smtpRejectUnauthorized: rejectUnauthorized,
                        });
                      }}
                      className="h-3.5 w-3.5 text-primary focus:ring-primary rounded"
                    />
                    {i18nService.t('emailAllowInsecureCert')}
                  </label>
                  <label className="flex min-h-8 items-center gap-2 rounded-lg border border-border-subtle px-3 text-xs text-foreground">
                    <input
                      type="checkbox"
                      checked={activeAccount.requireSendConfirmation !== false}
                      onChange={e => {
                        const requireSendConfirmation = e.target.checked;
                        updateActiveAccount({ requireSendConfirmation });
                        void persistActiveAccount({ requireSendConfirmation });
                      }}
                      className="h-3.5 w-3.5 text-primary focus:ring-primary rounded"
                    />
                    {i18nService.t('emailRequireSendConfirmation')}
                  </label>
                </div>
              </div>
            )}

            <div className="space-y-3 border-t border-border-subtle pt-4">
              <button
                type="button"
                onClick={() => void handleConnectivityTest()}
                disabled={testingAccountId === activeAccount.id || !canTest}
                className="inline-flex h-8 items-center rounded-lg border border-border px-3 text-xs font-medium text-foreground transition-colors hover:bg-surface-raised disabled:cursor-not-allowed disabled:opacity-50 active:scale-[0.98]"
              >
                <SignalIcon className="h-3.5 w-3.5 mr-1.5" />
                {testingAccountId === activeAccount.id ? i18nService.t('imConnectivityTesting') : i18nService.t('imConnectivityTest')}
              </button>

              {connectivityError && (
                <div className="space-y-2">
                  <div className="text-xs text-red-600 dark:text-red-400">{connectivityError}</div>
                  <button
                    type="button"
                    onClick={() => handleAskAI(null)}
                    className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-medium rounded-lg border border-claude-accent/50 text-claude-accent hover:bg-claude-accent/10 transition-colors active:scale-[0.98]"
                  >
                    <SparklesIcon className="h-3 w-3" />
                    {i18nService.t('emailConnectivityAskAI')}
                  </button>
                </div>
              )}

              {activeResult && (
                <div className="space-y-2">
                  <div className={`flex items-center gap-1 text-xs ${connectivityPassed ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400'}`}>
                    {connectivityPassed ? <CheckCircleIcon className="h-4 w-4" /> : <XCircleIcon className="h-4 w-4" />}
                    <span>{connectivityPassed ? i18nService.t('connectionSuccess') : i18nService.t('connectionFailed')}</span>
                    <span className="text-[11px] text-secondary">{new Date(activeResult.testedAt).toLocaleString()}</span>
                  </div>
                  <div className="space-y-1.5">
                    {activeResult.checks.map(check => {
                      const checkPassed = check.level === 'pass';
                      const checkLabel = check.code === 'imap_connection' ? 'IMAP' : 'SMTP';
                      return (
                        <div key={check.code} className="rounded-lg border border-border-subtle px-2.5 py-2 bg-surface">
                          <div className={`flex items-center gap-1 text-xs font-medium ${checkPassed ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400'}`}>
                            {checkPassed ? <CheckCircleIcon className="h-3.5 w-3.5" /> : <XCircleIcon className="h-3.5 w-3.5" />}
                            <span>{checkLabel}</span>
                          </div>
                          <div className="mt-1 text-xs text-secondary">{check.message}</div>
                          <div className="mt-1 text-[11px] text-secondary">{`${check.durationMs}ms`}</div>
                        </div>
                      );
                    })}
                  </div>
                  {!connectivityPassed && (
                    <button
                      type="button"
                      onClick={() => handleAskAI(activeResult)}
                      className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-medium rounded-lg border border-claude-accent/50 text-claude-accent hover:bg-claude-accent/10 transition-colors active:scale-[0.98]"
                    >
                      <SparklesIcon className="h-3 w-3" />
                      {i18nService.t('emailConnectivityAskAI')}
                    </button>
                  )}
                </div>
              )}
            </div>
          </div>
        ) : (
          <div className="m-5 rounded-lg border border-dashed border-border p-6 text-center">
            <div className="text-sm text-foreground">{i18nService.t('emailNoAccounts')}</div>
            <button
              type="button"
              onClick={() => void handleAddAccount()}
              className="mt-3 inline-flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-xs text-foreground hover:bg-surface-raised transition-colors"
            >
              <PlusIcon className="h-3.5 w-3.5" />
              {i18nService.t('emailAddAccount')}
            </button>
          </div>
        )}
      </div>
    </div>
  );
};

export default EmailSkillConfig;
