export const DialogIpc = {
  StatFile: 'dialog:statFile',
  ReadTextFile: 'dialog:readTextFile',
  SaveFileCopy: 'dialog:saveFileCopy',
} as const;

export type DialogIpc = typeof DialogIpc[keyof typeof DialogIpc];
