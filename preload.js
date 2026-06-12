const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
    getSectionReleaseNotifications: (section) => ipcRenderer.invoke('get-section-release-notifications', section),
    markReleaseNotificationShown: (cardName, section) => ipcRenderer.invoke('mark-release-notification-shown', cardName, section),
    searchYummyAniAnime: (title) => ipcRenderer.invoke('search-yummyani-anime', title),
    searchKinopoiskMovie: (title) => ipcRenderer.invoke('search-kinopoisk-movie', title),
    searchLitresBook: (title) => ipcRenderer.invoke('search-litres-book', title),
    fetchSteamTags: (title) => ipcRenderer.invoke('fetch-steam-tags', title),
    searchTagsWeb: (title, section) => ipcRenderer.invoke('search-tags-web', title, section),
    getAllTags: () => ipcRenderer.invoke('get-all-tags'),
    searchTags: (query) => ipcRenderer.invoke('search-tags', query),
    getCardTags: (section, cardName) => ipcRenderer.invoke('get-card-tags', section, cardName),
    updateCardTags: (section, cardName, tags) => ipcRenderer.invoke('update-card-tags', section, cardName, tags),

    authSignIn: (email, password) => ipcRenderer.invoke('auth-sign-in', email, password),
    authSignUp: (email, password) => ipcRenderer.invoke('auth-sign-up', email, password),
    authSignOut: () => ipcRenderer.invoke('auth-sign-out'),
    authGetCurrentUser: () => ipcRenderer.invoke('auth-get-current-user'),
    onRestoreSession: (callback) => {
        ipcRenderer.on('restore-session', (event, user) => callback(user));
    },
    syncApplyChoice: (choice, localData, remoteData) => ipcRenderer.invoke('sync-apply-choice', choice, localData, remoteData),
    getAllLocalData: () => ipcRenderer.invoke('get-all-local-data'),
    onSyncRequired: (callback) => {
        ipcRenderer.on('sync-required', (event, data) => callback(data));
    },
    onSyncLoading: (callback) => {
        ipcRenderer.on('sync-loading', (event, isLoading) => callback(isLoading));
    },
    onSessionExpired: (callback) => {
        ipcRenderer.on('session-expired', () => callback());
    },
    minimizeWindow: () => ipcRenderer.send('window-control', 'minimize'),
    maximizeWindow: () => ipcRenderer.send('window-control', 'maximize'),
    closeWindow: () => ipcRenderer.send('window-control', 'close'),
    isWindowMaximized: () => ipcRenderer.invoke('is-window-maximized'),
    //Общие
    getRatings: () => ipcRenderer.invoke('get-ratings'),
    getStatuses: () => ipcRenderer.invoke('get-statuses'),
    getStatusesNoImport: () => ipcRenderer.invoke('get-statuses-no-import'),
    openExternal: (url, name) => ipcRenderer.send('open-external', url, name),

    exportData: () => ipcRenderer.invoke('export-data'),
    importData: () => ipcRenderer.invoke('import-data'),

    showSaveDialog: (options) => ipcRenderer.invoke('show-save-dialog', options),
    showOpenDialog: (options) => ipcRenderer.invoke('show-open-dialog', options),
    onMessageFromMain: (callback) => {ipcRenderer.on('message-to-index', (event, message) => {callback(message);});},

    getData: (section) => ipcRenderer.invoke('get-data', section),
    checkDuplicates: (section, name) => ipcRenderer.invoke('check-duplicates', section, name),
    addData: (section, data) => ipcRenderer.invoke('add-data', section, data),
    deleteData: (section, dataName) => ipcRenderer.invoke('delete-data', section, dataName),
    updateData: (section, oldName, newName, newIcoUrl) => ipcRenderer.invoke('update-data', section, oldName, newName, newIcoUrl),
    updateDataRating: (section, dataName, rating) => ipcRenderer.invoke('update-data-rating', section, dataName, rating),
    updateDataStatus: (section, dataName, status) => ipcRenderer.invoke('update-data-status', section, dataName, status),
    updateDataDescription: (section, name, description) => ipcRenderer.invoke('update-data-description', section, name, description),

    moveDataToCategory: (data) => ipcRenderer.invoke('move-to-category', data),
    getGitHubDownloads: () => ipcRenderer.invoke('get-github-downloads'),
    replaceData: () => ipcRenderer.invoke('replace-data'),
    openSearch: (url) => ipcRenderer.invoke('search-in-browser', url),
    searchImage: (title) => ipcRenderer.invoke('search-image', title)
});

contextBridge.exposeInMainWorld('updateAPI', {
    checkForUpdates: (manualCheck) => ipcRenderer.invoke('check-for-updates', manualCheck),
    skipVersion: (version) => ipcRenderer.invoke('skip-version', version),
    openReleasePage: (url) => ipcRenderer.invoke('open-release-page', url),
    onUpdateAvailable: (callback) => {
        ipcRenderer.on('update-available', (event, data) => callback(data));
    },
    onNoUpdateAvailable: (callback) => {
        ipcRenderer.on('no-update-available', (event, data) => callback(data));
    },
    onUpdateError: (callback) => {
        ipcRenderer.on('update-error', (event, data) => callback(data));
    }
});

