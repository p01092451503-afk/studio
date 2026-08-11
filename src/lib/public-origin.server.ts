/**
 * ARK(Seedance) 가 참고 이미지를 받아갈 때 쓸 "외부에서 인증 없이 접근 가능한" origin 을 만든다.
 *
 * - id-preview--<id>.lovable.app 는 Lovable 로그인 브리지로 302 리다이렉트되므로 ARK 가 이미지를 못 받는다.
 *   → 항상 stable preview 도메인(project--<id>-dev.lovable.app)으로 치환한다.
 * - <slug>.lovable.app 는 커스텀 도메인으로 302 되므로, 리다이렉트를 따르지 못하는 클라이언트를 위해
 *   요청 origin 을 그대로 쓰되 preview 케이스만 교정한다.
 */
export function toPublicFetchOrigin(requestOrigin: string): string {
  try {
    const url = new URL(requestOrigin);
    const host = url.hostname;

    const previewMatch = host.match(/^id-preview--(.+)\.lovable\.app$/);
    if (previewMatch) {
      return `https://project--${previewMatch[1]}-dev.lovable.app`;
    }

    const projectMatch = host.match(/^([0-9a-f-]{36})\.lovableproject\.com$/i);
    if (projectMatch) {
      return `https://project--${projectMatch[1]}-dev.lovable.app`;
    }

    return url.origin;
  } catch {
    return requestOrigin;
  }
}

export async function getPublicFetchOrigin(): Promise<string> {
  const { getRequestUrl } = await import("@tanstack/react-start/server");
  // 배포 프록시 뒤에서는 내부 Host 가 localhost:8080으로 보일 수 있다.
  // x-forwarded-host를 사용해야 외부에서 실제 접근 가능한 프로젝트 도메인을 얻는다.
  return toPublicFetchOrigin(
    new URL(getRequestUrl({ xForwardedHost: true, xForwardedProto: true })).origin,
  );
}
