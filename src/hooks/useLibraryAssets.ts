import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export type LibraryAssetRow = {
  id: string;
  character_id: string | null;
  name: string;
  kind: "image" | "video";
  cover_path: string;
  frame_paths: string[];
  source_path: string | null;
  created_at: string;
};

function normalize(row: any): LibraryAssetRow {
  return {
    id: row.id,
    character_id: row.character_id ?? null,
    name: row.name,
    kind: row.kind === "video" ? "video" : "image",
    cover_path: row.cover_path,
    frame_paths: Array.isArray(row.frame_paths)
      ? row.frame_paths.filter((value: unknown): value is string => typeof value === "string")
      : [],
    source_path: row.source_path ?? null,
    created_at: row.created_at,
  };
}

export function useLibraryAssets() {
  return useQuery({
    queryKey: ["library-assets"],
    queryFn: async (): Promise<LibraryAssetRow[]> => {
      const { data, error } = await supabase
        .from("library_assets")
        .select("id, character_id, name, kind, cover_path, frame_paths, source_path, created_at")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data ?? []).map(normalize);
    },
  });
}

export type SaveLibraryAssetInput = {
  tenantId: string;
  name: string;
  kind: "image" | "video";
  coverPath: string;
  framePaths: string[];
  sourcePath?: string | null;
  characterId?: string | null;
};

export function useSaveLibraryAsset() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: SaveLibraryAssetInput) => {
      const { data: userData } = await supabase.auth.getUser();
      const { data, error } = await supabase
        .from("library_assets")
        .insert({
          tenant_id: input.tenantId,
          character_id: input.characterId ?? null,
          name: input.name,
          kind: input.kind,
          cover_path: input.coverPath,
          frame_paths: input.framePaths,
          source_path: input.sourcePath ?? null,
          created_by: userData.user?.id ?? null,
        })
        .select("id")
        .single();
      if (error) throw error;
      return data.id as string;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["library-assets"] }),
  });
}

export function useAssignLibraryAssetCharacter() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { id: string; characterId: string | null }) => {
      const { error } = await supabase
        .from("library_assets")
        .update({ character_id: input.characterId })
        .eq("id", input.id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["library-assets"] }),
  });
}

export function useDeleteLibraryAsset() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("library_assets").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["library-assets"] }),
  });
}
