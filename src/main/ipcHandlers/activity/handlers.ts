import {
  type BrowserWindow,
  type IpcMain,
  type IpcMainInvokeEvent,
} from 'electron';

import {
  type ActivityAuthChangedEvent,
  type ActivityBounds,
  ActivityContainerApiVersion,
  type ActivityGuestActionInput,
  type ActivityHostGetSlotInput,
  type ActivityHostOpenInput,
  ActivityIpc,
  ActivityPlacement,
  type ActivityResult,
  ActivitySlotState,
} from '../../../shared/activity/constants';
import { AuthSessionStatus } from '../../../shared/auth/constants';
import {
  ActivityAuthMode,
  type ActivityFetch,
  executeActivityAction,
  getActivityContext,
  getActivitySlot,
} from '../../libs/activity/activityClient';
import {
  resolveActivityWebAppLocation,
} from '../../libs/activity/activitySecurity';
import { ActivityViewController } from '../../libs/activity/activityViewController';
import { resolveAuthSessionStatusFromError } from '../../libs/authSessionManager';

export interface ActivityHostController {
  close: () => void;
  notifyAuthChanged: (event: ActivityAuthChangedEvent) => void;
}

export interface ActivityIpcHandlerDeps {
  ipcMain: IpcMain;
  activityPreloadPath: string;
  isDev: boolean;
  isPackaged: boolean;
  isTestMode: () => boolean;
  getMainWindow: () => BrowserWindow | null;
  getServerBaseUrl: () => string;
  getClientVersion: () => string;
  getLocale: () => string;
  platform: string;
  hasAuthTokens: () => boolean;
  fetchPublic: (url: string, init?: RequestInit) => Promise<Response>;
  fetchWithAuth: (url: string, init?: RequestInit) => Promise<Response>;
  requestLogin: () => Promise<{ success: boolean; error?: string }>;
  developmentWebAppUrl?: string;
}

const failure = (error: unknown): ActivityResult<never> => ({
  success: false,
  error: error instanceof Error ? error.message : 'Activity operation failed',
});

function validateGuestActionInput(
  input: ActivityGuestActionInput | undefined,
): asserts input is ActivityGuestActionInput {
  if (!input
      || !/^[A-Za-z0-9_-]{1,64}$/.test(input.actionId)
      || !/^[A-Za-z0-9._:-]{1,64}$/.test(input.idempotencyKey)) {
    throw new Error('Invalid activity action input');
  }
  if (Buffer.byteLength(JSON.stringify(input.payload ?? {}), 'utf8') > 16 * 1024) {
    throw new Error('Activity action payload is too large');
  }
}

export function registerActivityIpcHandlers(
  deps: ActivityIpcHandlerDeps,
): ActivityHostController {
  const viewController = new ActivityViewController(
    deps.activityPreloadPath,
    deps.isDev,
  );
  let actionInFlight = false;

  const activityFetch: ActivityFetch = async (url, init, authMode) => {
    if (authMode === ActivityAuthMode.Required) {
      return deps.fetchWithAuth(url, init);
    }
    if (!deps.hasAuthTokens()) {
      return deps.fetchPublic(url, init);
    }
    try {
      return await deps.fetchWithAuth(url, init);
    } catch (error) {
      const status = resolveAuthSessionStatusFromError(error);
      if (status === AuthSessionStatus.Unauthenticated
          || status === AuthSessionStatus.Expired) {
        return deps.fetchPublic(url, init);
      }
      throw error;
    }
  };

  const loadSlot = (input: ActivityHostGetSlotInput = {}) => getActivitySlot(
    deps.getServerBaseUrl(),
    activityFetch,
    {
      placement: input.placement ?? ActivityPlacement.DesktopSidebar,
      clientVersion: deps.getClientVersion(),
      containerApiVersion: ActivityContainerApiVersion.V1,
      platform: deps.platform,
    },
  );

  const requireMainRenderer = (event: IpcMainInvokeEvent): BrowserWindow => {
    const mainWindow = deps.getMainWindow();
    if (!mainWindow || mainWindow.isDestroyed()
        || event.sender !== mainWindow.webContents
        || event.senderFrame !== mainWindow.webContents.mainFrame) {
      throw new Error('Untrusted activity host sender');
    }
    return mainWindow;
  };

  deps.ipcMain.handle(
    ActivityIpc.HostGetSlot,
    async (event, input?: ActivityHostGetSlotInput) => {
      try {
        requireMainRenderer(event);
        return await loadSlot(input);
      } catch (error) {
        return failure(error);
      }
    },
  );

  deps.ipcMain.handle(
    ActivityIpc.HostOpen,
    async (event, input: ActivityHostOpenInput) => {
      try {
        const mainWindow = requireMainRenderer(event);
        const slotResult = await loadSlot({ placement: input?.placement });
        if (!slotResult.success) return slotResult;
        const descriptor = slotResult.data.activity;
        if (slotResult.data.slotState !== ActivitySlotState.Available
            || !descriptor
            || descriptor.activityCode !== input?.activityCode
            || descriptor.configRevision !== input?.configRevision) {
          return {
            success: false,
            error: 'Activity is no longer available',
          } satisfies ActivityResult<never>;
        }
        const location = resolveActivityWebAppLocation({
          webAppKey: descriptor.webAppKey,
          webAppUrl: descriptor.webAppUrl,
          navigationBaseUrl: descriptor.navigationBaseUrl,
          resourceBaseUrls: descriptor.resourceBaseUrls,
          activityCode: descriptor.activityCode,
          configRevision: descriptor.configRevision,
          locale: deps.getLocale(),
          isPackaged: deps.isPackaged,
          isTestMode: deps.isTestMode(),
          developmentOverride: deps.developmentWebAppUrl,
        });
        await viewController.open({
          parentWindow: mainWindow,
          descriptor,
          url: location.url,
          navigationBaseUrl: location.navigationBaseUrl,
          resourceBaseUrls: location.resourceBaseUrls,
          bounds: input.bounds,
        });
        return { success: true, data: { opened: true } };
      } catch (error) {
        return failure(error);
      }
    },
  );

  deps.ipcMain.handle(
    ActivityIpc.HostSetBounds,
    (event, bounds: ActivityBounds) => {
      try {
        requireMainRenderer(event);
        viewController.setBounds(bounds);
        return { success: true, data: { updated: true } };
      } catch (error) {
        return failure(error);
      }
    },
  );

  deps.ipcMain.handle(ActivityIpc.HostClose, event => {
    try {
      requireMainRenderer(event);
      viewController.close();
      return { success: true, data: { closed: true } };
    } catch (error) {
      return failure(error);
    }
  });

  deps.ipcMain.handle(ActivityIpc.GuestGetRuntimeContext, event => {
    try {
      const binding = viewController.requireBindingForEvent(event);
      return {
        success: true,
        data: {
          containerApiVersion: ActivityContainerApiVersion.V1,
          activityCode: binding.activityCode,
          configRevision: binding.configRevision,
          clientVersion: deps.getClientVersion(),
          platform: deps.platform,
          locale: deps.getLocale(),
          authenticated: deps.hasAuthTokens(),
        },
      };
    } catch (error) {
      return failure(error);
    }
  });

  deps.ipcMain.handle(ActivityIpc.GuestGetActivityContext, async event => {
    try {
      const binding = viewController.requireBindingForEvent(event);
      return await getActivityContext(
        deps.getServerBaseUrl(),
        activityFetch,
        binding.activityCode,
        binding.configRevision,
      );
    } catch (error) {
      return failure(error);
    }
  });

  deps.ipcMain.handle(
    ActivityIpc.GuestExecuteAction,
    async (event, input: ActivityGuestActionInput) => {
      try {
        const binding = viewController.requireBindingForEvent(event);
        validateGuestActionInput(input);
        if (actionInFlight) {
          return { success: false, error: 'An activity action is already in progress' };
        }
        actionInFlight = true;
        try {
          return await executeActivityAction(
            deps.getServerBaseUrl(),
            activityFetch,
            {
              activityCode: binding.activityCode,
              configRevision: binding.configRevision,
              actionId: input.actionId,
              idempotencyKey: input.idempotencyKey,
              payload: input.payload,
            },
          );
        } finally {
          actionInFlight = false;
        }
      } catch (error) {
        return failure(error);
      }
    },
  );

  deps.ipcMain.handle(ActivityIpc.GuestRequestLogin, async event => {
    try {
      viewController.requireBindingForEvent(event);
      const result = await deps.requestLogin();
      return result.success
        ? { success: true, data: { started: true } }
        : { success: false, error: result.error ?? 'Failed to start login' };
    } catch (error) {
      return failure(error);
    }
  });

  deps.ipcMain.handle(ActivityIpc.GuestClose, event => {
    try {
      viewController.requireBindingForEvent(event);
      viewController.close();
      return { success: true, data: { closed: true } };
    } catch (error) {
      return failure(error);
    }
  });

  return {
    close: () => viewController.close(),
    notifyAuthChanged: event => viewController.notifyAuthChanged(event),
  };
}
