import { useMemo, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { toast } from "sonner";
import {
  Boxes,
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
      { title: "자산고 | 웹툰 영상 생성기" },
      {
        name: "description",
        content:
          "BytePlus Seedance 2.0 자산고를 관리합니다. 그룹 생성, 참조 이미지 입고, 실사 인물 인증, asset:// 영상 참조까지 한 화면에서.",
      },
    ],
  }),
  component: AssetLibraryPage,
});

const UNASSIGNED = "__unassigned__";

function StatusBadge({ status }: { status: string }) {
  if (status === "ready")
    return (
      <Badge variant="outline" className="gap-1 border-emerald-500/40 text-emerald-600">
        <CheckCircle2 className="h-3 w-3" /> 준비됨
      </Badge>
    );
  if (status === "failed")
    return (
      <Badge variant="outline" className="gap-1 border-destructive/40 text-destructive">
        <AlertCircle className="h-3 w-3" /> 실패
      </Badge>
    );
  if (status === "draft")
    return (
      <Badge variant="outline" className="gap-1 text-muted-foreground">
        임시
      </Badge>
    );
  return (
    <Badge variant="outline" className="gap-1 text-amber-600 border-amber-500/40">
      <Clock className="h-3 w-3" /> 입고 중
    </Badge>
  );
}

function VerifyBadge({ status }: { status: string }) {
  if (status === "verified")
    return (
      <Badge variant="outline" className="gap-1 border-emerald-500/40 text-emerald-600">
        <ShieldCheck className="h-3 w-3" /> 인증됨
      </Badge>
    );
  if (status === "pending")
    return (
      <Badge variant="outline" className="gap-1 text-amber-600 border-amber-500/40">
        <Clock className="h-3 w-3" /> 인증 대기
      </Badge>
    );
  if (status === "failed")
    return (
      <Badge variant="outline" className="gap-1 border-destructive/40 text-destructive">
        <AlertCircle className="h-3 w-3" /> 인증 실패
      </Badge>
    );
  return null;
}

function AssetLibraryPage() {
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
      })) as { id: string };
      setNewGroupName("");
      setSelectedGroupId(row.id);
      toast.success("그룹이 생성되었습니다.");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "그룹 생성 실패");
    }
  }

  async function handleUploadAndIngest(file: File) {
    if (!tenantId) {
      toast.error("테넌트를 확인할 수 없습니다.");
      return;
    }
    if (!selectedGroup) {
      toast.error("먼저 그룹을 선택하세요.");
      return;
    }
    setUploading(true);
    try {
      const path = `${tenantId}/assets/${Date.now()}-${crypto.randomUUID()}-${file.name}`;
      const { error } = await supabase.storage
        .from("character-refs")
        .upload(path, file, { contentType: file.type || "image/png", upsert: false });
      if (error) throw error;
      await ingest.mutateAsync({
        groupId: selectedGroup.id,
        storagePath: path,
        name: file.name.replace(/\.[^.]+$/, ""),
      });
      toast.success("입고 요청 완료 — 상태를 폴링하세요.");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "입고 실패");
    } finally {
      setUploading(false);
    }
  }

  async function handleStartVerify(group: AssetGroupRow) {
    try {
      const { h5Link } = (await startVerify.mutateAsync(group.id)) as {
        h5Link: string;
      };
      if (h5Link) {
        toast.success("인증 세션 생성 — QR 링크가 발급되었습니다.");
      } else {
        toast.message("세션은 생성됐지만 QR 링크가 응답에 없습니다. 로그를 확인하세요.");
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "인증 세션 생성 실패");
    }
  }

  async function handlePollVerify(group: AssetGroupRow) {
    try {
      const { verifyStatus } = (await pollVerify.mutateAsync(group.id)) as {
        verifyStatus: string;
      };
      toast.message(`인증 상태: ${verifyStatus}`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "인증 조회 실패");
    }
  }

  return (
    <main className="mx-auto w-full max-w-5xl space-y-5 p-4 md:p-6">
      <header className="space-y-1">
        <h1 className="flex items-center gap-2 text-xl font-black">
          <Boxes className="h-5 w-5" /> 자산고
        </h1>
        <p className="text-sm text-muted-foreground">
          BytePlus Seedance 2.0 자산고를 관리합니다. 그룹에 참조 이미지를 입고하면 asset:// 참조로
          영상 생성에 재사용할 수 있습니다.
        </p>
      </header>

      <div className="grid gap-5 md:grid-cols-[280px_1fr]">
        {/* ── 그룹 사이드 ─────────────────────────────── */}
        <aside className="space-y-3">
          <div className="rounded-xl border border-border bg-card p-3 space-y-2.5">
            <Label className="text-xs font-semibold">새 그룹</Label>
            <Input
              className="h-9"
              placeholder="그룹 이름"
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
                <SelectItem value="aigc">AIGC (일반 참조)</SelectItem>
                <SelectItem value="digital_human">디지털 휴먼 (실사 인증)</SelectItem>
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
              그룹 생성
            </Button>
          </div>

          <div className="space-y-1.5">
            {groupsLoading && (
              <div className="flex items-center gap-2 p-3 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" /> 불러오는 중…
              </div>
            )}
            {!groupsLoading && groups.length === 0 && (
              <p className="p-3 text-sm text-muted-foreground">아직 그룹이 없습니다.</p>
            )}
            {groups.map((group) => (
              <button
                key={group.id}
                onClick={() => setSelectedGroupId(group.id)}
                className={`w-full rounded-lg border p-2.5 text-left transition-colors ${
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
                <div className="mt-1 flex items-center gap-1.5 text-[11px] text-muted-foreground">
                  <span>{group.kind === "digital_human" ? "디지털 휴먼" : "AIGC"}</span>
                  {!group.remote_group_id && (
                    <span className="text-amber-600">· 원격 미동기화</span>
                  )}
                </div>
              </button>
            ))}
          </div>
        </aside>

        {/* ── 자산 본문 ──────────────────────────────── */}
        <section className="space-y-4">
          {!selectedGroup ? (
            <div className="flex h-48 items-center justify-center rounded-xl border border-dashed border-border text-sm text-muted-foreground">
              왼쪽에서 그룹을 선택하거나 새 그룹을 만드세요.
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
                      : "원격 GroupId 미발급"}
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
                        이미지 입고
                        <input
                          type="file"
                          accept="image/*"
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
                    aria-label="그룹 삭제"
                    onClick={() => {
                      deleteGroup.mutate(selectedGroup.id);
                      setSelectedGroupId(null);
                    }}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              </div>

              {/* 실사 인증 패널 */}
              {selectedGroup.kind === "digital_human" && (
                <div className="rounded-xl border border-primary/20 bg-primary/5 p-3 space-y-2.5">
                  <div className="flex items-center gap-2 text-sm font-semibold text-primary">
                    <ShieldCheck className="h-4 w-4" /> 실사 인물 인증
                  </div>
                  <p className="text-xs text-muted-foreground">
                    QR 링크를 배우 휴대폰으로 열어 활체 인증을 완료한 뒤 상태를 조회하세요. 인증 전
                    404 는 정상입니다.
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
                      인증 세션 생성
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
                      인증 상태 조회
                    </Button>
                    {selectedGroup.verify_h5_link && (
                      <a
                        href={selectedGroup.verify_h5_link}
                        target="_blank"
                        rel="noreferrer"
                        className="text-xs font-medium text-primary underline"
                      >
                        QR 링크 열기 ↗
                      </a>
                    )}
                  </div>
                </div>
              )}

              {/* 자산 그리드 */}
              {assetsLoading ? (
                <div className="flex items-center gap-2 py-10 text-sm text-muted-foreground">
                  <Loader2 className="h-5 w-5 animate-spin" /> 자산을 불러오는 중…
                </div>
              ) : assets.length === 0 ? (
                <div className="flex h-40 flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-border text-sm text-muted-foreground">
                  <ImageIcon className="h-6 w-6" />
                  아직 입고된 자산이 없습니다.
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
                            <SelectValue placeholder="캐릭터 연결" />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value={UNASSIGNED}>연결 안 함</SelectItem>
                            {characters.map((character) => (
                              <SelectItem key={character.id} value={character.id}>
                                {character.display_name}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                        <div className="flex gap-1.5">
                          {asset.status !== "ready" && (
                            <Button
                              size="sm"
                              variant="outline"
                              className="flex-1"
                              disabled={refreshStatus.isPending}
                              onClick={() => refreshStatus.mutate(asset.id)}
                            >
                              <RefreshCw className="h-3.5 w-3.5" /> 상태
                            </Button>
                          )}
                          <Button
                            size="icon"
                            variant="ghost"
                            className="h-8 w-8"
                            aria-label="삭제"
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
