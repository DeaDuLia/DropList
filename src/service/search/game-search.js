import {BrowserWindow} from "electron";
import {DEFAULT_USER_AGENT, destroyWindowCompletely, parseSite} from "./data-search.js";

export async function fetchSteamGameTags(gameName) {
    return new Promise(async (resolve) => {
        let hiddenWindow = null;
        let isResolved = false;
        let loadTimeout = null;
        let isLoaded = false;
        let currentUrl;

        const finish = (result) => {
            if (isResolved) return;
            isResolved = true;
            if (loadTimeout) clearTimeout(loadTimeout);
            if (hiddenWindow && !hiddenWindow.isDestroyed()) {
                destroyWindowCompletely(hiddenWindow);
            }
            resolve(result);
        };

        try {
            // 1. Поиск игры через storesearch API
            const searchUrl = `https://store.steampowered.com/api/storesearch/?term=${encodeURIComponent(gameName)}&cc=ru&l=russian`;
            const searchResponse = await fetch(searchUrl);
            const searchData = await searchResponse.json();

            if (!searchData.items || searchData.items.length === 0) {
                console.log(`[Steam] Game not found: ${gameName}`);
                finish({ tags: [], coverUrl: '', fullTitle: '', releaseDate: null, description: '', price: null });
                return;
            }

            const game = searchData.items[0];
            const appId = game.id;
            const fullTitle = game.name;

            // 2. Открываем страницу игры
            const gameUrl = `https://store.steampowered.com/app/${appId}/?l=russian`;

            hiddenWindow = new BrowserWindow({
                show: false,
                width: 1280,
                height: 800,
                webPreferences: {
                    nodeIntegration: false,
                    contextIsolation: true,
                    images: true
                }
            });

            hiddenWindow.webContents.session.webRequest.onBeforeSendHeaders((details, callback) => {
                details.requestHeaders['User-Agent'] = DEFAULT_USER_AGENT;
                details.requestHeaders['Accept-Language'] = 'ru-RU,ru;q=0.9';
                callback({ cancel: false, requestHeaders: details.requestHeaders });
            });

            hiddenWindow.loadURL(gameUrl);

            const waitForLoad = new Promise((resolve) => {
                hiddenWindow.webContents.once('did-finish-load', () => {
                    isLoaded = true;
                    resolve();
                });

                loadTimeout = setTimeout(() => {
                    if (!isLoaded) {
                        if (hiddenWindow && !hiddenWindow.isDestroyed()) {
                            hiddenWindow.webContents.stop();
                            isLoaded = true;
                        }
                        resolve();
                    }
                }, 5000);
            });

            await waitForLoad;
            if (loadTimeout) clearTimeout(loadTimeout);
            if (!hiddenWindow || hiddenWindow.isDestroyed()) {
                return { tags: [], description: '', coverUrl: '', fullTitle: '', releaseDate: null };
            }
            currentUrl = hiddenWindow.webContents.getURL();
            if (!currentUrl || currentUrl === 'about:blank' || currentUrl.includes('error')) {
                finish({ tags: [], coverUrl: '', fullTitle: '', releaseDate: null, description: '', price: null });
                return;
            }
            if (!hiddenWindow || hiddenWindow.isDestroyed()) {
                return { tags: [], description: '', coverUrl: '', fullTitle: '', releaseDate: null };
            }
            // Парсим данные со страницы (включая цену)
            const gameData = await hiddenWindow.webContents.executeJavaScript(`
                (function() {
                    // Обложка
                    let coverUrl = '';
                    const headerImg = document.querySelector('.game_header_image_full');
                    if (headerImg && headerImg.src) coverUrl = headerImg.src;
                    
                    // Дата релиза
                    let releaseDate = null;
                    const releaseDateEl = document.querySelector('.release_date .date');
                    if (releaseDateEl) {
                        const dateText = releaseDateEl.textContent.trim();
                        const months = {
                            'янв': '01', 'фев': '02', 'мар': '03', 'апр': '04',
                            'мая': '05', 'май': '05', 'июн': '06', 'июл': '07',
                            'авг': '08', 'сен': '09', 'окт': '10', 'ноя': '11', 'дек': '12'
                        };
                        const match = dateText.match(/(\\d{1,2})\\s+(\\w+)\\.?\\s+(\\d{4})/);
                        if (match) {
                            const day = match[1].padStart(2, '0');
                            const monthName = match[2].toLowerCase().substring(0, 3);
                            const year = match[3];
                            const month = months[monthName];
                            if (month) releaseDate = year + '-' + month + '-' + day;
                        }
                    }
                    
                    // ========== ЦЕНА ==========
                    let price = null;
                    let discount = null;
                    let oldPrice = null;
                    
                    // Пробуем цену со скидкой
                    const discountPriceEl = document.querySelector('.discount_final_price');
                    if (discountPriceEl) {
                        const priceMatch = discountPriceEl.textContent.match(/(\\d+)[\\d\\s]*[\\,\\.]?\\d*/);
                        if (priceMatch) {
                            price = priceMatch[1].replace(/\\s/g, '').replace(',', '.');
                            price = Math.floor(parseFloat(price));
                        }
                    }
                    
                    // Если нет скидки — обычная цена
                    if (!price) {
                        const regularPriceEl = document.querySelector('.game_purchase_price');
                        if (regularPriceEl) {
                            const priceMatch = regularPriceEl.textContent.match(/(\\d+)/);
                            if (priceMatch) price = priceMatch[1];
                        }
                    }
                    
                    // Если цена в data-атрибуте
                    if (!price) {
                        const priceData = document.querySelector('[data-price-final]');
                        if (priceData) {
                            price = priceData.getAttribute('data-price-final');
                            if (price) price = Math.floor(parseInt(price) / 100);
                        }
                    }
                    
                    // Скидка
                    const discountEl = document.querySelector('.discount_pct');
                    if (discountEl) {
                        const discountMatch = discountEl.textContent.match(/(\\d+)/);
                        if (discountMatch) discount = discountMatch[1];
                    }
                    
                    // Старая цена
                    const oldPriceEl = document.querySelector('.discount_original_price');
                    if (oldPriceEl) {
                        const oldMatch = oldPriceEl.textContent.match(/(\\d+)/);
                        if (oldMatch) oldPrice = oldMatch[1];
                    }
                    
                    // Теги
                    const tags = [];
                    const tagsContainer = document.querySelector('.glance_tags.popular_tags, .popular_tags_ctn');
                    if (tagsContainer) {
                        tagsContainer.querySelectorAll('a.app_tag').forEach(el => {
                            const tagText = el.textContent.trim();
                            if (tagText && tagText !== '+' && el.style.display !== 'none') {
                                tags.push(tagText);
                            }
                        });
                    }
                    
                    // Описание
                    let description = '';
                    const descElement = document.querySelector('.game_description_snippet');
                    if (descElement) description = descElement.textContent.trim();
                    
                    return {
                        coverUrl: coverUrl,
                        releaseDate: releaseDate,
                        tags: tags.slice(0, 12),
                        description: description,
                        price: price,
                        discount: discount,
                        oldPrice: oldPrice
                    };
                })();
            `);


            finish({
                tags: gameData.tags,
                coverUrl: gameData.coverUrl,
                fullTitle: fullTitle,
                releaseDate: gameData.releaseDate,
                description: gameData.description,
                price: gameData.price,
                discount: gameData.discount,
                oldPrice: gameData.oldPrice
            });

        } catch (error) {
            console.error('[Steam] Error:', error);
            finish({ tags: [], coverUrl: '', fullTitle: '', releaseDate: null, description: '', price: null });
        }
    });
}
export async function fetchKupikodPrice(gameName) {
    return parseSite(
        'Kupikod',
        `https://steam.kupikod.com/ru-ru/games`,
        // targetUrlParser - имитируем ввод и возвращаем ссылку
        `
    (function() {
    return new Promise((resolve) => {
        const input = document.querySelector('input[placeholder="Поиск"], input[data-testid="input"]');
        if (!input) {
            resolve(null);
            return;
        }
        
        input.focus();
        
        const nativeInputValueSetter = Object.getOwnPropertyDescriptor(
            window.HTMLInputElement.prototype, 
            'value'
        ).set;
        
        nativeInputValueSetter.call(input, "${gameName.replace(/"/g, '\\"')}");
        input.dispatchEvent(new Event('input', { bubbles: true }));
        
        // Ждём появления результатов с проверкой каждые 100ms
        let attempts = 0;
        const maxAttempts = 30; // максимум 3 секунды (30 * 100ms)
        
        const checkResults = setInterval(() => {
            attempts++;
            const results = document.querySelectorAll('.main-search__results a.main-search__result-item');
            
            if (results.length > 0) {
                clearInterval(checkResults);
                const href = results[0].getAttribute('href');
                resolve(href);
            } else if (attempts >= maxAttempts) {
                clearInterval(checkResults);
                resolve(null);
            }
        }, 100);
    });
})()
`,
        `
    (function() {
        // Название
        let fullTitle = '';
        const titleEl = document.querySelector('h1.product__title span');
        if (titleEl) {
            fullTitle = titleEl.textContent.trim();
        }
        
        // Обложка
        let coverUrl = '';
        const coverEl = document.querySelector('img.product__image');
        if (coverEl && coverEl.src) {
            coverUrl = coverEl.src;
        }
        
        // Теги
        const tags = [];
        const tagsContainer = document.querySelector('.product__tags');
        if (tagsContainer) {
            const tagElements = tagsContainer.querySelectorAll('.product__tag');
            tagElements.forEach(el => {
                const text = el.textContent.trim();
                if (text && !tags.includes(text)) {
                    tags.push(text);
                }
            });
        }
        
        // Дата релиза
        let releaseDate = null;
        const releaseItem = document.querySelector('[data-test="game-info-release-date"]');
        if (releaseItem) {
            const valueEl = releaseItem.querySelector('.game-info__value');
            if (valueEl) {
                const dateText = valueEl.textContent.trim();
                // Парсим дату в формате "17 мая 2021 г."
                const months = {
                    'января': '01', 'февраля': '02', 'марта': '03', 'апреля': '04',
                    'мая': '05', 'июня': '06', 'июля': '07', 'августа': '08',
                    'сентября': '09', 'октября': '10', 'ноября': '11', 'декабря': '12'
                };
                
                // Убираем "г." в конце
                const cleanDate = dateText.replace(/\\s*г\\.?\\s*$/, '');
                const parts = cleanDate.split(/\\s+/);
                
                let day = null, monthNum = null, year = null;
                for (const part of parts) {
                    if (/^\\d{1,2}$/.test(part) && !day) {
                        day = part.padStart(2, '0');
                    } else if (/^\\d{4}$/.test(part) && !year) {
                        year = part;
                    } else if (months[part] && !monthNum) {
                        monthNum = months[part];
                    }
                }
                
                if (day && monthNum && year) {
                    releaseDate = year + '-' + monthNum + '-' + day;
                }
            }
        }
        
        return { 
            tags: tags.slice(0, 10),
            description: '',
            coverUrl: coverUrl,
            fullTitle: fullTitle,
            releaseDate: releaseDate
        };
    })()
`
    );
}
export async function fetchKupikodPriceAPI(gameName) {
    try {
        const url = `https://search-v2.kupikod.com/search?q=${encodeURIComponent(gameName)}&limit=1`;

        const response = await fetch(url, {
            headers: {
                'User-Agent': DEFAULT_USER_AGENT,
                'Accept': 'application/json'
            }
        });

        const data = await response.json();

        if (data.items && data.items.length > 0) {
            // Берём первый результат (самый релевантный)
            const game = data.items[0];

            return {
                price: game.min_price,
                oldPrice: game.min_old_price,
                coverUrl: game.header_image,
                fullTitle: game.name,
                releaseDate: game.release_date,
                link: game.link,
                isDlc: game.is_dlc
            };
        }

        return null;

    } catch (error) {
        console.error('[Kupikod API] Error:', error);
        return null;
    }
}
export async function fetchSteamAPIData(gameName) {
    try {
        const searchUrl = `https://store.steampowered.com/api/storesearch/?term=${encodeURIComponent(gameName)}&cc=ru&l=russian`;
        const searchResponse = await fetch(searchUrl);
        const searchData = await searchResponse.json();

        if (!searchData.items || searchData.items.length === 0) {
            return null;
        }
        const game = searchData.items[0];
        const appId = game.id;

        // Получаем детали
        const detailsUrl = `https://store.steampowered.com/api/appdetails?appids=${appId}&cc=ru&l=russian`;
        const detailsResponse = await fetch(detailsUrl);
        const detailsData = await detailsResponse.json();

        if (!detailsData[appId] || !detailsData[appId].success) {
            return null;
        }

        const data = detailsData[appId].data;

        // Парсим цену
        let price = null;
        let discount = null;
        let oldPrice = null;

        if (data.price_overview) {
            price = data.price_overview.final_formatted;
            discount = data.price_overview.discount_percent;
            if (data.price_overview.initial_formatted && data.price_overview.initial_formatted !== price) {
                oldPrice = data.price_overview.initial_formatted;
            }
        }

        return {
            fullTitle: data.name,
            tags: data.genres?.map(g => g.description) || [],
            description: data.short_description || '',
            coverUrl: data.header_image || '',
            releaseDate: data.release_date?.date || null,
            price: price ? price.replace('руб.', '').trim() : null,
            discount: discount,
            oldPrice: oldPrice ? oldPrice.replace('руб.', '').trim() : null
        };

    } catch (error) {
        console.error('[Steam API] Error:', error);
        return null;
    }
}