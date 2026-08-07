import { useSignedUrl, useSignedUrlState } from "@/hooks/useSignedUrl";
import { cn } from "@/lib/utils";

export function SignedVideo({
  bucket,
  path,
  posterPath,
  className,
  ttl = 3600,
  controls = true,
}: {
  bucket: string;
  path: string | null | undefined;
  posterPath?: string | null;
  className?: string;
  ttl?: number;
  controls?: boolean;
}) {
  const { url, error, retry } = useSignedUrlState(bucket, path, ttl);
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
      <div
        className={cn(
          "flex animate-pulse items-center justify-center bg-muted text-xs text-muted-foreground",
          className,
        )}
      >
        …
      </div>
    );
  }

  return (
    <video
      key={url}
      src={url}
      poster={poster ?? undefined}
      className={className}
      controls={controls}
      playsInline
      preload="metadata"
    />
  );
}
