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

export function assertPublicFetchUrl(rawUrl: string): void {
  const url = new URL(rawUrl);
  const host = url.hostname.toLowerCase();
  const isPrivateIpv4 =
    /^10\./.test(host) ||
    /^127\./.test(host) ||
    /^192\.168\./.test(host) ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(host);
  if (
    url.protocol !== "https:" ||
    host === "localhost" ||
    host === "0.0.0.0" ||
    host === "::1" ||
    isPrivateIpv4
  ) {
    throw new Error(`REF_PUBLIC_ORIGIN_UNRESOLVED: ${url.origin}`);
  }
}

export async function getPublicFetchOrigin(): Promise<string> {
  const { getRequestHeader, getRequestUrl } = await import("@tanstack/react-start/server");
  // 배포 프록시 뒤에서는 내부 Host 가 localhost:8080으로 보일 수 있다.
  // x-forwarded-host를 사용해야 외부에서 실제 접근 가능한 프로젝트 도메인을 얻는다.
  const forwardedOrigin = new URL(
    getRequestUrl({ xForwardedHost: true, xForwardedProto: true }),
  ).origin;
  const forwardedHost = new URL(forwardedOrigin).hostname;
  if (forwardedHost !== "localhost" && forwardedHost !== "127.0.0.1") {
    return toPublicFetchOrigin(forwardedOrigin);
  }

  // 서버 함수의 내부 RPC가 forwarded host도 localhost로 덮는 환경에서는
  // 브라우저가 보낸 Origin/Referer가 실제 공개 프로젝트 주소다.
  const browserOrigin = getRequestHeader("origin");
  if (browserOrigin) return toPublicFetchOrigin(new URL(browserOrigin).origin);

  const referer = getRequestHeader("referer");
  if (referer) return toPublicFetchOrigin(new URL(referer).origin);

  const previewHost = process.env["LOVABLE_PREVIEW_HOST"]?.trim();
  if (previewHost) {
    const previewOrigin = previewHost.includes("://") ? previewHost : `https://${previewHost}`;
    return toPublicFetchOrigin(new URL(previewOrigin).origin);
  }

  throw new Error(`REF_PUBLIC_ORIGIN_UNRESOLVED: ${forwardedOrigin}`);
}
