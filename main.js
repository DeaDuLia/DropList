const { app, BrowserWindow, ipcMain, shell } = require('electron');
const { dialog } = require('electron');
const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');
const https = require('https');
const { autoUpdater } = require('electron-updater');
const log = require('electron-log');
const { initializeApp } = require('firebase/app');
const { getAuth, signInWithEmailAndPassword, createUserWithEmailAndPassword, signOut } = require('firebase/auth');
const { getFirestore, doc, setDoc, getDoc } = require('firebase/firestore');

const userDataPath = app.getPath('userData');
const dbPath = path.join(userDataPath, 'database.db');
autoUpdater.logger = log;
autoUpdater.logger.transports.file.level = 'info';

const firebaseConfig = {
    apiKey: "AIzaSyALdaI9VkFIkN_gTTJKohahnAcdZqCxgRQ",
    authDomain: "droplist-3fa8b.firebaseapp.com",
    projectId: "droplist-3fa8b",
    storageBucket: "droplist-3fa8b.firebasestorage.app",
    messagingSenderId: "920691108684",
    appId: "1:920691108684:web:c06a303e820e311c8a3de9"
};

const firebaseApp = initializeApp(firebaseConfig);
const auth = getAuth(firebaseApp);
const db_firestore = getFirestore(firebaseApp);


const DEFAULT_USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
let activeParsingWindows = new Set();
function closeAllParsingWindows() {
    console.log(`[Parsing] Closing ${activeParsingWindows.size} windows`);
    for (const win of activeParsingWindows) {
        if (win && !win.isDestroyed()) {
            try {
                if (win.webContents && !win.webContents.isDestroyed()) {
                    win.webContents.stop();
                    win.webContents.removeAllListeners();
                    win.webContents.session.clearStorageData({
                        storages: ['cookies', 'localstorage', 'sessionstorage'],
                        quotas: ['temporary']
                    }).catch(e => console.log('Storage clear error:', e));
                }
                win.removeAllListeners();
                win.close();
            } catch (error) {
                console.error('[Parsing] Error closing window:', error);
            }
        }
    }
    activeParsingWindows.clear();
}

function destroyWindowCompletely(win) {
    if (!win || win.isDestroyed()) return;

    try {
        // 1. Останавливаем загрузку
        if (win.webContents && !win.webContents.isDestroyed()) {
            win.webContents.stop();

            // 2. Очищаем сессию ПРИНУДИТЕЛЬНО
            win.webContents.session.clearStorageData({
                storages: ['cookies', 'localstorage', 'sessionstorage', 'cache']
            });

            // 3. Сброс HTTP/2 соединений
            win.webContents.session.closeAllConnections?.(); // Electron 22+

            // 4. Отключаем кеш и keep-alive
            win.webContents.session.webRequest.onBeforeSendHeaders((details, callback) => {
                details.requestHeaders['Connection'] = 'close'; // force close
                details.requestHeaders['Cache-Control'] = 'no-cache, no-store';
                callback({ requestHeaders: details.requestHeaders });
            });
        }

        // 5. Жёсткое уничтожение
        win.destroy();

    } catch (error) {
        console.error('Destroy error:', error);
    }
}

// Функция добавления окна в отслеживаемые
function trackParsingWindow(win) {
    activeParsingWindows.add(win);
    win.once('closed', () => {
        activeParsingWindows.delete(win);
    });
}

app.name = 'DropList';
app.setName('DropList');
if (process.platform === 'win32') {
    app.setAppUserModelId('com.deshin.droplist');
}

function getAllLocalData() {
    const sections = ['games', 'movies', 'cartoons', 'serials', 'anime', 'books'];
    const allData = {};

    for (const section of sections) {
        allData[section] = statements.getDataBySection.all(section);
    }

    return allData;
}

function saveAllLocalData(allData) {
    const sections = ['games', 'movies', 'cartoons', 'serials', 'anime', 'books'];

    const transaction = db.transaction(() => {
        // Очищаем tags_assign перед удалением карточек
        db.prepare(`DELETE FROM tags_assign`).run();

        // Очищаем таблицу tags (счётчики тегов)
        db.prepare(`DELETE FROM tags`).run();

        for (const section of sections) {
            db.prepare(`DELETE FROM data_cards WHERE section = ?`).run(section);
        }

        for (const [section, items] of Object.entries(allData)) {
            if (items && Array.isArray(items)) {
                for (const item of items) {
                    statements.importData.run(
                        item.name, section, item.icoUrl || null,
                        item.rating || '0', item.status || 'Уточнить', item.description || ''
                    );

                    // Добавляем теги для карточки
                    if (item.tags && Array.isArray(item.tags)) {
                        for (const tag of item.tags) {
                            statements.addTagToCard.run(item.name, tag);
                            statements.addOrUpdateTag.run(tag);
                        }
                    }
                }
            }
        }
    });

    transaction();
}

async function syncUserData(uid, idToken, email) {
    try {
        const localLastSync = statements.getStatistic.get('last_firestore_update');
        const localSyncTime = localLastSync ? localLastSync.value : null;

        const remoteSyncTime = await getSyncTime(uid, idToken);

        if (!remoteSyncTime) {
            const localData = getAllLocalData();
            const sections = ['games', 'movies', 'cartoons', 'serials', 'anime', 'books'];
            for (const section of sections) {
                await saveSectionToFirestore(uid, idToken, section, localData[section] || []);
            }
            await saveAllTagsToFirestore();
            const now = new Date().toISOString();
            await updateSyncTime(uid, idToken, now);
            statements.setStatistic.run('last_firestore_update', now, now);
            return { action: 'local_to_cloud', success: true };
        }

        // Сравниваем времена
        const localTime = localSyncTime ? new Date(localSyncTime) : null;
        const remoteTime = new Date(remoteSyncTime);

        if (localTime && Math.abs(localTime - remoteTime) < 5000) {
            console.log('[+] Data synced');
            return { action: 'synced', success: true };
        }

        // Конфликт — загружаем все данные для выбора
        const localData = getAllLocalData();
        const sections = ['games', 'movies', 'cartoons', 'serials', 'anime', 'books'];
        const remoteData = {};

        for (const section of sections) {
            remoteData[section] = await getSectionFromFirestore(uid, idToken, section);
        }

        return {
            success: true,
            needChoice: true,
            localData: localData,
            remoteData: remoteData,
            localSyncTime: localSyncTime,
            remoteSyncTime: remoteSyncTime
        };

    } catch (error) {
        console.error('Sync error:', error);
        return { success: false, error: error.message };
    }
}

// Применить выбор пользователя
async function applySyncChoice(uid, idToken, choice, localData, remoteData) {
    try {
        const freshToken = await getValidToken();
        if (!freshToken) {
            return { success: false, error: 'No valid token' };
        }
        const now = new Date().toISOString();

        if (choice === 'local') {
            // Сохраняем все локальные разделы в Firestore
            const sections = ['games', 'movies', 'cartoons', 'serials', 'anime', 'books'];
            for (const section of sections) {
                await saveSectionToFirestore(uid, freshToken, section, localData[section] || []);
            }
            await saveAllTagsToFirestore(uid, freshToken);
            await saveExpectedReleasesToFirestore(uid, freshToken);
            const localLastSync = statements.getStatistic.get('last_firestore_update');
            const localSyncTime = localLastSync ? localLastSync.value : null;
            await updateSyncTime(uid, freshToken, localSyncTime);
            return { success: true, source: 'local' };

        } else if (choice === 'remote') {
            saveAllLocalData(remoteData);
            const remoteTags = await loadAllTagsFromFirestore(uid, freshToken);
            if (remoteTags) {
                db.prepare('DELETE FROM tags').run();
                for (const tag of remoteTags) {
                    db.prepare('INSERT INTO tags (name, count) VALUES (?, ?)').run(tag.name, tag.count);
                }
                clearTagsDirty();
            }
            const remoteReleases = await loadExpectedReleasesFromFirestore(uid, freshToken);
            if (remoteReleases) {
                statements.replaceAllExpectedReleases.run();
                for (const release of remoteReleases) {
                    statements.setExpectedRelease.run(
                        release.card_name,
                        release.section,
                        release.release_date,
                        release.last_notification_date
                    );
                }
                clearExpectedReleasesDirty();

                const remoteSyncTime = await getSyncTime(uid, freshToken);
                statements.setStatistic.run('last_firestore_update', remoteSyncTime, remoteSyncTime);
                return {success: true, source: 'remote'};
            }
        }
        return { success: false, error: 'Неверный выбор' };
    } catch (error) {
        console.error('Apply sync error:', error);
        return { success: false, error: error.message };
    }
}

async function checkForUpdates(manualCheck = false) {
    const win = BrowserWindow.getFocusedWindow();

    try {
        // Получаем информацию о пропущенных версиях
        const skippedVersion = statements.getStatistic.get('skipped_version');
        const lastCheck = statements.getStatistic.get('last_update_check');


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
        statements.setStatistic.run(
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
    statements.setStatistic.run(
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
function initializeDatabase(db) {
    db.exec(`
        CREATE TABLE IF NOT EXISTS user_session (
            id INTEGER PRIMARY KEY CHECK (id = 1),
            email TEXT,
            uid TEXT,
            id_token TEXT,
            refresh_token TEXT,  -- 👈 ДОБАВЛЯЕМ
            is_authenticated INTEGER DEFAULT 0,
            last_login DATETIME
        )
    `);

    db.exec(`
        CREATE TABLE IF NOT EXISTS ratings (
            rating TEXT PRIMARY KEY
        )
    `);
    db.exec(`
  INSERT OR IGNORE INTO ratings (rating) VALUES
      ('5'),
      ('4'),
      ('3'),
      ('2'),
      ('1'),
      ('0'),
      ('-1'),
      ('-2'),
      ('-3'),
      ('-4'),
      ('-5')
  `);
    db.exec(`
        CREATE TABLE IF NOT EXISTS statuses (
            status TEXT PRIMARY KEY
        )
    `);
    db.exec(`
        INSERT OR IGNORE INTO statuses (status)
        VALUES
        ('Уточнить'),
        ('Смотрел'),
        ('В планах'),
        ('В процессе'),
        ('Завершено'),
        ('Избранное'),
        ('Ожидается'),
        ('Импортировано')
    `);
    db.exec(`
        CREATE TABLE IF NOT EXISTS sections (
            section_name TEXT PRIMARY KEY,
            section_icon TEXT
        )
    `);
    db.exec(`
        INSERT OR IGNORE INTO sections (section_name, section_icon)
        VALUES
        ('games', '🎮'),
        ('movies', '🎬'),
        ('cartoons', '🎥'),
        ('serials', '📺'),
        ('anime', '🌸'),
        ('books', '📚')
    `);

    db.exec(`
        CREATE TABLE IF NOT EXISTS data_cards (
            name TEXT PRIMARY KEY,
            section TEXT NOT NULL,
            ico_url TEXT,
            rating TEXT,
            status TEXT,
            description TEXT,
            FOREIGN KEY (rating) REFERENCES ratings (rating),
            FOREIGN KEY (status) REFERENCES statuses (status),
            FOREIGN KEY (section) REFERENCES sections (section_name)
        )
    `);
    db.exec(`
        CREATE TABLE IF NOT EXISTS tags_assign (
            card_name TEXT,
            tag_name TEXT,
            PRIMARY KEY (card_name, tag_name),
            FOREIGN KEY (card_name) REFERENCES data_cards (name)
        )
    `);
    db.exec(`
        CREATE TABLE IF NOT EXISTS tags (
            name TEXT PRIMARY KEY,
            count INTEGER DEFAULT 1
        )
    `);
    db.exec(`
        CREATE TABLE IF NOT EXISTS app_statistics (
            info TEXT PRIMARY KEY,
            value TEXT,
            actual_date DATETIME NOT NULL
        )
    `);
    db.exec(`
        CREATE TABLE IF NOT EXISTS expected_releases (
            card_name TEXT,
            section TEXT,
            release_date TEXT NOT NULL,
            last_notification_date TEXT,
            PRIMARY KEY (card_name, section)
        )
    `);
}

function saveUserSession(email, uid, idToken, refreshToken) {
    const stmt = db.prepare(`
        INSERT OR REPLACE INTO user_session (id, email, uid, id_token, refresh_token, is_authenticated, last_login)
        VALUES (1, ?, ?, ?, ?, 1, datetime('now'))
    `);
    stmt.run(email, uid, idToken, refreshToken);
    console.log('[i] Session saved with tokens');
}

function clearUserSession() {
    const stmt = db.prepare(`
        UPDATE user_session 
        SET is_authenticated = 0, email = NULL, uid = NULL, id_token = NULL, last_login = NULL 
        WHERE id = 1
    `);
    stmt.run();
    console.log('[i] Session cleared');
}

function getStoredUser() {
    const stmt = db.prepare(`SELECT email, uid, id_token, refresh_token, is_authenticated FROM user_session WHERE id = 1`);
    return stmt.get();
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

const db = new Database(dbPath, {
    timeout: 5000 // увеличить таймаут ожидания
});
db.pragma('journal_mode = WAL');
initializeDatabase(db);

const statements = {
    //Общее
    getRatings: db.prepare('SELECT rating FROM ratings'),
    getStatuses: db.prepare('SELECT status FROM statuses'),
    getStatusesNoImport: db.prepare(`SELECT status FROM statuses where status <> 'Импортировано'`),
    importData: db.prepare(`
        INSERT OR IGNORE INTO data_cards 
        (name, section, ico_url, rating, status, description) 
        VALUES (?, ?, ?, ?, ?, ?)`),
    getDataBySection: db.prepare(`
    SELECT 
            name, 
            ico_url as icoUrl, 
            rating, 
            status, 
            description,
            (SELECT GROUP_CONCAT(tag_name, ',') FROM tags_assign WHERE card_name = data_cards.name) as tags
        FROM data_cards 
        WHERE section = ?
    `),
    getStatusByNameAndSection: db.prepare(`
        SELECT status FROM data_cards WHERE name = ? AND section = ?
    `),
    addData: db.prepare(`
        INSERT OR REPLACE INTO data_cards 
        (name, section, ico_url, rating, status, description) 
        VALUES (?, ?, ?, ?, ?, ?)`),
    deleteData: db.prepare('DELETE FROM data_cards WHERE name = ? and section = ?'),
    updateSection: db.prepare('UPDATE data_cards SET section = ? WHERE name = ? and section = ?'),
    updateData: db.prepare('UPDATE data_cards SET name = ?, ico_url = ? WHERE name = ? and section = ?'),
    updateDataRating: db.prepare('UPDATE data_cards SET rating = ? WHERE name = ? and section = ?'),
    updateDataStatus: db.prepare('UPDATE data_cards SET status = ? WHERE name = ? and section = ?'),
    getDataCount: db.prepare('select count(*) as allCount from data_cards WHERE name = ? and section = ?'),
    getStatistic: db.prepare('SELECT value, actual_date FROM app_statistics WHERE info = ?'),
    setStatistic: db.prepare(`
        INSERT OR REPLACE INTO app_statistics (info, value, actual_date) 
        VALUES (?, ?, ?)
    `),
    deleteStatistic: db.prepare('DELETE FROM app_statistics WHERE info = ?'),
    getAllStatistics: db.prepare('SELECT info, value, actual_date FROM app_statistics'),
    getAllTags: db.prepare('SELECT name, count FROM tags ORDER BY count DESC'),
    addOrUpdateTag: db.prepare(`
        INSERT INTO tags (name, count) VALUES (?, 1)
        ON CONFLICT(name) DO UPDATE SET count = count + 1
    `),
    removeTagCount: db.prepare(`
        UPDATE tags SET count = count - 1 WHERE name = ?
    `),
    deleteTagIfZero: db.prepare(`
        DELETE FROM tags WHERE name = ? AND count <= 0
    `),
    getTagsByCard: db.prepare(`
        SELECT tag_name FROM tags_assign WHERE card_name = ?
    `),
    addTagToCard: db.prepare(`
        INSERT OR IGNORE INTO tags_assign (card_name, tag_name) VALUES (?, ?)
    `),
    removeTagFromCard: db.prepare(`
        DELETE FROM tags_assign WHERE card_name = ? AND tag_name = ?
    `),
    clearCardTags: db.prepare(`
        DELETE FROM tags_assign WHERE card_name = ?
    `),
    searchTags: db.prepare(`
        SELECT name FROM tags WHERE name LIKE ? ORDER BY count DESC LIMIT 10
    `),
    getExpectedRelease: db.prepare('SELECT * FROM expected_releases WHERE card_name = ? AND section = ?'),
    setExpectedRelease: db.prepare(`
        INSERT OR REPLACE INTO expected_releases (card_name, section, release_date, last_notification_date)
        VALUES (?, ?, ?, ?)
    `),
    deleteExpectedRelease: db.prepare('DELETE FROM expected_releases WHERE card_name = ? AND section = ?'),  // ← ЭТОТ ОТСУТСТВОВАЛ

    getExpectedReleasesBySection: db.prepare(`
        SELECT er.*, dc.status, dc.section 
        FROM expected_releases er
        JOIN data_cards dc ON dc.name = er.card_name AND dc.section = er.section
        WHERE er.section = ? 
        AND (
            dc.status = 'Ожидается' 
            OR (
                dc.status = 'В процессе' 
                AND (dc.section = 'anime' OR dc.section = 'serials')
            )
        )
        ORDER BY date(er.release_date) ASC
    `),
    updateCardNameInExpected: db.prepare(`
        UPDATE expected_releases SET card_name = ? WHERE card_name = ? AND section = ?
    `),
    updateSectionInExpected: db.prepare(`
        UPDATE expected_releases SET section = ? WHERE card_name = ? AND section = ?
    `),

    isExpectedReleasesDirty: db.prepare('SELECT value FROM app_statistics WHERE info = ?'),
        setExpectedReleasesDirty: db.prepare(`
        INSERT OR REPLACE INTO app_statistics (info, value, actual_date) 
        VALUES ('dirty_expected_releases', 'true', ?)
    `),
    clearExpectedReleasesDirty: db.prepare(`
        DELETE FROM app_statistics WHERE info = 'dirty_expected_releases'
    `),
    getAllExpectedReleases: db.prepare('SELECT card_name, section, release_date, last_notification_date FROM expected_releases'),
    replaceAllExpectedReleases: db.prepare(`
        DELETE FROM expected_releases
    `)
};

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
            syncUserData(storedUser.uid, freshToken, storedUser.email).then(syncResult => {
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
    win.loadFile('index.html');

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

app.on('before-quit', async (event) => {
    event.preventDefault();

    const storedUser = getStoredUser();
    if (storedUser && storedUser.is_authenticated && storedUser.id_token) {
        await syncDirtySections(storedUser.uid, storedUser.id_token);
    }

    db.pragma('wal_checkpoint(FULL)');
    db.close();
    app.exit();
});

setInterval(() => {
    db.pragma('wal_checkpoint(RESTART)');
}, 30000);

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
    externalWindow.loadFile('loading.html');

    // Блокируем навигацию
    externalWindow.webContents.on('will-navigate', (event, navigationUrl) => {
        if (new URL(navigationUrl).origin !== new URL(url).origin) {
            event.preventDefault();
        }
    });

    externalWindow.webContents.setWindowOpenHandler(() => {
        return { action: 'deny' };
    });

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
        const cachedData = statements.getStatistic.get('last_downloads');

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

        statements.setStatistic.run(
            'last_downloads',
            downloads.toString(),
            new Date().toISOString()
        );

        return downloads;

    } catch (error) {
        console.error('Error in getCachedGitHubDownloads:', error);
        const cachedData = statements.getStatistic.get('last_downloads');
        if (cachedData) {
            return parseInt(cachedData.value) || 0;
        }

        return 0;
    }
}

async function saveSectionToFirestore(uid, idToken, section, items) {
    const url = `https://firestore.googleapis.com/v1/projects/${firebaseConfig.projectId}/databases/(default)/documents/users/${uid}/sections/${section}`;

    const body = {
        fields: {
            items: {
                arrayValue: {
                    values: items.map(item => {
                        // Преобразуем tags из строки в массив
                        let tagsArray = [];
                        if (item.tags) {
                            if (typeof item.tags === 'string') {
                                tagsArray = item.tags.split(',').filter(t => t);
                            } else if (Array.isArray(item.tags)) {
                                tagsArray = item.tags;
                            }
                        }

                        return {
                            mapValue: {
                                fields: {
                                    name: { stringValue: item.name || '' },
                                    icoUrl: { stringValue: item.icoUrl || '' },
                                    rating: { stringValue: item.rating || '0' },
                                    status: { stringValue: item.status || 'Уточнить' },
                                    description: { stringValue: item.description || '' },
                                    tags: {
                                        arrayValue: {
                                            values: tagsArray.map(tag => ({ stringValue: tag }))
                                        }
                                    }
                                }
                            }
                        };
                    })
                }
            },
            updatedAt: { timestampValue: new Date().toISOString() }
        }
    };

    const response = await fetch(url, {
        method: 'PATCH',
        headers: {
            'Authorization': `Bearer ${idToken}`,
            'Content-Type': 'application/json'
        },
        body: JSON.stringify(body)
    });

    if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`HTTP ${response.status}: ${errorText}`);
    }

    console.log(`✅ Section ${section} saved (${items.length} items)`);
    return true;
}

async function getSectionFromFirestore(uid, idToken, section) {
    const url = `https://firestore.googleapis.com/v1/projects/${firebaseConfig.projectId}/databases/(default)/documents/users/${uid}/sections/${section}`;

    try {
        const response = await fetch(url, {
            method: 'GET',
            headers: { 'Authorization': `Bearer ${idToken}` }
        });

        if (response.status === 404) return [];
        if (!response.ok) throw new Error(`HTTP ${response.status}`);

        const data = await response.json();
        const items = [];

        if (data.fields && data.fields.items && data.fields.items.arrayValue) {
            const values = data.fields.items.arrayValue.values || [];
            for (const item of values) {
                const fields = item.mapValue.fields;
                // Читаем теги из массива
                let tags = [];
                if (fields.tags && fields.tags.arrayValue) {
                    tags = (fields.tags.arrayValue.values || []).map(v => v.stringValue);
                }

                items.push({
                    name: fields.name?.stringValue || '',
                    icoUrl: fields.icoUrl?.stringValue || '',
                    rating: fields.rating?.stringValue || '0',
                    status: fields.status?.stringValue || 'Уточнить',
                    description: fields.description?.stringValue || '',
                    tags: tags
                });
            }
        }

        return items;
    } catch (error) {
        console.error(`Error getting ${section}:`, error);
        return null;
    }
}

async function updateSyncTime(uid, idToken, timestamp) {
    const url = `https://firestore.googleapis.com/v1/projects/${firebaseConfig.projectId}/databases/(default)/documents/users/${uid}?updateMask.fieldPaths=lastSync`;

    const body = {
        fields: {
            lastSync: { timestampValue: timestamp }
        }
    };

    const response = await fetch(url, {
        method: 'PATCH',
        headers: {
            'Authorization': `Bearer ${idToken}`,
            'Content-Type': 'application/json'
        },
        body: JSON.stringify(body)
    });

    if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`HTTP ${response.status}: ${errorText}`);
    }

    console.log('[+] Sync time updated:', timestamp);
    return true;
}

async function getSyncTime(uid, idToken) {
    const url = `https://firestore.googleapis.com/v1/projects/${firebaseConfig.projectId}/databases/(default)/documents/users/${uid}`;

    try {
        const response = await fetch(url, {
            method: 'GET',
            headers: { 'Authorization': `Bearer ${idToken}` }
        });

        if (response.status === 404) return null;
        if (!response.ok) throw new Error(`HTTP ${response.status}`);

        const data = await response.json();
        return data.fields?.lastSync?.timestampValue || null;
    } catch (error) {
        console.error('Get sync time error:', error);
        return null;
    }
}

function markSectionDirty(section) {
    const now = new Date().toISOString();
    statements.setStatistic.run(`dirty_${section}`, 'true', now);
}

function markTagsDirty() {
    const now = new Date().toISOString();
    statements.setStatistic.run('dirty_tags', 'true', now);
}

function isTagsDirty() {
    const dirty = statements.getStatistic.get('dirty_tags');
    return dirty && dirty.value === 'true';
}

function clearTagsDirty() {
    statements.deleteStatistic.run('dirty_tags');
}

// Проверка, нужно ли синхронизировать раздел
function isSectionDirty(section) {
    const dirty = statements.getStatistic.get(`dirty_${section}`);
    return dirty && dirty.value === 'true';
}

// Снять флаг "грязный" после синхронизации
function clearSectionDirty(section) {
    statements.deleteStatistic.run(`dirty_${section}`);
}

async function syncDirtySections(uid, idToken) {
    const freshToken = await getValidToken();
    if (!freshToken) {
        console.log('[!] No valid token, skipping sync');
        return false;
    }

    const sections = ['games', 'movies', 'cartoons', 'serials', 'anime', 'books'];
    const dirtySections = sections.filter(section => isSectionDirty(section));

    if (dirtySections.length === 0) {
        console.log('[i] No dirty sections, skipping sync');
        return false;
    }

    console.log(`[i] Syncing dirty sections: ${dirtySections.join(', ')}`);

    for (const section of dirtySections) {
        const sectionData = statements.getDataBySection.all(section);
        await saveSectionToFirestore(uid, freshToken, section, sectionData);
        clearSectionDirty(section);
    }

    if (isTagsDirty()) {
        console.log('[i] Syncing tags...');
        await saveAllTagsToFirestore(uid, freshToken);
        clearTagsDirty();
    }

    const dirtyExpectedReleases = statements.isExpectedReleasesDirty.get('dirty_expected_releases');
    if (dirtyExpectedReleases && dirtyExpectedReleases.value === 'true') {
        console.log('[i] Syncing expected releases...');
        await saveExpectedReleasesToFirestore(uid, idToken);
        clearExpectedReleasesDirty();
    }

    const now = new Date().toISOString();
    await updateSyncTime(uid, freshToken, now);
    statements.setStatistic.run('last_firestore_update', now, now);

    return true;
}

async function saveAllTagsToFirestore(uid, idToken) {
    const allTags = statements.getAllTags.all(); // [{name, count}]

    const url = `https://firestore.googleapis.com/v1/projects/${firebaseConfig.projectId}/databases/(default)/documents/users/${uid}/sections/tags`;

    const body = {
        fields: {
            items: {
                arrayValue: {
                    values: allTags.map(tag => ({
                        mapValue: {
                            fields: {
                                name: { stringValue: tag.name },
                                count: { integerValue: tag.count }
                            }
                        }
                    }))
                }
            },
            updatedAt: { timestampValue: new Date().toISOString() }
        }
    };

    const response = await fetch(url, {
        method: 'PATCH',
        headers: {
            'Authorization': `Bearer ${idToken}`,
            'Content-Type': 'application/json'
        },
        body: JSON.stringify(body)
    });

    if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`HTTP ${response.status}: ${errorText}`);
    }

    console.log(`✅ Tags saved (${allTags.length} tags)`);
    return true;
}

async function loadAllTagsFromFirestore(uid, idToken) {
    const url = `https://firestore.googleapis.com/v1/projects/${firebaseConfig.projectId}/databases/(default)/documents/users/${uid}/sections/tags`;

    try {
        const response = await fetch(url, {
            method: 'GET',
            headers: { 'Authorization': `Bearer ${idToken}` }
        });

        if (response.status === 404) return [];
        if (!response.ok) throw new Error(`HTTP ${response.status}`);

        const data = await response.json();
        const items = [];

        if (data.fields && data.fields.items && data.fields.items.arrayValue) {
            const values = data.fields.items.arrayValue.values || [];
            for (const item of values) {
                const fields = item.mapValue.fields;
                items.push({
                    name: fields.name?.stringValue || '',
                    count: fields.count?.integerValue || 0
                });
            }
        }

        return items;
    } catch (error) {
        console.error('Error loading tags:', error);
        return null;
    }
}

async function refreshAccessToken(refreshToken) {
    const url = `https://securetoken.googleapis.com/v1/token?key=${firebaseConfig.apiKey}`;

    const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            grant_type: 'refresh_token',
            refresh_token: refreshToken
        })
    });

    if (!response.ok) {
        const error = await response.text();
        throw new Error(`Token refresh failed: ${error}`);
    }

    const data = await response.json();
    return {
        idToken: data.id_token,
        refreshToken: data.refresh_token, // может прийти новый refresh token
        expiresIn: data.expires_in
    };
}

async function getValidToken() {
    const storedUser = getStoredUser();
    if (!storedUser || !storedUser.is_authenticated) {
        return null;
    }

    // Пробуем сначала через Firebase SDK (если он активен)
    try {
        const currentUser = auth.currentUser;
        if (currentUser) {
            const freshToken = await currentUser.getIdToken(true);
            // Обновляем в БД
            const stmt = db.prepare(`UPDATE user_session SET id_token = ? WHERE id = 1`);
            stmt.run(freshToken);
            console.log('[i] Token refreshed via Firebase SDK');
            return freshToken;
        }
    } catch (error) {
        console.log('[i] Firebase SDK not available, using REST API');
    }

    // Если SDK не помог — используем REST API с refresh token
    if (storedUser.refresh_token) {
        try {
            const { idToken, refreshToken } = await refreshAccessToken(storedUser.refresh_token);

            // Обновляем оба токена в БД
            const stmt = db.prepare(`UPDATE user_session SET id_token = ?, refresh_token = ? WHERE id = 1`);
            stmt.run(idToken, refreshToken || storedUser.refresh_token);

            console.log('[i] Token refreshed via REST API');
            return idToken;
        } catch (error) {
            console.error('[x] Failed to refresh token:', error);
            // Токен не обновился — нужно перелогиниваться
            clearUserSession();
            if (win) {
                win.webContents.send('session-expired', true);
            }
            return null;
        }
    }

    console.log('[!] No refresh token available');
    return null;
}

// Универсальная функция для парсинга сайтов
async function parseSite(name, searchUrl, targetUrlParser, dataParser, needExtraWait = false) {
    closeAllParsingWindows();
    let hiddenWindow = createHiddenWindow();
    let loadTimeout = null;

    const cleanup = () => {
        if (loadTimeout) clearTimeout(loadTimeout);
        if (hiddenWindow && !hiddenWindow.isDestroyed()) {
            destroyWindowCompletely(hiddenWindow);
        }
    };

    const waitForPageLoad = () => {
        return new Promise((resolve) => {
            loadTimeout = setTimeout(() => {
                console.log(`[${name}] page timeout, stopping load`);
                hiddenWindow.webContents.stop();
                resolve();
            }, 5000);
            hiddenWindow.webContents.once('did-finish-load', () => {
                clearTimeout(loadTimeout);
                resolve();
            });
        });
    };

    try {
        trackParsingWindow(hiddenWindow);
        console.log(`[${name}] Searching: ${searchUrl}`);
        hiddenWindow.loadURL(searchUrl);
        if (needExtraWait) { await new Promise(r => setTimeout(r, 2000)); }
        await waitForPageLoad();
        let targetUrl = await hiddenWindow.webContents.executeJavaScript(targetUrlParser);
        if (!targetUrl) {
            cleanup();
            console.log(`[${name}] Info Not Found.`);
            return { tags: [], description: '', coverUrl: '', fullTitle: '', releaseDate: null };
        }
        console.log(`[${name}] Info Found: ${targetUrl}`);
        hiddenWindow.loadURL(targetUrl);
        await waitForPageLoad();
        let result = await hiddenWindow.webContents.executeJavaScript(dataParser);
        cleanup();
        return result;
    } catch (error) {
        console.error(`[${name}] Error:`, error);
        cleanup();
        return { tags: [], description: '', coverUrl: '', fullTitle: '', releaseDate: null };
    }
}
function createHiddenWindow() {
    let hiddenWindow = new BrowserWindow({
        show: false,
        width: 1280,
        height: 800,
        webPreferences: { nodeIntegration: false, contextIsolation: true, images: true },

    });

    hiddenWindow.webContents.session.webRequest.onBeforeSendHeaders((details, callback) => {
        details.requestHeaders['User-Agent'] = DEFAULT_USER_AGENT;
        details.requestHeaders['Accept-Language'] = 'ru-RU,ru;q=0.9';
        callback({ cancel: false, requestHeaders: details.requestHeaders });
    });
    return hiddenWindow;
}

// ========== кино, сериалы, мультфильы ==========
async function fetchKinopoiskMovieTags(movieName) {
    return parseSite(
        'Kinopoisk',
        `https://www.kinopoisk.ru/index.php?kp_query=${encodeURIComponent(movieName)}`,
        `
            (function() {
                const mostWanted = document.querySelector('.search_results .element.most_wanted');
                if (mostWanted) {
                    const nameLink = mostWanted.querySelector('.name a');
                    if (nameLink && nameLink.href) {
                        let cleanUrl = nameLink.href.replace(/\\/sr\\/\\d+/, '');
                        return cleanUrl;
                    }
                }
                const anyFilmLink = document.querySelector('a[href*="/film/"]');
                if (anyFilmLink) {
                    let cleanUrl = anyFilmLink.href.replace(/\\/sr\\/\\d+/, '');
                    return cleanUrl;
                }
                return null;
            })()
        `,
        `
            (function() {
                // Полное название фильма
                let fullTitle = '';
                const titleElement = document.querySelector('h1[itemprop="name"] span');
                if (titleElement) {
                    fullTitle = titleElement.textContent.trim();
                }
                if (!fullTitle) {
                    const titleH1 = document.querySelector('h1[itemprop="name"]');
                    if (titleH1) {
                        fullTitle = titleH1.textContent.trim();
                    }
                }
                
                // Теги (жанры)
                const tags = [];
                const genresBlock = document.querySelector('[data-test-id="genres"]');
                if (genresBlock) {
                    genresBlock.querySelectorAll('a').forEach(el => {
                        const text = el.textContent.trim();
                        if (text && text.length < 30 && !tags.includes(text)) {
                            tags.push(text);
                        }
                    });
                }
                
                if (tags.length === 0) {
                    const fallbackSelectors = [
                        '.styles_rowDark__Q3Dh2 a[href*="/genre/"]',
                        '[class*="genre"] a'
                    ];
                    for (const selector of fallbackSelectors) {
                        const elements = document.querySelectorAll(selector);
                        elements.forEach(el => {
                            const text = el.textContent.trim();
                            if (text && text.length < 30 && !tags.includes(text)) {
                                tags.push(text);
                            }
                        });
                        if (tags.length) break;
                    }
                }
                
                // Описание
                let description = '';
                const descElement = document.querySelector('[data-test-id="synopsis"]');
                if (descElement) {
                    description = descElement.textContent.trim().substring(0, 500);
                }
                
                // Обложка
                let coverUrl = '';
                const posterElement = document.querySelector('.film-poster');
                if (posterElement && posterElement.src) {
                    coverUrl = posterElement.src;
                    if (coverUrl.startsWith('//')) coverUrl = 'https:' + coverUrl;
                }
                if (!coverUrl) {
                    const imgElement = document.querySelector('[class*="poster"] img');
                    if (imgElement && imgElement.src) {
                        coverUrl = imgElement.src;
                        if (coverUrl.startsWith('//')) coverUrl = 'https:' + coverUrl;
                    }
                }
                
                // ДАТА ПРЕМЬЕРЫ
                let releaseDate = null;
                const premiereBlock = document.querySelector('[data-test-id="worldPremieres"]');
                if (premiereBlock) {
                    const dateLink = premiereBlock.querySelector('a[href*="/dates/"]');
                    if (dateLink) {
                        const dateText = dateLink.textContent.trim();
                        
                        const months = {
                            'января': '01', 'февраля': '02', 'марта': '03', 'апреля': '04',
                            'мая': '05', 'июня': '06', 'июля': '07', 'августа': '08',
                            'сентября': '09', 'октября': '10', 'ноября': '11', 'декабря': '12'
                        };
                        
                        const parts = dateText.split(/\\s+/);
                        let day = null, monthNum = null, year = null;
                        
                        for (const part of parts) {
                            if (/^\\d{1,2}$/.test(part) && !day) {
                                day = part.padStart(2, '0');
                            } else if (/^\\d{4}$/.test(part) && !year) {
                                year = part;
                            } else if (months[part] && !monthNum) {
                                monthNum = months[part];
                            }
                        }
                        
                        if (day && monthNum && year) {
                            releaseDate = year + '-' + monthNum + '-' + day;
                        }
                    }
                }
                
                return {
                    tags: tags.slice(0, 10),
                    description: description,
                    coverUrl: coverUrl,
                    fullTitle: fullTitle,
                    releaseDate: releaseDate
                };
            })()
        `
    );
}
// ========== +++++АНИМЕ информация ==========
async function fetchYummyAniTags(animeName) {
    return parseSite(name = 'YummyAni',
        searchUrl = `https://old.yummyani.me/search?word=${encodeURIComponent(animeName)}`,
        targetUrlParser = `
            (function() {
                const firstCard = document.querySelector('.grid-container.animes-search .anime-column');
                if (!firstCard) return null;
                const link = firstCard.querySelector('a.image-block');
                return link ? link.href : null;
            })()
        `,
        dataParser = `
            (function() {
                let fullTitle = '';
                const titleElement = document.querySelector('h1[itemprop="name"]');
                if (titleElement) fullTitle = titleElement.textContent.trim();
                
                const tags = [];
                const genreContainer = document.querySelector('.categories-list.no-comma');
                if (genreContainer) {
                    genreContainer.querySelectorAll('ul li a.badge').forEach(el => {
                        const text = el.textContent.trim();
                        if (text && !tags.includes(text)) tags.push(text);
                    });
                }
                
                let coverUrl = '';
        
                // Пробуем img с классом bordered-top
                const coverImg = document.querySelector('img.bordered-top');
                if (coverImg && coverImg.src) {
                    coverUrl = coverImg.src;
                }
                
                // Если нет, пробуем data-full
                if (!coverUrl) {
                    const fullImg = document.querySelector('[data-full]');
                    if (fullImg && fullImg.getAttribute('data-full')) {
                        coverUrl = fullImg.getAttribute('data-full');
                    }
                }
                
                // Если всё ещё нет, ищем любое изображение в блоке
                if (!coverUrl) {
                    const anyImg = document.querySelector('.image-block img, .bordered-top');
                    if (anyImg && anyImg.src) {
                        coverUrl = anyImg.src;
                    }
                }
                
                if (coverUrl && coverUrl.startsWith('//')) coverUrl = 'https:' + coverUrl;
                
                let releaseDate = null;
                const timeCounter = document.querySelector('time-counter');
                if (timeCounter && timeCounter.getAttribute('data-time')) {
                    const timestamp = timeCounter.getAttribute('data-time');
                    if (timestamp) {
                        const date = new Date(parseInt(timestamp) * 1000);
                        if (!isNaN(date.getTime())) releaseDate = date.toISOString().split('T')[0];
                    }
                }
                
                return { tags: tags.slice(0, 12), description: '', coverUrl, fullTitle, releaseDate };
            })()
        `);
}

// ========== +++++ИГРЫ ТЕГИ ==========
async function fetchSteamGameTags(gameName) {
    return new Promise(async (resolve) => {
        let hiddenWindow = null;
        let isResolved = false;
        let loadTimeout = null;
        let isLoaded = false;
        let currentUrl;

        const finish = (result) => {
            if (isResolved) return;
            isResolved = true;
            if (loadTimeout) clearTimeout(loadTimeout);
            if (hiddenWindow && !hiddenWindow.isDestroyed()) {
                hiddenWindow.close();
            }
            resolve(result);
        };

        try {
            // 1. Поиск игры через storesearch API (только для получения ID)
            const searchUrl = `https://store.steampowered.com/api/storesearch/?term=${encodeURIComponent(gameName)}&cc=ru&l=russian`;
            const searchResponse = await fetch(searchUrl);
            const searchData = await searchResponse.json();

            if (!searchData.items || searchData.items.length === 0) {
                console.log(`[Steam] Game not found: ${gameName}`);
                finish({ tags: [], coverUrl: '', fullTitle: '', releaseDate: null, description: '' });
                return;
            }
            const game = searchData.items[0];
            const appId = game.id;
            const fullTitle = game.name;

            console.log(`[Steam] Found ID for "${gameName}": ${appId}`);
            console.log(`[Steam] Full title: "${fullTitle}"`);

            // 2. Открываем страницу игры и парсим ВСЁ с неё
            const gameUrl = `https://store.steampowered.com/app/${appId}/?l=russian`;

            hiddenWindow = new BrowserWindow({
                show: false,
                width: 1280,
                height: 800,
                webPreferences: {
                    nodeIntegration: false,
                    contextIsolation: true,
                    images: true
                }
            });

            hiddenWindow.webContents.session.webRequest.onBeforeSendHeaders((details, callback) => {
                details.requestHeaders['User-Agent'] = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
                details.requestHeaders['Accept-Language'] = 'ru-RU,ru;q=0.9';
                callback({ cancel: false, requestHeaders: details.requestHeaders });
            });

            hiddenWindow.loadURL(gameUrl);
            console.log(`[Steam] Page loading started`);

            const waitForLoad = new Promise((resolve) => {
                hiddenWindow.webContents.once('did-finish-load', () => {
                    console.log(`[Steam] Page finished loading`);
                    isLoaded = true;
                    resolve();
                });

                loadTimeout = setTimeout(() => {
                    if (!isLoaded) {
                        console.log(`[Steam] Page timeout (3s), stopping load`);
                        hiddenWindow.webContents.stop();
                        isLoaded = true;
                        resolve();
                    }
                }, 3000);
            });

            await waitForLoad;
            if (loadTimeout) clearTimeout(loadTimeout);

            currentUrl = hiddenWindow.webContents.getURL();
            if (!currentUrl || currentUrl === 'about:blank' || currentUrl.includes('error')) {
                console.log('[Steam] Page not loaded properly, finishing with empty result');
                finish({ tags: [], coverUrl: '', fullTitle: '', releaseDate: null, description: '' });
                return;
            }

            // Парсим ВСЕ данные со страницы
            const gameData = await hiddenWindow.webContents.executeJavaScript(`
                (function() {
                    // Обложка
                    let coverUrl = '';
                    const headerImg = document.querySelector('.game_header_image_full');
                    if (headerImg && headerImg.src) {
                        coverUrl = headerImg.src;
                    }
                    
                    // Дата релиза
                    let releaseDate = null;
                    const releaseDateEl = document.querySelector('.release_date .date');
                    if (releaseDateEl) {
                        const dateText = releaseDateEl.textContent.trim();
                        // Парсим "11 авг. 2022 г."
                        const months = {
                            'янв': '01', 'фев': '02', 'мар': '03', 'апр': '04',
                            'мая': '05', 'май': '05', 'июн': '06', 'июл': '07',
                            'авг': '08', 'сен': '09', 'окт': '10', 'ноя': '11', 'дек': '12'
                        };
                        const match = dateText.match(/(\\d{1,2})\\s+(\\w+)\\.?\\s+(\\d{4})/);
                        if (match) {
                            const day = match[1].padStart(2, '0');
                            const monthName = match[2].toLowerCase().substring(0, 3);
                            const year = match[3];
                            const month = months[monthName];
                            if (month) {
                                releaseDate = year + '-' + month + '-' + day;
                            }
                        }
                    }
                    
                    // Теги (Популярные метки)
                    const tags = [];
                    const tagsContainer = document.querySelector('.glance_tags.popular_tags, .popular_tags_ctn');
                    if (tagsContainer) {
                        const tagElements = tagsContainer.querySelectorAll('a.app_tag');
                        for (const el of tagElements) {
                            const tagText = el.textContent.trim();
                            if (tagText && tagText !== '+' && el.style.display !== 'none') {
                                tags.push(tagText);
                            }
                        }
                    }
                    
                    // Описание
                    let description = '';
                    const descElement = document.querySelector('.game_description_snippet');
                    if (descElement) {
                        description = descElement.textContent.trim();
                    }
                    
                    return {
                        coverUrl: coverUrl,
                        releaseDate: releaseDate,
                        tags: tags.slice(0, 12),
                        description: description,
                        fullTitle: ''
                    };
                })();
            `);

            console.log(`[Steam] Cover: ${gameData.coverUrl}`);
            console.log(`[Steam] Release date: ${gameData.releaseDate || 'not found'}`);
            console.log(`[Steam] Tags:`, gameData.tags);
            console.log(`[Steam] Description: ${gameData.description.substring(0, 100)}...`);

            finish({
                tags: gameData.tags,
                coverUrl: gameData.coverUrl,
                fullTitle: fullTitle,
                releaseDate: gameData.releaseDate,
                description: gameData.description
            });

        } catch (error) {
            console.error('[Steam] Error:', error);
            finish({ tags: [], coverUrl: '', fullTitle: '', releaseDate: null, description: '' });
        }
    });
}

async function fetchKupikodPrice(gameName) {
    return parseSite(
        'Kupikod',
        `https://steam.kupikod.com/ru-ru/games`,
        // targetUrlParser - имитируем ввод и возвращаем ссылку
        `
    (function() {
    return new Promise((resolve) => {
        const input = document.querySelector('input[placeholder="Поиск"], input[data-testid="input"]');
        if (!input) {
            resolve(null);
            return;
        }
        
        input.focus();
        
        const nativeInputValueSetter = Object.getOwnPropertyDescriptor(
            window.HTMLInputElement.prototype, 
            'value'
        ).set;
        
        nativeInputValueSetter.call(input, "${gameName.replace(/"/g, '\\"')}");
        input.dispatchEvent(new Event('input', { bubbles: true }));
        
        // Ждём появления результатов с проверкой каждые 100ms
        let attempts = 0;
        const maxAttempts = 30; // максимум 3 секунды (30 * 100ms)
        
        const checkResults = setInterval(() => {
            attempts++;
            const results = document.querySelectorAll('.main-search__results a.main-search__result-item');
            
            if (results.length > 0) {
                clearInterval(checkResults);
                const href = results[0].getAttribute('href');
                resolve(href);
            } else if (attempts >= maxAttempts) {
                clearInterval(checkResults);
                resolve(null);
            }
        }, 100);
    });
})()
`,
        // dataParser - парсим цену
        // dataParser - парсим данные со страницы игры
        `
    (function() {
        // Название
        let fullTitle = '';
        const titleEl = document.querySelector('h1.product__title span');
        if (titleEl) {
            fullTitle = titleEl.textContent.trim();
        }
        
        // Обложка
        let coverUrl = '';
        const coverEl = document.querySelector('img.product__image');
        if (coverEl && coverEl.src) {
            coverUrl = coverEl.src;
        }
        
        // Теги
        const tags = [];
        const tagsContainer = document.querySelector('.product__tags');
        if (tagsContainer) {
            const tagElements = tagsContainer.querySelectorAll('.product__tag');
            tagElements.forEach(el => {
                const text = el.textContent.trim();
                if (text && !tags.includes(text)) {
                    tags.push(text);
                }
            });
        }
        
        // Дата релиза
        let releaseDate = null;
        const releaseItem = document.querySelector('[data-test="game-info-release-date"]');
        if (releaseItem) {
            const valueEl = releaseItem.querySelector('.game-info__value');
            if (valueEl) {
                const dateText = valueEl.textContent.trim();
                // Парсим дату в формате "17 мая 2021 г."
                const months = {
                    'января': '01', 'февраля': '02', 'марта': '03', 'апреля': '04',
                    'мая': '05', 'июня': '06', 'июля': '07', 'августа': '08',
                    'сентября': '09', 'октября': '10', 'ноября': '11', 'декабря': '12'
                };
                
                // Убираем "г." в конце
                const cleanDate = dateText.replace(/\\s*г\\.?\\s*$/, '');
                const parts = cleanDate.split(/\\s+/);
                
                let day = null, monthNum = null, year = null;
                for (const part of parts) {
                    if (/^\\d{1,2}$/.test(part) && !day) {
                        day = part.padStart(2, '0');
                    } else if (/^\\d{4}$/.test(part) && !year) {
                        year = part;
                    } else if (months[part] && !monthNum) {
                        monthNum = months[part];
                    }
                }
                
                if (day && monthNum && year) {
                    releaseDate = year + '-' + monthNum + '-' + day;
                }
            }
        }
        
        return { 
            tags: tags.slice(0, 10),
            description: '',
            coverUrl: coverUrl,
            fullTitle: fullTitle,
            releaseDate: releaseDate
        };
    })()
`
    );
}
// ========== +++++КНИГИ ТЕГИ ==========
async function fetchLitresBookTags(bookName) {
    return parseSite(
        'Litres',
        `https://www.litres.ru/search/?q=${encodeURIComponent(bookName)}&languages=ru&art_types=text_book&limit=10`,
        `
            (function() {
                const allLinks = document.querySelectorAll('a[href*="/book/"]');
                for (const link of allLinks) {
                    const href = link.href;
                    if (!href.includes('erid=') && !href.includes('banner') && !href.includes('campaign')) {
                        return href.startsWith('http') ? href : 'https://www.litres.ru' + href;
                    }
                }
                return null;
            })()
        `,
        `
            (function() {
                let fullTitle = '';
                const titleElement = document.querySelector('h1[itemprop="name"]');
                if (titleElement) fullTitle = titleElement.textContent.trim();
                
                const tags = [];
                const tagSelectors = [
                    '.BookGenresAndTags_genresList__rd8vU a',
                    '[class*="genresList"] a',
                    'a[href*="/genre/"]',
                    'a[href*="/tags/"]'
                ];
                
                for (const selector of tagSelectors) {
                    const elements = document.querySelectorAll(selector);
                    for (const el of elements) {
                        const text = el.textContent.trim();
                        if (text && text !== 'Только на Литрес' && text.length < 40 && !tags.includes(text)) {
                            tags.push(text);
                        }
                    }
                    if (tags.length) break;
                }
                
                let description = '';
                const descEl = document.querySelector('.BookDescription_text, [class*="description"] p');
                if (descEl) description = descEl.textContent.trim().substring(0, 500);
                
                let coverUrl = '';
                const coverEl = document.querySelector('.AdaptiveCover_image__f_21W, .ArtCover_cover__image__ClWcc, [class*="cover"] img');
                if (coverEl && coverEl.src) coverUrl = coverEl.src;
                
                return { 
                    tags: tags.slice(0, 10), 
                    description: description, 
                    coverUrl: coverUrl,
                    fullTitle: fullTitle,
                    releaseDate: null
                };
            })()
        `,
        true
    );
}

async function fetchChitaiGorodBook(bookName) {
    return parseSite(
        'ChitaiGorod',
        `https://www.chitai-gorod.ru/search?phrase=${encodeURIComponent(bookName)}`,
        // targetUrlParser - ищем ссылку на книгу
        `
            (function() {
                const productWrapper = document.querySelector('.product-card__image-wrapper');
                if (!productWrapper) {
                    return null;
                }
                
                const link = productWrapper.querySelector('a');
                return link ? link.href : null;
            })()
        `,
        // dataParser - парсим данные со страницы книги
        `
            (function() {
                // Название (очищаем от возрастного рейтинга)
                let fullTitle = '';
                const titleEl = document.querySelector('h1.product-detail-page__title');
                if (titleEl) {
                    // Берём текст, но убираем возрастной рейтинг (он в отдельном div)
                    fullTitle = titleEl.childNodes[0]?.textContent?.trim() || titleEl.textContent.trim();
                    // Если остался мусор, чистим
                    fullTitle = fullTitle.replace(/\\d+\\+/, '').trim();
                }
                
                // Обложка - берём из srcset первый URL (самый маленький или большой)
                let coverUrl = '';
                const previewDiv = document.querySelector('.product-preview');
                if (previewDiv) {
                    const img = previewDiv.querySelector('img');
                    if (img && img.srcset) {
                        // srcset содержит URL вида "https://... 1x, https://... 2x"
                        const urls = img.srcset.split(',');
                        if (urls.length > 0) {
                            // Берём первый URL (обычно 1x)
                            coverUrl = urls[0].trim().split(' ')[0];
                        }
                    } else if (img && img.src) {
                        coverUrl = img.src;
                    }
                }
                
                // Теги
                const tags = [];
                const tagsContainer = document.querySelector('ul.product-tag-list');
                if (tagsContainer) {
                    const tagElements = tagsContainer.querySelectorAll('li a.product-tag');
                    tagElements.forEach(el => {
                        const text = el.textContent.trim();
                        if (text && !tags.includes(text)) {
                            tags.push(text);
                        }
                    });
                }
                
                return { 
                    tags: tags.slice(0, 10),
                    description: '',
                    coverUrl: coverUrl,
                    fullTitle: fullTitle,
                    releaseDate: null  // на странице нет даты выхода в доступном виде
                };
            })()
        `
    );
}

async function fetchFilmRuSerialsTags(serialName) {
    return parseSite(
        'FilmRu',
        `https://www.film.ru/search/result?text=${encodeURIComponent(serialName)}&type=all`,
        `
            (function() {
                const allLinks = document.querySelectorAll('a[href*="/movies/"], a[href*="/serials/"], a[href*="/cartoons/"]');
                for (const link of allLinks) {
                    if (link.href && link.querySelector('img')) {
                        return link.href;
                    }
                }
                const anyImageLink = document.querySelector('a img')?.closest('a');
                return anyImageLink ? anyImageLink.href : null;
            })()
        `,
        `
            (function() {
                function parseRussianDate(dateText) {
                    const months = {
                        'января': '01', 'февраля': '02', 'марта': '03', 'апреля': '04',
                        'мая': '05', 'июня': '06', 'июля': '07', 'августа': '08',
                        'сентября': '09', 'октября': '10', 'ноября': '11', 'декабря': '12'
                    };
                    const parts = dateText.split(/\\s+/);
                    let day = null, monthNum = null, year = null;
                    for (const part of parts) {
                        if (/^\\d{1,2}$/.test(part) && !day) day = part.padStart(2, '0');
                        else if (/^\\d{4}$/.test(part) && !year) year = part;
                        else if (months[part] && !monthNum) monthNum = months[part];
                    }
                    if (day && monthNum && year) return year + '-' + monthNum + '-' + day;
                    return null;
                }
                
                let fullTitle = '';
                const titleElement = document.querySelector('h1');
                if (titleElement) {
                    fullTitle = titleElement.textContent.trim();
                    fullTitle = fullTitle.replace(/\\(сериал.*?\\)/, '').trim();
                }
                
                let coverUrl = '';
                const posterBlock = document.querySelector('a.wrapper_movies_poster');
                if (posterBlock) {
                    coverUrl = posterBlock.getAttribute('data-src');
                    if (coverUrl && !coverUrl.startsWith('http')) {
                        coverUrl = 'https://www.film.ru' + coverUrl;
                    }
                    coverUrl = coverUrl.replace('/styles/thumb_260x400/', '/');
                }
                
                const tags = [];
                const blockInfo = document.querySelector('.block_info');
                if (blockInfo) {
                    blockInfo.querySelectorAll('a').forEach(link => {
                        const text = link.textContent.trim();
                        if (text && text !== '18+' && text.length < 30 && !tags.includes(text)) {
                            tags.push(text);
                        }
                    });
                }
                
                let releaseDate = null;
                const episodesBlock = document.querySelector('.wrapper_movies_soon_episodes.active');
                if (episodesBlock) {
                    const allDivs = episodesBlock.querySelectorAll('div');
                    let targetElement = allDivs.length > 0 ? allDivs[allDivs.length - 1] : episodesBlock.querySelector('a');
                    if (targetElement) {
                        const dateSpan = targetElement.querySelector('span:last-child');
                        if (dateSpan) {
                            const parsedDate = parseRussianDate(dateSpan.textContent.trim());
                            if (parsedDate) releaseDate = parsedDate;
                        }
                    }
                }
                
                if (!releaseDate) {
                    const premiereBlock = document.querySelector('.block_table');
                    if (premiereBlock) {
                        const rows = premiereBlock.querySelectorAll('div');
                        for (let i = 0; i < rows.length; i++) {
                            if (rows[i].textContent.trim() === 'премьера' && rows[i + 1]) {
                                const dateText = rows[i + 1].textContent.trim();
                                const match = dateText.match(/(\\d{2})\\.(\\d{2})\\.(\\d{4})/);
                                if (match) {
                                    releaseDate = match[3] + '-' + match[2] + '-' + match[1];
                                    break;
                                }
                            }
                        }
                    }
                }
                
                if (!releaseDate) {
                    const titleH1 = document.querySelector('h1');
                    if (titleH1) {
                        const yearMatch = titleH1.textContent.match(/(\\d{4})/);
                        if (yearMatch) releaseDate = yearMatch[1] + '-01-01';
                    }
                }
                
                return { 
                    tags: tags.slice(0, 10), 
                    description: '', 
                    coverUrl: coverUrl,
                    fullTitle: fullTitle,
                    releaseDate: releaseDate
                };
            })()
        `
    );
}

async function fetchCardData(cardName, section) {
    switch (section) {
        case 'anime':
            const animeResult = await fetchYummyAniTags(cardName);
            return { tags: animeResult?.tags || [], coverUrl: animeResult?.coverUrl || '', fullTitle: animeResult?.fullTitle || '', releaseDate: animeResult?.releaseDate || null };
        case 'games':
            let gameResult = await fetchSteamGameTags(cardName);
            if (gameResult == null || gameResult.tags === null || gameResult.tags.length === 0) {
                gameResult = await fetchKupikodPrice(cardName);
            }
            return { tags: gameResult?.tags || [], coverUrl: gameResult?.coverUrl || '', fullTitle: gameResult?.fullTitle || '', releaseDate: gameResult?.releaseDate || null };
        case 'movies':
        case 'serials':
        case 'cartoons':
            let filmResult = await fetchFilmRuSerialsTags(cardName);
            if (filmResult == null || filmResult.tags === null || filmResult.tags.length === 0) {
                filmResult = await fetchKinopoiskMovieTags(cardName);
            }
            return { tags: filmResult?.tags || [], coverUrl: filmResult?.coverUrl || '', fullTitle: filmResult?.fullTitle || '', releaseDate: filmResult?.releaseDate || null };
        case 'books':
            let bookResult = await fetchChitaiGorodBook(cardName);
            if (bookResult == null || bookResult.tags === null || bookResult.tags.length === 0) {
                bookResult = await fetchLitresBookTags(cardName);
            }
            return { tags: bookResult?.tags || [], coverUrl: bookResult?.coverUrl || '', fullTitle: bookResult?.fullTitle || '', releaseDate: bookResult?.releaseDate || null };
        default:
            return { tags: [], coverUrl: '', fullTitle: '', releaseDate: null };
    }
}

async function updateAllReleaseDates() {
    const lastUpdate = statements.getStatistic.get('last_release_update');
    const lastDate = lastUpdate ? new Date(lastUpdate.value) : new Date(0);
    const now = new Date();
    const daysDiff = (now - lastDate) / (1000 * 60 * 60 * 24);

    // Раз в 7 дней
    if (daysDiff < 7) return;

    console.log('[Release] Updating all release dates...');

    const cards = db.prepare(`
        SELECT name, section FROM data_cards 
        WHERE ((status = 'Ожидается' OR status = 'В процессе') and section <> 'games')
        OR status = 'Ожидается' and section = 'games'
    `).all();

    for (const card of cards) {
        try {
            let cardData = await fetchCardData(card.name, card.section);
            let releaseDate = cardData.releaseDate;
            if (releaseDate) {
                const existing = statements.getExpectedRelease.get(card.name, card.section);
                if (!existing || existing.release_date !== releaseDate) {
                    statements.setExpectedRelease.run(card.name, card.section, releaseDate, existing?.last_notification_date || null);
                    console.log(`[Release] Updated: ${card.name} -> ${releaseDate}`);
                    markExpectedReleasesDirty();
                }
            }
        } catch (error) {
            console.error(`[Release] Failed to update ${card.name}:`, error);
        }

        // Задержка между запросами, чтобы не забанили
        await new Promise(resolve => setTimeout(resolve, 1000));
    }

    statements.setStatistic.run('last_release_update', now.toISOString(), now.toISOString());
    console.log('[Release] Update completed');
}

async function saveExpectedReleasesToFirestore(uid, idToken) {
    const releases = statements.getAllExpectedReleases.all();

    const url = `https://firestore.googleapis.com/v1/projects/${firebaseConfig.projectId}/databases/(default)/documents/users/${uid}/sections/expected_releases`;

    const body = {
        fields: {
            items: {
                arrayValue: {
                    values: releases.map(release => ({
                        mapValue: {
                            fields: {
                                card_name: { stringValue: release.card_name },
                                section: { stringValue: release.section },
                                release_date: { stringValue: release.release_date },
                                last_notification_date: { stringValue: release.last_notification_date || '' }
                            }
                        }
                    }))
                }
            },
            updatedAt: { timestampValue: new Date().toISOString() }
        }
    };

    const response = await fetch(url, {
        method: 'PATCH',
        headers: {
            'Authorization': `Bearer ${idToken}`,
            'Content-Type': 'application/json'
        },
        body: JSON.stringify(body)
    });

    if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`HTTP ${response.status}: ${errorText}`);
    }

    console.log(`✅ Expected releases saved (${releases.length} items)`);
    return true;
}

async function loadExpectedReleasesFromFirestore(uid, idToken) {
    const url = `https://firestore.googleapis.com/v1/projects/${firebaseConfig.projectId}/databases/(default)/documents/users/${uid}/sections/expected_releases`;

    try {
        const response = await fetch(url, {
            method: 'GET',
            headers: { 'Authorization': `Bearer ${idToken}` }
        });

        if (response.status === 404) return [];
        if (!response.ok) throw new Error(`HTTP ${response.status}`);

        const data = await response.json();
        const releases = [];

        if (data.fields && data.fields.items && data.fields.items.arrayValue) {
            const values = data.fields.items.arrayValue.values || [];
            for (const item of values) {
                const fields = item.mapValue.fields;
                releases.push({
                    card_name: fields.card_name?.stringValue || '',
                    section: fields.section?.stringValue || '',
                    release_date: fields.release_date?.stringValue || '',
                    last_notification_date: fields.last_notification_date?.stringValue || null
                });
            }
        }

        return releases;
    } catch (error) {
        console.error('Error loading expected releases:', error);
        return null;
    }
}

function markExpectedReleasesDirty() {
    const now = new Date().toISOString();
    statements.setExpectedReleasesDirty.run(now);
    console.log('[i] Expected releases marked as dirty');
}

function clearExpectedReleasesDirty() {
    statements.deleteStatistic.run('dirty_expected_releases');
    console.log('[i] Expected releases dirty flag cleared');
}

// Принудительная синхронизация ВСЕХ разделов
ipcMain.handle('sync-all-sections-to-cloud', async () => {


    const storedUser = getStoredUser();
    if (!storedUser || !storedUser.is_authenticated || !storedUser.id_token) {
        return { success: false, error: 'Not authenticated' };
    }

    const freshToken = await getValidToken();
    if (!freshToken) {
        return { success: false, error: 'No valid token' };
    }

    try {
        const sections = ['games', 'movies', 'cartoons', 'serials', 'anime', 'books'];
        for (const section of sections) {
            const sectionData = statements.getDataBySection.all(section);
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
    const stmt = db.prepare('UPDATE data_cards SET description = ? WHERE name = ? AND section = ?');
    const result = stmt.run(description, name, section);
    markSectionDirty(section);
    const now = new Date().toISOString();
    statements.setStatistic.run('last_firestore_update', now, now);
    return result;
});

ipcMain.handle('get-all-tags', async () => {
    return statements.getAllTags.all();
});

ipcMain.handle('search-tags', async (event, query) => {
    return statements.searchTags.all(`${query}%`).map(row => row.name);
});

ipcMain.handle('get-card-tags', async (event, section, cardName) => {
    return statements.getTagsByCard.all(cardName).map(row => row.tag_name);
});

ipcMain.handle('update-card-tags', async (event, section, cardName, newTags) => {
    const oldTags = statements.getTagsByCard.all(cardName).map(row => row.tag_name);
    const removedTags = oldTags.filter(tag => !newTags.includes(tag));
    const addedTags = newTags.filter(tag => !oldTags.includes(tag));
    statements.clearCardTags.run(cardName);

    for (const tag of newTags) {
        statements.addTagToCard.run(cardName, tag);
    }

    for (const tag of removedTags) {
        statements.removeTagCount.run(tag);
        statements.deleteTagIfZero.run(tag);
    }

    for (const tag of addedTags) {
        statements.addOrUpdateTag.run(tag);
    }

    markSectionDirty(section);
    markTagsDirty();
    const now = new Date().toISOString();
    statements.setStatistic.run('last_firestore_update', now, now);

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

ipcMain.handle('search-litres-book', async (event, title) => {
    return await fetchLitresBookTags(title);
});

ipcMain.handle('search-kinopoisk-movie', async (event, title) => {
    return await fetchKinopoiskMovieTags(title);
});

// ========== ОБРАБОТЧИК IPC ДЛЯ YUMMYANI ==========
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
    return statements.getRatings
        .all()
        .map(row => row.rating);
});

ipcMain.handle('get-statuses', () => {
    return statements.getStatuses
        .all()
        .map(row => row.status);
});

ipcMain.handle('get-statuses-no-import', () => {
    return statements.getStatusesNoImport
        .all()
        .map(row => row.status);
});

ipcMain.handle('get-data', async (event, section) => {
    return statements.getDataBySection.all(section);
});

ipcMain.handle('add-data', async (event, section, data) => {
    const result = statements.addData.run(
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
            statements.addTagToCard.run(data.name, tag);
            statements.addOrUpdateTag.run(tag);
        }
        markTagsDirty();
    }

    // Сохраняем дату релиза, если передана
    if (data.releaseDate) {
        statements.setExpectedRelease.run(data.name, section, data.releaseDate, null);
        markExpectedReleasesDirty();
        console.log(`[AddData] Saved release date for "${data.name}": ${data.releaseDate}`);
    }

    markSectionDirty(section);
    const now = new Date().toISOString();
    statements.setStatistic.run('last_firestore_update', now, now);

    return result;
});

ipcMain.handle('delete-data', async (event, section, dataName) => {
    // Сначала получаем теги карточки
    const tags = statements.getTagsByCard.all(dataName).map(row => row.tag_name);

    // Удаляем связи тегов
    statements.clearCardTags.run(dataName);
    statements.deleteExpectedRelease.run(dataName, section);


    // Удаляем карточку
    const result = statements.deleteData.run(dataName, section);

    // Обновляем счётчики тегов
    for (const tag of tags) {
        statements.removeTagCount.run(tag);
        statements.deleteTagIfZero.run(tag);
    }

    markSectionDirty(section);
    markExpectedReleasesDirty();
    const now = new Date().toISOString();
    statements.setStatistic.run('last_firestore_update', now, now);

    return result;
});

ipcMain.handle('move-to-category', async (event, data) => {
    // Удаляем из старой категории
    const result = statements.addData.run(data.name, data.newCategory, data.oldIcoUrl || null, data.oldRating || '0', data.oldStatus || 'Уточнить', data.oldDescription);
    statements.deleteData.run(data.name, data.oldCategory);
    markSectionDirty(data.newCategory);
    markSectionDirty(data.oldCategory);
    const now = new Date().toISOString();
    statements.setStatistic.run('last_firestore_update', now, now);

    return result;
});

ipcMain.handle('update-data', async (event, section, oldName, newName, newIcoUrl) => {
    const result = statements.updateData.run(newName, newIcoUrl, oldName, section);
    markSectionDirty(section);
    // Обновляем локальное время синхронизации
    const now = new Date().toISOString();
    statements.setStatistic.run('last_firestore_update', now, now);

    return result;
});

ipcMain.handle('update-data-rating', async (event, section, dataName, rating) => {
    const result = statements.updateDataRating.run(rating, dataName, section);
    markSectionDirty(section);
    // Обновляем локальное время синхронизации
    const now = new Date().toISOString();
    statements.setStatistic.run('last_firestore_update', now, now);

    return result;
});

ipcMain.handle('update-data-status', async (event, section, dataName, status) => {
    const oldStatus = statements.getStatusByNameAndSection.get(dataName, section)?.status;
    const result = statements.updateDataStatus.run(status, dataName, section);

    if ((status === 'Ожидается' || status === 'В процессе') && oldStatus !== status) {
        // Запускаем в фоне
        fetchCardData(dataName, section).then(cardData => {
            if (cardData.releaseDate) {
                statements.setExpectedRelease.run(dataName, section, cardData.releaseDate, null);
                markExpectedReleasesDirty();
                if (win) {
                    win.webContents.send('release-date-updated', { cardName: dataName, section, releaseDate: cardData.releaseDate });
                }
            }
        }).catch(err => console.error('Failed to fetch release date:', err));
    } else if ((oldStatus === 'Ожидается' || oldStatus === 'В процессе') && status !== 'Ожидается' && status !== 'В процессе') {
        statements.deleteExpectedRelease.run(dataName, section);
        markExpectedReleasesDirty();
    }

    markSectionDirty(section);
    const now = new Date().toISOString();
    statements.setStatistic.run('last_firestore_update', now, now);

    return result;
});

ipcMain.handle('check-duplicates', async (event, section, name) => {
    let countOfData = statements.getDataCount.get(name, section)?.allCount ?? 0;
    return countOfData > 0;
});

ipcMain.handle('export-data', async () => {
    const win = BrowserWindow.getFocusedWindow();

    try {
        // Получаем все данные из БД
        const data = {
            games: statements.getDataBySection.all('games'),
            movies: statements.getDataBySection.all('movies'),
            cartoons: statements.getDataBySection.all('cartoons'),
            serials: statements.getDataBySection.all('serials'),
            anime: statements.getDataBySection.all('anime'),
            books: statements.getDataBySection.all('books'),
            ratings: statements.getRatings.all().map(r => r.rating),
            statuses: statements.getStatuses.all().map(s => s.status)
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
        const isAuthed = storedUser && storedUser.is_authenticated && storedUser.id_token;

        // Импортируем данные в транзакции
        db.transaction(() => {
            // Импорт рейтингов и статусов
            if (data.ratings) {
                data.ratings.forEach(rating => {
                    db.prepare('INSERT OR IGNORE INTO ratings (rating) VALUES (?)').run(rating);
                });
            }
            if (data.statuses) {
                data.statuses.forEach(status => {
                    db.prepare('INSERT OR IGNORE INTO statuses (status) VALUES (?)').run(status);
                });
            }

            const categories = Object.keys(data).filter(key =>
                key !== 'ratings' && key !== 'statuses'
            );

            for (const category of categories) {
                if (Array.isArray(data[category])) {
                    for (const item of data[category]) {
                        const existing = statements.getDataCount.get(item.name, category)?.allCount ?? 0;

                        if (existing > 0) {
                            statements.addData.run(
                                item.name, category, item.icoUrl || null,
                                item.rating || '0', 'Импортировано'
                            );
                        } else {
                            statements.importData.run(
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
        statements.setStatistic.run('last_firestore_update', now, now);

        if (isAuthed) {
            await syncDirtySections(storedUser.uid, storedUser.id_token);
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
        const isAuthed = storedUser && storedUser.is_authenticated && storedUser.id_token;

        // Очищаем и импортируем данные в транзакции
        db.transaction(() => {
            // Очищаем локальные таблицы
            db.exec('DELETE FROM tags_assign');
            db.exec('DELETE FROM data_cards');

            // Импортируем рейтинги и статусы
            if (data.ratings) {
                data.ratings.forEach(rating => {
                    db.prepare('INSERT OR IGNORE INTO ratings (rating) VALUES (?)').run(rating);
                });
            }
            if (data.statuses) {
                data.statuses.forEach(status => {
                    db.prepare('INSERT OR IGNORE INTO statuses (status) VALUES (?)').run(status);
                });
            }

            // Импортируем новые карточки
            const categories = Object.keys(data).filter(key =>
                key !== 'ratings' && key !== 'statuses'
            );

            for (const category of categories) {
                if (Array.isArray(data[category])) {
                    for (const item of data[category]) {
                        statements.importData.run(
                            item.name, category, item.icoUrl || null,
                            item.rating || '0', item.status || 'Уточнить', item.description || ''
                        );
                    }
                }
                markSectionDirty(category);
            }
        })();

        const now = new Date().toISOString();
        statements.setStatistic.run('last_firestore_update', now, now);

        if (isAuthed) {
            syncDirtySections(storedUser.uid, storedUser.id_token);
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
        syncUserData(user.uid, idToken, user.email).then(syncResult => {
            if (win && syncResult.needChoice) {
                win.webContents.send('sync-required', syncResult);
            }
        });

        return { success: true, email: user.email, uid: user.uid };
    } catch (error) {
        console.error('[x] Sign in error:', error);
        let errorMessage = 'Ошибка входа';
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

        syncUserData(user.uid, idToken, user.email).then(syncResult => {
            if (win && syncResult.needChoice) {
                win.webContents.send('sync-required', syncResult);
            }
        });

        return { success: true, email: user.email, uid: user.uid };
    } catch (error) {
        console.error('[x] Registration error:', error);
        let errorMessage = 'Ошибка регистрации';
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
        if (storedUser && storedUser.is_authenticated && storedUser.id_token) {
            syncDirtySections(storedUser.uid, storedUser.id_token);
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
    if (!storedUser || !storedUser.id_token) {
        return { success: false, error: 'Пользователь не авторизован' };
    }
    return await applySyncChoice(storedUser.uid, storedUser.id_token, choice, localData, remoteData);
});

ipcMain.handle('get-all-local-data', async () => {
    return getAllLocalData();
});

ipcMain.handle('save-release-date', async (event, cardName, section, releaseDate) => {
    // Проверяем, существует ли карточка и имеет ли она статус "Ожидается" или "В процессе"
    const card = statements.getStatusByNameAndSection.get(cardName, section);

    if (card) {
        // Если статус подходящий — сохраняем/обновляем в expected_releases
        const existing = statements.getExpectedRelease.get(cardName, section);
        if (existing) {
            statements.setExpectedRelease.run(cardName, section, releaseDate, existing.last_notification_date);
        } else {
            statements.setExpectedRelease.run(cardName, section, releaseDate, null);
        }
        markExpectedReleasesDirty();
        console.log(`[Release] Saved date for "${cardName}": ${releaseDate}`);
    }

    return { success: true };
});

ipcMain.handle('delete-release-date', async (event, cardName, section) => {
    statements.deleteExpectedRelease.run(cardName, section);
    markExpectedReleasesDirty();
    return { success: true };
});

ipcMain.handle('get-all-expected-releases', async () => {
    return statements.getAllExpectedReleases.all();
});

ipcMain.handle('fetch-card-data', async (event, title, section) => {
    return await fetchCardData(title, section);
});

ipcMain.handle('get-section-release-notifications', async (event, section) => {
    const releases = statements.getExpectedReleasesBySection.all(section);
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
    const existing = statements.getExpectedRelease.get(cardName, section);
    if (existing) {
        statements.setExpectedRelease.run(cardName, section, existing.release_date, new Date().toISOString());
        markExpectedReleasesDirty();
    }
    return { success: true };
});
