const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('externalAPI', {
    sendMessageToMain: (url, name) => ipcRenderer.send('message-from-external', url, name)
});