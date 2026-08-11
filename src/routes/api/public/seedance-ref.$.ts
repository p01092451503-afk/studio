import { createFileRoute } from "@tanstack/react-router";

/**
 * Seedance(ARK) 가 참고 미디어를 가져갈 수 있는 토큰 없는 공개 엔드포인트.
 * 워크스페이스 정책상 공개 버킷을 만들 수 없어, 비공개 버킷 파일을 이 경로로 스트리밍한다.
 * 키에 UUID 가 포함되어 열거는 사실상 불가능하다.
 *
 * ARK 는 HEAD 프리플라이트나 Range 요청을 보낼 수 있으므로 둘 다 지원하고,
 * 워커 메모리/시간을 아끼기 위해 버퍼링 없이 스토리지 응답을 그대로 스트리밍한다.
 */
async function serve(key: string, request: Request, method: "GET" | "HEAD") {
  if (!key || key.includes("..")) return new Response("Not found", { status: 404 });

  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data, error } = await supabaseAdmin.storage.from("seedance-refs").createSignedUrl(key, 3600);
  if (error || !data?.signedUrl) return new Response("Not found", { status: 404 });

  const range = request.headers.get("range");
  const upstream = await fetch(data.signedUrl, {
    method,
    headers: range ? { range } : undefined,
  });
  if (!upstream.ok && upstream.status !== 206) return new Response("Not found", { status: 404 });

  const headers = new Headers();
  const ct = upstream.headers.get("content-type");
  const cl = upstream.headers.get("content-length");
  const cr = upstream.headers.get("content-range");
  headers.set("content-type", ct && ct !== "application/octet-stream" ? ct : guessType(key));
  if (cl) headers.set("content-length", cl);
  if (cr) headers.set("content-range", cr);
  headers.set("accept-ranges", "bytes");
  headers.set("cache-control", "public, max-age=3600");
  headers.set("access-control-allow-origin", "*");

  return new Response(method === "HEAD" ? null : upstream.body, {
    status: upstream.status,
    headers,
  });
}

function guessType(key: string): string {
  const ext = key.split(".").pop()?.toLowerCase() ?? "";
  if (ext === "jpg" || ext === "jpeg") return "image/jpeg";
  if (ext === "png") return "image/png";
  if (ext === "webp") return "image/webp";
  if (ext === "gif") return "image/gif";
  if (ext === "mp4") return "video/mp4";
  return "application/octet-stream";
}

export const Route = createFileRoute("/api/public/seedance-ref/$")({
  server: {
    handlers: {
      GET: async ({ params, request }) => serve((params as { _splat?: string })._splat ?? "", request, "GET"),
      HEAD: async ({ params, request }) => serve((params as { _splat?: string })._splat ?? "", request, "HEAD"),
    },
  },
});
