import { existsSync, mkdirSync } from "node:fs";
import { basename, join } from "node:path";

/* Constants */

const root = process.cwd();
const referenceRepositoriesDirectory = "reference_repositories";
const effectTsgoSchemaUrl = "https://raw.githubusercontent.com/Effect-TS/tsgo/refs/heads/main/schema.json";
const installedBiomeSchemaPath = join(root, "node_modules/@biomejs/biome/configuration_schema.json");

/* Runtime utilities */

const $ = Bun.$.cwd(root).env(process.env);
// Throw a project-configuration error.
const fail = (message) => { throw new Error(message); };

/* JSONC and object utilities */

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

// Skip JSONC whitespace and comments.
function skipJsoncTrivia(text, start) {
  let index = start;
  while (index < text.length) {
    if (/\s/.test(text[index])) { index++; continue; }
    if (text.startsWith("//", index)) { const newline = text.indexOf("\n", index + 2); index = newline < 0 ? text.length : newline + 1; continue; }
    if (text.startsWith("/*", index)) { const end = text.indexOf("*/", index + 2); if (end < 0) fail("Unterminated JSONC comment"); index = end + 2; continue; }
    break;
  }
  return index;
}

// Find the end of one JSONC value without disturbing its original text.
function jsoncValueEnd(text, start) {
  let index = skipJsoncTrivia(text, start);
  if (text[index] === '"') {
    for (index++; index < text.length; index++) { if (text[index] === "\\") index++; else if (text[index] === '"') return index + 1; }
    return fail("Unterminated JSONC string");
  }
  if (text[index] === "{" || text[index] === "[") {
    const opening = text[index]; const closing = opening === "{" ? "}" : "]"; let depth = 0;
    for (; index < text.length; index++) {
      if (text[index] === '"') { index = jsoncValueEnd(text, index) - 1; continue; }
      if (text.startsWith("//", index) || text.startsWith("/*", index)) { index = skipJsoncTrivia(text, index) - 1; continue; }
      if (text[index] === opening) depth++; else if (text[index] === closing && --depth === 0) return index + 1;
    }
    return fail(`Unterminated JSONC ${opening}`);
  }
  while (index < text.length && ![",", "}", "]"].includes(text[index])) index++;
  return index;
}

// Read the direct properties and source ranges of a JSONC object.
function jsoncObjectProperties(text, objectStart = skipJsoncTrivia(text, 0)) {
  if (text[objectStart] !== "{") fail("Expected a JSONC object");
  const properties = []; let index = objectStart + 1;
  while (index < text.length) {
    index = skipJsoncTrivia(text, index);
    if (text[index] === "}") return { properties, end: index };
    const keyStart = index; const keyEnd = jsoncValueEnd(text, keyStart); const key = Bun.JSONC.parse(text.slice(keyStart, keyEnd));
    index = skipJsoncTrivia(text, keyEnd); if (text[index] !== ":") fail(`Expected a colon after ${key}`);
    const valueStart = skipJsoncTrivia(text, index + 1); const valueEnd = jsoncValueEnd(text, valueStart);
    properties.push({ key, keyStart, valueStart, valueEnd }); index = skipJsoncTrivia(text, valueEnd);
    if (text[index] === ",") index++; else if (text[index] !== "}") fail(`Expected a comma after ${key}`);
  }
  return fail("Unterminated JSONC object");
}

// Replace or append one object property while preserving all unrelated JSONC text.
function upsertJsoncProperty(text, objectStart, key, value) {
  const object = jsoncObjectProperties(text, objectStart);
  const existing = object.properties.find((property) => property.key === key);
  const rendered = typeof value === "string" ? JSON.stringify(value) : JSON.stringify(value, null, 2);
  if (existing) {
    const indent = text.slice(text.lastIndexOf("\n", existing.keyStart) + 1, existing.keyStart);
    return text.slice(0, existing.valueStart) + rendered.replaceAll("\n", `\n${indent}`) + text.slice(existing.valueEnd);
  }
  const closingLineStart = text.lastIndexOf("\n", object.end - 1) + 1;
  const closingIndent = text.slice(closingLineStart, object.end).match(/^\s*/)[0];
  const propertyIndent = object.properties.length ? text.slice(text.lastIndexOf("\n", object.properties[0].keyStart) + 1, object.properties[0].keyStart) : `${closingIndent}  `;
  const needsComma = object.properties.length > 0 && text[skipJsoncTrivia(text, object.properties.at(-1).valueEnd)] !== ",";
  return `${text.slice(0, object.end)}${needsComma ? "," : ""}\n${propertyIndent}${JSON.stringify(key)}: ${rendered.replaceAll("\n", `\n${propertyIndent}`)}\n${closingIndent}${text.slice(object.end)}`;
}

// Apply several JSONC object-property edits while preserving unrelated text.
function editJsoncProperties(text, { path = [], entries }) {
  let objectStart = skipJsoncTrivia(text, 0);
  for (const key of path) {
    const property = jsoncObjectProperties(text, objectStart).properties.find((candidate) => candidate.key === key);
    if (!property) fail(`Expected JSONC object property ${key}`);
    objectStart = property.valueStart;
  }
  for (const [key, value] of entries) text = upsertJsoncProperty(text, objectStart, key, value);
  return text;
}

// Ensure a nested configuration value is an object.
function ensureObject(parent, key) {
  if (parent[key] === undefined) parent[key] = {};
  const value = parent[key];
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

/* Configuration helpers */

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
  if (ignorePatternsLine < 0) lines.splice(testTableLine + 1, 0, rendered);
  else lines[ignorePatternsLine] = rendered;
  // 🟠 Update bunfig.toml with the merged test exclusions.
  await Bun.write(path, lines.join("\n"));
}

// 🟠 🔴 Initialize and extend the Biome configuration.
async function configureBiome() {
  const biomeJson = join(root, "biome.json");
  const biomeJsonc = join(root, "biome.jsonc");
  if (!existsSync(biomeJson) && !existsSync(biomeJsonc)) {
    // 🔴 Generate Biome's default configuration.
    await $`bun biome init`.quiet();
  }
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

/* Project initialization and dependencies */

const packagePath = join(root, "package.json");
const createdPackage = !existsSync(packagePath);
if (createdPackage) {
  // 🔴 Initialize the Bun project.
  await $`bun init -y -m`.quiet();
}
const originalPackageText = await Bun.file(packagePath).text();
const originalPackageJson = await readJsonObject(packagePath);
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
const packageJson = await readJsonObject(packagePath);
const packageScripts = {
  ...ensureObject(packageJson, "scripts"),
  typecheck: "tsc",
  check: "bun --bun biome check --write",
  "references:update": "git submodule update --init --recursive",
  prepare: "effect-tsgo patch",
  "chore:update": "bun update --latest && bun add effect@beta",
};
const packageEntries = [
  ["name", packageJson.name || basename(root).toLowerCase().replaceAll(" ", "-")],
  ["description", packageJson.description || "An Effect v4 project."],
  ["scripts", packageScripts],
  ["dependencies", packageJson.dependencies],
  ["devDependencies", packageJson.devDependencies],
].filter(([, value]) => value !== undefined);
let packageText;
if (createdPackage) packageText = `${JSON.stringify(Object.fromEntries(packageEntries), null, 2)}\n`;
else {
  packageText = originalPackageText;
  for (const dependencyKind of ["dependencies", "devDependencies"]) {
    if (!packageJson[dependencyKind] || !originalPackageJson[dependencyKind]) continue;
    packageText = editJsoncProperties(packageText, { path: [dependencyKind], entries: Object.entries(packageJson[dependencyKind]) });
  }
  if (originalPackageJson.scripts) {
    packageText = editJsoncProperties(packageText, { path: ["scripts"], entries: Object.entries(packageScripts) });
  }
  packageText = editJsoncProperties(packageText, { entries: packageEntries.filter(([key]) => originalPackageJson[key] === undefined) });
}
// 🟠 Write only managed package metadata and scripts, retaining Bun's field order.
await Bun.write(packagePath, packageText);

/* Repository and tool configuration */

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

/* TypeScript configuration */

// Configure strict compiler options and the Effect language-service plugin.
const tsconfigPath = join(root, "tsconfig.json");
const tsconfig = existsSync(tsconfigPath) ? await readJsonObject(tsconfigPath) : {};
const compilerOptions = ensureObject(tsconfig, "compilerOptions");
if (compilerOptions.plugins !== undefined && !Array.isArray(compilerOptions.plugins)) fail("tsconfig compilerOptions.plugins must be an array");
const compilerPlugins = [...(compilerOptions.plugins ?? [])];
const effectPluginIndex = compilerPlugins.findIndex((plugin) => plugin?.name === effectPlugin.name);
if (effectPluginIndex < 0) compilerPlugins.push(effectPlugin);
else compilerPlugins[effectPluginIndex] = effectPlugin;
const managedCompilerOptions = {
  erasableSyntaxOnly: true,
  noUnusedLocals: true,
  noUnusedParameters: true,
  noPropertyAccessFromIndexSignature: true,
  plugins: compilerPlugins,
};
if (tsconfig.exclude === undefined) tsconfig.exclude = [`${referenceRepositoriesDirectory}/**/*`];
else if (!Array.isArray(tsconfig.exclude)) fail("tsconfig exclude must be an array");
else if (!tsconfig.exclude.includes(`${referenceRepositoriesDirectory}/**/*`)) tsconfig.exclude.push(`${referenceRepositoriesDirectory}/**/*`);
let tsconfigText = existsSync(tsconfigPath) ? await Bun.file(tsconfigPath).text() : "{}\n";
tsconfigText = editJsoncProperties(tsconfigText, { entries: [["$schema", effectTsgoSchemaUrl]] });
const compilerOptionsProperty = jsoncObjectProperties(tsconfigText).properties.find((property) => property.key === "compilerOptions");
if (!compilerOptionsProperty) tsconfigText = editJsoncProperties(tsconfigText, { entries: [["compilerOptions", managedCompilerOptions]] });
else tsconfigText = editJsoncProperties(tsconfigText, { path: ["compilerOptions"], entries: Object.entries(managedCompilerOptions) });
tsconfigText = editJsoncProperties(tsconfigText, { entries: [["exclude", tsconfig.exclude]] });
// 🟠 Write only managed compiler settings, retaining Bun's comments and spacing.
await Bun.write(tsconfigPath, tsconfigText);

/* Project files and editor configuration */

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

/* Finalization and validation */

// 🔴 Synchronize installed dependencies without running lifecycle scripts.
await $`bun install --ignore-scripts`.quiet();
// 🔴 Patch the native TypeScript compiler with the Effect language service.
await $`bun prepare`.quiet();
// 🔴 Format and check the completed project.
await $`bun check`.quiet();
const completedTsconfig = await readJsonObject(tsconfigPath);
const completedEffectPlugin = completedTsconfig.compilerOptions?.plugins?.find((plugin) => plugin?.name === effectPlugin.name);
if (JSON.stringify(completedEffectPlugin) !== JSON.stringify(effectPlugin)) fail("tsconfig Effect language-service plugin was not updated");
// 🔴 Typecheck the completed project.
await $`bun typecheck`.quiet();
console.log("Effect v4 project bootstrap complete.");
