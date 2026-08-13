import { useEffect, useState } from "react";
import { ImageIcon, FileVideo } from "lucide-react";
import { useSignedUrl } from "@/hooks/useSignedUrl";
import { cn } from "@/lib/utils";

const VIDEO_EXT = /\.(mp4|mov|webm|m4v|avi|mkv)(\?|$)/i;

/**
 * 자산 썸네일. 영상은 <video>로, 이미지는 <img>로 렌더링하고
 * 로드에 실패하면 깨진 이미지 아이콘 대신 플레이스홀더를 보여준다.
 */
export function AssetPreview({
  bucket,
  storagePath,
  fallbackUrl,
  assetType,
  alt,
  className,
}: {
  bucket: string;
  storagePath?: string | null;
  fallbackUrl?: string | null;
  assetType?: string | null;
  alt: string;
  className?: string;
}) {
  const signed = useSignedUrl(bucket, storagePath ?? null, 300);
  const url = storagePath ? signed : (fallbackUrl ?? null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    setFailed(false);
  }, [url]);

  const isVideo =
    (assetType ?? "").toLowerCase() === "video" ||
    VIDEO_EXT.test(storagePath ?? "") ||
    VIDEO_EXT.test(fallbackUrl ?? "");

  if (!url || failed) {
    return (
      <div className={cn("flex items-center justify-center bg-muted/50", className)}>
        {isVideo ? (
          <FileVideo className="h-8 w-8 text-muted-foreground" />
        ) : (
          <ImageIcon className="h-8 w-8 text-muted-foreground" />
        )}
      </div>
    );
  }

  if (isVideo) {
    return (
      <video
        src={url}
        className={className}
        muted
        playsInline
        preload="metadata"
        controls
        onError={() => setFailed(true)}
      />
    );
  }

  return (
    <img
      src={url}
      alt={alt}
      loading="lazy"
      className={className}
      onError={() => setFailed(true)}
    />
  );
}
