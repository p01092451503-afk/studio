import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import {
  listAssetGroups,
  listAssets,
  createAssetGroup,
  deleteAssetGroup,
  ingestAsset,
  refreshAssetStatus,
  assignAssetCharacter,
  deleteAsset,
  startRealPersonVerify,
  pollRealPersonVerify,
} from "@/lib/asset-library.functions";

export type AssetGroupRow = {
  id: string;
  remote_group_id: string | null;
  name: string;
  group_type: string;
  kind: "aigc" | "digital_human" | string;
  verify_status: "none" | "pending" | "verified" | "failed" | string;
  verify_h5_link: string | null;
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
    mutationFn: (groupId: string) => fn({ data: { groupId } }),
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
