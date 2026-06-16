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

export const statements = {
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

