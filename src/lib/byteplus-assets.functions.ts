import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

/** AK/SK 서명 인증으로 BytePlus 자산 라이브러리 API 연결을 점검한다. */
export const checkBytePlusAssetsConnection = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async () => {
    const { probeBytePlusAssets } = await import("@/lib/byteplus-assets.server");
    try {
      const result = await probeBytePlusAssets();
      return { checkedAt: new Date().toISOString(), ...result };
    } catch (e) {
      return {
        checkedAt: new Date().toISOString(),
        ok: false,
        status: 0,
        action: "-",
        host: "-",
        region: "-",
        service: "-",
        body: "",
        errorCode: "LOCAL_ERROR",
        errorMessage: e instanceof Error ? e.message : String(e),
      };
    }
  });

/** BytePlus 자산 라이브러리에서 그룹 목록 또는 특정 그룹의 자산 목록을 조회한다. */
export const getBytePlusAssets = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { groupId?: string }) => data)
  .handler(async ({ data }) => {
    const {
      listBytePlusAssetGroups,
      listBytePlusAssets,
    } = await import("@/lib/byteplus-assets.server");
    if (data.groupId) {
      const { assets, raw } = await listBytePlusAssets(data.groupId);
      return { assets, raw };
    }
    const { groups, raw } = await listBytePlusAssetGroups();
    return { groups, raw };
  });

/** BytePlus 자산을 다운로드하여 tenant Storage에 저장하고 경로를 반환한다. */
export const importBytePlusAsset = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { assetId: string; tenantId: string; name: string }) => data)
  .handler(async ({ data }) => {
    const { importBytePlusAssetToStorage } = await import("@/lib/byteplus-assets.server");
    const { path, sourceUrl } = await importBytePlusAssetToStorage(data.assetId, data.tenantId, data.name);
    return { path, sourceUrl };
  });

