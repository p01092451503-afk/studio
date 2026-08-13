import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import i18n from "@/i18n";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { toast } from "sonner";
import {
  Boxes,
  Clapperboard,
  Loader2,
  Plus,
  Trash2,
  Upload,
  RefreshCw,
  ShieldCheck,
  QrCode,
  ImageIcon,
  CheckCircle2,
  AlertCircle,
  Clock,
} from "lucide-react";
import { pushPendingRefs } from "@/lib/pending-refs";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { SignedImage } from "@/components/SignedImage";
import { supabase } from "@/integrations/supabase/client";
import { useTenant } from "@/hooks/useTenant";
import { useCharacters } from "@/hooks/useCharacters";
import {
  useAssetGroups,
  useAssets,
  useCreateAssetGroup,
  useDeleteAssetGroup,
  useIngestAsset,
  useRefreshAssetStatus,
  useAssignAssetCharacter,
  useDeleteAsset,
  useStartRealPersonVerify,
  usePollRealPersonVerify,
  type AssetGroupRow,
} from "@/hooks/useAssetLibrary";

export const Route = createFileRoute("/_authenticated/asset-library")({
  head: () => ({
    meta: [
      { title: i18n.t("assetlib.meta_title") },
      { name: "description", content: i18n.t("assetlib.meta_desc") },
      { property: "og:title", content: i18n.t("assetlib.meta_title") },
      { property: "og:description", content: i18n.t("assetlib.meta_desc") },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: AssetLibraryPage,
});

const UNASSIGNED = "__unassigned__";

function StatusBadge({ status }: { status: string }) {
  const { t } = useTranslation();
  if (status === "ready")
    return (
      <Badge variant="outline" className="gap-1 border-emerald-500/40 text-emerald-600">
        <CheckCircle2 className="h-3 w-3" /> {t("assetlib.badge_ready")}
      </Badge>
    );
  if (status === "failed")
    return (
      <Badge variant="outline" className="gap-1 border-destructive/40 text-destructive">
        <AlertCircle className="h-3 w-3" /> {t("assetlib.badge_failed")}
      </Badge>
    );
  if (status === "draft")
    return (
      <Badge variant="outline" className="gap-1 text-muted-foreground">
        {t("assetlib.badge_draft")}
      </Badge>
    );
  return (
    <Badge variant="outline" className="gap-1 text-amber-600 border-amber-500/40">
      <Clock className="h-3 w-3" /> {t("assetlib.badge_ingesting")}
    </Badge>
  );
}

function VerifyBadge({ status }: { status: string }) {
  const { t } = useTranslation();
  if (status === "verified")
    return (
      <Badge variant="outline" className="gap-1 border-emerald-500/40 text-emerald-600">
        <ShieldCheck className="h-3 w-3" /> {t("assetlib.verify_verified")}
      </Badge>
    );
  if (status === "pending")
    return (
      <Badge variant="outline" className="gap-1 text-amber-600 border-amber-500/40">
        <Clock className="h-3 w-3" /> {t("assetlib.verify_pending")}
      </Badge>
    );
  if (status === "failed")
    return (
      <Badge variant="outline" className="gap-1 border-destructive/40 text-destructive">
        <AlertCircle className="h-3 w-3" /> {t("assetlib.verify_failed")}
      </Badge>
    );
  return null;
}

function AssetLibraryPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { tenantId } = useTenant();
  const { data: groups = [], isLoading: groupsLoading } = useAssetGroups();
  const { data: characters = [] } = useCharacters();

  const [selectedGroupId, setSelectedGroupId] = useState<string | null>(null);
  const selectedGroup = useMemo(
    () => groups.find((g) => g.id === selectedGroupId) ?? null,
    [groups, selectedGroupId],
  );

  const { data: assets = [], isLoading: assetsLoading } = useAssets(selectedGroupId ?? undefined);

  const createGroup = useCreateAssetGroup();
  const deleteGroup = useDeleteAssetGroup();
  const ingest = useIngestAsset();
  const refreshStatus = useRefreshAssetStatus();
  const assignCharacter = useAssignAssetCharacter();
  const removeAsset = useDeleteAsset();
  const startVerify = useStartRealPersonVerify();
  const pollVerify = usePollRealPersonVerify();

  const [newGroupName, setNewGroupName] = useState("");
  const [newGroupKind, setNewGroupKind] = useState<"aigc" | "digital_human">("aigc");
  const [uploading, setUploading] = useState(false);

  const busy =
    createGroup.isPending ||
    ingest.isPending ||
    uploading ||
    startVerify.isPending ||
    pollVerify.isPending;

  async function handleCreateGroup() {
    if (!newGroupName.trim()) return;
    try {
      const row = (await createGroup.mutateAsync({
        name: newGroupName.trim(),
        kind: newGroupKind,
      })) as {
        id: string;
        remoteWarning?: string | null;
        remoteDetail?: {
          action?: string;
          version?: string;
          host?: string;
          region?: string;
          status?: number;
          errorCode?: string;
          errorMessage?: string;
          requestId?: string;
          bodySnippet?: string;
        } | null;
      };
      setNewGroupName("");
      setSelectedGroupId(row.id);
      if (row.remoteWarning) {
        const d = row.remoteDetail;
        const lines = [
          `${t("assetlib.detail_reason")}: ${row.remoteWarning}`,
          d?.action ? `Action: ${d.action}` : null,
          d?.version ? `Version: ${d.version}` : null,
          d?.host ? `Host: ${d.host}${d.region ? ` (${d.region})` : ""}` : null,
          typeof d?.status === "number" ? `${t("assetlib.detail_status")}: ${d.status}` : null,
          d?.errorCode ? `${t("assetlib.detail_error_code")}: ${d.errorCode}` : null,
          d?.errorMessage ? `${t("assetlib.detail_error_message")}: ${d.errorMessage}` : null,
          d?.requestId ? `RequestId: ${d.requestId}` : null,
          d?.bodySnippet ? `${t("assetlib.detail_body")}: ${d.bodySnippet.slice(0, 200)}` : null,
        ].filter(Boolean) as string[];
        toast.warning(
          t("assetlib.toast_remote_failed"),
          {
            duration: 15000,
            description: (
              <div className="whitespace-pre-wrap break-all text-xs leading-relaxed">
                {lines.join("\n")}
              </div>
            ),
          },
        );
      } else {
        toast.success(t("assetlib.toast_group_created"));
      }

    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("assetlib.toast_group_create_failed"));
    }
  }

  async function handleUploadAndIngest(file: File) {
    if (!tenantId) {
      toast.error(t("assetlib.toast_no_tenant"));
      return;
    }
    if (!selectedGroup) {
      toast.error(t("assetlib.toast_select_group_first"));
      return;
    }
    setUploading(true);
    try {
      // Storage 키는 ASCII 안전 문자만 허용 → 한글/괄호/공백 등을 정리한다.
      const dotIndex = file.name.lastIndexOf(".");
      const rawExt = dotIndex > 0 ? file.name.slice(dotIndex + 1) : "";
      const ext = (rawExt.replace(/[^a-zA-Z0-9]/g, "") || "bin").toLowerCase();
      const safeBase =
        file.name
          .slice(0, dotIndex > 0 ? dotIndex : undefined)
          .replace(/[^a-zA-Z0-9._-]/g, "-")
          .replace(/-+/g, "-")
          .replace(/^-|-$/g, "")
          .slice(0, 40) || "asset";
      const path = `${tenantId}/assets/${Date.now()}-${crypto.randomUUID()}-${safeBase}.${ext}`;
      const assetType = file.type.startsWith("video/") || ext === "mp4" ? "video" : "image";
      const { error } = await supabase.storage
        .from("character-refs")
        .upload(path, file, {
          contentType: file.type || (ext === "mp4" ? "video/mp4" : "image/png"),
          upsert: false,
        });

      if (error) throw error;
      const result = (await ingest.mutateAsync({
        groupId: selectedGroup.id,
        storagePath: path,
        name: file.name.replace(/\.[^.]+$/, ""),
        assetType,
      })) as { ok: boolean; message?: string };
      if (!result.ok) {
        toast.error(result.message || t("assetlib.toast_ingest_failed"));
        return;
      }
      toast.success(t("assetlib.toast_ingest_done"));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("assetlib.toast_ingest_failed"));
    } finally {
      setUploading(false);
    }
  }

  async function handleDeleteGroup(id: string) {
    try {
      const res = (await deleteGroup.mutateAsync(id)) as
        | { ok?: boolean; message?: string }
        | undefined;
      if (res && res.ok === false) {
        toast.error(res.message || t("assetlib.toast_group_delete_failed"));
        return;
      }
      if (selectedGroupId === id) setSelectedGroupId(null);
      toast.success(t("assetlib.toast_group_deleted"));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("assetlib.toast_group_delete_failed"));
    }
  }

  /** 실사 인증 실패 메시지를 짧은 한글 안내로 바꾼다. */
  function friendlyVerifyError(raw: string) {
    if (raw.includes("REALPERSON_ACTION_UNSUPPORTED") || raw.includes("InvalidActionOrVersion")) {
      return t("assetlib.toast_verify_no_perm");
    }
    return raw || t("assetlib.toast_verify_failed");
  }

  async function handleStartVerify(group: AssetGroupRow) {
    try {
      const res = (await startVerify.mutateAsync(group.id)) as {
        ok: boolean;
        h5Link: string;
        message: string;
      };
      if (!res.ok) {
        toast.error(friendlyVerifyError(res.message));
        return;
      }
      if (res.h5Link) {
        toast.success(t("assetlib.toast_verify_created"));
      } else {
        toast.message(t("assetlib.toast_verify_no_link"));
      }
    } catch (e) {
      toast.error(friendlyVerifyError(e instanceof Error ? e.message : ""));
    }
  }

  async function handlePollVerify(group: AssetGroupRow) {
    try {
      const { verifyStatus } = (await pollVerify.mutateAsync(group.id)) as {
        verifyStatus: string;
      };
      toast.message(t("assetlib.toast_verify_status", { status: verifyStatus }));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("assetlib.toast_verify_poll_failed"));
    }
  }

  return (
    <main className="mx-auto w-full max-w-5xl space-y-5 p-4 md:p-6">
      <header className="space-y-1">
        <h1 className="flex items-center gap-2 text-3xl font-extrabold tracking-tight">
          <Boxes className="h-7 w-7" /> {t("assetlib.title")}
        </h1>
        <p className="text-sm text-muted-foreground">
          {t("assetlib.subtitle")}
        </p>
        <div className="flex flex-wrap gap-2 pt-1">
          <a
            href="/video"
            className="rounded-md border border-border px-2.5 py-1 text-xs font-semibold hover:bg-muted"
          >
            {t("assetlib.use_in_video")}
          </a>
        </div>
      </header>


      <div className="grid gap-5 md:grid-cols-[280px_1fr]">
        {/* ── 그룹 사이드 ─────────────────────────────── */}
        <aside className="space-y-3">
          <div className="rounded-xl border border-border bg-card p-3 space-y-2.5">
            <Label className="text-xs font-semibold">{t("assetlib.new_group")}</Label>
            <Input
              className="h-9"
              placeholder={t("assetlib.group_name_ph")}
              value={newGroupName}
              onChange={(e) => setNewGroupName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") void handleCreateGroup();
              }}
            />
            <Select
              value={newGroupKind}
              onValueChange={(v) => setNewGroupKind(v as "aigc" | "digital_human")}
            >
              <SelectTrigger className="h-9">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="aigc">{t("assetlib.kind_aigc")}</SelectItem>
                <SelectItem value="digital_human">{t("assetlib.kind_digital_human")}</SelectItem>
              </SelectContent>
            </Select>
            <Button
              size="sm"
              className="w-full"
              disabled={busy || !newGroupName.trim()}
              onClick={() => void handleCreateGroup()}
            >
              {createGroup.isPending ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Plus className="h-4 w-4" />
              )}
              {t("assetlib.create_group")}
            </Button>
          </div>

          <div className="space-y-1.5">
            {groupsLoading && (
              <div className="flex items-center gap-2 p-3 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" /> {t("assetlib.loading")}
              </div>
            )}
            {!groupsLoading && groups.length === 0 && (
              <p className="p-3 text-sm text-muted-foreground">{t("assetlib.no_groups")}</p>
            )}
            {groups.map((group) => (
              <div
                key={group.id}
                role="button"
                tabIndex={0}
                onClick={() => setSelectedGroupId(group.id)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") setSelectedGroupId(group.id);
                }}
                className={`w-full cursor-pointer rounded-lg border p-2.5 text-left transition-colors ${
                  selectedGroupId === group.id
                    ? "border-primary bg-primary/5"
                    : "border-border hover:bg-muted"
                }`}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="min-w-0 flex-1 truncate text-sm font-semibold">
                    {group.name}
                  </span>
                  {group.kind === "digital_human" && <VerifyBadge status={group.verify_status} />}
                </div>
                <div className="mt-1 flex items-center justify-between gap-2">
                  <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
                    <span>{group.kind === "digital_human"
                        ? t("assetlib.kind_digital_human_short")
                        : t("assetlib.kind_aigc_short")}</span>
                    {!group.remote_group_id && (
                      <span className="text-amber-600">{t("assetlib.remote_unsynced")}</span>
                    )}
                  </div>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-7 shrink-0 gap-1 px-2 text-[11px] text-destructive hover:bg-destructive/10 hover:text-destructive"
                    aria-label={t("assetlib.delete_group")}
                    disabled={deleteGroup.isPending}
                    onClick={(e) => {
                      e.stopPropagation();
                      if (
                        !window.confirm(
                          t("assetlib.delete_group_confirm", { name: group.name }),
                        )
                      )
                        return;
                      void handleDeleteGroup(group.id);
                    }}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                    {t("assetlib.delete")}
                  </Button>
                </div>

              </div>
            ))}
          </div>
        </aside>

        {/* ── 자산 본문 ──────────────────────────────── */}
        <section className="space-y-4">
          {!selectedGroup ? (
            <div className="flex h-48 items-center justify-center rounded-xl border border-dashed border-border text-sm text-muted-foreground">
              {t("assetlib.select_group_hint")}
            </div>
          ) : (
            <>
              <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-border bg-card p-3">
                <div className="space-y-0.5">
                  <div className="flex items-center gap-2">
                    <h2 className="text-sm font-bold">{selectedGroup.name}</h2>
                    {selectedGroup.kind === "digital_human" && (
                      <VerifyBadge status={selectedGroup.verify_status} />
                    )}
                  </div>
                  <p className="text-[11px] text-muted-foreground">
                    {selectedGroup.remote_group_id
                      ? `GroupId: ${selectedGroup.remote_group_id}`
                      : t("assetlib.remote_group_id_missing")}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  {selectedGroup.kind === "aigc" && (
                    <Button size="sm" disabled={busy} asChild>
                      <label className="cursor-pointer">
                        {uploading ? (
                          <Loader2 className="h-4 w-4 animate-spin" />
                        ) : (
                          <Upload className="h-4 w-4" />
                        )}
                        {t("assetlib.ingest_image")}
                        <input
                          type="file"
                          accept="image/*,video/mp4"
                          className="hidden"
                          onChange={(e) => {
                            const file = e.target.files?.[0];
                            if (file) void handleUploadAndIngest(file);
                            e.target.value = "";
                          }}
                        />
                      </label>
                    </Button>
                  )}
                  <Button
                    size="icon"
                    variant="ghost"
                    className="h-9 w-9"
                    aria-label={t("assetlib.delete_group")}
                    disabled={deleteGroup.isPending}
                    onClick={() => void handleDeleteGroup(selectedGroup.id)}
                  >

                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              </div>

              {/* 실사 인증 패널 */}
              {selectedGroup.kind === "digital_human" && (
                <div className="rounded-xl border border-primary/20 bg-primary/5 p-3 space-y-2.5">
                  <div className="flex items-center gap-2 text-sm font-semibold text-primary">
                    <ShieldCheck className="h-4 w-4" /> {t("assetlib.verify_title")}
                  </div>
                  <p className="text-xs text-muted-foreground">
                    {t("assetlib.verify_desc")}
                  </p>
                  <div className="flex flex-wrap items-center gap-2">
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={busy}
                      onClick={() => void handleStartVerify(selectedGroup)}
                    >
                      {startVerify.isPending ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        <QrCode className="h-4 w-4" />
                      )}
                      {t("assetlib.verify_start")}
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={busy || selectedGroup.verify_status === "none"}
                      onClick={() => void handlePollVerify(selectedGroup)}
                    >
                      {pollVerify.isPending ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        <RefreshCw className="h-4 w-4" />
                      )}
                      {t("assetlib.verify_poll")}
                    </Button>
                    {selectedGroup.verify_h5_link && (
                      <a
                        href={selectedGroup.verify_h5_link}
                        target="_blank"
                        rel="noreferrer"
                        className="text-xs font-medium text-primary underline"
                      >
                        {t("assetlib.verify_open_qr")}
                      </a>
                    )}
                  </div>
                </div>
              )}

              {/* 자산 그리드 */}
              {assetsLoading ? (
                <div className="flex items-center gap-2 py-10 text-sm text-muted-foreground">
                  <Loader2 className="h-5 w-5 animate-spin" /> {t("assetlib.assets_loading")}
                </div>
              ) : assets.length === 0 ? (
                <div className="flex h-40 flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-border text-sm text-muted-foreground">
                  <ImageIcon className="h-6 w-6" />
                  {t("assetlib.assets_empty")}
                </div>
              ) : (
                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                  {assets.map((asset) => (
                    <div
                      key={asset.id}
                      className="overflow-hidden rounded-lg border border-border bg-muted/30"
                    >
                      {asset.storage_path ? (
                        <SignedImage
                          bucket="character-refs"
                          path={asset.storage_path}
                          alt={asset.name}
                          className="aspect-video w-full object-cover"
                        />
                      ) : asset.thumbnail_url ? (
                        <img
                          src={asset.thumbnail_url}
                          alt={asset.name}
                          loading="lazy"
                          className="aspect-video w-full object-cover"
                        />
                      ) : (
                        <div className="flex aspect-video w-full items-center justify-center">
                          <ImageIcon className="h-8 w-8 text-muted-foreground" />
                        </div>
                      )}
                      <div className="space-y-2 p-2.5">
                        <div className="flex items-center justify-between gap-2">
                          <span className="min-w-0 flex-1 truncate text-xs font-semibold">
                            {asset.name}
                          </span>
                          <StatusBadge status={asset.status} />
                        </div>
                        {asset.remote_asset_id && (
                          <p className="truncate font-mono text-[10px] text-muted-foreground">
                            asset://{asset.remote_asset_id}
                          </p>
                        )}
                        <Select
                          value={asset.character_id ?? UNASSIGNED}
                          onValueChange={(value) =>
                            assignCharacter.mutate({
                              id: asset.id,
                              characterId: value === UNASSIGNED ? null : value,
                            })
                          }
                        >
                          <SelectTrigger className="h-8 text-xs">
                            <SelectValue placeholder={t("assetlib.link_character")} />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value={UNASSIGNED}>{t("assetlib.no_link")}</SelectItem>
                            {characters.map((character) => (
                              <SelectItem key={character.id} value={character.id}>
                                {character.display_name}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                        <Button
                          size="sm"
                          className="w-full"
                          disabled={!asset.storage_path}
                          onClick={() => {
                            if (!asset.storage_path) return;
                            pushPendingRefs([
                              {
                                id: asset.id,
                                name: asset.name,
                                kind: asset.asset_type === "video" ? "video" : "image",
                                storagePath: asset.storage_path,
                              },
                            ]);
                            toast.success(t("assetlib.toast_pushed_to_video"));
                            navigate({ to: "/video" });
                          }}
                        >
                          <Clapperboard className="h-3.5 w-3.5" /> {t("assetlib.use_for_video")}
                        </Button>
                        <div className="flex gap-1.5">
                          {asset.status !== "ready" && (
                            <Button
                              size="sm"
                              variant="outline"
                              className="flex-1"
                              disabled={refreshStatus.isPending}
                              onClick={() => refreshStatus.mutate(asset.id)}
                            >
                              <RefreshCw className="h-3.5 w-3.5" /> {t("assetlib.refresh_status")}
                            </Button>
                          )}
                          <Button
                            size="icon"
                            variant="ghost"
                            className="h-8 w-8"
                            aria-label={t("assetlib.delete")}
                            onClick={() => removeAsset.mutate(asset.id)}
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </Button>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </>
          )}
        </section>
      </div>
    </main>
  );
}
