const { app, BrowserWindow, ipcMain, shell } = require('electron');
const { dialog } = require('electron');
const fs = require('fs');
const path = require('path');
const https = require('https');
const { autoUpdater } = require('electron-updater');
const log = require('electron-log');
const { sendPasswordResetEmail, signInWithEmailAndPassword, createUserWithEmailAndPassword, signOut } = require('firebase/auth');

const LocalDatabase = require('./database/local-database');
const {fetchSteamAPIData, fetchSteamGameTags, fetchKupikodPriceAPI} = require("./service/search/game-search.js");
const {fetchLitresBookTags, fetchLitresBookAPIData, fetchChitaiGorodBook} = require("./service/search/book-search.js");
const {fetchKinopoiskMovieTags, fetchFilmRuSerialsTags} = require("./service/search/movie-search.js");
const {fetchCardData, updateAllReleaseDates, closeAllParsingWindows} = require("./service/search/data-search.js");
const {getStoredUser, clearUserSession, clearTagsDirty, clearExpectedReleasesDirty, markSectionDirty, markTagsDirty,
    markExpectedReleasesDirty, saveUserSession, markFavoritesDirty, clearFavoritesDirty
} = require("./database/local-database.js");
const {syncDirtySections, getValidToken, saveSectionToFirestore, saveAllTagsToFirestore,
    saveExpectedReleasesToFirestore, updateSyncTime, loadExpectedReleasesFromFirestore, getSyncTime,
    loadAllTagsFromFirestore, saveFavoritesToFirestore, loadFavoritesFromFirestore, auth
} = require("./database/firestore.js");
const {getAllTagsLocal, getTagByName, isTagsDirty, getAllExpectedReleasesLocal, getExpectedReleaseByName,
    isExpectedReleasesDirty, getAllFavoritesLocal, getFavoriteByName, isFavoritesDirty, isSectionDirty,
    saveLocalCardsData, getLocalUpdatedAt, updateLocalUpdatedAt, saveLocalExpectedReleasesData, saveLocalFavoritesData,
    getAllCardsBySection, clearLogs, getLogs, getCardByNameAndSection, saveLocalTagsData, writeLog, clearSectionDirty,
    getExpectedReleaseByNameAndSection
} = require("./database/local-database");
const {updateMeta, getSectionMeta, getSectionFromFirestore, getMeta} = require("./database/firestore");

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
            startBackgroundSync();
            sendSyncStatus('idle', 'Синхронизировано');
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

    setTimeout(() => {
        const storedUser = getStoredUser();
        if (storedUser && storedUser.is_authenticated) {
            sendSyncStatus('idle', 'Синхронизировано');
        } else {
            sendSyncStatus('idle', 'Не авторизован');
        }
    }, 1000);
});

setInterval(() => {
    LocalDatabase.db.pragma('wal_checkpoint(RESTART)');
}, 30000);

app.on('before-quit', async (event) => {
    event.preventDefault();
    stopBackgroundSync();

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
            await saveFavoritesToFirestore(uid, freshToken);
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
                LocalDatabase.db.prepare('DELETE FROM favorites').run();
                const remoteFavorites = await loadFavoritesFromFirestore(uid, freshToken);
                if (remoteFavorites) {
                    for (const fav of remoteFavorites) {
                        LocalDatabase.db.prepare('INSERT OR IGNORE INTO favorites (card_name, section) VALUES (?, ?)')
                            .run(fav.card_name, fav.section);
                    }
                }
                clearFavoritesDirty();
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
    writeLog(section, name, 'update');
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
        const count = LocalDatabase.statements.getTagCount?.get(tag);
        if (count && count.count <= 1) {
            writeLog('tags', tag, 'delete');
        } else {
            writeLog('tags', tag, 'update');
        }
    }

    for (const tag of addedTags) {
        LocalDatabase.statements.addOrUpdateTag.run(tag, 1);
        writeLog('tags', tag, 'update');
    }

    writeLog(section, cardName, 'update');
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
    writeLog(section, data.name, 'update');

    // Добавляем теги
    if (data.tags && Array.isArray(data.tags) && data.tags.length > 0) {
        for (const tag of data.tags) {
            LocalDatabase.statements.addTagToCard.run(data.name, tag);
            LocalDatabase.statements.addOrUpdateTag.run(tag, 1);
            writeLog('tags', tag, 'update');
        }
        markTagsDirty();
    }

    // Сохраняем дату релиза, если передана
    if (data.releaseDate) {
        LocalDatabase.statements.setExpectedRelease.run(data.name, section, data.releaseDate, null);
        writeLog('expected_releases', data.name, 'update', section);
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
    writeLog(section, dataName, 'delete');
    // Удаляем связи тегов

    LocalDatabase.statements.clearCardTags.run(dataName);
    LocalDatabase.statements.deleteExpectedRelease.run(dataName, section);


    // Удаляем карточку
    const result = LocalDatabase.statements.deleteData.run(dataName, section);

    // Обновляем счётчики тегов
    for (const tag of tags) {
        LocalDatabase.statements.removeTagCount.run(tag);
        LocalDatabase.statements.deleteTagIfZero.run(tag);
        const count = LocalDatabase.statements.getTagCount?.get(tag);
        if (count && count.count <= 1) {
            writeLog('tags', tag, 'delete');
        } else {
            writeLog('tags', tag, 'update');
        }
    }
    LocalDatabase.statements.deleteFavoritesByCard.run(dataName, section);
    writeLog('expected_releases', dataName, 'update', section);
    markFavoritesDirty();

    markSectionDirty(section);
    markExpectedReleasesDirty();
    const now = new Date().toISOString();
    LocalDatabase.statements.setStatistic.run('last_firestore_update', now, now);

    return result;
});

// main.js

ipcMain.handle('move-to-category', async (event, data) => {
    const isFav = LocalDatabase.isFavorite(data.name, data.oldCategory);

    // 1. Добавляем карточку в новый раздел
    const result = LocalDatabase.statements.addData.run(
        data.name,
        data.newCategory,
        data.oldIcoUrl || null,
        data.oldRating || '0',
        data.oldStatus || 'Уточнить',
        data.oldDescription
    );

    // 2. Удаляем карточку из старого раздела
    LocalDatabase.statements.deleteData.run(data.name, data.oldCategory);

    // 3. ✅ ЛОГ КАРТОЧКИ (перемещение)
    writeLog(data.oldCategory, data.name, 'delete');
    writeLog(data.newCategory, data.name, 'update');

    // 4. ✅ ОБНОВЛЯЕМ expected_releases (меняем section)
    const existingRelease = LocalDatabase.statements.getExpectedRelease.get(data.name, data.oldCategory);
    if (existingRelease) {
        // Удаляем из старого раздела
        LocalDatabase.statements.deleteExpectedRelease.run(data.name, data.oldCategory);
        // Добавляем в новый раздел
        LocalDatabase.statements.setExpectedRelease.run(
            data.name,
            data.newCategory,
            existingRelease.release_date,
            existingRelease.last_notification_date
        );

        // ✅ ЛОГ ДАТЫ РЕЛИЗА
        writeLog('expected_releases', data.name, 'update', data.newCategory);
        markExpectedReleasesDirty();
    }

    // 5. Избранное
    if (isFav) {
        LocalDatabase.statements.updateFavoriteSection.run(
            data.newCategory,
            data.name,
            data.oldCategory
        );
        writeLog('favorites', data.name, 'update', data.newCategory);
        markFavoritesDirty();
    }

    markSectionDirty(data.newCategory);
    markSectionDirty(data.oldCategory);
    const now = new Date().toISOString();
    LocalDatabase.statements.setStatistic.run('last_firestore_update', now, now);

    return result;
});

ipcMain.handle('update-data', async (event, section, oldName, newName, newIcoUrl) => {
    const result = LocalDatabase.statements.updateData.run(newName, newIcoUrl, oldName, section);
    writeLog(section, newName, 'update');
    markSectionDirty(section);
    // Обновляем локальное время синхронизации
    const now = new Date().toISOString();
    LocalDatabase.statements.setStatistic.run('last_firestore_update', now, now);

    return result;
});

ipcMain.handle('update-data-rating', async (event, section, dataName, rating) => {
    const result = LocalDatabase.statements.updateDataRating.run(rating, dataName, section);
    writeLog(section, dataName, 'update');
    markSectionDirty(section);
    // Обновляем локальное время синхронизации
    const now = new Date().toISOString();
    LocalDatabase.statements.setStatistic.run('last_firestore_update', now, now);

    return result;
});

ipcMain.handle('update-data-status', async (event, section, dataName, status) => {
    const oldStatus = LocalDatabase.statements.getStatusByNameAndSection.get(dataName, section)?.status;
    const result = LocalDatabase.statements.updateDataStatus.run(status, dataName, section);
    writeLog(section, dataName, 'update');

    if ((status === 'Ожидается' || status === 'В процессе') && oldStatus !== status) {
        // Запускаем в фоне
        fetchCardData(dataName, section).then(cardData => {
            if (cardData.releaseDate) {
                LocalDatabase.statements.setExpectedRelease.run(dataName, section, cardData.releaseDate, null);
                writeLog('expected_releases', dataName, 'update', section);
                markExpectedReleasesDirty();
                if (win) {
                    win.webContents.send('release-date-updated', { cardName: dataName, section, releaseDate: cardData.releaseDate });
                }
            }
        }).catch(err => console.error('Failed to fetch release date:', err));
    } else if ((oldStatus === 'Ожидается' || oldStatus === 'В процессе') && status !== 'Ожидается' && status !== 'В процессе') {
        LocalDatabase.statements.deleteExpectedRelease.run(dataName, section);
        writeLog('expected_releases', dataName, 'delete', section);
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
        startBackgroundSync();
        sendSyncStatus('idle', 'Синхронизировано');

        saveUserSession(user.email, user.uid, idToken, refreshToken);



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
        startBackgroundSync();
        sendSyncStatus('idle', 'Синхронизировано');

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
        stopBackgroundSync();
        sendSyncStatus('idle', 'Не авторизован');
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
        writeLog('expected_releases', cardName, 'update', section);
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
    writeLog('expected_releases', cardName, 'delete', section);
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

ipcMain.handle('add-favorite', (event, cardName, section) => {
    const result = LocalDatabase.statements.addFavorite.run(cardName, section);
    writeLog('favorites', cardName, 'update', section);
    LocalDatabase.markFavoritesDirty();
    return result;
});

ipcMain.handle('remove-favorite', (event, cardName, section) => {
    const result = LocalDatabase.statements.removeFavorite.run(cardName, section);
    writeLog('favorites', cardName, 'delete', section);
    LocalDatabase.markFavoritesDirty();
    return result;
});

ipcMain.handle('is-favorite', (event, cardName, section) => {
    return LocalDatabase.isFavorite(cardName, section);
});

ipcMain.handle('get-favorites-by-section', (event, section) => {
    return LocalDatabase.getFavoritesBySection(section);
});

ipcMain.handle('sync-all-dirty', async () => {
    const storedUser = getStoredUser();
    if (!storedUser || !storedUser.is_authenticated || !storedUser.idToken) {
        return { success: false, error: 'Пользователь не авторизован' };
    }

    try {
        const freshToken = await getValidToken();
        if (!freshToken) {
            return { success: false, error: 'Сессия истекла, войдите заново' };
        }

        // Синхронизируем все dirty разделы
        //await syncDirtySections(storedUser.uid, freshToken);
        await performSync();
        return { success: true };
    } catch (error) {
        console.error('[Sync] Error:', error);
        return { success: false, error: error.message };
    }
});

ipcMain.handle('sync-all-dirty-with-progress', async (event) => {
    const storedUser = getStoredUser();
    if (!storedUser || !storedUser.is_authenticated || !storedUser.idToken) {
        return { success: false, error: 'Пользователь не авторизован' };
    }

    try {
        const freshToken = await getValidToken();
        if (!freshToken) {
            return { success: false, error: 'Сессия истекла, войдите заново' };
        }

        const sections = ['games', 'movies', 'books', 'serials', 'anime', 'cartoons'];

        // Считаем реальное количество шагов
        let totalSteps = sections.length; // карточки
        if (isTagsDirty()) totalSteps++;
        if (isFavoritesDirty()) totalSteps++;

        const dirtyExpectedReleases = LocalDatabase.statements.isExpectedReleasesDirty.get('dirty_expected_releases');
        if (dirtyExpectedReleases && dirtyExpectedReleases.value === 'true') totalSteps++;

        if (totalSteps === 0) {
            event.sender.send('sync-progress', { percent: 100, status: 'Ничего не изменилось' });
            await new Promise(r => setTimeout(r, 300));
            return { success: true };
        }

        let completedSteps = 0;

        const sendProgress = (step, total, status) => {
            const percent = Math.round((step / total) * 100);
            event.sender.send('sync-progress', { percent, status });
        };

        sendProgress(completedSteps, totalSteps, 'Начинаем синхронизацию...');
        await new Promise(r => setTimeout(r, 100));

        // ✅ 1. Получаем ВСЮ мету ОДНИМ ЗАПРОСОМ
        const allMeta = await getMeta(storedUser.uid, freshToken);

        // ✅ 2. Синхронизируем карточки (с логами)
        for (const section of sections) {
            const sectionMeta = allMeta[section]?.stringValue || null;
            await syncSection(storedUser.uid, freshToken, section, sectionMeta);
            completedSteps++;
            sendProgress(completedSteps, totalSteps, `Сохранение раздела: ${section}`);
            await new Promise(r => setTimeout(r, 50));
        }

        // ✅ 3. Теги
        if (isTagsDirty()) {
            sendProgress(completedSteps, totalSteps, 'Сохранение тегов...');
            await syncTags(storedUser.uid, freshToken, allMeta);
            completedSteps++;
            await new Promise(r => setTimeout(r, 50));
        }

        // ✅ 4. Ожидаемые релизы
        if (dirtyExpectedReleases && dirtyExpectedReleases.value === 'true') {
            sendProgress(completedSteps, totalSteps, 'Сохранение дат релизов...');
            await syncExpectedReleases(storedUser.uid, freshToken, allMeta);
            completedSteps++;
            await new Promise(r => setTimeout(r, 50));
        }

        // ✅ 5. Избранное
        if (isFavoritesDirty()) {
            sendProgress(completedSteps, totalSteps, 'Сохранение избранного...');
            await syncFavorites(storedUser.uid, freshToken, allMeta);
            completedSteps++;
            await new Promise(r => setTimeout(r, 50));
        }

        // ✅ 6. Обновляем время синхронизации
        sendProgress(completedSteps, totalSteps, 'Завершение...');
        const now = new Date().toISOString();
        await updateSyncTime(storedUser.uid, freshToken, now);
        LocalDatabase.statements.setStatistic.run('last_firestore_update', now, now);

        sendProgress(totalSteps, totalSteps, 'Готово!');
        await new Promise(r => setTimeout(r, 300));

        return { success: true };

    } catch (error) {
        console.error('[Sync] Error:', error);
        event.sender.send('sync-progress', {
            percent: 100,
            status: '❌ Ошибка: ' + error.message
        });
        return { success: false, error: error.message };
    }
});

let syncInterval = null;
let isSyncing = false;
let consecutiveErrors = 0;
let hasChanges = false;
let isAppFocused = true;

function sendSyncStatus(status, message = '') {
    if (win && !win.isDestroyed()) {
        win.webContents.send('sync-status', { status, message, timestamp: Date.now() });
    }
}

function hasDirtyData() {
    const sections = ['games', 'movies', 'cartoons', 'serials', 'anime', 'books'];
    for (const section of sections) {
        if (LocalDatabase.isSectionDirty(section)) return true;
    }
    if (LocalDatabase.isTagsDirty()) return true;
    if (LocalDatabase.isFavoritesDirty()) return true;
    return false;
}

function markChanges() {
    hasChanges = true;
}

function getSyncInterval() {
    // Ошибки — увеличиваем
    if (consecutiveErrors > 0) {
        return Math.min(60000 * Math.pow(2, consecutiveErrors - 1), 300000);
    }

    // Есть изменения — чаще
    if (hasChanges || hasDirtyData()) {
        return 5 * 60 * 1000;
    }

    // Нет изменений — реже
    return 10 * 60 * 1000;
}

async function performSync() {
    if (isSyncing) return;

    const storedUser = getStoredUser();
    if (!storedUser?.is_authenticated) {
        sendSyncStatus('idle', 'Не авторизован');
        return;
    }

    isSyncing = true;

    try {
        const freshToken = await getValidToken();
        if (!freshToken) {
            consecutiveErrors++;
            sendSyncStatus('error', 'Сессия истекла');
            return;
        }

        sendSyncStatus('syncing', 'Синхронизация...');

        const allMeta = await getMeta(storedUser.uid, freshToken);
        // ✅ 1. КАРТОЧКИ (с логами)
        await syncAllSectionsWithLogs(storedUser.uid, freshToken, allMeta);

        // ✅ 2. ТЕГИ
        await syncTags(storedUser.uid, freshToken, allMeta);

        // ✅ 3. ДАТЫ РЕЛИЗА
        await syncExpectedReleases(storedUser.uid, freshToken, allMeta);

        // ✅ 4. ИЗБРАННОЕ
        await syncFavorites(storedUser.uid, freshToken, allMeta);

        consecutiveErrors = 0;
        hasChanges = false;
        sendSyncStatus('success', 'Сохранено ✓');

    } catch (error) {
        console.error('[Sync] Error:', error);
        consecutiveErrors++;
        sendSyncStatus('error', 'Ошибка');
    } finally {
        isSyncing = false;
    }
}

function startBackgroundSync() {
    if (syncInterval) return;

    console.log('[Sync] Starting');
    setTimeout(performSync, 5000);

    const interval = getSyncInterval();
    syncInterval = setInterval(performSync, interval);
    console.log(`[Sync] Interval: ${interval}ms`);
}

function stopBackgroundSync() {
    if (syncInterval) {
        clearInterval(syncInterval);
        syncInterval = null;
        console.log('[Sync] Stopped');
    }
}

win?.on('blur', () => {
    isAppFocused = false;
    setTimeout(() => {
        if (!isAppFocused && syncInterval) {
            clearInterval(syncInterval);
            syncInterval = setInterval(performSync, 15 * 60 * 1000);
            console.log('[Sync] Interval: 5min (background)');
        }
    }, 5000);
});

win?.on('focus', () => {
    isAppFocused = true;
    if (syncInterval) {
        clearInterval(syncInterval);
        const interval = getSyncInterval();
        syncInterval = setInterval(performSync, interval);
        console.log(`[Sync] Interval: ${interval}ms (restored)`);
    }
});

ipcMain.handle('auth-reset-password', async (event, email) => {
    try {
        if (!email || !email.trim()) {
            return { success: false, error: 'Введите email' };
        }

        await sendPasswordResetEmail(auth, email.trim());
        console.log(`[i] Password reset email sent to: ${email}`);

        return {
            success: true,
            message: 'Письмо для сброса пароля отправлено на указанный email'
        };

    } catch (error) {
        console.error('[x] Password reset error:', error);

        let errorMessage;
        switch (error.code) {
            case 'auth/user-not-found':
                errorMessage = 'Пользователь с таким email не найден';
                break;
            case 'auth/invalid-email':
                errorMessage = 'Неверный формат email';
                break;
            case 'auth/too-many-requests':
                errorMessage = 'Слишком много запросов. Попробуйте позже';
                break;
            default:
                errorMessage = 'Ошибка при отправке письма: ' + error.message;
        }

        return { success: false, error: errorMessage };
    }
});

async function syncAllSectionsWithLogs(uid, idToken, allMeta) {
    const sections = ['games', 'movies', 'books', 'serials', 'anime', 'cartoons'];

    for (const section of sections) {
        const sectionMeta = allMeta[section]?.stringValue || null;
        await syncSection(uid, idToken, section, sectionMeta);
    }

    console.log('All sections synced with logs');
}

async function syncSection(uid, idToken, section, remoteUpdatedAt) {
    try {
        console.log(`🔄 Syncing ${section}...`);

        // 1. Получаем мету
        const remoteMeta = { _updatedAt: remoteUpdatedAt };
        const localUpdatedAt = getLocalUpdatedAt(section);

        // 2. Если в облаке ничего нет → отправляем локальные
        if (remoteMeta._updatedAt === null) {
            console.log(`📤 No remote data for ${section}, creating...`);
            const localData = getAllCardsBySection(section);
            await saveSectionToFirestore(uid, idToken, section, localData);
            const now = new Date().toISOString();
            await updateMeta(uid, idToken, section, now);
            updateLocalUpdatedAt(section, now);
            clearLogs(section);
            return;
        }

        const remoteTime = new Date(remoteMeta._updatedAt);
        const localTime = localUpdatedAt ? new Date(localUpdatedAt) : null;

        // 3. Если время одинаковое → ничего не делаем
        if (localTime && remoteTime.getTime() === localTime.getTime()) {
            console.log(`✅ ${section} is in sync`);
            return;
        }

        // 4. Если НЕ ГРЯЗНЫЙ → просто забираем из облака
        if (!isSectionDirty(section)) {
            console.log(`📥 Pulling ${section} (clean, remote newer)...`);

            const remoteData = await getSectionFromFirestore(uid, idToken, section);
            saveLocalCardsData(section, remoteData);
            updateLocalUpdatedAt(section, remoteMeta._updatedAt);

            console.log(`✅ ${section} pulled (clean)`);
            return;
        }

        // 5. ГРЯЗНЫЙ → мержим
        console.log(`Pulling ${section} (dirty, merging with logs)...`);

        const remoteData = await getSectionFromFirestore(uid, idToken, section);
        const localLogs = getLogs(section);

        let mergedData = remoteData || [];

        // Применяем логи (update/delete для карточек)
        for (const log of localLogs) {
            const logTime = new Date(log.date);

            // Применяем только логи, которые новее облачных данных
            if (logTime > remoteTime) {
                const localCard = getCardByNameAndSection(section, log.entity_name);
                switch (log.action) {
                    case 'update': {
                        if (localCard) {
                            const exists = mergedData.some(c => c.name === log.entity_name);
                            if (exists) {
                                const index = mergedData.findIndex(c => c.name === log.entity_name);
                                mergedData[index] = localCard;
                            } else {
                                mergedData.push(localCard);
                            }
                        }
                        break;
                    }
                    case 'delete': {
                        mergedData = mergedData.filter(c => c.name !== log.entity_name);
                        break;
                    }
                }
            }
        }
        // ✅ СОХРАНЯЕМ ЛОКАЛЬНО
        saveLocalCardsData(section, mergedData);

        // ✅ ОБНОВЛЯЕМ ЛОКАЛЬНОЕ ВРЕМЯ
        const now = new Date().toISOString();
        updateLocalUpdatedAt(section, now);

        // ✅ ОЧИЩАЕМ ЛОГИ
        clearLogs(section);

        // ✅ ОТПРАВЛЯЕМ В ОБЛАКО
        await saveSectionToFirestore(uid, idToken, section, mergedData);
        await updateMeta(uid, idToken, section, now);
        clearSectionDirty(section);
        console.log(`✅ ${section} pulled and merged (dirty)`);
        return;

    } catch (error) {
        console.error(`❌ Sync error for ${section}:`, error);
    }
}

async function syncTags(uid, idToken, allMeta) {
    const section = 'tags';

    try {
        console.log(`Syncing ${section}...`);

        // 1. Получаем мету
        const remoteUpdatedAt = allMeta[section]?.stringValue || null;
        const remoteMeta = { _updatedAt: remoteUpdatedAt };
        const localUpdatedAt = getLocalUpdatedAt(section);

        // 2. Если в облаке ничего нет → отправляем локальные
        if (remoteMeta._updatedAt === null) {
            console.log(`No remote data for ${section}, pushing...`);
            const localData = getAllTagsLocal();
            await saveSectionToFirestore(uid, idToken, section, localData);
            const now = new Date().toISOString();
            await updateMeta(uid, idToken, section, now);
            updateLocalUpdatedAt(section, now);
            clearLogs(section);
            clearTagsDirty();
            return;
        }

        const remoteTime = new Date(remoteMeta._updatedAt);
        const localTime = localUpdatedAt ? new Date(localUpdatedAt) : null;

        // 3. Если время одинаковое → ничего не делаем
        if (localTime && remoteTime.getTime() === localTime.getTime()) {
            console.log(`${section} is in sync`);
            return;
        }

        // 4. Если НЕ ГРЯЗНЫЙ → просто забираем из облака
        if (!isTagsDirty()) {
            console.log(`Pulling ${section} (clean, remote newer)...`);

            const remoteData = await getSectionFromFirestore(uid, idToken, section);
            saveLocalTagsData(remoteData);
            updateLocalUpdatedAt(section, remoteMeta._updatedAt);

            console.log(`✅ ${section} pulled (clean)`);
            return;
        }

        // 5. ГРЯЗНЫЙ → мержим
        console.log(`Pulling ${section} (dirty, merging with logs)...`);

        const remoteData = await getSectionFromFirestore(uid, idToken, section);
        const localLogs = getLogs(section);

        let mergedData = remoteData || [];

        // Применяем логи (update/delete для тегов)
        for (const log of localLogs) {
            const logTime = new Date(log.date);

            // Применяем только логи, которые новее облачных данных
            if (logTime > remoteTime) {
                switch (log.action) {
                    case 'update': {
                        const localTag = getTagByName(log.entity_name);
                        if (localTag) {
                            const exists = mergedData.some(t => t.name === log.entity_name);
                            if (exists) {
                                const index = mergedData.findIndex(t => t.name === log.entity_name);
                                mergedData[index] = localTag;
                            } else {
                                mergedData.push(localTag);
                            }
                        }
                        break;
                    }
                    case 'delete': {
                        mergedData = mergedData.filter(t => t.name !== log.entity_name);
                        break;
                    }
                }
            }
        }

        // ✅ СОХРАНЯЕМ ЛОКАЛЬНО
        saveLocalTagsData(mergedData);

        // ✅ ОБНОВЛЯЕМ ЛОКАЛЬНОЕ ВРЕМЯ
        const now = new Date().toISOString();
        updateLocalUpdatedAt(section, now);

        // ✅ ОЧИЩАЕМ ЛОГИ И DIRTY
        clearLogs(section);
        clearTagsDirty();

        // ✅ ОТПРАВЛЯЕМ В ОБЛАКО (чтобы другие устройства получили обновлённые данные)
        await saveSectionToFirestore(uid, idToken, section, mergedData);
        await updateMeta(uid, idToken, section, now);

        console.log(`✅ ${section} pulled and merged (dirty)`);
        return;

    } catch (error) {
        console.error(`❌ Sync error for ${section}:`, error);
    }
}

async function syncExpectedReleases(uid, idToken, allMeta) {
    const section = 'expected_releases';

    try {
        console.log(`🔄 Syncing ${section}...`);

        const remoteUpdatedAt = allMeta[section]?.stringValue || null;
        const remoteMeta = { _updatedAt: remoteUpdatedAt };
        const localUpdatedAt = getLocalUpdatedAt(section);

        if (remoteMeta._updatedAt === null) {
            console.log(`📤 No remote data for ${section}, pushing...`);
            const localData = getAllExpectedReleasesLocal();
            await saveSectionToFirestore(uid, idToken, section, localData);
            const now = new Date().toISOString();
            await updateMeta(uid, idToken, section, now);
            updateLocalUpdatedAt(section, now);
            clearLogs(section);
            clearExpectedReleasesDirty();
            return;
        }

        const remoteTime = new Date(remoteMeta._updatedAt);
        const localTime = localUpdatedAt ? new Date(localUpdatedAt) : null;

        if (localTime && remoteTime.getTime() === localTime.getTime()) {
            console.log(`✅ ${section} is in sync`);
            return;
        }

        // НЕ ГРЯЗНЫЙ → просто забираем
        if (!isExpectedReleasesDirty()) {
            console.log(`📥 Pulling ${section} (clean, remote newer)...`);

            const remoteData = await getSectionFromFirestore(uid, idToken, section);
            // ✅ СОХРАНЯЕМ ЛОКАЛЬНО
            saveLocalExpectedReleasesData(remoteData);
            updateLocalUpdatedAt(section, remoteMeta._updatedAt);

            console.log(`✅ ${section} pulled (clean)`);
            return;
        }

        // ГРЯЗНЫЙ → мержим
        console.log(`📥 Pulling ${section} (dirty, merging with logs)...`);

        const remoteData = await getSectionFromFirestore(uid, idToken, section);
        const localLogs = getLogs(section);

        let mergedData = remoteData || [];

        for (const log of localLogs) {
            const logTime = new Date(log.date);

            if (logTime > remoteTime) {
                if (log.section !== 'expected_releases') continue;

                // ✅ Используем entity_section из лога
                const cardSection = log.entity_section || 'games';
                const cardName = log.entity_name;

                switch (log.action) {
                    case 'update': {
                        // ✅ Ищем по card_name и section
                        const localRelease = getExpectedReleaseByNameAndSection(cardName, cardSection);
                        if (localRelease) {
                            const exists = mergedData.some(r => r.card_name === cardName && r.section === cardSection);
                            if (exists) {
                                const index = mergedData.findIndex(r => r.card_name === cardName && r.section === cardSection);
                                mergedData[index] = localRelease;
                            } else {
                                mergedData.push(localRelease);
                            }
                        }
                        break;
                    }
                    case 'delete': {
                        mergedData = mergedData.filter(r => r.card_name !== cardName || r.section !== cardSection);
                        break;
                    }
                }
            }
        }

        // ✅ СОХРАНЯЕМ ЛОКАЛЬНО
        saveLocalExpectedReleasesData(mergedData);

        // ✅ ОБНОВЛЯЕМ ЛОКАЛЬНОЕ ВРЕМЯ
        const now = new Date().toISOString();
        updateLocalUpdatedAt(section, now);

        // ✅ ОЧИЩАЕМ ЛОГИ И DIRTY
        clearLogs(section);
        clearExpectedReleasesDirty();

        // ✅ ОТПРАВЛЯЕМ В ОБЛАКО
        await saveSectionToFirestore(uid, idToken, section, mergedData);
        await updateMeta(uid, idToken, section, now);

        console.log(`✅ ${section} pulled and merged (dirty)`);
        return;

    } catch (error) {
        console.error(`❌ Sync error for ${section}:`, error);
    }
}

async function syncFavorites(uid, idToken, allMeta) {
    const section = 'favorites';

    try {
        console.log(`🔄 Syncing ${section}...`);

        const remoteUpdatedAt = allMeta[section]?.stringValue || null;
        const remoteMeta = { _updatedAt: remoteUpdatedAt };
        const localUpdatedAt = getLocalUpdatedAt(section);

        if (remoteMeta._updatedAt === null) {
            console.log(`📤 No remote data for ${section}, pushing...`);
            const localData = getAllFavoritesLocal();
            await saveSectionToFirestore(uid, idToken, section, localData);
            const now = new Date().toISOString();
            await updateMeta(uid, idToken, section, now);
            updateLocalUpdatedAt(section, now);
            clearLogs(section);
            clearFavoritesDirty();
            return;
        }

        const remoteTime = new Date(remoteMeta._updatedAt);
        const localTime = localUpdatedAt ? new Date(localUpdatedAt) : null;

        if (localTime && remoteTime.getTime() === localTime.getTime()) {
            console.log(`✅ ${section} is in sync`);
            return;
        }

        // НЕ ГРЯЗНЫЙ → просто забираем
        if (!isFavoritesDirty()) {
            console.log(`📥 Pulling ${section} (clean, remote newer)...`);

            const remoteData = await getSectionFromFirestore(uid, idToken, section);
            // ✅ СОХРАНЯЕМ ЛОКАЛЬНО
            saveLocalFavoritesData(remoteData);
            updateLocalUpdatedAt(section, remoteMeta._updatedAt);

            console.log(`✅ ${section} pulled (clean)`);
            return;
        }

        // ГРЯЗНЫЙ → мержим
        console.log(`📥 Pulling ${section} (dirty, merging with logs)...`);

        const remoteData = await getSectionFromFirestore(uid, idToken, section);
        const localLogs = getLogs(section);

        let mergedData = remoteData || [];

        for (const log of localLogs) {
            const logTime = new Date(log.date);

            if (logTime > remoteTime) {
                if (log.section !== 'favorites') continue;

                // ✅ Используем entity_section из лога
                const cardSection = log.entity_section || 'games'; // fallback
                const cardName = log.entity_name;

                switch (log.action) {
                    case 'update': {
                        const exists = mergedData.some(f => f.card_name === cardName && f.section === cardSection);
                        if (!exists) {
                            mergedData.push({
                                card_name: cardName,
                                section: cardSection
                            });
                        }
                        break;
                    }
                    case 'delete': {
                        mergedData = mergedData.filter(f => f.card_name !== cardName || f.section !== cardSection);
                        break;
                    }
                }
            }
        }
        console.log(mergedData);

        // ✅ СОХРАНЯЕМ ЛОКАЛЬНО
        saveLocalFavoritesData(mergedData);

        // ✅ ОБНОВЛЯЕМ ЛОКАЛЬНОЕ ВРЕМЯ
        const now = new Date().toISOString();
        updateLocalUpdatedAt(section, now);

        // ✅ ОЧИЩАЕМ ЛОГИ И DIRTY
        clearLogs(section);
        clearFavoritesDirty();

        // ✅ ОТПРАВЛЯЕМ В ОБЛАКО
        await saveSectionToFirestore(uid, idToken, section, mergedData);
        await updateMeta(uid, idToken, section, now);

        console.log(`✅ ${section} pulled and merged (dirty)`);
        return;

    } catch (error) {
        console.error(`❌ Sync error for ${section}:`, error);
    }
}