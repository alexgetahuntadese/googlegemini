const http = require("http");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

loadEnvFile(path.join(__dirname, ".env"));

const NODE_ENV = process.env.NODE_ENV || "development";
const IS_PRODUCTION = NODE_ENV === "production";
const PORT = parsePort(process.env.PORT, 4173);
const ALLOW_RUNTIME_SETUP = parseBoolean(process.env.ALLOW_RUNTIME_SETUP, !IS_PRODUCTION);
const runtimeConfig = {
  webhookToken: process.env.GITLAB_WEBHOOK_TOKEN || "",
  gitlabBaseUrl: normalizeGitLabBaseUrl(process.env.GITLAB_BASE_URL || "https://gitlab.com"),
  gitlabToken: process.env.GITLAB_TOKEN || "",
  gitlabProjectId: process.env.GITLAB_PROJECT_ID || "",
  geminiApiKey: process.env.GEMINI_API_KEY || "",
  geminiModel: process.env.GEMINI_MODEL || "gemini-3-pro",
  source: process.env.GITLAB_TOKEN && process.env.GITLAB_PROJECT_ID ? "env" : "mock"
};
const API_RATE_LIMIT_PER_MINUTE = parsePositiveInt(process.env.API_RATE_LIMIT_PER_MINUTE, 120);
const BODY_LIMIT_BYTES = parsePositiveInt(process.env.BODY_LIMIT_BYTES, 1_000_000);
const REQUEST_TIMEOUT_MS = parsePositiveInt(process.env.REQUEST_TIMEOUT_MS, 30_000);
const SHUTDOWN_GRACE_MS = parsePositiveInt(process.env.SHUTDOWN_GRACE_MS, 10_000);
const ROOT = __dirname;
const STATIC_CACHE_SECONDS = IS_PRODUCTION ? 3600 : 0;
const STATIC_ASSETS = new Map([
  ["/", { file: "index.html", type: "text/html; charset=utf-8", html: true }],
  ["/index.html", { file: "index.html", type: "text/html; charset=utf-8", html: true }],
  ["/styles.css", { file: "styles.css", type: "text/css; charset=utf-8" }],
  ["/app.js", { file: "app.js", type: "text/javascript; charset=utf-8" }]
]);
const rateLimitBuckets = new Map();

validateConfig();

function loadEnvFile(filePath) {
  if (!fs.existsSync(filePath)) return;

  const lines = fs.readFileSync(filePath, "utf8").split(/\r?\n/);
  lines.forEach((line) => {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) return;
    const separator = trimmed.indexOf("=");
    if (separator === -1) return;

    const key = trimmed.slice(0, separator).trim();
    const rawValue = trimmed.slice(separator + 1).trim();
    const value = rawValue.replace(/^["']|["']$/g, "");
    if (!process.env[key]) process.env[key] = value;
  });
}

function parsePort(value, fallback) {
  const port = Number(value || fallback);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(`Invalid PORT "${value}". Expected a number from 1 to 65535.`);
  }
  return port;
}

function parsePositiveInt(value, fallback) {
  const parsed = Number(value || fallback);
  if (!Number.isInteger(parsed) || parsed <= 0) return fallback;
  return parsed;
}

function parseBoolean(value, fallback) {
  if (value === undefined || value === "") return fallback;
  return ["1", "true", "yes", "on"].includes(String(value).toLowerCase());
}

function normalizeGitLabBaseUrl(value) {
  const baseUrl = String(value || "https://gitlab.com").trim().replace(/\/+$/, "");
  const parsed = new URL(baseUrl);
  if (!["http:", "https:"].includes(parsed.protocol)) {
    throw new Error("GitLab base URL must use http or https.");
  }
  return parsed.origin + parsed.pathname.replace(/\/+$/, "");
}

function isGitLabConfigured() {
  return Boolean(runtimeConfig.gitlabToken && runtimeConfig.gitlabProjectId);
}

function publicSetup() {
  return {
    configured: isGitLabConfigured(),
    source: runtimeConfig.source,
    baseUrl: runtimeConfig.gitlabBaseUrl,
    projectId: runtimeConfig.gitlabProjectId || "",
    tokenConfigured: Boolean(runtimeConfig.gitlabToken),
    webhookTokenConfigured: Boolean(runtimeConfig.webhookToken),
    geminiConfigured: Boolean(runtimeConfig.geminiApiKey),
    geminiModel: runtimeConfig.geminiModel,
    runtimeSetupAllowed: ALLOW_RUNTIME_SETUP
  };
}

function staticCacheControl(asset) {
  if (asset.html) return "no-cache";
  return STATIC_CACHE_SECONDS ? `public, max-age=${STATIC_CACHE_SECONDS}` : "no-cache";
}

function validateConfig() {
  if (IS_PRODUCTION && !runtimeConfig.webhookToken) {
    console.warn("Production warning: GITLAB_WEBHOOK_TOKEN is not set; webhook endpoint will reject requests.");
  }

  if (IS_PRODUCTION && ALLOW_RUNTIME_SETUP) {
    console.warn("Production warning: ALLOW_RUNTIME_SETUP is enabled; protect this app behind authentication.");
  }

  if (IS_PRODUCTION && Boolean(runtimeConfig.gitlabToken) !== Boolean(runtimeConfig.gitlabProjectId)) {
    throw new Error("Set both GITLAB_TOKEN and GITLAB_PROJECT_ID, or neither, in production.");
  }
}

const steps = [
  {
    id: "fetch_pipeline",
    title: "Fetch failed pipeline",
    body: "Using pipelines tool to inspect pipeline execution details and identify failed jobs."
  },
  {
    id: "pull_trace",
    title: "Pull raw job trace",
    body: "Reading stderr and raw logs before attempting any diagnosis."
  },
  {
    id: "map_context",
    title: "Map stack trace to code",
    body: "Using repository search to fetch source files, tests, and recent merge request diffs."
  },
  {
    id: "draft_patch",
    title: "Draft minimal patch",
    body: "Creating the smallest change that resolves the observed failure."
  },
  {
    id: "prepare_mr",
    title: "Prepare merge request",
    body: "Writing a human-reviewable MR with failure, cause, and fix sections."
  }
];

const pipelines = [
  {
    id: "12841",
    job: "unit:test",
    branch: "feature/cache-layer",
    mr: "!482",
    failedAgo: "7 min ago",
    confidence: 91,
    title: "Cache service regression",
    reason: "TypeError in cache adapter test",
    status: "failed",
    runner: "Node 20 runner",
    trace: [
      "$ npm run test:unit",
      "",
      "FAIL test/cache-adapter.spec.ts",
      "  CacheAdapter",
      "    x returns fallback value when Redis is unavailable",
      "",
      "TypeError: Cannot read properties of undefined (reading 'ttl')",
      "  at CacheAdapter.get src/cache/cache-adapter.ts:42:21",
      "  at Object.<anonymous> test/cache-adapter.spec.ts:18:28",
      "",
      "Tests: 1 failed, 23 passed"
    ].join("\n"),
    files: [
      {
        path: "src/cache/cache-adapter.ts",
        note: "Stack trace points to an unguarded options.ttl read when test config omits cache options."
      },
      {
        path: "test/cache-adapter.spec.ts",
        note: "Regression test expects fallback behavior while Redis is unavailable."
      }
    ],
    patch: [
      "diff --git a/src/cache/cache-adapter.ts b/src/cache/cache-adapter.ts",
      "@@",
      "- const ttl = options.ttl;",
      "+ const ttl = options?.ttl ?? DEFAULT_CACHE_TTL;",
      "",
      "  if (!this.client.isReady) {",
      "    return fallbackValue;",
      "  }"
    ].join("\n"),
    mr: {
      broke: "The unit:test job failed because CacheAdapter.get attempted to read options.ttl when options was undefined.",
      why: "The new cache-layer branch made the options object optional in the test path, but the adapter still treated it as required.",
      fixed: "The patch applies a default TTL with optional chaining and keeps the Redis-unavailable fallback behavior intact."
    }
  },
  {
    id: "12836",
    job: "build:web",
    branch: "feature/billing-tabs",
    mr: "!477",
    failedAgo: "21 min ago",
    confidence: 87,
    title: "Billing UI compile failure",
    reason: "Missing exported type",
    status: "failed",
    runner: "Node 20 runner",
    trace: [
      "$ npm run build",
      "",
      "src/pages/billing/BillingTabs.tsx:6:10 - error TS2305:",
      "Module './types' has no exported member 'InvoiceTab'.",
      "",
      "6 import { InvoiceTab } from './types';",
      "           ~~~~~~~~~~",
      "",
      "Found 1 error."
    ].join("\n"),
    files: [
      {
        path: "src/pages/billing/BillingTabs.tsx",
        note: "Imports InvoiceTab from a local type barrel."
      },
      {
        path: "src/pages/billing/types.ts",
        note: "Recent diff renamed InvoiceTab to BillingTab without updating all imports."
      }
    ],
    patch: [
      "diff --git a/src/pages/billing/BillingTabs.tsx b/src/pages/billing/BillingTabs.tsx",
      "@@",
      "- import { InvoiceTab } from './types';",
      "+ import { BillingTab } from './types';",
      "",
      "- const tabs: InvoiceTab[] = [",
      "+ const tabs: BillingTab[] = ["
    ].join("\n"),
    mr: {
      broke: "The build:web job failed with TS2305 because BillingTabs imported an old type name.",
      why: "A previous refactor renamed InvoiceTab to BillingTab but left one stale import and annotation.",
      fixed: "The patch updates the import and local tab array annotation to the current BillingTab export."
    }
  },
  {
    id: "12822",
    job: "integration:db",
    branch: "fix/report-export",
    mr: "!468",
    failedAgo: "43 min ago",
    confidence: 83,
    title: "Report export database test",
    reason: "Missing migration column",
    status: "failed",
    runner: "Postgres 16 service",
    trace: [
      "$ npm run test:integration",
      "",
      "QueryFailedError: column report_exports.format does not exist",
      "  at PostgresQueryRunner.query src/db/PostgresQueryRunner.ts:331:19",
      "  at ReportExportRepository.create src/reports/report-export.repository.ts:57:12",
      "",
      "Hint: Perhaps you meant to reference the column \"report_exports.file_format\"."
    ].join("\n"),
    files: [
      {
        path: "src/reports/report-export.repository.ts",
        note: "Insert statement references format, but current migration exposes file_format."
      },
      {
        path: "migrations/202605301130_report_exports.sql",
        note: "Schema already contains file_format; repository drift caused the failure."
      }
    ],
    patch: [
      "diff --git a/src/reports/report-export.repository.ts b/src/reports/report-export.repository.ts",
      "@@",
      "- format: input.format,",
      "+ file_format: input.format,"
    ].join("\n"),
    mr: {
      broke: "The integration:db job failed because the repository attempted to insert into report_exports.format.",
      why: "The migration defines file_format, while the repository used the pre-review column name.",
      fixed: "The patch maps input.format to the existing file_format column without changing the database schema."
    }
  }
];

const investigations = new Map();
const auditLog = [];

function gitlabUrl(pathname, params = {}) {
  const url = new URL(`${runtimeConfig.gitlabBaseUrl}/api/v4${pathname}`);
  Object.entries(params).forEach(([key, value]) => {
    if (value === undefined || value === null || value === "") return;
    if (Array.isArray(value)) {
      value.forEach((item) => url.searchParams.append(key, item));
      return;
    }
    url.searchParams.set(key, value);
  });
  return url;
}

async function gitlabFetch(pathname, params = {}, options = {}) {
  if (!isGitLabConfigured()) {
    throw new Error("GitLab is not configured. Set GITLAB_TOKEN and GITLAB_PROJECT_ID.");
  }

  const response = await fetch(gitlabUrl(pathname, params), {
    ...options,
    headers: {
      "PRIVATE-TOKEN": runtimeConfig.gitlabToken,
      "User-Agent": "devops-medic/0.1",
      ...(options.headers || {})
    }
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`GitLab ${response.status}: ${text.slice(0, 240)}`);
  }

  const contentType = response.headers.get("content-type") || "";
  if (contentType.includes("application/json")) return response.json();
  return response.text();
}

function projectPath(pathname) {
  return `/projects/${encodeURIComponent(runtimeConfig.gitlabProjectId)}${pathname}`;
}

function shortTimeAgo(isoDate) {
  const date = new Date(isoDate);
  if (Number.isNaN(date.getTime())) return "recently";

  const seconds = Math.max(1, Math.floor((Date.now() - date.getTime()) / 1000));
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} hr ago`;
  return `${Math.floor(hours / 24)} days ago`;
}

function extractTraceSignal(trace) {
  const lines = trace.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const errorLine = lines.find((line) => /error|exception|failed|fatal|typeerror|referenceerror/i.test(line));
  return errorLine || lines.slice(-1)[0] || "Failed job trace available";
}

function extractFilePaths(trace) {
  const matches = new Set();
  const pattern = /(?:^|\s|["'(`])((?:[\w.-]+\/)+[\w.-]+\.(?:js|jsx|ts|tsx|mjs|cjs|py|go|rb|java|kt|cs|php|rs|sql|yml|yaml|json|toml|xml|html|css|scss))(?:[:)\]"'`\s]|$)/gi;
  let match = pattern.exec(trace);

  while (match) {
    matches.add(match[1].replace(/^\.?\//, ""));
    match = pattern.exec(trace);
  }

  return [...matches].slice(0, 6);
}

async function listFailedPipelinesFromGitLab() {
  const rawPipelines = await gitlabFetch(projectPath("/pipelines"), {
    status: "failed",
    per_page: "12",
    order_by: "updated_at",
    sort: "desc"
  });

  const hydrated = await Promise.all(rawPipelines.map(async (pipeline) => {
    const jobs = await gitlabFetch(projectPath(`/pipelines/${pipeline.id}/jobs`), {
      "scope[]": "failed",
      per_page: "5"
    }).catch(() => []);
    const job = jobs[0] || {};

    return {
      id: String(pipeline.id),
      jobId: job.id ? String(job.id) : "",
      job: job.name || "failed job",
      branch: pipeline.ref || "unknown-ref",
      mr: "",
      failedAgo: shortTimeAgo(job.finished_at || pipeline.updated_at),
      confidence: 68,
      title: `${pipeline.ref || "Pipeline"} failed`,
      reason: job.failure_reason || job.status || pipeline.status,
      status: pipeline.status,
      runner: job.runner?.description || job.stage || "GitLab runner",
      source: "gitlab"
    };
  }));

  return hydrated;
}

async function findMergeRequestForBranch(branch) {
  const mergeRequests = await gitlabFetch(projectPath("/merge_requests"), {
    state: "opened",
    source_branch: branch,
    per_page: "1"
  }).catch(() => []);

  return mergeRequests[0] || null;
}

async function readRepositoryFile(pathname, ref) {
  const encodedPath = encodeURIComponent(pathname);
  return gitlabFetch(projectPath(`/repository/files/${encodedPath}/raw`), { ref })
    .catch((error) => `Unable to read ${pathname}: ${error.message}`);
}

function parseJsonFromModel(text) {
  const trimmed = String(text || "").trim();
  if (!trimmed) return null;

  try {
    return JSON.parse(trimmed);
  } catch {
    const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
    const candidate = fenced ? fenced[1] : trimmed.match(/\{[\s\S]*\}/)?.[0];
    if (!candidate) return null;
    try {
      return JSON.parse(candidate);
    } catch {
      return null;
    }
  }
}

function buildGeminiPrompt({ pipeline, job, trace, files, mergeRequest }) {
  const fileContext = files.map((file) => [
    `FILE: ${file.path}`,
    `NOTE: ${file.note}`,
    "CONTENT:",
    file.preview || ""
  ].join("\n")).join("\n\n---\n\n");

  return [
    "You are DevOps Medic, a human-gated CI/CD recovery agent.",
    "Use the GitLab pipeline trace and repository context to draft the smallest safe fix.",
    "Return only JSON with this exact shape:",
    "{\"summary\":\"one sentence\",\"rootCause\":\"one sentence\",\"diff\":\"unified diff or clear patch plan\",\"validation\":\"validation command or check\",\"confidence\":75}",
    "",
    "Safety policy:",
    "- Do not propose credential, secret, deployment, or protected branch changes.",
    "- Prefer a patch that changes at most 3 files and 12000 bytes.",
    "- If the evidence is insufficient, set diff to an evidence-backed patch plan instead of inventing code.",
    "",
    `Pipeline: ${pipeline.id}`,
    `Branch: ${pipeline.ref || "unknown"}`,
    `Job: ${job.name}`,
    `Failure reason: ${job.failure_reason || job.status || "failed"}`,
    `Merge request: ${mergeRequest ? `!${mergeRequest.iid}` : "not found"}`,
    "",
    "TRACE:",
    trace.slice(0, 16000),
    "",
    "REPOSITORY CONTEXT:",
    fileContext.slice(0, 24000)
  ].join("\n");
}

async function generateGeminiPatchProposal(context) {
  if (!runtimeConfig.geminiApiKey) return null;

  const url = new URL(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(runtimeConfig.geminiModel)}:generateContent`);
  url.searchParams.set("key", runtimeConfig.geminiApiKey);

  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "User-Agent": "devops-medic/0.1"
    },
    body: JSON.stringify({
      contents: [{
        role: "user",
        parts: [{ text: buildGeminiPrompt(context) }]
      }],
      generationConfig: {
        temperature: 0.2,
        responseMimeType: "application/json"
      }
    })
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Gemini ${response.status}: ${text.slice(0, 240)}`);
  }

  const payload = await response.json();
  const text = payload.candidates?.[0]?.content?.parts?.map((part) => part.text || "").join("\n") || "";
  const parsed = parseJsonFromModel(text);
  if (!parsed) throw new Error("Gemini returned a response that was not valid JSON.");

  return {
    summary: String(parsed.summary || "Gemini drafted a recovery proposal."),
    rootCause: String(parsed.rootCause || "Root cause was inferred from pipeline evidence."),
    diff: String(parsed.diff || "No patch diff returned."),
    validation: String(parsed.validation || `Re-run ${context.job.name} for ${context.pipeline.ref}.`),
    confidence: Math.max(1, Math.min(99, Number(parsed.confidence) || 75))
  };
}

async function buildGitLabInvestigation(pipelineId) {
  const pipeline = await gitlabFetch(projectPath(`/pipelines/${pipelineId}`));
  const failedJobs = await gitlabFetch(projectPath(`/pipelines/${pipelineId}/jobs`), {
    "scope[]": "failed",
    per_page: "20"
  });
  const job = failedJobs[0];

  if (!job) {
    throw new Error(`Pipeline #${pipelineId} has no failed jobs available.`);
  }

  const trace = await gitlabFetch(projectPath(`/jobs/${job.id}/trace`));
  const traceFiles = extractFilePaths(trace);
  const mergeRequest = await findMergeRequestForBranch(pipeline.ref);
  const changedFiles = mergeRequest
    ? await gitlabFetch(projectPath(`/merge_requests/${mergeRequest.iid}/changes`))
      .then((payload) => payload.changes?.map((change) => change.new_path).slice(0, 6) || [])
      .catch(() => [])
    : [];
  const candidateFiles = [...new Set([...traceFiles, ...changedFiles])].slice(0, 6);
  const files = await Promise.all(candidateFiles.map(async (filePath) => {
    const content = await readRepositoryFile(filePath, pipeline.sha || pipeline.ref);
    return {
      path: filePath,
      note: content.startsWith("Unable to read")
        ? content
        : `Fetched ${Math.min(content.length, 20000)} chars from GitLab for evidence review.`,
      preview: content.slice(0, 2000)
    };
  }));
  const geminiProposal = await generateGeminiPatchProposal({ pipeline, job, trace, files, mergeRequest })
    .catch((error) => {
      audit("gemini.patch.failed", { pipelineId: pipeline.id, message: error.message });
      return null;
    });

  const branch = `devops-medic/patch-pipeline-${pipeline.id}`;
  const signal = extractTraceSignal(trace);
  const modelGenerated = Boolean(geminiProposal);
  const investigation = {
    id: crypto.randomUUID(),
    pipelineId: String(pipeline.id),
    state: modelGenerated ? "ready_for_review" : "evidence_collected",
    confidence: modelGenerated ? geminiProposal.confidence : (files.length ? 72 : 58),
    steps: steps.map((step) => ({ ...step, status: step.id === "draft_patch" && !modelGenerated ? "blocked" : "complete" })),
    evidence: {
      trace,
      files: files.length ? files : [{
        path: "No source files detected",
        note: "The failed trace did not expose a repository file path. Inspect the raw log and MR diff manually."
      }]
    },
    patch: {
      state: modelGenerated ? "gemini_drafted" : "needs_gemini_patch_generation",
      diff: modelGenerated
        ? geminiProposal.diff
        : [
          "Real GitLab evidence has been collected.",
          "",
          "Patch generation is intentionally blocked until GEMINI_API_KEY is configured.",
          "Next integration point: send trace, MR diff, and fetched files to Gemini, then validate in a sandbox."
        ].join("\n"),
      branch
    },
    mergeRequest: {
      state: modelGenerated ? "requires_human_approval" : "not_created",
      title: `DevOps Medic: recover pipeline #${pipeline.id}`,
      branch,
      targetBranch: pipeline.ref,
      sourceMergeRequest: mergeRequest ? `!${mergeRequest.iid}` : "not found",
      description: {
        broke: `${job.name} failed with: ${signal}`,
        why: modelGenerated ? geminiProposal.rootCause : "Root cause requires Gemini-assisted analysis of the collected trace and file context.",
        fixed: modelGenerated ? geminiProposal.summary : "No repository mutation has been made. This run is read-only evidence collection.",
        validation: modelGenerated ? geminiProposal.validation : `After patch generation, re-run ${job.name} for ${pipeline.ref}.`
      }
    },
    controls: {
      protectedBranchPush: false,
      humanApprovalRequired: true,
      maxFilesChanged: 3,
      maxPatchBytes: 12000
    },
    gitlab: {
      projectId: runtimeConfig.gitlabProjectId,
      pipelineUrl: pipeline.web_url,
      jobUrl: job.web_url,
      mergeRequestUrl: mergeRequest?.web_url || ""
    },
    gemini: {
      configured: Boolean(runtimeConfig.geminiApiKey),
      model: runtimeConfig.geminiModel,
      generatedPatch: modelGenerated
    },
    createdAt: new Date().toISOString()
  };

  investigations.set(investigation.id, investigation);
  audit("gitlab.investigation.run", {
    pipelineId: pipeline.id,
    jobId: job.id,
    job: job.name,
    branch: pipeline.ref,
    files: files.map((file) => file.path),
    geminiGeneratedPatch: modelGenerated
  });

  return investigation;
}

function writeJson(res, statusCode, payload) {
  const body = JSON.stringify(payload, null, 2);
  applyCommonHeaders(res);
  res.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store"
  });
  res.end(body);
}

function readJson(req) {
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", (chunk) => {
      body += chunk;
      if (body.length > BODY_LIMIT_BYTES) {
        req.destroy();
        reject(new Error("Payload too large"));
      }
    });
    req.on("end", () => {
      if (!body) {
        resolve({});
        return;
      }
      try {
        resolve(JSON.parse(body));
      } catch (error) {
        reject(error);
      }
    });
  });
}

function applyCommonHeaders(res) {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("Cross-Origin-Opener-Policy", "same-origin");
  res.setHeader("Referrer-Policy", "no-referrer");
  res.setHeader("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
  res.setHeader(
    "Content-Security-Policy",
    "default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'"
  );
}

function getClientIp(req) {
  return req.socket.remoteAddress || "unknown";
}

function isRateLimited(req) {
  const ip = getClientIp(req);
  const now = Date.now();
  const windowMs = 60_000;
  const current = rateLimitBuckets.get(ip);

  if (!current || now - current.startedAt >= windowMs) {
    rateLimitBuckets.set(ip, { count: 1, startedAt: now });
    return false;
  }

  current.count += 1;
  return current.count > API_RATE_LIMIT_PER_MINUTE;
}

function cleanupRateLimitBuckets() {
  const cutoff = Date.now() - 120_000;
  for (const [ip, bucket] of rateLimitBuckets.entries()) {
    if (bucket.startedAt < cutoff) rateLimitBuckets.delete(ip);
  }
}

function audit(action, details) {
  const entry = {
    id: crypto.randomUUID(),
    action,
    details,
    at: new Date().toISOString()
  };
  auditLog.unshift(entry);
  auditLog.splice(100);
  return entry;
}

function publicPipeline(pipeline) {
  return {
    id: pipeline.id,
    displayId: `#${pipeline.id}`,
    job: pipeline.job,
    branch: pipeline.branch,
    mr: pipeline.mr,
    failedAgo: pipeline.failedAgo,
    title: pipeline.title,
    reason: pipeline.reason,
    status: pipeline.status,
    runner: pipeline.runner
  };
}

function buildInvestigation(pipeline) {
  const branch = `devops-medic/patch-pipeline-${pipeline.id}`;
  return {
    id: crypto.randomUUID(),
    pipelineId: pipeline.id,
    state: "ready_for_review",
    confidence: pipeline.confidence,
    steps: steps.map((step) => ({ ...step, status: "complete" })),
    evidence: {
      trace: pipeline.trace,
      files: pipeline.files
    },
    patch: {
      state: "drafted",
      diff: pipeline.patch,
      branch
    },
    mergeRequest: {
      state: "requires_human_approval",
      title: `DevOps Medic: recover pipeline #${pipeline.id}`,
      branch,
      targetBranch: pipeline.branch,
      description: {
        broke: pipeline.mr.broke,
        why: pipeline.mr.why,
        fixed: pipeline.mr.fixed,
        validation: `Re-run ${pipeline.job} for ${pipeline.branch} before merge.`
      }
    },
    controls: {
      protectedBranchPush: false,
      humanApprovalRequired: true,
      maxFilesChanged: 3,
      maxPatchBytes: 12000
    },
    createdAt: new Date().toISOString()
  };
}

function verifyWebhook(req) {
  if (IS_PRODUCTION && !runtimeConfig.webhookToken) return false;
  if (!runtimeConfig.webhookToken) return true;
  const provided = req.headers["x-gitlab-token"] || "";
  const providedBuffer = Buffer.from(provided);
  const expectedBuffer = Buffer.from(runtimeConfig.webhookToken);
  if (providedBuffer.length !== expectedBuffer.length) return false;
  return crypto.timingSafeEqual(providedBuffer, expectedBuffer);
}

function routeStatic(req, res) {
  if (req.method !== "GET" && req.method !== "HEAD") {
    applyCommonHeaders(res);
    res.writeHead(405, { Allow: "GET, HEAD" });
    res.end("Method not allowed");
    return;
  }

  let url;
  try {
    url = new URL(req.url, `http://${req.headers.host || "localhost"}`);
  } catch {
    applyCommonHeaders(res);
    res.writeHead(400);
    res.end("Bad request");
    return;
  }

  let requestedPath;
  try {
    requestedPath = decodeURIComponent(url.pathname === "/" ? "/index.html" : url.pathname);
  } catch {
    applyCommonHeaders(res);
    res.writeHead(400);
    res.end("Bad request");
    return;
  }

  const asset = STATIC_ASSETS.get(requestedPath);
  if (!asset) {
    applyCommonHeaders(res);
    res.writeHead(404);
    res.end("Not found");
    return;
  }

  const filePath = path.join(ROOT, asset.file);
  fs.readFile(filePath, (error, data) => {
    if (error) {
      applyCommonHeaders(res);
      res.writeHead(404);
      res.end("Not found");
      return;
    }
    applyCommonHeaders(res);
    res.writeHead(200, {
      "Content-Type": asset.type,
      "Cache-Control": staticCacheControl(asset)
    });
    res.end(req.method === "HEAD" ? undefined : data);
  });
}

async function routeApi(req, res) {
  const url = new URL(req.url, `http://${req.headers.host || "localhost"}`);

  if (req.method === "GET" && url.pathname === "/api/setup") {
    writeJson(res, 200, { setup: publicSetup() });
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/setup") {
    if (!ALLOW_RUNTIME_SETUP) {
      writeJson(res, 403, {
        error: "Runtime repository setup is disabled. Configure GitLab with environment variables or set ALLOW_RUNTIME_SETUP=true."
      });
      return;
    }

    const payload = await readJson(req);
    const baseUrl = normalizeGitLabBaseUrl(payload.baseUrl || "https://gitlab.com");
    const projectId = String(payload.projectId || "").trim();
    const token = String(payload.token || "").trim();
    const webhookToken = String(payload.webhookToken || "").trim();

    if (!projectId || !token) {
      runtimeConfig.gitlabBaseUrl = baseUrl;
      runtimeConfig.gitlabProjectId = "";
      runtimeConfig.gitlabToken = "";
      runtimeConfig.webhookToken = webhookToken;
      runtimeConfig.source = "mock";
      investigations.clear();
      audit("setup.mock_mode", { baseUrl });
      writeJson(res, 200, { setup: publicSetup(), message: "Mock mode enabled." });
      return;
    }

    runtimeConfig.gitlabBaseUrl = baseUrl;
    runtimeConfig.gitlabProjectId = projectId;
    runtimeConfig.gitlabToken = token;
    runtimeConfig.webhookToken = webhookToken;
    runtimeConfig.source = "session";
    investigations.clear();
    audit("setup.gitlab_configured", { baseUrl, projectId });
    writeJson(res, 200, { setup: publicSetup(), message: "GitLab connection saved for this server session." });
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/health") {
    writeJson(res, 200, {
      ok: true,
      env: NODE_ENV,
      uptimeSeconds: Math.round(process.uptime()),
      mode: isGitLabConfigured()
        ? (runtimeConfig.geminiApiKey ? "gitlab-mcp-gemini" : "gitlab-live-readonly")
        : "mock-gitlab-mcp",
      webhookVerification: runtimeConfig.webhookToken ? "enabled" : "disabled",
      runtimeSetupAllowed: ALLOW_RUNTIME_SETUP,
      gitlab: {
        configured: isGitLabConfigured(),
        baseUrl: runtimeConfig.gitlabBaseUrl,
        projectId: runtimeConfig.gitlabProjectId || "not configured",
        mutationMode: "read-only until approval workflow is implemented"
      },
      gemini: {
        configured: Boolean(runtimeConfig.geminiApiKey),
        model: runtimeConfig.geminiModel,
        role: "diagnosis and patch drafting"
      }
    });
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/pipelines") {
    if (isGitLabConfigured()) {
      const livePipelines = await listFailedPipelinesFromGitLab();
      writeJson(res, 200, {
        source: "gitlab",
        pipelines: livePipelines.map(publicPipeline),
        failedCount: livePipelines.length
      });
      return;
    }

    writeJson(res, 200, {
      source: "mock",
      pipelines: pipelines.map(publicPipeline),
      failedCount: pipelines.length
    });
    return;
  }

  const runMatch = url.pathname.match(/^\/api\/investigations\/([^/]+)\/run$/);
  if (req.method === "POST" && runMatch) {
    if (isGitLabConfigured()) {
      const investigation = await buildGitLabInvestigation(runMatch[1]);
      writeJson(res, 201, { investigation });
      return;
    }

    const pipeline = pipelines.find((item) => item.id === runMatch[1]);
    if (!pipeline) {
      writeJson(res, 404, { error: "Pipeline not found" });
      return;
    }
    const investigation = buildInvestigation(pipeline);
    investigations.set(investigation.id, investigation);
    audit("investigation.run", {
      pipelineId: pipeline.id,
      job: pipeline.job,
      branch: pipeline.branch,
      files: pipeline.files.map((file) => file.path)
    });
    writeJson(res, 201, { investigation });
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/investigations") {
    writeJson(res, 200, { investigations: [...investigations.values()] });
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/audit") {
    writeJson(res, 200, { events: auditLog });
    return;
  }

  if (req.method === "POST" && url.pathname === "/webhooks/gitlab") {
    if (!verifyWebhook(req)) {
      audit("webhook.rejected", { reason: "token_mismatch" });
      writeJson(res, 401, { error: "Invalid GitLab webhook token" });
      return;
    }

    const payload = await readJson(req);
    audit("webhook.accepted", {
      objectKind: payload.object_kind || payload.objectKind || "unknown",
      project: payload.project?.path_with_namespace || payload.project?.name || "unknown",
      pipelineId: payload.object_attributes?.id || payload.pipeline_id || "unknown"
    });
    writeJson(res, 202, { accepted: true });
    return;
  }

  writeJson(res, 404, { error: "Not found" });
}

const server = http.createServer((req, res) => {
  req.setTimeout(REQUEST_TIMEOUT_MS);

  if (isRateLimited(req)) {
    writeJson(res, 429, { error: "Too many requests" });
    return;
  }

  if (!req.url.startsWith("/api/") && !req.url.startsWith("/webhooks/")) {
    routeStatic(req, res);
    return;
  }

  routeApi(req, res).catch((error) => {
    audit("server.error", { message: error.message });
    writeJson(res, 400, { error: error.message });
  });
});

server.keepAliveTimeout = 65_000;
server.headersTimeout = 66_000;
server.requestTimeout = REQUEST_TIMEOUT_MS;

server.listen(PORT, () => {
  console.log(`DevOps Medic listening on http://localhost:${PORT} (${NODE_ENV})`);
});

server.on("clientError", (error, socket) => {
  audit("server.client_error", { message: error.message });
  if (socket.writable) socket.end("HTTP/1.1 400 Bad Request\r\n\r\n");
});

const rateLimitCleanupTimer = setInterval(cleanupRateLimitBuckets, 60_000);
rateLimitCleanupTimer.unref();

function shutdown(signal) {
  console.log(`${signal} received, shutting down.`);
  server.close(() => {
    clearInterval(rateLimitCleanupTimer);
    process.exit(0);
  });

  setTimeout(() => {
    console.error("Graceful shutdown timed out.");
    process.exit(1);
  }, SHUTDOWN_GRACE_MS).unref();
}

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
