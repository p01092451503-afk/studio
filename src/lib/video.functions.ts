import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import type { VideoTaskState } from "@/lib/video.server";

export type TaskStateInfo = {
  taskId: string;
  status: "queued" | "running" | "succeeded" | "failed" | "cancelled";
  error?: string | null;
};

const startSchema = z.object({
  workLabel: z.string().default("V1"),
  /** 영상 생성 프로바이더. 기본 엔진은 Seedance 2.0이다. */
  provider: z.enum(["auto", "seedance"]).default("seedance"),
  mode: z.enum(["t2v", "i2v"]).default("t2v"),

  finalPrompt: z.string().min(1).max(4000),
  negativePrompt: z.string().max(2000).optional(),
  rawPrompt: z.string().max(4000).optional(),
  promptEdited: z.boolean().default(false),
  aspectRatio: z.string().default("16:9"),
  resolution: z.enum(["480p", "720p", "1080p"]).default("720p"),
  durationSeconds: z.number().int().min(3).max(12).default(10),
  outputQuantity: z.number().int().min(1).max(4).default(1),
  generateAudio: z.boolean().default(true),
  cameraFixed: z.boolean().default(false),
  seed: z.number().int().nullable().optional(),
  /** character-refs 버킷의 참고 이미지 및 영상 추출 프레임. 1개면 시작 프레임, 여러 개면 모두 참고 미디어다. */
  imagePaths: z.array(z.string()).max(8).default([]),
  options: z.record(z.any()).default({}),
});

export const startVideoGeneration = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((data: unknown) => startSchema.parse(data))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;

    const { data: profile } = await supabase
      .from("profiles")
      .select("tenant_id")
      .eq("id", userId)
      .maybeSingle();
    if (!profile?.tenant_id) throw new Error("UNAUTHORIZED_NO_TENANT");
    const tenantId = profile.tenant_id as string;

    const prompt = (data.rawPrompt?.trim() || data.finalPrompt.trim());
    const { DEFAULT_VIDEO_NEGATIVE_PROMPT } = await import("@/lib/video-constants");
    const negativePrompt = data.negativePrompt?.trim() || DEFAULT_VIDEO_NEGATIVE_PROMPT;
    if (!prompt) throw new Error("EMPTY_PROMPT");

    // 사전 검열 없음: 프롬프트는 Seedance(ARK) 로 그대로 전달되고,
    // 안전성 판단은 공급자(Seedance) 심사에만 맡긴다.
    const moderation = { status: "approved" as const, reason: null, categories: [] as string[], skipped: true };


    const seed = data.seed ?? null;

    const { data: row, error: insErr } = await supabase
      .from("video_generations")
      .insert({
        tenant_id: tenantId,
        user_id: userId,
        work_label: data.workLabel,
        status: "running",
        mode: data.mode,
        final_prompt: prompt,
        negative_prompt: negativePrompt,
        raw_prompt: data.rawPrompt ?? null,
        prompt_edited: data.promptEdited,
        aspect_ratio: data.aspectRatio,
        resolution: data.resolution,
        duration_seconds: data.durationSeconds,
        camera_fixed: data.cameraFixed,
        seed,
        image_paths: data.imagePaths,
        options: data.options,
        moderation_status: moderation.status,
        moderation_details: moderation,
      })
      .select("id")
      .single();
    if (insErr || !row) throw new Error(`DB_INSERT_VIDEO_FAILED: ${insErr?.message ?? ""}`);
    const videoId = row.id as string;

    const refPublicKeys: string[] = [];
    try {
      const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
      const { getRequestUrl } = await import("@tanstack/react-start/server");
      const origin = new URL(getRequestUrl()).origin;

      // ARK 는 토큰 없는 공개 URL 만 안정적으로 fetch 하므로, 참고 미디어의 임시 사본을
      // 공개 엔드포인트(/api/public/seedance-ref/*)에서 서빙되는 키로 복사한다.
      const publicUrls: string[] = [];
      for (const p of data.imagePaths) {
        const { data: blob, error: dErr } = await supabaseAdmin.storage.from("character-refs").download(p);
        if (dErr || !blob) throw new Error(`REF_DOWNLOAD_FAILED: ${p}`);
        const ext = p.split(".").pop() || "png";
        const key = `${tenantId}/${videoId}/${crypto.randomUUID()}.${ext}`;
        const bytes = new Uint8Array(await blob.arrayBuffer());
        const { error: uErr } = await supabaseAdmin.storage
          .from("seedance-refs")
          .upload(key, bytes, { contentType: blob.type || "image/png", upsert: true });
        if (uErr) throw new Error(`REF_PUBLIC_UPLOAD_FAILED: ${key}`);
        refPublicKeys.push(key);
        publicUrls.push(`${origin}/api/public/seedance-ref/${key}`);
      }
      console.info("[seedance-ref-public-urls]", { videoId, publicUrls });

      const provider = "seedance";
      let taskId: string;
      let model: string;
      let modelVersion: string | null;

      console.info("[video-generation-dispatch]", {
        videoGenerationId: videoId,
        provider,
        mode: data.mode,
        prompt,
        negative_prompt: negativePrompt,
      });

      const { buildSeedanceText, createVideoTask } = await import("@/lib/video.server");
      const useFirstFrame = publicUrls.length === 1;
      const firstFrameUrl = useFirstFrame ? publicUrls[0] : null;
      const referenceImageUrls = useFirstFrame ? [] : publicUrls;
      const taskIds: string[] = [];
      let startedModel = "";
      for (let index = 0; index < data.outputQuantity; index += 1) {
        const started = await createVideoTask({
          text: buildSeedanceText({
            prompt,
            aspectRatio: data.aspectRatio,
            resolution: data.resolution,
            durationSeconds: data.durationSeconds,
            cameraFixed: data.cameraFixed,
            seed,
            hasFirstFrame: useFirstFrame,
          }),
          firstFrameUrl,
          referenceImageUrls,
          aspectRatio: data.aspectRatio,
          resolution: data.resolution,
          durationSeconds: data.durationSeconds,
          generateAudio: data.generateAudio,
        });
        taskIds.push(started.taskId);
        startedModel = started.model;
      }
      taskId = taskIds[0];
      model = startedModel;
      modelVersion = null;

      await supabase
        .from("video_generations")
        .update({
          task_id: taskId,
          api_model: model,
          api_model_version: modelVersion,
           options: {
             ...data.options,
             selectedProvider: provider,
             fallbackUsed: false,
              taskIds,
              outputQuantity: data.outputQuantity,
              generateAudio: data.generateAudio,
              refPublicKeys,
           },
        })
        .eq("id", videoId);

      return { videoGenerationId: videoId, status: "running" as const, error: null as string | null, recoveryNotice: null };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const { formatVideoFailureReport } = await import("@/lib/video-errors");
      const friendly = formatVideoFailureReport(message, {
        stage: "request",
        model: process.env.ARK_VIDEO_ENDPOINT_ID ?? process.env.ARK_VIDEO_MODEL_ID ?? null,
        mode: data.imagePaths.length === 1 ? "first_frame (시작 프레임)" : data.imagePaths.length > 1 ? "reference_media (참고 미디어)" : "t2v (텍스트만)",
        aspectRatio: data.aspectRatio,
        resolution: data.resolution,
        durationSeconds: data.durationSeconds,
        referenceCount: data.imagePaths.length,
      });

      await supabase
        .from("video_generations")
        .update({
          status: "error",
          error_message: friendly.slice(0, 2000),
          completed_at: new Date().toISOString(),
        })
        .eq("id", videoId);
      // 오류를 throw 하면 클라이언트가 흰 화면으로 죽으므로 결과로 반환한다.
      return { videoGenerationId: videoId, status: "error" as const, error: friendly, recoveryNotice: null };
    }
  });

const pollSchema = z.object({ videoGenerationId: z.string().uuid() });

export const pollVideoGeneration = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((data: unknown) => pollSchema.parse(data))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;

    const { data: row } = await supabase
      .from("video_generations")
      .select("id, tenant_id, status, task_id, duration_seconds, error_message, moderation_status, options, aspect_ratio, resolution, api_model, image_paths, mode")
      .eq("id", data.videoGenerationId)
      .maybeSingle();
    if (!row) throw new Error("VIDEO_NOT_FOUND");
    if (row.status === "done" || row.status === "error") {
      return {
        status: row.status as "done" | "error",
        error: row.error_message,
        taskStates: row.task_id
          ? [{ taskId: row.task_id, status: row.status === "done" ? "succeeded" : "failed" }]
          : [],
      };
    }
    if (!row.task_id)
      return { status: "running" as const, error: null, taskStates: [] as TaskStateInfo[] };

    const { getVideoTask } = await import("@/lib/video.server");
    let state: VideoTaskState;
    let taskStates: TaskStateInfo[] = [];
    try {
      if (row.task_id.startsWith("replicate:") || row.task_id.startsWith("lovable:")) {
        throw new Error("LEGACY_VIDEO_PROVIDER_UNSUPPORTED: Start a new Seedance 2.0 generation.");
      }
      const options = row.options && typeof row.options === "object" && !Array.isArray(row.options)
        ? row.options as Record<string, unknown>
        : {};
      const storedTaskIds = Array.isArray(options.taskIds)
        ? options.taskIds.filter((value): value is string => typeof value === "string")
        : [];
      const taskIds = storedTaskIds.length ? storedTaskIds : [row.task_id];
      const states = await Promise.all(taskIds.map((taskId) => getVideoTask(taskId)));
      taskStates = taskIds.map((taskId, i) => ({
        taskId,
        status: states[i]?.status ?? "queued",
        error: states[i]?.error ?? null,
      }));
      const failed = states.find((item) => item.status === "failed" || item.status === "cancelled");
      const pending = states.some((item) => item.status === "queued" || item.status === "running");
      state = failed ?? (pending
        ? { status: "running" }
        : { status: "succeeded", videoUrl: states.map((item) => item.videoUrl).filter(Boolean).join("\n") });
    } catch (pollError) {
      const reason = pollError instanceof Error ? pollError.message : String(pollError);
      state = { status: "failed", error: reason };
      taskStates = [{ taskId: row.task_id, status: "failed", error: reason }];
    }

    if (state.status === "queued" || state.status === "running") {
      return { status: "running" as const, error: null, recoveryNotice: null, taskStates };
    }

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { formatVideoFailureReport } = await import("@/lib/video-errors");

    // 작업이 확정된 시점(done/error)에만 ARK 전송용 임시 공개 사본을 정리한다.
    const rowOptions = row.options && typeof row.options === "object" && !Array.isArray(row.options)
      ? (row.options as Record<string, unknown>)
      : {};
    const refPublicKeys = Array.isArray(rowOptions.refPublicKeys)
      ? rowOptions.refPublicKeys.filter((v): v is string => typeof v === "string")
      : [];
    const cleanupRefs = async () => {
      if (!refPublicKeys.length) return;
      try {
        await supabaseAdmin.storage.from("seedance-refs").remove(refPublicKeys);
      } catch (e) {
        console.warn("[seedance-ref-cleanup-failed]", e);
      }
    };

    const failureContext = {
      model: row.api_model ?? null,
      mode: row.mode ?? null,
      aspectRatio: row.aspect_ratio ?? null,
      resolution: row.resolution ?? null,
      durationSeconds: row.duration_seconds ?? null,
      referenceCount: Array.isArray(row.image_paths) ? row.image_paths.length : null,
      taskId: row.task_id,
    };

    if (state.status !== "succeeded" || !state.videoUrl) {
      const message = state.error ?? `VIDEO_TASK_${state.status.toUpperCase()}`;
      const friendly = formatVideoFailureReport(message, { stage: "polling", ...failureContext });

      await supabaseAdmin
        .from("video_generations")
        .update({
          status: "error",
          error_message: friendly.slice(0, 2000),
          completed_at: new Date().toISOString(),
        })
        .eq("id", row.id);
      return { status: "error" as const, error: friendly, recoveryNotice: null, taskStates };
    }

    try {
      const { readMp4Metadata } = await import("@/lib/mp4-metadata.server");
      const videoUrls = state.videoUrl.split("\n").filter(Boolean);
      const measured = [];
      for (let index = 0; index < videoUrls.length; index += 1) {
        const res = await fetch(videoUrls[index]);
        if (!res.ok) throw new Error(`FETCH_VIDEO_FAILED: ${res.status}`);
        const bytes = new Uint8Array(await res.arrayBuffer());
        const metadata = readMp4Metadata(bytes);
        measured.push(metadata);
        const storagePath = `${row.tenant_id}/video/${row.id}/${index}.mp4`;
        const { error: upErr } = await supabaseAdmin.storage
          .from("generation-outputs")
          .upload(storagePath, bytes, { contentType: "video/mp4", upsert: true });
        if (upErr) throw new Error(`STORAGE_UPLOAD_FAILED: ${upErr.message}`);
        await supabaseAdmin.from("video_results").insert({
          video_generation_id: row.id,
          seq: index,
          storage_path: storagePath,
          source_url: null,
          duration_seconds: metadata.durationSeconds,
          width: metadata.width,
          height: metadata.height,
          moderation_status: row.moderation_status === "approved" ? "approved" : "failed",
          metadata: { measured: true, requestedDurationSeconds: row.duration_seconds },
        });
      }
      const metadata = measured[0];
      if (!metadata) throw new Error("VIDEO_RESULT_MISSING");

      await supabaseAdmin
        .from("video_generations")
        .update({
          status: "done",
          actual_resolution: metadata.resolution,
          actual_duration_seconds: metadata.durationSeconds,
          completed_at: new Date().toISOString(),
        })
        .eq("id", row.id);

      void userId;
      return { status: "done" as const, error: null, taskStates };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const friendly = formatVideoFailureReport(message, { stage: "download", ...failureContext });

      await supabaseAdmin
        .from("video_generations")
        .update({
          status: "error",
          error_message: friendly.slice(0, 2000),
          completed_at: new Date().toISOString(),
        })
        .eq("id", row.id);
      return { status: "error" as const, error: friendly, taskStates };
    }
  });
