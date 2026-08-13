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
  const amzDate = now
    .toISOString()
    .replace(/[-:]/g, "")
    .replace(/\.\d{3}/, "");
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
export async function listBytePlusAssetGroups(): Promise<{
  groups: BytePlusAssetGroup[];
  raw: string;
}> {
  const result = await callSignedBytePlusApi({
    action: process.env["BYTEPLUS_ASSETS_LIST_ACTION"] ?? "ListAssetGroups",
    version: process.env["BYTEPLUS_ASSETS_VERSION"] ?? "2024-01-01",
    method: "POST",
    body: { Filter: { GroupType: "AIGC" }, PageNumber: 1, PageSize: 100 },
  });
  if (!result.ok) {
    throw new Error(
      result.errorCode ? `${result.errorCode}: ${result.errorMessage}` : `HTTP ${result.status}`,
    );
  }
  const json = parseResult<{
    GroupList?: Array<{ GroupId?: string; GroupName?: string; GroupType?: string }>;
  }>(result.body);
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
export async function listBytePlusAssets(
  groupId: string,
): Promise<{ assets: BytePlusAsset[]; raw: string }> {
  const listAction = process.env["BYTEPLUS_ASSETS_LIST_CHILD_ACTION"] ?? "ListAssets";
  const result = await callSignedBytePlusApi({
    action: listAction,
    version: process.env["BYTEPLUS_ASSETS_VERSION"] ?? "2024-01-01",
    method: "POST",
    body: { Filter: { GroupId: groupId }, PageNumber: 1, PageSize: 100 },
  });
  if (!result.ok) {
    throw new Error(
      result.errorCode ? `${result.errorCode}: ${result.errorMessage}` : `HTTP ${result.status}`,
    );
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
    throw new Error(
      result.errorCode ? `${result.errorCode}: ${result.errorMessage}` : `HTTP ${result.status}`,
    );
  }
  const json = parseResult<{
    Url?: string;
    url?: string;
    AssetUrl?: string;
    assetUrl?: string;
    ThumbnailUrl?: string;
    thumbnailUrl?: string;
  }>(result.body);
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

// ═══════════════════════════════════════════════════════════════
// 프로덕션 자산고 — 쓰기 경로 (그룹 생성 · 자산 입고 · 실사 인증)
//
// 확정 Action 이름은 진단 콘솔(asset-lab)에서 통과한 값을 .env 로 주입한다.
// 아래 기본값은 가장 유력한 후보이며, 계정 스펙에 맞게 env 로 덮어쓴다.
//   BYTEPLUS_ASSETS_CREATE_GROUP_ACTION   (기본: CreateAssetGroup)
//   BYTEPLUS_ASSETS_INGEST_ACTION         (기본: CreateAsset)
//   BYTEPLUS_ASSETS_REALPERSON_CREATE_ACTION (기본: CreateRealPersonVerifySession)
//   BYTEPLUS_ASSETS_REALPERSON_GET_ACTION    (기본: GetRealPersonVerifySession)
// ═══════════════════════════════════════════════════════════════

const ASSETS_VERSION = process.env["BYTEPLUS_ASSETS_VERSION"] ?? "2024-01-01";

/** 응답 body(JSON 문자열)에서 여러 후보 키를 깊이 탐색해 첫 값을 문자열로 뽑는다. */
function extractField(body: string, keys: string[]): string | null {
  let json: unknown;
  try {
    json = JSON.parse(body);
  } catch {
    return null;
  }
  const visit = (node: unknown): string | null => {
    if (node == null || typeof node !== "object") return null;
    if (Array.isArray(node)) {
      for (const item of node) {
        const found = visit(item);
        if (found) return found;
      }
      return null;
    }
    const record = node as Record<string, unknown>;
    for (const key of keys) {
      if (key in record) {
        const value = record[key];
        if (typeof value === "string" && value) return value;
        if (typeof value === "number" && Number.isFinite(value)) return String(value);
        if (Array.isArray(value) && value.length > 0) return String(value[0]);
      }
    }
    for (const child of Object.values(record)) {
      const found = visit(child);
      if (found) return found;
    }
    return null;
  };
  return visit(json);
}

/** BytePlus 호출 실패 상세(Action/Version/에러코드 등)를 담는 에러. */
export class BytePlusCallError extends Error {
  detail: {
    action: string;
    version: string;
    host: string;
    region: string;
    status: number;
    errorCode?: string;
    errorMessage?: string;
    requestId?: string;
    bodySnippet?: string;
  };
  constructor(message: string, detail: BytePlusCallError["detail"]) {
    super(message);
    this.name = "BytePlusCallError";
    this.detail = detail;
  }
}

/** 원격 자산 그룹을 생성하고 GroupId 를 반환한다. */
export async function createBytePlusAssetGroup(params: {
  name: string;
  kind?: "aigc" | "digital_human";
}): Promise<{ remoteGroupId: string; raw: string }> {
  const action = process.env["BYTEPLUS_ASSETS_CREATE_GROUP_ACTION"] ?? "CreateAssetGroup";
  const groupType = params.kind === "digital_human" ? "DigitalHuman" : "AIGC";
  const result = await callSignedBytePlusApi({
    action,
    version: ASSETS_VERSION,
    method: "POST",
    body: { Name: params.name, GroupName: params.name, GroupType: groupType },
  });
  const detail = {
    action,
    version: ASSETS_VERSION,
    host: result.host,
    region: result.region,
    status: result.status,
    errorCode: result.errorCode,
    errorMessage: result.errorMessage,
    requestId: result.requestId,
    bodySnippet: result.body?.slice(0, 300),
  };
  if (!result.ok) {
    throw new BytePlusCallError(
      result.errorCode ? `${result.errorCode}: ${result.errorMessage}` : `HTTP ${result.status}`,
      detail,
    );
  }
  const remoteGroupId = extractField(result.body, [
    "GroupId",
    "GroupID",
    "AssetGroupId",
    "GroupIdList",
    "GroupIds",
    "GroupIdSet",
    "Id",
  ]);
  if (!remoteGroupId) throw new BytePlusCallError("GROUP_ID_NOT_FOUND_IN_RESPONSE", detail);
  return { remoteGroupId, raw: result.body };
}


/** 공개 URL 이미지를 그룹에 입고하고 AssetId 를 반환한다. */
export async function ingestBytePlusAsset(params: {
  remoteGroupId: string;
  imageUrl: string;
  label: string;
  assetType?: "image" | "video";
}): Promise<{ remoteAssetId: string; raw: string }> {
  const action = process.env["BYTEPLUS_ASSETS_INGEST_ACTION"] ?? "CreateAsset";
  // CreateAsset enum values are case-sensitive: "Image" / "Video".
  // Lowercase values ("image" / "video") are rejected as InvalidParameter.AssetType.
  const remoteAssetType = params.assetType === "video" ? "Video" : "Image";
  const result = await callSignedBytePlusApi({
    action,
    version: ASSETS_VERSION,
    method: "POST",
    body: {
      GroupId: params.remoteGroupId,
      URL: params.imageUrl,
      Name: params.label,
      AssetType: remoteAssetType,
      ProjectName: process.env["BYTEPLUS_ASSETS_PROJECT_NAME"] ?? "default",
    },
  });
  const detail = {
    action,
    version: ASSETS_VERSION,
    host: result.host,
    region: result.region,
    status: result.status,
    errorCode: result.errorCode,
    errorMessage: result.errorMessage,
    requestId: result.requestId,
    bodySnippet: result.body?.slice(0, 300),
  };
  if (!result.ok) {
    throw new BytePlusCallError(
      result.errorCode ? `${result.errorCode}: ${result.errorMessage}` : `HTTP ${result.status}`,
      detail,
    );
  }
  const remoteAssetId = extractField(result.body, [
    "AssetId",
    "AssetID",
    "AssetIdList",
    "AssetIds",
    "AssetIdSet",
    "Id",
    "ID",
    "ResourceId",
    "MaterialId",
    "TaskId",
    "VideoId",
    "ImageId",
  ]);
  if (!remoteAssetId) {
    throw new BytePlusCallError(
      `ASSET_ID_NOT_FOUND_IN_RESPONSE (응답 본문: ${detail.bodySnippet ?? "없음"})`,
      detail,
    );
  }
  return { remoteAssetId, raw: result.body };
}

/** 단일 자산의 입고/처리 상태를 조회한다. (ready 판정용 폴링) */
export async function getBytePlusAssetStatus(
  remoteAssetId: string,
): Promise<{ status: string; thumbnailUrl?: string; raw: string }> {
  const configured = process.env["BYTEPLUS_ASSETS_GET_ACTION"];
  const actions = configured
    ? [configured]
    : ["GetAssetInfo", "GetAsset", "DescribeAsset", "QueryAsset", "GetAssetDetail", "ListAssets"];
  const { result, tried } = await callWithActionFallback({
    actions,
    versions: REALPERSON_VERSIONS,
    body: { AssetId: remoteAssetId },
  });
  if (!result?.ok) {
    const detail = result?.errorCode
      ? `${result.errorCode}: ${result.errorMessage}`
      : `HTTP ${result?.status ?? 0}`;
    // 조회 Action 을 못 찾아도 앱이 죽지 않도록 '알 수 없음' 상태로 되돌린다.
    return {
      status: "unknown",
      raw: `ASSET_STATUS_ACTION_UNSUPPORTED — 시도한 조합: ${tried.join(", ")}. 마지막 응답: ${detail}`,
    };
  }
  const rawStatus =
    extractField(result.body, ["Status", "AssetStatus", "State", "ProcessStatus"]) ?? "";
  const thumbnailUrl =
    extractField(result.body, ["ThumbnailUrl", "thumbnailUrl", "CoverUrl", "Url"]) ?? undefined;
  // 원격 상태 문자열을 로컬 status 로 정규화한다.
  const normalized = /(?:success|ready|done|finish|active|available)/i.test(rawStatus)
    ? "ready"
    : /(?:fail|error|reject)/i.test(rawStatus)
      ? "failed"
      : "ingesting";
  return { status: normalized, thumbnailUrl, raw: result.body };
}


/** Action/Version 조합을 순서대로 시도한다. InvalidActionOrVersion 이면 다음 후보로 넘어간다. */
async function callWithActionFallback(params: {
  actions: string[];
  versions: string[];
  body: unknown;
}): Promise<{ result: SignedCallResult; tried: string[] }> {
  const tried: string[] = [];
  let last: SignedCallResult | null = null;
  for (const version of params.versions) {
    for (const action of params.actions) {
      tried.push(`${action}@${version}`);
      let result: SignedCallResult;
      try {
        result = await callSignedBytePlusApi({ action, version, method: "POST", body: params.body });
      } catch (e) {
        last = {
          ok: false,
          status: 0,
          action,
          host: "-",
          region: "-",
          service: "-",
          body: "",
          errorCode: "LOCAL_ERROR",
          errorMessage: e instanceof Error ? e.message : String(e),
        };
        continue;
      }
      last = result;
      const unsupported =
        /InvalidAction|InvalidVersion|UnknownAction|NotSupport|Could not find operation/i.test(
          `${result.errorCode ?? ""} ${result.errorMessage ?? ""}`,
        );
      if (result.ok || !unsupported) return { result, tried };
    }
  }
  return { result: last as SignedCallResult, tried };
}

const REALPERSON_VERSIONS = [
  ASSETS_VERSION,
  ...["2024-01-01", "2023-11-01", "2022-08-31"].filter((v) => v !== ASSETS_VERSION),
];

/** 실사 인물 인증 세션을 생성한다 — QR(H5) 링크를 배우 휴대폰으로 열어 활체 인증. */
export async function createRealPersonSession(params: {
  remoteGroupId?: string;
}): Promise<{ sessionId: string; h5Link: string; raw: string }> {
  const configured = process.env["BYTEPLUS_ASSETS_REALPERSON_CREATE_ACTION"];
  const actions = configured
    ? [configured]
    : [
        "CreateRealPersonVerifySession",
        "CreateRealPersonSession",
        "CreateVerifySession",
        "CreateRealHumanSession",
        "CreateDigitalHumanVerifySession",
      ];
  const { result, tried } = await callWithActionFallback({
    actions,
    versions: REALPERSON_VERSIONS,
    body: params.remoteGroupId ? { GroupId: params.remoteGroupId } : {},
  });
  if (!result.ok) {
    const detail = result.errorCode
      ? `${result.errorCode}: ${result.errorMessage}`
      : `HTTP ${result.status}`;
    throw new Error(
      `REALPERSON_ACTION_UNSUPPORTED — 이 계정/리전에서 실사 인물 인증 API를 찾지 못했습니다. ` +
        `시도한 조합: ${tried.join(", ")}. 마지막 응답: ${detail}. ` +
        `BytePlus 콘솔에서 발급받은 정확한 Action 이름을 BYTEPLUS_ASSETS_REALPERSON_CREATE_ACTION / ` +
        `BYTEPLUS_ASSETS_VERSION 으로 설정해 주세요.`,
    );
  }
  const sessionId =
    extractField(result.body, ["SessionId", "SessionID", "VerifySessionId", "TaskId"]) ?? "";
  const h5Link = extractField(result.body, ["H5Link", "H5Url", "QrUrl", "VerifyUrl", "Url"]) ?? "";
  if (!sessionId) throw new Error("SESSION_ID_NOT_FOUND_IN_RESPONSE");
  return { sessionId, h5Link, raw: result.body };
}

/** 실사 인증 세션 결과를 조회한다 — 인증 완료 시 verified GroupId 를 받는다. */
export async function getRealPersonSession(
  sessionId: string,
): Promise<{ verifyStatus: string; remoteGroupId?: string; raw: string }> {
  const configured = process.env["BYTEPLUS_ASSETS_REALPERSON_GET_ACTION"];
  const actions = configured
    ? [configured]
    : [
        "GetRealPersonVerifySession",
        "GetRealPersonSession",
        "GetVerifySession",
        "QueryRealPersonVerifySession",
      ];
  const { result } = await callWithActionFallback({
    actions,
    versions: REALPERSON_VERSIONS,
    body: { SessionId: sessionId, VerifySessionId: sessionId },
  });
  // 인증 전에는 404 가 정상 응답일 수 있으므로 throw 하지 않고 pending 으로 취급한다.
  if (!result.ok) {
    return { verifyStatus: "pending", raw: result.body };
  }
  const rawStatus = extractField(result.body, ["Status", "VerifyStatus", "State", "Result"]) ?? "";
  const remoteGroupId = extractField(result.body, ["GroupId", "GroupID"]) ?? undefined;
  const verifyStatus = /(?:success|pass|verified|done)/i.test(rawStatus)
    ? "verified"
    : /(?:fail|error|reject)/i.test(rawStatus)
      ? "failed"
      : "pending";
  return { verifyStatus, remoteGroupId, raw: result.body };
}

