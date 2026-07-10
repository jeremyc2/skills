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
- Add only helpers that remove meaningful duplication or isolate a configuration merge.
- Preserve unrelated existing configuration and guidance.
- Make reruns safe and deterministic. Fail on ambiguous or unsafe states instead of overwriting them.
- When key order matters, remove the managed keys from their old positions and reconstruct that portion in the prescribed order.
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
3. Inspect the generated files and verify required values, ordering, and preserved defaults.
4. Run it again against the completed target and verify idempotence.
5. Exercise at least one intentional validation failure when the script relies on a schema or strict configuration parser.
6. Validate the skill folder and remove all temporary or placeholder artifacts.

Keep an existing skill unchanged unless the user explicitly asks to replace or refactor it.
