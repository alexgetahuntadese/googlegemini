const pipelines = [
  {
    id: "#12841",
    job: "unit:test",
    branch: "feature/cache-layer",
    mr: "!482",
    failedAgo: "7 min ago",
    confidence: 91,
    title: "Cache service regression",
    reason: "TypeError in cache adapter test",
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
    id: "#12836",
    job: "build:web",
    branch: "feature/billing-tabs",
    mr: "!477",
    failedAgo: "21 min ago",
    confidence: 87,
    title: "Billing UI compile failure",
    reason: "Missing exported type",
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
    id: "#12822",
    job: "integration:db",
    branch: "fix/report-export",
    mr: "!468",
    failedAgo: "43 min ago",
    confidence: 83,
    title: "Report export database test",
    reason: "Missing migration column",
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

const steps = [
  {
    title: "Fetch failed pipeline",
    body: "Using pipelines tool to inspect pipeline execution details and identify failed jobs."
  },
  {
    title: "Pull raw job trace",
    body: "Reading stderr and raw logs before attempting any diagnosis."
  },
  {
    title: "Map stack trace to code",
    body: "Using repository search to fetch source files, tests, and recent merge request diffs."
  },
  {
    title: "Draft minimal patch",
    body: "Creating the smallest change that resolves the observed failure."
  },
  {
    title: "Prepare merge request",
    body: "Writing a human-reviewable MR with failure, cause, and fix sections."
  }
];

const state = {
  selected: pipelines[0],
  running: false
};

const pipelineList = document.querySelector("#pipelineList");
const pipelineId = document.querySelector("#pipelineId");
const jobName = document.querySelector("#jobName");
const branchName = document.querySelector("#branchName");
const confidenceValue = document.querySelector("#confidenceValue");
const timeline = document.querySelector("#timeline");
const traceOutput = document.querySelector("#traceOutput");
const fileStack = document.querySelector("#fileStack");
const filesTouched = document.querySelector("#filesTouched");
const patchOutput = document.querySelector("#patchOutput");
const patchState = document.querySelector("#patchState");
const mrCopy = document.querySelector("#mrCopy");
const agentState = document.querySelector("#agentState");
const runMedic = document.querySelector("#runMedic");
const resetDemo = document.querySelector("#resetDemo");
const openMr = document.querySelector("#openMr");
const copyTrace = document.querySelector("#copyTrace");

function renderPipelines() {
  pipelineList.innerHTML = "";

  pipelines.forEach((pipeline) => {
    const card = document.createElement("button");
    card.type = "button";
    card.className = `pipeline-card${pipeline.id === state.selected.id ? " active" : ""}`;
    card.innerHTML = `
      <strong>${pipeline.title}</strong>
      <div class="pipeline-meta">
        <span>${pipeline.id}</span>
        <span>${pipeline.job}</span>
        <span>${pipeline.failedAgo}</span>
      </div>
      <div class="pipeline-meta">
        <span>${pipeline.reason}</span>
      </div>
    `;
    card.addEventListener("click", () => {
      if (state.running) return;
      state.selected = pipeline;
      resetInvestigation();
      renderPipelines();
      renderSelected();
    });
    pipelineList.appendChild(card);
  });
}

function renderSelected() {
  const pipeline = state.selected;
  pipelineId.textContent = pipeline.id;
  jobName.textContent = pipeline.job;
  branchName.textContent = pipeline.branch;
  confidenceValue.textContent = "0%";
  traceOutput.textContent = "Raw trace will appear after the medic reads job logs.";
  fileStack.innerHTML = `<div class="file-card"><strong>Waiting for MCP search</strong><p>Source context appears here after stack trace mapping.</p></div>`;
  filesTouched.textContent = "0 files";
  patchOutput.textContent = "No patch drafted yet.";
  patchState.textContent = "not drafted";
  mrCopy.textContent = "Select a failed pipeline and run the medic to generate a merge request summary.";
  openMr.disabled = true;
}

function resetInvestigation() {
  agentState.textContent = "idle";
  agentState.className = "pill";
  timeline.innerHTML = "";
  steps.forEach((step) => {
    const item = document.createElement("li");
    item.innerHTML = `
      <span class="timeline-marker" aria-hidden="true"></span>
      <div>
        <strong>${step.title}</strong>
        <span>${step.body}</span>
      </div>
    `;
    timeline.appendChild(item);
  });
}

function wait(ms) {
  return new Promise((resolve) => {
    window.setTimeout(resolve, ms);
  });
}

async function runInvestigation() {
  if (state.running) return;

  state.running = true;
  runMedic.disabled = true;
  resetDemo.disabled = true;
  agentState.textContent = "running";
  agentState.className = "pill warning";
  renderSelected();
  resetInvestigation();

  const items = [...timeline.querySelectorAll("li")];

  for (let index = 0; index < items.length; index += 1) {
    items[index].classList.add("complete");

    if (index === 1) {
      traceOutput.textContent = state.selected.trace;
    }

    if (index === 2) {
      renderFiles();
      confidenceValue.textContent = `${Math.max(state.selected.confidence - 18, 60)}%`;
    }

    if (index === 3) {
      patchOutput.textContent = state.selected.patch;
      patchState.textContent = "drafted";
    }

    if (index === 4) {
      confidenceValue.textContent = `${state.selected.confidence}%`;
      renderMergeRequest();
      openMr.disabled = false;
    }

    await wait(620);
  }

  agentState.textContent = "ready for review";
  agentState.className = "pill success";
  runMedic.disabled = false;
  resetDemo.disabled = false;
  state.running = false;
}

function renderFiles() {
  fileStack.innerHTML = "";
  state.selected.files.forEach((file) => {
    const article = document.createElement("article");
    article.className = "file-card";
    article.innerHTML = `<strong>${file.path}</strong><p>${file.note}</p>`;
    fileStack.appendChild(article);
  });
  filesTouched.textContent = `${state.selected.files.length} files`;
}

function renderMergeRequest() {
  const branch = `devops-medic/patch-pipeline-${state.selected.id.replace("#", "")}`;
  mrCopy.innerHTML = `
    <h4>${branch}</h4>
    <p><strong>What broke:</strong> ${state.selected.mr.broke}</p>
    <p><strong>Why it broke:</strong> ${state.selected.mr.why}</p>
    <p><strong>How it was fixed:</strong> ${state.selected.mr.fixed}</p>
    <p><strong>Validation:</strong> Re-run ${state.selected.job} for ${state.selected.branch} before merge.</p>
  `;
}

runMedic.addEventListener("click", runInvestigation);

resetDemo.addEventListener("click", () => {
  if (state.running) return;
  resetInvestigation();
  renderSelected();
});

copyTrace.addEventListener("click", async () => {
  const text = traceOutput.textContent.trim();
  if (!text || text.startsWith("Raw trace")) return;

  try {
    await navigator.clipboard.writeText(text);
    copyTrace.textContent = "Copied";
    window.setTimeout(() => {
      copyTrace.textContent = "Copy";
    }, 900);
  } catch {
    copyTrace.textContent = "Copy failed";
    window.setTimeout(() => {
      copyTrace.textContent = "Copy";
    }, 900);
  }
});

openMr.addEventListener("click", () => {
  if (openMr.disabled) return;
  openMr.textContent = "MR drafted";
  window.setTimeout(() => {
    openMr.textContent = "Open MR";
  }, 1000);
});

document.querySelectorAll(".nav-item").forEach((button) => {
  button.addEventListener("click", () => {
    document.querySelectorAll(".nav-item").forEach((item) => item.classList.remove("active"));
    button.classList.add("active");
  });
});

renderPipelines();
resetInvestigation();
renderSelected();
