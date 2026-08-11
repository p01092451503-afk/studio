// Server-only helpers for the Seedance 2.0 asset-library (자산고) diagnostic console.
// Every helper returns the RAW signed-call result so the console can show exactly
// which Action name / payload shape the account accepts. Nothing throws on API errors.

import { callSignedBytePlusApi, type SignedCallResult } from "@/lib/byteplus-assets.server";

export const ASSET_API_VERSION = process.env["BYTEPLUS_ASSETS_VERSION"] ?? "2024-01-01";

export type ProbeItem = { action: string; result: SignedCallResult };

async function safeCall(params: {
  action: string;
  version?: string;
  body?: unknown;
}): Promise<SignedCallResult> {
  try {
    return await callSignedBytePlusApi({
      action: params.action,
      version: params.version ?? ASSET_API_VERSION,
      method: "POST",
      body: params.body ?? {},
    });
  } catch (e) {
    return {
      ok: false,
      status: 0,
      action: params.action,
      host: "-",
      region: "-",
      service: "-",
      body: "",
      errorCode: "LOCAL_ERROR",
      errorMessage: e instanceof Error ? e.message : String(e),
    };
  }
}

/** 후보 Action 이름을 순서대로 호출하고 각각의 응답을 그대로 돌려준다. */
export async function probeActions(
  actions: string[],
  body: unknown,
  version?: string,
): Promise<ProbeItem[]> {
  const out: ProbeItem[] = [];
  for (const action of actions) {
    out.push({ action, result: await safeCall({ action, version, body }) });
  }
  return out;
}

export const CANDIDATES = {
  createGroup: ["CreateAssetGroup", "CreateGroup", "AddAssetGroup", "CreateDigitalHumanGroup"],
  listGroups: ["ListAssetGroups", "ListGroups"],
  ingest: ["CreateAsset", "AddAsset", "ImportAsset", "UploadAsset", "CreateAssetItem"],
  getAsset: ["GetAssetInfo", "GetAsset", "DescribeAsset", "QueryAsset"],
  listAssets: ["ListAssets", "ListAssetItems"],
  realPersonSession: [
    "CreateRealPersonVerifySession",
    "CreateRealPersonSession",
    "CreateVerifySession",
    "CreateRealHumanSession",
  ],
  getRealPersonSession: [
    "GetRealPersonVerifySession",
    "GetRealPersonSession",
    "GetVerifySession",
  ],
} as const;

/** 자유 형식 서명 호출 — 스펙 탐색용. */
export async function rawSignedCall(params: {
  action: string;
  version?: string;
  bodyJson?: string;
}): Promise<SignedCallResult> {
  let body: unknown = {};
  if (params.bodyJson && params.bodyJson.trim()) {
    try {
      body = JSON.parse(params.bodyJson);
    } catch {
      return {
        ok: false,
        status: 0,
        action: params.action,
        host: "-",
        region: "-",
        service: "-",
        body: "",
        errorCode: "INVALID_JSON",
        errorMessage: "Body JSON 파싱에 실패했습니다.",
      };
    }
  }
  return safeCall({ action: params.action, version: params.version, body });
}

/** 참고 이미지를 토큰 없는 공개 URL 로 노출한다 (입고 API 가 fetch 할 수 있도록). */
export async function publishPublicRef(
  storagePath: string,
  tenantId: string,
): Promise<{ url: string; key: string }> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { getPublicFetchOrigin } = await import("@/lib/public-origin.server");
  const origin = await getPublicFetchOrigin();

  const { data: blob, error } = await supabaseAdmin.storage
    .from("character-refs")
    .download(storagePath);
  if (error || !blob) throw new Error(`REF_DOWNLOAD_FAILED: ${storagePath}`);
  const ext = storagePath.split(".").pop() || "png";
  const key = `${tenantId}/asset-lab/${crypto.randomUUID()}.${ext}`;
  const bytes = new Uint8Array(await blob.arrayBuffer());
  const { error: upErr } = await supabaseAdmin.storage
    .from("seedance-refs")
    .upload(key, bytes, { contentType: blob.type || "image/png", upsert: true });
  if (upErr) throw new Error(`REF_PUBLIC_UPLOAD_FAILED: ${upErr.message}`);
  return { url: `${origin}/api/public/seedance-ref/${key}`, key };
}
