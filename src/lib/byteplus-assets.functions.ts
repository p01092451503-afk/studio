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
