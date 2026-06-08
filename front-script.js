// Глобальные переменные
const errorModal = document.getElementById('errorModal');
const modalMessage = document.getElementById('modalMessage');
const modalClose = document.getElementById('modalClose');
const scrollToTopBtn = document.getElementById('scrollToTopBtn');

const donateModal = document.getElementById('donateModal');
const closeDonateModal = document.getElementById('closeDonateModal');
const randomBtn = document.getElementById('randomBtn');
const searchInWebBtn = document.getElementById('searchInWeb');
let addFormOverlay = null;
let tooltipElement = null;
let tooltipTimeout = null;

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
let itemsPerPage = 20; // Количество элементов на странице
let isLoading = false;
let allItemsLoaded = false;

let currentFilters = {
    searchQuery: '',
    statusFilter: 'Все'
};

let currentUser = null;
const authBtn = document.getElementById('authBtn');
const authModal = document.getElementById('authModal');
const closeAuthModal = document.getElementById('closeAuthModal');
const loginBtn = document.getElementById('loginBtn');
const registerBtn = document.getElementById('registerBtn');
const showRegisterBtn = document.getElementById('showRegisterBtn');
const showLoginBtn = document.getElementById('showLoginBtn');
const authLoginForm = document.getElementById('authLoginForm');
const authRegisterForm = document.getElementById('authRegisterForm');

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
    }

    if (closeBtn) {
        closeBtn.addEventListener('click', () => {
            window.electronAPI.closeWindow();
        });
    }
});

window.addEventListener('resize', () => {
    let itemsPerPagePred = itemsPerPage;
    itemsPerPage = calculateItemsPerPage();
    if (itemsPerPage > itemsPerPagePred) { loadMoreItems(); }
});

function updateStats() {
    const data = window.filteredData || window.allSectionData || [];
    const total = data.length;
    const completed = data.filter(item => item.status === 'Завершено' || item.status === 'Избранное').length;

    // Для статистики в заголовке
    const titleCompleted = document.getElementById('titleCompleted');
    const titleTotal = document.getElementById('titleTotal');
    if (titleCompleted) titleCompleted.textContent = completed;
    if (titleTotal) titleTotal.textContent = total;

    // Для статистики в контенте (если оставишь)
    const completedSpan = document.getElementById('completedCount');
    const totalSpan = document.getElementById('totalCount');
    if (completedSpan) completedSpan.textContent = completed;
    if (totalSpan) totalSpan.textContent = total;
}


function createTooltip() {
    if (!tooltipElement) {
        tooltipElement = document.createElement('div');
        tooltipElement.className = 'card-tooltip';
        document.body.appendChild(tooltipElement);
    }
    return tooltipElement;
}

function showTooltip(description, tags, x, y) {
    const tooltip = createTooltip();

    let tagsHtml = '';
    if (tags && tags.length > 0) {
        const maxVisible = 6;
        const visibleTags = tags.slice(0, maxVisible);
        const remainingCount = tags.length - maxVisible;

        tagsHtml = `
            <div class="card-tooltip-tags">
                ${visibleTags.map(tag => `<span class="card-tooltip-tag">#${escapeHtml(tag)}</span>`).join('')}
                ${remainingCount > 0 ? `<span class="card-tooltip-tag-more">+${remainingCount}</span>` : ''}
            </div>
        `;
    }

    let descHtml = '';
    if (description && description.trim()) {
        descHtml = `<div class="card-tooltip-desc">${escapeHtml(description)}</div>`;
    }

    if (!descHtml && !tags.length) {
        tooltip.style.display = 'none';
        return;
    }

    // Добавляем классы для разных сценариев
    let tooltipClass = 'card-tooltip';
    if (!descHtml && tags.length > 0) {
        tooltipClass += ' card-tooltip-delayed';
    }

    tooltip.className = tooltipClass;
    tooltip.innerHTML = descHtml + tagsHtml;
    tooltip.style.display = 'block';
    tooltip.style.left = (x + 15) + 'px';
    tooltip.style.top = (y + 15) + 'px';
}

function hideTooltip() {
    if (tooltipElement) {
        tooltipElement.style.display = 'none';
    }
    if (tooltipTimeout) {
        clearTimeout(tooltipTimeout);
        tooltipTimeout = null;
    }
}

function updateTooltipPosition(x, y) {
    if (tooltipElement && tooltipElement.style.display === 'block') {
        tooltipElement.style.left = (x + 15) + 'px';
        tooltipElement.style.top = (y + 15) + 'px';
    }
}

function initAddFormOverlay() {
    if (!addFormOverlay) {
        addFormOverlay = document.createElement('div');
        addFormOverlay.className = 'add-form-overlay';
        document.body.appendChild(addFormOverlay);
    }
    return addFormOverlay;
}

function setupEditDescriptionButtons() {
    document.querySelectorAll('.edit-desc-btn').forEach(btn => {
        btn.addEventListener('click', async (e) => {
            e.stopPropagation();
            const itemName = btn.dataset.name;
            const card = document.querySelector(`.data-card[data-name="${itemName}"]`);
            const currentDesc = card?.dataset.description || '';
            const currentTags = JSON.parse(card?.dataset.tags || '[]');

            const modal = document.createElement('div');
            modal.className = 'modal';
            modal.style.display = 'block';
            modal.innerHTML = `
                <div class="modal-content" style="max-width: 450px; position: relative;">
                    <h3>Редактировать</h3>
                    
                    <!-- Поле для заметки -->
                    <label style="font-size: 12px; opacity: 0.7; margin-bottom: 4px;">Заметка</label>
                    <textarea id="editDescTextarea" rows="3" style="width: 100%; background: #1e1e1e; border: 1px solid #4a4a4a; border-radius: 8px; color: white; padding: 8px; margin-bottom: 12px; font-size: 13px; resize: vertical;">${escapeHtml(currentDesc)}</textarea>
                    
                    <!-- Поле для тегов -->
                    <label style="font-size: 12px; opacity: 0.7; margin-bottom: 4px;">Теги (через запятую или Enter)</label>
                    <div class="tags-input-wrapper" style="background: #1e1e1e; border: 1px solid #4a4a4a; border-radius: 8px; padding: 6px; margin-bottom: 16px;">
                        <div class="tags-list" id="modalTagsList" style="display: flex; flex-wrap: wrap; gap: 6px; margin-bottom: 6px;">
                            ${currentTags.map(tag => `
                                <span class="tag" data-tag="${escapeHtml(tag)}">
                                    ${escapeHtml(tag)}
                                    <button type="button" class="tag-remove" data-tag="${escapeHtml(tag)}">×</button>
                                </span>
                            `).join('')}
                        </div>
                        <input type="text" id="tagInput" placeholder="Например: хоррор, комедия, шедевр" autocomplete="off" style="width: 100%; background: transparent; border: none; color: white; font-size: 13px; outline: none; padding: 4px;">
                    </div>
                    <div id="tagSuggestions" class="tag-suggestions" style="display: none;"></div>
                    
                    <div style="display: flex; gap: 10px; margin-top: 10px;">
                        <button class="modal-button cancel-btn" style="flex: 1;">Отмена</button>
                        <button class="modal-button confirm-btn" style="flex: 1;">Сохранить</button>
                    </div>
                </div>
            `;

            document.body.appendChild(modal);

            const textarea = modal.querySelector('#editDescTextarea');
            const tagInput = modal.querySelector('#tagInput');
            const tagsList = modal.querySelector('#modalTagsList');
            const suggestionsDiv = modal.querySelector('#tagSuggestions');
            let tags = [...currentTags];

            // Функция позиционирования подсказок
            function positionSuggestions() {
                const rect = tagInput.getBoundingClientRect();
                const modalRect = modal.querySelector('.modal-content').getBoundingClientRect();

                suggestionsDiv.style.position = 'absolute';
                suggestionsDiv.style.top = (rect.bottom - modalRect.top) + 'px';
                suggestionsDiv.style.left = (rect.left - modalRect.left) + 'px';
                suggestionsDiv.style.minWidth = Math.max(rect.width, 150) + 'px';
            }

            // Функция обновления отображения тегов
            function renderTags() {
                tagsList.innerHTML = tags.map(tag => `
                    <span class="tag" data-tag="${escapeHtml(tag)}">
                        ${escapeHtml(tag)}
                        <button type="button" class="tag-remove" data-tag="${escapeHtml(tag)}">×</button>
                    </span>
                `).join('');

                tagsList.querySelectorAll('.tag-remove').forEach(btn => {
                    btn.addEventListener('click', (e) => {
                        e.stopPropagation();
                        const tagToRemove = btn.dataset.tag;
                        tags = tags.filter(t => t !== tagToRemove);
                        renderTags();
                    });
                });
            }

            // Добавление тега
            function addTag(tagName) {
                tagName = tagName.toLowerCase().trim();
                if (!tagName) return;
                if (tagName.includes(',')) {
                    tagName.split(',').forEach(t => addTag(t));
                    return;
                }
                if (tags.includes(tagName)) return;
                tags.push(tagName);
                renderTags();
                tagInput.value = '';
                hideSuggestions();
            }

            // Показ подсказок
            async function showSuggestions(query) {
                if (query.length < 2) {
                    hideSuggestions();
                    return;
                }
                query = query.toLowerCase();

                const matches = await window.electronAPI.searchTags(query);
                const lowerTags = tags.map(t => t.toLowerCase());
                const availableTags = matches
                    .filter(t => !lowerTags.includes(t.toLowerCase()))
                    .slice(0, 5);
                if (availableTags.length === 0) {
                    hideSuggestions();
                    return;
                }

                suggestionsDiv.innerHTML = availableTags.map(tag => `
                    <div class="tag-suggestion" data-tag="${escapeHtml(tag)}">${escapeHtml(tag)}</div>
                `).join('');

                positionSuggestions();
                suggestionsDiv.style.display = 'block';

                suggestionsDiv.querySelectorAll('.tag-suggestion').forEach(sug => {
                    sug.addEventListener('click', () => {
                        addTag(sug.dataset.tag);
                        tagInput.focus();
                    });
                });
            }

            function hideSuggestions() {
                suggestionsDiv.style.display = 'none';
            }

            // Обработчики событий для поля ввода тегов
            tagInput.addEventListener('keydown', (e) => {
                if (e.key === 'Enter' && tagInput.value.trim()) {
                    e.preventDefault();
                    addTag(tagInput.value);
                } else if (e.key === 'Backspace' && !tagInput.value && tags.length > 0) {
                    tags.pop();
                    renderTags();
                } else if (e.key === ',' && tagInput.value.trim()) {
                    e.preventDefault();
                    addTag(tagInput.value);
                }
            });

            tagInput.addEventListener('input', () => {
                const value = tagInput.value;
                if (value.endsWith(',')) {
                    addTag(value.slice(0, -1));
                } else {
                    showSuggestions(value);
                }
            });

            tagInput.addEventListener('focus', positionSuggestions);
            window.addEventListener('resize', positionSuggestions);

            // Закрытие подсказок при клике вне
            document.addEventListener('click', function closeSuggestions(e) {
                if (!suggestionsDiv.contains(e.target) && e.target !== tagInput) {
                    hideSuggestions();
                    document.removeEventListener('click', closeSuggestions);
                }
            });

            // Инициализация
            renderTags();
            textarea.focus();

            // Обработчики кнопок модалки
            modal.querySelector('.cancel-btn').onclick = () => {
                document.body.removeChild(modal);
            };

            modal.querySelector('.confirm-btn').onclick = async () => {
                const newDescription = textarea.value.trim();
                const section = document.querySelector('.nav-item.active')?.dataset.section;

                await window.electronAPI.updateDataDescription(section, itemName, newDescription);
                await window.electronAPI.updateCardTags(section, itemName, tags);

                if (card) {
                    card.dataset.description = newDescription;
                    card.dataset.tags = JSON.stringify(tags);
                }
                document.body.removeChild(modal);
            };
        });
    });
}

function showSyncChoiceModal(localData, remoteData, localTime, remoteTime) {
    let modalResolve;
    const promise = new Promise((resolve) => {
        modalResolve = resolve;

        const modal = document.createElement('div');
        modal.className = 'modal';
        modal.style.display = 'block';

        const localDate = localTime ? new Date(localTime).toLocaleString() : 'никогда';
        const remoteDate = remoteTime ? new Date(remoteTime).toLocaleString() : 'никогда';

        modal.innerHTML = `
            <div class="modal-content" style="max-width: 500px;">
                <h3>⚠️ Конфликт синхронизации</h3>
                <p>Локальные и облачные данные различаются.</p>
                <div style="background: rgba(0,0,0,0.2); padding: 10px; border-radius: 8px; margin: 15px 0;">
                    <p><img src="assets/icons/folder.svg" alt="📁" class="button-icon" style="width:14px;height:14px"> Локальные: ${localDate}</p>
                    <p><img src="assets/icons/cloud.svg" alt="☁️" class="button-icon" style="width:14px;height:14px"> Облачные: ${remoteDate}</p>
                </div>
                <p>Что вы хотите сохранить?</p>
                <div style="display: flex; gap: 10px; margin-top: 20px;">
                    <button id="syncLocalBtn" class="modal-button" style="flex: 1; background: #6c5ce7;">Локальные данные</button>
                    <button id="syncRemoteBtn" class="modal-button" style="flex: 1; background: #00b894;">Облачные данные</button>
                </div>
                <button id="syncCancelBtn" class="modal-button-close" style="margin-top: 15px;">Отмена</button>
                <div id="syncLoadingIndicator" style="display: none; margin-top: 15px; text-align: center;">
                    <div class="loading-spinner" style="width: 30px; height: 30px; margin: 0 auto;"></div>
                    <p style="margin-top: 5px;">Синхронизация...</p>
                </div>
            </div>
        `;

        document.body.appendChild(modal);

        const localBtn = modal.querySelector('#syncLocalBtn');
        const remoteBtn = modal.querySelector('#syncRemoteBtn');
        const cancelBtn = modal.querySelector('#syncCancelBtn');
        const loadingIndicator = modal.querySelector('#syncLoadingIndicator');

        const showLoading = (choice) => {
            localBtn.style.display = 'none';
            remoteBtn.style.display = 'none';
            cancelBtn.style.display = 'none';
            loadingIndicator.style.display = 'block';
            // Сохраняем modal в resolve, чтобы закрыть потом
            modalResolve({ choice, modal });
        };

        localBtn.onclick = () => showLoading('local');
        remoteBtn.onclick = () => showLoading('remote');
        cancelBtn.onclick = () => {
            document.body.removeChild(modal);
            modalResolve({ choice: null, modal: null });
        };
        modal.onclick = (e) => {
            if (e.target === modal) {
                document.body.removeChild(modal);
                modalResolve({ choice: null, modal: null });
            }
        };
    });

    return promise;
}

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

window.electronAPI.onSessionExpired(() => {
    showError('Сессия истекла, пожалуйста, войдите снова');
    currentUser = null;
    updateAuthButton(null);
});

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
        const downloadsNumber = document.getElementById('downloadsNumber');
        if (downloadsNumber && result.success) {
            downloadsNumber.textContent = result.downloads.toLocaleString();
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

document.addEventListener('click', (e) => {
    const link = e.target.closest('.donate-link');
    if (link && link.href) {
        e.preventDefault();
        window.electronAPI.openSearch(link.href);
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
                    icon.src = 'https://sun9-10.userapi.com/s/v1/ig2/ZokTL_h2fMLt6rBm9VpAljngHJORp51HrK0aE-EQxbcG8iNFrcujtVnp_xD3B3qDhN2rJRlaJgRk7bixs1XUq_z-.jpg?quality=95&as=32x21,48x32,72x48,108x72,160x107,240x160,360x240,480x320,540x360,640x426,720x480,740x493&from=bu&u=Ac2XlEuasBKNjIEznqey8baHpZpSfGg8nRMAdRH9Mjw&cs=740x0';
                };

                const allItem = window.allSectionData.find(item => item.name === name);
                if (allItem) allItem.icoUrl = newIconUrl;

                const filteredItem = window.filteredData.find(item => item.name === name);
                if (filteredItem) filteredItem.icoUrl = newIconUrl;
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
            await renderSection(section, data, true, true);
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

function updateAuthButton(email) {
    if (email) {
        authBtn.innerHTML = `<img src="assets/icons/user.svg" alt="👤" class="button-icon"> ${email.split('@')[0]}`;
        authBtn.title = "Нажмите для выхода";
    } else {
        authBtn.innerHTML = `<img src="assets/icons/user.svg" alt="👤" class="button-icon"> Войти`;
        authBtn.title = "Войти";
    }
}

// Обработчики модального окна
authBtn.addEventListener('click', () => {
    if (currentUser) {
        // Если уже авторизован - спрашиваем о выходе
        showConfirmModal('', 'Вы уверены, что хотите выйти?', 'Выйти', 'Отмена').then(async (confirmed) => {
            if (confirmed) {
                const result = await window.electronAPI.authSignOut();
                if (result.success) {
                    currentUser = null;
                    updateAuthButton(null);
                } else {
                    await showError('Ошибка выхода: ' + result.error);
                }
            }
        });
    } else {
        authModal.style.display = 'block';
    }
});

closeAuthModal.addEventListener('click', () => {
    authModal.style.display = 'none';
});

showRegisterBtn.addEventListener('click', (e) => {
    e.preventDefault();
    authLoginForm.style.display = 'none';
    authRegisterForm.style.display = 'block';
});

showLoginBtn.addEventListener('click', (e) => {
    e.preventDefault();
    authRegisterForm.style.display = 'none';
    authLoginForm.style.display = 'block';
});

loginBtn.addEventListener('click', async () => {
    const email = document.getElementById('loginEmail').value.trim();
    const password = document.getElementById('loginPassword').value;

    if (!email || !password) {
        await showError('Введите email и пароль');
        return;
    }

    // 👇 ПОКАЗЫВАЕМ ИНДИКАТОР
    const loginBtnText = loginBtn.innerHTML;
    loginBtn.innerHTML = '<div class="loading-spinner" style="width: 20px; height: 20px; margin: 0 auto;"></div> Вход...';
    loginBtn.disabled = true;

    const result = await window.electronAPI.authSignIn(email, password);

    // 👇 УБИРАЕМ ИНДИКАТОР
    loginBtn.innerHTML = loginBtnText;
    loginBtn.disabled = false;

    if (result.success) {
        currentUser = result;
        updateAuthButton(result.email);
        authModal.style.display = 'none';
        document.getElementById('loginEmail').value = '';
        document.getElementById('loginPassword').value = '';
    } else {
        await showError(result.error);
    }
});

registerBtn.addEventListener('click', async () => {
    const email = document.getElementById('registerEmail').value.trim();
    const password = document.getElementById('registerPassword').value;

    if (!email || !password) {
        await showError('Введите email и пароль');
        return;
    }

    if (password.length < 6) {
        await showError('Пароль должен быть не менее 6 символов');
        return;
    }

    const result = await window.electronAPI.authSignUp(email, password);
    if (result.success) {
        currentUser = result;
        updateAuthButton(result.email);
        authModal.style.display = 'none';
        document.getElementById('registerEmail').value = '';
        document.getElementById('registerPassword').value = '';
        await showError('Регистрация прошла успешно! Добро пожаловать!');
    } else {
        await showError(result.error);
    }
});

// Закрытие модалки по клику вне
authModal.addEventListener('click', (e) => {
    if (e.target === authModal) {
        authModal.style.display = 'none';
    }
});

// Инициализация при загрузке
document.addEventListener('DOMContentLoaded', async () => {
    window.electronAPI.onRestoreSession(async (user) => {
        if (user) {
            currentUser = user;
            updateAuthButton(user.email);
        } else {
            currentUser = null;
            updateAuthButton(null);
        }
    });

    window.electronAPI.onSyncRequired(async (syncData) => {
        if (syncData.needChoice && syncData.localData && syncData.remoteData) {
            const { choice, modal } = await showSyncChoiceModal(
                syncData.localData,
                syncData.remoteData,
                syncData.localSyncTime,
                syncData.remoteSyncTime
            );

            if (choice && modal) {
                const result = await window.electronAPI.syncApplyChoice(choice, syncData.localData, syncData.remoteData);

                // Закрываем модалку после синхронизации
                if (modal && modal.parentNode) {
                    modal.remove();
                }

                if (result.success) {
                    const section = document.querySelector('.nav-item.active')?.dataset.section;
                    if (section) {
                        const data = await window.electronAPI.getData(section);
                        await renderSection(section, data, true);
                    }
                } else {
                    await showError('Ошибка синхронизации: ' + result.error);
                }
            }
        }
    });

// Проверяем текущего пользователя при старте
    const savedUser = await window.electronAPI.authGetCurrentUser();
    if (savedUser.isAuthenticated) {
        currentUser = savedUser;
        updateAuthButton(savedUser.email);
    }
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

    data = data.map(item => ({
        ...item,
        tags: item.tags ? item.tags.split(',') : []
    }));

    window.allSectionData = data;

    if (preserveFilters) {
        window.filteredData = filterData(data, currentFilters.searchQuery, currentFilters.statusFilter);
        window.filteredData = sortData(window.filteredData, currentFilters.sortBy);
    } else {
        window.filteredData = data;
        currentFilters = { searchQuery: '', statusFilter: 'Все', sortBy: 'date' };
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
                <button id="clearSearchBtn" class="clear-search-btn">✕</button>
                <button id="searchInWeb" title="Поиск в интернете"><img src="assets/icons/find.svg" alt="🔍" class="button-icon">интернет</button>
                <button id="randomBtnSection" title="Случайная карточка"><img src="assets/icons/random.svg" alt="🎲" class="button-icon">Случайное</button>
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
    updateStats();

    // Добавляем обработчик прокрутки для бесконечной загрузки
    contentWrapper.addEventListener('scroll', handleScroll);
    setupContentWrapperScroll();
}

function filterData(data, searchQuery, statusFilter) {
    const queryLower = (searchQuery || '').toLowerCase();
    return data.filter(item => {
        // Поиск по названию
        const nameMatches = !queryLower || item.name.toLowerCase().includes(queryLower);

        // Поиск по тегам
        let tagMatches = false;
        if (queryLower && item.tags && item.tags.length) {
            tagMatches = item.tags.some(tag => tag.toLowerCase().includes(queryLower));
        }

        const matchesSearch = !queryLower || nameMatches || tagMatches;
        const statusMatches = statusFilter === 'Все' || item.status === statusFilter;

        return matchesSearch && statusMatches;
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

function calculateItemsPerPage() {
    const wrapper = document.querySelector('.data-grid');
    if (!wrapper) return 20;

    // Получаем ширину карточки (с гридом)
    const cardElement = document.querySelector('.data-card');
    if (!cardElement) return 20;

    const cardWidth = cardElement.offsetWidth;
    const wrapperWidth = wrapper.clientWidth;
    const cardsPerRow = Math.max(1, Math.floor(wrapperWidth / cardWidth));

    // Высота окна минус шапки и панели
    const availableHeight = window.innerHeight - 200;
    const cardHeight = 200; // Примерная высота карточки с отступами
    const rowsVisible = Math.max(1, Math.floor(availableHeight / cardHeight));

    // Грузим в 2 раза больше, чем видно (для плавного скролла)
    const itemsPerPage = cardsPerRow * rowsVisible * 2;

    return Math.max(12, itemsPerPage);
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
    setupEditDescriptionButtons();
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

        // Собираем совпадения по названиям
        const nameMatches = window.allSectionData.filter(item =>
            item.name.toLowerCase().includes(queryLower)
        ).slice(0, 3);

        // Собираем совпадения по тегам
        const tagMatches = [];
        const uniqueTags = new Set();

        window.allSectionData.forEach(item => {
            if (item.tags && item.tags.length) {
                item.tags.forEach(tag => {
                    if (tag.toLowerCase().includes(queryLower) && !uniqueTags.has(tag)) {
                        uniqueTags.add(tag);
                        tagMatches.push({ type: 'tag', value: tag });
                    }
                });
            }
        });

        // Объединяем и показываем
        const suggestions = [
            ...nameMatches.map(item => ({ type: 'name', value: item.name })),
            ...tagMatches.slice(0, 3)
        ].slice(0, 6);

        if (suggestions.length === 0) {
            searchSuggestions.style.display = 'none';
            return;
        }

        searchSuggestions.innerHTML = suggestions.map(s => `
        <div class="suggestion-item ${s.type === 'tag' ? 'suggestion-tag' : ''}" data-value="${escapeHtml(s.value)}" data-type="${s.type}">
            ${escapeHtml(s.value)}
        </div>
    `).join('');

        searchSuggestions.style.display = 'block';
        const searchInputRect = searchInput.getBoundingClientRect();
        searchSuggestions.style.width = searchInputRect.width + 'px';
    }

    const clearSearchBtn = document.getElementById('clearSearchBtn');
    if (clearSearchBtn) {
        clearSearchBtn.addEventListener('click', () => {
            searchInput.value = '';
            clearSearchBtn.style.display = 'none';
            filterCards('');
        });
    }

    searchInput.addEventListener('focus', () => {
        searchBtn.style.borderColor = '#91c9d6';
    });

    // При потере фокуса - убираем подсветку
    searchInput.addEventListener('blur', () => {
        searchBtn.style.borderColor = 'white';
    });

    // Обработчик ввода текста
    searchInput.addEventListener('input', (e) => {
        updateSuggestions(e.target.value);
    });

    searchSuggestions.addEventListener('click', (e) => {
        const suggestion = e.target.closest('.suggestion-item');
        if (suggestion) {
            searchInput.value = suggestion.dataset.value;
            searchSuggestions.style.display = 'none';

            // Сбрасываем фильтр статуса на "Все"
            if (currentFilters.statusFilter !== 'Все') {
                currentFilters.statusFilter = 'Все';
                document.querySelectorAll('.filter-button').forEach(btn => {
                    btn.classList.remove('active');
                    if (btn.dataset.status === 'Все') {
                        btn.classList.add('active');
                    }
                });
            }
            filterCards(suggestion.dataset.value);
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
            if (currentFilters.statusFilter !== 'Все') {
                currentFilters.statusFilter = 'Все';
                // Обновляем активную кнопку фильтра
                document.querySelectorAll('.filter-button').forEach(btn => {
                    btn.classList.remove('active');
                    if (btn.dataset.status === 'Все') {
                        btn.classList.add('active');
                    }
                });
            }
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
    updateStats();
    setupEditDescriptionButtons();


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
                <option value="games">Игры</option>
                <option value="serials">Сериалы</option>
                <option value="movies">Кино</option>
                <option value="cartoons">Мульты</option>
                <option value="anime">Аниме</option>
                <option value="books">Книги</option>
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
                const oldSectionIndex = window.allSectionData.findIndex(item => item.name === name);
                if (oldSectionIndex !== -1) {
                    window.allSectionData.splice(oldSectionIndex, 1);
                }

                const oldFilteredIndex = window.filteredData.findIndex(item => item.name === name);
                if (oldFilteredIndex !== -1) {
                    window.filteredData.splice(oldFilteredIndex, 1);
                }
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
    const overlay = document.querySelector('.add-form-overlay');

    if (addForm) {
        addForm.classList.remove('visible');
    }
    if (overlay) {
        overlay.classList.remove('visible');
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
                    <div class="preview-data-card" style="display: block; position: relative;">
                        ${getCardIconHTML({ name: 'Название', icoUrl: '' })}
                        <div class="preview-overlay">
                            <button id="previewSearchBtn" class="preview-search-btn" title="Найти обложку">
                                <img src="assets/icons/findImage.svg" alt="🔍" style="width: 32px; height: 32px;">
                            </button>
                        </div>
                        <div class="preview-data-info">
                            <h3 class="preview-data-title">Название</h3>
                            <div class="preview-data-ratings-container">
                                <span class="preview-card-rating rating-value">0</span>
                                <span class="preview-card-status status-value">Уточнить</span>
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
                        <div class="icon-input-container" style="display: flex; gap: 8px;">
                            <input id="icoInput" placeholder="Ссылка на обложку" autocomplete="off" style="display: none;">
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

function escapeHtml(str) {
    if (!str) return '';
    return str
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

function renderCardList(cards) {
    return cards.map(card => `
            <div class="data-card" data-name="${escapeHtml(card.name)}" data-description="${escapeHtml(card.description || '')}" data-tags='${JSON.stringify(card.tags || [])}' style="display: block;">
                <div class="card-hover-icon">
                    <img src="assets/icons/search-web.svg" alt="🔍">
                </div>
                <div class="card-buttons">
                    <button class="card-btn edit-desc-btn" data-name="${escapeHtml(card.name)}">
                        <img src="assets/icons/note.svg" alt="📝" class="button-icon-no-text">
                        <span class="btn-text">Заметки</span>
                    </button>
                    <button class="card-btn change-image-btn" data-name="${escapeHtml(card.name)}">
                        <img src="assets/icons/changeImage.svg" alt="🖼️" class="button-icon-no-text">
                        <span class="btn-text">Обложка</span>
                    </button>
                    <button class="card-btn change-category-btn" data-name="${escapeHtml(card.name)}" data-status="${card.status}" data-rating="${card.rating}" datatype="${card.icoUrl}">
                        <img src="assets/icons/changeCategory.svg" alt="⇄" class="button-icon-no-text">
                        <span class="btn-text">Переместить</span>
                    </button>
                    <button class="card-btn delete-btn" data-name="${escapeHtml(card.name)}">
                        <img src="assets/icons/delete.svg" alt="🗑️" class="button-icon-no-text">
                    </button>
                </div>
                ${getCardIconHTML(card)}
                <div class="data-info">
                    <h3 class="data-title">${escapeHtml(card.name)}</h3>
                    <div class="data-ratings-container">
                        <span class="card-rating rating-value editable-field"
                              data-rating="${card.rating}"
                              data-name="${escapeHtml(card.name)}"
                              title="Редактировать">
                            ${card.rating || '0'}
                        </span>
                        <span class="card-status status-value editable-field"
                              data-status="${card.status}"
                              data-name="${escapeHtml(card.name)}"
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
        status: statusSelect.value,
        description: '',
        tags: []
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
        let overlay = document.querySelector('.add-form-overlay');
        overlay.classList.remove('visible');
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
                ${title ? `<h3>${title}</h3>` : ''}
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
    updateStats();
}

async function showEditableDropdown(field, valueDisplay) {
    // Закрываем все открытые списки
    closeAllDropdowns();

    const isRating = field.classList.contains('rating-value');
    const currentValue = isRating ? field.dataset.rating : field.dataset.status;
    const itemName = field.dataset.name;

    let values;
    if (isRating) {
        values = await window.electronAPI.getRatings();
    } else {
        values = await window.electronAPI.getStatusesNoImport();
    }

    // Создаём кастомный список
    const dropdown = document.createElement('div');
    dropdown.className = 'custom-dropdown';

    // Позиционируем относительно поля
    const rect = valueDisplay.getBoundingClientRect();
    const viewportHeight = window.innerHeight;
    let dropdownHeight;
    if (isRating) {
        dropdownHeight = Math.min(values.length * 32 + 8, 265);
    } else {
        dropdownHeight = Math.min(values.length * 28 + 8, 170); // статусов меньше, но строки ниже
    }

// Отступ от кнопки (5px)
    const gap = 5;

// Пытаемся показать снизу
    let top = rect.bottom + gap;
    let openDirection = 'down';

// Если не влезает снизу - показываем сверху
    if (top + dropdownHeight > viewportHeight - gap) {
        top = rect.top - dropdownHeight - gap;
        openDirection = 'up';
    }

// Если и сверху не влезает - прижимаем к верху/низу экрана
    if (top < gap) {
        top = gap;
        openDirection = 'down';
    }

    dropdown.style.position = 'fixed';
    dropdown.style.top = top + 'px';
    dropdown.style.left = rect.left + 'px';
    dropdown.style.minWidth = (rect.width - 10) + 'px';
    dropdown.style.maxWidth = (rect.width + 20) + 'px';
    dropdown.dataset.direction = openDirection;

    // Добавляем опции
    values.forEach(value => {
        const option = document.createElement('div');
        option.className = `custom-dropdown-option ${value === currentValue ? 'selected' : ''}`;
        option.textContent = value;

        // Добавляем атрибут для цвета
        if (isRating) {
            option.setAttribute('data-rating', value);
        } else {
            option.setAttribute('data-status', value);
        }

        option.addEventListener('click', async (e) => {
            e.stopPropagation();
            await updateFieldValue(field, valueDisplay, value, itemName, isRating);
            closeDropdown();
        });

        dropdown.appendChild(option);
    });

    document.body.appendChild(dropdown);

    // Анимация появления
    requestAnimationFrame(() => {
        dropdown.classList.add('visible');
    });

    // Затемнение фона
    const overlay = document.createElement('div');
    overlay.className = 'custom-dropdown-overlay';
    overlay.onclick = closeDropdown;
    document.body.appendChild(overlay);

    function closeDropdown() {
        dropdown.classList.remove('visible');
        overlay.classList.remove('visible');
        setTimeout(() => {
            if (dropdown.parentNode) dropdown.remove();
            if (overlay.parentNode) overlay.remove();
        }, 150);
    }
}

async function updateFieldValue(field, valueDisplay, newValue, itemName, isRating) {
    try {
        const section = document.querySelector('.nav-item.active')?.dataset.section;
        const updateItemInArrays = (itemName, updates) => {
            // Обновляем в allSectionData
            const allItem = window.allSectionData.find(item => item.name === itemName);
            if (allItem) Object.assign(allItem, updates);

            // Обновляем в filteredData
            const filteredItem = window.filteredData.find(item => item.name === itemName);
            if (filteredItem) Object.assign(filteredItem, updates);
        };
        if (isRating) {
            await window.electronAPI.updateDataRating(section, itemName, newValue);
            field.dataset.rating = newValue;
            valueDisplay.style.backgroundColor = getRatingColor(newValue);
            updateItemInArrays(itemName, { rating: newValue });
        } else {
            await window.electronAPI.updateDataStatus(section, itemName, newValue);
            field.dataset.status = newValue;
            valueDisplay.style.backgroundColor = getStatusColor(newValue);
            updateItemInArrays(itemName, { status: newValue });
        }
        updateStats();
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
                    const itemIndex = window.allSectionData.findIndex(item => item.name === itemName);
                    if (itemIndex !== -1) window.allSectionData.splice(itemIndex, 1);

                    const filteredIndex = window.filteredData.findIndex(item => item.name === itemName);
                    if (filteredIndex !== -1) {
                        window.filteredData.splice(filteredIndex, 1);
                    }
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
    const previewSearchBtn = document.getElementById('previewSearchBtn');
    if (previewSearchBtn) {
        previewSearchBtn.addEventListener('click', () => {
            const nameInput = document.getElementById('nameInput');
            if (nameInput && nameInput.value.trim()) {
                const searchQuery = encodeURIComponent(nameInput.value.trim() + ' обложка');
                const searchUrl = `https://yandex.ru/images/search?text=${searchQuery}`;
                window.electronAPI.openExternal(searchUrl);
            } else {
                showError('Сначала введите название');
                nameInput?.focus();
            }
        });
    }

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
                                icon.src = 'https://sun9-10.userapi.com/s/v1/ig2/ZokTL_h2fMLt6rBm9VpAljngHJORp51HrK0aE-EQxbcG8iNFrcujtVnp_xD3B3qDhN2rJRlaJgRk7bixs1XUq_z-.jpg?quality=95&as=32x21,48x32,72x48,108x72,160x107,240x160,360x240,480x320,540x360,640x426,720x480,740x493&from=bu&u=Ac2XlEuasBKNjIEznqey8baHpZpSfGg8nRMAdRH9Mjw&cs=740x0';
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

                    const updateItemInArrays = (oldName, newName) => {
                        // Обновляем в allSectionData
                        const allItem = window.allSectionData.find(item => item.name === oldName);
                        if (allItem) allItem.name = newName;

                        // Обновляем в filteredData
                        const filteredItem = window.filteredData.find(item => item.name === oldName);
                        if (filteredItem) filteredItem.name = newName;
                    };

                    updateItemInArrays(oldName, newName);
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

        card.addEventListener('mouseenter', (e) => {
            const description = card.dataset.description || '';
            const tags = JSON.parse(card.dataset.tags || '[]');
            showTooltip(description, tags, e.clientX, e.clientY);
        });

        card.addEventListener('mousemove', (e) => {
            if (tooltipElement && tooltipElement.style.display === 'block') {
                updateTooltipPosition(e.clientX, e.clientY);
            }
        });

        card.addEventListener('mouseleave', () => {
            hideTooltip();
        });

        card.addEventListener('click', async function(e) {
            if (e.target.closest('.edit-desc-btn') ||
                e.target.closest('.change-image-btn') ||
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
    // Находим карточку
    const card = document.querySelector(`.data-card[data-name="${cardName}"]`);

    if (!card) return;

    // Убираем подсветку с предыдущей карточки
    const prevHighlight = document.querySelector('.data-card.random-highlight');
    if (prevHighlight) {
        prevHighlight.classList.remove('random-highlight');
        // Убираем обработчик клика с предыдущей
        prevHighlight.removeEventListener('click', removeHighlightOnClick);
    }

    // Добавляем новую подсветку (бесконечную)
    card.classList.add('random-highlight');

    // Добавляем обработчик клика для снятия подсветки
    card.addEventListener('click', removeHighlightOnClick);

    // Находим контейнер со скроллом
    const scrollContainer = document.querySelector('.content-wrapper');

    if (!scrollContainer) {
        console.error('Content wrapper not found');
        return;
    }

    // Плавно скроллим к карточке
    setTimeout(() => {
        if (!card || !document.body.contains(card)) return;

        const containerRect = scrollContainer.getBoundingClientRect();
        const cardRect = card.getBoundingClientRect();

        const scrollTop = scrollContainer.scrollTop;
        const targetScroll = scrollTop + (cardRect.top - containerRect.top) - (containerRect.height / 2) + (cardRect.height / 2);

        scrollContainer.scrollTo({
            top: Math.max(0, targetScroll),
            behavior: 'smooth'
        });
    }, 100);

    // Функция для снятия подсветки по клику
    function removeHighlightOnClick() {
        if (card && document.body.contains(card)) {
            card.classList.remove('random-highlight');
            card.removeEventListener('click', removeHighlightOnClick);
        }
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

        // Подсвечиваем карточку
        highlightRandomCard(cardName);

    } catch (error) {
        console.error('Ошибка:', error);
    }
}

async function searchCardInWeb() {
    try {
        const section = document.querySelector('.nav-item.active')?.dataset.section;
        const textFromInput = document.getElementById('searchInput')?.value;

        const searchText = textFromInput? textFromInput : 'популярное в разделе ' + section;
        const searchUrl = `https://www.google.com/search?q=${encodeURIComponent(searchText)}`;
        window.electronAPI.openSearch(searchUrl);
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
                    icon.src = 'https://sun9-10.userapi.com/s/v1/ig2/ZokTL_h2fMLt6rBm9VpAljngHJORp51HrK0aE-EQxbcG8iNFrcujtVnp_xD3B3qDhN2rJRlaJgRk7bixs1XUq_z-.jpg?quality=95&as=32x21,48x32,72x48,108x72,160x107,240x160,360x240,480x320,540x360,640x426,720x480,740x493&from=bu&u=Ac2XlEuasBKNjIEznqey8baHpZpSfGg8nRMAdRH9Mjw&cs=740x0';
                };
            } else {
                icon.src = 'https://sun9-10.userapi.com/s/v1/ig2/ZokTL_h2fMLt6rBm9VpAljngHJORp51HrK0aE-EQxbcG8iNFrcujtVnp_xD3B3qDhN2rJRlaJgRk7bixs1XUq_z-.jpg?quality=95&as=32x21,48x32,72x48,108x72,160x107,240x160,360x240,480x320,540x360,640x426,720x480,740x493&from=bu&u=Ac2XlEuasBKNjIEznqey8baHpZpSfGg8nRMAdRH9Mjw&cs=740x0';
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
                icon.src = 'https://sun9-10.userapi.com/s/v1/ig2/ZokTL_h2fMLt6rBm9VpAljngHJORp51HrK0aE-EQxbcG8iNFrcujtVnp_xD3B3qDhN2rJRlaJgRk7bixs1XUq_z-.jpg?quality=95&as=32x21,48x32,72x48,108x72,160x107,240x160,360x240,480x320,540x360,640x426,720x480,740x493&from=bu&u=Ac2XlEuasBKNjIEznqey8baHpZpSfGg8nRMAdRH9Mjw&cs=740x0';
            };
        } else {
            icon.src = 'https://sun9-10.userapi.com/s/v1/ig2/ZokTL_h2fMLt6rBm9VpAljngHJORp51HrK0aE-EQxbcG8iNFrcujtVnp_xD3B3qDhN2rJRlaJgRk7bixs1XUq_z-.jpg?quality=95&as=32x21,48x32,72x48,108x72,160x107,240x160,360x240,480x320,540x360,640x426,720x480,740x493&from=bu&u=Ac2XlEuasBKNjIEznqey8baHpZpSfGg8nRMAdRH9Mjw&cs=740x0';
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

    const overlay = initAddFormOverlay();

    function closeAddForm() {
        addForm.classList.remove('visible');
        overlay.classList.remove('visible');
        toggleBtn.textContent = '+ Добавить';
    }

    // Закрытие по клику на overlay
    overlay.onclick = closeAddForm;

    if (toggleBtn && addForm) {
        toggleBtn.onclick = async (e) => {
            e.stopPropagation();

            const isVisible = addForm.classList.contains('visible');

            if (isVisible) {
                closeAddForm();
            } else {
                addForm.classList.add('visible');
                overlay.classList.add('visible');
                toggleBtn.textContent = '− Скрыть';

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
        };
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