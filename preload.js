const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
    getGamesWithTags: () => ipcRenderer.invoke('get-games-with-tags'),
    addGame: (gameData) => ipcRenderer.invoke('add-game', gameData),
    getGameRatings: () => ipcRenderer.invoke('get-game-ratings'),
    getGameStatuses: () => ipcRenderer.invoke('get-game-statuses'),
    deleteGame: (gameName) => ipcRenderer.invoke('delete-game', gameName),
});