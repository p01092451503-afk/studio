import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

// ═══════════════════════════════════════════════════════════════
// 프로덕션 자산고 — 서버 함수 (DB 미러 + 원격 BytePlus orchestration)
//
// 자산고 정식 경로.
// - DB 쓰기는 context.supabase(RLS) 로 테넌트 격리
// - 원격 API 는 *.server 헬퍼로 (AK/SK 서명, 서버 전용)
// - 확정 Action 이름은 .server 헬퍼가 .env 에서 읽는다
// ═══════════════════════════════════════════════════════════════

// ── 조회 ──────────────────────────────────────────────────────

/** 테넌트의 자산 그룹 목록을 조회한다. */
export const listAssetGroups = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data, error } = await context.supabase
      .from("asset_groups")
      .select(
        "id, remote_group_id, name, group_type, kind, verify_status, verify_h5_link, created_at",
      )
      .order("created_at", { ascending: false });
    if (error) throw new Error(error.message);
    return data ?? [];
  });

/** 특정 그룹(또는 전체)의 자산 목록을 조회한다. */
export const listAssets = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ groupId: z.string().uuid().optional() }).parse(d))
  .handler(async ({ data, context }) => {
    let query = context.supabase
      .from("assets")
      .select(
        "id, group_id, character_id, remote_asset_id, name, asset_type, status, thumbnail_url, storage_path, created_at",
      )
      .order("created_at", { ascending: false });
    if (data.groupId) query = query.eq("group_id", data.groupId);
    const { data: rows, error } = await query;
    if (error) throw new Error(error.message);
    return rows ?? [];
  });

// ── 그룹 생성 (로컬 → 원격) ────────────────────────────────────

/**
 * 자산 그룹을 생성한다.
 * 1) 원격 BytePlus 에 그룹 생성 → remote_group_id 확보
 * 2) DB 에 미러 레코드 저장
 * digital_human 그룹은 원격 생성을 건너뛰고 실사 인증 세션에서 GroupId 를 받는다.
 */
export const createAssetGroup = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) =>
    z
      .object({
        name: z.string().min(1).max(120),
        kind: z.enum(["aigc", "digital_human"]).default("aigc"),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    const { data: prof, error: pErr } = await context.supabase
      .from("profiles")
      .select("tenant_id")
      .eq("id", context.userId)
      .single();
    if (pErr || !prof?.tenant_id) throw new Error("NO_TENANT_FOR_USER");
    const tenantId = prof.tenant_id;

    // 원격(BytePlus) 그룹 생성은 계정 권한/스펙에 따라 실패할 수 있다.
    // 실패해도 로컬 그룹은 만들고 경고만 돌려준다 (화면 중단 방지).
    let remoteGroupId: string | null = null;
    let remoteWarning: string | null = null;
    let remoteDetail: {
      action?: string;
      version?: string;
      host?: string;
      region?: string;
      status?: number;
      errorCode?: string;
      errorMessage?: string;
      requestId?: string;
      bodySnippet?: string;
    } | null = null;
    if (data.kind === "aigc") {
      try {
        const { createBytePlusAssetGroup } = await import("@/lib/byteplus-assets.server");
        const remote = await createBytePlusAssetGroup({
          name: data.name,
          kind: data.kind,
        });
        remoteGroupId = remote.remoteGroupId;
      } catch (e) {
        remoteWarning = e instanceof Error ? e.message : String(e);
        const d = (e as { detail?: typeof remoteDetail })?.detail;
        if (d) remoteDetail = d;
      }
    }


    const { data: row, error } = await context.supabase
      .from("asset_groups")
      .insert({
        tenant_id: tenantId,
        remote_group_id: remoteGroupId,
        name: data.name,
        group_type: data.kind === "digital_human" ? "DigitalHuman" : "AIGC",
        kind: data.kind,
        verify_status: data.kind === "digital_human" ? "pending" : "none",
        created_by: context.userId,
      })
      .select("id, remote_group_id, name, kind, verify_status, created_at")
      .single();
    if (error) throw new Error(error.message);
    return { ...row, remoteWarning, remoteDetail };
  });

/** 자산 그룹 이름을 변경한다. */
export const renameAssetGroup = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) =>
    z.object({ id: z.string().uuid(), name: z.string().min(1).max(120) }).parse(d),
  )
  .handler(async ({ data, context }) => {
    const { data: rows, error } = await context.supabase
      .from("asset_groups")
      .update({ name: data.name.trim() })
      .eq("id", data.id)
      .select("id, name");
    if (error) return { ok: false as const, message: error.message };
    if (!rows || rows.length === 0)
      return { ok: false as const, message: "수정 권한이 없거나 없는 그룹입니다." };
    return { ok: true as const, name: rows[0]!.name };
  });

export const deleteAssetGroup = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    try {
      // 하위 자산이 있으면 FK 때문에 그룹 삭제가 막히므로 먼저 정리한다.
      const { error: childErr } = await context.supabase
        .from("assets")
        .delete()
        .eq("group_id", data.id);
      if (childErr) return { ok: false as const, deleted: 0, message: childErr.message };

      const { data: removed, error } = await context.supabase
        .from("asset_groups")
        .delete()
        .eq("id", data.id)
        .select("id");
      if (error) return { ok: false as const, deleted: 0, message: error.message };
      if (!removed || removed.length === 0) {
        return {
          ok: false as const,
          deleted: 0,
          message: "삭제 권한이 없거나 이미 삭제된 그룹입니다.",
        };
      }
      return { ok: true as const, deleted: removed.length, message: "" };
    } catch (e) {
      return {
        ok: false as const,
        deleted: 0,
        message: e instanceof Error ? e.message : String(e),
      };
    }
  });

// ── 자산 입고 (업로드 → 공개 URL → 원격 입고 → DB) ──────────────

/**
 * 이미 tenant 스토리지(character-refs)에 업로드된 이미지를 자산으로 입고한다.
 * 1) 토큰 없는 공개 URL 발급 (원격이 fetch 가능해야 함)
 * 2) 원격 그룹에 입고 → remote_asset_id 확보
 * 3) DB 에 미러 레코드 저장 (status=ingesting)
 */
export const ingestAsset = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) =>
    z
      .object({
        groupId: z.string().uuid(),
        storagePath: z.string().min(1),
        name: z.string().min(1).max(120),
        assetType: z.enum(["image", "video"]).default("image"),
        characterId: z.string().uuid().nullable().optional(),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    try {
      const { data: prof, error: pErr } = await context.supabase
        .from("profiles")
        .select("tenant_id")
        .eq("id", context.userId)
        .single();
      if (pErr || !prof?.tenant_id) return { ok: false as const, message: "사용자 테넌트를 확인할 수 없습니다." };
      const tenantId = prof.tenant_id;

      const { data: group, error: gErr } = await context.supabase
        .from("asset_groups")
        .select("remote_group_id")
        .eq("id", data.groupId)
        .single();
      if (gErr || !group) return { ok: false as const, message: "자산 그룹을 찾을 수 없습니다." };
      if (!group.remote_group_id) return { ok: false as const, message: "원격 서비스와 동기화되지 않은 그룹입니다." };

      const { publishPublicRef } = await import("@/lib/asset-public-ref.server");
      const { ingestBytePlusAsset } = await import("@/lib/byteplus-assets.server");
      const { url: publicUrl } = await publishPublicRef(data.storagePath, tenantId);
      const { remoteAssetId } = await ingestBytePlusAsset({
        remoteGroupId: group.remote_group_id,
        imageUrl: publicUrl,
        label: data.name,
        assetType: data.assetType,
      });

      const { data: row, error } = await context.supabase
        .from("assets")
        .insert({
          tenant_id: tenantId,
          group_id: data.groupId,
          character_id: data.characterId ?? null,
          remote_asset_id: remoteAssetId,
          name: data.name,
          asset_type: data.assetType,
          status: "ingesting",
          source_url: publicUrl,
          storage_path: data.storagePath,
          created_by: context.userId,
        })
        .select("id, remote_asset_id, name, status, created_at")
        .single();
      if (error) return { ok: false as const, message: error.message };
      return { ok: true as const, row };
    } catch (e) {
      const base = e instanceof Error ? e.message : String(e);
      const d = (e as { detail?: Record<string, unknown> })?.detail;
      const suffix = d
        ? ` [Action=${String(d["action"] ?? "?")}, Version=${String(d["version"] ?? "?")}, HTTP=${String(d["status"] ?? "?")}]`
        : "";
      return { ok: false as const, message: `${base}${suffix}` };
    }
  });

/** 입고 중인 자산의 원격 상태를 폴링하고 DB status 를 갱신한다. */
export const refreshAssetStatus = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { data: asset, error: aErr } = await context.supabase
      .from("assets")
      .select("remote_asset_id")
      .eq("id", data.id)
      .single();
    if (aErr || !asset?.remote_asset_id) throw new Error("ASSET_NOT_FOUND");

    const { getBytePlusAssetStatus } = await import("@/lib/byteplus-assets.server");
    const { status, thumbnailUrl } = await getBytePlusAssetStatus(asset.remote_asset_id);

    const { error } = await context.supabase
      .from("assets")
      .update({ status, thumbnail_url: thumbnailUrl ?? null })
      .eq("id", data.id);
    if (error) throw new Error(error.message);
    return { status };
  });

export const assignAssetCharacter = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) =>
    z
      .object({
        id: z.string().uuid(),
        characterId: z.string().uuid().nullable(),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase
      .from("assets")
      .update({ character_id: data.characterId })
      .eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const deleteAsset = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase.from("assets").delete().eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

// ── 실사 인물 인증 (digital_human 그룹) ────────────────────────

/** 실사 인증 세션을 생성하고 QR(H5) 링크를 그룹에 저장한다. */
export const startRealPersonVerify = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) =>
    z
      .object({
        groupId: z.string().uuid(),
        consentHolder: z.string().min(1).max(120),
        consentAt: z.string().min(1),
        consentNote: z.string().max(1000).optional(),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    const { data: group, error: gErr } = await context.supabase
      .from("asset_groups")
      .select("remote_group_id")
      .eq("id", data.groupId)
      .single();
    if (gErr || !group) throw new Error("GROUP_NOT_FOUND");

    // 동의 기록을 먼저 저장한다 (인증 시작 전 필수).
    const { error: cErr } = await context.supabase
      .from("asset_groups")
      .update({
        consent_holder: data.consentHolder.trim(),
        consent_at: new Date(data.consentAt).toISOString(),
        consent_note: data.consentNote?.trim() || null,
      })
      .eq("id", data.groupId);
    if (cErr) {
      return { ok: false as const, sessionId: "", h5Link: "", message: cErr.message };
    }


    const { createRealPersonSession } = await import("@/lib/byteplus-assets.server");
    let sessionId = "";
    let h5Link = "";
    try {
      const res = await createRealPersonSession({
        remoteGroupId: group.remote_group_id ?? undefined,
      });
      sessionId = res.sessionId;
      h5Link = res.h5Link;
    } catch (e) {
      // 계정/리전이 실사 인증 API를 지원하지 않는 경우 화면이 죽지 않도록 안내만 반환한다.
      return {
        ok: false as const,
        sessionId: "",
        h5Link: "",
        message: e instanceof Error ? e.message : "실사 인증 세션 생성에 실패했습니다.",
      };
    }

    const { error } = await context.supabase
      .from("asset_groups")
      .update({
        verify_session_id: sessionId,
        verify_h5_link: h5Link,
        verify_status: "pending",
      })
      .eq("id", data.groupId);
    if (error) {
      return { ok: false as const, sessionId: "", h5Link: "", message: error.message };
    }
    return { ok: true as const, sessionId, h5Link, message: "" };
  });

/** 실사 인증 세션 결과를 조회하고, 완료 시 verified GroupId 를 그룹에 반영한다. */
export const pollRealPersonVerify = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ groupId: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { data: group, error: gErr } = await context.supabase
      .from("asset_groups")
      .select("verify_session_id, remote_group_id")
      .eq("id", data.groupId)
      .single();
    if (gErr || !group?.verify_session_id) throw new Error("NO_VERIFY_SESSION");

    const { getRealPersonSession } = await import("@/lib/byteplus-assets.server");
    const { verifyStatus, remoteGroupId } = await getRealPersonSession(group.verify_session_id);

    const patch: { verify_status: string; remote_group_id?: string } = {
      verify_status: verifyStatus,
    };
    if (verifyStatus === "verified" && remoteGroupId && !group.remote_group_id) {
      patch.remote_group_id = remoteGroupId;
    }
    const { error } = await context.supabase
      .from("asset_groups")
      .update(patch)
      .eq("id", data.groupId);
    if (error) throw new Error(error.message);
    return { verifyStatus };
  });

// ── 영상 생성 참조 (정규 참조 URL 해석) ──────────────────────────

/**
 * 자산을 영상 생성에 쓸 수 있는 "정규 참조"로 해석한다.
 * - BytePlus 처리 URL이 있으면 그 URL을, 없으면 storage_path 를 공개 URL 로 발행한다.
 * - storage_path 가 없는 원격 전용 자산은 먼저 로컬(character-refs) 사본을 확보한다.
 * 반환: { url, kind, storagePath }
 */
export const resolveAssetReference = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { data: asset, error } = await context.supabase
      .from("assets")
      .select("id, tenant_id, remote_asset_id, storage_path, source_url, asset_type, name, status")
      .eq("id", data.id)
      .single();
    if (error || !asset) throw new Error("ASSET_NOT_FOUND");

    const kind: "image" | "video" = asset.asset_type === "video" ? "video" : "image";
    let storagePath = asset.storage_path as string | null;

    // 1) 로컬 사본 확보 (원격 전용 자산 대응)
    if (!storagePath) {
      if (!asset.remote_asset_id) throw new Error("ASSET_HAS_NO_SOURCE");
      const { importBytePlusAssetToStorage } = await import("@/lib/byteplus-assets.server");
      const { path } = await importBytePlusAssetToStorage(
        asset.remote_asset_id,
        asset.tenant_id as string,
        asset.name as string,
      );
      storagePath = path;
      await context.supabase.from("assets").update({ storage_path: path }).eq("id", asset.id);
    }

    // 2) 정규 참조 URL 결정
    let url = "";
    if (asset.remote_asset_id) {
      try {
        const { getBytePlusAssetUrl } = await import("@/lib/byteplus-assets.server");
        url = (await getBytePlusAssetUrl(asset.remote_asset_id)).url;
      } catch {
        url = "";
      }
    }
    if (!url) {
      const { publishPublicRef } = await import("@/lib/asset-public-ref.server");
      url = (await publishPublicRef(storagePath, asset.tenant_id as string)).url;
    }

    return { url, kind, storagePath, status: asset.status as string };
  });

