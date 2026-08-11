import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

/** 자산고 관련 후보 Action 이름을 한 번에 시험 호출한다. */
export const probeAssetActions = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { kind: string; bodyJson?: string }) => data)
  .handler(async ({ data }) => {
    const { probeActions, CANDIDATES } = await import("@/lib/asset-lab.server");
    const list = (CANDIDATES as Record<string, readonly string[]>)[data.kind] ?? [];
    let body: unknown = {};
    if (data.bodyJson && data.bodyJson.trim()) {
      try {
        body = JSON.parse(data.bodyJson);
      } catch {
        return { items: [], error: "Body JSON 파싱 실패" };
      }
    }
    const items = await probeActions([...list], body);
    return { items, error: null as string | null };
  });

/** 임의의 Action/Body 로 AK/SK 서명 호출을 수행한다 (스펙 탐색용). */
export const callAssetApi = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { action: string; version?: string; bodyJson?: string }) => data)
  .handler(async ({ data }) => {
    const { rawSignedCall } = await import("@/lib/asset-lab.server");
    return rawSignedCall(data);
  });

/** 업로드한 참고 이미지를 토큰 없는 공개 URL 로 노출한다. */
export const publishAssetLabRef = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { storagePath: string; tenantId: string }) => data)
  .handler(async ({ data }) => {
    const { publishPublicRef } = await import("@/lib/asset-lab.server");
    try {
      const { url, key } = await publishPublicRef(data.storagePath, data.tenantId);
      return { ok: true as const, url, key, error: null as string | null };
    } catch (e) {
      return {
        ok: false as const,
        url: "",
        key: "",
        error: e instanceof Error ? e.message : String(e),
      };
    }
  });

/** asset:// 참조(또는 공개 URL)로 5초 테스트 영상 태스크를 생성한다. */
export const createAssetLabVideoTask = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { prompt: string; ref: string }) => data)
  .handler(async ({ data }) => {
    const { createVideoTask } = await import("@/lib/video.server");
    try {
      const { taskId, model } = await createVideoTask({
        text: data.prompt,
        referenceImageUrls: data.ref ? [data.ref] : [],
        aspectRatio: "16:9",
        resolution: "720p",
        durationSeconds: 5,
        generateAudio: false,
      });
      return { ok: true as const, taskId, model, error: null as string | null };
    } catch (e) {
      return {
        ok: false as const,
        taskId: "",
        model: "",
        error: e instanceof Error ? e.message : String(e),
      };
    }
  });

/** 테스트 태스크 상태를 조회한다. */
export const getAssetLabVideoTask = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { taskId: string }) => data)
  .handler(async ({ data }) => {
    const { getVideoTask } = await import("@/lib/video.server");
    try {
      const state = await getVideoTask(data.taskId);
      return { ok: true as const, ...state, error: state.error ?? null };
    } catch (e) {
      return {
        ok: false as const,
        status: "failed" as const,
        videoUrl: undefined,
        error: e instanceof Error ? e.message : String(e),
      };
    }
  });
