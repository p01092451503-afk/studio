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
    body: {
      Filter: { GroupType: "AIGC" },
      PageNumber: 1,
      PageSize: 10,
    },
  });
}

export type BytePlusAssetGroup = {
  groupId: string;
  groupName: string;
  groupType: string;
};

export type BytePlusAsset = {
  assetId: string;
  assetName: string;
  assetType: "image" | "video" | "audio" | string;
  url?: string;
  thumbnailUrl?: string;
};

function parseResult<T>(body: string): { Result?: T } {
  try {
    return JSON.parse(body) as { Result?: T };
  } catch {
    return {};
  }
}

/** 그룹(AssetGroup) 목록을 조회한다. */
export async function listBytePlusAssetGroups(): Promise<{ groups: BytePlusAssetGroup[]; raw: string }> {
  const result = await callSignedBytePlusApi({
    action: process.env["BYTEPLUS_ASSETS_LIST_ACTION"] ?? "ListAssetGroups",
    version: process.env["BYTEPLUS_ASSETS_VERSION"] ?? "2024-01-01",
    method: "POST",
    body: { Filter: { GroupType: "AIGC" }, PageNumber: 1, PageSize: 100 },
  });
  if (!result.ok) {
    throw new Error(result.errorCode ? `${result.errorCode}: ${result.errorMessage}` : `HTTP ${result.status}`);
  }
  const json = parseResult<{ GroupList?: Array<{ GroupId?: string; GroupName?: string; GroupType?: string }> }>(result.body);
  const groups = (json.Result?.GroupList ?? [])
    .map((group) => ({
      groupId: group.GroupId ?? "",
      groupName: group.GroupName ?? "",
      groupType: group.GroupType ?? "",
    }))
    .filter((group) => group.groupId);
  return { groups, raw: result.body };
}

/** 특정 그룹에 속한 자산(Asset) 목록을 조회한다. */
export async function listBytePlusAssets(groupId: string): Promise<{ assets: BytePlusAsset[]; raw: string }> {
  const listAction = process.env["BYTEPLUS_ASSETS_LIST_CHILD_ACTION"] ?? "ListAssets";
  const result = await callSignedBytePlusApi({
    action: listAction,
    version: process.env["BYTEPLUS_ASSETS_VERSION"] ?? "2024-01-01",
    method: "POST",
    body: { Filter: { GroupId: groupId }, PageNumber: 1, PageSize: 100 },
  });
  if (!result.ok) {
    throw new Error(result.errorCode ? `${result.errorCode}: ${result.errorMessage}` : `HTTP ${result.status}`);
  }
  const json = parseResult<{
    AssetList?: Array<{
      AssetId?: string;
      AssetName?: string;
      AssetType?: string;
      Url?: string;
      ThumbnailUrl?: string;
    }>;
  }>(result.body);
  const assets = (json.Result?.AssetList ?? [])
    .map((asset) => ({
      assetId: asset.AssetId ?? "",
      assetName: asset.AssetName ?? "",
      assetType: asset.AssetType ?? "",
      url: asset.Url,
      thumbnailUrl: asset.ThumbnailUrl,
    }))
    .filter((asset) => asset.assetId);
  return { assets, raw: result.body };
}

/** 자산의 원본 URL을 조회한다. BytePlus API 스펙에 맞게 Action을 조정할 수 있다. */
export async function getBytePlusAssetUrl(assetId: string): Promise<{ url: string; raw: string }> {
  const getAction = process.env["BYTEPLUS_ASSETS_GET_ACTION"] ?? "GetAssetInfo";
  const result = await callSignedBytePlusApi({
    action: getAction,
    version: process.env["BYTEPLUS_ASSETS_VERSION"] ?? "2024-01-01",
    method: "POST",
    body: { AssetId: assetId },
  });
  if (!result.ok) {
    throw new Error(result.errorCode ? `${result.errorCode}: ${result.errorMessage}` : `HTTP ${result.status}`);
  }
  const json = parseResult<{ Url?: string; url?: string; AssetUrl?: string; assetUrl?: string; ThumbnailUrl?: string; thumbnailUrl?: string }>(result.body);
  const url =
    json.Result?.Url ??
    json.Result?.url ??
    json.Result?.AssetUrl ??
    json.Result?.assetUrl ??
    json.Result?.ThumbnailUrl ??
    json.Result?.thumbnailUrl ??
    "";
  if (!url) throw new Error("ASSET_URL_NOT_FOUND_IN_RESPONSE");
  return { url, raw: result.body };
}

/** BytePlus 자산을 다운로드하여 tenant의 비공개 Storage 버킷에 저장한다. */
export async function importBytePlusAssetToStorage(
  assetId: string,
  tenantId: string,
  name: string,
): Promise<{ path: string; sourceUrl: string }> {
  const { url: sourceUrl } = await getBytePlusAssetUrl(assetId);
  const download = await fetch(sourceUrl);
  if (!download.ok) {
    throw new Error(`ASSET_DOWNLOAD_FAILED: ${download.status} ${download.statusText}`);
  }
  const blob = await download.blob();
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const safeName = name.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 120);
  const extension = safeName.split(".").pop() || "jpg";
  const baseName = safeName.slice(0, Math.max(0, safeName.lastIndexOf("."))) || "asset";
  const path = `${tenantId}/byteplus-assets/${Date.now()}-${crypto.randomUUID()}-${baseName}.${extension}`;
  const { error } = await supabaseAdmin.storage
    .from("character-refs")
    .upload(path, blob, { contentType: blob.type || "image/jpeg", upsert: false });
  if (error) throw error;
  return { path, sourceUrl };
}

