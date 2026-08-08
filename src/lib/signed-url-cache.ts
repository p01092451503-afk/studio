import { supabase } from "@/integrations/supabase/client";
import {
  markCacheHit,
  markCacheMiss,
  markInflightJoin,
  markSignBatch,
} from "@/lib/media-perf";


/**
 * 서명 URL 발급을 버킷 단위로 묶어서(batch) 한 번에 요청하고, 만료 전까지 캐시한다.
 * - 히스토리처럼 카드가 여러 개인 화면에서 요청 수를 1건으로 줄여 로딩을 크게 단축한다.
 * - 세션 확인은 전역에서 한 번만 수행한다.
 */

type CacheEntry = { url: string; expiresAt: number };

const cache = new Map<string, CacheEntry>();
const pending = new Map<string, Promise<string>>();

type QueueItem = {
  path: string;
  resolve: (url: string) => void;
  reject: (error: Error) => void;
};

const queues = new Map<string, QueueItem[]>();
let sessionCheck: Promise<unknown> | null = null;
let sessionCheckedAt = 0;

function ensureSession() {
  const now = Date.now();
  if (!sessionCheck || now - sessionCheckedAt > 60_000) {
    sessionCheckedAt = now;
    sessionCheck = supabase.auth.getSession().catch(() => null);
  }
  return sessionCheck;
}

async function flush(bucket: string, ttl: number) {
  const key = `${bucket}::${ttl}`;
  const items = queues.get(key) ?? [];
  queues.delete(key);
  if (items.length === 0) return;

  await ensureSession();
  const paths = [...new Set(items.map((i) => i.path))];

  try {
    const { data, error } = await supabase.storage.from(bucket).createSignedUrls(paths, ttl);
    if (error) throw error;
    const byPath = new Map<string, string>();
    for (const row of data ?? []) {
      if (row.path && row.signedUrl) byPath.set(row.path, row.signedUrl);
    }
    for (const item of items) {
      const url = byPath.get(item.path);
      if (url) {
        cache.set(`${bucket}::${ttl}::${item.path}`, {
          url,
          expiresAt: Date.now() + Math.max(30, ttl - 30) * 1000,
        });
        item.resolve(url);
      } else {
        item.reject(new Error("SIGNED_URL_FAILED"));
      }
    }
  } catch (e) {
    const err = e instanceof Error ? e : new Error("SIGNED_URL_FAILED");
    for (const item of items) item.reject(err);
  }
}

export function getSignedUrl(bucket: string, path: string, ttl: number): Promise<string> {
  const cacheKey = `${bucket}::${ttl}::${path}`;
  const hit = cache.get(cacheKey);
  if (hit && hit.expiresAt > Date.now()) return Promise.resolve(hit.url);

  const inflight = pending.get(cacheKey);
  if (inflight) return inflight;

  const promise = new Promise<string>((resolve, reject) => {
    const queueKey = `${bucket}::${ttl}`;
    const queue = queues.get(queueKey);
    if (queue) {
      queue.push({ path, resolve, reject });
    } else {
      queues.set(queueKey, [{ path, resolve, reject }]);
      // 같은 틱에 마운트된 카드들의 요청을 한 번에 모은다.
      setTimeout(() => void flush(bucket, ttl), 16);
    }
  }).finally(() => {
    pending.delete(cacheKey);
  });

  pending.set(cacheKey, promise);
  return promise;
}

export function invalidateSignedUrl(bucket: string, path: string, ttl: number) {
  cache.delete(`${bucket}::${ttl}::${path}`);
}
