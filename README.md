# Code Vibe Reading

[中文说明](./README.zh-CN.md)

Code Vibe Reading is a local-first VS Code extension for reading codebases after fast AI-assisted prototyping. It combines workspace indexing, grounded Q&A, persistent notes, and a lightweight visual canvas in one sidebar workflow.

## Preview

Code Vibe Reading is organized around four fast reading surfaces:

| Surface | What it is for |
| --- | --- |
| Map | Browse files, symbols, callers, and callees |
| Project Overview | Get a grounded startup and runtime summary of the repository |
| Threads | Ask targeted questions and inspect cited answers |
| Cards + Canvas | Save durable notes and connect them visually |

Demo workflows:

- [docs/DEMO.md](./docs/DEMO.md)

## Quick Start

### 1. Startup Preparation

You can use one command to run the repository startup flow: install dependencies, build the project, and launch the Extension Development Host.

From the repository root, run this in Bash. On Windows, use Git Bash:

```bash
bash ./start.sh
```

If the script already has execute permission in your environment, `./start.sh` works as well.

The script is designed for a repeatable local development startup flow and is compatible with Bash environments including Windows Git Bash.

After the command finishes, VS Code opens this repository and launches an Extension Development Host window for the extension in `apps/extension`.

If you are new to the project, use this flow:

1. Install Node.js, `pnpm`, and VS Code on your machine.
2. Make sure the VS Code CLI command `code` is available in your terminal.
3. Open Git Bash.
4. Change into the repository root directory.
5. Run `bash ./start.sh`.
6. Wait for dependency installation and build to finish.
7. Confirm that VS Code opens and a new Extension Development Host window appears.

If `pnpm` is missing, the script stops immediately and tells you to install it first. If the build fails, the script exits with a non-zero status and does not continue to open VS Code.

### 2. Configure A Model

Run:

```text
Vibe: Configure API
```

Required fields:

- `baseUrl`
- `apiKey`
- `model`

The current implementation expects an OpenAI-compatible chat completion API.

For `Project Overview`, `glm`-series APIs are currently not recommended. In our testing, their generated overview structure and content quality were noticeably worse than alternatives such as `qwen3.5-plus`, which often leads to weaker or less stable overview results.

### 3. Index And Read

Run:

```text
Vibe: Refresh Index
```

That command:

1. rebuilds the workspace index
2. regenerates the AI project overview

After that you can:

- open the `Map` view
- open `Project Overview`
- ask about a selection
- trace call paths
- save cards and use the canvas

## What It Does

- Builds a workspace map of files, symbols, imports, callers, and callees
- Generates an AI project overview grounded in indexed code and sampled source excerpts
- Answers questions about the current selection with clickable citations
- Saves durable understanding as cards and connects them on a canvas
- Keeps project state in the workspace so notes and indexes stay close to the code

## Current Scope

- Best coverage: TypeScript / JavaScript
- Lighter parsing support: Python, Shell, JSON, JSONC
- Model provider: OpenAI-compatible endpoints, plus a local `mock` adapter for development
- Storage: `.code-vibe/storage/` inside the current workspace

## Main Surfaces

### Map

- Workspace tree for files and symbols
- Caller / callee expansion for functions and methods
- Entry point for the generated project overview

### Project Overview

Generated during `Vibe: Refresh Index`.

It focuses on:

- project goal
- startup entry
- startup path
- core module responsibilities
- primary runtime flow
- evidence limits

The overview is grounded in:

- indexed file contents
- repository signals such as `README.md` and `package.json`
- representative source excerpts chosen from entry files and core modules

### Threads

- Ask about the current selection
- Explain the current symbol
- Inspect answers with source citations
- Reopen saved threads from the sidebar

### Cards And Canvas

- Save durable notes as cards
- Add thread answers to the canvas
- Connect cards with typed relationships

## Commands

| Command | Purpose |
| --- | --- |
| `Vibe: Refresh Index` | Rebuild the workspace index and regenerate the project overview |
| `Vibe: Configure API` | Configure language and model connection |
| `Vibe: Test Model Connection` | Send a small probe request and log diagnostics |
| `Vibe: Ask About Selection` | Ask a grounded question about selected code |
| `Vibe: Explain Current Symbol` | Explain the symbol under the cursor |
| `Vibe: Save Selection as Card` | Save a note from the current selection |
| `Vibe: Add Thread Answer to Canvas` | Turn a thread answer into canvas content |
| `Vibe: Open Canvas` | Open the visual canvas |
| `Vibe: Open Project Overview` | Open the generated project overview panel |
| `Vibe: Trace Call Path` | Inspect callers and callees |
| `Delete Thread` | Remove the selected thread from the Threads view |

Default shortcut:

- `Cmd+Alt+Q` on macOS
- `Ctrl+Alt+Q` on Windows / Linux

## Local Data

Project-local state is written to:

```text
.code-vibe/storage/
```

Typical files include:

- `index.json`
- `threads.json`
- `cards.json`
- `canvas.json`
- `project-overview.json`

These files are local workspace artifacts and should stay out of version control.

## Repository Layout

```text
apps/
  extension/   VS Code extension
  webview/     React-based canvas and detail views
packages/
  analyzer/    workspace indexing and symbol extraction
  retrieval/   evidence retrieval and ranking
  model-gateway/ model adapters and prompting
  persistence/ local JSON persistence
  shared/      shared protocol and types
  testkit/     fixtures and helpers
```

## Limitations

- Richest structural analysis is currently in the TS/JS path
- Project overview uses sampled source excerpts, not a full-file dump of the entire repository
- The extension is local-development oriented and not packaged for Marketplace release yet
