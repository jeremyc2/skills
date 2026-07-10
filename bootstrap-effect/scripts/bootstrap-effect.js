import { existsSync, mkdirSync } from "node:fs";
import { basename, join } from "node:path";

const root = process.cwd();
const referenceRepositoriesDirectory = "reference_repositories";
const effectTsgoSchemaUrl = "https://raw.githubusercontent.com/Effect-TS/tsgo/refs/heads/main/schema.json";
const installedBiomeSchemaPath = join(root, "node_modules/@biomejs/biome/configuration_schema.json");
const $ = Bun.$.cwd(root).env(process.env);
// Throw a project-configuration error.
const fail = (message) => { throw new Error(message); };

// Read and require a JSON object from a JSON or JSONC file.
async function readJsonObject(path) {
  const value = Bun.JSONC.parse(await Bun.file(path).text());
  if (value && typeof value === "object" && !Array.isArray(value)) return value;
  return fail(`${path} must contain an object`);
}

// 🟠 Serialize and write a formatted JSON file.
function writeJson(path, value) {
  // 🟠 Write the formatted JSON value to disk.
  return Bun.write(path, `${JSON.stringify(value, null, 2)}\n`);
}

// Ensure a nested configuration value is an object.
function ensureObject(parent, key) {
  const value = parent[key] ?? (parent[key] = {});
  return value && typeof value === "object" && !Array.isArray(value)
    ? value
    : fail(`${key} must be an object`);
}

// 🟠 Append missing lines to a text file.
async function ensureLines(path, lines) {
  const text = existsSync(path) ? await Bun.file(path).text() : "";
  const present = new Set(text.split("\n").map((line) => line.trim()));
  const missing = lines.filter((line) => !present.has(line));
  if (missing.length) {
    // 🟠 Write the original content followed by the missing lines.
    await Bun.write(path, `${text}${text && !text.endsWith("\n") ? "\n" : ""}${missing.join("\n")}\n`);
  }
}

// Merge nested configuration objects.
function mergeObjects(target, source) {
  for (const [key, value] of Object.entries(source)) {
    target[key] = value && typeof value === "object" && !Array.isArray(value)
      ? mergeObjects(ensureObject(target, key), value)
      : value;
  }
  return target;
}

// 🟠 Configure Bun test discovery without replacing unrelated settings.
async function configureBunTestExclusions() {
  const path = join(root, "bunfig.toml");
  const referenceRepositoryGlob = `${referenceRepositoriesDirectory}/**`;
  if (!existsSync(path)) {
    // 🟠 Create bunfig.toml with the reference-repository test exclusion.
    return Bun.write(path, `[test]\npathIgnorePatterns = ["${referenceRepositoryGlob}"]\n`);
  }
  const text = await Bun.file(path).text();
  const config = Bun.TOML.parse(text);
  const ignoredTestPaths = config.test?.pathIgnorePatterns;
  if (Array.isArray(ignoredTestPaths) && ignoredTestPaths.includes(referenceRepositoryGlob)) return;
  if (ignoredTestPaths !== undefined && !Array.isArray(ignoredTestPaths)) fail("bunfig test.pathIgnorePatterns must be an array");
  if (!config.test) {
    // 🟠 Add the test table and reference-repository exclusion to bunfig.toml.
    return Bun.write(path, `${text}${text.endsWith("\n") ? "" : "\n"}\n[test]\npathIgnorePatterns = ["${referenceRepositoryGlob}"]\n`);
  }
  const lines = text.split("\n");
  const testTableLine = lines.findIndex((line) => line.trim() === "[test]");
  const nextTableLine = lines.findIndex((line, index) => index > testTableLine && line.trim().startsWith("["));
  const ignorePatternsLine = lines.findIndex((line, index) => index > testTableLine && (nextTableLine < 0 || index < nextTableLine) && line.trim().startsWith("pathIgnorePatterns"));
  if (ignorePatternsLine >= 0 && !lines[ignorePatternsLine].includes("]")) fail("Multiline bunfig test.pathIgnorePatterns is not supported");
  const rendered = `pathIgnorePatterns = ${JSON.stringify([...(ignoredTestPaths ?? []), referenceRepositoryGlob])}`;
  ignorePatternsLine < 0 ? lines.splice(testTableLine + 1, 0, rendered) : (lines[ignorePatternsLine] = rendered);
  // 🟠 Update bunfig.toml with the merged test exclusions.
  await Bun.write(path, lines.join("\n"));
}

// 🟠 Write the expected Biome configuration shape.
async function configureBiome() {
  const biomeJson = join(root, "biome.json");
  const biomeJsonc = join(root, "biome.jsonc");
  if (existsSync(biomeJson) && existsSync(biomeJsonc)) fail("Keep only one of biome.json and biome.jsonc");
  const path = existsSync(biomeJsonc) ? biomeJsonc : biomeJson;
  const biomeConfig = existsSync(path) ? await readJsonObject(path) : {};
  biomeConfig.$schema = "./node_modules/@biomejs/biome/configuration_schema.json";
  ensureObject(ensureObject(biomeConfig, "css"), "parser").tailwindDirectives = true;
  ensureObject(ensureObject(ensureObject(biomeConfig, "assist"), "actions"), "source").organizeImports = "on";
  ensureObject(ensureObject(ensureObject(biomeConfig, "linter"), "rules"), "complexity").useLiteralKeys = "off";
  const includedFiles = ensureObject(biomeConfig, "files").includes;
  if (includedFiles === undefined) ensureObject(biomeConfig, "files").includes = ["**", `!${referenceRepositoriesDirectory}/**`];
  else if (!Array.isArray(includedFiles)) fail("Biome files.includes must be an array");
  else if (![ `!${referenceRepositoriesDirectory}`, `!${referenceRepositoriesDirectory}/**` ].some((glob) => includedFiles.includes(glob))) includedFiles.push(`!${referenceRepositoriesDirectory}/**`);
  // 🟠 Write the schema-compatible Biome configuration.
  await writeJson(path, biomeConfig);
  return path;
}

// 🔴 Add, initialize, or update a Git submodule.
async function ensureSubmodule(url, path) {
  // 🔴 Check whether the reference repository is already registered.
  const registeredSubmoduleProbe = await $`git config -f .gitmodules --get ${`submodule.${path}.url`}`.quiet().nothrow();
  const registeredUrl = registeredSubmoduleProbe.exitCode === 0 ? registeredSubmoduleProbe.stdout.toString().trim() : "";
  if (registeredUrl && registeredUrl !== url) fail(`${path} uses unexpected submodule URL ${registeredUrl}`);
  if (registeredUrl) {
    // 🔴 Initialize or update the registered reference repository.
    return $`git submodule update --init --recursive -- ${path}`.quiet();
  }
  if (existsSync(join(root, path))) fail(`${path} exists but is not a submodule`);
  // 🔴 Clone and register the missing reference repository.
  await $`git submodule add ${url} ${path}`.quiet();
}

if (!existsSync(join(root, "package.json"))) {
  // 🔴 Initialize the Bun project.
  await $`bun init -y -m`.quiet();
}
// 🔴 Check whether the current directory is already inside a Git repository.
const gitRepositoryProbe = await $`git rev-parse --is-inside-work-tree`.quiet().nothrow();
if (gitRepositoryProbe.exitCode !== 0) {
  // 🔴 Initialize the Git repository.
  await $`git init -b main`.quiet();
}
// 🔴 Install development dependencies without running lifecycle scripts.
await $`bun add --ignore-scripts -D typescript@latest @biomejs/biome@latest @effect/tsgo@latest`.quiet();
// 🔴 Install the Effect runtime without running lifecycle scripts.
await $`bun add --ignore-scripts effect@beta`.quiet();

// Configure package metadata and scripts.
const packagePath = join(root, "package.json");
const packageJson = await readJsonObject(packagePath);
packageJson.name ||= basename(root).toLowerCase().replaceAll(" ", "-");
packageJson.description ||= "An Effect v4 project.";
packageJson.scripts = {
  ...ensureObject(packageJson, "scripts"),
  typecheck: "tsc",
  check: "bun --bun biome check --write",
  "references:update": "git submodule update --init --recursive",
  prepare: "effect-tsgo patch",
  "chore:update": "bun update --latest && bun add effect@beta",
};
// 🟠 Write package metadata and project scripts to package.json.
await writeJson(packagePath, packageJson);
// 🟠 Add required ignore patterns to .gitignore.
await ensureLines(join(root, ".gitignore"), ["node_modules", ".env", ".env.*", ".DS_Store"]);
const biomeConfigPath = await configureBiome();
// 🔴 Validate the written configuration directly against Biome's installed JSON Schema.
await $`bunx --bun @sourcemeta/jsonschema@16.1.0 validate ${installedBiomeSchemaPath} ${biomeConfigPath}`.quiet();
await configureBunTestExclusions();

// 🔴 Fetch Effect's current plugin schema to enable every diagnostic as an error.
const effectSchemaResponse = await fetch(effectTsgoSchemaUrl);
if (!effectSchemaResponse.ok) fail(`Could not fetch Effect schema: HTTP ${effectSchemaResponse.status}`);
const effectSchema = await effectSchemaResponse.json();
const severityProperties = effectSchema.definitions?.effectLanguageServicePluginDiagnosticSeverityDefinition?.properties;
if (!severityProperties || !Object.keys(severityProperties).length) fail("Effect schema has no diagnostic severity properties");
const effectPlugin = {
  name: "@effect/language-service",
  diagnosticSeverity: Object.fromEntries(Object.keys(severityProperties).map((name) => [name, "error"])),
};

// Configure strict compiler options and the Effect language-service plugin.
const tsconfigPath = join(root, "tsconfig.json");
const tsconfig = existsSync(tsconfigPath) ? await readJsonObject(tsconfigPath) : {};
tsconfig.$schema = effectTsgoSchemaUrl;
const compilerOptions = ensureObject(tsconfig, "compilerOptions");
if (compilerOptions.plugins !== undefined && !Array.isArray(compilerOptions.plugins)) fail("tsconfig compilerOptions.plugins must be an array");
const compilerPlugins = [...(compilerOptions.plugins ?? [])];
const effectPluginIndex = compilerPlugins.findIndex((plugin) => plugin?.name === effectPlugin.name);
effectPluginIndex < 0 ? compilerPlugins.push(effectPlugin) : (compilerPlugins[effectPluginIndex] = effectPlugin);
for (const optionName of [
  "strict",
  "skipLibCheck",
  "noFallthroughCasesInSwitch",
  "noUncheckedIndexedAccess",
  "noImplicitOverride",
  "erasableSyntaxOnly",
  "noUnusedLocals",
  "noUnusedParameters",
  "noPropertyAccessFromIndexSignature",
  "plugins",
]) delete compilerOptions[optionName];
tsconfig.compilerOptions = {
  ...compilerOptions,
  strict: true,
  skipLibCheck: true,
  noFallthroughCasesInSwitch: true,
  noUncheckedIndexedAccess: true,
  noImplicitOverride: true,
  erasableSyntaxOnly: true,
  noUnusedLocals: true,
  noUnusedParameters: true,
  noPropertyAccessFromIndexSignature: true,
  plugins: compilerPlugins,
};
if (tsconfig.exclude === undefined) tsconfig.exclude = [`${referenceRepositoriesDirectory}/**/*`];
else if (!Array.isArray(tsconfig.exclude)) fail("tsconfig exclude must be an array");
else if (!tsconfig.exclude.includes(`${referenceRepositoriesDirectory}/**/*`)) tsconfig.exclude.push(`${referenceRepositoriesDirectory}/**/*`);
// 🟠 Write strict compiler options and the Effect plugin to tsconfig.json.
await writeJson(tsconfigPath, tsconfig);

// Add a compiler input only when the repository has no source files.
const extensions = [".ts", ".tsx", ".mts", ".cts", ".js", ".jsx", ".mjs", ".cjs"];
let hasSource = false;
for await (const path of new Bun.Glob("**/*").scan({ cwd: root, onlyFiles: true })) {
  if (!["node_modules/", `${referenceRepositoriesDirectory}/`, ".git/"].some((prefix) => path.startsWith(prefix)) && extensions.some((extension) => path.endsWith(extension))) { hasSource = true; break; }
}
if (!hasSource) {
  // 🟠 Create a minimal index.ts so typechecking has an input.
  await Bun.write(join(root, "index.ts"), "export {};\n");
}

// Preserve existing agent guidance while adding project invariants.
// 🟠 Add project invariants to AGENTS.md.
await ensureLines(join(root, "AGENTS.md"), [
  "- Avoid using regex where possible. Add a comment above each non-trivial regex breaking it down.",
  "- Reference the git submodules in `reference_repositories` for best practices, usage examples, and documentation for the frameworks and packages we use.",
  "- NEVER loosen `diagnosticSeverity` rules in `tsconfig.json`.",
]);

// 🟠 Create the VS Code settings directory if it is missing.
mkdirSync(join(root, ".vscode"), { recursive: true });
const vscodePath = join(root, ".vscode/settings.json");
const vscodeSettings = existsSync(vscodePath) ? await readJsonObject(vscodePath) : {};
mergeObjects(vscodeSettings, {
  "css.lint.unknownAtRules": "ignore",
  "editor.codeActionsOnSave": { "source.fixAll.biome": "explicit", "source.organizeImports.biome": "explicit" },
  "editor.defaultFormatter": "biomejs.biome",
  "editor.formatOnSave": true,
  "files.readonlyInclude": { [`${referenceRepositoriesDirectory}/**`]: true },
  "files.watcherExclude": { [`${referenceRepositoriesDirectory}/**`]: true },
  "js/ts.tsdk.promptToUseWorkspaceVersion": true,
  "js/ts.experimental.useTsgo": true,
  "js/ts.suggest.autoImports": true,
  "js/ts.updateImportsOnFileMove.enabled": "always",
  "json.schemaDownload.enable": true,
  "search.exclude": { [`${referenceRepositoriesDirectory}/**`]: true },
  "typescript.enablePromptUseWorkspaceTsdk": true,
  "typescript.experimental.useTsgo": true,
  "typescript.native-preview.tsdk": "node_modules/typescript",
  "typescript.suggest.autoImports": true,
  "typescript.updateImportsOnFileMove.enabled": "always",
});
// 🟠 Write merged workspace preferences to .vscode/settings.json.
await writeJson(vscodePath, vscodeSettings);

await ensureSubmodule("https://github.com/Effect-TS/effect-smol.git", `${referenceRepositoriesDirectory}/effect-smol`);
await ensureSubmodule("https://github.com/mattpocock/skills.git", `${referenceRepositoriesDirectory}/mattpocock-skills`);

// 🔴 Synchronize installed dependencies without running lifecycle scripts.
await $`bun install --ignore-scripts`.quiet();
// 🔴 Patch the native TypeScript compiler with the Effect language service.
await $`bun prepare`.quiet();
// 🔴 Format and check the completed project.
await $`bun check`.quiet();
// 🔴 Typecheck the completed project.
await $`bun typecheck`.quiet();
console.log("Effect v4 project bootstrap complete.");
