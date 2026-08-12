import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export const checkVideoModelHealth = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async () => {
    try {
      const { probeSeedance } = await import("@/lib/video-health.server");
      const models = [await probeSeedance()];

      return {
        checkedAt: new Date().toISOString(),
        canGenerate: models.some((m) => m.status === "available"),
        models,
      };
    } catch (error) {
      console.error("[video-health] probe failed", error);
      return {
        checkedAt: new Date().toISOString(),
        canGenerate: false,
        models: [
          {
            id: "dreamina-seedance-2-0-260128",
            label: "Seedance 2.0",
            provider: "seedance" as const,
            status: "unknown" as const,
            detail:
              "연결 상태를 확인하는 중 오류가 발생했습니다. 잠시 후 다시 시도해 주세요.",
            validation: {
              credential: "unknown" as const,
              model: "unknown" as const,
              endpoint: "unknown" as const,
              configuredEndpoint: null,
            },
          },
        ],
      };
    }
  });
