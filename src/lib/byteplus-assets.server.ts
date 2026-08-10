// Server-only helpers for the BytePlus (Volcengine) Assets / Private Portrait Library API.
// These endpoints use AK/SK Signature V4 signing, NOT the ARK bearer API key.
// This file must NOT be imported from client code.

export type SignedCallResult = {
  ok: boolean;
  status: number;
  action: string;
  host: string;
  region: string;
  service: string;
  body: string;
  requestId?: string;
  errorCode?: string;
  errorMessage?: string;
};

const encoder = new TextEncoder();

function toHex(buffer: ArrayBuffer): string {
  return [...new Uint8Array(buffer)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function sha256Hex(input: string): Promise<string> {
  return toHex(await crypto.subtle.digest("SHA-256", encoder.encode(input)));
}

async function hmac(key: ArrayBuffer | Uint8Array, data: string): Promise<ArrayBuffer> {
  const cryptoKey = await crypto.subtle.importKey(
    "raw",
    key as ArrayBuffer,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  return crypto.subtle.sign("HMAC", cryptoKey, encoder.encode(data));
}

export function bytePlusAssetsEnv() {
  const ak = (process.env["BYTEPLUS_ACCESS_KEY"] ?? "").trim();
  const sk = (process.env["BYTEPLUS_SECRET_KEY"] ?? "").trim();
  const host = (process.env["BYTEPLUS_ASSETS_HOST"] ?? "open.byteplusapi.com").trim();
  const region = (process.env["BYTEPLUS_ASSETS_REGION"] ?? "ap-southeast-1").trim();
  const service = (process.env["BYTEPLUS_ASSETS_SERVICE"] ?? "ark").trim();
  if (!ak || !sk) {
    throw new Error(
      "BYTEPLUS_AK_SK_MISSING: BYTEPLUS_ACCESS_KEY / BYTEPLUS_SECRET_KEY 시크릿이 설정되지 않았습니다.",
    );
  }
  return { ak, sk, host, region, service };
}

/**
 * Volcengine/BytePlus Signature V4 (HMAC-SHA256) signed request.
 * Query-style top-level API: Action + Version are query parameters.
 */
export async function callSignedBytePlusApi(params: {
  action: string;
  version: string;
  method?: "GET" | "POST";
  query?: Record<string, string>;
  body?: unknown;
}): Promise<SignedCallResult> {
  const { ak, sk, host, region, service } = bytePlusAssetsEnv();
  const method = params.method ?? "POST";

  const query: Record<string, string> = {
    Action: params.action,
    Version: params.version,
    ...(params.query ?? {}),
  };
  const canonicalQuery = Object.keys(query)
    .sort()
    .map((k) => `${encodeURIComponent(k)}=${encodeURIComponent(query[k]!)}`)
    .join("&");

  const payload = method === "GET" ? "" : JSON.stringify(params.body ?? {});
  const payloadHash = await sha256Hex(payload);

  const now = new Date();
  const amzDate = now.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
  const shortDate = amzDate.slice(0, 8);

  const signedHeaderNames = ["content-type", "host", "x-content-sha256", "x-date"];
  const headerValues: Record<string, string> = {
    "content-type": "application/json; charset=utf-8",
    host,
    "x-content-sha256": payloadHash,
    "x-date": amzDate,
  };
  const canonicalHeaders = signedHeaderNames.map((n) => `${n}:${headerValues[n]}\n`).join("");
  const signedHeaders = signedHeaderNames.join(";");

  const canonicalRequest = [
    method,
    "/",
    canonicalQuery,
    canonicalHeaders,
    signedHeaders,
    payloadHash,
  ].join("\n");

  const credentialScope = `${shortDate}/${region}/${service}/request`;
  const stringToSign = [
    "HMAC-SHA256",
    amzDate,
    credentialScope,
    await sha256Hex(canonicalRequest),
  ].join("\n");

  let signingKey = await hmac(encoder.encode(sk), shortDate);
  signingKey = await hmac(signingKey, region);
  signingKey = await hmac(signingKey, service);
  signingKey = await hmac(signingKey, "request");
  const signature = toHex(await hmac(signingKey, stringToSign));

  const authorization = `HMAC-SHA256 Credential=${ak}/${credentialScope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;

  const res = await fetch(`https://${host}/?${canonicalQuery}`, {
    method,
    headers: {
      "Content-Type": headerValues["content-type"]!,
      "X-Date": amzDate,
      "X-Content-Sha256": payloadHash,
      Authorization: authorization,
    },
    ...(method === "GET" ? {} : { body: payload }),
  });

  const text = await res.text().catch(() => "");
  let errorCode: string | undefined;
  let errorMessage: string | undefined;
  let requestId: string | undefined;
  try {
    const json = JSON.parse(text) as {
      ResponseMetadata?: { RequestId?: string; Error?: { Code?: string; Message?: string } };
    };
    requestId = json.ResponseMetadata?.RequestId;
    errorCode = json.ResponseMetadata?.Error?.Code;
    errorMessage = json.ResponseMetadata?.Error?.Message;
  } catch {
    /* non-JSON response */
  }

  return {
    ok: res.ok && !errorCode,
    status: res.status,
    action: params.action,
    host,
    region,
    service,
    body: text.slice(0, 2000),
    requestId,
    errorCode,
    errorMessage,
  };
}

/** 자산 라이브러리 목록 조회로 AK/SK 서명 인증이 동작하는지 확인한다. */
export async function probeBytePlusAssets(): Promise<SignedCallResult> {
  return callSignedBytePlusApi({
    action: process.env["BYTEPLUS_ASSETS_LIST_ACTION"] ?? "ListAssetGroups",
    version: process.env["BYTEPLUS_ASSETS_VERSION"] ?? "2024-01-01",
    method: "POST",
    body: { PageNumber: 1, PageSize: 10 },
  });
}
