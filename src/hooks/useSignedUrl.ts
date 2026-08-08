import { useCallback, useEffect, useRef, useState } from "react";
import { getSignedUrl, invalidateSignedUrl } from "@/lib/signed-url-cache";
import { startStage } from "@/lib/media-perf";


/**
 * 비공개 버킷의 서명 URL을 발급한다.
 * - 같은 화면의 여러 요청은 한 번의 배치 요청으로 묶이고, 만료 전까지 캐시된다.
 * - 실패하면 짧은 지연 후 재시도하고, 실패 사유를 반환한다(무한 로딩 방지).
 * - 만료 직전에 자동으로 새 URL을 재발급한다.
 */
export function useSignedUrlState(bucket: string, path: string | null | undefined, ttl = 3600) {
  const [url, setUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [nonce, setNonce] = useState(0);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const retry = useCallback(() => {
    if (path) invalidateSignedUrl(bucket, path, ttl);
    setNonce((n) => n + 1);
  }, [bucket, path, ttl]);

  useEffect(() => {
    let cancelled = false;
    if (timer.current) clearTimeout(timer.current);
    setError(null);

    if (!path) {
      setUrl(null);
      return;
    }

    const sign = async (attempt: number): Promise<void> => {
      try {
        const signedUrl = await getSignedUrl(bucket, path, ttl);
        if (cancelled) return;
        setError(null);
        setUrl(signedUrl);
        // 만료 30초 전에 재발급
        timer.current = setTimeout(() => void sign(1), Math.max(30, ttl - 30) * 1000);
      } catch (e) {
        if (cancelled) return;
        if (attempt < 3) {
          timer.current = setTimeout(() => void sign(attempt + 1), 600 * attempt);
          return;
        }
        setUrl(null);
        setError(e instanceof Error ? e.message : "SIGNED_URL_FAILED");
      }
    };

    void sign(1);

    return () => {
      cancelled = true;
      if (timer.current) clearTimeout(timer.current);
    };
  }, [bucket, path, ttl, nonce]);

  return { url, error, retry };
}

export function useSignedUrl(bucket: string, path: string | null | undefined, ttl = 3600) {
  return useSignedUrlState(bucket, path, ttl).url;
}
