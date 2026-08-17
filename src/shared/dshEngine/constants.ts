export const DshEnginePhase = {
  NotInstalled: 'not_installed',
  Stopped: 'stopped',
  Starting: 'starting',
  Ready: 'ready',
  Failed: 'failed',
} as const;
export type DshEnginePhase = typeof DshEnginePhase[keyof typeof DshEnginePhase];

export const DshEngineErrorCode = {
  RuntimeMissing: 'runtime_missing',
  RuntimeInvalid: 'runtime_invalid',
  SpawnFailed: 'spawn_failed',
  ReadyTimeout: 'ready_timeout',
  CrashedEarly: 'crashed_early',
} as const;
export type DshEngineErrorCode = typeof DshEngineErrorCode[keyof typeof DshEngineErrorCode];

export const DSH_RUNTIME_RESOURCE_DIR = 'dsh';
export const DSH_STATE_DIR_NAME = 'dsh';

export const DshIpcChannel = {
  GetState: 'dsh:getState',
  GetConfig: 'dsh:getConfig',
  SetEnabled: 'dsh:setEnabled',
  OpenWorkbench: 'dsh:openWorkbench',
  Stop: 'dsh:stop',
} as const;
export type DshIpcChannel = typeof DshIpcChannel[keyof typeof DshIpcChannel];

// kv store key holding { enabled: boolean } for the experimental dsh feature.
export const DSH_CONFIG_STORE_KEY = 'dsh_config';

export interface DshFeatureConfig {
  enabled: boolean;
}
