const { app, BrowserWindow, ipcMain, shell } = require('electron');
const { dialog } = require('electron');
const fs = require('fs');
const path = require('path');
const https = require('https');
const { autoUpdater } = require('electron-updater');
const log = require('electron-log');
const { signInWithEmailAndPassword, createUserWithEmailAndPassword, signOut } = require('firebase/auth');

const LocalDatabase = require('./database/local-database');
const {fetchSteamAPIData, fetchSteamGameTags, fetchKupikodPriceAPI} = require("./service/search/game-search.js");
const {fetchLitresBookTags, fetchLitresBookAPIData, fetchChitaiGorodBook} = require("./service/search/book-search.js");
const {fetchKinopoiskMovieTags, fetchFilmRuSerialsTags} = require("./service/search/movie-search.js");
const {fetchCardData, updateAllReleaseDates, closeAllParsingWindows} = require("./service/search/data-search");
const {getStoredUser, clearUserSession, clearTagsDirty, clearExpectedReleasesDirty, markSectionDirty, markTagsDirty,
    markExpectedReleasesDirty, saveUserSession
} = require("./database/local-database");
const {syncUserData, syncDirtySections, getValidToken, saveSectionToFirestore, saveAllTagsToFirestore,
    saveExpectedReleasesToFirestore, updateSyncTime, loadExpectedReleasesFromFirestore, getSyncTime,
    loadAllTagsFromFirestore
} = require("./database/firestore");

autoUpdater.logger = log;

app.name = 'DropList';
app.setName('DropList');
if (process.platform === 'win32') {
    app.setAppUserModelId('com.deshin.droplist');
}

async function checkForUpdates(manualCheck = false) {
    const win = BrowserWindow.getFocusedWindow();

    try {
        // Получаем информацию о пропущенных версиях
        const skippedVersion = LocalDatabase.statements.getStatistic.get('skipped_version');
        const lastCheck = LocalDatabase.statements.getStatistic.get('last_update_check');


        if (!manualCheck) {
            if (lastCheck) {
                const lastCheckDate = new Date(lastCheck.actual_date);
                const now = new Date();
                const diffHours = (now - lastCheckDate) / (1000 * 60 * 60);

                // Проверяем не чаще чем раз в 4 часа
                if (diffHours < 4) {
                    return;
                }
            }
        }

        // Получаем текущую версию
        const currentVersion = app.getVersion();

        // Получаем информацию о релизах с GitHub
        const releases = await getGitHubReleases();

        if (!releases || releases.length === 0) {
            return;
        }

        const latestRelease = releases[0];
        const latestVersion = latestRelease.tag_name.replace('v', '');

        // Проверяем, пропущена ли текущая версия
        if (skippedVersion && skippedVersion.value === latestVersion && !manualCheck) {
            return;
        }

        // Сравниваем версии
        if (isNewerVersion(latestVersion, currentVersion)) {
            win.webContents.send('update-available', {
                currentVersion: app.getVersion(),
                version: latestVersion,
                releaseNotes: latestRelease.body || 'Новые улучшения и исправления ошибок',
                releaseDate: latestRelease.published_at,
                url: latestRelease.html_url
            });
        } else if (manualCheck) {
            win.webContents.send('no-update-available', {
                currentVersion: currentVersion,
                message: 'У вас установлена последняя версия'
            });
        }

        // Сохраняем дату последней проверки
        LocalDatabase.statements.setStatistic.run(
            'last_update_check',
            new Date().toISOString(),
            new Date().toISOString()
        );

    } catch (error) {
        console.error('Ошибка при проверке обновлений:', error);
        if (win && manualCheck) {
            win.webContents.send('update-error', {
                error: 'Не удалось проверить обновления'
            });
        }
    }
}

async function getGitHubReleases() {
    return new Promise((resolve, reject) => {
        const options = {
            hostname: 'api.github.com',
            path: '/repos/DeaDuLia/DropList/releases',
            headers: {
                'User-Agent': 'DropList-App',
                'Accept': 'application/vnd.github.v3+json'
            }
        };

        https.get(options, (res) => {
            let data = '';
            res.on('data', (chunk) => {
                data += chunk;
            });
            res.on('end', () => {
                try {
                    const releases = JSON.parse(data);
                    resolve(releases || []);
                } catch (e) {
                    console.error('Ошибка парсинга релизов:', e);
                    reject(e);
                }
            });
        }).on('error', (err) => {
            console.error('GitHub API request failed:', err);
            reject(err);
        });
    });
}

function isNewerVersion(newVersion, currentVersion) {
    const newParts = newVersion.split('.').map(Number);
    const currentParts = currentVersion.split('.').map(Number);

    for (let i = 0; i < Math.max(newParts.length, currentParts.length); i++) {
        const newPart = newParts[i] || 0;
        const currentPart = currentParts[i] || 0;

        if (newPart > currentPart) return true;
        if (newPart < currentPart) return false;
    }

    return false;
}

function skipVersion(version) {
    LocalDatabase.statements.setStatistic.run(
        'skipped_version',
        version,
        new Date().toISOString()
    );
}

function getIconPath() {
    if (process.platform === 'darwin') {
        return path.join(__dirname, 'icon.icns');
    } else {
        return path.join(__dirname, 'icon.ico');
    }
}

async function getGitHubDownloads() {
    return new Promise((resolve, reject) => {
        const options = {
            hostname: 'api.github.com',
            path: '/repos/DeaDuLia/DropList/releases',
            headers: {
                'User-Agent': 'DropList-App',
                // Добавляем заголовок для увеличения лимита запросов
                'Accept': 'application/vnd.github.v3+json'
            }
        };

        https.get(options, (res) => {
            let data = '';
            res.on('data', (chunk) => {
                data += chunk;
            });
            res.on('end', () => {
                try {
                    const releases = JSON.parse(data);
                    if (releases && releases.length > 0) {
                        // Суммируем загрузки всех ассетов всех релизов
                        const totalDownloads = releases.reduce((total, release) => {
                            if (release.assets && release.assets.length > 0) {
                                return total + release.assets.reduce((sum, asset) => sum + asset.download_count, 0);
                            }
                            return total;
                        }, 0);
                        resolve(totalDownloads);
                    } else {
                        resolve(0);
                    }
                } catch (e) {
                    console.error('Error parsing GitHub response:', e);
                    reject(e);
                }
            });
        }).on('error', (err) => {
            console.error('GitHub API request failed:', err);
            reject(err);
        });
    });
}

LocalDatabase.initializeDatabase();

let win;
async function createWindow() {
    win = new BrowserWindow({
        title: 'DropList',
        width: 1280,
        height: 800,
        icon: getIconPath(),
        frame: false,
        titleBarStyle: 'hidden',
        webPreferences: {
            nodeIntegration: false,
            sandbox: true,
            preload: path.join(__dirname, 'preload.js')
        }
    });

    win.setTitle('DropList');

    if (process.platform === 'win32') {
        win.setAppDetails({
            appId: 'com.deshin.droplist',
            appIconPath: getIconPath(),
            appIconIndex: 0,
            relaunchCommand: process.execPath,
            relaunchDisplayName: 'DropList'
        });
    }

    if (process.platform === 'darwin') {
        app.setName('DropList');
    }

    win.setMenu(null);

    const storedUser = getStoredUser();

    if (storedUser && storedUser.is_authenticated) {
        const freshToken = await getValidToken();
        if (freshToken) {
            console.log('[i] Token valid on startup');
            syncUserData(storedUser.uid, freshToken).then(syncResult => {
                if (win && syncResult.needChoice) {
                    win.webContents.send('sync-required', syncResult);
                }
            });
        } else {
            console.log('[!] Session expired on startup');
            clearUserSession();
            win.webContents.send('restore-session', null);
        }
    }

    // ТОЛЬКО ПОСЛЕ ЭТОГО ЗАГРУЖАЕМ СТРАНИЦУ
    win.loadFile('./src/ui/index.html');

    win.webContents.on('did-finish-load', () => {
        if (storedUser && storedUser.is_authenticated) {
            win.webContents.send('restore-session', {
                email: storedUser.email,
                uid: storedUser.uid
            });
        } else {
            win.webContents.send('restore-session', null);
        }
    });
}

app.whenReady().then(createWindow);

app.whenReady().then(() => {
    setTimeout(() => {
        checkForUpdates(false);
    }, 3000);

    setTimeout(() => {
        updateAllReleaseDates();
    }, 5000);
});

setInterval(() => {
    LocalDatabase.db.pragma('wal_checkpoint(RESTART)');
}, 30000);

app.on('before-quit', async (event) => {
    event.preventDefault();

    const storedUser = getStoredUser();
    if (storedUser && storedUser.is_authenticated && storedUser.idToken) {
        await syncDirtySections(storedUser.uid, storedUser.idToken);
    }

    LocalDatabase.db.pragma('wal_checkpoint(FULL)');
    LocalDatabase.db.close();
    app.exit();
});

ipcMain.on('open-external', (event, url, name) => {
    const externalWindow = new BrowserWindow({
        title: 'DropList - Поиск обложки',
        width: 1000,
        height: 800,
        icon: getIconPath(),
        webPreferences: {
            nodeIntegration: false,
            preload: path.join(__dirname, 'preload-external.js')
        },
        show: true
    });
    externalWindow.setTitle('DropList - Поиск обложки');
    if (process.platform === 'win32') {
        externalWindow.setAppDetails({
            appId: 'com.deshin.droplist',
            appIconPath: getIconPath(),
            appIconIndex: 0
        });
    }
    externalWindow.setMenu(null)
    // Блокируем навигацию
    externalWindow.webContents.on('will-navigate', (event, navigationUrl) => {
        if (new URL(navigationUrl).origin !== new URL(url).origin) {
            event.preventDefault();
        }
    });

    externalWindow.webContents.setWindowOpenHandler(() => {
        return { action: 'deny' };
    });
    externalWindow.loadFile('./src/ui/loading.html');



    externalWindow.webContents.on('did-finish-load', () => {
        if (externalWindow.webContents.getURL().endsWith('loading.html')) {
            setTimeout(() => {
                externalWindow.loadURL(url);
            }, 500);
        } else {
            initializeRealPage(externalWindow, url, name);
        }
    });
});

function initializeRealPage(externalWindow, url, name) {
    externalWindow.webContents.executeJavaScript(`
            const style = document.createElement('style');
            style.textContent = \`           
                a { pointer-events: none !important; }
                img { pointer-events: none !important; }
            \`;
            document.head.appendChild(style);

            document.addEventListener('click', function(e) {
                let img = (e.target.tagName === 'IMG' && e.target.src)
                    ? e.target
                    : e.target.querySelector('img');
                if (img && img.src) {
                    e.preventDefault();
                    e.stopPropagation();
                    handleImageClick(img);
                    return;
                } 
            });

            function handleImageClick(imgElement) {
                const isChangeUrl = (${JSON.stringify(name)});
                navigator.clipboard.writeText(imgElement.src)
                    .then(() => {
                        showNotification(
                            isChangeUrl 
                                ? 'Обложка обновлена' 
                                : 'Data-URL изображения скопирована',
                            isChangeUrl ? 'info' : 'data'
                        );
                        window.externalAPI.sendMessageToMain(imgElement.src, ${JSON.stringify(name)});
                        setTimeout(() => {
                            window.close();
                        }, 1000);
                    })
                    .catch(err => {
                        console.error('Ошибка:', err);
                        showNotification('Не удалось скопировать ссылку', 'error');
                    });
            }

            function showNotification(message, type = 'info') {
                const styles = {
                    info: { bg: '#00b894', icon: '🖼️' },
                    data: { bg: '#6c5ce7', icon: '📋' },
                    error: { bg: '#d63031', icon: '⚠️' }
                };
                const style = styles[type] || styles.info;
                const notification = document.createElement('div');
                notification.className = 'img-copy-notification';
                Object.assign(notification.style, {
                    position: 'fixed',
                    top: '50%',
                    left: '50%',
                    transform: 'translate(-50%, -50%)',
                    backgroundColor: style.bg,
                    color: 'white',
                    padding: '24px 48px',
                    borderRadius: '12px',
                    zIndex: '9999',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '20px',
                    boxShadow: '0 8px 24px rgba(0,0,0,0.3)',
                    maxWidth: '80vw',
                    fontSize: '24px',
                    fontWeight: 'bold',
                    textAlign: 'center',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis'
                });
                
                const icon = document.createElement('span');
                icon.textContent = style.icon;
                icon.style.fontSize = '32px';
                notification.appendChild(icon);
                
                const text = document.createElement('span');
                text.textContent = message;
                notification.appendChild(text);
                
                document.body.appendChild(notification);

                setTimeout(() => {
                    notification.remove();
                }, 1500); 
            }  
        `);
}

ipcMain.on('message-from-external', (event, imgUrl, name) => {
    // Отправляем сообщение в index.html
    if (win) {
        win.webContents.send('message-to-index', { imgUrl, name });
    }
});

async function getCachedGitHubDownloads() {
    try {
        const cachedData = LocalDatabase.statements.getStatistic.get('last_downloads');

        if (cachedData) {
            const cacheDate = new Date(cachedData.actual_date);
            const now = new Date();
            const diffHours = (now - cacheDate) / (1000 * 60 * 60);

            if (diffHours < 1) {
                return parseInt(cachedData.value) || 0;
            }
        }

        console.log('[i] Fetching fresh downloads count');
        const downloads = await getGitHubDownloads();

        LocalDatabase.statements.setStatistic.run(
            'last_downloads',
            downloads.toString(),
            new Date().toISOString()
        );

        return downloads;

    } catch (error) {
        console.error('Error in getCachedGitHubDownloads:', error);
        const cachedData = LocalDatabase.statements.getStatistic.get('last_downloads');
        if (cachedData) {
            return parseInt(cachedData.value) || 0;
        }

        return 0;
    }
}

async function applySyncChoice(uid, idToken, choice, localData, remoteData) {
    try {
        const freshToken = await getValidToken();
        if (!freshToken) {
            return { success: false, error: 'No valid token' };
        }

        if (choice === 'local') {
            // Сохраняем все локальные разделы в Firestore
            const sections = ['games', 'movies', 'cartoons', 'serials', 'anime', 'books'];
            for (const section of sections) {
                await saveSectionToFirestore(uid, freshToken, section, localData[section] || []);
            }
            await saveAllTagsToFirestore(uid, freshToken);
            await saveExpectedReleasesToFirestore(uid, freshToken);
            const localLastSync = LocalDatabase.statements.getStatistic.get('last_firestore_update');
            const localSyncTime = localLastSync ? localLastSync.value : null;
            await updateSyncTime(uid, freshToken, localSyncTime);
            return { success: true, source: 'local' };

        } else if (choice === 'remote') {
            LocalDatabase.saveAllLocalData(remoteData);
            const remoteTags = await loadAllTagsFromFirestore(uid, freshToken);
            if (remoteTags) {
                LocalDatabase.db.prepare('DELETE FROM tags').run();
                for (const tag of remoteTags) {
                    LocalDatabase.db.prepare('INSERT INTO tags (name, count) VALUES (?, ?)').run(tag.name, tag.count);
                }
                clearTagsDirty();
            }
            const remoteReleases = await loadExpectedReleasesFromFirestore(uid, freshToken);
            if (remoteReleases) {
                LocalDatabase.statements.replaceAllExpectedReleases.run();
                for (const release of remoteReleases) {
                    LocalDatabase.statements.setExpectedRelease.run(
                        release.card_name,
                        release.section,
                        release.release_date,
                        release.last_notification_date
                    );
                }
                clearExpectedReleasesDirty();

                const remoteSyncTime = await getSyncTime(uid, freshToken);
                console.log(remoteSyncTime);
                LocalDatabase.statements.setStatistic.run('last_firestore_update', remoteSyncTime, remoteSyncTime);
                return {success: true, source: 'remote'};
            }
        }
        return { success: false, error: 'Неверный выбор' };
    } catch (error) {
        console.error('Apply sync error:', error);
        return { success: false, error: error.message };
    }
}

ipcMain.handle('sync-all-sections-to-cloud', async () => {

    const storedUser = getStoredUser();
    if (!storedUser || !storedUser.is_authenticated || !storedUser.idToken) {
        return { success: false, error: 'Not authenticated' };
    }

    const freshToken = await getValidToken();
    if (!freshToken) {
        return { success: false, error: 'No valid token' };
    }

    try {
        const sections = ['games', 'movies', 'cartoons', 'serials', 'anime', 'books'];
        for (const section of sections) {
            const sectionData = LocalDatabase.statements.getDataBySection.all(section);
            await saveSectionToFirestore(storedUser.uid, freshToken, section, sectionData);
        }
        await saveAllTagsToFirestore();
        const now = new Date().toISOString();
        await updateSyncTime(storedUser.uid, freshToken, now);

        console.log('✅ All sections synced to cloud');
        return { success: true };
    } catch (error) {
        console.error('[x] Failed to sync all sections:', error);
        return { success: false, error: error.message };
    }
});

ipcMain.handle('update-data-description', async (event, section, name, description) => {
    const stmt = LocalDatabase.db.prepare('UPDATE data_cards SET description = ? WHERE name = ? AND section = ?');
    const result = stmt.run(description, name, section);
    markSectionDirty(section);
    const now = new Date().toISOString();
    LocalDatabase.statements.setStatistic.run('last_firestore_update', now, now);
    return result;
});

ipcMain.handle('get-all-tags', async () => {
    return LocalDatabase.statements.getAllTags.all();
});

ipcMain.handle('search-tags', async (event, query) => {
    return LocalDatabase.statements.searchTags.all(`${query}%`).map(row => row.name);
});

ipcMain.handle('get-card-tags', async (event, section, cardName) => {
    return LocalDatabase.statements.getTagsByCard.all(cardName).map(row => row.tag_name);
});

ipcMain.handle('update-card-tags', async (event, section, cardName, newTags) => {
    const oldTags = LocalDatabase.statements.getTagsByCard.all(cardName).map(row => row.tag_name);
    const removedTags = oldTags.filter(tag => !newTags.includes(tag));
    const addedTags = newTags.filter(tag => !oldTags.includes(tag));
    LocalDatabase.statements.clearCardTags.run(cardName);

    for (const tag of newTags) {
        LocalDatabase.statements.addTagToCard.run(cardName, tag);
    }

    for (const tag of removedTags) {
        LocalDatabase.statements.removeTagCount.run(tag);
        LocalDatabase.statements.deleteTagIfZero.run(tag);
    }

    for (const tag of addedTags) {
        LocalDatabase.statements.addOrUpdateTag.run(tag);
    }

    markSectionDirty(section);
    markTagsDirty();
    const now = new Date().toISOString();
    LocalDatabase.statements.setStatistic.run('last_firestore_update', now, now);

    return { success: true };
});

ipcMain.handle('search-tags-web', async (event, title, section) => {
    const searchQuery = `${title} ${section === 'games' ? 'game' : section === 'movies' ? 'film' : 'genre'}`;

    // Простой запрос без лишних параметров
    const url = `https://api.duckduckgo.com/?q=${encodeURIComponent(searchQuery)}&format=json`;

    try {
        const response = await fetch(url);
        const data = await response.json();

        const tags = [];

        // Проверяем RelatedTopics
        if (data.RelatedTopics) {
            for (const topic of data.RelatedTopics) {
                if (typeof topic === 'object' && topic.Text) {
                    // Извлекаем слова до 20 символов
                    const match = topic.Text.match(/[А-Яа-яA-Za-z]{3,20}/g);
                    if (match) {
                        tags.push(...match);
                    }
                }
            }
        }

        // Убираем дубликаты и ограничиваем
        const uniqueTags = [...new Set(tags)].slice(0, 8);
        console.log('Теги:', uniqueTags);
        return uniqueTags;

    } catch (error) {
        console.error('Ошибка:', error);
        return [];
    }
});

ipcMain.handle('fetch-steam-tags', async (event, title) => {
    return await fetchSteamGameTags(title);
});

ipcMain.handle('fetch-steam-tags-api', async (event, title) => {
    return await fetchSteamAPIData(title);
});

ipcMain.handle('search-litres-book', async (event, title) => {
    return await fetchLitresBookTags(title);
});

ipcMain.handle('search-litres-book-api', async (event, title) => {
    return await fetchLitresBookAPIData(title);
});

ipcMain.handle('search-kinopoisk-movie', async (event, title) => {
    return await fetchKinopoiskMovieTags(title);
});

ipcMain.handle('search-yummyani-anime', async (event, title) => {
    return await fetchYummyAniTags(title);
});

ipcMain.handle('search-filmru-serial', async (event, title) => {
    return await fetchFilmRuSerialsTags(title);
});

ipcMain.handle('get-github-downloads', async () => {
    try {
        const downloads = await getCachedGitHubDownloads();
        return { success: true, downloads };
    } catch (error) {
        console.error('Error getting GitHub downloads:', error);
        return { success: false, downloads: 0 };
    }
});

ipcMain.handle('get-ratings', () => {
    return LocalDatabase.statements.getRatings
        .all()
        .map(row => row.rating);
});

ipcMain.handle('get-statuses', () => {
    return LocalDatabase.statements.getStatuses
        .all()
        .map(row => row.status);
});

ipcMain.handle('get-statuses-no-import', () => {
    return LocalDatabase.statements.getStatusesNoImport
        .all()
        .map(row => row.status);
});

ipcMain.handle('get-data', async (event, section) => {
    return LocalDatabase.statements.getDataBySection.all(section);
});

ipcMain.handle('add-data', async (event, section, data) => {
    const result = LocalDatabase.statements.addData.run(
        data.name,
        section,
        data.icoUrl || null,
        data.rating,
        data.status || 'Уточнить',
        data.description || ''
    );

    // Добавляем теги
    if (data.tags && Array.isArray(data.tags) && data.tags.length > 0) {
        for (const tag of data.tags) {
            LocalDatabase.statements.addTagToCard.run(data.name, tag);
            LocalDatabase.statements.addOrUpdateTag.run(tag);
        }
        markTagsDirty();
    }

    // Сохраняем дату релиза, если передана
    if (data.releaseDate) {
        LocalDatabase.statements.setExpectedRelease.run(data.name, section, data.releaseDate, null);
        markExpectedReleasesDirty();
        console.log(`[AddData] Saved release date for "${data.name}": ${data.releaseDate}`);
    }

    markSectionDirty(section);
    const now = new Date().toISOString();
    LocalDatabase.statements.setStatistic.run('last_firestore_update', now, now);

    return result;
});

ipcMain.handle('delete-data', async (event, section, dataName) => {
    // Сначала получаем теги карточки
    const tags = LocalDatabase.statements.getTagsByCard.all(dataName).map(row => row.tag_name);

    // Удаляем связи тегов
    LocalDatabase.statements.clearCardTags.run(dataName);
    LocalDatabase.statements.deleteExpectedRelease.run(dataName, section);


    // Удаляем карточку
    const result = LocalDatabase.statements.deleteData.run(dataName, section);

    // Обновляем счётчики тегов
    for (const tag of tags) {
        LocalDatabase.statements.removeTagCount.run(tag);
        LocalDatabase.statements.deleteTagIfZero.run(tag);
    }

    markSectionDirty(section);
    markExpectedReleasesDirty();
    const now = new Date().toISOString();
    LocalDatabase.statements.setStatistic.run('last_firestore_update', now, now);

    return result;
});

ipcMain.handle('move-to-category', async (event, data) => {
    // Удаляем из старой категории
    const result = LocalDatabase.statements.addData.run(data.name, data.newCategory, data.oldIcoUrl || null, data.oldRating || '0', data.oldStatus || 'Уточнить', data.oldDescription);
    LocalDatabase.statements.deleteData.run(data.name, data.oldCategory);
    markSectionDirty(data.newCategory);
    markSectionDirty(data.oldCategory);
    const now = new Date().toISOString();
    LocalDatabase.statements.setStatistic.run('last_firestore_update', now, now);

    return result;
});

ipcMain.handle('update-data', async (event, section, oldName, newName, newIcoUrl) => {
    const result = LocalDatabase.statements.updateData.run(newName, newIcoUrl, oldName, section);
    markSectionDirty(section);
    // Обновляем локальное время синхронизации
    const now = new Date().toISOString();
    LocalDatabase.statements.setStatistic.run('last_firestore_update', now, now);

    return result;
});

ipcMain.handle('update-data-rating', async (event, section, dataName, rating) => {
    const result = LocalDatabase.statements.updateDataRating.run(rating, dataName, section);
    markSectionDirty(section);
    // Обновляем локальное время синхронизации
    const now = new Date().toISOString();
    LocalDatabase.statements.setStatistic.run('last_firestore_update', now, now);

    return result;
});

ipcMain.handle('update-data-status', async (event, section, dataName, status) => {
    const oldStatus = LocalDatabase.statements.getStatusByNameAndSection.get(dataName, section)?.status;
    const result = LocalDatabase.statements.updateDataStatus.run(status, dataName, section);

    if ((status === 'Ожидается' || status === 'В процессе') && oldStatus !== status) {
        // Запускаем в фоне
        fetchCardData(dataName, section).then(cardData => {
            if (cardData.releaseDate) {
                LocalDatabase.statements.setExpectedRelease.run(dataName, section, cardData.releaseDate, null);
                markExpectedReleasesDirty();
                if (win) {
                    win.webContents.send('release-date-updated', { cardName: dataName, section, releaseDate: cardData.releaseDate });
                }
            }
        }).catch(err => console.error('Failed to fetch release date:', err));
    } else if ((oldStatus === 'Ожидается' || oldStatus === 'В процессе') && status !== 'Ожидается' && status !== 'В процессе') {
        LocalDatabase.statements.deleteExpectedRelease.run(dataName, section);
        markExpectedReleasesDirty();
    }

    markSectionDirty(section);
    const now = new Date().toISOString();
    LocalDatabase.statements.setStatistic.run('last_firestore_update', now, now);

    return result;
});

ipcMain.handle('check-duplicates', async (event, section, name) => {
    let countOfData = LocalDatabase.statements.getDataCount.get(name, section)?.allCount ?? 0;
    return countOfData > 0;
});

ipcMain.handle('export-data', async () => {
    const win = BrowserWindow.getFocusedWindow();

    try {
        // Получаем все данные из БД
        const data = {
            games: LocalDatabase.statements.getDataBySection.all('games'),
            movies: LocalDatabase.statements.getDataBySection.all('movies'),
            cartoons: LocalDatabase.statements.getDataBySection.all('cartoons'),
            serials: LocalDatabase.statements.getDataBySection.all('serials'),
            anime: LocalDatabase.statements.getDataBySection.all('anime'),
            books: LocalDatabase.statements.getDataBySection.all('books'),
            ratings: LocalDatabase.statements.getRatings.all().map(r => r.rating),
            statuses: LocalDatabase.statements.getStatuses.all().map(s => s.status)
        };

        // Показываем диалог сохранения
        const { filePath } = await dialog.showSaveDialog(win, {
            title: 'Экспорт данных',
            defaultPath: 'DropList.json',
            filters: [
                { name: 'JSON Files', extensions: ['json'] },
                { name: 'All Files', extensions: ['*'] }
            ]
        });

        if (filePath) {
            fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
            return { success: true, message: 'Данные успешно экспортированы' };
        }
        return { success: false, message: 'Экспорт отменен' };
    } catch (error) {
        console.error('Export error:', error);
        return { success: false, message: 'Ошибка при экспорте данных' };
    }
});

ipcMain.handle('import-data', async () => {
    const win = BrowserWindow.getFocusedWindow();

    try {
        const { filePaths } = await dialog.showOpenDialog(win, {
            title: 'Импорт данных',
            filters: [
                { name: 'JSON Files', extensions: ['json'] },
                { name: 'All Files', extensions: ['*'] }
            ],
            properties: ['openFile']
        });

        if (filePaths.length === 0) {
            return { success: false, message: 'Импорт отменен' };
        }

        const filePath = filePaths[0];
        const data = JSON.parse(fs.readFileSync(filePath, 'utf-8'));

        const storedUser = getStoredUser();
        const isAuthed = storedUser && storedUser.is_authenticated && storedUser.idToken;

        // Импортируем данные в транзакции
        LocalDatabase.db.transaction(() => {
            // Импорт рейтингов и статусов
            if (data.ratings) {
                data.ratings.forEach(rating => {
                    LocalDatabase.db.prepare('INSERT OR IGNORE INTO ratings (rating) VALUES (?)').run(rating);
                });
            }
            if (data.statuses) {
                data.statuses.forEach(status => {
                    LocalDatabase.db.prepare('INSERT OR IGNORE INTO statuses (status) VALUES (?)').run(status);
                });
            }

            const categories = Object.keys(data).filter(key =>
                key !== 'ratings' && key !== 'statuses'
            );

            for (const category of categories) {
                if (Array.isArray(data[category])) {
                    for (const item of data[category]) {
                        const existing = LocalDatabase.statements.getDataCount.get(item.name, category)?.allCount ?? 0;

                        if (existing > 0) {
                            LocalDatabase.statements.addData.run(
                                item.name, category, item.icoUrl || null,
                                item.rating || '0', 'Импортировано'
                            );
                        } else {
                            LocalDatabase.statements.importData.run(
                                item.name, category, item.icoUrl || null,
                                item.rating || '0', 'Импортировано', item.description || ''
                            );
                        }
                    }
                }
                markSectionDirty(category);
            }
        })();

        const now = new Date().toISOString();
        LocalDatabase.statements.setStatistic.run('last_firestore_update', now, now);

        if (isAuthed) {
            await syncDirtySections(storedUser.uid, storedUser.idToken);
        }

        return { success: true, message: 'Данные успешно импортированы' };

    } catch (error) {
        console.error('Import error:', error);
        return { success: false, message: 'Ошибка при импорте данных' };
    }
});

ipcMain.handle('replace-data', async () => {
    const win = BrowserWindow.getFocusedWindow();

    try {
        const { filePaths } = await dialog.showOpenDialog(win, {
            title: 'Заменить данные',
            filters: [
                { name: 'JSON Files', extensions: ['json'] },
                { name: 'All Files', extensions: ['*'] }
            ],
            properties: ['openFile']
        });

        if (filePaths.length === 0) {
            return { success: false, message: 'Замена отменена' };
        }

        const filePath = filePaths[0];
        const data = JSON.parse(fs.readFileSync(filePath, 'utf-8'));

        const storedUser = getStoredUser();
        const isAuthed = storedUser && storedUser.is_authenticated && storedUser.idToken;

        // Очищаем и импортируем данные в транзакции
        LocalDatabase.db.transaction(() => {
            // Очищаем локальные таблицы
            LocalDatabase.db.exec('DELETE FROM tags_assign');
            LocalDatabase.db.exec('DELETE FROM data_cards');

            // Импортируем рейтинги и статусы
            if (data.ratings) {
                data.ratings.forEach(rating => {
                    LocalDatabase.db.prepare('INSERT OR IGNORE INTO ratings (rating) VALUES (?)').run(rating);
                });
            }
            if (data.statuses) {
                data.statuses.forEach(status => {
                    LocalDatabase.db.prepare('INSERT OR IGNORE INTO statuses (status) VALUES (?)').run(status);
                });
            }

            // Импортируем новые карточки
            const categories = Object.keys(data).filter(key =>
                key !== 'ratings' && key !== 'statuses'
            );

            for (const category of categories) {
                if (Array.isArray(data[category])) {
                    for (const item of data[category]) {
                        LocalDatabase.statements.importData.run(
                            item.name, category, item.icoUrl || null,
                            item.rating || '0', item.status || 'Уточнить', item.description || ''
                        );
                    }
                }
                markSectionDirty(category);
            }
        })();

        const now = new Date().toISOString();
        LocalDatabase.statements.setStatistic.run('last_firestore_update', now, now);

        if (isAuthed) {
            syncDirtySections(storedUser.uid, storedUser.idToken);
        }

        return { success: true, message: 'Данные успешно заменены' };

    } catch (error) {
        console.error('Replace error:', error);
        return { success: false, message: 'Ошибка при замене данных' };
    }
});

ipcMain.handle('search-in-browser', async (event, url = '') => {
    try {
        shell.openExternal(url);
        return { success: true };
    } catch (error) {
        console.error('Failed to open search in browser:', error);
        return { success: false, error: error.message };
    }
});

ipcMain.handle('search-image', async (event, title) => {
    return new Promise((resolve) => {
        const searchQuery = encodeURIComponent(title + ' обложка');
        const searchUrl = `https://yandex.ru/images/search?text=${searchQuery}`;

        // Создаем скрытое окно
        const hiddenWindow = new BrowserWindow({
            show: false,
            webPreferences: {
                nodeIntegration: false,
                contextIsolation: true
            }
        });

        // Загружаем страницу
        hiddenWindow.loadURL(searchUrl);

        // Ждем загрузки
        hiddenWindow.webContents.on('did-finish-load', async () => {
            try {
                // Выполняем JavaScript в контексте страницы для получения изображений
                const images = await hiddenWindow.webContents.executeJavaScript(`
                    (function() {
                        // Ищем все изображения результатов
                        const images = document.getElementsByTagName('img');
                        if (true) {
                            
                        }
                        if (images.length > 5) {
                            return images[1].src;
                        }
                        return '';
                    })();
                `);

                hiddenWindow.close();
                resolve(images || '');

            } catch (error) {
                console.error('Ошибка получения изображений:', error);
                hiddenWindow.close();
                resolve('');
            }
        });

        // Таймаут на случай ошибки загрузки
        setTimeout(() => {
            if (!hiddenWindow.isDestroyed()) {
                hiddenWindow.close();
            }
            resolve('');
        }, 10000);
    });
});

ipcMain.on('window-control', (event, action) => {
    const win = BrowserWindow.getFocusedWindow();
    if (!win) return;

    switch (action) {
        case 'minimize':
            win.minimize();
            break;
        case 'maximize':
            if (win.isMaximized()) {
                win.unmaximize();
            } else {
                win.maximize();
            }
            break;
        case 'close':
            win.close();
            break;
    }
});

ipcMain.handle('is-window-maximized', () => {
    const win = BrowserWindow.getFocusedWindow();
    return win ? win.isMaximized() : false;
});

ipcMain.handle('check-for-updates', async (event, manualCheck = false) => {
    await checkForUpdates(manualCheck);
});

ipcMain.handle('skip-version', (event, version) => {
    skipVersion(version);
});

ipcMain.handle('get-current-version', () => {
    return app.getVersion();
});

ipcMain.handle('open-release-page', (event, url) => {
    shell.openExternal(url);
});

ipcMain.handle('auth-sign-in', async (event, email, password) => {
    try {
        const userCredential = await signInWithEmailAndPassword(auth, email, password);
        const user = userCredential.user;
        const idToken = await user.getIdToken();
        const refreshToken = user.refreshToken; // 👈 ПОЛУЧАЕМ

        saveUserSession(user.email, user.uid, idToken, refreshToken);

        // Запускаем синхронизацию в фоне
        syncUserData(user.uid, idToken).then(syncResult => {
            if (win && syncResult.needChoice) {
                win.webContents.send('sync-required', syncResult);
            }
        });

        return { success: true, email: user.email, uid: user.uid };
    } catch (error) {
        console.error('[x] Sign in error:', error);
        let errorMessage;
        switch (error.code) {
            case 'auth/invalid-email': errorMessage = 'Неверный формат email'; break;
            case 'auth/user-not-found': errorMessage = 'Пользователь не найден'; break;
            case 'auth/wrong-password': errorMessage = 'Неверный пароль'; break;
            case 'auth/too-many-requests': errorMessage = 'Слишком много попыток'; break;
            default: errorMessage = error.message;
        }
        return { success: false, error: errorMessage };
    }
});

ipcMain.handle('auth-sign-up', async (event, email, password) => {
    try {
        const userCredential = await createUserWithEmailAndPassword(auth, email, password);
        const user = userCredential.user;
        const idToken = await user.getIdToken();
        const refreshToken = user.refreshToken; // 👈 ПОЛУЧАЕМ

        saveUserSession(user.email, user.uid, idToken, refreshToken);

        syncUserData(user.uid, idToken).then(syncResult => {
            if (win && syncResult.needChoice) {
                win.webContents.send('sync-required', syncResult);
            }
        });

        return { success: true, email: user.email, uid: user.uid };
    } catch (error) {
        console.error('[x] Registration error:', error);
        let errorMessage;
        switch (error.code) {
            case 'auth/invalid-email': errorMessage = 'Неверный формат email'; break;
            case 'auth/email-already-in-use': errorMessage = 'Email уже используется'; break;
            case 'auth/weak-password': errorMessage = 'Пароль слишком слабый (мин. 6 символов)'; break;
            default: errorMessage = error.message;
        }
        return { success: false, error: errorMessage };
    }
});

ipcMain.handle('auth-get-current-user', async () => {
    const storedUser = getStoredUser();
    if (storedUser && storedUser.is_authenticated) {
        return { isAuthenticated: true, email: storedUser.email, uid: storedUser.uid };
    }
    return { isAuthenticated: false };
});

ipcMain.handle('auth-sign-out', async () => {
    try {
        const storedUser = getStoredUser();
        if (storedUser && storedUser.is_authenticated && storedUser.idToken) {
            syncDirtySections(storedUser.uid, storedUser.idToken);
        }

        await signOut(auth);
        clearUserSession();
        console.log('[i] Signed out');
        return { success: true };
    } catch (error) {
        console.error('[x] Sign out error:', error);
        return { success: false, error: error.message };
    }
});

ipcMain.handle('sync-apply-choice', async (event, choice, localData, remoteData) => {
    const storedUser = getStoredUser();
    if (!storedUser || !storedUser.idToken) {
        return { success: false, error: 'Пользователь не авторизован' };
    }
    return await applySyncChoice(storedUser.uid, storedUser.idToken, choice, localData, remoteData);
});

ipcMain.handle('get-all-local-data', async () => {
    return LocalDatabase.getAllLocalData();
});

ipcMain.handle('save-release-date', async (event, cardName, section, releaseDate) => {
    // Проверяем, существует ли карточка и имеет ли она статус "Ожидается" или "В процессе"
    const card = LocalDatabase.statements.getStatusByNameAndSection.get(cardName, section);

    if (card) {
        // Если статус подходящий — сохраняем/обновляем в expected_releases
        const existing = LocalDatabase.statements.getExpectedRelease.get(cardName, section);
        if (existing) {
            LocalDatabase.statements.setExpectedRelease.run(cardName, section, releaseDate, existing.last_notification_date);
        } else {
            LocalDatabase.statements.setExpectedRelease.run(cardName, section, releaseDate, null);
        }
        markExpectedReleasesDirty();
        console.log(`[Release] Saved date for "${cardName}": ${releaseDate}`);
    }

    return { success: true };
});

ipcMain.handle('delete-release-date', async (event, cardName, section) => {
    LocalDatabase.statements.deleteExpectedRelease.run(cardName, section);
    markExpectedReleasesDirty();
    return { success: true };
});

ipcMain.handle('get-all-expected-releases', async () => {
    return LocalDatabase.statements.getAllExpectedReleases.all();
});

ipcMain.handle('fetch-card-data', async (event, title, section) => {
    return await fetchCardData(title, section);
});

ipcMain.handle('get-section-release-notifications', async (event, section) => {
    const releases = LocalDatabase.statements.getExpectedReleasesBySection.all(section);
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const notifications = [];
    const sixHoursAgo = new Date(Date.now() - 6 * 60 * 60 * 1000);

    for (const release of releases) {
        const releaseDate = new Date(release.release_date);
        releaseDate.setHours(0, 0, 0, 0);
        const diffDays = Math.ceil((releaseDate - today) / (1000 * 60 * 60 * 24));

        // Только если diffDays <= 30
        if (diffDays > 30) continue;

        // Проверяем, не показывали ли за последние 6 часов
        const lastNotif = release.last_notification_date ? new Date(release.last_notification_date) : null;
        if (lastNotif && lastNotif > sixHoursAgo) continue;
        console.log(release);
        const message = diffDays <= 0
            ? `В релизе`
            : `Через ${diffDays} дн. выходит`;

        notifications.push({
            cardName: release.card_name,
            section: release.section,
            releaseDate: release.release_date,
            daysLeft: diffDays <= 0 ? 0 : diffDays,
            isReleased: diffDays <= 0,
            message: message
        });
    }

    // Сортируем по дате (самые близкие/вышедшие первыми)
    notifications.sort((a, b) => new Date(a.releaseDate) - new Date(b.releaseDate));

    return { success: true, notifications };
});

ipcMain.handle('mark-release-notification-shown', async (event, cardName, section) => {
    const existing = LocalDatabase.statements.getExpectedRelease.get(cardName, section);
    if (existing) {
        LocalDatabase.statements.setExpectedRelease.run(cardName, section, existing.release_date, new Date().toISOString());
        markExpectedReleasesDirty();
    }
    return { success: true };
});

ipcMain.handle('search-kupikod-price', async (event, title) => {
    return await fetchKupikodPriceAPI(title); // используем API версию
});

ipcMain.handle('search-chitai-gorod-book', async (event, title) => {
    return await fetchChitaiGorodBook(title);
});

ipcMain.handle('stop-info-searching', async () => {
    closeAllParsingWindows();
});