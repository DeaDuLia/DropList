import {fetchKupikodPrice, fetchSteamGameTags} from "./game-search.js";
import {fetchFilmRuSerialsTags, fetchKinopoiskMovieTags} from "./movie-search.js";
import {fetchChitaiGorodBook, fetchLitresBookTags} from "./book-search.js";
import {BrowserWindow} from "electron";
import {db, markExpectedReleasesDirty, statements} from "../../database/local-database.js";
import {fetchAnimeGoTags, fetchYummyAniTags} from "./anime-search.js";
let activeParsingWindows = new Set();

export const DEFAULT_USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

export function closeAllParsingWindows() {
    for (const win of activeParsingWindows) {
        if (win && !win.isDestroyed()) {
            destroyWindowCompletely(win);
        }
    }
    activeParsingWindows.clear();
}

export function destroyWindowCompletely(win) {
    if (!win || win.isDestroyed()) return;

    try {
        // 1. Останавливаем загрузку
        if (win.webContents && !win.webContents.isDestroyed()) {
            win.webContents.stop();


            win.webContents.session.clearStorageData({
                storages: ['cookies', 'localstorage', 'sessionstorage', 'cache']
            });

            // 3. Сброс HTTP/2 соединений
            win.webContents.session.closeAllConnections?.();

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

export function trackParsingWindow(win) {
    activeParsingWindows.add(win);
    win.once('closed', () => {
        activeParsingWindows.delete(win);
    });
}

export async function parseSite(name, searchUrl, targetUrlParser, dataParser, needExtraWait = false, isParallel = false) {
    if(!isParallel) { closeAllParsingWindows(); }
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
                if (hiddenWindow && !hiddenWindow.isDestroyed()) {
                    hiddenWindow.webContents.stop();
                }
                resolve();
            }, 2000);
            hiddenWindow.webContents.once('did-finish-load', () => {
                clearTimeout(loadTimeout);
                resolve();
            });
        });
    };

    try {
        trackParsingWindow(hiddenWindow);
        hiddenWindow.loadURL(searchUrl);

        if (needExtraWait) { await new Promise(r => setTimeout(r, 2000)); }
        await waitForPageLoad();
        if (!hiddenWindow || hiddenWindow.isDestroyed()) {
            return { tags: [], description: '', coverUrl: '', fullTitle: '', releaseDate: null };
        }
        let targetUrl = await hiddenWindow.webContents.executeJavaScript(targetUrlParser);

        if (!targetUrl) {
            cleanup();
            return { tags: [], description: '', coverUrl: '', fullTitle: '', releaseDate: null };
        }
        hiddenWindow.loadURL(targetUrl);
        await waitForPageLoad();
        if (!hiddenWindow || hiddenWindow.isDestroyed()) {
            return { tags: [], description: '', coverUrl: '', fullTitle: '', releaseDate: null };
        }
        let result = await hiddenWindow.webContents.executeJavaScript(dataParser);
        cleanup();
        return result;
    } catch (error) {
        console.error(`[${name}] Error:`, error);
        cleanup();
        return { tags: [], description: '', coverUrl: '', fullTitle: '', releaseDate: null };
    }
}
export function createHiddenWindow() {
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

export async function fetchCardData(cardName, section) {
    switch (section) {
        case 'anime':
            let animeResult = await fetchAnimeGoTags(cardName);
            if (animeResult == null || animeResult.tags === null || animeResult.tags.length === 0) {
                animeResult = await fetchYummyAniTags(cardName);
            }
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
            console.log(bookResult);
            if (bookResult == null || bookResult.tags === null || bookResult.tags.length === 0) {
                bookResult = await fetchLitresBookTags(cardName);
            }
            return { tags: bookResult?.tags || [], coverUrl: bookResult?.coverUrl || '', fullTitle: bookResult?.fullTitle || '', releaseDate: bookResult?.releaseDate || null };
        default:
            return { tags: [], coverUrl: '', fullTitle: '', releaseDate: null };
    }
}

export async function updateAllReleaseDates() {
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