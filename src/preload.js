const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
    syncAllDirtyWithProgress: () => ipcRenderer.invoke('sync-all-dirty-with-progress'),
    onSyncProgress: (callback) => {
        ipcRenderer.on('sync-progress', (event, data) => callback(data));
    },
    syncAllDirty: () => ipcRenderer.invoke('sync-all-dirty'),
    onSyncStatus: (callback) => {
        ipcRenderer.on('sync-status', (event, data) => callback(data));
    },
    addFavorite: (cardName, section) => ipcRenderer.invoke('add-favorite', cardName, section),
    removeFavorite: (cardName, section) => ipcRenderer.invoke('remove-favorite', cardName, section),
    isFavorite: (cardName, section) => ipcRenderer.invoke('is-favorite', cardName, section),
    getFavoritesBySection: (section) => ipcRenderer.invoke('get-favorites-by-section', section),
    stopInfoSearching: () => ipcRenderer.invoke('stop-info-searching'),
    searchLitresBookAPI: (title) => ipcRenderer.invoke('search-litres-book-api', title),
    searchChitaiGorodBook: (title) => ipcRenderer.invoke('search-chitai-gorod-book', title),
    fetchSteamTagsApi: (title) => ipcRenderer.invoke('fetch-steam-tags-api', title),
    searchKupikodPrice: (title) => ipcRenderer.invoke('search-kupikod-price', title),
    fetchCardData: (title, section) => ipcRenderer.invoke('fetch-card-data', title, section),
    getAllExpectedReleases: () => ipcRenderer.invoke('get-all-expected-releases'),
    deleteReleaseDate: (cardName, section) => ipcRenderer.invoke('delete-release-date', cardName, section),
    saveReleaseDate: (cardName, section, releaseDate) => ipcRenderer.invoke('save-release-date', cardName, section, releaseDate),
    getSectionReleaseNotifications: (section) => ipcRenderer.invoke('get-section-release-notifications', section),
    markReleaseNotificationShown: (cardName, section) => ipcRenderer.invoke('mark-release-notification-shown', cardName, section),
    getAllTags: () => ipcRenderer.invoke('get-all-tags'),
    searchTags: (query) => ipcRenderer.invoke('search-tags', query),
    updateCardTags: (section, cardName, tags) => ipcRenderer.invoke('update-card-tags', section, cardName, tags),
    authSignIn: (email, password) => ipcRenderer.invoke('auth-sign-in', email, password),
    authSignUp: (email, password) => ipcRenderer.invoke('auth-sign-up', email, password),
    authSignOut: () => ipcRenderer.invoke('auth-sign-out'),
    authGetCurrentUser: () => ipcRenderer.invoke('auth-get-current-user'),
    onRestoreSession: (callback) => {
        ipcRenderer.on('restore-session', (event, user) => callback(user));
    },
    syncApplyChoice: (choice, localData, remoteData) => ipcRenderer.invoke('sync-apply-choice', choice, localData, remoteData),
    onSyncRequired: (callback) => {
        ipcRenderer.on('sync-required', (event, data) => callback(data));
    },
    onSessionExpired: (callback) => {
        ipcRenderer.on('session-expired', () => callback());
    },
    minimizeWindow: () => ipcRenderer.send('window-control', 'minimize'),
    maximizeWindow: () => ipcRenderer.send('window-control', 'maximize'),
    closeWindow: () => ipcRenderer.send('window-control', 'close'),
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
    replaceData: () => ipcRenderer.invoke('replace-data'),
    openSearch: (url) => ipcRenderer.invoke('search-in-browser', url)
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

