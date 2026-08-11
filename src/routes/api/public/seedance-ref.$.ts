import { createFileRoute } from "@tanstack/react-router";

/**
 * Seedance(ARK) 가 참고 미디어를 가져갈 수 있는 토큰 없는 공개 엔드포인트.
 * 워크스페이스 정책상 공개 버킷을 만들 수 없어, 비공개 버킷 파일을 이 경로로 스트리밍한다.
 * 키에 UUID 가 포함되어 열거는 사실상 불가능하다.
 */
export const Route = createFileRoute("/api/public/seedance-ref/$")({
  server: {
    handlers: {
      GET: async ({ params }) => {
        const key = (params as { _splat?: string })._splat ?? "";
        if (!key || key.includes("..")) return new Response("Not found", { status: 404 });

        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const { data, error } = await supabaseAdmin.storage.from("seedance-refs").download(key);
        if (error || !data) return new Response("Not found", { status: 404 });

        const bytes = new Uint8Array(await data.arrayBuffer());
        return new Response(bytes, {
          headers: {
            "content-type": data.type || "application/octet-stream",
            "cache-control": "public, max-age=3600",
          },
        });
      },
    },
  },
});
