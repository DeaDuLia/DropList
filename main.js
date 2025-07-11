const { app, BrowserWindow, ipcMain, shell } = require('electron');
const { dialog } = require('electron');
const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');

function getIconPath() {
    if (process.platform === 'darwin') {
        return path.join(__dirname, 'icon.icns');
    } else {
        return path.join(__dirname, 'icon.ico');
    }
}
function initializeDatabase(db) {
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
}

const db = new Database('database.db', {
    timeout: 5000 // увеличить таймаут ожидания
});
db.pragma('journal_mode = WAL');
initializeDatabase(db);

//Создаём таблицы при первом запуске


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
    updateBookStatus: db.prepare('UPDATE books SET status = ? WHERE name = ?'),
    updateGame: db.prepare('UPDATE games SET name = ?, ico_url = ? WHERE name = ?'),
    updateMovie: db.prepare('UPDATE movies SET name = ?, ico_url = ? WHERE name = ?'),
    updateSerial: db.prepare('UPDATE serials SET name = ?, ico_url = ? WHERE name = ?'),
    updateAnime: db.prepare('UPDATE anime SET name = ?, ico_url = ? WHERE name = ?'),
    updateBook: db.prepare('UPDATE books SET name = ?, ico_url = ? WHERE name = ?')
};

let win;
function createWindow() {
    win = new BrowserWindow({
        title: 'DropList',
        width: 1280,
        height: 800,
        icon: getIconPath(),
        webPreferences: {
            nodeIntegration: false,
            sandbox: true,
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

ipcMain.on('open-external', (event, url, name) => {
    const externalWindow = new BrowserWindow({
        width: 1000,
        height: 800,
        icon: getIconPath(),
        webPreferences: {
            nodeIntegration: false,
            preload: path.join(__dirname, 'preload-external.js')
        },
        show: false
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
        externalWindow.show();
        externalWindow.webContents.executeJavaScript(`
            // Устанавливаем имя во временную переменную
            // Блокируем стандартное поведение ссылок
            const style = document.createElement('style');
            style.textContent = \`           
                a { pointer-events: none !important; }
                img { pointer-events: none !important; }
            \`;
            document.head.appendChild(style);

            // Обработчик кликов
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

                setTimeout(() => {
                    notification.remove();
                }, 1500); // Увеличили время показа уведомления
            }  
        `);
    });
});

// В раздел IPC handlers добавить:
ipcMain.handle('update-game', async (event, oldName, newName, newIcoUrl) => {
    return db.transaction(() => {
        return statements.updateGame.run(newName, newIcoUrl, oldName);
    })();
});
ipcMain.handle('update-movie', async (event, oldName, newName, newIcoUrl) => {
    return db.transaction(() => {
        return statements.updateMovie.run(newName, newIcoUrl, oldName);
    })();
});
ipcMain.handle('update-serial', async (event, oldName, newName, newIcoUrl) => {
    return db.transaction(() => {
        return statements.updateSerial.run(newName, newIcoUrl, oldName);
    })();
});
ipcMain.handle('update-anime', async (event, oldName, newName, newIcoUrl) => {
    return db.transaction(() => {
        return statements.updateAnime.run(newName, newIcoUrl, oldName);
    })();
});
ipcMain.handle('update-book', async (event, oldName, newName, newIcoUrl) => {
    return db.transaction(() => {
        return statements.updateBook.run(newName, newIcoUrl, oldName);
    })();
});

ipcMain.handle('export-data', async () => {
    const win = BrowserWindow.getFocusedWindow();

    try {
        // Получаем все данные из БД
        const data = {
            games: statements.getGames.all(),
            movies: statements.getMovies.all(),
            serials: statements.getSerials.all(),
            anime: statements.getAnime.all(),
            books: statements.getBooks.all(),
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
        // Показываем диалог выбора файла
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

        // Импортируем данные в транзакции
        await db.transaction(() => {
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

            // Импорт игр
            if (data.games) {
                data.games.forEach(game => {
                    statements.addGame.run(
                        game.name,
                        game.icoUrl || null,
                        game.rating || '0',
                        game.status || 'Уточнить'
                    );
                });
            }

            // Импорт фильмов
            if (data.movies) {
                data.movies.forEach(movie => {
                    statements.addMovie.run(
                        movie.name,
                        movie.icoUrl || null,
                        movie.rating || '0',
                        movie.status || 'Уточнить'
                    );
                });
            }

            // Импорт сериалов
            if (data.serials) {
                data.serials.forEach(serial => {
                    statements.addSerial.run(
                        serial.name,
                        serial.icoUrl || null,
                        serial.rating || '0',
                        serial.status || 'Уточнить'
                    );
                });
            }

            // Импорт аниме
            if (data.anime) {
                data.anime.forEach(anime => {
                    statements.addAnime.run(
                        anime.name,
                        anime.icoUrl || null,
                        anime.rating || '0',
                        anime.status || 'Уточнить'
                    );
                });
            }

            // Импорт книг
            if (data.books) {
                data.books.forEach(book => {
                    statements.addBook.run(
                        book.name,
                        book.icoUrl || null,
                        book.rating || '0',
                        book.status || 'Уточнить'
                    );
                });
            }
        })();

        return { success: true, message: 'Данные успешно импортированы' };
    } catch (error) {
        console.error('Import error:', error);
        return { success: false, message: 'Ошибка при импорте данных' };
    }
});

ipcMain.on('message-from-external', (event, imgUrl, name) => {
    // Отправляем сообщение в index.html
    if (win) {
        win.webContents.send('message-to-index', { imgUrl, name });
    }
});

ipcMain.handle('move-to-category', async (event, { oldName, newName, newCategory }) => {
    return db.transaction(() => {
        // 1. Получить данные из старой категории
        // 2. Удалить из старой категории
        // 3. Добавить в новую категорию
        // 4. Вернуть обновленные данные
        // (Это требует более сложной реализации)
    })();
});