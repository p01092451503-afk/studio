import { useEffect, useMemo, useState, type DragEvent, type ReactNode } from "react";
import { useServerFn } from "@tanstack/react-start";
import { useTranslation } from "react-i18next";
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
import { type SeedanceResolution } from "@/lib/video-constants";
import { extractVideoFrames } from "@/lib/videoFrames";

type MediaKind = "image" | "video" | "audio";
type ReferenceRoleId =
  | "character" | "background" | "costume" | "prop" | "pose" | "composition" | "style"
  | "motion" | "camera" | "acting" | "scene_flow"
  | "dialogue" | "voice" | "music" | "sfx" | "mood"
  | "other";
type MediaAsset = { id: string; name: string; kind: MediaKind; tag: string; roles: ReferenceRoleId[]; coverPath: string | null; framePaths: string[] };
type ValidationState = "valid" | "invalid" | "missing" | "available" | "configured" | "unavailable" | "not_configured" | "unknown";
type HealthModel = { provider: string; label: string; status: "available" | "unavailable" | "unknown"; detail: string; validation?: { credential: ValidationState; model: ValidationState; endpoint: ValidationState; configuredEndpoint: string | null } };
type Health = { checkedAt: string; models: HealthModel[] };
type CostSummary = { completedCount: number; estimatedTotal: number };

const ROLE_OPTIONS: Record<MediaKind, ReferenceRoleId[]> = {
  image: ["character", "background", "costume", "pose", "composition", "style", "prop", "other"],
  video: ["motion", "camera", "acting", "scene_flow", "composition", "style", "other"],
  audio: ["dialogue", "voice", "music", "sfx", "mood", "other"],
};

const ROLE_ORDER: ReferenceRoleId[] = [
  "character", "costume", "prop", "background", "pose", "composition", "style",
  "motion", "camera", "acting", "scene_flow",
  "dialogue", "voice", "music", "sfx", "mood", "other",
];

const ROLE_SENTENCE: Record<ReferenceRoleId, (tags: string) => string> = {
  character: (tags) => `Keep the character identity from ${tags} — same face, hair and body proportions.`,
  costume: (tags) => `Dress the character in the outfit and clothing design shown in ${tags}.`,
  prop: (tags) => `Include the props and objects shown in ${tags}.`,
  background: (tags) => `Use ${tags} as the background environment and location.`,
  pose: (tags) => `Follow the pose and body placement shown in ${tags}.`,
  composition: (tags) => `Match the framing, shot size and composition of ${tags}.`,
  style: (tags) => `Match the art style, color grading and finish of ${tags}.`,
  motion: (tags) => `Follow the movement and action timing of ${tags}.`,
  camera: (tags) => `Follow the camera movement and blocking of ${tags}.`,
  acting: (tags) => `Follow the acting, facial expressions and emotion of ${tags}.`,
  scene_flow: (tags) => `Follow the scene progression and shot order of ${tags}.`,
  dialogue: (tags) => `Use the spoken lines heard in ${tags}.`,
  voice: (tags) => `Match the voice tone and delivery of ${tags}.`,
  music: (tags) => `Match the music and rhythm of ${tags}.`,
  sfx: (tags) => `Include sound effects like the ones in ${tags}.`,
  mood: (tags) => `Match the overall mood and atmosphere of ${tags}.`,
  other: (tags) => `Refer to ${tags} for additional details.`,
};

function autoRolesFor(kind: MediaKind, indexInKind: number): ReferenceRoleId[] {
  if (kind === "video") return ["motion", "camera"];
  if (kind === "audio") return ["mood"];
  if (indexInKind === 0) return ["character"];
  if (indexInKind === 1) return ["background"];
  if (indexInKind === 2) return ["costume"];
  return ["style"];
}

function buildRoleDirective(assets: MediaAsset[]) {
  const sentences: string[] = [];
  for (const role of ROLE_ORDER) {
    const tags = assets.filter((asset) => asset.roles.includes(role)).map((asset) => asset.tag);
    if (tags.length) sentences.push(ROLE_SENTENCE[role](tags.join(" and ")));
  }
  return sentences.join(" ");
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
  const { t } = useTranslation();
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

  useEffect(() => { if (shouldStartVideoTour()) setTourOpen(true); }, []);
  useEffect(() => {
    let active = true;
    const run = async () => { setCheckingHealth(true); try { const result = await checkHealth({ data: undefined }); if (active) setHealth(result as Health); } catch (error) { if (recoverStaleServerFunction(error)) return; if (active) setHealth(null); } finally { if (active) setCheckingHealth(false); } };
    void run();
    const timer = window.setInterval(() => void run(), 30_000);
    return () => { active = false; window.clearInterval(timer); };
  }, [checkHealth]);
  const studyPaths = useMemo(() => assets.flatMap((asset) => asset.framePaths).slice(0, 8), [assets]);
  const firstReference = studyPaths[0] ?? null;
  const hasVideo = assets.some((asset) => asset.kind === "video");
  const readyCount = health?.models.filter((model) => model.status === "available").length ?? 0;
  const seedanceHealth = health?.models.find((model) => model.provider === "seedance") ?? null;
  const busy = uploading || preparing || gen.running;

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
      let audioCount = assets.filter((asset) => asset.kind === "audio").length;
      for (const file of prepared.files) {
        if (assets.length + added.length >= 6) break;
        if (file.type.startsWith("video/")) {
          const frames = await extractVideoFrames(file, 3);
          const paths: string[] = [];
          for (let i = 0; i < frames.length; i += 1) paths.push(await uploadBlob(frames[i], `frame-${i}.jpg`));
          if (paths.length) {
            videoCount += 1;
            added.push({ id: crypto.randomUUID(), name: file.name, kind: "video", tag: `@video${videoCount}`, roles: autoRolesFor("video", videoCount - 1), coverPath: paths[0], framePaths: paths });
          }
        } else if (file.type.startsWith("image/")) {
          const extension = file.name.split(".").pop() || "jpg";
          const path = await uploadBlob(file, `reference.${extension}`);
          imageCount += 1;
          added.push({ id: crypto.randomUUID(), name: file.name, kind: "image", tag: `@image${imageCount}`, roles: autoRolesFor("image", imageCount - 1), coverPath: path, framePaths: [path] });
        } else if (file.type.startsWith("audio/")) {
          audioCount += 1;
          added.push({ id: crypto.randomUUID(), name: file.name, kind: "audio", tag: `@audio${audioCount}`, roles: autoRolesFor("audio", audioCount - 1), coverPath: null, framePaths: [] });
        }
      }

      if (!added.length) throw new Error(t("playground.toast_no_media"));
      setAssets((current) => [...current, ...added].slice(0, 6));
      const missingNotice = prepared.missingFigureNumbers.length
        ? t("playground.toast_missing", { list: prepared.missingFigureNumbers.map((number) => `Figure ${number}`).join(", ") })
        : "";
      toast.success(t("playground.toast_tagged", { tags: added.map((asset) => asset.tag).join(", "), missing: missingNotice }), {
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
    if (!prompt.trim()) return toast.error(t("playground.toast_need_prompt"));
    setPreparing(true);
    try {
      const plainPrompt = removeLegacyMentionMarkers(prompt.trim());
      const roleDirective = rawPromptMode ? "" : buildRoleDirective(assets);
      let brief: ReferenceBrief | null = null;
      // Raw mode = 사용자가 입력한 원문만 그대로 전송 (역할 지시문/AI 보정 모두 미적용)
      let finalPrompt = rawPromptMode
        ? plainPrompt
        : roleDirective
          ? `${roleDirective}\n${plainPrompt}`
          : plainPrompt;
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
          references: assets.map((asset) => ({ name: asset.name, kind: asset.kind, tag: asset.tag, roles: asset.roles, directlySuppliedToModel: asset.kind !== "audio" })) },
      });

      toast.success(t("playground.toast_started"));
    } catch (error) { toast.error(error instanceof Error ? error.message : String(error)); }
    finally { setPreparing(false); }
  }

  return <main className="px-4 py-5 sm:px-6">
    <div className="mx-auto mt-5 max-w-6xl">
      <header className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="mt-2 text-3xl font-extrabold">{t("playground.title")}</h1>
          <p className="mt-2 max-w-2xl text-sm leading-relaxed text-muted-foreground">{t("playground.subtitle")}</p></div>
        <div className="flex items-center gap-2"><Button variant="outline" size="sm" onClick={() => void checkHealth({ data: undefined }).then((result) => { setHealth(result as Health); toast.success(t("playground.toast_ark_ok")); }).catch((error) => { if (!recoverStaleServerFunction(error)) toast.error(t("playground.toast_ark_fail")); })} disabled={checkingHealth}><RefreshCw className={checkingHealth ? "h-4 w-4 animate-spin" : "h-4 w-4"} /> {t("playground.validate")}</Button><span className="rounded-full border border-border bg-card px-3 py-2 text-xs font-semibold text-muted-foreground">{health ? t("playground.engines_ready", { count: readyCount }) : t("playground.checking_engines")}</span>
          <Button variant="outline" size="icon" onClick={() => setTourOpen(true)} aria-label={t("playground.open_tour")}><CircleHelp className="h-4 w-4" /></Button></div>
      </header>
      {seedanceHealth && <section className="mb-6 rounded-lg border border-border bg-card p-4"><div className="flex items-start gap-3">{seedanceHealth.status === "available" ? <CheckCircle2 className="mt-0.5 h-5 w-5 text-primary" /> : <AlertCircle className="mt-0.5 h-5 w-5 text-muted-foreground" />}<div className="min-w-0 flex-1"><div className="flex flex-wrap items-center gap-2"><h2 className="text-sm font-bold">{t("playground.validation_title")}</h2><span className="rounded-full border border-border px-2 py-0.5 text-xs font-semibold">{seedanceHealth.status}</span></div><p className="mt-1 text-xs leading-relaxed text-muted-foreground">{seedanceHealth.detail}</p>{seedanceHealth.validation && <div className="mt-3 grid gap-2 sm:grid-cols-3"><ValidationItem label={t("playground.api_key")} value={seedanceHealth.validation.credential} /><ValidationItem label={t("playground.model")} value={seedanceHealth.validation.model} /><ValidationItem label={t("playground.endpoint")} value={seedanceHealth.validation.endpoint} /></div>}</div></div></section>}
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_360px]">
        <section data-video-tour="playground" className="overflow-hidden rounded-lg border border-border bg-card">
          <div className="border-b border-border px-6 py-4"><h2 className="font-bold">{t("playground.create_title")}</h2><p className="mt-1 text-xs text-muted-foreground">{t("playground.create_sub")}</p></div>
          <div className="space-y-6 p-6">
            <div data-video-tour="references" className="space-y-3"><div className="flex items-center justify-between"><Label className="font-bold">{t("playground.references_label")}</Label>{assets.length > 0 && <Button variant="ghost" size="sm" onClick={() => setAssets([])}><Trash2 className="h-4 w-4" /> {t("playground.clear")}</Button>}</div>
              <label onDragEnter={handleReferenceDrag} onDragOver={handleReferenceDrag} onDragLeave={handleReferenceDrag} onDrop={handleReferenceDrop} className={`flex min-h-36 cursor-pointer flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed px-5 text-center transition-colors ${dragActive ? "border-primary bg-primary-soft" : "border-border bg-muted/30 hover:border-primary/50 hover:bg-primary-soft"}`}>{uploading ? <Loader2 className="h-7 w-7 animate-spin text-primary" /> : <ImagePlus className="h-7 w-7 text-primary" />}<span className="text-sm font-bold">{uploading ? t("playground.uploading") : dragActive ? t("playground.drop_files") : t("playground.add_files")}</span><span className="text-xs text-muted-foreground">{t("playground.files_hint")}</span>
                <input type="file" accept="image/*,video/*,audio/*" multiple className="hidden" disabled={busy} onChange={(event) => { if (event.target.files?.length) void addMedia(event.target.files); event.target.value = ""; }} /></label>
              {assets.length > 0 && <div className="space-y-3">
                <p className="text-xs leading-relaxed text-muted-foreground">{t("playground.tag_hint_1")} <span className="font-semibold text-foreground">@image1 · @video1 · @audio1</span> {t("playground.tag_hint_2")}</p>
                <div className="grid gap-3 sm:grid-cols-2">{assets.map((asset) => <div key={asset.id} className="overflow-hidden rounded-lg border border-border bg-muted/30">
                  {asset.coverPath
                    ? <SignedImage bucket="character-refs" path={asset.coverPath} alt={asset.name} className="aspect-video w-full object-cover" />
                    : <div className="flex aspect-video w-full items-center justify-center bg-primary-soft"><Volume2 className="h-8 w-8 text-primary" /></div>}
                  <div className="flex items-center gap-2 px-3 py-2">{asset.kind === "video" ? <Video className="h-3.5 w-3.5 text-primary" /> : asset.kind === "audio" ? <Volume2 className="h-3.5 w-3.5 text-primary" /> : <ImagePlus className="h-3.5 w-3.5 text-primary" />}<span className="rounded-full bg-primary-soft px-2 py-0.5 text-xs font-bold text-primary">{asset.tag}</span><span className="min-w-0 flex-1 truncate text-xs text-muted-foreground">{asset.name}</span><Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => setAssets((current) => current.filter((item) => item.id !== asset.id))} aria-label={t("playground.remove", { name: asset.name })}><X className="h-3.5 w-3.5" /></Button></div>
                  <div className="border-t border-border px-3 py-2">
                    <p className="text-xs font-bold">{t("playground.role_question", { tag: asset.tag })}</p>
                    <p className="mt-0.5 text-[11px] text-muted-foreground">{t("playground.role_multi_hint")}</p>
                    <div role="group" aria-label={t("playground.role_group", { tag: asset.tag })} className="mt-2 flex flex-wrap gap-1">{ROLE_OPTIONS[asset.kind].map((role) => { const active = asset.roles.includes(role); return <button key={role} type="button" role="checkbox" aria-checked={active} disabled={busy} onClick={() => setAssets((current) => current.map((item) => item.id === asset.id ? { ...item, roles: active ? item.roles.filter((value) => value !== role) : [...item.roles, role] } : item))} className={`rounded-full border px-2.5 py-1 text-xs font-semibold transition-colors ${active ? "border-primary bg-primary text-primary-foreground" : "border-border bg-card text-muted-foreground hover:border-primary/50"}`}>{t(`playground.roles.${role}`)}</button>; })}</div>
                  </div>
                </div>)}</div>
                {!rawPromptMode && buildRoleDirective(assets) && <div className="rounded-lg border border-border bg-muted/20 p-3">
                  <p className="text-xs font-bold">{t("playground.auto_directive_title")}</p>
                  <p className="mt-1 whitespace-pre-wrap text-xs leading-relaxed text-muted-foreground">{buildRoleDirective(assets)}</p>
                </div>}
              </div>}


            </div>
            <div data-video-tour="prompt" className="space-y-3"><div className="flex justify-between"><Label htmlFor="video-prompt" className="font-bold">{t("playground.describe_label")}</Label><span className="text-xs text-muted-foreground">{prompt.length}/3000</span></div><Textarea id="video-prompt" value={prompt} maxLength={3000} disabled={busy} onChange={(event) => setPrompt(event.target.value)} placeholder={t("playground.describe_placeholder")} className="min-h-44 resize-y rounded-lg text-base leading-relaxed" /><p className="text-xs text-muted-foreground">{t("playground.describe_hint")}</p>
              <div className="flex items-start justify-between gap-3 rounded-lg border border-border bg-muted/20 p-3">
                <div className="min-w-0"><p className="text-xs font-bold">{t("playground.raw_mode_title")}</p><p className="mt-1 text-xs leading-relaxed text-muted-foreground">{rawPromptMode ? t("playground.raw_mode_on") : t("playground.raw_mode_off")}</p></div>
                <div className="flex shrink-0 gap-1 rounded-md border border-border bg-card p-1">
                  <Button type="button" size="sm" variant={!rawPromptMode ? "default" : "ghost"} className="h-8 px-3 text-xs" disabled={busy} onClick={() => setRawPromptMode(false)}>{t("playground.ai_polish")}</Button>
                  <Button type="button" size="sm" variant={rawPromptMode ? "default" : "ghost"} className="h-8 px-3 text-xs" disabled={busy} onClick={() => setRawPromptMode(true)}>{t("playground.raw_mode")}</Button>
                </div>
              </div>
            </div>
             <div className="space-y-5 rounded-lg border border-border bg-muted/20 p-4">
               <p className="text-xs leading-relaxed text-muted-foreground">{t("playground.defaults_hint_1")} <span className="font-semibold text-foreground">{t("playground.defaults_hint_bold")}</span> {t("playground.defaults_hint_2")}</p>
               <OptionRow label={t("playground.ratio")}><div className="grid grid-cols-4 gap-1 sm:grid-cols-7">{["21:9", "16:9", "4:3", "1:1", "3:4", "9:16", "Auto"].map((ratio) => <Button key={ratio} type="button" size="sm" variant={aspectRatio === ratio ? "default" : "ghost"} className="h-9 px-2 text-xs" disabled={busy} onClick={() => setAspectRatio(ratio)}><Monitor className="h-3.5 w-3.5" />{ratio}</Button>)}</div></OptionRow>
               <OptionRow label={t("playground.resolution")}><div className="grid grid-cols-3 gap-1">{(["480p", "720p", "1080p"] as SeedanceResolution[]).map((value) => <Button key={value} type="button" size="sm" variant={resolution === value ? "default" : "ghost"} className="h-9" disabled={busy} onClick={() => setResolution(value)}>{value.toUpperCase()}</Button>)}</div></OptionRow>
               <OptionRow label={t("playground.duration")}><div className="grid grid-cols-5 gap-1">{[4, 5, 6, 8, 10].map((seconds) => <Button key={seconds} type="button" size="sm" variant={durationSeconds === seconds ? "default" : "ghost"} className="h-9" disabled={busy} onClick={() => setDurationSeconds(seconds)}>{seconds}s</Button>)}</div></OptionRow>
               <OptionRow label={t("playground.quantity")}><div className="grid grid-cols-4 gap-1">{[1, 2, 3, 4].map((quantity) => <Button key={quantity} type="button" size="sm" variant={outputQuantity === quantity ? "default" : "ghost"} className="h-9" disabled={busy} onClick={() => setOutputQuantity(quantity)}>{quantity}</Button>)}</div></OptionRow>
               <OptionRow label={t("playground.sound")}><div className="grid grid-cols-2 gap-1"><Button type="button" size="sm" variant={generateAudio ? "default" : "ghost"} className="h-9" disabled={busy} onClick={() => setGenerateAudio(true)}><Volume2 className="h-4 w-4" />{t("playground.on")}</Button><Button type="button" size="sm" variant={!generateAudio ? "default" : "ghost"} className="h-9" disabled={busy} onClick={() => setGenerateAudio(false)}><VolumeX className="h-4 w-4" />{t("playground.off")}</Button></div></OptionRow>
                </div>
            <Button data-video-tour="generate" onClick={generate} disabled={busy || !prompt.trim()} className="h-13 w-full text-base font-bold">{busy ? <Loader2 className="h-5 w-5 animate-spin" /> : <Film className="h-5 w-5" />}{preparing ? t("playground.preparing") : gen.running ? t("playground.generating") : t("playground.generate")}</Button>
          </div>
        </section>
        <aside data-video-tour="result" className="rounded-lg border border-border bg-card p-6"><h2 className="font-bold">{t("playground.result_title")}</h2><p className="mt-1 text-xs text-muted-foreground">{t("playground.result_sub")}</p><div className="mt-5 space-y-4">
          {gen.running && <EmptyResult loading />}{gen.recoveryNotice && <div className="flex gap-2 rounded-lg border border-primary/30 bg-primary-soft p-4 text-xs"><RefreshCw className="h-4 w-4 animate-spin text-primary" /><p>{gen.recoveryNotice}</p></div>}{gen.error && <ErrorCard message={gen.error} />}{gen.row?.results?.map((result) => <ResultVideo key={result.id} path={result.storage_path} />)}{!gen.running && !gen.row && !gen.error && <EmptyResult />}
          {gen.row?.final_prompt && <details className="rounded-lg border border-border p-4 text-xs"><summary className="cursor-pointer font-bold">{t("playground.view_prompt")}</summary><p className="mt-3 whitespace-pre-wrap leading-relaxed text-muted-foreground">{gen.row.final_prompt}</p></details>}
        </div></aside>
      </div>
    </div><VideoOnboardingTour open={tourOpen} onOpenChange={setTourOpen} />
  </main>;
}

function EmptyResult({ loading = false }: { loading?: boolean }) { const { t } = useTranslation(); return <div className="flex min-h-56 flex-col items-center justify-center gap-3 rounded-lg border border-dashed border-border bg-muted/20 px-6 text-center">{loading ? <Loader2 className="h-8 w-8 animate-spin text-primary" /> : <Film className="h-8 w-8 text-muted-foreground" />}<p className="text-sm text-muted-foreground">{loading ? t("playground.result_loading") : t("playground.result_empty")}</p></div>; }
function ErrorCard({ message }: { message: string }) { const info = explainVideoError(message); return <div className="rounded-lg border border-destructive/30 bg-destructive/10 p-4 text-xs"><p className="font-bold text-destructive">{info.title}</p><p className="mt-1 text-foreground/80">{info.hint}</p>{info.checks.length > 0 && <ul className="mt-2 list-disc space-y-1 pl-4">{info.checks.map((item) => <li key={item}>{item}</li>)}</ul>}</div>; }
function ResultVideo({ path }: { path: string }) { const { t } = useTranslation(); const url = useSignedUrl("generation-outputs", path, 300); const [downloading, setDownloading] = useState(false); async function download() { setDownloading(true); try { const name = path.split("/").pop() || "pilotstudio-video.mp4"; const { data, error } = await supabase.storage.from("generation-outputs").createSignedUrl(path, 60, { download: name }); if (error || !data?.signedUrl) throw error || new Error("Download failed"); const link = document.createElement("a"); link.href = data.signedUrl; link.download = name; document.body.appendChild(link); link.click(); link.remove(); } catch (error) { toast.error(error instanceof Error ? error.message : t("playground.download_failed")); } finally { setDownloading(false); } } if (!url) return <div className="aspect-video animate-pulse rounded-lg bg-muted" />; return <div className="space-y-3"><video src={url} controls playsInline className="aspect-video w-full rounded-lg border border-border bg-foreground object-contain" /><Button variant="outline" className="w-full" onClick={download} disabled={downloading}>{downloading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />} {t("playground.download")}</Button></div>; }
function ValidationItem({ label, value }: { label: string; value: ValidationState }) { const { t } = useTranslation(); const positive = value === "valid" || value === "available"; return <div className="flex items-center justify-between rounded-md border border-border bg-muted/20 px-3 py-2 text-xs"><span className="text-muted-foreground">{label}</span><span className="font-bold">{positive ? t("playground.state_ready") : value === "configured" ? t("playground.state_configured") : value === "not_configured" ? t("playground.state_not_set") : value === "invalid" || value === "unavailable" || value === "missing" ? t("playground.state_check") : t("playground.state_unknown")}</span></div>; }
function OptionRow({ label, children }: { label: string; children: ReactNode }) { return <div className="space-y-2"><Label className="text-xs font-bold">{label}</Label><div className="rounded-md border border-border bg-card p-1">{children}</div></div>; }