import {
  type BrowserWindow,
  type IpcMain,
  type IpcMainInvokeEvent,
} from 'electron';

import {
  ActivityContainerApiVersion,
  type ActivityHostExecuteActionInput,
  type ActivityHostGetContextInput,
  type ActivityHostGetSlotInput,
  ActivityIpc,
  ActivityPlacement,
  type ActivityResult,
} from '../../../shared/activity/constants';
import { AuthSessionStatus } from '../../../shared/auth/constants';
import {
  ActivityAuthMode,
  type ActivityFetch,
  executeDailyCheckIn,
  getActivitySlot,
  getDailyCheckInContext,
} from '../../libs/activity/activityClient';
import { resolveActivityServerBaseUrl } from '../../libs/activity/activityDevelopmentConfig';
import { resolveAuthSessionStatusFromError } from '../../libs/authSessionManager';

export interface ActivityIpcHandlerDeps {
  ipcMain: IpcMain;
  isDev: boolean;
  isPackaged: boolean;
  getMainWindow: () => BrowserWindow | null;
  getServerBaseUrl: () => string;
  getClientVersion: () => string;
  platform: string;
  hasAuthTokens: () => boolean;
  fetchPublic: (url: string, init?: RequestInit) => Promise<Response>;
  fetchWithAuth: (url: string, init?: RequestInit) => Promise<Response>;
  developmentServerBaseUrl?: string;
}

const failure = (error: unknown): ActivityResult<never> => ({
  success: false,
  error: error instanceof Error ? error.message : 'Activity operation failed',
});

function validateActivityBinding(
  input: ActivityHostGetContextInput | undefined,
): asserts input is ActivityHostGetContextInput {
  if (!input
      || !/^[a-z0-9][a-z0-9_-]{2,63}$/.test(input.activityCode)
      || !Number.isInteger(input.configRevision)
      || input.configRevision < 1) {
    throw new Error('Invalid activity binding');
  }
}

function validateExecuteInput(
  input: ActivityHostExecuteActionInput | undefined,
): asserts input is ActivityHostExecuteActionInput {
  validateActivityBinding(input);
  if (!/^[A-Za-z0-9._:-]{1,64}$/.test(input.idempotencyKey)) {
    throw new Error('Invalid activity idempotency key');
  }
}

export function registerActivityIpcHandlers(deps: ActivityIpcHandlerDeps): void {
  let actionInFlight = false;

  const getActivityServerBaseUrl = () => resolveActivityServerBaseUrl({
    defaultBaseUrl: deps.getServerBaseUrl(),
    developmentOverride: deps.developmentServerBaseUrl,
    isDev: deps.isDev,
    isPackaged: deps.isPackaged,
  });

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

  const requireMainRenderer = (event: IpcMainInvokeEvent): void => {
    const mainWindow = deps.getMainWindow();
    if (!mainWindow || mainWindow.isDestroyed()
        || event.sender !== mainWindow.webContents
        || event.senderFrame !== mainWindow.webContents.mainFrame) {
      throw new Error('Untrusted activity host sender');
    }
  };

  deps.ipcMain.handle(
    ActivityIpc.HostGetSlot,
    async (event, input: ActivityHostGetSlotInput = {}) => {
      try {
        requireMainRenderer(event);
        return await getActivitySlot(
          getActivityServerBaseUrl(),
          activityFetch,
          {
            placement: input.placement ?? ActivityPlacement.DesktopSidebar,
            clientVersion: deps.getClientVersion(),
            containerApiVersion: ActivityContainerApiVersion.NativeDailyCheckInV1,
            platform: deps.platform,
          },
        );
      } catch (error) {
        return failure(error);
      }
    },
  );

  deps.ipcMain.handle(
    ActivityIpc.HostGetContext,
    async (event, input?: ActivityHostGetContextInput) => {
      try {
        requireMainRenderer(event);
        validateActivityBinding(input);
        return await getDailyCheckInContext(
          getActivityServerBaseUrl(),
          activityFetch,
          input.activityCode,
          input.configRevision,
        );
      } catch (error) {
        return failure(error);
      }
    },
  );

  deps.ipcMain.handle(
    ActivityIpc.HostExecuteAction,
    async (event, input?: ActivityHostExecuteActionInput) => {
      try {
        requireMainRenderer(event);
        validateExecuteInput(input);
        if (actionInFlight) {
          return {
            success: false,
            error: 'A daily check-in request is already in progress',
          } satisfies ActivityResult<never>;
        }
        actionInFlight = true;
        try {
          return await executeDailyCheckIn(
            getActivityServerBaseUrl(),
            activityFetch,
            input,
          );
        } finally {
          actionInFlight = false;
        }
      } catch (error) {
        return failure(error);
      }
    },
  );
}
