import { useEffect, useRef, useState } from "react";
import { useSignedUrl, useSignedUrlState } from "@/hooks/useSignedUrl";
import { cn } from "@/lib/utils";

export function SignedVideo({
  bucket,
  path,
  posterPath,
  className,
  ttl = 3600,
  controls = true,
  lazy = true,
}: {
  bucket: string;
  path: string | null | undefined;
  posterPath?: string | null;
  className?: string;
  ttl?: number;
  controls?: boolean;
  lazy?: boolean;
}) {
  const holder = useRef<HTMLDivElement | null>(null);
  const [visible, setVisible] = useState(!lazy);

  useEffect(() => {
    if (visible || typeof IntersectionObserver === "undefined") return;
    const el = holder.current;
    if (!el) return;
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setVisible(true);
          io.disconnect();
        }
      },
      { rootMargin: "300px" },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [visible]);

  // 포스터가 있으면 포스터 먼저, 영상은 화면에 들어올 때 발급한다.
  const { url, error, retry } = useSignedUrlState(bucket, visible ? path : null, ttl);
  const poster = useSignedUrl(bucket, posterPath ?? null, ttl);

  if (error) {
    return (
      <div
        className={cn(
          "flex flex-col items-center justify-center gap-2 bg-muted p-4 text-center text-xs text-muted-foreground",
          className,
        )}
      >
        <span>영상을 불러오지 못했습니다.</span>
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            retry();
          }}
          className="rounded-full border border-border px-3 py-1 font-semibold text-foreground"
        >
          다시 시도
        </button>
      </div>
    );
  }

  if (!url) {
    return (
      <div ref={holder} className={cn("relative overflow-hidden bg-muted", className)}>
        {poster ? (
          <img src={poster} alt="" className="h-full w-full object-cover" loading="lazy" />
        ) : (
          <div className="flex h-full w-full animate-pulse items-center justify-center text-xs text-muted-foreground">
            …
          </div>
        )}
      </div>
    );
  }

  return (
    <video
      ref={(node) => {
        holder.current = node as unknown as HTMLDivElement | null;
      }}
      key={url}
      src={url}
      poster={poster ?? undefined}
      className={className}
      controls={controls}
      playsInline
      preload={controls ? "metadata" : "none"}
    />
  );
}
