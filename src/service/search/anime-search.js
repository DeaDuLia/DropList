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