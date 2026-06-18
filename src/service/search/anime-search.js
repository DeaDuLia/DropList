import {parseSite} from "./data-search.js";


export async function fetchYummyAniTags(animeName) {
    return parseSite('YummyAni',
        `https://old.yummyani.me/search?word=${encodeURIComponent(animeName)}`,
        `
            (function() {
                const firstCard = document.querySelector('.grid-container.animes-search .anime-column');
                if (!firstCard) return null;
                const link = firstCard.querySelector('a.image-block');
                return link ? link.href : null;
            })()
        `,
        `
            (function() {
                let fullTitle = '';
                const titleElement = document.querySelector('h1[itemprop="name"]');
                if (titleElement) fullTitle = titleElement.textContent.trim();
                
                const tags = [];
                const genreContainer = document.querySelector('.categories-list.no-comma');
                if (genreContainer) {
                    genreContainer.querySelectorAll('ul li a.badge').forEach(el => {
                        const text = el.textContent.trim();
                        if (text && !tags.includes(text)) tags.push(text);
                    });
                }
                
                let coverUrl = '';
        
                // Пробуем img с классом bordered-top
                const coverImg = document.querySelector('img.bordered-top');
                if (coverImg && coverImg.src) {
                    coverUrl = coverImg.src;
                }
                
                // Если нет, пробуем data-full
                if (!coverUrl) {
                    const fullImg = document.querySelector('[data-full]');
                    if (fullImg && fullImg.getAttribute('data-full')) {
                        coverUrl = fullImg.getAttribute('data-full');
                    }
                }
                
                // Если всё ещё нет, ищем любое изображение в блоке
                if (!coverUrl) {
                    const anyImg = document.querySelector('.image-block img, .bordered-top');
                    if (anyImg && anyImg.src) {
                        coverUrl = anyImg.src;
                    }
                }
                
                if (coverUrl && coverUrl.startsWith('//')) coverUrl = 'https:' + coverUrl;
                
                let releaseDate = null;
                const timeCounter = document.querySelector('time-counter');
                if (timeCounter && timeCounter.getAttribute('data-time')) {
                    const timestamp = timeCounter.getAttribute('data-time');
                    if (timestamp) {
                        const date = new Date(parseInt(timestamp) * 1000);
                        if (!isNaN(date.getTime())) releaseDate = date.toISOString().split('T')[0];
                    }
                }
                
                return { tags: tags.slice(0, 12), description: '', coverUrl, fullTitle, releaseDate };
            })()
        `);
}

export async function fetchAnimeGoTags(animeName) {
    return parseSite(
        'AnimeGo',
        `https://animego.me/search/all?q=${encodeURIComponent(animeName)}&navbar=true`,
        // targetUrlParser — ищем ссылку на страницу аниме
        `
            (function() {
                // Ищем первый элемент в сетке результатов
                const gridItem = document.querySelector('.ani-grid__item:not(.d-none)');
                if (!gridItem) return null;
                
                // Ищем ссылку внутри .ani-grid__item-picture
                const link = gridItem.querySelector('.ani-grid__item-picture');
                if (!link) return null;
                
                const href = link.getAttribute('href');
                if (!href) return null;
                
                // Возвращаем полный URL
                return href.startsWith('http') ? href : 'https://animego.me' + href;
            })()
        `,
        // dataParser — парсим страницу аниме
        // dataParser — исправленный поиск даты
        // dataParser — с полным дебагом
        // dataParser — исправленный цикл по полям
        // dataParser — один цикл для тегов и даты
        // dataParser — теги работают, дата добавилась
        // dataParser — исправленный
        // dataParser — без циклов, только прямые селекторы
        // dataParser — с поддержкой сокращений
        // dataParser — финальная версия
        // dataParser — финальная версия (ищем по цифрам)
        // dataParser — финальная версия
        `
(function() {
    const debug = { steps: [], foundFields: [], dateAttempts: [] };

    // ===== НАЗВАНИЕ =====
    let fullTitle = '';
    const titleElement = document.querySelector('.entity__title h1');
    if (titleElement) {
        fullTitle = titleElement.textContent.trim();
        debug.steps.push('✅ Title found: "' + fullTitle + '"');
    } else {
        debug.steps.push('❌ Title NOT found');
    }

    // ===== ОБЛОЖКА =====
    let coverUrl = '';
    const coverImg = document.querySelector('.entity__poster .image__img');
    if (coverImg && coverImg.src) {
        coverUrl = coverImg.src;
        if (coverUrl.startsWith('//')) coverUrl = 'https:' + coverUrl;
        debug.steps.push('✅ Cover found');
    } else {
        debug.steps.push('❌ Cover NOT found');
    }

    // ===== ТЕГИ =====
    const tags = [];
    const skipLabels = ['Статус', 'Озвучка', 'Главные герои', 'Студия', 'Режиссёр', 'Автор оригинала', 'Первоисточник', 'Длительность', 'Эпизоды', 'Сезон'];

    const fieldBlocks = document.querySelectorAll('.entity-field .g-col-5');
    debug.steps.push('📊 Found ' + fieldBlocks.length + ' field blocks for tags');

    fieldBlocks.forEach((labelBlock) => {
        const label = labelBlock.textContent.trim();
        if (skipLabels.includes(label)) return;

        const valueBlock = labelBlock.nextElementSibling;
        if (!valueBlock || !valueBlock.classList.contains('g-col-7')) return;

        const genresContainer = valueBlock.querySelector('.entity-field__genres');
        if (genresContainer) {
            genresContainer.querySelectorAll('a').forEach(el => {
                const text = el.textContent.trim();
                if (text && !tags.includes(text)) tags.push(text);
            });
            return;
        }

        if (label === 'Возраст') {
            const ageSpan = valueBlock.querySelector('.entity-field__classification');
            if (ageSpan) {
                const ageText = ageSpan.textContent.trim();
                if (ageText && !tags.includes(ageText)) tags.push(ageText);
            }
            return;
        }

        if (label === 'Рейтинг') {
            const ratingSpan = valueBlock.querySelector('.b-tooltipped');
            if (ratingSpan) {
                const ratingText = ratingSpan.textContent.trim();
                if (ratingText && !tags.includes(ratingText)) tags.push(ratingText);
            }
            return;
        }

        if (label === 'Тип') {
            const typeText = valueBlock.textContent.trim();
            if (typeText && !tags.includes(typeText)) tags.push(typeText);
            return;
        }
    });

    // ===== ДАТА РЕЛИЗА =====
    let releaseDate = null;

    // 1. Пробуем найти "Следующий эпизод"
    const nextEpisodeBlock = document.querySelector('.g-col-7 .b-tooltipped');
    if (nextEpisodeBlock) {
        const parentField = nextEpisodeBlock.closest('.entity-field');
        if (parentField) {
            const labelBlock = parentField.querySelector('.g-col-5');
            if (labelBlock && labelBlock.textContent.trim() === 'Следующий эпизод') {
                let dateText = nextEpisodeBlock.textContent.trim();
                dateText = dateText.replace('.', '');
                debug.dateAttempts.push('📅 Next episode raw: "' + dateText + '"');
                
                const months = {
                    'янв': '01', 'января': '01',
                    'фев': '02', 'февраля': '02',
                    'мар': '03', 'марта': '03',
                    'апр': '04', 'апреля': '04',
                    'мая': '05', 'май': '05',
                    'июн': '06', 'июня': '06',
                    'июл': '07', 'июля': '07',
                    'авг': '08', 'августа': '08',
                    'сен': '09', 'сентября': '09',
                    'окт': '10', 'октября': '10',
                    'ноя': '11', 'ноября': '11',
                    'дек': '12', 'декабря': '12'
                };
                
                const parts = dateText.trim().split(/\\s+/);
                if (parts.length >= 3) {
                    const day = parts[0].padStart(2, '0');
                    const monthName = parts[1].toLowerCase();
                    const year = parts[2];
                    const month = months[monthName];
                    if (month && year.match(/^\\d{4}$/)) {
                        releaseDate = year + '-' + month + '-' + day;
                        debug.dateAttempts.push('✅ Next episode parsed: ' + releaseDate);
                    }
                }
            }
        }
    }
    
    // 2. Если нет "Следующий эпизод" — ищем "Выпуск" по data-label
    if (!releaseDate) {
        const releaseBlocks = document.querySelectorAll('.g-col-7[data-label]');
        debug.dateAttempts.push('📊 Found ' + releaseBlocks.length + ' blocks with data-label');
        
        for (const block of releaseBlocks) {
            const dataLabel = block.getAttribute('data-label').trim();
            debug.dateAttempts.push('📌 data-label: "' + dataLabel + '"');
            
            // 🔥 УБИРАЕМ "с " В НАЧАЛЕ
            let cleaned = dataLabel;
            if (cleaned.startsWith('с ')) {
                cleaned = cleaned.substring(2);
            }
            // 🔥 УБИРАЕМ " по ..." В КОНЦЕ
            const poIndex = cleaned.indexOf(' по ');
            if (poIndex !== -1) {
                cleaned = cleaned.substring(0, poIndex);
            }
            cleaned = cleaned.replace('.', '');
            debug.dateAttempts.push('📅 Cleaned: "' + cleaned + '"');
            
            // 🔥 РАЗБИВАЕМ ПО ПРОБЕЛАМ
            const parts = cleaned.trim().split(/\\s+/);
            debug.dateAttempts.push('📅 Parts: ' + JSON.stringify(parts));
            
            if (parts.length >= 3) {
                const day = parts[0].padStart(2, '0');
                const monthName = parts[1].toLowerCase();
                const year = parts[2];
                
                const months = {
                    // Полные названия
                    'января': '01', 'февраля': '02', 'марта': '03', 'апреля': '04',
                    'мая': '05', 'июня': '06', 'июля': '07', 'августа': '08',
                    'сентября': '09', 'октября': '10', 'ноября': '11', 'декабря': '12',
                    // 🔥 СОКРАЩЕНИЯ (3 буквы)
                    'янв': '01', 'фев': '02', 'мар': '03', 'апр': '04',
                    'май': '05', 'июн': '06', 'июл': '07', 'авг': '08',
                    'сен': '09', 'окт': '10', 'ноя': '11', 'дек': '12'
                };
                
                const month = months[monthName];
                debug.dateAttempts.push('📅 Parsed: day=' + day + ', monthName=' + monthName + ', month=' + month + ', year=' + year);
                
                if (month && year.match(/^\\d{4}$/)) {
                    releaseDate = year + '-' + month + '-' + day;
                    debug.dateAttempts.push('✅ Release parsed: ' + releaseDate);
                    break;
                }
            }
        }
    }

    if (!releaseDate) {
        debug.steps.push('❌ Date NOT found');
    } else {
        debug.steps.push('✅ Date found: ' + releaseDate);
    }

    return {
        tags: tags.slice(0, 20),
        coverUrl: coverUrl,
        fullTitle: fullTitle,
        releaseDate: releaseDate,
        description: null,
        debug: debug
    };
})()
`
    );
}