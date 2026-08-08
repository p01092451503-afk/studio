/**
 * 히스토리 영상 로딩 병목 확인용 경량 계측 모듈.
 * - 서명 URL 발급(배치/캐시 히트), 포스터 로드, 동영상 로드 단계를 각각 기록한다.
 * - 콘솔에 단계별 소요시간을 남기고, window.__mediaPerf() 로 누적 요약을 볼 수 있다.
 */

type Stage = "signed_url" | "poster" | "video";

type StageStat = {
  count: number;
  totalMs: number;
  maxMs: number;
  errors: number;
};

type PerfState = {
  stages: Record<Stage, StageStat>;
  cache: { hits: number; misses: number; inflight: number };
  batches: { count: number; paths: number; totalMs: number; failures: number };
};

const emptyStage = (): StageStat => ({ count: 0, totalMs: 0, maxMs: 0, errors: 0 });

const state: PerfState = {
  stages: { signed_url: emptyStage(), poster: emptyStage(), video: emptyStage() },
  cache: { hits: 0, misses: 0, inflight: 0 },
  batches: { count: 0, paths: 0, totalMs: 0, failures: 0 },
};

const DEBUG_KEY = "media-perf-debug";

function isVerbose() {
  if (typeof window === "undefined") return false;
  try {
    return window.localStorage.getItem(DEBUG_KEY) === "1";
  } catch {
    return false;
  }
}

function now() {
  return typeof performance !== "undefined" ? performance.now() : Date.now();
}

function short(path: string) {
  return path.length > 48 ? `…${path.slice(-48)}` : path;
}

export function markStage(stage: Stage, ms: number, meta?: { path?: string; error?: boolean }) {
  const s = state.stages[stage];
  s.count += 1;
  s.totalMs += ms;
  s.maxMs = Math.max(s.maxMs, ms);
  if (meta?.error) s.errors += 1;
  if (isVerbose()) {
    console.info(
      `[media-perf] ${stage}${meta?.error ? " (error)" : ""} ${ms.toFixed(0)}ms`,
      meta?.path ? short(meta.path) : "",
    );
  }
}

export function startStage(stage: Stage, path?: string) {
  const t0 = now();
  let done = false;
  return (error = false) => {
    if (done) return 0;
    done = true;
    const ms = now() - t0;
    markStage(stage, ms, { path, error });
    return ms;
  };
}

export function markCacheHit() {
  state.cache.hits += 1;
}

export function markCacheMiss() {
  state.cache.misses += 1;
}

export function markInflightJoin() {
  state.cache.inflight += 1;
}

export function markSignBatch(paths: number, ms: number, failed = false) {
  state.batches.count += 1;
  state.batches.paths += paths;
  state.batches.totalMs += ms;
  if (failed) state.batches.failures += 1;
  if (isVerbose()) {
    console.info(
      `[media-perf] sign batch ${paths} path(s) ${ms.toFixed(0)}ms${failed ? " FAILED" : ""}`,
    );
  }
}

function avg(total: number, count: number) {
  return count ? Number((total / count).toFixed(1)) : 0;
}

export function getMediaPerfSummary() {
  const lookups = state.cache.hits + state.cache.misses + state.cache.inflight;
  return {
    signedUrl: {
      count: state.stages.signed_url.count,
      avgMs: avg(state.stages.signed_url.totalMs, state.stages.signed_url.count),
      maxMs: Number(state.stages.signed_url.maxMs.toFixed(1)),
      errors: state.stages.signed_url.errors,
    },
    poster: {
      count: state.stages.poster.count,
      avgMs: avg(state.stages.poster.totalMs, state.stages.poster.count),
      maxMs: Number(state.stages.poster.maxMs.toFixed(1)),
      errors: state.stages.poster.errors,
    },
    video: {
      count: state.stages.video.count,
      avgMs: avg(state.stages.video.totalMs, state.stages.video.count),
      maxMs: Number(state.stages.video.maxMs.toFixed(1)),
      errors: state.stages.video.errors,
    },
    cache: {
      ...state.cache,
      lookups,
      hitRate: lookups ? `${((state.cache.hits / lookups) * 100).toFixed(1)}%` : "0%",
    },
    signBatches: {
      count: state.batches.count,
      paths: state.batches.paths,
      avgMs: avg(state.batches.totalMs, state.batches.count),
      failures: state.batches.failures,
      avgPathsPerBatch: avg(state.batches.paths, state.batches.count),
    },
  };
}

export function resetMediaPerf() {
  state.stages.signed_url = emptyStage();
  state.stages.poster = emptyStage();
  state.stages.video = emptyStage();
  state.cache = { hits: 0, misses: 0, inflight: 0 };
  state.batches = { count: 0, paths: 0, totalMs: 0, failures: 0 };
}

if (typeof window !== "undefined") {
  const w = window as unknown as Record<string, unknown>;
  w["__mediaPerf"] = () => {
    const summary = getMediaPerfSummary();
    console.table({
      "서명 URL": summary.signedUrl,
      포스터: summary.poster,
      동영상: summary.video,
    });
    console.info("[media-perf] cache", summary.cache, "batches", summary.signBatches);
    return summary;
  };
  w["__mediaPerfReset"] = resetMediaPerf;
  w["__mediaPerfVerbose"] = (on = true) => {
    try {
      if (on) window.localStorage.setItem(DEBUG_KEY, "1");
      else window.localStorage.removeItem(DEBUG_KEY);
    } catch {
      /* ignore */
    }
    return on;
  };
}
