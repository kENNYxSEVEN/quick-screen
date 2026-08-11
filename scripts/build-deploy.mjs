import {
  chmodSync,
  copyFileSync,
  cpSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { dirname, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const repositoryDirectory = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const deployDirectory = resolve(repositoryDirectory, "deploy");
const webDistDirectory = resolve(repositoryDirectory, "apps/web/dist");
const apiDistDirectory = resolve(repositoryDirectory, "apps/api/dist");
const apiPackagePath = resolve(repositoryDirectory, "apps/api/package.json");
const deploymentTemplateDirectory = resolve(repositoryDirectory, "deployment");
const deploymentEnvironmentTemplateNames = [
  "api.env.example",
  "media.env.example",
  "web.env.example",
];
const deploymentScriptNames = ["install.sh", "update.sh"];

function run(command, argumentsList, options = {}) {
  const result = spawnSync(command, argumentsList, {
    cwd: repositoryDirectory,
    env: process.env,
    stdio: "inherit",
    ...options,
  });

  if (result.error) {
    throw result.error;
  }
  if (result.status !== 0) {
    throw new Error(`${command} ${argumentsList.join(" ")} failed with exit code ${result.status}.`);
  }
}

function runPnpm(argumentsList, options) {
  if (process.env.npm_execpath) {
    run(process.execPath, [process.env.npm_execpath, ...argumentsList], options);

    return;
  }

  run(process.platform === "win32" ? "pnpm.cmd" : "pnpm", argumentsList, options);
}

function copyDirectoryContents(sourceDirectory, targetDirectory) {
  mkdirSync(targetDirectory, { recursive: true });

  for (const entry of readdirSync(sourceDirectory)) {
    cpSync(resolve(sourceDirectory, entry), resolve(targetDirectory, entry), {
      recursive: true,
    });
  }
}

function createApiPackageManifest() {
  const sourceManifest = JSON.parse(readFileSync(apiPackagePath, "utf8"));

  return {
    name: "screen-share-api",
    version: sourceManifest.version,
    private: true,
    type: "module",
    packageManager: "pnpm@11.20.0",
    scripts: {
      start: "node dist/server.js",
    },
    dependencies: sourceManifest.dependencies,
  };
}

function verifyLinuxMediaBinary(binaryPath) {
  const header = readFileSync(binaryPath).subarray(0, 4);

  if (
    header.length !== 4 ||
    header[0] !== 0x7f ||
    header[1] !== 0x45 ||
    header[2] !== 0x4c ||
    header[3] !== 0x46
  ) {
    throw new Error("The media artifact is not an ELF binary.");
  }
}

rmSync(deployDirectory, { recursive: true, force: true });
mkdirSync(deployDirectory, { recursive: true });

runPnpm(["--filter", "api", "build"]);
runPnpm(
  ["--filter", "web", "build"],
  {
    env: {
      ...process.env,
      // Empty means same-origin in apps/web/src/lib/api.ts and prevents a
      // local development API origin from being baked into the deploy build.
      VITE_API_ORIGIN: "",
    },
  },
);

const webArtifactDirectory = resolve(deployDirectory, "web");
const apiArtifactDirectory = resolve(deployDirectory, "api");
const mediaArtifactDirectory = resolve(deployDirectory, "media");
const environmentArtifactDirectory = resolve(deployDirectory, "env");
const mediaBinaryPath = resolve(mediaArtifactDirectory, "screen-share-media");

copyDirectoryContents(webDistDirectory, webArtifactDirectory);
copyDirectoryContents(apiDistDirectory, resolve(apiArtifactDirectory, "dist"));
writeFileSync(
  resolve(apiArtifactDirectory, "package.json"),
  `${JSON.stringify(createApiPackageManifest(), null, 2)}\n`,
);

mkdirSync(mediaArtifactDirectory, { recursive: true });
run(
  "go",
  [
    "-C",
    "apps/media",
    "build",
    "-trimpath",
    "-ldflags=-s -w",
    "-o",
    mediaBinaryPath,
    "./cmd/media",
  ],
  {
    env: {
      ...process.env,
      CGO_ENABLED: "0",
      GOARCH: "amd64",
      GOOS: "linux",
    },
  },
);
verifyLinuxMediaBinary(mediaBinaryPath);

mkdirSync(environmentArtifactDirectory, { recursive: true });
for (const templateName of deploymentEnvironmentTemplateNames) {
  copyFileSync(
    resolve(deploymentTemplateDirectory, templateName),
    resolve(environmentArtifactDirectory, templateName),
  );
}
for (const scriptName of deploymentScriptNames) {
  const targetPath = resolve(deployDirectory, scriptName);
  copyFileSync(resolve(deploymentTemplateDirectory, scriptName), targetPath);
  chmodSync(targetPath, 0o755);
}

console.log("Deployment artifacts prepared in deploy/.");
