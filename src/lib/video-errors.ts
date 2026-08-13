// Converts provider failures into actionable, user-readable guidance.
export type VideoErrorInfo = {
  title: string;
  hint: string;
  category: "input" | "authentication" | "model" | "billing" | "rate_limit" | "provider" | "storage" | "safety" | "copyright" | "unknown";
  checks: string[];
  raw: string;
};

type ErrorGuide = Omit<VideoErrorInfo, "raw">;

function guide(category: ErrorGuide["category"], title: string, hint: string, checks: string[] = []): ErrorGuide {
  return { category, title, hint, checks };
}

function pick(raw: string): ErrorGuide {
  const r = raw.toLowerCase();
  if (
    r.includes("first/last frame content cannot be mixed with reference media content") ||
    r.includes("seedance_reference_mode_conflict")
  ) {
    return guide(
      "input",
      "The references were sent in two incompatible Seedance modes.",
      "The app now sends one image as a starting frame, or multiple images as reference media without mixing the two modes. Please generate again.",
      [
        "One reference: it controls the video's starting frame.",
        "Two or more references: all items guide subject, style, lighting, and motion.",
      ],
    );
  }
  if (r.includes("role must be specified for image contents")) {
    return guide(
      "input",
      "One or more reference images were missing their Seedance role.",
      "The app has corrected the request format. Please generate the video again with the same references.",
      [
        "The first uploaded frame is sent as the starting frame.",
        "Additional uploaded images and extracted video frames are sent as reference images.",
      ],
    );
  }
  if (
    r.includes("copyright restriction") ||
    r.includes("copyrighted") ||
    r.includes("intellectual property") ||
    r.includes("third-party character")
  ) {
    return guide(
      "copyright",
      "The reference or prompt is restricted by copyright protection.",
      "Seedance recognized a protected character or visual property. This cannot be fixed by retrying the same request.",
      [
        "Remove the protected character name from the prompt.",
        "Replace the reference image with an original character or material you own or are authorized to use.",
        "Describe only general visual traits instead of asking to reproduce a named character or franchise.",
      ],
    );
  }
  if (
    r.includes("inputtextsensitivecontentdetected") ||
    (r.includes("input text") && r.includes("sensitive information"))
  ) {
    return guide(
      "safety",
      "Seedance rejected the prompt text before generation started.",
      "The input text was flagged as describing sensitive or policy-sensitive video content. The video was never generated.",
      [
        "Prompt: remove direct mentions of specific people, brands, works, groups, or real-world incidents/places.",
        "Prompt: avoid descriptions of nudity, sexual acts, violence, dangerous behavior, or self-harm.",
        "Prompt: avoid instructions that reveal, expose, or reproduce personal or confidential information.",
        "Rewrite the prompt to describe only the scene, subject appearance, lighting, color, and camera motion in neutral language, then retry.",
      ],
    );
  }
  if (
    r.includes("output video may contain sensitive information") ||
    r.includes("output may contain sensitive information") ||
    r.includes("sensitive information")
  ) {
    return guide(
      "safety",
      "Seedance blocked the generated result to protect sensitive information.",
      "The request reached Seedance, but its output safety review rejected the resulting video. Retrying the identical request may be blocked again.",
      [
        "Reference media: remove visible names, phone numbers, addresses, ID documents, account details, screens, or other private information.",
        "Prompt: remove instructions that reveal, reproduce, or focus on personal or confidential information.",
        "If the references are safe, simplify them and retry with a neutral prompt that describes only the intended scene and motion.",
      ],
    );
  }
  if (
    r.includes("inputimagesensitivecontentdetected") ||
    r.includes("may contain real person") ||
    r.includes("privacyinformation")
  ) {
    return guide(
      "safety",
      "Seedance rejected a reference image as containing a real person.",
      "This is an input-image safety rejection, not a parameter problem. Replace the reference media and retry.",
      [
        "Reference media: replace photos or video frames showing real people's faces with illustrated or AI-generated characters.",
        "Uploaded video: its extracted frames are checked too — a live-action clip is rejected the same way.",
        "If a person must appear, use a stylized (webtoon/anime) rendering instead of a photographic face.",
      ],
    );
  }
  if (r.includes("content_blocked")) return guide("safety", "This request cannot be generated.", "Revise the content and try again.", ["Positive prompt: remove explicit, exploitative, hateful, or graphically violent descriptions.", "Reference media: replace any image or video that may trigger the safety policy."]);
  if (r.includes("content_check")) return guide("provider", "The safety check is temporarily unavailable.", "Your request was not sent to the provider. Try again shortly.");
  if (r.includes("model is not available") || r.includes("invalid model")) return guide("model", "The selected video engine is unavailable.", "Run Model availability check, then select an available provider.", ["Provider and model ID: confirm the displayed model is marked Available.", "Mode: confirm the model supports text-to-video or image-to-video as selected."]);
  if (r.includes("no_credits") || r.includes("http_402") || r.includes("insufficient credit")) return guide("billing", "The selected provider has insufficient credit.", "Top up the relevant provider or workspace credits, then retry.");
  if (r.includes("rate_limited") || r.includes("http_429")) return guide("rate_limit", "The provider rate limit was reached.", "Wait about a minute before retrying; avoid duplicate generation requests.");
  if (r.includes("replicate_api_key") || r.includes("replicate_http_401") || r.includes("replicate_http_403")) return guide("authentication", "The Replicate connection was rejected.", "Ask an administrator to reconnect Replicate or verify its server-side credential and permissions.");
  if (r.includes("lovable_api_key")) return guide("authentication", "The AI connection is not configured.", "Ask an administrator to verify the server-side AI connection.");
  if (r.includes("ark_api_key")) return guide("authentication", "The Seedance connection is not configured.", "Ask an administrator to configure the server-side Seedance credential.");
  if (r.includes("accessdenied") || r.includes("ark_http_403")) return guide("authentication", "Seedance access was denied.", "Ask an administrator to check credential permissions and endpoint configuration.", ["API credential: verify it belongs to the endpoint's project.", "Endpoint ID and base URL: verify both target the same region and project."]);
  if (r.includes("inference limit") || r.includes("safe experience mode")) return guide("billing", "Seedance is limited by Safe Experience mode.", "Ask an administrator to disable Safe Experience / Free Credits Only mode for the video model.");
  if (r.includes("modelnotopen") || r.includes("ark_http_404") || r.includes("ark_model_not_activated")) return guide("model", "The Seedance model is not activated.", "Ask an administrator to activate the configured video endpoint.", ["Endpoint ID: confirm it belongs to the same project as the API credential.", "Endpoint status: confirm it is Running."]);
  if (r.includes("signed_url_failed")) return guide("storage", "The reference image could not be loaded.", "Remove the reference, upload it again, and retry.", ["Reference role: confirm a First frame is assigned for image-to-video.", "File: use a supported JPG, PNG, or MP4 that can be previewed in the studio."]);
  if (r.includes("storage_upload_failed") || r.includes("fetch_video_failed")) return guide("storage", "The generated video could not be saved.", "The generation may have completed, but result storage failed. Retry once; if it repeats, contact the workspace administrator.");
  if (r.includes("no_task_id")) return guide("provider", "The provider did not return a task ID.", "Check the request settings, then retry.", ["Mode: use image-to-video only when a valid first frame is attached.", "Prompt: shorten unusually long text.", "Model version: confirm the configured version still exists."]);
  if (r.includes("unsupportedimageformat")) {
    return guide(
      "input",
      "참고 자료의 실제 파일 형식이 Seedance 이미지 입력 형식과 맞지 않습니다.",
      "자산고의 영상 원본이 이미지 입력으로 전달된 경우 발생합니다. 앱이 영상을 JPG 참고 프레임으로 변환하도록 수정되었으므로, 같은 자산으로 다시 생성해 주세요.",
      [
        "영상 자산: MP4 원본 대신 자동 추출된 JPG 프레임이 Seedance에 전달됩니다.",
        "이미지 자산: 확장자만 바꾼 파일이 아닌 실제 JPG 또는 PNG를 사용해 주세요.",
      ],
    );
  }
  if (r.includes("ref_public_url_not_image") || r.includes("ref_public_url_unreachable")) {
    return guide(
      "storage",
      "참고 이미지를 Seedance가 내려받지 못했습니다 (이미지 대신 로그인/오류 페이지가 전달됨).",
      "프롬프트나 파라미터 문제가 아닙니다. 참고 이미지를 다시 업로드한 뒤 재시도해 주세요. 반복되면 관리자에게 공개 참고 이미지 주소 설정을 확인하도록 요청하세요.",
      [
        "참고 이미지: JPG 또는 PNG 원본으로 다시 업로드해 주세요.",
        "미리보기 환경에서는 참고 이미지 주소가 로그인 화면으로 넘어갈 수 있어, 안정 공개 주소가 사용되도록 수정되었습니다.",
      ],
    );
  }
  if (r.includes("http_400") || r.includes("http_422") || r.includes("validation") || r.includes("empty_prompt")) return guide("input", "The provider rejected one or more request parameters.", "Review the request values below and try again.", ["Positive prompt: required, maximum 4,000 characters.", "Negative prompt: maximum 2,000 characters.", "Duration: 3–12 seconds; try 5 seconds for widest compatibility.", "Resolution: try 720p.", "Aspect ratio: try 16:9 or 9:16.", "Image-to-video: attach a valid First frame; remove it for a text-only test."]);
  if (r.includes("http_401") || r.includes("http_403") || r.includes("unauthorized") || r.includes("forbidden")) return guide("authentication", "The provider rejected authentication or access.", "Ask an administrator to verify the connection, permissions, and selected model access.");
  if (r.includes("http_404")) return guide("model", "The configured model or endpoint was not found.", "Run Model availability check and verify the model / endpoint ID.");
  if (r.includes("http_408") || r.includes("timeout") || r.includes("timed out")) return guide("provider", "The provider timed out.", "Wait briefly and retry once. Use a 5-second, 720p request to reduce processing time.");
  if (r.includes("http_413")) return guide("input", "The request was too large.", "Reduce the reference file size or prompt length and retry.");
  if (/http_5\d\d/.test(r) || r.includes("service unavailable") || r.includes("bad gateway")) return guide("provider", "The video provider is temporarily unavailable.", "Your parameters may be valid. Wait briefly, run Model availability check, and retry once.", ["If the same 5xx repeats, check the provider status page before changing your prompt."]);
  return guide("unknown", "Video generation failed.", "Run Model availability check and retry once. If it repeats, share the technical details with an administrator.");
}

export function explainVideoError(raw: string): VideoErrorInfo {
  const [first, fallback] = raw.split("||");
  const selected = pick(raw);
  const diagnostic = fallback ? `Primary: ${(first ?? "").trim()} | Fallback: ${fallback.trim()}` : (first ?? raw).trim();
  return { ...selected, raw: diagnostic.slice(0, 300) };
}

export function getKoreanVideoErrorSummary(raw: string): string {
  const info = explainVideoError(raw);
  const r = raw.toLowerCase();

  if (r.includes("inputimagesensitivecontentdetected") || r.includes("may contain real person") || r.includes("privacyinformation")) {
    return "Seedance(BytePlus)가 참고 자료로 보낸 이미지(업로드한 영상에서 추출된 프레임 포함)에 실제 사람이 담겨 있다고 판단해 요청을 거부했습니다. 프롬프트 길이·해상도·비율·영상 길이 등 파라미터 문제가 아니며, 앱·API 키·엔드포인트 문제도 아닙니다. 실사 인물이 보이는 사진이나 실사 영상을 참고 자료에서 제거하고, 일러스트·웹툰·AI 생성 캐릭터 이미지로 교체한 뒤 다시 시도해 주세요.";
  }

  if (r.includes("inputtextsensitivecontentdetected") || (r.includes("input text") && r.includes("sensitive information"))) {
    return "Seedance(BytePlus)가 입력한 프롬프트 문구를 콘텐츠 정책상 민감한 영상 묘사로 판단해 요청 자체를 거부했습니다. 영상은 생성되지 않았고, 앱·API 키·엔드포인트 문제가 아닙니다. 프롬프트에서 특정 인물·브랜드·작품·단체명, 실제 사건·장소, 노출·성적·폭력·위험 행위를 직접 지칭하는 표현을 줄이고, 장면 구성·피사체 외형·조명·색감·카메라 움직임만 중립적으로 설명해 다시 시도해 주세요.";
  }
  if (r.includes("sensitive information")) {
    return "Seedance(BytePlus)의 출력 안전 심사가 완성된 영상을 민감정보 포함 가능성으로 반려한 것입니다. 앱·API 키·엔드포인트 문제가 아닙니다.";
  }
  if (info.category === "copyright") {
    return "Seedance(BytePlus)가 참고 자료 또는 프롬프트에서 저작권 보호 대상일 가능성을 감지해 생성을 반려한 것입니다. 앱·API 키·엔드포인트 문제가 아닙니다. 유명 캐릭터·작품명을 제거하고 직접 제작했거나 사용 권한이 있는 자료로 교체해 주세요.";
  }

  const summaries: Record<VideoErrorInfo["category"], string> = {
    input: "Seedance(BytePlus)가 요청 파라미터 또는 참고 자료 구성을 허용하지 않아 생성이 시작되지 않았습니다. 프롬프트 길이, 영상 길이, 해상도, 비율 및 참고 자료 구성을 확인해 주세요.",
    authentication: "Seedance(BytePlus) 인증 또는 접근 권한 확인에 실패했습니다. ARK API 키, 엔드포인트 ID, 리전과 프로젝트가 서로 일치하는지 확인해 주세요.",
    model: "설정된 Seedance 모델 또는 엔드포인트를 사용할 수 없습니다. 모델 활성화 여부와 엔드포인트 실행 상태를 확인해 주세요.",
    billing: "Seedance(BytePlus)의 결제·크레딧 또는 Safe Experience 제한으로 요청이 중단되었습니다. 계정의 결제 및 사용 제한 설정을 확인해 주세요.",
    rate_limit: "Seedance(BytePlus)의 단시간 요청 한도를 초과했습니다. 약 1분 후 중복 요청 없이 다시 시도해 주세요.",
    provider: "Seedance(BytePlus) 서비스가 일시적으로 응답하지 않거나 처리 중 오류가 발생했습니다. 잠시 후 같은 설정으로 한 번 다시 시도해 주세요.",
    storage: "영상 생성 결과 또는 참고 자료를 비공개 저장소에서 읽거나 저장하는 과정에 실패했습니다. 자료를 다시 업로드한 뒤 재시도해 주세요.",
    safety: "Seedance(BytePlus)의 콘텐츠 안전 심사가 요청 또는 생성 결과를 반려했습니다. 앱·API 키·엔드포인트 문제가 아닙니다. 참고 자료와 프롬프트에서 안전 심사 대상 요소를 제거해 주세요.",
    copyright: "Seedance(BytePlus)의 저작권 보호 심사에서 요청이 반려되었습니다. 앱·API 키·엔드포인트 문제가 아닙니다. 보호 대상 이름과 자료를 제거해 주세요.",
    unknown: "Seedance(BytePlus)가 구체적인 분류가 없는 오류를 반환했습니다. 모델 연결 상태를 확인한 후 한 번 더 시도하고, 반복되면 아래 기술 정보를 관리자에게 전달해 주세요.",
  };
  return summaries[info.category];
}

export function formatVideoError(raw: string): string {
  const info = explainVideoError(raw);
  const checks = info.checks.map((item) => `• ${item}`).join("\n");
  return [`실패 원인: ${getKoreanVideoErrorSummary(raw)}`, "", info.title, info.hint, `Category: ${info.category.replace("_", " ")}`, checks ? `Check these parameters:\n${checks}` : "", `(raw: ${info.raw})`].filter(Boolean).join("\n");
}

/** Seedance(ARK) 요청/응답 맥락. 실패 리포트를 한글로 상세화하는 데 쓰인다. */
export type VideoFailureContext = {
  /** 실패가 발생한 단계 */
  stage: "request" | "polling" | "download";
  model?: string | null;
  mode?: string | null;
  aspectRatio?: string | null;
  resolution?: string | null;
  durationSeconds?: number | null;
  referenceCount?: number | null;
  taskId?: string | null;
};

const STAGE_LABEL: Record<VideoFailureContext["stage"], string> = {
  request: "Seedance에 영상 작업 생성을 요청하는 중",
  polling: "Seedance에서 생성 진행 상태를 확인하는 중",
  download: "완성된 영상을 내려받아 저장하는 중",
};

/** raw 오류 문자열에서 공급자 응답의 HTTP 코드/에러 코드/메시지를 뽑아낸다. */
function extractProviderResponse(raw: string): string {
  const parts: string[] = [];
  const http = raw.match(/(?:ARK_)?HTTP[_ ](\d{3})/i);
  if (http) parts.push(`HTTP ${http[1]}`);
  const code = raw.match(/"?code"?\s*[:=]\s*"?([A-Za-z][A-Za-z0-9_.]{2,40})"?/);
  if (code) parts.push(`오류코드 ${code[1]}`);
  const msg = raw.match(/"?message"?\s*[:=]\s*"([^"]{3,300})"/);
  if (msg) parts.push(`메시지 "${msg[1]}"`);
  else {
    const tail = raw.split(":").slice(1).join(":").trim();
    if (tail) parts.push(`메시지 "${tail.slice(0, 200)}"`);
  }
  return parts.length ? parts.join(" · ") : "공급자가 별도 응답 코드를 반환하지 않았습니다.";
}

function formatRequestSummary(ctx: VideoFailureContext): string {
  const items = [
    ctx.model ? `모델/엔드포인트 ${ctx.model}` : null,
    ctx.mode ? `모드 ${ctx.mode}` : null,
    ctx.aspectRatio ? `비율 ${ctx.aspectRatio}` : null,
    ctx.resolution ? `해상도 ${ctx.resolution}` : null,
    typeof ctx.durationSeconds === "number" ? `길이 ${ctx.durationSeconds}초` : null,
    typeof ctx.referenceCount === "number" ? `참고자료 ${ctx.referenceCount}개` : null,
    ctx.taskId ? `작업 ID ${ctx.taskId}` : null,
  ].filter(Boolean);
  return items.length ? items.join(" · ") : "요청 정보가 기록되지 않았습니다.";
}

/**
 * Seedance(ARK) 요청/응답을 근거로 한글 실패 리포트를 만든다.
 * 히스토리 error_message 에 그대로 저장된다.
 */
export function formatVideoFailureReport(raw: string, ctx: VideoFailureContext): string {
  const info = explainVideoError(raw);
  const checks = info.checks.length
    ? info.checks.map((item) => `• ${item}`).join("\n")
    : "• 같은 설정으로 한 번만 재시도한 뒤에도 반복되면 관리자에게 아래 기술 정보를 전달해 주세요.";

  return [
    `실패 원인: ${getKoreanVideoErrorSummary(raw)}`,
    "",
    `[발생 단계] ${STAGE_LABEL[ctx.stage]}`,
    `[공급자 응답] ${extractProviderResponse(raw)}`,
    `[요청 정보] ${formatRequestSummary(ctx)}`,
    `[분류] ${info.category.replace("_", " ")}`,
    "[조치 방법]",
    checks,
    "",
    `(raw: ${info.raw})`,
  ].join("\n");
}
