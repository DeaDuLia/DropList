const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('externalAPI', {
    sendMessageToMain: (message) => ipcRenderer.send('message-from-external', message)
});