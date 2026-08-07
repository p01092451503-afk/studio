import { useEffect, useMemo, useState, type DragEvent, type ReactNode } from "react";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { AlertCircle, CheckCircle2, CircleHelp, Download, Film, ImagePlus, Loader2, Monitor, RefreshCw, Trash2, Video, Volume2, VolumeX, X } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useTenant } from "@/hooks/useTenant";
import { useVideoGeneration } from "@/hooks/useVideoGeneration";
import { useSignedUrl } from "@/hooks/useSignedUrl";
import { SignedImage } from "@/components/SignedImage";
import { VideoOnboardingTour, shouldStartVideoTour } from "@/components/video-onboarding-tour";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { analyzeReferences, type ReferenceBrief } from "@/lib/reference-analysis.functions";
import { composeVideoPrompt } from "@/lib/video-prompt.functions";
import { checkVideoModelHealth } from "@/lib/video-health.functions";
import { explainVideoError } from "@/lib/video-errors";
import { recoverStaleServerFunction } from "@/lib/server-function-recovery";
import { estimateSeedanceVideoCost, type SeedanceResolution } from "@/lib/video-constants";
import { extractVideoFrames } from "@/lib/videoFrames";

type ReferenceRoleId = "character" | "background" | "costume" | "prop" | "pose" | "style" | "motion";
type MediaAsset = { id: string; name: string; kind: "image" | "video"; tag: string; role: ReferenceRoleId | null; coverPath: string; framePaths: string[] };
type ValidationState = "valid" | "invalid" | "missing" | "available" | "configured" | "unavailable" | "not_configured" | "unknown";
type HealthModel = { provider: string; label: string; status: "available" | "unavailable" | "unknown"; detail: string; validation?: { credential: ValidationState; model: ValidationState; endpoint: ValidationState; configuredEndpoint: string | null } };
type Health = { checkedAt: string; models: HealthModel[] };
type CostSummary = { completedCount: number; estimatedTotal: number };

const REFERENCE_ROLES: { id: ReferenceRoleId; ko: string; en: string }[] = [
  { id: "character", ko: "캐릭터", en: "the main character identity (face, hair, body proportions)" },
  { id: "background", ko: "배경", en: "the background environment and location" },
  { id: "costume", ko: "의상", en: "the outfit and clothing design" },
  { id: "prop", ko: "소품", en: "a prop or object appearing in the scene" },
  { id: "pose", ko: "포즈/구도", en: "the pose, composition and camera framing" },
  { id: "style", ko: "스타일", en: "the art style, color grading and finish" },
  { id: "motion", ko: "동작/모션", en: "the motion and action timing" },
];

function roleLabel(id: ReferenceRoleId) {
  return REFERENCE_ROLES.find((role) => role.id === id)?.ko ?? id;
}

function autoRoleFor(kind: "image" | "video", imageIndex: number): ReferenceRoleId {
  if (kind === "video") return "motion";
  if (imageIndex === 0) return "character";
  if (imageIndex === 1) return "background";
  if (imageIndex === 2) return "costume";
  return "style";
}

function buildRoleDirective(assets: MediaAsset[]) {
  const tagged = assets.filter((asset) => asset.role);
  if (!tagged.length) return "";
  return tagged
    .map((asset) => {
      const role = REFERENCE_ROLES.find((item) => item.id === asset.role);
      return `${asset.tag} is the reference for ${role?.en ?? asset.role}.`;
    })
    .join(" ");
}


function removeLegacyMentionMarkers(value: string) {
  return value.replace(/@(?=[\p{L}\p{N}_-])/gu, "");
}

function getFigureNumber(fileName: string) {
  const match = fileName.match(/(?:^|[^\p{L}\p{N}])figure[\s_-]*(\d+)/iu);
  if (!match) return null;
  const value = Number(match[1]);
  return Number.isSafeInteger(value) && value > 0 ? value : null;
}

function prepareFigureFiles(fileList: FileList) {
  const files = Array.from(fileList).map((file, originalIndex) => ({
    file,
    originalIndex,
    figureNumber: getFigureNumber(file.name),
  }));
  const numberedFiles = files.filter((item) => item.figureNumber !== null);
  const maxFigureNumber = numberedFiles.reduce((max, item) => Math.max(max, item.figureNumber ?? 0), 0);
  const availableNumbers = new Set(numberedFiles.map((item) => item.figureNumber));
  const missingFigureNumbers = Array.from(
    { length: maxFigureNumber },
    (_, index) => index + 1,
  ).filter((figureNumber) => !availableNumbers.has(figureNumber));

  files.sort((a, b) => {
    if (a.figureNumber !== null && b.figureNumber !== null) {
      return a.figureNumber - b.figureNumber || a.originalIndex - b.originalIndex;
    }
    if (a.figureNumber !== null) return -1;
    if (b.figureNumber !== null) return 1;
    return a.originalIndex - b.originalIndex;
  });

  return { files: files.map((item) => item.file), missingFigureNumbers };
}

export function VideoPlaygroundPage() {
  const { tenantId } = useTenant();
  const gen = useVideoGeneration(tenantId);
  const analyze = useServerFn(analyzeReferences);
  const compose = useServerFn(composeVideoPrompt);
  const checkHealth = useServerFn(checkVideoModelHealth);
  const [assets, setAssets] = useState<MediaAsset[]>([]);
  const [prompt, setPrompt] = useState("");
  const [resolution, setResolution] = useState<SeedanceResolution>("480p");
  const [durationSeconds, setDurationSeconds] = useState(5);
  const [aspectRatio, setAspectRatio] = useState("9:16");
  const [outputQuantity, setOutputQuantity] = useState(1);
  const [generateAudio, setGenerateAudio] = useState(true);
  const [rawPromptMode, setRawPromptMode] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [dragActive, setDragActive] = useState(false);
  const [preparing, setPreparing] = useState(false);
  const [tourOpen, setTourOpen] = useState(false);
  const [health, setHealth] = useState<Health | null>(null);
  const [checkingHealth, setCheckingHealth] = useState(false);
  const [costSummary, setCostSummary] = useState<CostSummary>({ completedCount: 0, estimatedTotal: 0 });

  useEffect(() => { if (shouldStartVideoTour()) setTourOpen(true); }, []);
  useEffect(() => {
    let active = true;
    const run = async () => { setCheckingHealth(true); try { const result = await checkHealth({ data: undefined }); if (active) setHealth(result as Health); } catch (error) { if (recoverStaleServerFunction(error)) return; if (active) setHealth(null); } finally { if (active) setCheckingHealth(false); } };
    void run();
    const timer = window.setInterval(() => void run(), 30_000);
    return () => { active = false; window.clearInterval(timer); };
  }, [checkHealth]);
  useEffect(() => {
    if (!tenantId) {
      setCostSummary({ completedCount: 0, estimatedTotal: 0 });
      return;
    }
    let active = true;
    const loadCostSummary = async () => {
      const { data, error } = await supabase
        .from("video_generations")
        .select("resolution, duration_seconds, actual_resolution, actual_duration_seconds, options")
        .eq("tenant_id", tenantId)
        .eq("status", "done");
      if (!active || error) return;
      const estimatedTotal = (data ?? []).reduce((total, item) => {
        const selectedResolution = item.actual_resolution ?? item.resolution;
        const safeResolution: SeedanceResolution =
          selectedResolution === "480p" ||
          selectedResolution === "1080p" ||
          selectedResolution === "4K"
            ? selectedResolution
            : "720p";
        const selectedDuration = item.actual_duration_seconds ?? item.duration_seconds ?? 0;
        const options = item.options && typeof item.options === "object" && !Array.isArray(item.options)
          ? item.options as Record<string, unknown>
          : {};
        const quantity = typeof options.outputQuantity === "number" ? options.outputQuantity : 1;
        return total + estimateSeedanceVideoCost(safeResolution, Number(selectedDuration)) * quantity;
      }, 0);
      setCostSummary({ completedCount: data?.length ?? 0, estimatedTotal });
    };
    void loadCostSummary();
    return () => { active = false; };
  }, [tenantId, gen.row?.id, gen.row?.status]);

  const studyPaths = useMemo(() => assets.flatMap((asset) => asset.framePaths).slice(0, 8), [assets]);
  const firstReference = studyPaths[0] ?? null;
  const hasVideo = assets.some((asset) => asset.kind === "video");
  const readyCount = health?.models.filter((model) => model.status === "available").length ?? 0;
  const seedanceHealth = health?.models.find((model) => model.provider === "seedance") ?? null;
  const busy = uploading || preparing || gen.running;
  const estimatedCost = useMemo(
    () => estimateSeedanceVideoCost(resolution, durationSeconds) * outputQuantity,
    [resolution, durationSeconds, outputQuantity],
  );

  async function uploadBlob(blob: Blob, name: string) {
    if (!tenantId) throw new Error("NO_TENANT");
    const path = `${tenantId}/video-refs/${Date.now()}-${crypto.randomUUID()}-${name}`;
    const { error } = await supabase.storage.from("character-refs").upload(path, blob, { contentType: blob.type || "image/jpeg", upsert: false });
    if (error) throw error;
    return path;
  }

  async function addMedia(files: FileList) {
    setUploading(true);
    try {
      const added: MediaAsset[] = [];
      const prepared = prepareFigureFiles(files);
      let imageCount = assets.filter((asset) => asset.kind === "image").length;
      let videoCount = assets.filter((asset) => asset.kind === "video").length;
      for (const file of prepared.files) {
        if (assets.length + added.length >= 6) break;
        if (file.type.startsWith("video/")) {
          const frames = await extractVideoFrames(file, 3);
          const paths: string[] = [];
          for (let i = 0; i < frames.length; i += 1) paths.push(await uploadBlob(frames[i], `frame-${i}.jpg`));
          if (paths.length) {
            videoCount += 1;
            added.push({ id: crypto.randomUUID(), name: file.name, kind: "video", tag: `@video${videoCount}`, role: autoRoleFor("video", videoCount - 1), coverPath: paths[0], framePaths: paths });
          }
        } else if (file.type.startsWith("image/")) {
          const extension = file.name.split(".").pop() || "jpg";
          const path = await uploadBlob(file, `reference.${extension}`);
          imageCount += 1;
          added.push({ id: crypto.randomUUID(), name: file.name, kind: "image", tag: `@image${imageCount}`, role: autoRoleFor("image", imageCount - 1), coverPath: path, framePaths: [path] });
        }
      }
      if (!added.length) throw new Error("Add an image or video file.");
      setAssets((current) => [...current, ...added].slice(0, 6));
      const missingNotice = prepared.missingFigureNumbers.length
        ? ` Missing: ${prepared.missingFigureNumbers.map((number) => `Figure ${number}`).join(", ")}.`
        : "";
      toast.success(`${added.map((asset) => asset.tag).join(", ")} 태깅 완료 · 역할은 자동 추천되었습니다.${missingNotice}`, {
        duration: prepared.missingFigureNumbers.length ? 7000 : 4000,
      });

    } catch (error) { toast.error(error instanceof Error ? error.message : String(error)); }
    finally { setUploading(false); }
  }

  function handleReferenceDrag(event: DragEvent<HTMLLabelElement>) {
    event.preventDefault();
    event.stopPropagation();
    if (busy) return;
    if (event.type === "dragenter" || event.type === "dragover") setDragActive(true);
    if (event.type === "dragleave") setDragActive(false);
  }

  function handleReferenceDrop(event: DragEvent<HTMLLabelElement>) {
    event.preventDefault();
    event.stopPropagation();
    setDragActive(false);
    if (busy || !event.dataTransfer.files.length) return;
    void addMedia(event.dataTransfer.files);
  }

  async function generate() {
    if (!prompt.trim()) return toast.error("Describe the video you want to create.");
    setPreparing(true);
    try {
      const plainPrompt = removeLegacyMentionMarkers(prompt.trim());
      const roleDirective = buildRoleDirective(assets);
      let brief: ReferenceBrief | null = null;
      let finalPrompt = roleDirective ? `${roleDirective}\n${plainPrompt}` : plainPrompt;
      if (!rawPromptMode) {
        if (studyPaths.length) {
          brief = await analyze({ data: { imagePaths: studyPaths, intent: plainPrompt, hasVideoFrames: hasVideo } }) as ReferenceBrief;
        }
        const composed = await compose({ data: {
          subject: [brief?.subject, roleDirective].filter(Boolean).join(" "), action: plainPrompt,
          camera: [brief?.camera, brief?.motion].filter(Boolean).join("; "),
          lighting: brief?.lighting ?? "", style: brief?.style ?? "",
        } });
        finalPrompt = composed.finalPrompt;
      }
      await gen.run({
        workLabel: "Playground", provider: "seedance", mode: firstReference ? "i2v" : "t2v",
        finalPrompt, negativePrompt: brief?.negative || undefined,
         rawPrompt: plainPrompt, promptEdited: !rawPromptMode, aspectRatio: aspectRatio === "Auto" ? "adaptive" : aspectRatio, resolution,
         durationSeconds, outputQuantity, generateAudio, cameraFixed: false, seed: null, imagePaths: studyPaths,
        options: { playground: true, rawPromptMode, referenceStudyPaths: studyPaths, referenceHasVideo: hasVideo, referenceBrief: brief, referenceRoleDirective: roleDirective,
          references: assets.map((asset) => ({ name: asset.name, kind: asset.kind, tag: asset.tag, role: asset.role, directlySuppliedToModel: true })) },
      });

      toast.success("Your video is now being created.");
    } catch (error) { toast.error(error instanceof Error ? error.message : String(error)); }
    finally { setPreparing(false); }
  }

  return <main className="px-4 py-5 sm:px-6">
    <div className="mx-auto mt-5 max-w-6xl">
      <header className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="mt-2 text-3xl font-extrabold">What do you want to create?</h1>
          <p className="mt-2 max-w-2xl text-sm leading-relaxed text-muted-foreground">Add reference images or videos, then describe your scene. Their subjects, visual style, lighting, and motion are studied and supplied directly to the video model.</p></div>
        <div className="flex items-center gap-2"><Button variant="outline" size="sm" onClick={() => void checkHealth({ data: undefined }).then((result) => { setHealth(result as Health); toast.success("ARK connection checked."); }).catch((error) => { if (!recoverStaleServerFunction(error)) toast.error("Connection check failed."); })} disabled={checkingHealth}><RefreshCw className={checkingHealth ? "h-4 w-4 animate-spin" : "h-4 w-4"} /> Validate ARK</Button><span className="rounded-full border border-border bg-card px-3 py-2 text-xs font-semibold text-muted-foreground">{health ? `${readyCount} engine${readyCount === 1 ? "" : "s"} ready` : "Checking engines"}</span>
          <Button variant="outline" size="icon" onClick={() => setTourOpen(true)} aria-label="Open quick tour"><CircleHelp className="h-4 w-4" /></Button></div>
      </header>
      {seedanceHealth && <section className="mb-6 rounded-lg border border-border bg-card p-4"><div className="flex items-start gap-3">{seedanceHealth.status === "available" ? <CheckCircle2 className="mt-0.5 h-5 w-5 text-primary" /> : <AlertCircle className="mt-0.5 h-5 w-5 text-muted-foreground" />}<div className="min-w-0 flex-1"><div className="flex flex-wrap items-center gap-2"><h2 className="text-sm font-bold">ARK / Seedance 2.0 validation</h2><span className="rounded-full border border-border px-2 py-0.5 text-xs font-semibold">{seedanceHealth.status}</span></div><p className="mt-1 text-xs leading-relaxed text-muted-foreground">{seedanceHealth.detail}</p>{seedanceHealth.validation && <div className="mt-3 grid gap-2 sm:grid-cols-3"><ValidationItem label="API key" value={seedanceHealth.validation.credential} /><ValidationItem label="Seedance model" value={seedanceHealth.validation.model} /><ValidationItem label="Configured endpoint" value={seedanceHealth.validation.endpoint} /></div>}</div></div></section>}
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_360px]">
        <section data-video-tour="playground" className="overflow-hidden rounded-lg border border-border bg-card">
          <div className="border-b border-border px-6 py-4"><h2 className="font-bold">Create a video</h2><p className="mt-1 text-xs text-muted-foreground">Uploaded references are analyzed and used during generation. Your prompt is required.</p></div>
          <div className="space-y-6 p-6">
            <div data-video-tour="references" className="space-y-3"><div className="flex items-center justify-between"><Label className="font-bold">Reference images & videos</Label>{assets.length > 0 && <Button variant="ghost" size="sm" onClick={() => setAssets([])}><Trash2 className="h-4 w-4" /> Clear</Button>}</div>
              <label onDragEnter={handleReferenceDrag} onDragOver={handleReferenceDrag} onDragLeave={handleReferenceDrag} onDrop={handleReferenceDrop} className={`flex min-h-36 cursor-pointer flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed px-5 text-center transition-colors ${dragActive ? "border-primary bg-primary-soft" : "border-border bg-muted/30 hover:border-primary/50 hover:bg-primary-soft"}`}>{uploading ? <Loader2 className="h-7 w-7 animate-spin text-primary" /> : <ImagePlus className="h-7 w-7 text-primary" />}<span className="text-sm font-bold">{uploading ? "Preparing references…" : dragActive ? "Drop files to add them" : "Add or drag images and videos"}</span><span className="text-xs text-muted-foreground">Up to 6 files · images teach appearance and style · videos teach motion</span>
                <input type="file" accept="image/*,video/*" multiple className="hidden" disabled={busy} onChange={(event) => { if (event.target.files?.length) void addMedia(event.target.files); event.target.value = ""; }} /></label>
              {assets.length > 0 && <div className="space-y-3">
                <p className="text-xs leading-relaxed text-muted-foreground">업로드하면 <span className="font-semibold text-foreground">@image1 · @video1</span> 형식으로 자동 태깅됩니다. 각 참고 자료의 역할을 아래에서 선택하면 프롬프트에 자동 반영됩니다.</p>
                <div className="grid gap-3 sm:grid-cols-2">{assets.map((asset) => <div key={asset.id} className="overflow-hidden rounded-lg border border-border bg-muted/30">
                  <SignedImage bucket="character-refs" path={asset.coverPath} alt={asset.name} className="aspect-video w-full object-cover" />
                  <div className="flex items-center gap-2 px-3 py-2">{asset.kind === "video" ? <Video className="h-3.5 w-3.5 text-primary" /> : <ImagePlus className="h-3.5 w-3.5 text-primary" />}<span className="rounded-full bg-primary-soft px-2 py-0.5 text-xs font-bold text-primary">{asset.tag}</span><span className="min-w-0 flex-1 truncate text-xs text-muted-foreground">{asset.name}</span><Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => setAssets((current) => current.filter((item) => item.id !== asset.id))} aria-label={`Remove ${asset.name}`}><X className="h-3.5 w-3.5" /></Button></div>
                  <div className="border-t border-border px-3 py-2">
                    <p className="text-xs font-bold">{asset.tag}은(는) 어떤 역할인가요?</p>
                    <div role="radiogroup" aria-label={`${asset.tag} role`} className="mt-2 flex flex-wrap gap-1">{REFERENCE_ROLES.map((role) => <button key={role.id} type="button" role="radio" aria-checked={asset.role === role.id} disabled={busy} onClick={() => setAssets((current) => current.map((item) => item.id === asset.id ? { ...item, role: role.id } : item))} className={`rounded-full border px-2.5 py-1 text-xs font-semibold transition-colors ${asset.role === role.id ? "border-primary bg-primary text-primary-foreground" : "border-border bg-card text-muted-foreground hover:border-primary/50"}`}>{role.ko}</button>)}</div>
                  </div>
                </div>)}</div>
              </div>}

            </div>
            <div data-video-tour="prompt" className="space-y-3"><div className="flex justify-between"><Label htmlFor="video-prompt" className="font-bold">Describe your video</Label><span className="text-xs text-muted-foreground">{prompt.length}/3000</span></div><Textarea id="video-prompt" value={prompt} maxLength={3000} disabled={busy} onChange={(event) => setPrompt(event.target.value)} placeholder="A woman in a red coat walks through a rainy neon street, then turns toward the camera and smiles…" className="min-h-44 resize-y rounded-lg text-base leading-relaxed" /><p className="text-xs text-muted-foreground">Write naturally in English. Uploaded references are used automatically—no tags are needed.</p>
              <div className="flex items-start justify-between gap-3 rounded-lg border border-border bg-muted/20 p-3">
                <div className="min-w-0"><p className="text-xs font-bold">원문 그대로 전달 모드</p><p className="mt-1 text-xs leading-relaxed text-muted-foreground">{rawPromptMode ? "AI 재작성 없이 입력한 프롬프트를 그대로 Seedance에 보냅니다. 참고 이미지·영상은 계속 함께 전달됩니다." : "AI가 참고 자료를 분석해 프롬프트를 다듬어 전달합니다."}</p></div>
                <div className="flex shrink-0 gap-1 rounded-md border border-border bg-card p-1">
                  <Button type="button" size="sm" variant={!rawPromptMode ? "default" : "ghost"} className="h-8 px-3 text-xs" disabled={busy} onClick={() => setRawPromptMode(false)}>AI 다듬기</Button>
                  <Button type="button" size="sm" variant={rawPromptMode ? "default" : "ghost"} className="h-8 px-3 text-xs" disabled={busy} onClick={() => setRawPromptMode(true)}>원문 그대로</Button>
                </div>
              </div>
            </div>
             <div className="space-y-5 rounded-lg border border-border bg-muted/20 p-4">
               <p className="text-xs leading-relaxed text-muted-foreground">Default settings are preset to the most common short-form format: <span className="font-semibold text-foreground">9:16 ratio, 480p resolution, 5 seconds, 1 video, sound on</span>. You can change them below.</p>
               <OptionRow label="Ratio"><div className="grid grid-cols-4 gap-1 sm:grid-cols-7">{["21:9", "16:9", "4:3", "1:1", "3:4", "9:16", "Auto"].map((ratio) => <Button key={ratio} type="button" size="sm" variant={aspectRatio === ratio ? "default" : "ghost"} className="h-9 px-2 text-xs" disabled={busy} onClick={() => setAspectRatio(ratio)}><Monitor className="h-3.5 w-3.5" />{ratio}</Button>)}</div></OptionRow>
               <OptionRow label="Resolution"><div className="grid grid-cols-3 gap-1">{(["480p", "720p", "1080p"] as SeedanceResolution[]).map((value) => <Button key={value} type="button" size="sm" variant={resolution === value ? "default" : "ghost"} className="h-9" disabled={busy} onClick={() => setResolution(value)}>{value.toUpperCase()}</Button>)}</div></OptionRow>
               <OptionRow label="Duration"><div className="grid grid-cols-5 gap-1">{[4, 5, 6, 8, 10].map((seconds) => <Button key={seconds} type="button" size="sm" variant={durationSeconds === seconds ? "default" : "ghost"} className="h-9" disabled={busy} onClick={() => setDurationSeconds(seconds)}>{seconds}s</Button>)}</div></OptionRow>
               <OptionRow label="Number of videos"><div className="grid grid-cols-4 gap-1">{[1, 2, 3, 4].map((quantity) => <Button key={quantity} type="button" size="sm" variant={outputQuantity === quantity ? "default" : "ghost"} className="h-9" disabled={busy} onClick={() => setOutputQuantity(quantity)}>{quantity}</Button>)}</div></OptionRow>
               <OptionRow label="Output sound"><div className="grid grid-cols-2 gap-1"><Button type="button" size="sm" variant={generateAudio ? "default" : "ghost"} className="h-9" disabled={busy} onClick={() => setGenerateAudio(true)}><Volume2 className="h-4 w-4" />On</Button><Button type="button" size="sm" variant={!generateAudio ? "default" : "ghost"} className="h-9" disabled={busy} onClick={() => setGenerateAudio(false)}><VolumeX className="h-4 w-4" />Off</Button></div></OptionRow>
              <div className="grid gap-4 border-t border-border pt-3 sm:col-span-2 sm:grid-cols-2">
                 <div className="flex items-end justify-between gap-3 border-b border-border pb-4 sm:border-b-0 sm:border-r sm:pb-0 sm:pr-4"><div><p className="text-xs font-bold">Estimated request cost</p><p className="mt-1 text-xs leading-relaxed text-muted-foreground">{outputQuantity} video{outputQuantity === 1 ? "" : "s"} · current settings</p></div><p className="shrink-0 text-xl font-extrabold tabular-nums">${estimatedCost.toFixed(2)} <span className="text-xs font-semibold text-muted-foreground">USD</span></p></div>
                <div className="flex items-end justify-between gap-3 sm:pl-1"><div><p className="text-xs font-bold">Estimated cumulative cost</p><p className="mt-1 text-xs leading-relaxed text-muted-foreground">{costSummary.completedCount} completed generation{costSummary.completedCount === 1 ? "" : "s"}</p></div><p className="shrink-0 text-xl font-extrabold tabular-nums">${costSummary.estimatedTotal.toFixed(2)} <span className="text-xs font-semibold text-muted-foreground">USD</span></p></div>
              </div>
              <p className="text-xs leading-relaxed text-muted-foreground sm:col-span-2">Based on the official BytePlus pricing examples for the mainline Dreamina Seedance 2.0 model (16:9, 5s output): $0.35 / $0.76 / $1.87 per video at 480p / 720p / 1080p. Final billing can vary with the tokens reported by the provider. Uploaded videos are converted to reference frames in this playground.</p>
            </div>
            <Button data-video-tour="generate" onClick={generate} disabled={busy || !prompt.trim()} className="h-13 w-full text-base font-bold">{busy ? <Loader2 className="h-5 w-5 animate-spin" /> : <Film className="h-5 w-5" />}{preparing ? "Preparing the best prompt…" : gen.running ? "Generating video…" : "Generate video"}</Button>
          </div>
        </section>
        <aside data-video-tour="result" className="rounded-lg border border-border bg-card p-6"><h2 className="font-bold">Result</h2><p className="mt-1 text-xs text-muted-foreground">Your generated video appears here.</p><div className="mt-5 space-y-4">
          {gen.running && <EmptyResult loading />}{gen.recoveryNotice && <div className="flex gap-2 rounded-lg border border-primary/30 bg-primary-soft p-4 text-xs"><RefreshCw className="h-4 w-4 animate-spin text-primary" /><p>{gen.recoveryNotice}</p></div>}{gen.error && <ErrorCard message={gen.error} />}{gen.row?.results?.map((result) => <ResultVideo key={result.id} path={result.storage_path} />)}{!gen.running && !gen.row && !gen.error && <EmptyResult />}
          {gen.row?.final_prompt && <details className="rounded-lg border border-border p-4 text-xs"><summary className="cursor-pointer font-bold">View enhanced prompt</summary><p className="mt-3 whitespace-pre-wrap leading-relaxed text-muted-foreground">{gen.row.final_prompt}</p></details>}
        </div></aside>
      </div>
    </div><VideoOnboardingTour open={tourOpen} onOpenChange={setTourOpen} />
  </main>;
}

function EmptyResult({ loading = false }: { loading?: boolean }) { return <div className="flex min-h-56 flex-col items-center justify-center gap-3 rounded-lg border border-dashed border-border bg-muted/20 px-6 text-center">{loading ? <Loader2 className="h-8 w-8 animate-spin text-primary" /> : <Film className="h-8 w-8 text-muted-foreground" />}<p className="text-sm text-muted-foreground">{loading ? "Creating your video. You can safely leave this page." : "Add references if you have them, describe the scene, and generate."}</p></div>; }
function ErrorCard({ message }: { message: string }) { const info = explainVideoError(message); return <div className="rounded-lg border border-destructive/30 bg-destructive/10 p-4 text-xs"><p className="font-bold text-destructive">{info.title}</p><p className="mt-1 text-foreground/80">{info.hint}</p>{info.checks.length > 0 && <ul className="mt-2 list-disc space-y-1 pl-4">{info.checks.map((item) => <li key={item}>{item}</li>)}</ul>}</div>; }
function ResultVideo({ path }: { path: string }) { const url = useSignedUrl("generation-outputs", path, 300); const [downloading, setDownloading] = useState(false); async function download() { setDownloading(true); try { const name = path.split("/").pop() || "pilotstudio-video.mp4"; const { data, error } = await supabase.storage.from("generation-outputs").createSignedUrl(path, 60, { download: name }); if (error || !data?.signedUrl) throw error || new Error("Download failed"); const link = document.createElement("a"); link.href = data.signedUrl; link.download = name; document.body.appendChild(link); link.click(); link.remove(); } catch (error) { toast.error(error instanceof Error ? error.message : "Download failed"); } finally { setDownloading(false); } } if (!url) return <div className="aspect-video animate-pulse rounded-lg bg-muted" />; return <div className="space-y-3"><video src={url} controls playsInline className="aspect-video w-full rounded-lg border border-border bg-foreground object-contain" /><Button variant="outline" className="w-full" onClick={download} disabled={downloading}>{downloading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />} Download</Button></div>; }
function ValidationItem({ label, value }: { label: string; value: ValidationState }) { const positive = value === "valid" || value === "available"; return <div className="flex items-center justify-between rounded-md border border-border bg-muted/20 px-3 py-2 text-xs"><span className="text-muted-foreground">{label}</span><span className="font-bold">{positive ? "Ready" : value === "configured" ? "Configured" : value === "not_configured" ? "Not set" : value === "invalid" || value === "unavailable" || value === "missing" ? "Check required" : "Unknown"}</span></div>; }
function OptionRow({ label, children }: { label: string; children: ReactNode }) { return <div className="space-y-2"><Label className="text-xs font-bold">{label}</Label><div className="rounded-md border border-border bg-card p-1">{children}</div></div>; }