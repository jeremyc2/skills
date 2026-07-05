---
name: bootstrap-effect
description: Setup Effect v4 in a new project.
---

Check if Bun has already been setup in the repo and if not run `bun init -y -m`.

If the repo is not already a Git repository, run `git init -b main` before adding submodules.

Run the following in a single command:

```bash
bun add -D @typescript/native-preview@latest @biomejs/biome@latest @effect/tsgo@latest
bun add effect@beta
bunx --bun @biomejs/biome init
git submodule add https://github.com/Effect-TS/effect-smol.git reference_repositories/effect-smol
git submodule add https://github.com/mattpocock/skills.git reference_repositories/mattpocock-skills
```

Update the `package.json` with a good name and description.

Add the following scripts to the `package.json`:

```json
{
    "typecheck": "tsgo",
    "check": "bun --bun biome check --write",
    "references:update": "git submodule update --init --recursive",
    "prepare": "effect-tsgo patch",
    "chore:update": "bun update --latest && bun add effect@beta"
}
```

Run `bun install && bun prepare`.

Create a `.gitignore` if it doesn't already exist and make sure it ignores at least:

```gitignore
node_modules
.env
.env.*
.DS_Store
```

Lookup how to add Tailwind Directives support to the Biome config and do it if it isn't already configured for it. Also setup Organize Imports and turn off `useLiteralKeys` (conflicts with `tsconfig.json` otherwise) if those aren't configured. Also set it to ignore the `reference_repositories` folder.

Create a `bunfig.toml` with the following contents:

```toml
[test]
pathIgnorePatterns = ["reference_repositories/**"]
```

Make sure these `compilerOptions` are set in the `tsconfig.json`:

```json
    // Best practices
    "strict": true,
    "skipLibCheck": true,
    "noFallthroughCasesInSwitch": true,
    "noUncheckedIndexedAccess": true,
    "noImplicitOverride": true,

    "erasableSyntaxOnly": true,

    // Some stricter flags (disabled by default)
    "noUnusedLocals": true,
    "noUnusedParameters": true,
    "noPropertyAccessFromIndexSignature": true,
```

Under compiler `compilerOptions.plugins[]` add the output from this command:

```bash
curl https://raw.githubusercontent.com/Effect-TS/tsgo/refs/heads/main/schema.json | jq '{ "name": "@effect/language-service", "diagnosticSeverity": (.definitions.effectLanguageServicePluginDiagnosticSeverityDefinition.properties | map_values("error")) }'
```

Add `"exclude": ["reference_repositories/**/*"],` and `"$schema": "https://raw.githubusercontent.com/Effect-TS/tsgo/refs/heads/main/schema.json"` to the `tsconfig.json`.

If the repo is otherwise empty, add a minimal `index.ts` so `tsgo` does not fail with `TS18003: No inputs were found`:

```ts
export {};
```

Add an `AGENTS.md` file with the following contents:

```md
- Avoid using regex where possible. Add a comment above each non-trivial regex breaking it down.
- Reference the git submodules in `reference_repositories` for best practices, usage examples, and documentation for the frameworks and packages we use.
```

Add `.vscode/settings.json` with the following contents:

```json
{
    "css.lint.unknownAtRules": "ignore",
    "editor.codeActionsOnSave": {
        "source.fixAll.biome": "explicit",
        "source.organizeImports.biome": "explicit"
    },
    "editor.defaultFormatter": "biomejs.biome",
    "editor.formatOnSave": true,
    "files.readonlyInclude": {
        "reference_repositories/**": true
    },
    "files.watcherExclude": {
        "reference_repositories/**": true
    },
    "js/ts.tsdk.promptToUseWorkspaceVersion": true,
    "js/ts.experimental.useTsgo": true,
    "js/ts.suggest.autoImports": true,
    "js/ts.updateImportsOnFileMove.enabled": "always",
    "json.schemaDownload.enable": true,
    "search.exclude": {
        "reference_repositories/**": true
    },
    "typescript.enablePromptUseWorkspaceTsdk": true,
    "typescript.experimental.useTsgo": true,
    "typescript.native-preview.tsdk": "node_modules/@typescript/native-preview",
    "typescript.suggest.autoImports": true,
    "typescript.updateImportsOnFileMove.enabled": "always"
}
```

Run the checks when done:

```bash
bun check
bun typecheck
```
