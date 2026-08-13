import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { ImagePlus, Loader2, Plus, ShieldCheck, ShieldAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { AssetPreview } from "@/components/AssetPreview";
import {
  useAssetGroups,
  useAssets,
  useIngestingStatusPoller,
  type AssetRow,
  type AssetGroupRow,
} from "@/hooks/useAssetLibrary";

/**
 * 자산고(asset-library)에 입고된 자산을 영상 생성 참고 미디어로 바로 선택하는 다이얼로그.
 * 진단(status/verify_status) 결과를 배지로 보여주고, 검증 통과 자산을 우선 노출한다.
 */
export function AssetVaultDialog({
  open,
  onOpenChange,
  onPick,
  disabled,
}: {
  open: boolean;
  onOpenChange: (value: boolean) => void;
  onPick: (asset: AssetRow) => void;
  disabled?: boolean;
}) {
  const { t } = useTranslation();
  const { data: groups = [] } = useAssetGroups();
  const { data: assets = [], isLoading, error, refetch } = useAssets();
  useIngestingStatusPoller(open ? assets : []);

  // 다이얼로그를 열면 1회 자동 새로고침한다.
  useEffect(() => {
    if (open) void refetch();
  }, [open, refetch]);
  const [groupFilter, setGroupFilter] = useState<string>("all");
  const [readyOnly, setReadyOnly] = useState(true);

  const groupById = useMemo(() => {
    const map = new Map<string, AssetGroupRow>();
    for (const group of groups) map.set(group.id, group);
    return map;
  }, [groups]);

  const visible = useMemo(() => {
    // 원격 전용 자산(storage_path 없음)도 선택 가능하다 — 선택 시 로컬 사본을 확보한다.
    const usable = assets.filter(
      (asset) => Boolean(asset.storage_path) || Boolean(asset.remote_asset_id),
    );
    const scoped =
      groupFilter === "all" ? usable : usable.filter((asset) => asset.group_id === groupFilter);
    const filtered = readyOnly ? scoped.filter((asset) => asset.status === "ready") : scoped;
    return [...filtered].sort(
      (a, b) => Number(b.status === "ready") - Number(a.status === "ready"),
    );
  }, [assets, groupFilter, readyOnly]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] max-w-3xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{t("vault.dialog_title")}</DialogTitle>
        </DialogHeader>
        <p className="text-xs text-muted-foreground">{t("vault.hint")}</p>

        <div className="flex flex-wrap items-center gap-2">
          <Select value={groupFilter} onValueChange={setGroupFilter}>
            <SelectTrigger className="w-56">
              <SelectValue placeholder={t("vault.filter_all")} />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">{t("vault.filter_all")}</SelectItem>
              {groups.map((group) => (
                <SelectItem key={group.id} value={group.id}>
                  {group.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button
            variant={readyOnly ? "default" : "outline"}
            size="sm"
            onClick={() => setReadyOnly((value) => !value)}
          >
            <ShieldCheck className="h-4 w-4" /> {t("vault.ready_only")}
          </Button>
        </div>

        {isLoading && (
          <div className="flex items-center gap-2 py-8 text-sm text-muted-foreground">
            <Loader2 className="h-5 w-5 animate-spin" /> {t("vault.loading")}
          </div>
        )}
        {error && <p className="py-6 text-sm text-muted-foreground">{t("vault.load_error")}</p>}
        {!isLoading && !error && visible.length === 0 && (
          <p className="py-8 text-center text-sm text-muted-foreground">{t("vault.empty")}</p>
        )}

        <div className="grid gap-3 sm:grid-cols-3">
          {visible.map((asset) => {
            const group = asset.group_id ? groupById.get(asset.group_id) : undefined;
            const verified = group?.verify_status === "verified";
            return (
              <div
                key={asset.id}
                className="overflow-hidden rounded-lg border border-border bg-muted/30"
              >
                {asset.storage_path ? (
                  <AssetPreview
                    bucket="character-refs"
                    storagePath={asset.storage_path}
                    assetType={asset.asset_type}
                    alt={asset.name}
                    className="aspect-video w-full object-cover"
                  />
                ) : (
                  <div className="flex aspect-video w-full items-center justify-center bg-primary-soft">
                    <ImagePlus className="h-7 w-7 text-primary" />
                  </div>
                )}
                <div className="space-y-2 p-3">
                  <p className="truncate text-xs font-bold">{asset.name}</p>
                  <div className="flex flex-wrap items-center gap-1">
                    <span
                      className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${
                        asset.status === "ready"
                          ? "bg-primary-soft text-primary"
                          : "bg-muted text-muted-foreground"
                      }`}
                    >
                      {t(`vault.status.${asset.status}`, { defaultValue: asset.status })}
                    </span>
                    {group && (
                      <span className="inline-flex items-center gap-1 rounded-full border border-border px-2 py-0.5 text-[11px] text-muted-foreground">
                        {verified ? (
                          <ShieldCheck className="h-3 w-3 text-primary" />
                        ) : (
                          <ShieldAlert className="h-3 w-3" />
                        )}
                        {group.name}
                      </span>
                    )}
                  </div>
                  <Button
                    size="sm"
                    className="w-full"
                    disabled={disabled}
                    onClick={() => onPick(asset)}
                  >
                    <Plus className="h-4 w-4" /> {t("vault.use")}
                  </Button>
                </div>
              </div>
            );
          })}
        </div>
      </DialogContent>
    </Dialog>
  );
}
