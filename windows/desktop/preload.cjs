const {
  contextBridge,
  ipcRenderer
} = require('electron');

contextBridge.exposeInMainWorld('companion', {
  state: () => ipcRenderer.invoke('state'),

  copyToken: () =>
    ipcRenderer.invoke('copy-token'),

  revealToken: () =>
    ipcRenderer.invoke('reveal-token'),

  startup: value =>
    ipcRenderer.invoke('startup', value),

  controls: value =>
    ipcRenderer.invoke('controls', value),

  addFolder: () =>
    ipcRenderer.invoke('folder-add'),

  removeFolder: id =>
    ipcRenderer.invoke('folder-remove', id),

  toggleServer: () =>
    ipcRenderer.invoke('toggle-server'),

  onState: callback => {
    ipcRenderer.on('state', (_event, state) => {
      callback(state);
    });
  }
});