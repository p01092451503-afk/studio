import { useEffect } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import {
  listAssetGroups,
  listAssets,
  createAssetGroup,
  renameAssetGroup,
  deleteAssetGroup,
  ingestAsset,
  refreshAssetStatus,
  assignAssetCharacter,
  deleteAsset,
  startRealPersonVerify,
  pollRealPersonVerify,
  resolveAssetReference,
} from "@/lib/asset-library.functions";

export type AssetGroupRow = {
  id: string;
  remote_group_id: string | null;
  name: string;
  group_type: string;
  kind: "aigc" | "digital_human" | string;
  verify_status: "none" | "pending" | "verified" | "failed" | string;
  verify_h5_link: string | null;
  consent_holder?: string | null;
  consent_at?: string | null;
  consent_note?: string | null;
  created_at: string;
};

export type AssetRow = {
  id: string;
  group_id: string | null;
  character_id: string | null;
  remote_asset_id: string | null;
  name: string;
  asset_type: "image" | "video" | string;
  status: "draft" | "ingesting" | "ready" | "failed" | string;
  thumbnail_url: string | null;
  storage_path: string | null;
  created_at: string;
};

export function useAssetGroups() {
  const fn = useServerFn(listAssetGroups);
  return useQuery({
    queryKey: ["asset-groups"],
    queryFn: async () => (await fn()) as AssetGroupRow[],
  });
}

export function useAssets(groupId?: string) {
  const fn = useServerFn(listAssets);
  return useQuery({
    queryKey: ["assets", groupId ?? "all"],
    queryFn: async () => (await fn({ data: { groupId } })) as AssetRow[],
    // 입고 중(ingesting)인 자산이 있으면 4초마다 자동 새로고침한다.
    refetchInterval: (query) => {
      const rows = (query.state.data as AssetRow[] | undefined) ?? [];
      return rows.some((row) => row.status === "ingesting") ? 4000 : false;
    },
  });
}

/**
 * 입고 중인 자산의 원격 상태를 주기적으로 서버에 물어 ready 로 전이시킨다.
 * 모든 자산이 ready/failed 가 되면 폴링을 멈춘다.
 */
export function useIngestingStatusPoller(assets: AssetRow[], intervalMs = 4000) {
  const qc = useQueryClient();
  const refresh = useServerFn(refreshAssetStatus);
  const pending = assets.filter((asset) => asset.status === "ingesting").map((asset) => asset.id);
  const key = pending.join(",");

  useEffect(() => {
    if (!key) return;
    let cancelled = false;
    let ticks = 0;
    const MAX_TICKS = 20; // 약 80초 후 폴링 중단 (무한 재시도 방지)
    const tick = async () => {
      const ids = key.split(",");
      let changed = false;
      for (const id of ids) {
        try {
          const res = (await refresh({ data: { id } })) as { status?: string };
          if (res?.status && res.status !== "ingesting") changed = true;
        } catch {
          /* 폴링 실패는 조용히 넘긴다 (다음 주기에 재시도) */
        }
      }
      if (!cancelled && changed) qc.invalidateQueries({ queryKey: ["assets"] });
    };
    void tick();
    const timer = setInterval(() => {
      ticks += 1;
      if (ticks > MAX_TICKS) {
        clearInterval(timer);
        return;
      }
      void tick();
    }, intervalMs);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [key, intervalMs, qc, refresh]);

}

/** 자산을 영상 생성용 정규 참조(URL + 로컬 storage path)로 해석한다. */
export function useResolveAssetReference() {
  const fn = useServerFn(resolveAssetReference);
  return useMutation({
    mutationFn: async (id: string) =>
      (await fn({ data: { id } })) as {
        url: string;
        kind: "image" | "video";
        storagePath: string;
        status: string;
      },
  });
}

export function useCreateAssetGroup() {
  const qc = useQueryClient();
  const fn = useServerFn(createAssetGroup);
  return useMutation({
    mutationFn: (input: { name: string; kind: "aigc" | "digital_human" }) => fn({ data: input }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["asset-groups"] }),
  });
}

export function useRenameAssetGroup() {
  const qc = useQueryClient();
  const fn = useServerFn(renameAssetGroup);
  return useMutation({
    mutationFn: (input: { id: string; name: string }) => fn({ data: input }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["asset-groups"] }),
  });
}

export function useDeleteAssetGroup() {
  const qc = useQueryClient();
  const fn = useServerFn(deleteAssetGroup);
  return useMutation({
    mutationFn: (id: string) => fn({ data: { id } }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["asset-groups"] });
      qc.invalidateQueries({ queryKey: ["assets"] });
    },
  });
}

export function useIngestAsset() {
  const qc = useQueryClient();
  const fn = useServerFn(ingestAsset);
  return useMutation({
    mutationFn: (input: {
      groupId: string;
      storagePath: string;
      name: string;
      assetType?: "image" | "video";
      characterId?: string | null;
    }) => fn({ data: input }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["assets"] }),
  });
}

export function useRefreshAssetStatus() {
  const qc = useQueryClient();
  const fn = useServerFn(refreshAssetStatus);
  return useMutation({
    mutationFn: (id: string) => fn({ data: { id } }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["assets"] }),
  });
}

export function useAssignAssetCharacter() {
  const qc = useQueryClient();
  const fn = useServerFn(assignAssetCharacter);
  return useMutation({
    mutationFn: (input: { id: string; characterId: string | null }) => fn({ data: input }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["assets"] }),
  });
}

export function useDeleteAsset() {
  const qc = useQueryClient();
  const fn = useServerFn(deleteAsset);
  return useMutation({
    mutationFn: (id: string) => fn({ data: { id } }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["assets"] }),
  });
}

export function useStartRealPersonVerify() {
  const qc = useQueryClient();
  const fn = useServerFn(startRealPersonVerify);
  return useMutation({
    mutationFn: (input: {
      groupId: string;
      consentHolder: string;
      consentAt: string;
      consentNote?: string;
    }) => fn({ data: input }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["asset-groups"] }),
  });
}

export function usePollRealPersonVerify() {
  const qc = useQueryClient();
  const fn = useServerFn(pollRealPersonVerify);
  return useMutation({
    mutationFn: (groupId: string) => fn({ data: { groupId } }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["asset-groups"] }),
  });
}
