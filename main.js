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

app.name = 'DropList';
app.setName('DropList');
if (process.platform === 'win32') {
    app.setAppUserModelId('com.deshin.droplist');
}

// ========== НОВЫЕ ФУНКЦИИ ДЛЯ СИНХРОНИЗАЦИИ ==========

// Получить ВСЕ данные из локальной SQLite (один запрос)
function getAllLocalData() {
    const sections = ['games', 'movies', 'cartoons', 'serials', 'anime', 'books'];
    const allData = {};

    for (const section of sections) {
        allData[section] = statements.getDataBySection.all(section);
    }

    return allData;
}

// Сохранить ВСЕ данные в локальную SQLite (транзакцией)
function saveAllLocalData(allData) {
    const sections = ['games', 'movies', 'cartoons', 'serials', 'anime', 'books'];

    const transaction = db.transaction(() => {
        // Очищаем все секции
        for (const section of sections) {
            db.prepare(`DELETE FROM data_cards WHERE section = ?`).run(section);
        }

        // Вставляем новые данные
        for (const [section, items] of Object.entries(allData)) {
            if (items && Array.isArray(items)) {
                for (const item of items) {
                    statements.importData.run(
                        item.name, section, item.icoUrl || null,
                        item.rating || '0', item.status || 'Уточнить', item.description || ''
                    );
                }
            }
        }
    });

    transaction();
}

// Синхронизация: сравнить время и показать выбор
async function syncUserData(uid, idToken, email) {
    try {
        // Получаем локальное время
        const localLastSync = statements.getStatistic.get('last_firestore_update');
        const localSyncTime = localLastSync ? localLastSync.value : null;

        // Получаем удалённое время
        const remoteSyncTime = await getSyncTime(uid, idToken);

        // Если нет удалённого времени — сохраняем локальное
        if (!remoteSyncTime) {
            const localData = getAllLocalData();
            const sections = ['games', 'movies', 'cartoons', 'serials', 'anime', 'books'];
            for (const section of sections) {
                await saveSectionToFirestore(uid, idToken, section, localData[section] || []);
            }
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
        const now = new Date().toISOString();

        if (choice === 'local') {
            // Сохраняем все локальные разделы в Firestore
            const sections = ['games', 'movies', 'cartoons', 'serials', 'anime', 'books'];
            for (const section of sections) {
                await saveSectionToFirestore(uid, idToken, section, localData[section] || []);
            }
            await updateSyncTime(uid, idToken, now);
            statements.setStatistic.run('last_firestore_update', now, now);
            return { success: true, source: 'local' };

        } else if (choice === 'remote') {
            // Сохраняем удалённые данные локально
            saveAllLocalData(remoteData);
            await updateSyncTime(uid, idToken, now);
            statements.setStatistic.run('last_firestore_update', now, now);
            return { success: true, source: 'remote' };
        }

        return { success: false, error: 'Неверный выбор' };
    } catch (error) {
        console.error('Apply sync error:', error);
        return { success: false, error: error.message };
    }
}

// Функция для пакетной синхронизации после любого изменения


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

// Функция для получения релизов с GitHub
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

// Функция сравнения версий
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

// Функция для пропуска версии
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
            id_token TEXT,  -- СОХРАНЯЕМ ТОКЕН СУКА
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
        CREATE TABLE IF NOT EXISTS app_statistics (
            info TEXT PRIMARY KEY,
            value TEXT,
            actual_date DATETIME NOT NULL
        )
    `);
}

function saveUserSession(email, uid, idToken) {
    const stmt = db.prepare(`
        INSERT OR REPLACE INTO user_session (id, email, uid, id_token, is_authenticated, last_login)
        VALUES (1, ?, ?, ?, 1, datetime('now'))
    `);
    stmt.run(email, uid, idToken);
    console.log('[i] Session saved with token:', idToken ? `${idToken.substring(0, 30)}...` : 'NO TOKEN');
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
    const stmt = db.prepare(`SELECT email, uid, id_token, is_authenticated FROM user_session WHERE id = 1`);
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
        SELECT name as name, ico_url as icoUrl, 
               rating as rating, status as status 
        FROM data_cards WHERE section = ?`),
    addData: db.prepare(`
        INSERT OR REPLACE INTO data_cards 
        (name, section, ico_url, rating, status) 
        VALUES (?, ?, ?, ?, ?)`),
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
    getAllStatistics: db.prepare('SELECT info, value, actual_date FROM app_statistics')
};

let win;
function createWindow() {
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

    // ⚡⚡⚡ СНАЧАЛА ДОСТАЁМ ПОЛЬЗОВАТЕЛЯ ИЗ БД
    const storedUser = getStoredUser();

    // ⚡⚡⚡ ТУТ ЖЕ ФИГАЧИМ ЗАПИСЬ В FIRESTORE, ПОКА СТРАНИЦА ГРУЗИТСЯ
    if (storedUser && storedUser.is_authenticated && storedUser.id_token) {
        console.log('[i] IMMEDIATE DATA RESTORE');
        syncUserData(storedUser.uid, storedUser.id_token, storedUser.email).then(syncResult => {
            if (win && syncResult.needChoice) {
                win.webContents.send('sync-required', syncResult);
            }
        }).catch(err => console.error('Data Sync Error:', err));
    }

    // ТОЛЬКО ПОСЛЕ ЭТОГО ЗАГРУЖАЕМ СТРАНИЦУ
    win.loadFile('index.html');

    // А ЭТО ОТПРАВЛЯЕТ ДАННЫЕ НА ФРОНТ, КОГДА СТРАНИЦА УЖЕ ЗАГРУЗИЛАСЬ
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
    const result = statements.addData.run(data.name, section, data.icoUrl || null, data.rating, data.status || 'Уточнить');
    markSectionDirty(section);
    // Обновляем локальное время синхронизации (данные изменились)
    const now = new Date().toISOString();
    statements.setStatistic.run('last_firestore_update', now, now);

    return result;
});

ipcMain.handle('delete-data', async (event, section, dataName) => {
    const result = statements.deleteData.run(dataName, section);
    markSectionDirty(section);
    // Обновляем локальное время синхронизации
    const now = new Date().toISOString();
    statements.setStatistic.run('last_firestore_update', now, now);

    return result;
});

ipcMain.handle('move-to-category', async (event, data) => {
    // Удаляем из старой категории
    statements.deleteData.run(data.name, data.oldCategory);
    // Добавляем в новую категорию
    const result = statements.addData.run(data.name, data.newCategory, data.oldIcoUrl || null, data.oldRating || '0', data.oldStatus || 'Уточнить');
    markSectionDirty(data.newCategory);
    markSectionDirty(data.oldCategory);
    // Обновляем локальное время синхронизации
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
    const result = statements.updateDataStatus.run(status, dataName, section);
    markSectionDirty(section);
    // Обновляем локальное время синхронизации
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

        saveUserSession(user.email, user.uid, idToken);

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
        console.log('[i] Registration:', email);

        const userCredential = await createUserWithEmailAndPassword(auth, email, password);
        const user = userCredential.user;

        const idToken = await user.getIdToken();

        saveUserSession(user.email, user.uid, idToken);

        // 👇 НЕ ЖДЁМ
        syncUserData(user.uid, idToken, user.email).then(syncResult => {
            if (win && syncResult.needChoice) {
                win.webContents.send('sync-required', syncResult);
            }
        }).catch(err => console.error('Sync error:', err));

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

async function saveSectionToFirestore(uid, idToken, section, items) {
    // Правильный URL для подколлекции
    const url = `https://firestore.googleapis.com/v1/projects/${firebaseConfig.projectId}/databases/(default)/documents/users/${uid}/sections/${section}`;

    const body = {
        fields: {
            items: {
                arrayValue: {
                    values: items.map(item => ({
                        mapValue: {
                            fields: {
                                name: { stringValue: item.name || '' },
                                icoUrl: { stringValue: item.icoUrl || '' },
                                rating: { stringValue: item.rating || '0' },
                                status: { stringValue: item.status || 'Уточнить' },
                                description: { stringValue: item.description || '' }
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
                items.push({
                    name: fields.name?.stringValue || '',
                    icoUrl: fields.icoUrl?.stringValue || '',
                    rating: fields.rating?.stringValue || '0',
                    status: fields.status?.stringValue || 'Уточнить',
                    description: fields.description?.stringValue || ''
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
    // Используем главный документ пользователя
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
    // Получаем главный документ пользователя
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


// Принудительная синхронизация ВСЕХ разделов
ipcMain.handle('sync-all-sections-to-cloud', async () => {
    const storedUser = getStoredUser();
    if (!storedUser || !storedUser.is_authenticated || !storedUser.id_token) {
        return { success: false, error: 'Not authenticated' };
    }

    try {
        const sections = ['games', 'movies', 'cartoons', 'serials', 'anime', 'books'];
        for (const section of sections) {
            const sectionData = statements.getDataBySection.all(section);
            await saveSectionToFirestore(storedUser.uid, storedUser.id_token, section, sectionData);
        }

        const now = new Date().toISOString();
        await updateSyncTime(storedUser.uid, storedUser.id_token, now);

        console.log('✅ All sections synced to cloud');
        return { success: true };
    } catch (error) {
        console.error('[x] Failed to sync all sections:', error);
        return { success: false, error: error.message };
    }
});

function markSectionDirty(section) {
    const now = new Date().toISOString();
    statements.setStatistic.run(`dirty_${section}`, 'true', now);
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
    const sections = ['games', 'movies', 'cartoons', 'serials', 'anime', 'books'];
    const dirtySections = sections.filter(section => isSectionDirty(section));

    if (dirtySections.length === 0) {
        console.log('[i] No dirty sections, skipping sync');
        return false;
    }

    console.log(`[i] Syncing dirty sections: ${dirtySections.join(', ')}`);

    for (const section of dirtySections) {
        const sectionData = statements.getDataBySection.all(section);
        await saveSectionToFirestore(uid, idToken, section, sectionData);
        clearSectionDirty(section);
    }

    const now = new Date().toISOString();
    await updateSyncTime(uid, idToken, now);
    statements.setStatistic.run('last_firestore_update', now, now);

    return true;
}
