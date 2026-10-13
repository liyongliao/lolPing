import { contextBridge, ipcRenderer } from 'electron';
import type { CaptureApi } from '../shared/capture';
const api: CaptureApi = {
  frame: () => ipcRenderer.invoke('capture:frame'),
  finish: rect => ipcRenderer.invoke('capture:finish', rect),
};
contextBridge.exposeInMainWorld('captureApi', api);
