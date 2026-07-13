---
name: create-bootstrap-skill
description: Create or refactor slim skills whose only workflow is running a bundled plain-JavaScript bootstrap script with Bun. Use when building a reusable bootstrap/setup skill for any framework, toolchain, repository standard, or project type, or when making setup steps deterministic, idempotent, auditable, and easy to execute.
---

# Create a Bootstrap Skill

Create a two-file skill by default:

```text
<skill-name>/
├── SKILL.md
└── scripts/
    └── bootstrap-<subject>.js
```

Add other files only when the requested bootstrap genuinely needs them.

## Write the wrapper

Keep `SKILL.md` limited to frontmatter and one execution instruction:

```markdown
---
name: <skill-name>
description: <what the bootstrap configures and when this skill should trigger>
---

From the target repository root, run the bundled `scripts/bootstrap-<subject>.js` with Bun. Resolve the script path relative to this `SKILL.md` and report the complete error if it fails.
```

Do not inline the implementation, duplicate its steps, or ask the agent to remake decisions implemented by the script.

## Write the bootstrap script

Write plain JavaScript in `scripts/bootstrap-<subject>.js`. Do not add TypeScript syntax. Assume only Bun is installed unless the user specifies other prerequisites.

Follow these implementation rules:

- Use descriptive names for paths, configuration objects, probes, and helpers.
- Use `const $ = Bun.$.cwd(process.cwd()).env(process.env)` for shell commands.
- Call package scripts as `bun <script>`. Use `bun run <script>` only when the script name collides with a Bun command.
- Keep successful commands quiet. Allow failures to retain their original stdout, stderr, and exit status.
- Do not use `try/catch` merely to replace an original error with a custom error.
- Use `.nothrow()` only for an expected probe whose failure selects a recovery path.
- Pin the exact version of any executable invoked through `bunx`. Do not execute `@latest` tooling.
- Prefer Bun APIs for JSONC, TOML, globbing, files, and processes.
- Inspect initializer help, flags, and pristine output before designing merges. Treat flags that change generated structure as part of the contract.
- Capture generated files immediately after initialization and inspect them again after package-manager, formatter, and migration commands to identify which tool changed them.
- Distinguish fresh generated files from existing user files. Render a prescribed shape only for fresh files; surgically edit existing files when comments, spacing, or unrelated ordering must survive.
- Preserve initializer defaults. Manage only missing values and intentional deviations; do not restate an option with the same value the initializer already supplied.
- Use `Bun.JSONC.parse` for semantic JSONC parsing. It does not provide source ranges or comment-preserving serialization, so retain targeted source-editing logic when exact text preservation is required.
- Add only helpers that remove meaningful duplication or isolate a configuration merge. Prefer batch helpers with an options object, such as `{ path, entries }`, over several narrow helpers or long positional argument lists.
- Do not add helpers that merely rename a single expression.
- Avoid assignments inside expressions and unbounded `while (true)` loops. Use explicit statements and loops bounded by input or collection size.
- Delineate longer scripts with short block-comment sections such as constants, utilities, configuration helpers, initialization, project files, and validation.
- Preserve unrelated existing configuration and guidance.
- Make reruns safe and deterministic. Fail on ambiguous or unsafe states instead of overwriting them.
- When key order matters, define it as an explicit contract and verify it after every command that can rewrite the file. Remove managed keys from their old positions and reconstruct that portion in the prescribed order when necessary.
- Run a tool's initializer first when it provides useful defaults, then merge the required additions.
- When an installed JSON Schema exists, write the known configuration shape and validate the finished file directly with a pinned draft-compatible JSON Schema CLI. Do not traverse the schema to rediscover known property paths.

## Mark side effects

Use comments as scannable side-effect markers. Do not add a legend to generated scripts.

- Put `🟠` first on file or directory writes.
- Put `🔴` on command execution and network access.
- Place a marker comment immediately above every concrete side effect, including side effects inside helpers.
- When calling a descriptive write helper, place the `🟠` comment at the call site and state what file or content is being written.
- Add a comment above every named function describing it. Prefix that function comment with every marker used inside the function, ordered `🟠` then `🔴`.
- Keep comments specific to purpose rather than restating syntax.

Use this shape:

```js
// 🟠 🔴 Generate, validate, and write the tool configuration.
async function configureTool() {
  // 🔴 Generate the tool's default configuration.
  await $`bun tool init`.quiet();

  // 🟠 Write the merged configuration to tool.json.
  await writeJson(toolConfigPath, toolConfig);
}
```

For a write-only helper:

```js
// 🟠 Append missing lines to a text file.
async function ensureLines(path, requiredLines) {
  // 🟠 Write the original content followed by the missing lines.
  await Bun.write(path, updatedContent);
}
```

## Validate the created skill

Before finishing:

1. Parse the bundled script as JavaScript.
2. Run it from a clean disposable target directory.
3. Inspect pristine initializer output and the files after each mutating command that may affect structure, ordering, or formatting.
4. Verify required values, exact managed-key ordering, preserved initializer defaults, and preserved JSONC comments and spacing.
5. Verify required plugins or generated integrations after formatters and finalization commands have run.
6. Run it again against the completed target and verify idempotence.
7. Exercise at least one intentional validation failure when the script relies on a schema or strict configuration parser.
8. Validate the skill folder and remove all temporary or placeholder artifacts.

Keep an existing skill unchanged unless the user explicitly asks to replace or refactor it.
