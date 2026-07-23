/**
 * gmzCache.js
 * Shared caching layer for Google-Sheets CSV fetches.
 *
 * Behavior:
 * - Cached responses live in sessionStorage, so navigating between pages
 *   (mainlist -> level -> leaderboard, etc.) is instant and doesn't
 *   re-download/re-parse the same sheet.
 * - sessionStorage is cleared automatically by the browser when the tab/
 *   window is closed, so leaving the site fully "resets" the cache.
 * - A hard refresh (F5 / Ctrl+R / reload button) is detected via the
 *   Navigation Timing API and forces a fresh fetch, so refreshing the page
 *   always gets you current data.
 * - As a safety net in case a tab is left open for a long time, entries
 *   also expire after GMZ_CACHE_TTL_MS regardless of the above.
 */
(function () {
    const GMZ_CACHE_PREFIX = "gmz_cache_";
    const GMZ_CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes freshness window

    // If this page load was a reload, wipe any previously cached data first
    // so the reload always pulls fresh data from the network.
    try {
        const navEntries = performance.getEntriesByType("navigation");
        const isReload = navEntries.length > 0
            ? navEntries[0].type === "reload"
            : (performance.navigation && performance.navigation.type === 1);

        if (isReload) {
            Object.keys(sessionStorage)
                .filter(k => k.startsWith(GMZ_CACHE_PREFIX))
                .forEach(k => sessionStorage.removeItem(k));
        }
    } catch (e) {
        // Navigation Timing API not available - fall back to TTL-only caching
    }

    function cacheGet(key) {
        try {
            const raw = sessionStorage.getItem(GMZ_CACHE_PREFIX + key);
            if (!raw) return null;
            const parsed = JSON.parse(raw);
            if (Date.now() - parsed.t > GMZ_CACHE_TTL_MS) return null;
            return parsed.v;
        } catch (e) {
            return null;
        }
    }

    function cacheSet(key, value) {
        try {
            sessionStorage.setItem(GMZ_CACHE_PREFIX + key, JSON.stringify({ t: Date.now(), v: value }));
        } catch (e) {
            // Storage full or unavailable (private browsing) - fail silently, just skip caching
        }
    }

    // In-flight request de-duping, so if two parts of a page ask for the
    // same URL at the same time we only hit the network once.
    const inFlight = new Map();

    async function fetchTextCached(url) {
        const cached = cacheGet(url);
        if (cached !== null) return cached;

        if (inFlight.has(url)) return inFlight.get(url);

        const promise = fetch(url)
            .then(res => res.text())
            .then(text => {
                cacheSet(url, text);
                inFlight.delete(url);
                return text;
            })
            .catch(err => {
                inFlight.delete(url);
                throw err;
            });

        inFlight.set(url, promise);
        return promise;
    }

    async function fetchCsvCached(url) {
        const text = await fetchTextCached(url);
        return Papa.parse(text, { header: true, skipEmptyLines: true }).data;
    }

    function sheetCsvUrl(spreadsheetId, gid) {
        return `https://docs.google.com/spreadsheets/d/${spreadsheetId}/export?format=csv&gid=${gid}`;
    }

    window.GMZCache = { fetchTextCached, fetchCsvCached, sheetCsvUrl };
})();
