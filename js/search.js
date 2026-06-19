// 源健康记录：连续失败的源在冷却期内跳过，避免每次搜索都被死源拖慢（冷却到期自动重试自愈）
(function (g) {
    const HKEY = 'sourceHealth';
    const FAIL_THRESHOLD = 3;
    const COOLDOWN_MS = 10 * 60 * 1000; // 10 分钟
    function load() { try { return JSON.parse(localStorage.getItem(HKEY) || '{}'); } catch (e) { return {}; } }
    function save(h) { try { localStorage.setItem(HKEY, JSON.stringify(h)); } catch (e) {} }
    g.recordSourceHealth = function (id, ok) {
        if (!id) return;
        const h = load();
        const r = h[id] || { fail: 0, lastFail: 0, lastOk: 0 };
        const now = Date.now();
        if (ok) { r.fail = 0; r.lastOk = now; } else { r.fail = (r.fail || 0) + 1; r.lastFail = now; }
        h[id] = r; save(h);
    };
    g.isSourceLikelyDead = function (id) {
        const r = load()[id];
        if (!r) return false;
        return (r.fail || 0) >= FAIL_THRESHOLD && (Date.now() - (r.lastFail || 0)) < COOLDOWN_MS;
    };
})(window);

async function searchByAPIAndKeyWord(apiId, query) {
    try {
        let apiUrl, apiName, apiBaseUrl;

        // 处理自定义API
        if (apiId.startsWith('custom_')) {
            const customIndex = apiId.replace('custom_', '');
            const customApi = getCustomApiInfo(customIndex);
            if (!customApi) return [];

            apiBaseUrl = customApi.url;
            apiUrl = apiBaseUrl + API_CONFIG.search.path + encodeURIComponent(query);
            apiName = customApi.name;
        } else {
            // 内置API
            if (!API_SITES[apiId]) return [];
            apiBaseUrl = API_SITES[apiId].api;
            apiUrl = apiBaseUrl + API_CONFIG.search.path + encodeURIComponent(query);
            apiName = API_SITES[apiId].name;
        }

        // 添加超时处理（5s，比原 8s 更快放弃死源）
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 5000);

        const response = await fetch(PROXY_URL + encodeURIComponent(apiUrl), {
            headers: API_CONFIG.search.headers,
            signal: controller.signal
        });

        clearTimeout(timeoutId);

        if (!response.ok) {
            window.recordSourceHealth(apiId, false);
            return [];
        }

        const data = await response.json();
        window.recordSourceHealth(apiId, true); // 有响应即视为存活（空结果也算活）

        if (!data || !data.list || !Array.isArray(data.list) || data.list.length === 0) {
            return [];
        }
        
        // 处理第一页结果
        const results = data.list.map(item => ({
            ...item,
            source_name: apiName,
            source_code: apiId,
            api_url: apiId.startsWith('custom_') ? getCustomApiInfo(apiId.replace('custom_', ''))?.url : undefined
        }));
        
        // 获取总页数
        const pageCount = data.pagecount || 1;
        // 确定需要获取的额外页数 (最多获取maxPages页)
        const pagesToFetch = Math.min(pageCount - 1, API_CONFIG.search.maxPages - 1);
        
        // 如果有额外页数，获取更多页的结果
        if (pagesToFetch > 0) {
            const additionalPagePromises = [];
            
            for (let page = 2; page <= pagesToFetch + 1; page++) {
                // 构建分页URL
                const pageUrl = apiBaseUrl + API_CONFIG.search.pagePath
                    .replace('{query}', encodeURIComponent(query))
                    .replace('{page}', page);
                
                // 创建获取额外页的Promise
                const pagePromise = (async () => {
                    try {
                        const pageController = new AbortController();
                        const pageTimeoutId = setTimeout(() => pageController.abort(), 8000);
                        
                        const pageResponse = await fetch(PROXY_URL + encodeURIComponent(pageUrl), {
                            headers: API_CONFIG.search.headers,
                            signal: pageController.signal
                        });
                        
                        clearTimeout(pageTimeoutId);
                        
                        if (!pageResponse.ok) return [];
                        
                        const pageData = await pageResponse.json();
                        
                        if (!pageData || !pageData.list || !Array.isArray(pageData.list)) return [];
                        
                        // 处理当前页结果
                        return pageData.list.map(item => ({
                            ...item,
                            source_name: apiName,
                            source_code: apiId,
                            api_url: apiId.startsWith('custom_') ? getCustomApiInfo(apiId.replace('custom_', ''))?.url : undefined
                        }));
                    } catch (error) {
                        console.warn(`API ${apiId} 第${page}页搜索失败:`, error);
                        return [];
                    }
                })();
                
                additionalPagePromises.push(pagePromise);
            }
            
            // 等待所有额外页的结果
            const additionalResults = await Promise.all(additionalPagePromises);
            
            // 合并所有页的结果
            additionalResults.forEach(pageResults => {
                if (pageResults.length > 0) {
                    results.push(...pageResults);
                }
            });
        }
        
        return results;
    } catch (error) {
        console.warn(`API ${apiId} 搜索失败:`, error);
        window.recordSourceHealth(apiId, false);
        return [];
    }
}