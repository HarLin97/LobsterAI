import type { EnterpriseAccountContext } from '../../../shared/enterpriseAccount/types';
import { store } from '../../store';
import { setEnterpriseAccountContext } from './enterpriseAccountSlice';

export function applyEnterpriseAccountContext(
  context: EnterpriseAccountContext | null | undefined,
): EnterpriseAccountContext | null {
  const normalizedContext = context ?? null;
  store.dispatch(setEnterpriseAccountContext(normalizedContext));
  return normalizedContext;
}

export async function refreshEnterpriseAccountContext(): Promise<EnterpriseAccountContext | null> {
  try {
    const result = await window.electron.enterpriseAccount.getContext();
    if (result.success || result.context === null) {
      return applyEnterpriseAccountContext(result.context);
    }
    return result.context;
  } catch {
    return store.getState().enterpriseAccount.context;
  }
}
