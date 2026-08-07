import { useCallback, useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

/**
 * 비공개 버킷의 서명 URL을 발급한다.
 * - 실패하면 짧은 지연 후 재시도하고, 실패 사유를 반환한다(무한 로딩 방지).
 * - 만료 직전에 자동으로 새 URL을 재발급한다.
 */
export function useSignedUrlState(bucket: string, path: string | null | undefined, ttl = 3600) {
  const [url, setUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [nonce, setNonce] = useState(0);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const retry = useCallback(() => setNonce((n) => n + 1), []);

  useEffect(() => {
    let cancelled = false;
    if (timer.current) clearTimeout(timer.current);
    setError(null);

    if (!path) {
      setUrl(null);
      return;
    }

    const sign = async (attempt: number): Promise<void> => {
      // 만료된 액세스 토큰으로 서명 요청이 403 되는 것을 막는다.
      await supabase.auth.getSession();
      const { data, error: signError } = await supabase.storage
        .from(bucket)
        .createSignedUrl(path, ttl);
      if (cancelled) return;

      if (signError || !data?.signedUrl) {
        if (attempt < 3) {
          timer.current = setTimeout(() => void sign(attempt + 1), 800 * attempt);
          return;
        }
        setUrl(null);
        setError(signError?.message ?? "SIGNED_URL_FAILED");
        return;
      }

      setError(null);
      setUrl(data.signedUrl);
      // 만료 30초 전에 재발급
      timer.current = setTimeout(() => void sign(1), Math.max(30, ttl - 30) * 1000);
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
