import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron';
import type { Bridge } from '../shared/api';

const bridge: Bridge = {
  invoke: ((method: string, ...args: unknown[]) => ipcRenderer.invoke('hatstand', method, args)) as Bridge['invoke'],
  on(event, listener) {
    const wrapped = (_event: IpcRendererEvent, payload: Parameters<typeof listener>[0]) => listener(payload);
    ipcRenderer.on(event, wrapped);
    return () => ipcRenderer.removeListener(event, wrapped);
  },
};

contextBridge.exposeInMainWorld('hatstand', bridge);
