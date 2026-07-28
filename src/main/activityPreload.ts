import { contextBridge, ipcRenderer } from 'electron';

import {
  type ActivityAuthChangedEvent,
  type ActivityGuestActionInput,
  ActivityIpc,
} from '../shared/activity/constants';

contextBridge.exposeInMainWorld('lobsterActivity', {
  getRuntimeContext: () => ipcRenderer.invoke(ActivityIpc.GuestGetRuntimeContext),
  getActivityContext: () => ipcRenderer.invoke(ActivityIpc.GuestGetActivityContext),
  executeAction: (input: ActivityGuestActionInput) =>
    ipcRenderer.invoke(ActivityIpc.GuestExecuteAction, input),
  requestLogin: () => ipcRenderer.invoke(ActivityIpc.GuestRequestLogin),
  close: () => ipcRenderer.invoke(ActivityIpc.GuestClose),
  onAuthChanged: (callback: (event: ActivityAuthChangedEvent) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, data: ActivityAuthChangedEvent) => {
      callback(data);
    };
    ipcRenderer.on(ActivityIpc.GuestAuthChanged, handler);
    return () => ipcRenderer.removeListener(ActivityIpc.GuestAuthChanged, handler);
  },
});
