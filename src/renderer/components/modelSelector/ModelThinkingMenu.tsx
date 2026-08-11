import { CheckIcon } from '@heroicons/react/24/outline';
import {
  getModelThinkingLevels,
  type ModelThinkingConfig,
  ModelThinkingLevel,
} from '@shared/providers/modelThinking';
import React from 'react';

import { i18nService } from '../../services/i18n';

const THINKING_LEVEL_I18N_KEYS: Record<ModelThinkingLevel, string> = {
  [ModelThinkingLevel.Off]: 'modelThinkingLevelOff',
  [ModelThinkingLevel.Minimal]: 'modelThinkingLevelMinimal',
  [ModelThinkingLevel.Low]: 'modelThinkingLevelLow',
  [ModelThinkingLevel.Medium]: 'modelThinkingLevelMedium',
  [ModelThinkingLevel.High]: 'modelThinkingLevelHigh',
  [ModelThinkingLevel.XHigh]: 'modelThinkingLevelXHigh',
  [ModelThinkingLevel.Max]: 'modelThinkingLevelMax',
};

export const getModelThinkingLevelLabel = (level: ModelThinkingLevel): string => (
  i18nService.t(THINKING_LEVEL_I18N_KEYS[level])
);

interface ModelThinkingMenuProps {
  config: ModelThinkingConfig;
  selectedLevel: ModelThinkingLevel;
  onSelect: (level: ModelThinkingLevel) => void;
  onEscape: () => void;
}

const ModelThinkingMenu: React.FC<ModelThinkingMenuProps> = ({
  config,
  selectedLevel,
  onSelect,
  onEscape,
}) => {
  const levels = getModelThinkingLevels(config);
  const supportsOff = levels.includes(ModelThinkingLevel.Off);
  const enabledLevels = levels.filter(level => level !== ModelThinkingLevel.Off);
  const thinkingEnabled = selectedLevel !== ModelThinkingLevel.Off;
  const enabledFallback = config.defaultLevel !== ModelThinkingLevel.Off
    ? config.defaultLevel
    : enabledLevels[0];

  return (
    <div
      role="menu"
      aria-label={i18nService.t('modelThinkingStrength')}
      onKeyDown={(event) => {
        if (event.key === 'Escape') {
          event.stopPropagation();
          onEscape();
        }
      }}
      className="overflow-hidden rounded-xl border border-border bg-surface shadow-popover"
    >
      {supportsOff && (
        <button
          type="button"
          role="switch"
          aria-checked={thinkingEnabled}
          onClick={() => {
            if (thinkingEnabled) {
              onSelect(ModelThinkingLevel.Off);
            } else if (enabledFallback) {
              onSelect(enabledFallback);
            }
          }}
          className="flex w-full items-center justify-between border-b border-border/60 px-4 py-3 text-left text-[13px] font-medium text-foreground transition-colors hover:bg-surface-raised"
        >
          <span>{i18nService.t('modelThinkingMode')}</span>
          <span
            aria-hidden="true"
            className={`relative h-5 w-9 rounded-full transition-colors ${
              thinkingEnabled ? 'bg-emerald-500' : 'bg-border'
            }`}
          >
            <span
              className={`absolute top-0.5 h-4 w-4 rounded-full bg-white shadow-sm transition-transform ${
                thinkingEnabled ? 'translate-x-[18px]' : 'translate-x-0.5'
              }`}
            />
          </span>
        </button>
      )}

      <div className="px-4 pb-1 pt-3 text-[11px] font-medium text-secondary">
        {i18nService.t('modelThinkingStrength')}
      </div>
      <div className="p-2 pt-1">
        {enabledLevels.map(level => {
          const selected = selectedLevel === level;
          return (
            <button
              key={level}
              type="button"
              role="menuitemradio"
              aria-checked={selected}
              onClick={() => onSelect(level)}
              className={`flex w-full items-center justify-between rounded-lg px-2.5 py-2 text-left text-[13px] transition-colors ${
                selected
                  ? 'bg-surface-raised font-semibold text-foreground'
                  : 'text-foreground hover:bg-surface-raised'
              }`}
            >
              <span>{getModelThinkingLevelLabel(level)}</span>
              {selected && <CheckIcon className="h-4 w-4 text-emerald-500" strokeWidth={2.5} />}
            </button>
          );
        })}
      </div>
    </div>
  );
};

export default ModelThinkingMenu;
