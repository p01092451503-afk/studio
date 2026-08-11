import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Loader2, FlaskConical, Upload, Play } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { supabase } from "@/integrations/supabase/client";
import { useTenant } from "@/hooks/useTenant";
import {
  probeAssetActions,
  callAssetApi,
  publishAssetLabRef,
  createAssetLabVideoTask,
  getAssetLabVideoTask,
} from "@/lib/asset-lab.functions";

export const Route = createFileRoute("/_authenticated/asset-lab")({
  head: () => ({
    meta: [
      { title: "자산고 진단 콘솔 | 웹툰 영상 생성기" },
      {
        name: "description",
        content:
          "Seedance 2.0 자산고(Asset Library) API 스펙을 실제 계정으로 시험 호출하고, 그룹 생성부터 asset:// 영상 생성까지 왕복 1회를 검증합니다.",
      },
      { property: "og:title", content: "자산고 진단 콘솔 | 웹툰 영상 생성기" },
      {
        property: "og:description",
        content: "자산고 API 액션 탐색 · 이미지 입고 · 상태 폴링 · asset:// 생성 테스트",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: AssetLabPage,
});

type Log = { at: string; label: string; detail: string; ok: boolean };

function Section({ title, step, children }: { title: string; step: number; children: React.ReactNode }) {
  return (
    <section className="rounded-xl border border-border bg-card p-4 space-y-3">
      <h2 className="text-sm font-bold flex items-center gap-2">
        <span className="flex h-5 w-5 items-center justify-center rounded-full bg-primary text-primary-foreground text-[11px]">
          {step}
        </span>
        {title}
      </h2>
      {children}
    </section>
  );
}

function AssetLabPage() {
  const { tenantId } = useTenant();
  const probe = useServerFn(probeAssetActions);
  const call = useServerFn(callAssetApi);
  const publish = useServerFn(publishAssetLabRef);
  const createTask = useServerFn(createAssetLabVideoTask);
  const getTask = useServerFn(getAssetLabVideoTask);

  const [busy, setBusy] = useState<string | null>(null);
  const [logs, setLogs] = useState<Log[]>([]);

  const [groupName, setGroupName] = useState("studio0103-test");
  const [groupId, setGroupId] = useState("");
  const [publicUrl, setPublicUrl] = useState("");
  const [assetId, setAssetId] = useState("");
  const [prompt, setPrompt] = useState("이미지1의 인물이 카메라를 향해 천천히 미소짓는다.");
  const [taskId, setTaskId] = useState("");

  const [action, setAction] = useState("ListAssetGroups");
  const [bodyJson, setBodyJson] = useState('{\n  "Filter": { "GroupType": "AIGC" },\n  "PageNumber": 1,\n  "PageSize": 10\n}');

  function push(label: string, detail: unknown, ok: boolean) {
    setLogs((prev) => [
      {
        at: new Date().toLocaleTimeString("ko-KR"),
        label,
        detail: typeof detail === "string" ? detail : JSON.stringify(detail, null, 2),
        ok,
      },
      ...prev,
    ]);
  }

  async function runProbe(kind: string, body: unknown, label: string) {
    setBusy(kind);
    try {
      const res = await probe({ data: { kind, bodyJson: JSON.stringify(body) } });
      if (res.error) {
        push(label, res.error, false);
        return;
      }
      const summary = res.items.map((item) => ({
        action: item.action,
        status: item.result.status,
        errorCode: item.result.errorCode ?? null,
        errorMessage: item.result.errorMessage ?? null,
        body: item.result.body.slice(0, 400),
      }));
      const passed = res.items.filter((item) => item.result.ok).map((item) => item.action);
      push(`${label} — 통과: ${passed.length ? passed.join(", ") : "없음"}`, summary, passed.length > 0);
      if (passed.length) toast.success(`통과한 Action: ${passed.join(", ")}`);
      else toast.error("모든 후보 Action 이 거부되었습니다. 상세 로그를 확인하세요.");
    } finally {
      setBusy(null);
    }
  }

  async function runRawCall() {
    setBusy("raw");
    try {
      const res = await call({ data: { action, bodyJson } });
      push(`직접 호출 ${action}`, res, res.ok);
      if (res.ok) toast.success(`${action} 성공 (HTTP ${res.status})`);
      else toast.error(res.errorCode ?? `HTTP ${res.status}`);
    } finally {
      setBusy(null);
    }
  }

  async function uploadImage(file: File) {
    if (!tenantId) {
      toast.error("테넌트를 확인할 수 없습니다.");
      return;
    }
    setBusy("upload");
    try {
      const path = `${tenantId}/asset-lab/${Date.now()}-${crypto.randomUUID()}-${file.name}`;
      const { error } = await supabase.storage
        .from("character-refs")
        .upload(path, file, { contentType: file.type || "image/png", upsert: false });
      if (error) throw error;
      const res = await publish({ data: { storagePath: path, tenantId } });
      if (!res.ok) throw new Error(res.error ?? "PUBLISH_FAILED");
      setPublicUrl(res.url);
      push("공개 URL 발급", res.url, true);
      toast.success("공개 URL 발급 완료");
    } catch (e) {
      push("공개 URL 발급", e instanceof Error ? e.message : String(e), false);
      toast.error(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  }

  async function runGenerate() {
    const ref = assetId.trim() ? (assetId.startsWith("asset://") ? assetId.trim() : `asset://${assetId.trim()}`) : publicUrl;
    if (!ref) {
      toast.error("asset ID 또는 공개 URL 이 필요합니다.");
      return;
    }
    setBusy("generate");
    try {
      const res = await createTask({ data: { prompt, ref } });
      push("영상 태스크 생성", res, res.ok);
      if (res.ok) {
        setTaskId(res.taskId);
        toast.success(`태스크 생성: ${res.taskId}`);
      } else {
        toast.error(res.error ?? "생성 실패");
      }
    } finally {
      setBusy(null);
    }
  }

  async function pollTask() {
    if (!taskId) return;
    setBusy("poll");
    try {
      const res = await getTask({ data: { taskId } });
      push(`태스크 상태 ${taskId}`, res, res.ok && res.status !== "failed");
    } finally {
      setBusy(null);
    }
  }

  const spin = (key: string) => busy === key && <Loader2 className="h-4 w-4 animate-spin" />;

  return (
    <main className="mx-auto w-full max-w-4xl space-y-4 p-4 md:p-6">
      <header className="space-y-1">
        <h1 className="text-xl font-black flex items-center gap-2">
          <FlaskConical className="h-5 w-5" /> 자산고 진단 콘솔
        </h1>
        <p className="text-sm text-muted-foreground">
          Phase 0(스펙 확정) + Phase 1(왕복 1회)을 이 화면에서 그대로 수행합니다. 각 버튼은 실제 BytePlus 계정에
          AK/SK 서명 요청을 보내고, 응답 원문을 아래 로그에 남깁니다.
        </p>
      </header>

      <Section step={1} title="Action 이름 탐색 (그룹)">
        <div className="flex flex-wrap gap-2">
          <Button
            size="sm"
            variant="outline"
            disabled={!!busy}
            onClick={() => runProbe("listGroups", { Filter: { GroupType: "AIGC" }, PageNumber: 1, PageSize: 10 }, "그룹 목록 후보")}
          >
            {spin("listGroups")} 그룹 목록 후보 시험
          </Button>
          <Input
            className="h-9 w-52"
            value={groupName}
            onChange={(e) => setGroupName(e.target.value)}
            placeholder="그룹 이름"
          />
          <Button
            size="sm"
            disabled={!!busy}
            onClick={() => runProbe("createGroup", { GroupName: groupName, GroupType: "AIGC" }, "그룹 생성 후보")}
          >
            {spin("createGroup")} 그룹 생성 후보 시험
          </Button>
        </div>
        <div className="flex gap-2">
          <Label className="sr-only" htmlFor="gid">GroupId</Label>
          <Input id="gid" className="h-9" value={groupId} onChange={(e) => setGroupId(e.target.value)} placeholder="응답에서 받은 GroupId 를 여기에 붙여넣기" />
        </div>
      </Section>

      <Section step={2} title="참고 이미지 → 토큰 없는 공개 URL">
        <div className="flex items-center gap-2">
          <Button size="sm" variant="outline" disabled={!!busy} asChild>
            <label className="cursor-pointer">
              {spin("upload")} <Upload className="h-4 w-4" /> 이미지 업로드
              <input
                type="file"
                accept="image/*"
                className="hidden"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) void uploadImage(file);
                  e.target.value = "";
                }}
              />
            </label>
          </Button>
          <Input className="h-9" value={publicUrl} onChange={(e) => setPublicUrl(e.target.value)} placeholder="공개 URL" />
        </div>
      </Section>

      <Section step={3} title="입고(ingest) Action 탐색">
        <Button
          size="sm"
          disabled={!!busy || !publicUrl}
          onClick={() =>
            runProbe(
              "ingest",
              { GroupId: groupId || undefined, ImageUrl: publicUrl, Label: groupName, AssetType: "image" },
              "자산 입고 후보",
            )
          }
        >
          {spin("ingest")} 자산 입고 후보 시험
        </Button>
        <Input className="h-9" value={assetId} onChange={(e) => setAssetId(e.target.value)} placeholder="응답에서 받은 asset ID (asset-2026...)" />
        <Button
          size="sm"
          variant="outline"
          disabled={!!busy || !assetId}
          onClick={() => runProbe("getAsset", { AssetId: assetId }, "자산 상태 조회 후보")}
        >
          {spin("getAsset")} 상태 폴링 후보 시험
        </Button>
      </Section>

      <Section step={4} title="실사 인물 인증 세션 (리스크 1번 검증)">
        <div className="flex flex-wrap gap-2">
          <Button size="sm" variant="outline" disabled={!!busy} onClick={() => runProbe("realPersonSession", {}, "실사 인증 세션 생성 후보")}>
            {spin("realPersonSession")} 세션 생성 후보 시험
          </Button>
          <Button size="sm" variant="outline" disabled={!!busy} onClick={() => runProbe("getRealPersonSession", {}, "실사 인증 세션 조회 후보")}>
            {spin("getRealPersonSession")} 세션 조회 후보 시험
          </Button>
        </div>
        <p className="text-xs text-muted-foreground">
          세션이 생성되면 응답의 H5Link(QR) 를 배우 휴대폰으로 열어 활체 인증을 진행하고, 결과 조회에서 GroupId 를 받습니다.
          인증 전 404 는 정상 응답입니다.
        </p>
      </Section>

      <Section step={5} title="asset:// 로 5초 테스트 영상 생성">
        <Textarea rows={2} value={prompt} onChange={(e) => setPrompt(e.target.value)} />
        <p className="text-xs text-muted-foreground">
          프롬프트 본문에 asset ID 를 쓰지 말고 "이미지1" 로 지칭하세요. asset ID 가 비어 있으면 공개 URL 로 대조 테스트합니다.
        </p>
        <div className="flex flex-wrap gap-2">
          <Button size="sm" disabled={!!busy} onClick={() => void runGenerate()}>
            {spin("generate")} <Play className="h-4 w-4" /> 테스트 생성
          </Button>
          <Input className="h-9 w-64" value={taskId} onChange={(e) => setTaskId(e.target.value)} placeholder="task id" />
          <Button size="sm" variant="outline" disabled={!!busy || !taskId} onClick={() => void pollTask()}>
            {spin("poll")} 상태 조회
          </Button>
        </div>
      </Section>

      <Section step={6} title="직접 호출 (자유 Action / Body)">
        <div className="flex gap-2">
          <Input className="h-9 w-64" value={action} onChange={(e) => setAction(e.target.value)} placeholder="Action" />
          <Button size="sm" disabled={!!busy} onClick={() => void runRawCall()}>
            {spin("raw")} 호출
          </Button>
        </div>
        <Textarea rows={6} className="font-mono text-xs" value={bodyJson} onChange={(e) => setBodyJson(e.target.value)} />
      </Section>

      <section className="space-y-2">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-bold">응답 로그</h2>
          <Button size="sm" variant="ghost" onClick={() => setLogs([])}>
            지우기
          </Button>
        </div>
        {logs.length === 0 && <p className="text-sm text-muted-foreground">아직 호출 기록이 없습니다.</p>}
        {logs.map((log, i) => (
          <details key={`${log.at}-${i}`} open={i === 0} className="rounded-lg border border-border bg-card p-3">
            <summary className="cursor-pointer text-sm font-medium">
              <span className={log.ok ? "text-emerald-500" : "text-destructive"}>{log.ok ? "성공" : "실패"}</span>{" "}
              {log.at} · {log.label}
            </summary>
            <pre className="mt-2 max-h-80 overflow-auto whitespace-pre-wrap break-all rounded bg-muted p-2 text-[11px]">
              {log.detail}
            </pre>
          </details>
        ))}
      </section>
    </main>
  );
}
