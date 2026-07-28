import crypto from 'crypto';
import {
  type BrowserWindow,
  type IpcMainInvokeEvent,
  WebContentsView,
} from 'electron';

import {
  type ActivityAuthChangedEvent,
  type ActivityBounds,
  type ActivityDescriptor,
  ActivityIpc,
} from '../../../shared/activity/constants';
import {
  isAllowedActivityNavigation,
  isAllowedActivityResource,
  validateActivityBounds,
} from './activitySecurity';

interface ActivityViewBinding {
  descriptor: ActivityDescriptor;
  allowedBaseUrl: string;
}

interface OpenActivityViewInput extends ActivityViewBinding {
  parentWindow: BrowserWindow;
  url: string;
  bounds: ActivityBounds;
}

interface ActiveActivityView extends ActivityViewBinding {
  parentWindow: BrowserWindow;
  view: WebContentsView;
}

export class ActivityViewController {
  private active: ActiveActivityView | null = null;

  constructor(
    private readonly preloadPath: string,
    private readonly isDev: boolean,
  ) {}

  async open(input: OpenActivityViewInput): Promise<void> {
    this.close();
    if (input.parentWindow.isDestroyed()) {
      throw new Error('Main window is not available');
    }

    const bounds = validateActivityBounds(
      input.bounds,
      input.parentWindow.contentView.getBounds(),
    );
    const view = new WebContentsView({
      webPreferences: {
        nodeIntegration: false,
        nodeIntegrationInSubFrames: false,
        contextIsolation: true,
        sandbox: true,
        webSecurity: true,
        plugins: false,
        devTools: this.isDev,
        spellcheck: false,
        enableWebSQL: false,
        autoplayPolicy: 'document-user-activation-required',
        disableDialogs: true,
        navigateOnDragDrop: false,
        partition: `activity-${crypto.randomUUID()}`,
        preload: this.preloadPath,
      },
    });
    view.setBackgroundColor('#FFFFFF');
    view.setBorderRadius(12);
    view.setBounds(bounds);

    this.active = {
      parentWindow: input.parentWindow,
      view,
      descriptor: input.descriptor,
      allowedBaseUrl: input.allowedBaseUrl,
    };
    this.applySecurityPolicy(view, input.allowedBaseUrl);
    input.parentWindow.contentView.addChildView(view);

    try {
      await view.webContents.loadURL(input.url);
    } catch (error) {
      if (this.active?.view === view) {
        this.close();
      }
      throw error;
    }
  }

  setBounds(bounds: ActivityBounds): void {
    const active = this.requireActive();
    active.view.setBounds(validateActivityBounds(
      bounds,
      active.parentWindow.contentView.getBounds(),
    ));
  }

  close(): void {
    const active = this.active;
    this.active = null;
    if (!active) return;
    if (!active.parentWindow.isDestroyed()) {
      active.parentWindow.contentView.removeChildView(active.view);
    }
    if (!active.view.webContents.isDestroyed()) {
      active.view.webContents.close({ waitForBeforeUnload: false });
    }
  }

  notifyAuthChanged(event: ActivityAuthChangedEvent): void {
    const webContents = this.active?.view.webContents;
    if (webContents && !webContents.isDestroyed()) {
      webContents.send(ActivityIpc.GuestAuthChanged, event);
    }
  }

  requireBindingForEvent(event: IpcMainInvokeEvent): ActivityDescriptor {
    const active = this.requireActive();
    if (event.sender !== active.view.webContents
        || event.senderFrame !== active.view.webContents.mainFrame
        || !isAllowedActivityNavigation(event.senderFrame.url, active.allowedBaseUrl)) {
      throw new Error('Untrusted activity bridge sender');
    }
    return active.descriptor;
  }

  private requireActive(): ActiveActivityView {
    if (!this.active || this.active.view.webContents.isDestroyed()) {
      throw new Error('Activity view is not open');
    }
    return this.active;
  }

  private applySecurityPolicy(view: WebContentsView, allowedBaseUrl: string): void {
    const webContents = view.webContents;
    webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    webContents.on('will-frame-navigate', details => {
      if (!details.isMainFrame
          || !isAllowedActivityNavigation(details.url, allowedBaseUrl)) {
        details.preventDefault();
      }
    });
    webContents.on('will-redirect', details => {
      if (!isAllowedActivityNavigation(details.url, allowedBaseUrl)) {
        details.preventDefault();
      }
    });
    webContents.on('will-prevent-unload', event => event.preventDefault());
    webContents.on('render-process-gone', () => {
      if (this.active?.view === view) {
        this.close();
      }
    });

    const activitySession = webContents.session;
    activitySession.setPermissionCheckHandler(() => false);
    activitySession.setPermissionRequestHandler((_contents, _permission, callback) => {
      callback(false);
    });
    activitySession.webRequest.onBeforeRequest((details, callback) => {
      callback({
        cancel: !isAllowedActivityResource(details.url, allowedBaseUrl),
      });
    });
    activitySession.on('will-download', event => event.preventDefault());
  }
}
