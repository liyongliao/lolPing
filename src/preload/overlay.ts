import { contextBridge, ipcRenderer } from 'electron';
import type { EmoteRef } from '../shared/emotes';
import {
  OVERLAY_ASSETS, OVERLAY_CHANNELS, OVERLAY_EMOTED, OVERLAY_PINGED, type OverlayChannel, type OverlayEvents,
} from '../shared/ipc';
import type { MarkerButton } from '../shared/mouseButtons';
import type { PingId } from '../shared/pings';

const api = {
  on<C extends OverlayChannel>(channel: C, cb: (payload: OverlayEvents[C]) => void): void {
    if (!OVERLAY_CHANNELS.includes(channel)) throw new Error(`unknown overlay channel: ${channel}`);
    ipcRenderer.on(channel, (_event, payload: OverlayEvents[C]) => cb(payload));
  },
  reportMissingAssets(names: string[]): void {
    ipcRenderer.send(OVERLAY_ASSETS, names);
  },
  /** A wheel ping was placed here (CSS px in this overlay). */
  reportPing(id: PingId, x: number, y: number, button: MarkerButton = 'left'): void {
    ipcRenderer.send(OVERLAY_PINGED, { id, x, y, button });
  },
  /** A wheel emote was placed here (CSS px in this overlay). */
  reportEmote(ref: EmoteRef, x: number, y: number, button: MarkerButton = 'left'): void {
    ipcRenderer.send(OVERLAY_EMOTED, { ref, x, y, button });
  },
};

contextBridge.exposeInMainWorld('overlay', api);

export type OverlayApi = typeof api;
