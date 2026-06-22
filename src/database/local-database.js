import Database from "better-sqlite3";
import {app} from "electron";
import path from "path";


const userDataPath = app.getPath('userData');
const dbPath = path.join(userDataPath, 'database.db');

export const db = new Database(dbPath, {
    timeout: 5000
});
db.pragma('journal_mode = WAL');


export function initializeDatabase() {
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
            section TEXT,
            tag_name TEXT,
            PRIMARY KEY (card_name, section, tag_name)
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
    db.exec(`
        CREATE TABLE IF NOT EXISTS favorites (
            card_name TEXT,
            section TEXT,
            PRIMARY KEY (card_name, section)
        )
    `);
    db.exec(`
        CREATE TABLE IF NOT EXISTS logs (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            section TEXT NOT NULL,
            entity_name TEXT NOT NULL,
            entity_section TEXT, 
            action TEXT NOT NULL,
            date TEXT NOT NULL,
            UNIQUE(section, entity_name)
        )
    `);

    //TODO: удалить после Лисы
    try {
        const tableInfo = db.prepare(`PRAGMA table_info(tags_assign)`).all();
        const hasSectionColumn = tableInfo.some(col => col.name === 'section');

        if (!hasSectionColumn) {
            console.log('[DB] Adding section column...');
            db.exec(`ALTER TABLE tags_assign ADD COLUMN section TEXT`);

            console.log('[DB] Section column added and populated');
        }
    } catch (error) {
        console.error('[DB] Error:', error);
    }
}
initializeDatabase();

export const statements = {
    //Общее
    getRatings: db.prepare('SELECT rating FROM ratings'),
    getStatuses: db.prepare('SELECT status FROM statuses where status <> \'Избранное\''),
    getStatusesNoImport: db.prepare(`SELECT status FROM statuses where status <> 'Импортировано' and status <> 'Избранное'`),
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
            (SELECT GROUP_CONCAT(tag_name, ',') 
             FROM tags_assign 
             WHERE card_name = data_cards.name AND section = data_cards.section) as tags
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
        INSERT INTO tags (name, count) VALUES (?, ?)
        ON CONFLICT(name) DO UPDATE SET count = count + 1
    `),
    removeTagCount: db.prepare(`
        UPDATE tags SET count = count - 1 WHERE name = ?
    `),
    deleteTagIfZero: db.prepare(`
        DELETE FROM tags WHERE name = ? AND count <= 0
    `),
    getTagsByCard: db.prepare(`
        SELECT tag_name FROM tags_assign WHERE card_name = ? AND section = ?
    `),
    updateTagsCardName: db.prepare(`
        UPDATE tags_assign SET card_name = ? WHERE card_name = ? AND section = ?
    `),
    deleteTagsBySection: db.prepare(`
        DELETE FROM tags_assign WHERE section = ?
    `),
    addTagToCard: db.prepare(`
        INSERT OR IGNORE INTO tags_assign (card_name, section, tag_name)
        VALUES (?, ?, ?)
    `),
    removeTagFromCard: db.prepare(`
        DELETE FROM tags_assign WHERE card_name = ? AND section = ? AND tag_name = ?
    `),
    clearAllTags: db.prepare('DELETE FROM tags'),
    getTagCount: db.prepare('SELECT count FROM tags WHERE name = ?'),
    clearCardTags: db.prepare(`
        DELETE FROM tags_assign WHERE card_name = ? AND section = ?
    `),
    searchTags: db.prepare(`
        SELECT name FROM tags WHERE name LIKE ? ORDER BY count DESC LIMIT 10
    `),
    getExpectedRelease: db.prepare('SELECT * FROM expected_releases WHERE card_name = ? AND section = ?'),
    setExpectedRelease: db.prepare(`
        INSERT OR REPLACE INTO expected_releases (card_name, section, release_date, last_notification_date)
        VALUES (?, ?, ?, ?)
    `),
    deleteExpectedRelease: db.prepare('DELETE FROM expected_releases WHERE card_name = ? AND section = ?'),

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
    `),

    // ====== ИЗБРАННОЕ ======
    addFavorite: db.prepare(`
        INSERT OR IGNORE INTO favorites (card_name, section) VALUES (?, ?)
    `),
    removeFavorite: db.prepare(`
        DELETE FROM favorites WHERE card_name = ? AND section = ?
    `),
    isFavorite: db.prepare(`
        SELECT 1 FROM favorites WHERE card_name = ? AND section = ?
    `),
    getFavoritesBySection: db.prepare(`
        SELECT card_name FROM favorites WHERE section = ?
    `),
    getAllFavorites: db.prepare(`
        SELECT card_name, section FROM favorites
    `),
    clearFavorites: db.prepare(`
        DELETE FROM favorites
    `),
    updateFavoriteSection: db.prepare(`
        UPDATE favorites SET section = ? WHERE card_name = ? AND section = ?
    `),
    deleteFavoritesByCard: db.prepare(`
        DELETE FROM favorites WHERE card_name = ? AND section = ?
    `),
    getSectionUpdatedAt: db.prepare(`
        SELECT value FROM app_statistics WHERE info = ?
    `),

    setSectionUpdatedAt: db.prepare(`
        INSERT OR REPLACE INTO app_statistics (info, value, actual_date)
        VALUES (?, ?, ?)
    `),
    addLog: db.prepare(`
        INSERT OR REPLACE INTO logs (section, entity_name, entity_section, action, date)
        VALUES (?, ?, ?, ?, ?)
    `),

    getLogsBySection: db.prepare(`
        SELECT * FROM logs WHERE section = ? ORDER BY date ASC
    `),

    clearLogsBySection: db.prepare(`
        DELETE FROM logs WHERE section = ?
    `),

    hasLogsBySection: db.prepare(`
        SELECT COUNT(*) as count FROM logs WHERE section = ?
    `)
};

//functions

export function getAllLocalData() {
    const sections = ['games', 'movies', 'cartoons', 'serials', 'anime', 'books'];
    const allData = {};

    for (const section of sections) {
        allData[section] = statements.getDataBySection.all(section);
    }

    return allData;
}

export function saveAllLocalData(allData) {
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
                            statements.addTagToCard.run(item.name, section, tag);
                            statements.addOrUpdateTag.run(tag, 1);
                        }
                    }
                }
            }
        }
    });
    transaction();
}

export function saveUserSession(email, uid, idToken, refreshToken) {
    const stmt = db.prepare(`
        INSERT OR REPLACE INTO user_session (id, email, uid, id_token, refresh_token, is_authenticated, last_login)
        VALUES (1, ?, ?, ?, ?, 1, datetime('now'))
    `);
    stmt.run(email, uid, idToken, refreshToken);
    console.log('[i] Session saved with tokens');
}

export function clearUserSession() {
    const stmt = db.prepare(`
        UPDATE user_session 
        SET is_authenticated = 0, email = NULL, uid = NULL, id_token = NULL, last_login = NULL 
        WHERE id = 1
    `);
    stmt.run();
    console.log('[i] Session cleared');
}

export function getStoredUser() {
    const stmt = db.prepare(`SELECT email, uid, id_token as idToken, refresh_token, is_authenticated FROM user_session WHERE id = 1`);
    return stmt.get();
}

export function markSectionDirty(section) {
    const now = new Date().toISOString();
    statements.setStatistic.run(`dirty_${section}`, 'true', now);
}

export function markTagsDirty() {
    const now = new Date().toISOString();
    statements.setStatistic.run('dirty_tags', 'true', now);
}

export function isTagsDirty() {
    const dirty = statements.getStatistic.get('dirty_tags');
    return dirty && dirty.value === 'true';
}

export function clearTagsDirty() {
    statements.deleteStatistic.run('dirty_tags');
}

export function isSectionDirty(section) {
    const dirty = statements.getStatistic.get(`dirty_${section}`);
    return dirty && dirty.value === 'true';
}

export function clearSectionDirty(section) {
    statements.deleteStatistic.run(`dirty_${section}`);
}

export function markExpectedReleasesDirty() {
    const now = new Date().toISOString();
    statements.setExpectedReleasesDirty.run(now);
    console.log('[i] Expected releases marked as dirty');
}

export function clearExpectedReleasesDirty() {
    statements.deleteStatistic.run('dirty_expected_releases');
    console.log('[i] Expected releases dirty flag cleared');
}

export function isFavorite(cardName, section) {
    const result = statements.isFavorite.get(cardName, section);
    return !!result;
}

export function getFavoritesBySection(section) {
    return statements.getFavoritesBySection.all(section).map(row => row.card_name);
}

export function getAllFavorites() {
    return statements.getAllFavorites.all();
}

export function clearFavorites() {
    statements.clearFavorites.run();
}

export function markFavoritesDirty() {
    const now = new Date().toISOString();
    statements.setStatistic.run('dirty_favorites', 'true', now);
}

export function clearFavoritesDirty() {
    statements.deleteStatistic.run('dirty_favorites');
}

export function isFavoritesDirty() {
    const dirty = statements.getStatistic.get('dirty_favorites');
    return dirty && dirty.value === 'true';
}

export function removeFavoriteStatus() {
    // Проверяем, есть ли ещё карточки со статусом "Избранное"
    const count = db.prepare(`
        SELECT COUNT(*) as count FROM data_cards WHERE status = 'Избранное'
    `).get();

    if (count.count === 0) {
        // Удаляем статус из таблицы statuses
        db.prepare(`DELETE FROM statuses WHERE status = 'Избранное'`).run();
        console.log('[DB] Статус "Избранное" удалён из БД');
    } else {
        console.warn(`[DB] Осталось ${count.count} карточек со статусом "Избранное"!`);
    }
}

export function getAllTagsLocal() {
    return statements.getAllTags.all();
}

export function getTagByName(tagName) {
    const stmt = db.prepare('SELECT name, count FROM tags WHERE name = ?');
    return stmt.get(tagName);
}

export function getAllExpectedReleasesLocal() {
    return statements.getAllExpectedReleases.all();
}

export function getExpectedReleaseByName(cardName, sectionName) {
    return statements.getExpectedRelease.get(cardName, sectionName);
}

export function isExpectedReleasesDirty() {
    const dirty = statements.getStatistic.get('dirty_expected_releases');
    return dirty && dirty.value === 'true';
}

// ====== ДЛЯ ИЗБРАННОГО ======

export function getAllFavoritesLocal() {
    return statements.getAllFavorites.all();
}

export function getFavoriteByName(cardName) {
    const stmt = db.prepare('SELECT card_name, section FROM favorites WHERE card_name = ?');
    return stmt.get(cardName);
}

export function saveLocalTagsData(remoteTags) {
    // Очищаем существующие теги
    statements.clearAllTags.run();

    for (const tag of remoteTags) {
        statements.addOrUpdateTag.run(tag.name, tag.count || 1);
    }
}

export function saveLocalExpectedReleasesData(remoteReleases) {
    // Очищаем существующие даты
    statements.replaceAllExpectedReleases.run();

    for (const release of remoteReleases) {
        if (release.last_notification_date) {
            statements.setExpectedRelease.run(
                release.card_name,
                release.section,
                release.release_date,
                release.last_notification_date
            );
        }
    }
}

// ====== СОХРАНЕНИЕ ИЗБРАННОГО ЛОКАЛЬНО ======

export function saveLocalFavoritesData(remoteFavorites) {
    // Очищаем существующее избранное
    statements.clearFavorites.run();

    for (const fav of remoteFavorites) {
        statements.addFavorite.run(fav.card_name, fav.section);
    }
}

// database/local-database.js

export function saveLocalCardsData(section, cards) {
    statements.deleteTagsBySection.run(section);

    const deleteFavoritesStmt = db.prepare('DELETE FROM favorites WHERE section = ?');
    deleteFavoritesStmt.run(section);


    const deleteReleasesStmt = db.prepare('DELETE FROM expected_releases WHERE section = ?');
    deleteReleasesStmt.run(section);


    const deleteCardsStmt = db.prepare('DELETE FROM data_cards WHERE section = ?');
    deleteCardsStmt.run(section);

    // 5. Вставляем карточки
    for (const card of cards) {
        statements.addData.run(
            card.name,
            section,
            card.icoUrl || null,
            card.rating || '0',
            card.status || 'Уточнить',
            card.description || ''
        );

        // 6. Добавляем теги с section
        if (card.tags && Array.isArray(card.tags)) {
            for (const tag of card.tags) {
                statements.addTagToCard.run(card.name, section, tag);
                statements.addOrUpdateTag.run(tag, 1);
            }
        }
    }

    console.log(`Saved ${cards.length} cards in ${section}`);
}

export function getLocalUpdatedAt(section) {
    const info = `meta_${section}_updated_at`;
    const result = statements.getSectionUpdatedAt.get(info);
    return result ? result.value : null;
}

export function updateLocalUpdatedAt(section, updatedAt) {
    const info = `meta_${section}_updated_at`;
    const now = new Date().toISOString();
    statements.setSectionUpdatedAt.run(info, updatedAt, now);
}

export function getAllCardsBySection(section) {
    const cards = statements.getDataBySection.all(section);

    for (const card of cards) {
        if (card.tags) {
            card.tags = card.tags.split(',').filter(t => t);
        } else {
            card.tags = [];
        }
    }

    return cards;
}

export function clearLogs(section) {
    statements.clearLogsBySection.run(section);
    console.log(`🧹 Logs cleared for ${section}`);
}

export function getLogs(section) {
    return statements.getLogsBySection.all(section);
}

export function getCardByNameAndSection(section, cardName) {
    const stmt = db.prepare(`
        SELECT 
            name, 
            ico_url as icoUrl, 
            rating, 
            status, 
            description,
            (SELECT GROUP_CONCAT(tag_name, ',') 
             FROM tags_assign 
             WHERE card_name = ? AND section = ?) as tags
        FROM data_cards 
        WHERE section = ? AND name = ?
    `);
    const result = stmt.get(cardName, section, section, cardName);

    if (result && result.tags) {
        result.tags = result.tags.split(',').filter(t => t);
    } else if (result) {
        result.tags = [];
    }

    return result;
}

export function writeLog(section, entityName, action, entitySection = null) {
    const date = new Date().toISOString();

    // 1. Пишем лог (замена, если уже есть)
    statements.addLog.run(section, entityName, entitySection, action, date);

    // 2. Обновляем updated_at для этой секции
    const allSections = [
        'games', 'movies', 'books', 'serials', 'anime', 'cartoons',
        'tags',
        'expected_releases',
        'favorites'
    ];

    if (allSections.includes(section)) {
        const info = `meta_${section}_updated_at`;
        statements.setSectionUpdatedAt.run(info, date, date);
    }

    console.log(`📝 Log: ${action} ${entityName} in ${section}`);
}

export function getExpectedReleaseByNameAndSection(cardName, section) {
    return statements.getExpectedRelease.get(cardName, section);
}
