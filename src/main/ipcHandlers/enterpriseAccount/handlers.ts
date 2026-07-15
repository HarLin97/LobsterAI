import { ipcMain } from 'electron';

import { EnterpriseAccountIpcChannel } from '../../../shared/enterpriseAccount/constants';
import type { EnterpriseAccountContextResult } from '../../../shared/enterpriseAccount/types';

export interface EnterpriseAccountHandlerDeps {
  getContext: () => Promise<EnterpriseAccountContextResult>;
}

export function registerEnterpriseAccountHandlers(
  deps: EnterpriseAccountHandlerDeps,
): void {
  ipcMain.handle(
    EnterpriseAccountIpcChannel.GetContext,
    () => deps.getContext(),
  );
}
