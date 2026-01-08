// Глобальные переменные
const errorModal = document.getElementById('errorModal');
const modalMessage = document.getElementById('modalMessage');
const modalClose = document.getElementById('modalClose');
const scrollToTopBtn = document.getElementById('scrollToTopBtn');

const donateModal = document.getElementById('donateModal');
const closeDonateModal = document.getElementById('closeDonateModal');
const randomBtn = document.getElementById('randomBtn');
const searchInWebBtn = document.getElementById('searchInWeb');



// Кнопки шапки
const exportBtn = document.getElementById('exportBtn');
const importBtn = document.getElementById('importBtn');
const replaceBtn = document.getElementById('replaceBtn');
const donateBtn = document.getElementById('donateBtn');
const toggleAddFormBtn = document.getElementById('toggleAddFormBtn');
const updateModal = document.getElementById('updateModal');
const noUpdateModal = document.getElementById('noUpdateModal');
const updateErrorModal = document.getElementById('updateErrorModal');
let currentUpdateInfo = null;
let lastTextFromClipboard = '';

let isAddingGame = false;
let currentPage = 1;
const itemsPerPage = 20; // Количество элементов на странице
let isLoading = false;
let allItemsLoaded = false;

let currentFilters = {
    searchQuery: '',
    statusFilter: 'Все'
};

document.addEventListener('DOMContentLoaded', () => {
    const minimizeBtn = document.getElementById('minimizeBtn');
    const maximizeBtn = document.getElementById('maximizeBtn');
    const closeBtn = document.getElementById('closeBtn');

    if (minimizeBtn) {
        minimizeBtn.addEventListener('click', () => {
            window.electronAPI.minimizeWindow();
        });
    }

    if (maximizeBtn) {
        maximizeBtn.addEventListener('click', () => {
            window.electronAPI.maximizeWindow();
        });

        // Обновляем иконку при изменении состояния окна
        window.electronAPI.isWindowMaximized().then(isMaximized => {
            updateMaximizeButtonIcon(isMaximized);
        });
    }

    if (closeBtn) {
        closeBtn.addEventListener('click', () => {
            window.electronAPI.closeWindow();
        });
    }
});

async function initUpdateSystem() {

    // Подписываемся на события обновлений
    window.updateAPI.onUpdateAvailable((data) => {
        showUpdateModal(data);
    });

    window.updateAPI.onNoUpdateAvailable((data) => {
        showNoUpdateModal(data);
    });

    window.updateAPI.onUpdateError((data) => {
        showUpdateErrorModal(data);
    });

    // Добавляем кнопку проверки обновлений в шапку
    addUpdateButton();
}

function addUpdateButton() {
    const headerButtons = document.querySelector('.header-buttons');

    const updateButton = document.createElement('button');
    updateButton.id = 'checkUpdateBtn';
    updateButton.className = 'header-button';
    updateButton.title = 'Проверить обновления';
    updateButton.innerHTML = '<img src="assets/icons/update.svg" alt="🔄" class="button-icon">';

    updateButton.addEventListener('click', async () => {
        await window.updateAPI.checkForUpdates(true);
    });

    // Вставляем перед кнопкой доната
    const donateBtn = document.getElementById('donateBtn');
    if (donateBtn) {
        headerButtons.insertBefore(updateButton, donateBtn);
    } else {
        headerButtons.appendChild(updateButton);
    }
}

function showUpdateModal(data) {
    currentUpdateInfo = data;

    document.getElementById('currentVersion').textContent = data.currentVersion;
    document.getElementById('newVersion').textContent = data.version;
    document.getElementById('releaseDate').textContent = new Date(data.releaseDate).toLocaleDateString('ru-RU');
    document.getElementById('releaseNotes').innerHTML = formatReleaseNotes(data.releaseNotes);

    updateModal.style.display = 'block';

    // Назначаем обработчики кнопок
    document.getElementById('updateNowBtn').onclick = () => {
        window.updateAPI.openReleasePage(data.url);
        updateModal.style.display = 'none';
    };

    document.getElementById('updateLaterBtn').onclick = () => {
        updateModal.style.display = 'none';
    };

    document.getElementById('skipVersionBtn').onclick = () => {
        window.updateAPI.skipVersion(data.version);
        updateModal.style.display = 'none';
    };
}

function showNoUpdateModal(data) {
    document.getElementById('noUpdateMessage').textContent = data.message + ` (${data.currentVersion})`;
    noUpdateModal.style.display = 'block';

    document.getElementById('closeNoUpdateModal').onclick = () => {
        noUpdateModal.style.display = 'none';
    };
}

function showUpdateErrorModal(data) {
    document.getElementById('updateErrorMessage').textContent = data.error;
    updateErrorModal.style.display = 'block';

    document.getElementById('closeUpdateErrorModal').onclick = () => {
        updateErrorModal.style.display = 'none';
    };
}

function formatReleaseNotes(notes) {
    if (!notes) return '<p>Нет информации об изменениях</p>';

    // Преобразуем markdown в простой HTML
    let formatted = notes
        .replace(/### (.*?)(\r\n|\n)/g, '<h4>$1</h4>')
        .replace(/## (.*?)(\r\n|\n)/g, '<h3>$1</h3>')
        .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
        .replace(/\*(.*?)\*/g, '<em>$1</em>')
        .replace(/- (.*?)(\r\n|\n)/g, '<li>$1</li>')
        .replace(/\r\n|\n/g, '<br>');

    // Если есть маркированные списки
    if (formatted.includes('<li>')) {
        formatted = formatted.replace(/<li>/g, '• ').replace(/<\/li>/g, '<br>');
    }

    return formatted;
}

async function updateDownloadsCount() {
    try {
        const result = await window.electronAPI.getGitHubDownloads();
        const downloadsElement = document.getElementById('downloadsCount');
        if (downloadsElement && result.success) {
            downloadsElement.textContent = `📥 ${result.downloads.toLocaleString()}`;
        }
    } catch (error) {
        console.error('Failed to get downloads count:', error);
    }
}

scrollToTopBtn.addEventListener('click', () => {
    const contentWrapper = document.querySelector('.content-wrapper');
    if (contentWrapper) {
        contentWrapper.scrollTo({
            top: 0,
            behavior: 'smooth'
        });
    }
});

function setupContentWrapperScroll() {
    const contentWrapper = document.querySelector('.content-wrapper');
    if (contentWrapper) {
        // Удаляем старый обработчик, если есть
        contentWrapper.removeEventListener('scroll', handleContentWrapperScroll);

        // Добавляем новый обработчик
        contentWrapper.addEventListener('scroll', handleContentWrapperScroll);

        // Инициализируем видимость кнопки при загрузке
        handleContentWrapperScroll();
    }
}

function handleContentWrapperScroll() {
    const contentWrapper = document.querySelector('.content-wrapper');
    if (!contentWrapper || !scrollToTopBtn) return;

    if (contentWrapper.scrollTop > 300) {
        scrollToTopBtn.classList.add('visible');
    } else {
        scrollToTopBtn.classList.remove('visible');
    }
}

exportBtn.addEventListener('click', async () => {
    try {
        const result = await window.electronAPI.exportData();
        if (result.success) {
            await showError(result.message);
        } else if (result.message !== 'Экспорт отменен') {
            await showError(result.message);
        }
    } catch (error) {
        console.error('Export error:', error);
        await showError('Ошибка при экспорте данных');
    }
});

replaceBtn.addEventListener('click', async () => {
    try {
        const confirmReplace = await showConfirmModal(
            'Подтверждение замены',
            'Вы уверены, что хотите заменить все данные? Это действие нельзя отменить.',
            'Заменить',
            'Отмена'
        );

        if (!confirmReplace) {
            return;
        }

        const result = await window.electronAPI.replaceData();
        if (result.success) {
            await showError(result.message);
            // Перезагружаем текущий раздел
            const section = document.querySelector('.nav-item.active')?.dataset.section;
            if (section) {
                let data = await window.electronAPI.getData(section);
                await renderSection(section, data, true);
            }
        } else if (result.message !== 'Замена отменена') {
            await showError(result.message);
        }
    } catch (error) {
        console.error('Replace error:', error);
        await showError('Ошибка при замене данных');
    }
});

importBtn.addEventListener('click', async () => {
    try {
        const result = await window.electronAPI.importData();
        if (result.success) {
            await showError(result.message);
            // Перезагружаем текущий раздел
            const section = document.querySelector('.nav-item.active')?.dataset.section;
            if (section) {
                let data = await window.electronAPI.getData(section);

                await renderSection(section, data, true);
            }
        } else if (result.message !== 'Импорт отменен') {
            await showError(result.message);
        }
    } catch (error) {
        console.error('Import error:', error);
        await showError('Ошибка при импорте данных');
    }
});

donateBtn.addEventListener('click', () => {
    donateModal.style.display = 'block';
});

// Закрытие модального окна
closeDonateModal.addEventListener('click', () => {
    donateModal.style.display = 'none';
});

donateModal.addEventListener('click', function(e) {
    if (e.target === this) {
        this.style.display = 'none';
    }
});

window.addEventListener('DOMContentLoaded', () => {
    window.electronAPI.onMessageFromMain(({ imgUrl, name }) => {
        const editIcoInput = document.getElementById('editIcoInput');
        const icoInput = document.getElementById('icoInput');

        if (name) {
            const section = document.querySelector('.nav-item.active')?.dataset.section;
            if (section) {
                updateItemIcon(section, name, imgUrl);
            }
        } else if (editIcoInput) {
            editIcoInput.value = imgUrl;
            updatePreview(null, imgUrl, null, null);
        } else if (icoInput) {
            icoInput.value = imgUrl;
            updatePreview(null, imgUrl, null, null);
        }
    });
});

async function updateItemIcon(section, name, newIconUrl) {
    try {
        await window.electronAPI.updateData(section, name, name, newIconUrl);
        // Находим карточку по data-name и обновляем только её иконку
        const card = document.querySelector(`.data-card[data-name="${name}"]`);
        if (card) {
            const icon = card.querySelector('.game-icon');
            if (icon) {
                icon.src = newIconUrl;
                // Добавляем обработчик на случай ошибки загрузки изображения
                icon.onerror = () => {
                    icon.src = 'https://apptor.studio/assets/cache/images/600-856x600-629.png';
                };
            }
        }
    } catch (error) {
        console.error('Ошибка при обновлении иконки:', error);
        showError('Не удалось обновить иконку');
    }
}

document.addEventListener('click', async (e) => {
    if (e.target && e.target.id === 'addBtn') {
        const section = document.querySelector('.nav-item.active')?.dataset.section;
        await addNewData(section);
    }
});

document.addEventListener('keydown', (e) => {
    // Ctrl+F - фокус в поиск
    if (e.ctrlKey && e.key === 'f') {
        e.preventDefault();
        document.getElementById('searchInput')?.focus();
    }

    // Ctrl+N - добавить новый элемент
    if (e.ctrlKey && e.key === 'n') {
        e.preventDefault();
        document.getElementById('toggleAddFormBtn')?.click();
    }

    // Esc - закрыть все модалки
    if (e.key === 'Escape') {
        document.querySelectorAll('.modal').forEach(modal => {
            modal.style.display = 'none';
        });
        if (document.getElementById('toggleAddFormBtn')?.textContent === '− Скрыть') {
            document.getElementById('toggleAddFormBtn')?.click();
        }
        document.getElementById('clearSearchBtn')?.click();
    }
});

document.querySelectorAll('.nav-item').forEach(item => {
    item.addEventListener('click', async function() {

        // Удаляем активный класс у всех элементов
        document.querySelectorAll('.nav-item').forEach(navItem => {
            navItem.classList.remove('active');
        });

        // Добавляем активный класс текущему элементу
        this.classList.add('active');

        // Получаем выбранный раздел
        const section = this.dataset.section;

        try {
            hideAddForm();
            let data = await window.electronAPI.getData(section);
            await renderSection(section, data, true, false);
        } catch (error) {
            console.error(`Ошибка загрузки раздела ${section}:`, error);
            await showError(`Не удалось загрузить раздел ${section}`);
        }
    });
});

// Копирование адресов
document.querySelectorAll('.copy-btn').forEach(btn => {
    btn.addEventListener('click', function() {
        const text = this.getAttribute('data-text');
        navigator.clipboard.writeText(text).then(() => {
            const originalText = this.textContent;
            this.textContent = 'Скопировано!';
            setTimeout(() => {
                this.textContent = originalText;
            }, 2000);
        });
    });
});

// Функция отображения ошибок
function showError(message) {
    modalMessage.textContent = message;
    errorModal.style.display = 'block';
    return new Promise(resolve => {
        modalClose.onclick = () => {
            errorModal.style.display = 'none';
            resolve();
        };
    });
}

// Инициализация при загрузке
document.addEventListener('DOMContentLoaded', async () => {
    await updateDownloadsCount();
    await loadRatings();
    await loadStatuses();
    await initUpdateSystem();

    // Загружаем игры по умолчанию
    const games = await window.electronAPI.getData('games');
    await renderSection('games', games);
});

// Загрузка рейтингов
async function loadRatings() {
    try {
        const ratings = await window.electronAPI.getRatings();
        const ratingSelect = document.getElementById('ratingSelect');
        if (ratingSelect) {
            ratingSelect.innerHTML = `
            <option value="5">Рейтинг</option>
            ${ratings.map(r => `<option value="${r}">${r}</option>`).join('')}
            `;
        }
    } catch (error) {
        console.error('Error loading ratings:', error);
        await showError('Failed to load ratings');
    }
}
// Загрузка статусов
async function loadStatuses() {
    try {
        const statuses = await window.electronAPI.getStatusesNoImport();
        const statusSelect = document.getElementById('statusSelect');
        if (statusSelect) {
            statusSelect.innerHTML = `
            <option value="В планах">Статус</option>
            ${statuses.map(s => `<option value="${s}">${s}</option>`).join('')}
            `;
        }
    } catch (error) {
        console.error('Error loading statuses:', error);
    }
}

// Генерация HTML для иконки игры
function getCardIconHTML(game) {
    let iconUrl = 'https://apptor.studio/assets/cache/images/600-856x600-629.png';
    // Проверяем URL обложки
    if (game.icoUrl) {
        try {
            new URL(game.icoUrl); // Проверяем, что это валидный URL
            iconUrl = game.icoUrl;
        } catch (e) {
            // Если URL невалидный, используем заглушку
            iconUrl = 'https://apptor.studio/assets/cache/images/600-856x600-629.png';
        }
    }
    return `
            <img src="${iconUrl}"
                 alt="${game.name}"
                 class="game-icon"
                 onerror="this.src='https://apptor.studio/assets/cache/images/600-856x600-629.png'">
            `;
}



async function renderSection(section, data, resetPagination = true, preserveFilters = false, addMoreChecked=false, addFormVisible='') {
    const contentSection = document.getElementById('contentSection');
    const filterButtonsSection = contentSection.querySelector('.filter-buttons-section');
    const contentWrapper = contentSection.querySelector('.content-wrapper');

    if (!contentWrapper || !filterButtonsSection) return;

    // Очистка перед рендером
    cleanupSection();

    if (resetPagination) {
        currentPage = 1;
        allItemsLoaded = false;
    }

    window.allSectionData = data;

    if (preserveFilters) {
        window.filteredData = filterData(data, currentFilters.searchQuery, currentFilters.statusFilter);
    } else {
        window.filteredData = data;
        currentFilters = { searchQuery: '', statusFilter: 'Все' };
    }
    filterButtonsSection.innerHTML = `
        <div class="filter-buttons-container">
            <div class="filter-buttons-group" id="statusFilter">
                <!-- Кнопки статусов будут добавлены динамически -->
            </div>
        </div>
    `;
    // Рендерим контент во wrapper
    contentWrapper.innerHTML = `
    <div class="content-wrapper">
        <!-- Кнопки фильтрации - ВЕРХНЯЯ СТРОКА -->
        <div class="filter-controls-panel">
            <div class="filter-container sort-buttons-container">
                <button class="sort-button active" data-sort="date" title="По дате добавления">
                    <img src="assets/icons/sort-date.svg" alt="📅" class="button-icon-no-text">
                </button>
                <button class="sort-button" data-sort="alphabet" title="По алфавиту">
                    <img src="assets/icons/sort-alpha.svg" alt="🔤" class="button-icon-no-text">
                </button>
                <button class="sort-button" data-sort="rating" title="По рейтингу и статусу">
                    <img src="assets/icons/sort-rating.svg" alt="⭐" class="button-icon-no-text">
                </button>
            </div>
            <div class="search-container">
                <input type="text" id="searchInput" placeholder="Поиск по названию" value="${currentFilters.searchQuery}">
                <div id="searchSuggestions" class="search-suggestions"></div>
                <button id="searchBtn"><img src="assets/icons/find.svg" alt="🔍" class="button-icon-no-text"></button>
                <button id="clearSearchBtn" class="clear-search-btn" ${currentFilters.searchQuery ? '' : 'style="display: none;"'}>✕</button>
                <button id="randomBtnSection" title="Случайная карточка"><img src="assets/icons/random.svg" alt="🎲" class="button-icon">Случайное</button>
                <button id="searchInWeb" title="Поиск в интернете"><img src="assets/icons/find.svg" alt="🔍" class="button-icon">Популярное</button>
            </div>
            
            <!-- Кнопка добавления должна быть ВНЕ search-container -->
            <div class="add-button-container">
                <button id="toggleAddFormBtn" class="add-button">+ Добавить</button>
            </div>
        </div>
            
        ${getAddFormHTML(addMoreChecked, addFormVisible)}
        <div id="dataList" class="data-grid"></div>
        <div id="loadingIndicator" class="loading-indicator" style="display: none;">
            <div class="loading-spinner"></div>
            <p>Загрузка...</p>
        </div>
    </div>
`;

    // Инициализируем секцию
    await initCardSection();
    setupSearchInput();

    // Устанавливаем сохранённое значение фильтра статуса
    const statusFilter = document.getElementById('statusFilter');
    if (statusFilter && currentFilters.statusFilter) {
        statusFilter.value = currentFilters.statusFilter;
    }

    loadMoreItems();

    // Добавляем обработчик прокрутки для бесконечной загрузки
    contentWrapper.addEventListener('scroll', handleScroll);
    setupContentWrapperScroll();
}

function filterData(data, searchQuery, statusFilter) {
    const queryLower = (searchQuery || '').toLowerCase();
    return data.filter(item => {
        const nameMatches = !queryLower || item.name.toLowerCase().includes(queryLower);
        const statusMatches = statusFilter === 'Все' || item.status === statusFilter;
        return nameMatches && statusMatches;
    });
}

let scrollTimeout;
function handleScroll() {
    const contentWrapper = document.querySelector('.content-wrapper');
    if (!contentWrapper) return;


    clearTimeout(scrollTimeout);
    scrollTimeout = setTimeout(() => {
        if (isLoading || allItemsLoaded) return;

        // Проверяем, достигли ли мы низа контейнера
        const scrollPosition = contentWrapper.scrollTop + contentWrapper.clientHeight;
        const scrollHeight = contentWrapper.scrollHeight;

        if (scrollPosition > scrollHeight - 100) {
            loadMoreItems();
        }
    }, 100);
}

function cleanupSection() {
    // Закрываем все выпадающие списки
    closeAllDropdowns();

    const contentWrapper = document.querySelector('.content-wrapper');
    if (contentWrapper) {
        contentWrapper.removeEventListener('scroll', handleScroll);
    }

    const interactiveElements = [
        '#searchInput', '#searchBtn', '#statusFilter',
        '.editable-field', '.delete-btn', '.search-btn', '#addForm'
    ];

    interactiveElements.forEach(selector => {
        document.querySelectorAll(selector).forEach(el => {
            el.replaceWith(el.cloneNode(true));
        });
    });
}

async function loadMoreItems() {
    if (isLoading || allItemsLoaded) return;

    isLoading = true;
    const loadingIndicator = document.getElementById('loadingIndicator');
    if (loadingIndicator) loadingIndicator.style.display = 'block';

    // Получаем данные для текущей страницы
    const startIndex = (currentPage - 1) * itemsPerPage;
    const endIndex = startIndex + itemsPerPage;
    const itemsToRender = window.filteredData.slice(startIndex, endIndex);

    if (itemsToRender.length === 0) {
        allItemsLoaded = true;
        isLoading = false;
        if (loadingIndicator) loadingIndicator.style.display = 'none';
        return;
    }

    // Рендерим карточки
    const dataList = document.getElementById('dataList');
    if (dataList) {
        dataList.innerHTML += renderCardList(itemsToRender);
    }

    // Обновляем состояние
    currentPage++;
    isLoading = false;
    if (loadingIndicator) loadingIndicator.style.display = 'none';

    // Инициализируем кнопки и поля для новых карточек
    setupDeleteButtons();
    setupEditableFields();
    setupTitleClickHandlers();
    setupChangeImageButtons(); // Новая функция
    setupChangeCategoryButtons(); // Новая функция
    setupCardClickHandlers();
}

async function loadStatusFilter() {
    try {
        const statuses = await window.electronAPI.getStatuses();
        const statusFilter = document.getElementById('statusFilter');
        if (statusFilter) {
            statusFilter.innerHTML = `<button class="filter-button active" data-status="Все">Все</button>
                ${statuses.map(s => `<button class="filter-button" data-status="${s}">${s}</button>`).join('')}
            `;

            // Добавляем обработчик изменения фильтра
            statusFilter.addEventListener('change', () => {
                filterCards();
            });
        }
    } catch (error) {
        console.error('Error loading statuses for filter:', error);
    }
}

function setupSearchInput() {
    const oldInput = document.getElementById('searchInput');
    if (oldInput) oldInput.replaceWith(oldInput.cloneNode(true));
    const searchInput = document.getElementById('searchInput');
    const searchBtn = document.getElementById('searchBtn');
    const searchSuggestions = document.getElementById('searchSuggestions');

    if (!searchInput || !searchBtn) return;

    function updateSuggestions(query) {
        const queryLower = query.toLowerCase();
        searchSuggestions.innerHTML = '';

        if (query.length < 2) {
            searchSuggestions.style.display = 'none';
            return;
        }

        const matches = window.allSectionData.filter(item =>
            item.name.toLowerCase().includes(queryLower)
        ).slice(0, 5);

        if (matches.length > 0) {
            searchSuggestions.innerHTML = matches.map(item => `
                <div class="suggestion-item">${item.name}</div>
            `).join('');
            searchSuggestions.style.display = 'block';
        } else {
            searchSuggestions.style.display = 'none';
        }
    }

    const clearSearchBtn = document.getElementById('clearSearchBtn');
    if (clearSearchBtn) {
        clearSearchBtn.addEventListener('click', () => {
            searchInput.value = '';
            clearSearchBtn.style.display = 'none';
            filterCards('');
        });
    }

    // Обработчик ввода текста
    searchInput.addEventListener('input', (e) => {
        updateSuggestions(e.target.value);
        if (clearSearchBtn) {
            clearSearchBtn.style.display = e.target.value ? 'block' : 'none';
        }
    });

    // Обработчик клика по подсказке
    searchSuggestions.addEventListener('click', (e) => {
        if (e.target.classList.contains('suggestion-item')) {
            searchInput.value = e.target.textContent;
            searchSuggestions.style.display = 'none';
            filterCards(e.target.textContent);
        }
    });

    // Обработчик кнопки поиска
    searchBtn.addEventListener('click', () => {
        // Показываем подсказки при клике, если есть текст в поле поиска
        if (searchInput.value.length >= 2) {
            updateSuggestions(searchInput.value);
        }
        filterCards(searchInput.value);
    });

    // Обработчик нажатия Enter
    searchInput.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') {
            filterCards(searchInput.value);
        }
    });

    // Скрытие подсказок при клике вне
    document.addEventListener('click', (e) => {
        if (!searchInput.contains(e.target) &&
            !searchBtn.contains(e.target) &&
            !searchSuggestions.contains(e.target)) {
            searchSuggestions.style.display = 'none';
        }
    });
}
function sortData(data, sortBy) {
    const statusPriority = {
        'Избранное': 1,
        'Завершено': 2,
        'Импортировано': 3,
        'Смотрел': 4,
        'В процессе': 5,
        'Уточнить': 6,
        'Ожидается': 7
    };

    return [...data].sort((a, b) => {
        if (sortBy === 'date') {
            // По умолчанию данные уже в порядке добавления
            return 0;
        } else if (sortBy === 'rating') {
            // Сначала по статусу
            const statusA = statusPriority[a.status] || 5;
            const statusB = statusPriority[b.status] || 5;
            if (statusA !== statusB) return statusA - statusB;

            // Затем по рейтингу (если статусы одинаковые)
            const ratingA = parseInt(a.rating) || 0;
            const ratingB = parseInt(b.rating) || 0;
            return ratingB - ratingA; // Сначала высокий рейтинг
        } else if (sortBy === 'alphabet') {
            // По алфавиту
            return a.name.localeCompare(b.name);
        }
        return 0;
    });
}

function filterCards(query = '') {
    const statusFilter = currentFilters.statusFilter || 'Все';
    const clearSearchBtn = document.getElementById('clearSearchBtn');
    const selectedSort = currentFilters.sortBy || 'date';

    // Сохраняем текущие фильтры
    currentFilters = {
        searchQuery: query,
        statusFilter: statusFilter,
        sortBy: selectedSort
    };

    if (clearSearchBtn) {
        clearSearchBtn.style.display = query ? 'block' : 'none';
    }

    // Сначала фильтруем, затем сортируем
    const filtered = filterData(window.allSectionData, query, statusFilter);
    window.filteredData = sortData(filtered, selectedSort);

    // Сбрасываем пагинацию и перерисовываем
    const dataList = document.getElementById('dataList');
    if (dataList) dataList.innerHTML = '';
    currentPage = 1;
    allItemsLoaded = false;
    loadMoreItems();
}

// Вспомогательные функции
function getSectionTitle(section) {
    const titles = {
        games: '🎮 Игры',
        movies: '🎬 Кино',
        cartoons: '🎥 Мульты',
        serials: '📺 Сериалы',
        anime: '🌸 Аниме',
        books: '📚 Книги'
    };
    return titles[section] || section;
}

async function initCardSection() {
    await Promise.all([
        loadRatings(),
        loadStatuses(),
        loadStatusFilter()
    ]);

    // Добавляем обработчик сортировки
    setupSortButtons();
    setupFilterButtons();
    const activeButton = document.querySelector(`.filter-button[data-status="${currentFilters.statusFilter || 'Все'}"]`);
    if (activeButton) {
        document.querySelectorAll('.filter-button').forEach(btn => btn.classList.remove('active'));
        activeButton.classList.add('active');
    }

    const randomBtnSection = document.getElementById('randomBtnSection');
    if (randomBtnSection) {
        randomBtnSection.addEventListener('click', async () => {
            await pickRandomVisibleCard();
        });
    }

    const searchInWeb = document.getElementById('searchInWeb');
    if (searchInWeb) {
        searchInWeb.addEventListener('click', async () => {
            await searchCardInWeb();
        });
    }

    // Настраиваем кнопку добавления
    setupAddButton();

    setupDeleteButtons();
    setupEditableFields();
    setupTitleClickHandlers();
    setupIconSearchButton();
    setupChangeImageButtons();
    setupChangeCategoryButtons();
    setupCardClickHandlers();
    setupPreviewUpdate();


}

function setupChangeImageButtons() {
    document.querySelectorAll('.change-image-btn').forEach(btn => {
        btn.addEventListener('click', async (e) => {
            e.stopPropagation();
            const itemName = btn.dataset.name;
            const searchUrl = `https://yandex.ru/images/search?text=${encodeURIComponent(itemName + ' обложка')}`;
            window.electronAPI.openExternal(searchUrl, itemName);
        });
    });
}

function setupChangeCategoryButtons() {
    document.querySelectorAll('.change-category-btn').forEach(btn => {
        btn.addEventListener('click', async (e) => {
            e.stopPropagation();
            const itemName = btn.dataset.name;
            const icoUrl = btn.getAttribute('datatype');
            const status = btn.dataset.status;
            const rating = btn.dataset.rating;
            const section = document.querySelector('.nav-item.active')?.dataset.section;
            showCategoryChangeModal(section, itemName, icoUrl, status, rating);
        });
    });
}

function showCategoryChangeModal(oldSection, itemName, icoUrl, status, rating) {
    const modal = document.createElement('div');
    modal.className = 'modal';
    modal.style.display = 'block';

    modal.innerHTML = `
        <div class="modal-content" style="max-width: 300px;">
            <h3 data-section="${oldSection}" data-rating="${rating}" data-status="${status}" datatype="${icoUrl}">${itemName}</h3>
            <p>Выберите новую категорию</p>
            <select id="categorySelect" class="edit-select">
                <option value="games">🎮 Игры</option>
                <option value="serials">📺 Сериалы</option>
                <option value="movies">🎬 Кино</option>
                <option value="cartoons">🎥 Мульты</option>
                <option value="anime">🌸 Аниме</option>
                <option value="books">📚 Книги</option>
            </select>
            <div style="margin-top: 20px; display: flex; justify-content: space-between;">
                <button class="modal-button cancel-btn">Отмена</button>
                <button class="modal-button confirm-btn">Сохранить</button>
            </div>
        </div>
    `;

    document.body.appendChild(modal);

    modal.querySelector('.cancel-btn').addEventListener('click', () => {
        document.body.removeChild(modal);
    });

    modal.querySelector('.confirm-btn').addEventListener('click', async () => {
        const oldCat = modal.querySelector('h3').getAttribute('data-section');
        const newCat = modal.querySelector('#categorySelect').value;
        const name = modal.querySelector('h3').innerText;
        const status = modal.querySelector('h3').getAttribute('data-status');
        const rating = modal.querySelector('h3').getAttribute('data-rating');
        const icoUrl = modal.querySelector('h3').getAttribute('datatype');

        try {
            const hasDuplicates = await window.electronAPI.checkDuplicates(newCat, name);
            const isDuplicate = (oldCat !== newCat && hasDuplicates);
            if (isDuplicate) {
                const confirmReplace = await showConfirmModal(
                    'Элемент уже существует',
                    `"${name}" уже есть в категории ${newCat}. Хотите заменить его?`,
                    'Заменить',
                    'Отмена'
                );

                if (!confirmReplace) {
                    isAddingGame = false;
                    return;
                }
            }
            if (oldCat === newCat) {
                isAddingGame = false;
                document.body.removeChild(modal);
                return;
            }
            const data = {
                name: name,
                oldStatus: status,
                oldRating: rating,
                oldIcoUrl: icoUrl,
                oldCategory: oldCat,
                newCategory: newCat
            };
            await window.electronAPI.moveDataToCategory(data);
            const card = document.querySelector(`.data-card[data-name="${name}"]`);
            if (card) {
                card.remove();
            }
            document.body.removeChild(modal);
        } catch (error) {
            await showError('Не удалось сменить категорию');
        }
    });

    modal.addEventListener('click', (e) => {
        if (e.target === modal) {
            document.body.removeChild(modal);
        }
    });
}

function hideAddForm() {
    const addForm = document.getElementById('addForm');
    const toggleBtn = document.getElementById('toggleAddFormBtn');

    if (addForm) {
        addForm.classList.remove('visible');
    }

    if (toggleBtn) {
        toggleBtn.textContent = '+ Добавить';
    }
}

function getAddFormHTML(addMoreChecked = false, visible = '') {
    return `
        <div id="addForm" class="add-form ${visible}">
            <div class="form-content">
                <div id="previewCard" class="preview-card">
                    <div class="preview-data-card" style="display: block;">
                        ${getCardIconHTML({ name: 'Название', icoUrl: '' })}
                        <div class="preview-data-info">
                            <h3 class="preview-data-title">Название</h3>
                            <div class="preview-data-ratings-container">
                                <span class="preview-card-rating rating-value">
                                    0
                                </span>
                                <span class="preview-card-status status-value">
                                    Уточнить
                                </span>
                            </div>
                        </div>
                    </div>
                </div>
                
                <div class="form-fields">
                    <div class="form-group">
                        <div class="icon-input-container">
                            <input id="nameInput" placeholder="Название" autocomplete="off">
                        </div>
                    </div>
                    <div class="form-group">
                        <div class="icon-input-container">
                            <input id="icoInput" placeholder="Ссылка на обложку" autocomplete="off">
                            <button id="searchIconBtn" class="search-icon-btn" title="Найти обложку"><img src="assets/icons/find.svg" alt="🔍" class="button-icon-no-text"></button>
                        </div>
                    </div>
                    <div class="form-group">
                        <select id="ratingSelect">
                            <option value="0">Выберите рейтинг</option>
                        </select>
                        <select id="statusSelect">
                            <option value="Уточнить">Выберите статус</option>
                        </select>
                    </div>
                    <div class="form-group add-more-container">
                        <button id="addBtn" class="add-button-compact">
                            Добавить
                        </button>
                    </div>
                </div>
            </div>
        </div>
    `;
}

function renderCardList(cards) {
    return cards.map(card => `
            <div class="data-card" data-name="${card.name}" style="display: block;">
                <button class="change-image-btn" data-name="${card.name}" title="Сменить картинку"><img src="assets/icons/changeImage.svg" alt="🖼️" class="button-icon-no-text"></button>
                <button class="change-category-btn" data-name="${card.name}" data-status="${card.status}" data-rating="${card.rating}" datatype="${card.icoUrl}" title="Сменить категорию"><img src="assets/icons/changeCategory.svg" alt="⇄" class="button-icon-no-text"></button>
                <button class="delete-btn" data-name="${card.name}"><img src="assets/icons/delete.svg" alt="🗑️" class="button-icon-no-text"></button>
                ${getCardIconHTML(card)}
                <div class="data-info">
                    <h3 class="data-title">${card.name}</h3>
                    <div class="data-ratings-container">
                        <span class="card-rating rating-value editable-field"
                              data-rating="${card.rating}"
                              data-name="${card.name}"
                              title="Редактировать">
                            ${card.rating || '0'}
                        </span>
                        <span class="card-status status-value editable-field"
                              data-status="${card.status}"
                              data-name="${card.name}"
                              title="Редактировать">
                            ${card.status || 'Уточнить'}
                        </span>
                    </div>
                </div>
            </div>
        `).join('');
}

async function addNewData(section) {
    if (isAddingGame) return;
    isAddingGame = true;
    const nameInput = document.getElementById('nameInput');
    const icoInput = document.getElementById('icoInput');
    const ratingSelect = document.getElementById('ratingSelect');
    const statusSelect = document.getElementById('statusSelect');

    const cardData = {
        name: nameInput.value.trim(),
        icoUrl: icoInput.value.trim(),
        rating: ratingSelect.value,
        status: statusSelect.value
    };

    if (!cardData.name) {
        await showError('Пожалуйста, введите название');
        nameInput.focus();
        isAddingGame = false;
        return;
    }

    try {
        const isDuplicate = await window.electronAPI.checkDuplicates(section, cardData.name)
        if (isDuplicate) {
            const confirmReplace = await showConfirmModal(
                'Элемент уже существует',
                `"${cardData.name}" уже есть в списке. Хотите заменить его?`,
                'Заменить',
                'Отмена'
            );
            if (!confirmReplace) {
                isAddingGame = false;
                return;
            }
        }
        await window.electronAPI.addData(section, cardData);
        // Перезагружаем данные и рендерим раздел заново
        let data = await window.electronAPI.getData(section);
        await renderSection(section, data, true, false, false, true);
        const searchInput = document.getElementById('searchInput');
        if (searchInput) {
            searchInput.value = cardData.name;
            filterCards(cardData.name);
        }
    } catch (error) {
        console.error('Ошибка при добавлении:', error);
        await showError(`Ошибка при добавлении: ${error.message}`);
    } finally {
        isAddingGame = false;
    }
}

function showConfirmModal(title, message, confirmText, cancelText) {
    return new Promise((resolve) => {
        const modal = document.createElement('div');
        modal.className = 'modal';
        modal.style.display = 'block';
        modal.innerHTML = `
            <div class="modal-content" style="max-width: 400px;">
                <h3>${title}</h3>
                <p>${message}</p>
                <div style="margin-top: 20px; display: flex; justify-content: space-between;">
                    <button class="modal-button cancel-btn">${cancelText}</button>
                    <button class="modal-button confirm-btn">${confirmText}</button>
                </div>
            </div>
        `;

        document.body.appendChild(modal);

        modal.querySelector('.cancel-btn').addEventListener('click', () => {
            document.body.removeChild(modal);
            resolve(false);
        });

        modal.querySelector('.confirm-btn').addEventListener('click', () => {
            document.body.removeChild(modal);
            resolve(true);
        });

        modal.addEventListener('click', (e) => {
            if (e.target === modal) {
                document.body.removeChild(modal);
                resolve(false);
            }
        });
    });
}

function setupEditableFields() {
    // Создаем overlay для закрытия списка по клику вне
    if (!document.getElementById('editable-select-overlay')) {
        const overlay = document.createElement('div');
        overlay.id = 'editable-select-overlay';
        overlay.className = 'editable-select-overlay';
        document.body.appendChild(overlay);
    }

    const overlay = document.getElementById('editable-select-overlay');

    document.querySelectorAll('.editable-field').forEach(field => {
        field.style.cursor = 'pointer';

        // Создаем контейнер
        const container = document.createElement('div');
        container.className = 'editable-select-container';

        // Получаем текущее значение
        const currentValue = field.classList.contains('rating-value')
            ? field.dataset.rating
            : field.dataset.status;

        // Создаем элемент для отображения текущего значения
        const valueDisplay = document.createElement('span');
        valueDisplay.className = 'editable-select-value';
        valueDisplay.textContent = field.textContent.trim();

        // Применяем стили в зависимости от типа поля
        if (field.classList.contains('rating-value')) {
            valueDisplay.style.backgroundColor = getRatingColor(currentValue);
        } else {
            valueDisplay.style.backgroundColor = getStatusColor(currentValue);
        }
        valueDisplay.style.color = 'white';
        valueDisplay.style.textShadow = '0 1px 1px rgba(0,0,0,0.2)';

        // Создаем выпадающий список (будет показан отдельно)
        const select = document.createElement('div');
        select.className = 'editable-select';
        select.style.position = 'absolute';
        select.style.width = '100%';
        select.style.height = '100%';
        select.style.cursor = 'pointer';
        select.style.zIndex = '6';

        // Добавляем элементы в DOM
        field.innerHTML = '';
        container.appendChild(valueDisplay);
        container.appendChild(select);
        field.appendChild(container);

        // Обработчик клика
        select.addEventListener('click', async (e) => {
            e.stopPropagation();
            await showEditableDropdown(field, valueDisplay);
        });

        // Также делаем кликабельным valueDisplay
        valueDisplay.addEventListener('click', async (e) => {
            e.stopPropagation();
            await showEditableDropdown(field, valueDisplay);
        });
    });
}

async function showEditableDropdown(field, valueDisplay) {
    // Закрываем все открытые списки
    closeAllDropdowns();

    const isRating = field.classList.contains('rating-value');
    const currentValue = isRating ? field.dataset.rating : field.dataset.status;
    const itemName = field.dataset.name;

    // Получаем доступные значения
    let values;
    if (isRating) {
        values = await window.electronAPI.getRatings();
    } else {
        values = await window.electronAPI.getStatusesNoImport();
    }

    // Создаем список
    const list = document.createElement('div');
    list.className = 'editable-select-list';

    // Получаем позицию элемента
    const rect = valueDisplay.getBoundingClientRect();
    const viewportHeight = window.innerHeight;
    const listHeight = Math.min(values.length * 32 + 20, 250); // Предполагаемая высота списка

    // Определяем, где показывать список: снизу или сверху
    const spaceBelow = viewportHeight - rect.bottom - 10;
    const spaceAbove = rect.top - 10;

    let listTop;
    let openDirection = 'below';

    // Если внизу достаточно места или места сверху меньше
    if (spaceBelow >= listHeight || spaceBelow >= spaceAbove) {
        // Показываем снизу
        listTop = rect.bottom + 5;
        openDirection = 'below';
    } else {
        // Показываем сверху
        listTop = rect.top - listHeight - 5;
        openDirection = 'above';
    }

    // Позиционируем список
    list.style.position = 'fixed';
    list.style.top = listTop + 'px';
    list.style.left = rect.left + 'px';
    list.style.minWidth = rect.width + 'px';

    // Добавляем класс направления для стилей CSS
    list.dataset.direction = openDirection;

    // Добавляем опции
    values.forEach(value => {
        const option = document.createElement('div');
        option.className = `editable-select-option ${value === currentValue ? 'selected' : ''}`;
        option.textContent = value;
        option.dataset.value = value;

        option.addEventListener('click', async (e) => {
            e.stopPropagation();
            await updateFieldValue(field, valueDisplay, value, itemName, isRating);
            closeDropdown();
        });

        list.appendChild(option);
    });

    document.body.appendChild(list);

    // Показываем overlay
    const overlay = document.getElementById('editable-select-overlay');
    overlay.style.display = 'block';

    // Закрытие при клике на overlay
    overlay.onclick = closeDropdown;

    function closeDropdown() {
        if (list.parentNode) {
            document.body.removeChild(list);
        }
        overlay.style.display = 'none';
        overlay.onclick = null;
    }
}
async function updateFieldValue(field, valueDisplay, newValue, itemName, isRating) {
    try {
        const section = document.querySelector('.nav-item.active')?.dataset.section;
        if (isRating) {
            await window.electronAPI.updateDataRating(section, itemName, newValue);
            field.dataset.rating = newValue;
            valueDisplay.style.backgroundColor = getRatingColor(newValue);
        } else {
            await window.electronAPI.updateDataStatus(section, itemName, newValue);
            field.dataset.status = newValue;
            valueDisplay.style.backgroundColor = getStatusColor(newValue);
        }

        valueDisplay.textContent = newValue;
    } catch (error) {
        console.error('Ошибка при обновлении:', error);
        showError('Не удалось обновить значение');
    }
}

// Функция закрытия всех открытых списков
function closeAllDropdowns() {
    document.querySelectorAll('.editable-select-list').forEach(list => {
        if (list.parentNode) {
            document.body.removeChild(list);
        }
    });

    const overlay = document.getElementById('editable-select-overlay');
    if (overlay) {
        overlay.style.display = 'none';
        overlay.onclick = null;
    }
}

// Функции для получения цвета
function getRatingColor(rating) {
    const ratingColors = {
        '5': 'var(--rating-5)',
        '4': 'var(--rating-4)',
        '3': 'var(--rating-3)',
        '2': 'var(--rating-2)',
        '1': 'var(--rating-1)',
        '0': 'var(--rating-0)',
        '-1': 'var(--rating--1)',
        '-2': 'var(--rating--2)',
        '-3': 'var(--rating--3)',
        '-4': 'var(--rating--4)',
        '-5': 'var(--rating--5)'
    };
    return ratingColors[rating] || 'var(--rating-0)';
}

function getStatusColor(status) {
    const statusColors = {
        'Уточнить': 'var(--rating-not-played)',
        'Смотрел': 'var(--rating-played)',
        'В процессе': 'var(--rating-playing)',
        'В планах': 'var(--rating-planed)',
        'Завершено': 'var(--rating-completed)',
        'Избранное': 'var(--rating-pined)',
        'Импортировано': 'var(--rating-imported)',
        'Ожидается': 'var(--rating-waiting)'
    };
    return statusColors[status] || 'var(--rating-not-played)';
}

function setupDeleteButtons() {
    const oldButtons = document.querySelectorAll('.delete-btn');
    oldButtons.forEach(btn => {
        btn.replaceWith(btn.cloneNode(true));
    });

    document.querySelectorAll('.delete-btn').forEach(btn => {
        btn.addEventListener('click', async (e) => {
            e.stopPropagation();
            const itemName = btn.dataset.name;

            // Создаем модальное окно подтверждения
            const confirmModal = document.createElement('div');
            confirmModal.className = 'modal';
            confirmModal.style.display = 'block';
            confirmModal.innerHTML = `
                <div class="modal-content" style="max-width: 300px;">
                    <h3>Подтверждение удаления</h3>
                    <p>Вы уверены, что хотите удалить "${itemName}"?</p>
                    <div style="margin-top: 20px; display: flex; justify-content: space-between;">
                        <button class="modal-button cancel-btn delete-bt">Отмена</button>
                        <button class="modal-button confirm-btn delete-bt" style="background-color: #e74c3c;">Удалить</button>
                    </div>
                </div>
            `;

            document.body.appendChild(confirmModal);

            // Обработчики для кнопок
            confirmModal.querySelector('.cancel-btn').addEventListener('click', () => {
                document.body.removeChild(confirmModal);
            });

            confirmModal.querySelector('.confirm-btn').addEventListener('click', async () => {
                try {
                    const section = document.querySelector('.nav-item.active')?.dataset.section;
                    await window.electronAPI.deleteData(section, itemName);
                    // Удаляем карточку из DOM
                    const card = btn.closest('.data-card');
                    if (card) card.remove();
                    document.body.removeChild(confirmModal);
                } catch (error) {
                    console.error('Не удалось удалить:', error);
                    await showError('Не удалось удалить');
                    document.body.removeChild(confirmModal);
                }
            });

            // Закрытие при клике вне модального окна
            confirmModal.addEventListener('click', (e) => {
                if (e.target === confirmModal) {
                    document.body.removeChild(confirmModal);
                }
            });
        });
    });
}

function setupIconSearchButton() {
    const oldIconButtons = document.querySelectorAll('.search-icon-btn');
    oldIconButtons.forEach(btn => {
        btn.replaceWith(btn.cloneNode(true));
    });

    document.querySelectorAll('.search-icon-btn').forEach(btn => {
        btn.addEventListener('click', async (e) => {
            e.stopPropagation();
            const nameInput = document.getElementById('nameInput');
            if (nameInput && nameInput.value.trim()) {
                const searchQuery = encodeURIComponent(nameInput.value.trim() + ' обложка');
                const searchUrl = `https://yandex.ru/images/search?text=${searchQuery}`;
                window.electronAPI.openExternal(searchUrl);
            } else {
                showError('Введите название перед поиском иконки');
            }
        });
    });

    document.querySelectorAll('.search-name-btn').forEach(btn => {
        btn.addEventListener('click', async (e) => {
            e.stopPropagation();
            const nameInput = document.getElementById('nameInput');
            const icoInput = document.getElementById('icoInput');
            if (nameInput && icoInput) {
                navigator.clipboard.read().then(clipboardItems => {
                    for (const clipboardItem of clipboardItems) {
                        for (const type of clipboardItem.types) {
                            if (type.startsWith('image/')) {
                                clipboardItem.getType(type).then(imageBlob => {
                                    uploadImage(imageBlob);
                                });
                            }
                        }
                    }
                }).catch(err => {
                    console.error('Ошибка доступа к буферу обмена:', err);
                });
            } else {
                showError('Введите название перед поиском иконки');
            }
        });
    });
}

async function uploadImage(blob) {
    const formData = new FormData();
    formData.append('file', blob, 'image.png');

    const response = await fetch('https://tmpfiles.org/api/v1/upload', {
        method: 'POST',
        body: formData
    });

    const data = await response.json();
    if (data.data.url) {
        const url_icon = encodeURIComponent(data.data.url.replace('http://tmpfiles.org/', 'https://tmpfiles.org/dl/'));
        const searchUrl = `https://ya.ru/images/search?rpt=imageview&url=${url_icon}&text=Откуда изображение&cbir_page=neurosearch`;
        window.electronAPI.openExternal(searchUrl);
    }
}

function setupTitleClickHandlers() {
    document.querySelectorAll('.data-title').forEach(title => {
        // Удаляем старые обработчики
        title.replaceWith(title.cloneNode(true));
    });

    document.querySelectorAll('.data-title').forEach(title => {
        title.style.cursor = 'pointer';
        title.addEventListener('click', async function(e) {
            e.stopPropagation();
            const card = this.closest('.data-card');
            const oldName = card.dataset.name;
            const currentIcoUrl = card.querySelector('.game-icon').src;

            const modal = document.createElement('div');
            modal.className = 'modal';
            modal.style.display = 'block';
            modal.innerHTML = `
                <div class="modal-content" style="max-width: 400px;">
                    <h3>${oldName}</h3>
                    <div class="form-group">
                        <label>Название</label>
                        <input id="editNameInput" value="${oldName}" class="edit-input">
                    </div>
                    <div class="form-group">
                        <label>URL обложки</label>
                        <div class="icon-input-container">
                            <input id="editIcoInput" value="${currentIcoUrl}" class="edit-input">
                            <button id="editSearchIconBtn" class="search-icon-btn" title="Найти иконку в интернете">🔍</button>
                        </div>
                    </div>
                    <div style="margin-top: 20px; display: flex; justify-content: space-between;">
                        <button class="modal-button cancel-btn">Отмена</button>
                        <button class="modal-button confirm-btn">Сохранить</button>
                    </div>
                </div>
            `;

            document.body.appendChild(modal);

            // Фокусируемся на поле ввода названия
            modal.querySelector('#editNameInput').focus();

            // Обработчик для кнопки поиска иконки
            modal.querySelector('#editSearchIconBtn').addEventListener('click', () => {
                const nameInput = modal.querySelector('#editNameInput');
                if (nameInput && nameInput.value.trim()) {
                    const searchQuery = encodeURIComponent(nameInput.value.trim() + ' обложка');
                    const searchUrl = `https://yandex.ru/images/search?text=${searchQuery}`;
                    window.electronAPI.openExternal(searchUrl);
                } else {
                    showError('Введите название перед поиском иконки');
                }
            });

            modal.querySelector('.cancel-btn').addEventListener('click', () => {
                document.body.removeChild(modal);
            });

            modal.querySelector('.confirm-btn').addEventListener('click', async () => {
                const newName = modal.querySelector('#editNameInput').value.trim();
                const newIcoUrl = modal.querySelector('#editIcoInput').value.trim();
                if (!newName) {
                    await showError('Пожалуйста, введите название');
                    return;
                }

                try {
                    const section = document.querySelector('.nav-item.active')?.dataset.section;
                    await window.electronAPI.updateData(section, oldName, newName, newIcoUrl);

                    // Обновляем карточку без перерисовки всего раздела
                    const card = document.querySelector(`.data-card[data-name="${oldName}"]`);
                    if (card) {
                        // Обновляем название
                        const titleElement = card.querySelector('.data-title');
                        if (titleElement) titleElement.textContent = newName;

                        // Обновляем иконку
                        const icon = card.querySelector('.game-icon');
                        if (icon) {
                            icon.src = newIcoUrl;
                            icon.onerror = () => {
                                icon.src = 'https://apptor.studio/assets/cache/images/600-856x600-629.png';
                            };
                        }

                        // Обновляем data-name карточки
                        card.dataset.name = newName;

                        // Обновляем data-name в кнопках (если нужно)
                        const buttons = card.querySelectorAll('[data-name]');
                        buttons.forEach(btn => {
                            btn.dataset.name = newName;
                        });
                    }

                    document.body.removeChild(modal);
                } catch (error) {
                    console.error('Ошибка при обновлении:', error);
                    await showError('Не удалось обновить карточку');
                }
            });

            modal.addEventListener('click', (e) => {
                if (e.target === modal) {
                    document.body.removeChild(modal);
                }
            });
        });
    });
}
function setupCardClickHandlers() {


    document.querySelectorAll('.data-card').forEach(card => {
        card.style.cursor = 'pointer';
        card.addEventListener('click', async function(e) {
            // Проверяем, не кликнули ли на внутренние кнопки
            if (e.target.closest('.change-image-btn') ||
                e.target.closest('.change-category-btn') ||
                e.target.closest('.delete-btn') ||
                e.target.closest('.data-title') ||
                e.target.closest('.editable-field')) {
                return; // Если кликнули на кнопку или редактируемое поле, ничего не делаем
            }

            const itemName = this.dataset.name;
            if (itemName) {
                const searchUrl = `https://www.google.com/search?q=${encodeURIComponent(itemName)}`;
                await window.electronAPI.openSearch(searchUrl);
            }
        });
    });
}

randomBtn.addEventListener('click', async () => {
    await pickRandomVisibleCard();
});

searchInWebBtn.addEventListener('click', async () => {
    await searchCardInWeb();
});


function highlightRandomCard(cardName) {
    // Снимаем подсветку со всех карточек
    document.querySelectorAll('.data-card').forEach(card => {
        card.style.boxShadow = '';
        card.style.transform = '';
    });

    // Находим нужную карточку
    const card = document.querySelector(`.data-card[data-name="${cardName}"]`);
    if (card) {
        // Подсвечиваем карточку
        card.style.boxShadow = '0 0 20px rgba(155, 89, 182, 0.8)';
        card.style.transform = 'scale(1.05)';

        // Прокручиваем к карточке
        card.scrollIntoView({
            behavior: 'smooth',
            block: 'center'
        });

        // Снимаем подсветку через 3 секунды
        setTimeout(() => {
            card.style.boxShadow = '';
            card.style.transform = '';
        }, 3000);
    }
}

async function pickRandomVisibleCard() {
    try {
        const visibleCards = document.querySelectorAll('.data-card');
        if (visibleCards.length === 0) {
            await showError('Нет видимых карточек');
            return;
        }

        const randomIndex = Math.floor(Math.random() * visibleCards.length);
        const randomCard = visibleCards[randomIndex];
        const cardName = randomCard.dataset.name;

        // Открываем поиск
        const searchUrl = `https://www.google.com/search?q=${encodeURIComponent(cardName)}`;
        window.electronAPI.openSearch(searchUrl);

        // Подсвечиваем карточку
        highlightRandomCard(cardName);

    } catch (error) {
        console.error('Ошибка:', error);
    }
}

async function searchCardInWeb() {
    try {
        const section = document.querySelector('.nav-item.active')?.dataset.section;


        // Открываем поиск
        const searchUrl = `https://www.google.com/search?q=${encodeURIComponent('популярное в разделе ' + section)}`;
        window.electronAPI.openSearch(searchUrl);

        // Подсвечиваем карточку
        highlightRandomCard(cardName);

    } catch (error) {
        console.error('Ошибка:', error);
    }
}

function setupPreviewUpdate() {
    const nameInput = document.getElementById('nameInput');
    const icoInput = document.getElementById('icoInput');
    const ratingSelect = document.getElementById('ratingSelect');
    const statusSelect = document.getElementById('statusSelect');

    function updatePreview() {
        const previewCard = document.getElementById('previewCard');
        if (!previewCard) return;

        const name = nameInput?.value || 'Название';
        const icoUrl = icoInput?.value || '';
        const rating = ratingSelect?.value || '0';
        const status = statusSelect?.value || 'Уточнить';

        // Обновляем иконку
        const icon = previewCard.querySelector('.game-icon');
        if (icon) {
            if (icoUrl) {
                icon.src = icoUrl;
                icon.onerror = () => {
                    icon.src = 'https://apptor.studio/assets/cache/images/600-856x600-629.png';
                };
            } else {
                icon.src = 'https://apptor.studio/assets/cache/images/600-856x600-629.png';
            }
        }

        // Обновляем название
        const title = previewCard.querySelector('.preview-data-title');
        if (title) {
            title.textContent = name || 'Название';
        }

        // Обновляем рейтинг
        const ratingElement = previewCard.querySelector('.preview-card-rating');
        if (ratingElement) {
            ratingElement.textContent = rating;
            ratingElement.style.backgroundColor = getRatingColor(rating);
        }

        // Обновляем статус
        const statusElement = previewCard.querySelector('.preview-card-status');
        if (statusElement) {
            statusElement.textContent = status;
            statusElement.style.backgroundColor = getStatusColor(status);
        }
    }

    // Назначаем обработчики событий
    if (nameInput) nameInput.addEventListener('input', updatePreview);
    if (icoInput) icoInput.addEventListener('input', updatePreview);
    if (ratingSelect) ratingSelect.addEventListener('change', updatePreview);
    if (statusSelect) statusSelect.addEventListener('change', updatePreview);

    // Инициализируем превью
    setTimeout(updatePreview, 100);
}

function updatePreview(name, icoUrl, rating, status) {
    const previewCard = document.getElementById('previewCard');
    if (!previewCard) return;

    // Обновляем иконку
    const icon = previewCard.querySelector('.game-icon');
    if (icon && icoUrl) {
        if (icoUrl) {
            icon.src = icoUrl;
            icon.onerror = () => {
                icon.src = 'https://apptor.studio/assets/cache/images/600-856x600-629.png';
            };
        } else {
            icon.src = 'https://apptor.studio/assets/cache/images/600-856x600-629.png';
        }
    }

    if (name) {
        const title = previewCard.querySelector('.preview-data-title');
        title.textContent = name || 'Название';
    }

    if (rating) {
        const ratingElement = previewCard.querySelector('.preview-card-rating');
        ratingElement.textContent = rating;
        ratingElement.style.backgroundColor = getRatingColor(rating);
    }

    if (status) {
        const statusElement = previewCard.querySelector('.preview-card-status');
        statusElement.textContent = status;
        statusElement.style.backgroundColor = getStatusColor(status);
    }
}

function setupAddButton() {
    const toggleBtn = document.getElementById('toggleAddFormBtn');
    const addForm = document.getElementById('addForm');

    if (toggleBtn && addForm) {
        toggleBtn.addEventListener('click', async (e) => {
            addForm.classList.toggle('visible');
            toggleBtn.textContent = addForm.classList.contains('visible') ? '− Скрыть' : '+ Добавить';

            if (addForm.classList.contains('visible')) {
                try {
                    const text = await navigator.clipboard.readText();
                    const nameInput = document.getElementById('nameInput');

                    if (text && nameInput && text !== lastTextFromClipboard && !text.startsWith('http')) {
                        nameInput.value = text;
                        lastTextFromClipboard = text;
                        updatePreview(text, null, null, null);
                        await autoSearchCover(text);
                    }
                    document.getElementById('nameInput')?.focus();
                } catch (error) {
                    console.error('Ошибка чтения буфера обмена:', error);
                }
            }
        });
    }
}

async function autoSearchCover(title) {
    if (!title || title.trim() === '') return;

    const icoInput = document.getElementById('icoInput');
    if (icoInput) {
        icoInput.value = 'Ищем обложку...';
        icoInput.style.color = '#91c9d6';
        icoInput.style.borderColor = '#91c9d6';
        icoInput.disabled = true;
    }

    try {
        const section = document.querySelector('.nav-item.active')?.dataset.section;
        let imageUrl = '';


        // Можно использовать разные поиски в зависимости от категории
        imageUrl = await window.electronAPI.searchImage(title);

        if (imageUrl && icoInput) {
            icoInput.value = imageUrl;
            icoInput.disabled = false;

            // Обновляем превью
            updatePreview(title, imageUrl,
                document.getElementById('ratingSelect')?.value || '5',
                document.getElementById('statusSelect')?.value || 'Уточнить');
        } else {
            if (icoInput) {
                icoInput.value = '';
                icoInput.disabled = false;
            }
        }
        icoInput.style.color = null;
        icoInput.style.borderColor = null;

    } catch (error) {
        console.error('Ошибка поиска обложки:', error);
        if (icoInput) {
            icoInput.value = '';
            icoInput.disabled = false;
        }
    }
}

function setupFilterButtons() {
    document.querySelectorAll('.filter-button').forEach(button => {
        button.addEventListener('click', () => {
            document.querySelectorAll('.filter-button').forEach(btn => {
                btn.classList.remove('active');
            });
            button.classList.add('active');
            currentFilters.statusFilter = button.dataset.status;
            filterCards(currentFilters.searchQuery);
        });
    });
}

function setupSortButtons() {
    const sortButtons = document.querySelectorAll('.sort-button');
    sortButtons.forEach(button => {
        if (button.dataset.sort === (currentFilters.sortBy || 'date')) {
            button.classList.add('active');
        } else {
            button.classList.remove('active');
        }
        button.replaceWith(button.cloneNode(true));
    });
    document.querySelectorAll('.sort-button').forEach(button => {
        button.addEventListener('click', () => {
            document.querySelectorAll('.sort-button').forEach(btn => {
                btn.classList.remove('active');
            });
            button.classList.add('active');
            currentFilters.sortBy = button.dataset.sort;
            filterCards(currentFilters.searchQuery);
        });
    });
}