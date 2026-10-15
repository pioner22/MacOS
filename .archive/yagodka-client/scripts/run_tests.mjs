import { spawn } from "node:child_process";

const args = ["--test", "test/*.test.mjs"];
const env = { ...process.env };
const nodeOptions = env.NODE_OPTIONS ? String(env.NODE_OPTIONS) : "";
if (nodeOptions) {
  const filtered = nodeOptions
    .split(/\s+/)
    .filter(Boolean)
    .filter((opt) => !opt.startsWith("--localstorage-file"));
  if (filtered.length) env.NODE_OPTIONS = filtered.join(" ");
  else delete env.NODE_OPTIONS;
}

const child = spawn(process.execPath, args, { stdio: "inherit", env });

child.on("exit", (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }
  process.exit(code ?? 1);
});
