const { app, BrowserWindow, ipcMain, shell } = require('electron');
const path = require('path');
const Database = require('better-sqlite3');

const db = new Database('database.db', {
    timeout: 5000 // увеличить таймаут ожидания
});
db.pragma('journal_mode = WAL');

//Создаём таблицы при запуске
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
  ('Уточнить'),
  ('Смотрел'),
  ('В планах'),
  ('В процессе'),
  ('Завершено'),
  ('Избранное')
`);
//Игры
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
//Фильмы
db.exec(`
  CREATE TABLE IF NOT EXISTS movie_tags (
    tag_name TEXT PRIMARY KEY
  )
`);
db.exec(`
  CREATE TABLE IF NOT EXISTS movies (
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
  CREATE TABLE IF NOT EXISTS movie_tags_assign (
    movie_name TEXT,
    tag_name TEXT,
    PRIMARY KEY (movie_name, tag_name),
    FOREIGN KEY (movie_name) REFERENCES movies (name),
    FOREIGN KEY (tag_name) REFERENCES game_tags (tag_name)
  )
`);
//Сериалы
db.exec(`
  CREATE TABLE IF NOT EXISTS serial_tags (
    tag_name TEXT PRIMARY KEY
  )
`);
db.exec(`
  CREATE TABLE IF NOT EXISTS serials (
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
  CREATE TABLE IF NOT EXISTS serial_tags_assign (
    serial_name TEXT,
    tag_name TEXT,
    PRIMARY KEY (serial_name, tag_name),
    FOREIGN KEY (serial_name) REFERENCES serials (name),
    FOREIGN KEY (tag_name) REFERENCES game_tags (tag_name)
  )
`);
//Аниме
db.exec(`
  CREATE TABLE IF NOT EXISTS anime_tags (
    tag_name TEXT PRIMARY KEY
  )
`);
db.exec(`
  CREATE TABLE IF NOT EXISTS anime (
    name TEXT PRIMARY KEY,
    ico_url TEXT,
    video_url TEXT,
    rating TEXT,
    status TEXT,
    FOREIGN KEY (rating) REFERENCES ratings (rating),
    FOREIGN KEY (status) REFERENCES statuses (status)
  )
`);
db.exec(`
  CREATE TABLE IF NOT EXISTS anime_tags_assign (
    anime_name TEXT,
    tag_name TEXT,
    PRIMARY KEY (anime_name, tag_name),
    FOREIGN KEY (anime_name) REFERENCES anime (name),
    FOREIGN KEY (tag_name) REFERENCES game_tags (tag_name)
  )
`);
//Книги
db.exec(`
  CREATE TABLE IF NOT EXISTS book_tags (
    tag_name TEXT PRIMARY KEY
  )
`);
db.exec(`
  CREATE TABLE IF NOT EXISTS books (
    name TEXT PRIMARY KEY,
    ico_url TEXT,
    video_url TEXT,
    rating TEXT,
    status TEXT,
    FOREIGN KEY (rating) REFERENCES ratings (rating),
    FOREIGN KEY (status) REFERENCES statuses (status)
  )
`);
db.exec(`
  CREATE TABLE IF NOT EXISTS book_tags_assign (
    book_name TEXT,
    tag_name TEXT,
    PRIMARY KEY (book_name, tag_name),
    FOREIGN KEY (book_name) REFERENCES books (name),
    FOREIGN KEY (tag_name) REFERENCES game_tags (tag_name)
  )
`);

const statements = {
    //Общее
    getRatings: db.prepare('SELECT rating FROM ratings'),
    getStatuses: db.prepare('SELECT status FROM statuses'),
    //Игры
    getGames: db.prepare(`
        SELECT name as name, ico_url as icoUrl, 
               rating as rating, status as status 
        FROM games`),
    addGame: db.prepare(`
        INSERT OR REPLACE INTO games 
        (name, ico_url, rating, status) 
        VALUES (?, ?, ?, ?)`),
    deleteGame: db.prepare('DELETE FROM games WHERE name = ?'),
    updateGameRating: db.prepare('UPDATE games SET rating = ? WHERE name = ?'),
    updateGameStatus: db.prepare('UPDATE games SET status = ? WHERE name = ?'),
    //Фильмы
    getMovies: db.prepare(`
        SELECT name as name, ico_url as icoUrl, 
               rating as rating, status as status 
        FROM movies`),
    addMovie: db.prepare(`
        INSERT OR REPLACE INTO movies 
        (name, ico_url, rating, status) 
        VALUES (?, ?, ?, ?)`),
    deleteMovie: db.prepare('DELETE FROM movies WHERE name = ?'),
    updateMovieRating: db.prepare('UPDATE movies SET rating = ? WHERE name = ?'),
    updateMovieStatus: db.prepare('UPDATE movies SET status = ? WHERE name = ?'),
    //Сериалы
    getSerials: db.prepare(`
        SELECT name as name, ico_url as icoUrl, 
               rating as rating, status as status 
        FROM serials`),
    addSerial: db.prepare(`
        INSERT OR REPLACE INTO serials 
        (name, ico_url, rating, status) 
        VALUES (?, ?, ?, ?)`),
    deleteSerial: db.prepare('DELETE FROM serials WHERE name = ?'),
    updateSerialRating: db.prepare('UPDATE serials SET rating = ? WHERE name = ?'),
    updateSerialStatus: db.prepare('UPDATE serials SET status = ? WHERE name = ?'),
    //Аниме
    getAnime: db.prepare(`
        SELECT name as name, ico_url as icoUrl, 
               rating as rating, status as status 
        FROM anime`),
    addAnime: db.prepare(`
        INSERT OR REPLACE INTO anime 
        (name, ico_url, rating, status) 
        VALUES (?, ?, ?, ?)`),
    deleteAnime: db.prepare('DELETE FROM anime WHERE name = ?'),
    updateAnimeRating: db.prepare('UPDATE anime SET rating = ? WHERE name = ?'),
    updateAnimeStatus: db.prepare('UPDATE anime SET status = ? WHERE name = ?'),
    //Книги
    getBooks: db.prepare(`
        SELECT name as name, ico_url as icoUrl, 
               rating as rating, status as status 
        FROM books`),
    addBook: db.prepare(`
        INSERT OR REPLACE INTO books 
        (name, ico_url, rating, status) 
        VALUES (?, ?, ?, ?)`),
    deleteBook: db.prepare('DELETE FROM books WHERE name = ?'),
    updateBookRating: db.prepare('UPDATE books SET rating = ? WHERE name = ?'),
    updateBookStatus: db.prepare('UPDATE books SET status = ? WHERE name = ?')
};

function createWindow() {
    const win = new BrowserWindow({
        title: 'DECatalog',
        width: 800,
        height: 600,
        icon: path.join(__dirname, 'icon.ico'),
        webPreferences: {
            nodeIntegration: false,
            preload: path.join(__dirname, 'preload.js')
        }
    });
    win.setMenu(null)
    win.loadFile('index.html');

}


app.whenReady().then(createWindow);

app.on('before-quit', () => {
    db.pragma('wal_checkpoint(FULL)');
    db.close();
});

setInterval(() => {
    db.pragma('wal_checkpoint(RESTART)');
}, 30000);

// Общие
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
//Игры
ipcMain.handle('get-games-with-tags', () => {
    return statements.getGames.all();
});
ipcMain.handle('add-game', (event, gameData) => {
    return db.transaction(() => {
        return statements.addGame.run(
            gameData.name,
            gameData.icoUrl || null,
            gameData.rating,
            gameData.status || 'Не играл'
        );
    })();
});
ipcMain.handle('delete-game', (event, gameName) => {
    return db.transaction(() => {
        return statements.deleteGame.run(gameName)
    })();
});
ipcMain.handle('update-game-rating', async (event, gameName, rating) => {
    return db.transaction(() => {
        return statements.updateGameRating.run(rating, gameName);
    })();
});
ipcMain.handle('update-game-status', async (event, gameName, status) => {
    return db.transaction(() => {
        return statements.updateGameStatus.run(status, gameName);
    })();
});
//Фильмы
ipcMain.handle('get-movies-with-tags', () => {
    return statements.getMovies.all();
});
ipcMain.handle('add-movie', (event, movieData) => {
    return db.transaction(() => {
        return statements.addMovie.run(
            movieData.name,
            movieData.icoUrl || null,
            movieData.rating,
            movieData.status || 'Не играл'
        );
    })();
});
ipcMain.handle('delete-movie', (event, movieName) => {
    return db.transaction(() => {
        return statements.deleteMovie.run(movieName)
    })();
});
ipcMain.handle('update-movie-rating', async (event, movieName, rating) => {
    return db.transaction(() => {
        return statements.updateMovieRating.run(rating, movieName);
    })();
});
ipcMain.handle('update-movie-status', async (event, movieName, status) => {
    return db.transaction(() => {
        return statements.updateMovieStatus.run(status, movieName);
    })();
});
//Сериалы
ipcMain.handle('get-serials-with-tags', () => {
    return statements.getSerials.all();
});
ipcMain.handle('add-serial', (event, data) => {
    return db.transaction(() => {
        return statements.addSerial.run(
            data.name,
            data.icoUrl || null,
            data.rating,
            data.status || 'Не играл'
        );
    })();
});
ipcMain.handle('delete-serial', (event, name) => {
    return db.transaction(() => {
        return statements.deleteSerial.run(name)
    })();
});
ipcMain.handle('update-serial-rating', async (event, name, rating) => {
    return db.transaction(() => {
        return statements.updateSerialStatus.run(rating, name);
    })();
});
ipcMain.handle('update-serial-status', async (event, name, status) => {
    return db.transaction(() => {
        return statements.updateSerialStatus.run(status, name);
    })();
});
//Аниме
ipcMain.handle('get-anime-with-tags', () => {
    return statements.getAnime.all();
});
ipcMain.handle('add-anime', (event, data) => {
    return db.transaction(() => {
        return statements.addAnime.run(
            data.name,
            data.icoUrl || null,
            data.rating,
            data.status || 'Не играл'
        );
    })();
});
ipcMain.handle('delete-anime', (event, name) => {
    return db.transaction(() => {
        return statements.deleteAnime.run(name)
    })();
});
ipcMain.handle('update-anime-rating', async (event, name, rating) => {
    return db.transaction(() => {
        return statements.updateAnimeRating.run(rating, name);
    })();
});
ipcMain.handle('update-anime-status', async (event, name, status) => {
    return db.transaction(() => {
        return statements.updateAnimeStatus.run(status, name);
    })();
});
//Аниме
ipcMain.handle('get-books-with-tags', () => {
    return statements.getBooks.all();
});
ipcMain.handle('add-book', (event, data) => {
    return db.transaction(() => {
        return statements.addBook.run(
            data.name,
            data.icoUrl || null,
            data.rating,
            data.status || 'Не играл'
        );
    })();
});
ipcMain.handle('delete-book', (event, name) => {
    return db.transaction(() => {
        return statements.deleteBook.run(name)
    })();
});
ipcMain.handle('update-book-rating', async (event, name, rating) => {
    return db.transaction(() => {
        return statements.updateBookRating.run(rating, name);
    })();
});
ipcMain.handle('update-book-status', async (event, name, status) => {
    return db.transaction(() => {
        return statements.updateBookStatus.run(status, name);
    })();
});

ipcMain.on('open-external', (event, url) => {
    const externalWindow = new BrowserWindow({
        width: 1000,
        height: 800,
        icon: path.join(__dirname, 'icon.ico'),
        webPreferences: {
            nodeIntegration: false,
            contextIsolation: true
        }
    });
    externalWindow.setMenu(null)
    externalWindow.loadURL(url);

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
        externalWindow.webContents.executeJavaScript(`
            // Блокируем стандартное поведение ссылок
            document.querySelectorAll('a').forEach(link => {
                link.onclick = (e) => e.preventDefault();
            });
        
            // Стиль для подсветки div с jsname и их изображений
            const style = document.createElement('style');
            style.textContent = \`
                div[jsname]:hover {
                    cursor: pointer;
                    position: relative;
                }
                div[jsname]:hover::after {
                    content: '';
                    position: absolute;
                    top: 0;
                    left: 0;
                    right: 0;
                    bottom: 0;
                    outline: 2px solid #6c5ce7;
                    pointer-events: none;
                }
                div[jsname]:hover img {
                    opacity: 0.9;
                }
                a {
                    pointer-events: none;
                }
            \`;
            document.head.appendChild(style);

            // Обработчик кликов по div с jsname
            document.addEventListener('click', function(e) {
                // Ищем ближайший div с атрибутом jsname
                const img = e.target.querySelector('img');
                    
                    if (img && img.src) {
                        e.preventDefault();
                        e.stopPropagation();
                        handleImageClick(img);
                        return;
                    }
                
                // Дополнительно: обработка прямого клика по изображению
                if (e.target.tagName === 'IMG' && e.target.src) {
                    e.preventDefault();
                    e.stopPropagation();
                    handleImageClick(e.target);
                }
            });

            function handleImageClick(imgElement) {
                const isDataUrl = imgElement.src.startsWith('data:');
                
                navigator.clipboard.writeText(imgElement.src)
                    .then(() => {
                        showNotification(
                            isDataUrl 
                                ? 'Data-URL изображения скопирована' 
                                : 'Ссылка на изображение скопирована',
                            isDataUrl ? 'data' : 'url'
                        );
                        
                        // Закрываем окно после успешного копирования
                        setTimeout(() => {
                            window.close();
                        }, 1000); // Даем время увидеть уведомление
                    })
                    .catch(err => {
                        console.error('Ошибка:', err);
                        showNotification('Не удалось скопировать ссылку', 'error');
                    });
            }

            function showNotification(message, type = 'info') {
                // Удаляем предыдущие уведомления
                const existing = document.querySelector('.img-copy-notification');
                if (existing) existing.remove();
                
                // Настройки стилей для разных типов
                const styles = {
                    info: { bg: '#6c5ce7', icon: '📋' },
                    data: { bg: '#00b894', icon: '🖼️' },
                    error: { bg: '#d63031', icon: '⚠️' }
                };
                
                const style = styles[type] || styles.info;
                
                // Создаем уведомление
                const notification = document.createElement('div');
                notification.className = 'img-copy-notification';
                
                Object.assign(notification.style, {
                    position: 'fixed',
                    top: '50%',
                    left: '50%',
                    transform: 'translate(-50%, -50%)',
                    backgroundColor: style.bg,
                    color: 'white',
                    padding: '24px 48px', // Увеличили padding для большего размера
                    borderRadius: '12px',
                    zIndex: '9999',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '20px', // Увеличили расстояние между иконкой и текстом
                    boxShadow: '0 8px 24px rgba(0,0,0,0.3)',
                    maxWidth: '80vw',
                    fontSize: '24px', // Увеличили размер шрифта
                    fontWeight: 'bold',
                    textAlign: 'center',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis'
                });
                
                // Добавляем иконку
                const icon = document.createElement('span');
                icon.textContent = style.icon;
                icon.style.fontSize = '32px'; // Увеличили размер иконки
                notification.appendChild(icon);
                
                // Добавляем текст
                const text = document.createElement('span');
                text.textContent = message;
                notification.appendChild(text);
                
                document.body.appendChild(notification);
                
                // Автоматическое скрытие
                setTimeout(() => {
                    notification.remove();
                }, 1500); // Увеличили время показа уведомления
            }  
        `);
    });
});