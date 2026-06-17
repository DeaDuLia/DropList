import {parseSite} from "./data-search.js";


export async function fetchLitresBookTags(bookName) {
    return parseSite(
        'Litres',
        `https://www.litres.ru/search/?q=${encodeURIComponent(bookName)}&languages=ru&art_types=text_book&limit=10`,
        `
            (function() {
                const allLinks = document.querySelectorAll('a[href*="/book/"]');
                for (const link of allLinks) {
                    const href = link.href;
                    if (!href.includes('erid=') && !href.includes('banner') && !href.includes('campaign')) {
                        return href.startsWith('http') ? href : 'https://www.litres.ru' + href;
                    }
                }
                return null;
            })()
        `,
        `
            (function() {
                let fullTitle = '';
                const titleElement = document.querySelector('h1[itemprop="name"]');
                if (titleElement) fullTitle = titleElement.textContent.trim();
                
                const tags = [];
                const tagSelectors = [
                    '.BookGenresAndTags_genresList__rd8vU a',
                    '[class*="genresList"] a',
                    'a[href*="/genre/"]',
                    'a[href*="/tags/"]'
                ];
                
                for (const selector of tagSelectors) {
                    const elements = document.querySelectorAll(selector);
                    for (const el of elements) {
                        const text = el.textContent.trim();
                        if (text && text !== 'Только на Литрес' && text.length < 40 && !tags.includes(text)) {
                            tags.push(text);
                        }
                    }
                    if (tags.length) break;
                }
                
                let description = '';
                const descEl = document.querySelector('.BookDescription_text, [class*="description"] p');
                if (descEl) description = descEl.textContent.trim().substring(0, 500);
                
                let coverUrl = '';
                const coverEl = document.querySelector('.AdaptiveCover_image__f_21W, .ArtCover_cover__image__ClWcc, [class*="cover"] img');
                if (coverEl && coverEl.src) coverUrl = coverEl.src;
                
                return { 
                    tags: tags.slice(0, 10), 
                    description: description, 
                    coverUrl: coverUrl,
                    fullTitle: fullTitle,
                    releaseDate: null
                };
            })()
        `,
        true
    );
}
export async function fetchLitresBookAPIData(bookName) {
    try {
        const url = `https://api.litres.ru/foundation/api/search?q=${encodeURIComponent(bookName)}&types=text_book&limit=1`;
        const response = await fetch(url);
        const data = await response.json();

        if (!data.payload?.data || data.payload.data.length === 0) {
            console.log(`[Litres API] Book not found: ${bookName}`);
            return null;
        }

        // Берём первую книгу (не аудиокнигу)
        const book = data.payload.data.find(item => item.type === 'text_book');
        if (!book) return null;

        const instance = book.instance;

        return {
            fullTitle: instance.title,
            coverUrl: instance.cover_url ? `https://www.litres.ru${instance.cover_url}` : null,
            price: instance.prices?.final_price || null,
            oldPrice: instance.prices?.full_price || null,
            discount: instance.prices?.discount_percent || null,
            rating: instance.rating?.rated_avg || null,
            author: instance.persons?.find(p => p.role === 'author')?.full_name || null,
            releaseDate: instance.date_written_at || null
        };

    } catch (error) {
        console.error('[Litres API] Error:', error);
        return null;
    }
}
export async function fetchChitaiGorodBook(bookName) {
    return parseSite(
        'ChitaiGorod',
        `https://www.chitai-gorod.ru/search?phrase=${encodeURIComponent(bookName)}`,
        // targetUrlParser - ищем ссылку на книгу
        `
            (function() {
                const productWrapper = document.querySelector('.product-card__image-wrapper');
                if (!productWrapper) {
                    return null;
                }
                
                const link = productWrapper.querySelector('a');
                return link ? link.href : null;
            })()
        `,
        // dataParser - парсим данные со страницы книги
        `
            (function() {
                // Название (очищаем от возрастного рейтинга)
                let fullTitle = '';
                const titleEl = document.querySelector('h1.product-detail-page__title');
                if (titleEl) {
                    fullTitle = titleEl.childNodes[0]?.textContent?.trim() || titleEl.textContent.trim();
                    fullTitle = fullTitle.replace(/\\d+\\+/, '').trim();
                }
                
                // Обложка
                let coverUrl = '';
                const previewDiv = document.querySelector('.product-preview');
                if (previewDiv) {
                    const img = previewDiv.querySelector('img');
                    if (img && img.srcset) {
                        const urls = img.srcset.split(',');
                        if (urls.length > 0) {
                            coverUrl = urls[0].trim().split(' ')[0];
                        }
                    } else if (img && img.src) {
                        coverUrl = img.src;
                    }
                }
                
                // ========== ЦЕНА ==========
                let price = null;
                let oldPrice = null;
                let discount = null;
                
                // Ищем блок с ценой
                const priceBlock = document.querySelector('.new-product-offer-online__price');
                if (priceBlock) {
                    // Актуальная цена
                    const actualPriceEl = priceBlock.querySelector('.new-product-offer-price__actual');
                    if (actualPriceEl) {
                        const match = actualPriceEl.textContent.match(/(\\d+)/);
                        if (match) price = match[1];
                    }
                    
                    // Старая цена
                    const oldPriceEl = priceBlock.querySelector('.new-product-offer-price__old-text');
                    if (oldPriceEl) {
                        const match = oldPriceEl.textContent.match(/(\\d+)/);
                        if (match) oldPrice = match[1];
                    }
                    
                    // Скидка в процентах
                    const discountEl = priceBlock.querySelector('.new-product-offer-price__sale-size');
                    if (discountEl) {
                        const match = discountEl.textContent.match(/(\\d+)/);
                        if (match) discount = match[1];
                    }
                }
                
                // Если не нашли через новые классы, пробуем старые
                if (!price) {
                    const priceContainer = document.querySelector('[class*="price"]');
                    if (priceContainer) {
                        const match = priceContainer.textContent.match(/(\\d+)\\s*₽/);
                        if (match) price = match[1];
                    }
                }
                
                // Теги
                const tags = [];
                const tagsContainer = document.querySelector('ul.product-tag-list');
                if (tagsContainer) {
                    const tagElements = tagsContainer.querySelectorAll('li a.product-tag');
                    tagElements.forEach(el => {
                        const text = el.textContent.trim();
                        if (text && !tags.includes(text)) {
                            tags.push(text);
                        }
                    });
                }
                
                return { 
                    tags: tags.slice(0, 10),
                    description: '',
                    coverUrl: coverUrl,
                    fullTitle: fullTitle,
                    releaseDate: null,
                    price: price,
                    oldPrice: oldPrice,
                    discount: discount
                };
            })()
        `,
        false,
        true
    );
}