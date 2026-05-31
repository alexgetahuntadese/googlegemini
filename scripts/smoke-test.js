const { spawn } = require("child_process");

const port = String(4500 + Math.floor(Math.random() * 1000));
const baseUrl = `http://127.0.0.1:${port}`;
const server = spawn(process.execPath, ["server.js"], {
  cwd: process.cwd(),
  env: {
    ...process.env,
    PORT: port,
    NODE_ENV: "test",
    GITLAB_TOKEN: "",
    GITLAB_PROJECT_ID: ""
  },
  stdio: ["ignore", "pipe", "pipe"]
});

let output = "";
let finished = false;

server.stdout.on("data", (chunk) => {
  output += chunk;
});

server.stderr.on("data", (chunk) => {
  output += chunk;
});

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForServer() {
  const deadline = Date.now() + 8_000;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${baseUrl}/api/health`);
      if (response.ok) return;
    } catch {
      await wait(150);
    }
  }
  throw new Error(`Server did not become healthy.\n${output}`);
}

async function assertOk(pathname, expectedContentType) {
  const response = await fetch(`${baseUrl}${pathname}`);
  if (!response.ok) {
    throw new Error(`${pathname} returned ${response.status}`);
  }
  const contentType = response.headers.get("content-type") || "";
  if (!contentType.includes(expectedContentType)) {
    throw new Error(`${pathname} returned unexpected content-type: ${contentType}`);
  }
  return response;
}

async function main() {
  await waitForServer();

  const health = await assertOk("/api/health", "application/json").then((res) => res.json());
  if (!health.ok || health.mode !== "mock-gitlab-mcp") {
    throw new Error(`Unexpected health payload: ${JSON.stringify(health)}`);
  }

  const setup = await assertOk("/api/setup", "application/json").then((res) => res.json());
  if (setup.setup.configured || setup.setup.tokenConfigured) {
    throw new Error(`Expected mock setup payload: ${JSON.stringify(setup)}`);
  }

  const pipelines = await assertOk("/api/pipelines", "application/json").then((res) => res.json());
  if (!Array.isArray(pipelines.pipelines) || pipelines.pipelines.length === 0) {
    throw new Error("Expected mock pipelines to be available.");
  }

  const page = await assertOk("/", "text/html").then((res) => res.text());
  if (!page.includes("DevOps Medic")) {
    throw new Error("Expected index page to render app shell.");
  }

  finished = true;
  server.kill("SIGTERM");
}

server.on("exit", (code, signal) => {
  if (finished) {
    console.log("Smoke test passed.");
    return;
  }
  console.error(output);
  console.error(`Server exited before smoke test completed. code=${code} signal=${signal}`);
  process.exit(1);
});

main().catch((error) => {
  console.error(error.message);
  server.kill("SIGTERM");
  process.exitCode = 1;
});
