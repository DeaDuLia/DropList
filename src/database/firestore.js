import {initializeApp} from "firebase/app";
import {getAuth} from "firebase/auth";
import {
    clearExpectedReleasesDirty, clearFavoritesDirty,
    clearSectionDirty, clearTagsDirty,
    clearUserSession,
    db,
    getAllLocalData,
    getStoredUser, isFavoritesDirty,
    isSectionDirty, isTagsDirty,
    statements
} from "./local-database.js";

const firebaseConfig = {
    apiKey: "AIzaSyALdaI9VkFIkN_gTTJKohahnAcdZqCxgRQ",
    authDomain: "droplist-3fa8b.firebaseapp.com",
    projectId: "droplist-3fa8b",
    storageBucket: "droplist-3fa8b.firebasestorage.app",
    messagingSenderId: "920691108684",
    appId: "1:920691108684:web:c06a303e820e311c8a3de9"
};

const firebaseApp = initializeApp(firebaseConfig);
export const auth = getAuth(firebaseApp);


export async function getSectionFromFirestore(uid, idToken, section) {
    const url = `https://firestore.googleapis.com/v1/projects/${firebaseConfig.projectId}/databases/(default)/documents/users/${uid}/sections/${section}`;

    try {
        const response = await fetch(url, {
            method: 'GET',
            headers: { 'Authorization': `Bearer ${idToken}` }
        });

        if (response.status === 404) return [];
        if (!response.ok) {
            console.log(`HTTP ${response.status}`);
            return null;
        }

        const data = await response.json();
        const items = [];

        if (data.fields && data.fields.items && data.fields.items.arrayValue) {
            const values = data.fields.items.arrayValue.values || [];
            for (const item of values) {
                const fields = item.mapValue.fields;

                // ✅ УНИВЕРСАЛЬНО: собираем все поля, которые есть
                const entry = {};
                for (const [key, value] of Object.entries(fields)) {
                    // Определяем тип поля
                    if (value.stringValue !== undefined) {
                        entry[key] = value.stringValue;
                    } else if (value.integerValue !== undefined) {
                        entry[key] = value.integerValue;
                    } else if (value.arrayValue !== undefined) {
                        entry[key] = (value.arrayValue.values || []).map(v => v.stringValue);
                    }
                }
                items.push(entry);
            }
        }

        return items;
    } catch (error) {
        console.error(`Error getting ${section}:`, error);
        return null;
    }
}


export async function saveAllTagsToFirestore(uid, idToken) {
    const allTags = statements.getAllTags.all(); // [{name, count}]

    const url = `https://firestore.googleapis.com/v1/projects/${firebaseConfig.projectId}/databases/(default)/documents/users/${uid}/sections/tags`;

    const body = {
        fields: {
            items: {
                arrayValue: {
                    values: allTags.map(tag => ({
                        mapValue: {
                            fields: {
                                name: { stringValue: tag.name },
                                count: { integerValue: tag.count }
                            }
                        }
                    }))
                }
            },
            updatedAt: { timestampValue: new Date().toISOString() }
        }
    };

    const response = await fetch(url, {
        method: 'PATCH',
        headers: {
            'Authorization': `Bearer ${idToken}`,
            'Content-Type': 'application/json'
        },
        body: JSON.stringify(body)
    });

    if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`HTTP ${response.status}: ${errorText}`);
    }

    console.log(`✅ Tags saved (${allTags.length} tags)`);
    return true;
}

export async function getSyncTime(uid, idToken) {
    const url = `https://firestore.googleapis.com/v1/projects/${firebaseConfig.projectId}/databases/(default)/documents/users/${uid}`;

    try {
        const response = await fetch(url, {
            method: 'GET',
            headers: { 'Authorization': `Bearer ${idToken}` }
        });

        if (response.status === 404) return null;
        if (!response.ok) {
            console.log(`HTTP ${response.status}`)
            return null;
        }

        const data = await response.json();
        return data.fields?.lastSync?.timestampValue || null;
    } catch (error) {
        console.error('Get sync time error:', error);
        return null;
    }
}

export async function updateSyncTime(uid, idToken, timestamp) {
    const url = `https://firestore.googleapis.com/v1/projects/${firebaseConfig.projectId}/databases/(default)/documents/users/${uid}?updateMask.fieldPaths=lastSync`;

    const body = {
        fields: {
            lastSync: { timestampValue: timestamp }
        }
    };

    const response = await fetch(url, {
        method: 'PATCH',
        headers: {
            'Authorization': `Bearer ${idToken}`,
            'Content-Type': 'application/json'
        },
        body: JSON.stringify(body)
    });

    if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`HTTP ${response.status}: ${errorText}`);
    }

    console.log('[+] Sync time updated:', timestamp);
    return true;
}

export async function saveSectionToFirestore(uid, idToken, section, items) {
    const url = `https://firestore.googleapis.com/v1/projects/${firebaseConfig.projectId}/databases/(default)/documents/users/${uid}/sections/${section}`;

    // ✅ Определяем, какие поля использовать в зависимости от секции
    const isCardsSection = ['games', 'movies', 'books', 'serials', 'anime', 'cartoons'].includes(section);
    const isFavorites = section === 'favorites';
    const isTags = section === 'tags';
    const isExpectedReleases = section === 'expected_releases';

    const body = {
        fields: {
            items: {
                arrayValue: {
                    values: items.map(item => {
                        let fields = {};

                        if (isCardsSection) {
                            // ✅ КАРТОЧКИ
                            let tagsArray = [];
                            if (item.tags) {
                                if (typeof item.tags === 'string') {
                                    tagsArray = item.tags.split(',').filter(t => t);
                                } else if (Array.isArray(item.tags)) {
                                    tagsArray = item.tags;
                                }
                            }

                            fields = {
                                name: { stringValue: item.name || '' },
                                icoUrl: { stringValue: item.icoUrl || '' },
                                rating: { stringValue: item.rating || '0' },
                                status: { stringValue: item.status || 'Уточнить' },
                                description: { stringValue: item.description || '' },
                                tags: {
                                    arrayValue: {
                                        values: tagsArray.map(tag => ({ stringValue: tag }))
                                    }
                                }
                            };
                        } else if (isFavorites) {
                            // ✅ ИЗБРАННОЕ
                            fields = {
                                card_name: { stringValue: item.card_name || '' },
                                section: { stringValue: item.section || '' }
                            };
                        } else if (isTags) {
                            // ✅ ТЕГИ
                            fields = {
                                name: { stringValue: item.name || '' },
                                count: { integerValue: item.count || 1 }
                            };
                        } else if (isExpectedReleases) {
                            // ✅ ДАТЫ РЕЛИЗА
                            fields = {
                                card_name: { stringValue: item.card_name || '' },
                                section: { stringValue: item.section || '' },
                                release_date: { stringValue: item.release_date || '' },
                                last_notification_date: { stringValue: item.last_notification_date || '' }
                            };
                        }

                        return {
                            mapValue: { fields }
                        };
                    })
                }
            },
            updatedAt: { timestampValue: new Date().toISOString() }
        }
    };

    const response = await fetch(url, {
        method: 'PATCH',
        headers: {
            'Authorization': `Bearer ${idToken}`,
            'Content-Type': 'application/json'
        },
        body: JSON.stringify(body)
    });

    if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`HTTP ${response.status}: ${errorText}`);
    }

    console.log(`✅ Section ${section} saved (${items.length} items)`);
    return true;
}

export async function syncDirtySections(uid, idToken) {
    const freshToken = await getValidToken();
    if (!freshToken) {
        console.log('[!] No valid token, skipping sync');
        return false;
    }

    const sections = ['games', 'movies', 'cartoons', 'serials', 'anime', 'books'];
    const dirtySections = sections.filter(section => isSectionDirty(section));

    let hasDirtyData = false;

    // 1. СИНХРОНИЗИРУЕМ ГРЯЗНЫЕ РАЗДЕЛЫ
    if (dirtySections.length > 0) {
        console.log(`[i] Syncing dirty sections: ${dirtySections.join(', ')}`);
        hasDirtyData = true;

        for (const section of dirtySections) {
            const sectionData = statements.getDataBySection.all(section);
            await saveSectionToFirestore(uid, freshToken, section, sectionData);
            clearSectionDirty(section);
        }
    }

    // 2. СИНХРОНИЗИРУЕМ ТЕГИ
    if (isTagsDirty()) {
        console.log('[i] Syncing tags...');
        hasDirtyData = true;
        await saveAllTagsToFirestore(uid, freshToken);
        clearTagsDirty();
    }

    // 3. СИНХРОНИЗИРУЕМ ОЖИДАЕМЫЕ РЕЛИЗЫ
    const dirtyExpectedReleases = statements.isExpectedReleasesDirty.get('dirty_expected_releases');
    if (dirtyExpectedReleases && dirtyExpectedReleases.value === 'true') {
        console.log('[i] Syncing expected releases...');
        hasDirtyData = true;
        await saveExpectedReleasesToFirestore(uid, idToken);
        clearExpectedReleasesDirty();
    }

    // 4. СИНХРОНИЗИРУЕМ ИЗБРАННОЕ
    if (isFavoritesDirty()) {
        console.log('[i] Syncing favorites...');
        hasDirtyData = true;
        await saveFavoritesToFirestore(uid, freshToken);
        clearFavoritesDirty();
    }

    // Если ничего не было грязного — просто выходим
    if (!hasDirtyData) {
        console.log('[i] No dirty data to sync');
        return false;
    }

    // Обновляем время синхронизации
    const now = new Date().toISOString();
    await updateSyncTime(uid, freshToken, now);
    statements.setStatistic.run('last_firestore_update', now, now);

    return true;
}

async function refreshAccessToken(refreshToken) {
    const url = `https://securetoken.googleapis.com/v1/token?key=${firebaseConfig.apiKey}`;

    const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            grant_type: 'refresh_token',
            refresh_token: refreshToken
        })
    });

    if (!response.ok) {
        const error = await response.text();
        throw new Error(`Token refresh failed: ${error}`);
    }

    const data = await response.json();
    return {
        idToken: data.id_token,
        refreshToken: data.refresh_token, // может прийти новый refresh token
        expiresIn: data.expires_in
    };
}

export async function getValidToken() {
    const storedUser = getStoredUser();
    if (!storedUser || !storedUser.is_authenticated) {
        return null;
    }

    // Пробуем сначала через Firebase SDK (если он активен)
    try {
        const currentUser = auth.currentUser;
        if (currentUser) {
            const freshToken = await currentUser.getIdToken(true);
            // Обновляем в БД
            const stmt = db.prepare(`UPDATE user_session SET id_token = ? WHERE id = 1`);
            stmt.run(freshToken);
            console.log('[i] Token refreshed via Firebase SDK');
            return freshToken;
        }
    } catch (error) {
        console.log('[i] Firebase SDK not available, using REST API');
    }

    // Если SDK не помог — используем REST API с refresh token
    if (storedUser.refresh_token) {
        try {
            const { idToken, refreshToken } = await refreshAccessToken(storedUser.refresh_token);

            // Обновляем оба токена в БД
            const stmt = db.prepare(`UPDATE user_session SET id_token = ?, refresh_token = ? WHERE id = 1`);
            stmt.run(idToken, refreshToken || storedUser.refresh_token);

            console.log('[i] Token refreshed via REST API');
            return idToken;
        } catch (error) {
            console.error('[x] Failed to refresh token:', error);
            // Токен не обновился — нужно перелогиниваться
            clearUserSession();
            return null;
        }
    }

    console.log('[!] No refresh token available');
    return null;
}


export async function loadAllTagsFromFirestore(uid, idToken) {
    const url = `https://firestore.googleapis.com/v1/projects/${firebaseConfig.projectId}/databases/(default)/documents/users/${uid}/sections/tags`;

    try {
        const response = await fetch(url, {
            method: 'GET',
            headers: { 'Authorization': `Bearer ${idToken}` }
        });

        if (response.status === 404) return [];
        if (!response.ok) {
            console.log(`HTTP ${response.status}`)
            return null;
        }

        const data = await response.json();
        const items = [];

        if (data.fields && data.fields.items && data.fields.items.arrayValue) {
            const values = data.fields.items.arrayValue.values || [];
            for (const item of values) {
                const fields = item.mapValue.fields;
                items.push({
                    name: fields.name?.stringValue || '',
                    count: fields.count?.integerValue || 0
                });
            }
        }

        return items;
    } catch (error) {
        console.error('Error loading tags:', error);
        return null;
    }
}

export async function saveExpectedReleasesToFirestore(uid, idToken) {
    const releases = statements.getAllExpectedReleases.all();

    const url = `https://firestore.googleapis.com/v1/projects/${firebaseConfig.projectId}/databases/(default)/documents/users/${uid}/sections/expected_releases`;

    const body = {
        fields: {
            items: {
                arrayValue: {
                    values: releases.map(release => ({
                        mapValue: {
                            fields: {
                                card_name: { stringValue: release.card_name },
                                section: { stringValue: release.section },
                                release_date: { stringValue: release.release_date },
                                last_notification_date: { stringValue: release.last_notification_date || '' }
                            }
                        }
                    }))
                }
            },
            updatedAt: { timestampValue: new Date().toISOString() }
        }
    };

    const response = await fetch(url, {
        method: 'PATCH',
        headers: {
            'Authorization': `Bearer ${idToken}`,
            'Content-Type': 'application/json'
        },
        body: JSON.stringify(body)
    });

    if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`HTTP ${response.status}: ${errorText}`);
    }

    console.log(`✅ Expected releases saved (${releases.length} items)`);
    return true;
}

export async function loadExpectedReleasesFromFirestore(uid, idToken) {
    const url = `https://firestore.googleapis.com/v1/projects/${firebaseConfig.projectId}/databases/(default)/documents/users/${uid}/sections/expected_releases`;

    try {
        const response = await fetch(url, {
            method: 'GET',
            headers: { 'Authorization': `Bearer ${idToken}` }
        });

        if (response.status === 404) return [];
        if (!response.ok) {
            console.log(`HTTP ${response.status}`);
            return null;
        }

        const data = await response.json();
        const releases = [];

        if (data.fields && data.fields.items && data.fields.items.arrayValue) {
            const values = data.fields.items.arrayValue.values || [];
            for (const item of values) {
                const fields = item.mapValue.fields;
                releases.push({
                    card_name: fields.card_name?.stringValue || '',
                    section: fields.section?.stringValue || '',
                    release_date: fields.release_date?.stringValue || '',
                    last_notification_date: fields.last_notification_date?.stringValue || null
                });
            }
        }

        return releases;
    } catch (error) {
        console.error('Error loading expected releases:', error);
        return null;
    }
}

export async function saveFavoritesToFirestore(uid, idToken) {
    const favorites = statements.getAllFavorites.all();

    const url = `https://firestore.googleapis.com/v1/projects/${firebaseConfig.projectId}/databases/(default)/documents/users/${uid}/sections/favorites`;

    const body = {
        fields: {
            items: {
                arrayValue: {
                    values: favorites.map(item => ({
                        mapValue: {
                            fields: {
                                card_name: { stringValue: item.card_name },
                                section: { stringValue: item.section }
                            }
                        }
                    }))
                }
            },
            updatedAt: { timestampValue: new Date().toISOString() }
        }
    };

    const response = await fetch(url, {
        method: 'PATCH',
        headers: {
            'Authorization': `Bearer ${idToken}`,
            'Content-Type': 'application/json'
        },
        body: JSON.stringify(body)
    });

    if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`HTTP ${response.status}: ${errorText}`);
    }

    console.log(`✅ Favorites saved (${favorites.length} items)`);
    return true;
}

export async function loadFavoritesFromFirestore(uid, idToken) {
    const url = `https://firestore.googleapis.com/v1/projects/${firebaseConfig.projectId}/databases/(default)/documents/users/${uid}/sections/favorites`;

    try {
        const response = await fetch(url, {
            method: 'GET',
            headers: { 'Authorization': `Bearer ${idToken}` }
        });

        if (response.status === 404) return [];
        if (!response.ok) {
            console.log(`HTTP ${response.status}`);
            return null;
        }

        const data = await response.json();
        const favorites = [];

        if (data.fields && data.fields.items && data.fields.items.arrayValue) {
            const values = data.fields.items.arrayValue.values || [];
            for (const item of values) {
                const fields = item.mapValue.fields;
                favorites.push({
                    card_name: fields.card_name?.stringValue || '',
                    section: fields.section?.stringValue || ''
                });
            }
        }

        return favorites;
    } catch (error) {
        console.error('Error loading favorites:', error);
        return null;
    }
}

export async function getSectionMeta(uid, idToken, section) {
    const meta = await getMeta(uid, idToken);
    const value = meta[section]?.stringValue || null;
    return { _updatedAt: value };
}

export async function getMeta(uid, idToken) {
    const url = `https://firestore.googleapis.com/v1/projects/${firebaseConfig.projectId}/databases/(default)/documents/users/${uid}/sections/META`;

    try {
        const response = await fetch(url, {
            method: 'GET',
            headers: { 'Authorization': `Bearer ${idToken}` }
        });

        if (response.status === 404) {
            return { fields: {} };
        }

        if (!response.ok) {
            console.log(`HTTP ${response.status}`);
            return { fields: {} };
        }

        const data = await response.json();
        return data.fields || {};
    } catch (error) {
        console.error('Error getting meta:', error);
        return { fields: {} };
    }
}

export async function updateMeta(uid, idToken, section, updatedAt) {
    // 1. Получаем текущий документ целиком
    const url = `https://firestore.googleapis.com/v1/projects/${firebaseConfig.projectId}/databases/(default)/documents/users/${uid}/sections/META`;

    let existingFields = {};

    try {
        const response = await fetch(url, {
            method: 'GET',
            headers: { 'Authorization': `Bearer ${idToken}` }
        });

        if (response.ok) {
            const data = await response.json();
            existingFields = data.fields || {};
        }
    } catch (e) {
        // Документа нет — ок
    }

    // 2. Добавляем/обновляем поле для секции
    existingFields[section] = { stringValue: updatedAt };

    console.log(`[updateMeta] Saving ${Object.keys(existingFields).length} fields:`, Object.keys(existingFields).join(', '));

    // 3. Отправляем ВСЕ ПОЛЯ
    const body = { fields: existingFields };

    const response = await fetch(url, {
        method: 'PATCH',
        headers: {
            'Authorization': `Bearer ${idToken}`,
            'Content-Type': 'application/json'
        },
        body: JSON.stringify(body)
    });

    if (!response.ok) {
        const errorText = await response.text();
        console.error(`[updateMeta] Error: ${errorText}`);
        throw new Error(`HTTP ${response.status}: ${errorText}`);
    }

    console.log(`✅ Meta updated for ${section}: ${updatedAt}`);
    return true;
}

