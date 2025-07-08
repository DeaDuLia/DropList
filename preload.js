const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
    //Общие
    getRatings: () => ipcRenderer.invoke('get-ratings'),
    getStatuses: () => ipcRenderer.invoke('get-statuses'),
    //Игры
    getGamesWithTags: () => ipcRenderer.invoke('get-games-with-tags'),
    addGame: (gameData) => ipcRenderer.invoke('add-game', gameData),
    deleteGame: (gameName) => ipcRenderer.invoke('delete-game', gameName),
    updateGameRating: (gameName, rating) => ipcRenderer.invoke('update-game-rating', gameName, rating),
    updateGameStatus: (gameName, status) => ipcRenderer.invoke('update-game-status', gameName, status),
    //Фильмы
    getMoviesWithTags: () => ipcRenderer.invoke('get-movies-with-tags'),
    addMovie: (movieData) => ipcRenderer.invoke('add-movie', movieData),
    deleteMovie: (movieName) => ipcRenderer.invoke('delete-movie', movieName),
    updateMovieRating: (movieName, rating) => ipcRenderer.invoke('update-movie-rating', movieName, rating),
    updateMovieStatus: (movieName, status) => ipcRenderer.invoke('update-movie-status', movieName, status),
    //Сериалы
    getSerialsWithTags: () => ipcRenderer.invoke('get-serials-with-tags'),
    addSerial: (data) => ipcRenderer.invoke('add-serial', data),
    deleteSerial: (name) => ipcRenderer.invoke('delete-serial', name),
    updateSerialRating: (name, rating) => ipcRenderer.invoke('update-serial-rating', name, rating),
    updateSerialStatus: (name, status) => ipcRenderer.invoke('update-serial-status', name, status),
    //Сериалы
    getAnimeWithTags: () => ipcRenderer.invoke('get-anime-with-tags'),
    addAnime: (data) => ipcRenderer.invoke('add-anime', data),
    deleteAnime: (name) => ipcRenderer.invoke('delete-anime', name),
    updateAnimeRating: (name, rating) => ipcRenderer.invoke('update-anime-rating', name, rating),
    updateAnimeStatus: (name, status) => ipcRenderer.invoke('update-anime-status', name, status),
    //Книги
    getBooksWithTags: () => ipcRenderer.invoke('get-books-with-tags'),
    addBook: (data) => ipcRenderer.invoke('add-book', data),
    deleteBook: (name) => ipcRenderer.invoke('delete-book', name),
    updateBookRating: (name, rating) => ipcRenderer.invoke('update-book-rating', name, rating),
    updateBookStatus: (name, status) => ipcRenderer.invoke('update-book-status', name, status),
    openExternal: (url) => ipcRenderer.send('open-external', url),
    updateGame: (oldName, newName, newIcoUrl) => ipcRenderer.invoke('update-game', oldName, newName, newIcoUrl),
    updateMovie: (oldName, newName, newIcoUrl) => ipcRenderer.invoke('update-movie', oldName, newName, newIcoUrl),
    updateSerial: (oldName, newName, newIcoUrl) => ipcRenderer.invoke('update-serial', oldName, newName, newIcoUrl),
    updateAnime: (oldName, newName, newIcoUrl) => ipcRenderer.invoke('update-anime', oldName, newName, newIcoUrl),
    updateBook: (oldName, newName, newIcoUrl) => ipcRenderer.invoke('update-book', oldName, newName, newIcoUrl)
});