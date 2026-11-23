import { contextBridge } from 'electron';

// Expose minimal secure APIs to renderer if needed, adhering to security guidelines
contextBridge.exposeInMainWorld('electronAPI', {
    platform: process.platform
});
