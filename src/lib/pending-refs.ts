/**
 * 자산고 → 영상 생성 화면으로 참고 미디어를 넘겨주는 임시 보관소.
 * sessionStorage 를 사용하므로 탭을 닫으면 자동으로 비워진다.
 */
export type PendingRef = {
  id: string;
  name: string;
  kind: "image" | "video";
  storagePath: string;
};

const KEY = "pending-video-refs";

export function pushPendingRefs(refs: PendingRef[]) {
  if (typeof window === "undefined" || refs.length === 0) return;
  const current = readPendingRefs();
  const merged = [...current, ...refs].filter(
    (ref, index, all) => all.findIndex((item) => item.id === ref.id) === index,
  );
  window.sessionStorage.setItem(KEY, JSON.stringify(merged.slice(0, 6)));
}

export function readPendingRefs(): PendingRef[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.sessionStorage.getItem(KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as PendingRef[]) : [];
  } catch {
    return [];
  }
}

/** 읽으면서 동시에 비운다(중복 추가 방지). */
export function drainPendingRefs(): PendingRef[] {
  const refs = readPendingRefs();
  if (typeof window !== "undefined") window.sessionStorage.removeItem(KEY);
  return refs;
}
