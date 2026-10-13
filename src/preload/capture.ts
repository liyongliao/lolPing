import { contextBridge, ipcRenderer } from 'electron';
import type { CaptureApi } from '../shared/capture';
const api: CaptureApi = {
  frame: () => ipcRenderer.invoke('capture:frame'),
  onFrame: cb => { const listener = (_e: Electron.IpcRendererEvent, data: Parameters<typeof cb>[0]) => cb(data); ipcRenderer.on('capture:changed', listener); return () => ipcRenderer.off('capture:changed', listener); },
  finish: rect => ipcRenderer.invoke('capture:finish', rect),
  advanced: (rect, png, action) => ipcRenderer.invoke('capture:advanced', rect, png, action),
  scrollNext: () => ipcRenderer.invoke('capture:scrollNext'),
  scrollDone: () => ipcRenderer.invoke('capture:scrollDone'),
};
contextBridge.exposeInMainWorld('captureApi', api);
