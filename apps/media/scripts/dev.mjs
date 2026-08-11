import { spawn } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const mediaDirectory = resolve(dirname(fileURLToPath(import.meta.url)), "..");

const mediaProcess = spawn("go", ["run", "./cmd/media"], {
  cwd: mediaDirectory,
  env: process.env,
  stdio: "inherit",
});

mediaProcess.once("error", (error) => {
  console.error(`Could not start the media service: ${error.message}`);
  process.exitCode = 1;
});

mediaProcess.once("exit", (code) => {
  process.exitCode = code ?? 1;
});
