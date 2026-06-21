((global) => {
	const cacheKey = "umami-share-cache";
	const cacheTTL = 3600_000; // 1h

	async function fetchShareData(baseUrl, shareId) {
		const cached = localStorage.getItem(cacheKey);
		if (cached) {
			try {
				const parsed = JSON.parse(cached);
				if (Date.now() - parsed.timestamp < cacheTTL) {
					return parsed.value;
				}
			} catch {
				localStorage.removeItem(cacheKey);
			}
		}
		const res = await fetch(`${baseUrl}/api/share/${shareId}`);
		if (!res.ok) {
			throw new Error("获取 Umami 分享信息失败");
		}
		const data = await res.json();
		localStorage.setItem(
			cacheKey,
			JSON.stringify({ timestamp: Date.now(), value: data }),
		);
		return data;
	}

	/**
	 * 获取 Umami 分享数据（websiteId、token）
	 * 在缓存 TTL 内复用；并用全局 Promise 避免并发请求
	 * @param {string} baseUrl
	 * @param {string} shareId
	 * @returns {Promise<{websiteId: string, token: string}>}
	 */
	global.getUmamiShareData = (baseUrl, shareId) => {
		if (!global.__umamiSharePromise) {
			global.__umamiSharePromise = fetchShareData(baseUrl, shareId).catch(
				(err) => {
					delete global.__umamiSharePromise;
					throw err;
				},
			);
		}
		return global.__umamiSharePromise;
	};

	global.clearUmamiShareCache = () => {
		localStorage.removeItem(cacheKey);
		delete global.__umamiSharePromise;
	};

	// 初始化全局缓存 Map
	if (!global.__umamiDataCache) {
		global.__umamiDataCache = new Map();
	}

	/**
	 * 获取 Umami 统计数据
	 * 自动处理 token 获取和过期重试
	 * @param {string} baseUrl
	 * @param {string} shareId
	 * @param {object} queryParams
	 * @returns {Promise<any>}
	 */
	global.fetchUmamiStats = async (baseUrl, shareId, queryParams) => {
		// 生成缓存键：baseUrl + shareId + queryParams的字符串表示
		const cacheKey = `${baseUrl}|${shareId}|${JSON.stringify(queryParams)}`;
		
		// 检查全局内存缓存
		if (global.__umamiDataCache.has(cacheKey)) {
            const data = global.__umamiDataCache.get(cacheKey);
            return { ...data, _fromCache: true };
		}

		async function doFetch(isRetry = false) {
			const { websiteId, token } = await global.getUmamiShareData(
				baseUrl,
				shareId,
			);
			const currentTimestamp = Date.now();
			const timezone = queryParams.timezone || "Asia/Shanghai";

			// Share Token 下 /stats 的 url 参数会被忽略，导致总是返回全站数据
			// 改用 /metrics?type=url 端点并在客户端按 URL 过滤
			if (queryParams.url) {
				const params = new URLSearchParams({
					startAt: 0,
					endAt: currentTimestamp,
					timezone,
					type: "path",
					limit: 500,
				});
				const metricsUrl = `${baseUrl}/api/websites/${websiteId}/metrics?${params.toString()}`;
				const res = await fetch(metricsUrl, {
					headers: { "x-umami-share-token": token },
				});
				if (!res.ok) {
					if (res.status === 401 && !isRetry) {
						global.clearUmamiShareCache();
						return doFetch(true);
					}
					throw new Error("获取统计数据失败");
				}
				const cleanPath = (p) => {
					if (!p) return "";
					return p.toLowerCase()
						.replace(/^https?:\/\/[^\/]+/, "")
						.replace(/^\/+|\/+$/g, "")
						.replace(/\.html$/, "")
						.replace(/\/index$/, "");
				};

				const targetUrl = queryParams.url;
				const cleanTarget = cleanPath(targetUrl);
				const entry = metricsData.find((item) => cleanPath(item.x) === cleanTarget);

				const count = entry ? entry.y : 0;
				const data = { pageviews: count, visitors: count, visits: count };
				global.__umamiDataCache.set(cacheKey, data);
				return data;
			}

			// 无 url 过滤时使用原来的 /stats 全站数据端点
			const params = new URLSearchParams({
				startAt: 0,
				endAt: currentTimestamp,
				unit: "hour",
				timezone,
			});
			const statsUrl = `${baseUrl}/api/websites/${websiteId}/stats?${params.toString()}`;
			const res = await fetch(statsUrl, {
				headers: { "x-umami-share-token": token },
			});
			if (!res.ok) {
				if (res.status === 401 && !isRetry) {
					global.clearUmamiShareCache();
					return doFetch(true);
				}
				throw new Error("获取统计数据失败");
			}
			const data = await res.json();
			const normalizedData = {
				pageviews: (data.pageviews && typeof data.pageviews === 'object') ? (data.pageviews.value || 0) : (Number(data.pageviews) || 0),
				visitors: (data.visitors && typeof data.visitors === 'object') ? (data.visitors.value || 0) : (Number(data.visitors) || 0),
				visits: (data.visits && typeof data.visits === 'object') ? (data.visits.value || 0) : (Number(data.visits) || 0)
			};
			global.__umamiDataCache.set(cacheKey, normalizedData);
			return normalizedData;
		}

		return doFetch();
	};

	/**
	 * 获取 Umami 事件统计数据
	 * @param {string} baseUrl
	 * @param {string} shareId
	 * @param {object} queryParams
	 * @returns {Promise<any>}
	 */
	global.fetchUmamiEvents = async (baseUrl, shareId, queryParams) => {
		const cacheKey = `events|${baseUrl}|${shareId}|${JSON.stringify(queryParams)}`;
		
		if (global.__umamiDataCache.has(cacheKey)) {
            const data = global.__umamiDataCache.get(cacheKey);
            return { ...data, _fromCache: true };
		}

		async function doFetch(isRetry = false) {
			const { websiteId, token } = await global.getUmamiShareData(
				baseUrl,
				shareId,
			);
			const currentTimestamp = Date.now();
			const params = new URLSearchParams({
				startAt: 0,
				endAt: currentTimestamp,
				unit: "hour",
				timezone: queryParams.timezone || "Asia/Shanghai",
				...queryParams,
			});

			// umami api: /api/websites/{websiteId}/metrics?type=event
			const statsUrl = `${baseUrl}/api/websites/${websiteId}/metrics?type=event&${params.toString()}`;

			const res = await fetch(statsUrl, {
				headers: {
					"x-umami-share-token": token,
				},
			});

			if (!res.ok) {
				if (res.status === 401 && !isRetry) {
					global.clearUmamiShareCache();
					return doFetch(true);
				}
				throw new Error("获取事件数据失败");
			}

			const data = await res.json();
			global.__umamiDataCache.set(cacheKey, data);
			return data;
		}

		return doFetch();
	};
})(window);
