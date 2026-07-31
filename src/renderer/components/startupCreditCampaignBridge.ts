import { useSyncExternalStore } from 'react';

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

export function openStartupCreditCampaign(): void {
  window.dispatchEvent(new Event(STARTUP_CREDIT_OPEN_EVENT));
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
