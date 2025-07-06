const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const Database = require('better-sqlite3');

const db = new Database('database.db');

// Создаём таблицы при запуске
db.exec(`
  CREATE TABLE IF NOT EXISTS ratings (
    rating TEXT PRIMARY KEY
  )
`);

db.exec(`
  INSERT OR IGNORE INTO ratings (rating)
  VALUES
  ('0'),
  ('1'),
  ('2'),
  ('3'),
  ('4'),
  ('5'),
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
  ('Не играл'),
  ('Играл'),
  ('Играю сейчас'),
  ('Завершено')
`);

db.exec(`
  CREATE TABLE IF NOT EXISTS game_tags (
    tag_name TEXT PRIMARY KEY
  )
`);

db.exec(`
  CREATE TABLE IF NOT EXISTS games (
    name TEXT PRIMARY KEY,
    ico_url TEXT,
    video_url TEXT,
    rating TEXT,
    status TEXT,
    FOREIGN KEY (rating)  REFERENCES ratings (rating),
    FOREIGN KEY (status)  REFERENCES statuses (status)
    
  )
`);

db.exec(`
  CREATE TABLE IF NOT EXISTS game_tags_assign (
    game_name TEXT,
    tag_name TEXT,
    PRIMARY KEY (game_name, tag_name),
    FOREIGN KEY (game_name) REFERENCES games (name),
    FOREIGN KEY (tag_name) REFERENCES game_tags (tag_name)
  )
`);

function createWindow() {
    const win = new BrowserWindow({
        width: 800,
        height: 600,
        webPreferences: {
            nodeIntegration: false,
            preload: path.join(__dirname, 'preload.js')
        }
    });

    win.loadFile('index.html');
}


app.whenReady().then(createWindow);

ipcMain.handle('get-games-with-tags', () => {
    return db.prepare(`
    SELECT 
      name as gameName,
      ico_url as icoUrl,
      rating as gameRating,
      status as gameStatus
    FROM games
  `).all();
});

ipcMain.handle('add-game', (event, gameData) => {
    const stmt = db.prepare(`
    INSERT OR REPLACE INTO games 
    (name, ico_url, rating, status) 
    VALUES (?, ?, ?, ?)
  `);
    return stmt.run(
        gameData.name,
        gameData.icoUrl || null,
        gameData.rating,
        gameData.status || 'Не играл'
    );
});

ipcMain.handle('get-game-ratings', () => {
    return db.prepare('SELECT rating FROM ratings')
        .all()
        .map(row => row.rating);
});

ipcMain.handle('get-game-statuses', () => {
    return db.prepare('SELECT status FROM statuses')
        .all()
        .map(row => row.status);
});

ipcMain.handle('delete-game', (event, gameName) => {
    const stmt = db.prepare('DELETE FROM games WHERE name = ?');
    return stmt.run(gameName);
});

ipcMain.handle('update-game-rating', async (event, gameName, rating) => {
    try {
        const stmt = db.prepare('UPDATE games SET rating = ? WHERE name = ?');
        return stmt.run(rating, gameName);
    } catch (error) {
        console.error('Error updating rating:', error);
        throw error;
    }
});

ipcMain.handle('update-game-status', async (event, gameName, status) => {
    try {
        const stmt = db.prepare('UPDATE games SET status = ? WHERE name = ?');
        return stmt.run(status, gameName);
    } catch (error) {
        console.error('Error updating status:', error);
        throw error;
    }
});