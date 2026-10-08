const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('native', {
  quit: () => ipcRenderer.send('quit'),
  setFullscreen: (v) => ipcRenderer.send('fullscreen', v),
  platform: process.platform,
});

contextBridge.exposeInMainWorld('steam', {
  activateAchievement: (id) => ipcRenderer.send('steam-ach', id),
  info: () => ipcRenderer.invoke('steam-info'),
});
