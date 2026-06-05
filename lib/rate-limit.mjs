// lib/rate-limit.mjs
// 零依赖的内存滑动窗口限流器，按 key（默认客户端 IP）限制单位时间内请求数。
// 仅适用于单实例 Node 部署；多实例/Serverless 请改用平台原生限流或 Redis。

/**
 * 创建一个 Express 限流中间件。
 * @param {{windowMs?: number, max?: number, keyGenerator?: (req)=>string, message?: string}} [opts]
 */
export function createRateLimiter(opts = {}) {
  const windowMs = opts.windowMs ?? 60_000;
  const max = opts.max ?? 120;
  const message = opts.message ?? '请求过于频繁，请稍后再试';
  const keyGenerator =
    opts.keyGenerator ??
    ((req) =>
      (req.headers['x-forwarded-for'] || '').split(',')[0].trim() ||
      req.socket?.remoteAddress ||
      'unknown');

  /** @type {Map<string, number[]>} key -> 时间戳数组 */
  const hits = new Map();

  // 周期性清理过期 key，避免内存泄漏
  const sweep = setInterval(() => {
    const now = Date.now();
    for (const [key, times] of hits) {
      const fresh = times.filter((t) => now - t < windowMs);
      if (fresh.length) hits.set(key, fresh);
      else hits.delete(key);
    }
  }, windowMs);
  if (sweep.unref) sweep.unref();

  return function rateLimit(req, res, next) {
    const key = keyGenerator(req);
    const now = Date.now();
    const times = (hits.get(key) || []).filter((t) => now - t < windowMs);

    if (times.length >= max) {
      const retryAfter = Math.ceil((times[0] + windowMs - now) / 1000);
      res.setHeader('Retry-After', String(retryAfter));
      res.setHeader('X-RateLimit-Limit', String(max));
      res.setHeader('X-RateLimit-Remaining', '0');
      return res.status(429).send(message);
    }

    times.push(now);
    hits.set(key, times);
    res.setHeader('X-RateLimit-Limit', String(max));
    res.setHeader('X-RateLimit-Remaining', String(max - times.length));
    next();
  };
}
