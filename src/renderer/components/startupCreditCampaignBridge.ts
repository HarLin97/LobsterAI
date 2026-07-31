import { useSyncExternalStore } from 'react';

import {
  StartupCreditCampaignSource,
  type StartupCreditCampaignSource as StartupCreditCampaignSourceType,
} from './startupCreditCampaignAnalytics';

export const STARTUP_CREDIT_OPEN_EVENT = 'lobster:startup-credit-campaign-open';

export interface StartupCreditCampaignEntry {
  available: boolean;
  label: string;
}

const unavailableEntry: StartupCreditCampaignEntry = {
  available: false,
  label: '',
};

let entrySnapshot = unavailableEntry;
const listeners = new Set<() => void>();

export function setStartupCreditCampaignEntry(
  entry: StartupCreditCampaignEntry | null,
): void {
  const next = entry ?? unavailableEntry;
  if (entrySnapshot.available === next.available
      && entrySnapshot.label === next.label) {
    return;
  }
  entrySnapshot = next;
  listeners.forEach(listener => listener());
}

export function openStartupCreditCampaign(
  source: StartupCreditCampaignSourceType = StartupCreditCampaignSource.HomeNewConversation,
): void {
  window.dispatchEvent(new CustomEvent(STARTUP_CREDIT_OPEN_EVENT, {
    detail: { source },
  }));
}

export function useStartupCreditCampaignEntry(): StartupCreditCampaignEntry {
  return useSyncExternalStore(
    listener => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    () => entrySnapshot,
    () => unavailableEntry,
  );
}
