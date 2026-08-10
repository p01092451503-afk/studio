import { useCallback, useEffect, useRef, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { supabase } from "@/integrations/supabase/client";
import { startVideoGeneration, pollVideoGeneration } from "@/lib/video.functions";
import { recoverStaleServerFunction } from "@/lib/server-function-recovery";

export type VideoResult = {
  id: string;
  seq: number;
  storage_path: string;
  poster_path: string | null;
  duration_seconds: number | null;
};

export type VideoGenerationRow = {
  id: string;
  status: string;
  error_message: string | null;
  final_prompt: string | null;
  task_id: string | null;
  options: Record<string, unknown> | null;
  results: VideoResult[];
};

const STORAGE_KEY = "pilotstudio.video.running";

function readStoredId(): string | null {
  if (typeof window === "undefined") return null;
  try {
    return window.sessionStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
}

function writeStoredId(id: string | null) {
  if (typeof window === "undefined") return;
  try {
    if (id) window.sessionStorage.setItem(STORAGE_KEY, id);
    else window.sessionStorage.removeItem(STORAGE_KEY);
  } catch {
    /* storage unavailable */
  }
}

export function useVideoGeneration(tenantId: string | null) {
  const startFn = useServerFn(startVideoGeneration);
  const pollFn = useServerFn(pollVideoGeneration);
  const [currentId, setCurrentId] = useState<string | null>(null);
  const [row, setRow] = useState<VideoGenerationRow | null>(null);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [recoveryNotice, setRecoveryNotice] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Resume a job that was still running before this component remounted.
  useEffect(() => {
    const stored = readStoredId();
    if (stored) {
      setCurrentId(stored);
      setRunning(true);
    }
  }, []);


  const load = useCallback(async (id: string) => {
    const { data } = await supabase
      .from("video_generations")
      .select(
        "id, status, error_message, final_prompt, task_id, options, video_results(id, seq, storage_path, poster_path, duration_seconds)",
      )
      .eq("id", id)
      .maybeSingle();
    if (!data) return null;
    const next: VideoGenerationRow = {
      id: data.id,
      status: data.status,
      error_message: data.error_message,
      final_prompt: data.final_prompt,
      task_id: (data as any).task_id ?? null,
      options:
        data.options && typeof data.options === "object" && !Array.isArray(data.options)
          ? (data.options as Record<string, unknown>)
          : null,
      results: ((data as any).video_results ?? []).sort((a: any, b: any) => a.seq - b.seq),
    };
    setRow(next);
    return next;
  }, []);

  // Poll the running task until it finishes.
  useEffect(() => {
    if (!currentId) return;
    let cancelled = false;

    const tick = async () => {
      if (cancelled) return;
      try {
        const res = await pollFn({ data: { videoGenerationId: currentId } });
        if ("recoveryNotice" in res) setRecoveryNotice(res.recoveryNotice ?? null);
        if ("taskStates" in res && Array.isArray(res.taskStates)) {
          setTaskStates(res.taskStates as TaskStateInfo[]);
        }
        await load(currentId);
        if (res.status === "running") {
          timer.current = setTimeout(tick, 5000);
          return;
        }
        setRunning(false);
        writeStoredId(null);
        if (res.status === "error") setError(res.error ?? "VIDEO_FAILED");
      } catch (e) {
        if (cancelled) return;
        // 어떤 경우든 진행중 세션은 정리한다 (히스토리에 running 이 남는 문제 방지)
        setRunning(false);
        writeStoredId(null);
        if (recoverStaleServerFunction(e)) return;
        setError(e instanceof Error ? e.message : String(e));
      }
    };

    load(currentId);
    timer.current = setTimeout(tick, 4000);
    return () => {
      cancelled = true;
      if (timer.current) clearTimeout(timer.current);
    };
  }, [currentId, pollFn, load]);

  async function run(input: Parameters<typeof startVideoGeneration>[0] extends undefined ? any : any) {
    if (!tenantId) throw new Error("NO_TENANT");
    setRunning(true);
    setError(null);
    setRecoveryNotice(null);
    setRow(null);
    setCurrentId(null);
    try {
      const res = await startFn({ data: input });
      setRecoveryNotice(res.recoveryNotice ?? null);
      if (res.status === "error") {
        // 공급자 거부(민감정보 등): 흰 화면 대신 화면에 사유를 표시한다.
        setError(res.error ?? "VIDEO_FAILED");
        setRunning(false);
        writeStoredId(null);
        await load(res.videoGenerationId);
        return res;
      }
      writeStoredId(res.videoGenerationId);
      setCurrentId(res.videoGenerationId);
      return res;
    } catch (e) {
      setRunning(false);
      writeStoredId(null);
      if (recoverStaleServerFunction(e)) return;
      setError(e instanceof Error ? e.message : String(e));
      throw e;
    }
  }


  return { run, running, row, currentId, error, recoveryNotice };
}
