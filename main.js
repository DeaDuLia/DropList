const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const Database = require('better-sqlite3');

const db = new Database('database.db');

// Создаём таблицы при запуске
db.exec(`
  CREATE TABLE IF NOT EXISTS game_ratings (
    game_rating TEXT PRIMARY KEY
  )
`);

db.exec(`
  INSERT OR IGNORE INTO game_ratings (game_rating)
  VALUES
  ('completed'),
  ('Now playing'),
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
  CREATE TABLE IF NOT EXISTS game_tags (
    tag_name TEXT PRIMARY KEY
  )
`);

db.exec(`
  CREATE TABLE IF NOT EXISTS games (
    game_name TEXT PRIMARY KEY,
    game_ico_url TEXT,
    game_video_url TEXT,
    game_rating TEXT,
    FOREIGN KEY (game_rating)  REFERENCES game_ratings (game_rating)
  )
`);

db.exec(`
  CREATE TABLE IF NOT EXISTS game_tags_assign (
    game_name TEXT,
    tag_name TEXT,
    PRIMARY KEY (game_name, tag_name),
    FOREIGN KEY (game_name) REFERENCES games (game_name),
    FOREIGN KEY (tag_name) REFERENCES game_tags (tag_name)
  )
`);

function createWindow() {
    const win = new BrowserWindow({
        width: 800,
        height: 600,
        webPreferences: {
            partition: 'youtube-partition',
            webSecurity: true,
            nodeIntegration: false,
            contextIsolation: true,
            preload: path.join(__dirname, 'preload.js')
        }
    });

    win.loadFile('index.html');
}


app.whenReady().then(createWindow);

ipcMain.handle('get-games-with-tags', () => {
    return db.prepare(`
    SELECT 
      game_name as gameName,
      game_ico_url as icoUrl,
      game_video_url as videoUrl,
      game_rating as gameRating
    FROM games
  `).all();
});

ipcMain.handle('add-game', (event, gameData) => {
    const stmt = db.prepare(`
    INSERT OR REPLACE INTO games 
    (game_name, game_ico_url, game_video_url, game_rating) 
    VALUES (?, ?, ?, ?)
  `);
    return stmt.run(
        gameData.name,
        gameData.icoUrl || null,
        gameData.videoUrl || null,
        gameData.rating
    );
});

ipcMain.handle('get-game-ratings', () => {
    return db.prepare('SELECT game_rating FROM game_ratings')
        .all()
        .map(row => row.game_rating);
});