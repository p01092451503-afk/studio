import { useEffect, useRef, useState } from "react";
import { Loader2, PackageOpen, Play } from "lucide-react";
import { useServerFn } from "@tanstack/react-start";
import { getBytePlusAssetPreviewUrl } from "@/lib/byteplus-assets.functions";
import type { BytePlusAsset } from "@/lib/byteplus-assets.server";

function isVideoAsset(asset: BytePlusAsset) {
  const type = (asset.assetType || "").toLowerCase();
  if (type.includes("video")) return true;
  const source = (asset.url || asset.assetName || "").toLowerCase();
  return /\.(mp4|mov|webm|m4v)(\?|$)/.test(source);
}

/** 자산 목록 카드의 미리보기: 이미지는 썸네일, 영상은 마우스를 올리면 짧게 재생된다. */
export function BytePlusAssetPreview({ asset }: { asset: BytePlusAsset }) {
  const video = isVideoAsset(asset);
  const fetchUrl = useServerFn(getBytePlusAssetPreviewUrl);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [mediaUrl, setMediaUrl] = useState<string | null>(asset.url ?? null);
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    setMediaUrl(asset.url ?? null);
    setFailed(false);
  }, [asset.assetId, asset.url]);

  async function ensureUrl() {
    if (mediaUrl || loading || failed) return;
    setLoading(true);
    try {
      const result = await fetchUrl({ data: { assetId: asset.assetId } });
      if (result.url) setMediaUrl(result.url);
      else setFailed(true);
    } catch {
      setFailed(true);
    } finally {
      setLoading(false);
    }
  }

  async function handleEnter() {
    if (!video) return;
    await ensureUrl();
    const element = videoRef.current;
    if (!element) return;
    try {
      element.currentTime = 0;
      await element.play();
    } catch {
      /* 자동재생이 차단된 경우 무시 */
    }
  }

  function handleLeave() {
    const element = videoRef.current;
    if (!element) return;
    element.pause();
    element.currentTime = 0;
  }

  const poster = asset.thumbnailUrl;

  return (
    <div
      className="group relative aspect-video w-full overflow-hidden bg-muted"
      onMouseEnter={() => void handleEnter()}
      onMouseLeave={handleLeave}
    >
      {video ? (
        <>
          {mediaUrl ? (
            <video
              ref={videoRef}
              src={mediaUrl}
              poster={poster}
              muted
              loop
              playsInline
              preload="metadata"
              className="h-full w-full object-cover"
            />
          ) : poster ? (
            <img src={poster} alt={asset.assetName} className="h-full w-full object-cover" loading="lazy" />
          ) : (
            <div className="flex h-full w-full items-center justify-center">
              <PackageOpen className="h-8 w-8 text-muted-foreground" />
            </div>
          )}
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center bg-foreground/20 opacity-100 transition-opacity group-hover:opacity-0">
            {loading ? (
              <Loader2 className="h-6 w-6 animate-spin text-background" />
            ) : (
              <Play className="h-8 w-8 text-background" />
            )}
          </div>
          <span className="pointer-events-none absolute bottom-1 right-1 rounded bg-foreground/70 px-1.5 py-0.5 text-[10px] font-bold text-background">
            {failed ? "미리보기 불가" : "영상"}
          </span>
        </>
      ) : poster || mediaUrl ? (
        <img
          src={poster || mediaUrl || ""}
          alt={asset.assetName}
          loading="lazy"
          className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-105"
        />
      ) : (
        <button
          type="button"
          onClick={() => void ensureUrl()}
          className="flex h-full w-full items-center justify-center text-xs text-muted-foreground"
        >
          {loading ? <Loader2 className="h-6 w-6 animate-spin" /> : failed ? "미리보기 불가" : <PackageOpen className="h-8 w-8" />}
        </button>
      )}
    </div>
  );
}
