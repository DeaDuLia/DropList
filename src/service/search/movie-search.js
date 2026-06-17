import {parseSite} from "./data-search.js";


export async function fetchKinopoiskMovieTags(movieName) {
    return parseSite(
        'Kinopoisk',
        `https://www.kinopoisk.ru/index.php?kp_query=${encodeURIComponent(movieName)}`,
        `
            (function() {
                const mostWanted = document.querySelector('.search_results .element.most_wanted');
                if (mostWanted) {
                    const nameLink = mostWanted.querySelector('.name a');
                    if (nameLink && nameLink.href) {
                        let cleanUrl = nameLink.href.replace(/\\/sr\\/\\d+/, '');
                        return cleanUrl;
                    }
                }
                const anyFilmLink = document.querySelector('a[href*="/film/"]');
                if (anyFilmLink) {
                    let cleanUrl = anyFilmLink.href.replace(/\\/sr\\/\\d+/, '');
                    return cleanUrl;
                }
                return null;
            })()
        `,
        `
            (function() {
                // Полное название фильма
                let fullTitle = '';
                const titleElement = document.querySelector('h1[itemprop="name"] span');
                if (titleElement) {
                    fullTitle = titleElement.textContent.trim();
                }
                if (!fullTitle) {
                    const titleH1 = document.querySelector('h1[itemprop="name"]');
                    if (titleH1) {
                        fullTitle = titleH1.textContent.trim();
                    }
                }
                
                // Теги (жанры)
                const tags = [];
                const genresBlock = document.querySelector('[data-test-id="genres"]');
                if (genresBlock) {
                    genresBlock.querySelectorAll('a').forEach(el => {
                        const text = el.textContent.trim();
                        if (text && text.length < 30 && !tags.includes(text)) {
                            tags.push(text);
                        }
                    });
                }
                
                if (tags.length === 0) {
                    const fallbackSelectors = [
                        '.styles_rowDark__Q3Dh2 a[href*="/genre/"]',
                        '[class*="genre"] a'
                    ];
                    for (const selector of fallbackSelectors) {
                        const elements = document.querySelectorAll(selector);
                        elements.forEach(el => {
                            const text = el.textContent.trim();
                            if (text && text.length < 30 && !tags.includes(text)) {
                                tags.push(text);
                            }
                        });
                        if (tags.length) break;
                    }
                }
                
                // Описание
                let description = '';
                const descElement = document.querySelector('[data-test-id="synopsis"]');
                if (descElement) {
                    description = descElement.textContent.trim().substring(0, 500);
                }
                
                // Обложка
                let coverUrl = '';
                const posterElement = document.querySelector('.film-poster');
                if (posterElement && posterElement.src) {
                    coverUrl = posterElement.src;
                    if (coverUrl.startsWith('//')) coverUrl = 'https:' + coverUrl;
                }
                if (!coverUrl) {
                    const imgElement = document.querySelector('[class*="poster"] img');
                    if (imgElement && imgElement.src) {
                        coverUrl = imgElement.src;
                        if (coverUrl.startsWith('//')) coverUrl = 'https:' + coverUrl;
                    }
                }
                
                // ДАТА ПРЕМЬЕРЫ
                let releaseDate = null;
                const premiereBlock = document.querySelector('[data-test-id="worldPremieres"]');
                if (premiereBlock) {
                    const dateLink = premiereBlock.querySelector('a[href*="/dates/"]');
                    if (dateLink) {
                        const dateText = dateLink.textContent.trim();
                        
                        const months = {
                            'января': '01', 'февраля': '02', 'марта': '03', 'апреля': '04',
                            'мая': '05', 'июня': '06', 'июля': '07', 'августа': '08',
                            'сентября': '09', 'октября': '10', 'ноября': '11', 'декабря': '12'
                        };
                        
                        const parts = dateText.split(/\\s+/);
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
                    description: description,
                    coverUrl: coverUrl,
                    fullTitle: fullTitle,
                    releaseDate: releaseDate
                };
            })()
        `
    );
}

export async function fetchFilmRuSerialsTags(serialName) {
    return parseSite(
        'FilmRu',
        `https://www.film.ru/search/result?text=${encodeURIComponent(serialName)}&type=all`,
        `
            (function() {
                const allLinks = document.querySelectorAll('a[href*="/movies/"], a[href*="/serials/"], a[href*="/cartoons/"]');
                for (const link of allLinks) {
                    if (link.href && link.querySelector('img')) {
                        return link.href;
                    }
                }
                const anyImageLink = document.querySelector('a img')?.closest('a');
                return anyImageLink ? anyImageLink.href : null;
            })()
        `,
        `
            (function() {
                function parseRussianDate(dateText) {
                    const months = {
                        'января': '01', 'февраля': '02', 'марта': '03', 'апреля': '04',
                        'мая': '05', 'июня': '06', 'июля': '07', 'августа': '08',
                        'сентября': '09', 'октября': '10', 'ноября': '11', 'декабря': '12'
                    };
                    const parts = dateText.split(/\\s+/);
                    let day = null, monthNum = null, year = null;
                    for (const part of parts) {
                        if (/^\\d{1,2}$/.test(part) && !day) day = part.padStart(2, '0');
                        else if (/^\\d{4}$/.test(part) && !year) year = part;
                        else if (months[part] && !monthNum) monthNum = months[part];
                    }
                    if (day && monthNum && year) return year + '-' + monthNum + '-' + day;
                    return null;
                }
                
                let fullTitle = '';
                const titleElement = document.querySelector('h1');
                if (titleElement) {
                    fullTitle = titleElement.textContent.trim();
                    fullTitle = fullTitle.replace(/\\(сериал.*?\\)/, '').trim();
                }
                
                let coverUrl = '';
                const posterBlock = document.querySelector('a.wrapper_movies_poster');
                if (posterBlock) {
                    coverUrl = posterBlock.getAttribute('data-src');
                    if (coverUrl && !coverUrl.startsWith('http')) {
                        coverUrl = 'https://www.film.ru' + coverUrl;
                    }
                    coverUrl = coverUrl.replace('/styles/thumb_260x400/', '/');
                }
                
                const tags = [];
                const blockInfo = document.querySelector('.block_info');
                if (blockInfo) {
                    blockInfo.querySelectorAll('a').forEach(link => {
                        const text = link.textContent.trim();
                        if (text && text !== '18+' && text.length < 30 && !tags.includes(text)) {
                            tags.push(text);
                        }
                    });
                }
                
                let releaseDate = null;
                const episodesBlock = document.querySelector('.wrapper_movies_soon_episodes.active');
                if (episodesBlock) {
                    const allDivs = episodesBlock.querySelectorAll('div');
                    let targetElement = allDivs.length > 0 ? allDivs[allDivs.length - 1] : episodesBlock.querySelector('a');
                    if (targetElement) {
                        const dateSpan = targetElement.querySelector('span:last-child');
                        if (dateSpan) {
                            const parsedDate = parseRussianDate(dateSpan.textContent.trim());
                            if (parsedDate) releaseDate = parsedDate;
                        }
                    }
                }
                
                if (!releaseDate) {
                    const premiereBlock = document.querySelector('.block_table');
                    if (premiereBlock) {
                        const rows = premiereBlock.querySelectorAll('div');
                        for (let i = 0; i < rows.length; i++) {
                            if (rows[i].textContent.trim() === 'премьера' && rows[i + 1]) {
                                const dateText = rows[i + 1].textContent.trim();
                                const match = dateText.match(/(\\d{2})\\.(\\d{2})\\.(\\d{4})/);
                                if (match) {
                                    releaseDate = match[3] + '-' + match[2] + '-' + match[1];
                                    break;
                                }
                            }
                        }
                    }
                }
                
                if (!releaseDate) {
                    const titleH1 = document.querySelector('h1');
                    if (titleH1) {
                        const yearMatch = titleH1.textContent.match(/(\\d{4})/);
                        if (yearMatch) releaseDate = yearMatch[1] + '-01-01';
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