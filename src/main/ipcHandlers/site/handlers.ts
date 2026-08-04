import { ipcMain } from 'electron';

import {
  type SiteAnalyticsOptions,
  type SiteDeploymentQuotaOptions,
  SiteIpc,
  type SiteListOptions,
  type SiteQuotaReservationInput,
  type SiteUpdateAccessModeInput,
  type SiteUpdateAccessStatusInput,
  type SiteUpdateTitleInput,
} from '../../../shared/site/constants';
import {
  createSiteQuotaReservation,
  deleteSite,
  getSite,
  getSiteAnalytics,
  getSiteDeploymentQuota,
  listSites,
  releaseSiteQuotaReservation,
  updateSiteAccessMode,
  updateSiteAccessStatus,
  updateSiteTitle,
} from '../../libs/site/siteClient';

export interface SiteHandlerDeps {
  getServerApiBaseUrl: () => string;
  fetchWithAuth: (url: string, options?: RequestInit) => Promise<Response>;
}

const requireShareId = (value: unknown): string => {
  if (typeof value !== 'string' || !value.trim() || value.trim().length > 64) {
    throw new Error('Invalid site identifier');
  }
  return value.trim();
};

export function registerSiteIpcHandlers({
  getServerApiBaseUrl,
  fetchWithAuth,
}: SiteHandlerDeps): void {
  ipcMain.handle(SiteIpc.List, (_event, options: SiteListOptions = {}) =>
    listSites(getServerApiBaseUrl(), fetchWithAuth, options),
  );
  ipcMain.handle(SiteIpc.Get, (_event, shareId: string) =>
    getSite(getServerApiBaseUrl(), fetchWithAuth, requireShareId(shareId)),
  );
  ipcMain.handle(SiteIpc.UpdateTitle, (_event, input: SiteUpdateTitleInput) =>
    updateSiteTitle(
      getServerApiBaseUrl(),
      fetchWithAuth,
      requireShareId(input?.shareId),
      typeof input?.title === 'string' ? input.title.slice(0, 100) : '',
    ),
  );
  ipcMain.handle(SiteIpc.UpdateAccessMode, (_event, input: SiteUpdateAccessModeInput) =>
    updateSiteAccessMode(
      getServerApiBaseUrl(),
      fetchWithAuth,
      requireShareId(input?.shareId),
      input?.accessMode,
    ),
  );
  ipcMain.handle(SiteIpc.UpdateAccessStatus, (_event, input: SiteUpdateAccessStatusInput) =>
    updateSiteAccessStatus(
      getServerApiBaseUrl(),
      fetchWithAuth,
      requireShareId(input?.shareId),
      input?.status,
    ),
  );
  ipcMain.handle(SiteIpc.Delete, (_event, shareId: string) =>
    deleteSite(getServerApiBaseUrl(), fetchWithAuth, requireShareId(shareId)),
  );
  ipcMain.handle(
    SiteIpc.GetAnalytics,
    (_event, shareId: string, options: SiteAnalyticsOptions = {}) =>
      getSiteAnalytics(getServerApiBaseUrl(), fetchWithAuth, requireShareId(shareId), options),
  );
  ipcMain.handle(SiteIpc.GetDeploymentQuota, (_event, options: SiteDeploymentQuotaOptions = {}) =>
    getSiteDeploymentQuota(getServerApiBaseUrl(), fetchWithAuth, options),
  );
  ipcMain.handle(SiteIpc.CreateQuotaReservation, (_event, input: SiteQuotaReservationInput) =>
    createSiteQuotaReservation(getServerApiBaseUrl(), fetchWithAuth, input),
  );
  ipcMain.handle(SiteIpc.ReleaseQuotaReservation, (_event, reservationId: string) =>
    releaseSiteQuotaReservation(
      getServerApiBaseUrl(),
      fetchWithAuth,
      requireShareId(reservationId),
    ),
  );
}
