const fallbackSteps = [
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
  pipelines: [],
  selected: null,
  running: false,
  latestInvestigation: null
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
const projectValue = document.querySelector("#projectValue");
const modeValue = document.querySelector("#modeValue");
const setupForm = document.querySelector("#setupForm");
const setupBaseUrl = document.querySelector("#setupBaseUrl");
const setupProjectId = document.querySelector("#setupProjectId");
const setupToken = document.querySelector("#setupToken");
const setupWebhookToken = document.querySelector("#setupWebhookToken");
const setupStatus = document.querySelector("#setupStatus");
const saveSetup = document.querySelector("#saveSetup");
const useMock = document.querySelector("#useMock");

async function api(path, options = {}) {
  const response = await fetch(path, {
    headers: { "Content-Type": "application/json" },
    ...options
  });

  if (!response.ok) {
    const payload = await response.json().catch(() => ({ error: response.statusText }));
    throw new Error(payload.error || "Request failed");
  }

  return response.json();
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function setAgentState(label, className = "") {
  agentState.textContent = label;
  agentState.className = `pill${className ? ` ${className}` : ""}`;
}

function setSetupStatus(label, className = "") {
  setupStatus.textContent = label;
  setupStatus.className = `pill${className ? ` ${className}` : ""}`;
}

function renderSetup(setup) {
  setupBaseUrl.value = setup.baseUrl || "https://gitlab.com";
  setupProjectId.value = setup.projectId || "";
  setupToken.placeholder = setup.tokenConfigured ? "configured for this session" : "glpat-...";
  setupWebhookToken.placeholder = setup.webhookTokenConfigured ? "configured for this session" : "optional";
  setSetupStatus(setup.configured ? "connected" : "mock mode", setup.configured ? "success" : "");
}

function renderPipelines() {
  pipelineList.innerHTML = "";

  state.pipelines.forEach((pipeline) => {
    const card = document.createElement("button");
    card.type = "button";
    card.className = `pipeline-card${pipeline.id === state.selected?.id ? " active" : ""}`;
    card.innerHTML = `
      <strong>${escapeHtml(pipeline.title)}</strong>
      <div class="pipeline-meta">
        <span>${escapeHtml(pipeline.displayId)}</span>
        <span>${escapeHtml(pipeline.job)}</span>
        <span>${escapeHtml(pipeline.failedAgo)}</span>
      </div>
      <div class="pipeline-meta">
        <span>${escapeHtml(pipeline.reason)}</span>
      </div>
    `;
    card.addEventListener("click", () => {
      if (state.running) return;
      state.selected = pipeline;
      state.latestInvestigation = null;
      resetInvestigation();
      renderPipelines();
      renderSelected();
    });
    pipelineList.appendChild(card);
  });
}

function renderSelected() {
  if (!state.selected) {
    pipelineId.textContent = "-";
    jobName.textContent = "-";
    branchName.textContent = "-";
    confidenceValue.textContent = "0%";
    traceOutput.textContent = "No pipeline loaded.";
    return;
  }

  const pipeline = state.selected;
  pipelineId.textContent = pipeline.displayId;
  jobName.textContent = pipeline.job;
  branchName.textContent = pipeline.branch;
  confidenceValue.textContent = "0%";
  traceOutput.textContent = "Raw trace will appear after the backend reads job logs.";
  fileStack.innerHTML = `<div class="file-card"><strong>Waiting for MCP search</strong><p>Source context appears here after stack trace mapping.</p></div>`;
  filesTouched.textContent = "0 files";
  patchOutput.textContent = "No patch drafted yet.";
  patchState.textContent = "not drafted";
  mrCopy.textContent = "Run the medic to generate a merge request summary with approval controls.";
  openMr.disabled = true;
}

function resetInvestigation(steps = fallbackSteps) {
  setAgentState("idle");
  timeline.innerHTML = "";
  steps.forEach((step) => {
    const item = document.createElement("li");
    item.innerHTML = `
      <span class="timeline-marker" aria-hidden="true"></span>
      <div>
        <strong>${escapeHtml(step.title)}</strong>
        <span>${escapeHtml(step.body)}</span>
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
  if (state.running || !state.selected) return;

  state.running = true;
  runMedic.disabled = true;
  resetDemo.disabled = true;
  setAgentState("requesting backend", "warning");
  renderSelected();
  resetInvestigation();

  try {
    const payload = await api(`/api/investigations/${state.selected.id}/run`, { method: "POST" });
    const investigation = payload.investigation;
    state.latestInvestigation = investigation;
    resetInvestigation(investigation.steps);
    await animateInvestigation(investigation);
    setAgentState("ready for review", "success");
  } catch (error) {
    setAgentState("failed", "danger");
    traceOutput.textContent = error.message;
  } finally {
    runMedic.disabled = false;
    resetDemo.disabled = false;
    state.running = false;
  }
}

async function animateInvestigation(investigation) {
  const items = [...timeline.querySelectorAll("li")];

  for (let index = 0; index < items.length; index += 1) {
    setAgentState(investigation.steps[index]?.title || "running", "warning");
    items[index].classList.add("complete");

    if (index === 1) {
      traceOutput.textContent = investigation.evidence.trace;
    }

    if (index === 2) {
      renderFiles(investigation.evidence.files);
      confidenceValue.textContent = `${Math.max(investigation.confidence - 18, 60)}%`;
    }

    if (index === 3) {
      patchOutput.textContent = investigation.patch.diff;
      patchState.textContent = investigation.patch.state;
    }

    if (index === 4) {
      confidenceValue.textContent = `${investigation.confidence}%`;
      renderMergeRequest(investigation);
      openMr.disabled = false;
    }

    await wait(520);
  }
}

function renderFiles(files) {
  fileStack.innerHTML = "";
  files.forEach((file) => {
    const article = document.createElement("article");
    article.className = "file-card";
    article.innerHTML = `<strong>${escapeHtml(file.path)}</strong><p>${escapeHtml(file.note)}</p>`;
    fileStack.appendChild(article);
  });
  filesTouched.textContent = `${files.length} files`;
}

function renderMergeRequest(investigation) {
  const description = investigation.mergeRequest.description;
  const gitlabLinks = investigation.gitlab
    ? `
      <div class="control-grid">
        <span>Pipeline</span>
        <strong><a href="${escapeHtml(investigation.gitlab.pipelineUrl)}" target="_blank" rel="noreferrer">Open</a></strong>
        <span>Failed job</span>
        <strong><a href="${escapeHtml(investigation.gitlab.jobUrl)}" target="_blank" rel="noreferrer">Open</a></strong>
        <span>Source MR</span>
        <strong>${investigation.gitlab.mergeRequestUrl ? `<a href="${escapeHtml(investigation.gitlab.mergeRequestUrl)}" target="_blank" rel="noreferrer">Open</a>` : "Not found"}</strong>
      </div>
    `
    : "";

  mrCopy.innerHTML = `
    <h4>${escapeHtml(investigation.mergeRequest.branch)}</h4>
    <p><strong>What broke:</strong> ${escapeHtml(description.broke)}</p>
    <p><strong>Why it broke:</strong> ${escapeHtml(description.why)}</p>
    <p><strong>How it was fixed:</strong> ${escapeHtml(description.fixed)}</p>
    <p><strong>Validation:</strong> ${escapeHtml(description.validation)}</p>
    ${gitlabLinks}
    <div class="control-grid">
      <span>Human approval required</span>
      <strong>${investigation.controls.humanApprovalRequired ? "Yes" : "No"}</strong>
      <span>Protected branch push</span>
      <strong>${investigation.controls.protectedBranchPush ? "Allowed" : "Blocked"}</strong>
      <span>Patch size limit</span>
      <strong>${investigation.controls.maxPatchBytes} bytes</strong>
    </div>
  `;
}

async function loadPipelines() {
  setAgentState("connecting", "warning");

  try {
    const health = await api("/api/health");
    const setupPayload = await api("/api/setup");
    const payload = await api("/api/pipelines");
    state.pipelines = payload.pipelines;
    state.selected = state.pipelines[0] || null;
    renderSetup(setupPayload.setup);
    setAgentState(health.mode, health.gitlab?.configured ? "success" : "");
    projectValue.textContent = health.gitlab?.configured ? `GitLab ${health.gitlab.projectId}` : "Mock project";
    modeValue.textContent = health.gitlab?.configured ? "Live read-only" : "MR ready";
    renderPipelines();
    resetInvestigation();
    renderSelected();

    if (!state.selected) {
      pipelineList.innerHTML = `<div class="file-card"><strong>No failed pipelines</strong><p>The configured GitLab project has no recent failed pipelines.</p></div>`;
    }
  } catch (error) {
    setAgentState("backend offline", "danger");
    pipelineList.innerHTML = `<div class="file-card"><strong>Backend unavailable</strong><p>${escapeHtml(error.message)}</p></div>`;
    traceOutput.textContent = "Start the backend with: node server.js";
    runMedic.disabled = true;
  }
}

async function saveRepositorySetup(event) {
  event.preventDefault();
  saveSetup.disabled = true;
  useMock.disabled = true;
  setSetupStatus("connecting", "warning");
  setAgentState("connecting repo", "warning");

  try {
    const payload = await api("/api/setup", {
      method: "POST",
      body: JSON.stringify({
        baseUrl: setupBaseUrl.value,
        projectId: setupProjectId.value,
        token: setupToken.value,
        webhookToken: setupWebhookToken.value
      })
    });
    setupToken.value = "";
    setupWebhookToken.value = "";
    renderSetup(payload.setup);
    state.latestInvestigation = null;
    await loadPipelines();
  } catch (error) {
    setSetupStatus("setup failed", "danger");
    setAgentState("setup failed", "danger");
    traceOutput.textContent = error.message;
  } finally {
    saveSetup.disabled = false;
    useMock.disabled = false;
  }
}

async function enableMockMode() {
  setupProjectId.value = "";
  setupToken.value = "";
  setupWebhookToken.value = "";
  await saveRepositorySetup(new Event("submit"));
}

runMedic.addEventListener("click", runInvestigation);
setupForm.addEventListener("submit", saveRepositorySetup);
useMock.addEventListener("click", enableMockMode);

resetDemo.addEventListener("click", () => {
  if (state.running) return;
  state.latestInvestigation = null;
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
  if (openMr.disabled || !state.latestInvestigation) return;
  openMr.textContent = "Approval queued";
  setAgentState("awaiting approval", "warning");
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

function closeMenus() {
  document.querySelectorAll("[data-menu-trigger]").forEach((trigger) => {
    trigger.setAttribute("aria-expanded", "false");
  });
  document.querySelectorAll(".dropdown-menu").forEach((menu) => {
    menu.classList.remove("open");
  });
}

document.querySelectorAll("[data-menu-trigger]").forEach((trigger) => {
  trigger.addEventListener("click", (event) => {
    event.stopPropagation();
    const menu = document.querySelector(`#${trigger.dataset.menuTrigger}`);
    const isOpen = menu.classList.contains("open");
    closeMenus();
    if (!isOpen) {
      trigger.setAttribute("aria-expanded", "true");
      menu.classList.add("open");
      menu.querySelector("button")?.focus();
    }
  });
});

document.querySelectorAll(".dropdown-menu button").forEach((item) => {
  item.addEventListener("click", () => {
    const menu = item.closest(".dropdown-menu");
    const value = item.dataset.menuValue;

    if (menu.id === "projectMenu") {
      projectValue.textContent = value;
      setAgentState(`project: ${value}`);
    }

    if (menu.id === "modeMenu") {
      modeValue.textContent = value;
      setAgentState(`mode: ${value}`);
    }

    if (menu.id === "safetyMenu") {
      setAgentState(value, "success");
    }

    closeMenus();
  });
});

document.addEventListener("click", closeMenus);

document.addEventListener("keydown", (event) => {
  if (event.key === "Escape") {
    closeMenus();
  }
});

resetInvestigation();
loadPipelines();
