---
name: Bootstrap Effect
description: Setup Effect v4 in a new project.
---

Check if Bun has already been setup in the repo and if not run `bun init`.

Run the following in a single command:

```bash
rm -rf .cursor
bun add -D @typescript/native-preview@latest @biomejs/biome@latest @effect/tsgo@latest
bun add effect@beta
bunx --bun @biomejs/biome init
git submodule add https://github.com/Effect-TS/effect-smol.git reference_repositories/effect-smol
```

Update the `package.json` with a good description.

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

Lookup how to add Tailwind Directives support to the Biome config and do it if it isn't already configured for it. Also setup Organize Imports and turn off `useLiteralKeys` (conflicts with `tsconfig.json` otherwise) if those aren't configured. Also set it to ignore the `reference_repositories` folder.

Create a `bunfig.toml` with the following contents:

```toml
[test]
pathIgnorePatterns = ["reference_repositories/**"]
```

Make sure these compiler options are set in the `tsconfig.json`:

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

Add `"exclude": ["reference_repositories/**/*"],` to the `tsconfig.json`.

Create an `UBIQUITOUS_LANGUAGE.md` file at the repository root with the following contents:

```md
## Terms

## Relationships

## Flagged ambiguities

```

Add an `AGENTS.md` file with the following contents:

```md
- Add a comment above each non-trivial regex breaking it down.
- Keep `UBIQUITOUS_LANGUAGE.md` up-to-date. Collapse synonyms, flag ambiguous language and overloaded terminology.   
- You and the user should police eachother (e.g. "Did you mean ...?") when conversations, documentation, and code no longer reflect a shared vocab.
- Reference the git submodules in `reference_repositories` for best practices, usage examples, and documentation for the frameworks and packages we use.
- Track Architecture Decisions in `ADR/{FEATURE}/*` (e.g. `/ARD/cli/0001-authentication.md`) with sections for `Problem`, `Considered Options`, and  `Decision Outcome`.
- Additionally, when you have to be corrected more than once about something, make an ADR.
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

Encourage the user to run `bun effect-tsgo setup`.
