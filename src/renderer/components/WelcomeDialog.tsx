import React from 'react';

import { i18nService } from '@/services/i18n';

const SERVICE_TERMS_URL = 'https://c.youdao.com/dict/hardware/lobsterai/lobsterai_service.html';

interface WelcomeDialogProps {
  onLogin: () => void;
  onCustomModel: () => void;
}

// First-launch gate merging terms consent and login into one screen:
// continuing via either action counts as accepting the service agreement.
const WelcomeDialog: React.FC<WelcomeDialogProps> = ({ onLogin, onCustomModel }) => {
  const handleTermsClick = async (e: React.MouseEvent) => {
    e.preventDefault();
    await window.electron.shell.openExternal(SERVICE_TERMS_URL);
  };

  const notice = i18nService.t('welcomeAgreementNotice');
  const linkText = i18nService.t('welcomeAgreementLinkText');
  const [noticeBefore, noticeAfter] = notice.split('{link}');
  const copyright = i18nService
    .t('welcomeCopyright')
    .replace('{year}', String(new Date().getFullYear()));

  return (
    <div className="fixed inset-0 z-[60] bg-surface flex flex-col items-center">
      {/* dot-grid backdrop */}
      <div
        className="absolute inset-0 pointer-events-none"
        aria-hidden="true"
        style={{
          backgroundImage: 'radial-gradient(var(--lobster-border) 1px, transparent 1.5px)',
          backgroundSize: '18px 18px',
          opacity: 0.5,
        }}
      />

      {/* main content */}
      <div className="relative z-10 flex flex-1 flex-col items-center justify-center w-[320px]">
        <img
          src="logo.png"
          alt="LobsterAI"
          width={72}
          height={72}
          className="rounded-2xl mb-6 select-none"
          draggable={false}
        />

        <h1 className="text-2xl font-semibold text-foreground mb-2 text-center">
          {i18nService.t('welcomeTitle')}
        </h1>

        <p className="text-sm text-secondary mb-8 text-center">
          {i18nService.t('welcomePromo')}
        </p>

        {/* primary: login */}
        <button
          onClick={onLogin}
          className="w-full h-11 rounded-xl text-sm font-medium bg-foreground text-surface transition-opacity hover:opacity-90 active:opacity-80"
        >
          {i18nService.t('welcomeLogin')}
        </button>

        {/* secondary: custom model — quiet ghost style */}
        <button
          onClick={onCustomModel}
          className="mt-3 w-full h-11 rounded-xl text-sm font-medium text-secondary border border-border bg-transparent hover:text-foreground hover:bg-surface-raised transition-colors"
        >
          {i18nService.t('welcomeCustomModel')}
        </button>
      </div>

      {/* footer: consent notice + copyright */}
      <div className="relative z-10 flex flex-col items-center gap-1 pb-8 px-8 text-center">
        <p className="text-xs text-secondary leading-relaxed">
          {noticeBefore}
          <a
            href={SERVICE_TERMS_URL}
            onClick={handleTermsClick}
            className="underline underline-offset-2 hover:text-foreground"
          >
            {linkText}
          </a>
          {noticeAfter}
        </p>
        <p className="text-xs text-secondary/70">{copyright}</p>
      </div>
    </div>
  );
};

export default WelcomeDialog;
