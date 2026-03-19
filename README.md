# Code Vibe Reading

A VS Code extension for understanding codebases after "vibe coding". Navigation-first, evidence-first, structure-first.

> **Map → Ask → Cite → Save → Connect → Revisit**

## What is this?

After vibe coding (rapid prototyping with AI assistance), code often works but becomes hard to understand:
- Unclear module boundaries
- Hidden coupling
- Poor naming
- Fragile call paths
- Weak documentation

**Code Vibe Reading** solves this by creating a code-reading workbench inside VS Code. It helps you reconstruct intent, architecture, dependencies, and reasoning from messy or AI-generated code.

## Features

### 🔍 Code Map
- Automatic workspace indexing for TypeScript/JavaScript
- Tree view of files, classes, functions, and symbols
- Import and call graph visualization
- Incremental updates on file save

### 💬 Grounded Q&A
- Ask questions about selected code
- Receive answers with clickable citations
- Every answer cites source locations (file path + line numbers)
- Distinguishes facts from inferences

### 📝 Cards
- Save understanding as persistent notes
- Types: Symbol, Flow, Bug, Concept, Decision, Question
- Tag and organize cards
- Jump from cards back to source code

### 🎨 Canvas
- Visual organization of cards
- Create typed relationships (explains, calls, depends_on, tests, etc.)
- Drag-and-drop layout
- Persistent workspace state

### 🔗 Source Navigation
- Click citations to jump to file and line
- Trace call paths (callers and callees)
- CodeLens integration for quick actions

## Installation

### From Source

1. Clone the repository:
   ```bash
   git clone <repository-url>
   cd code-vibe-reading
   ```

2. Install dependencies:
   ```bash
   pnpm install
   ```

3. Build the extension:
   ```bash
   pnpm build
   ```

4. Open in VS Code:
   ```bash
   code .
   ```

5. Launch Extension Development Host:
   - Open the repository root in VS Code
   - Press `F5` and choose `Run Code Vibe Reading`
   - The root `.vscode` config builds the monorepo first, then launches the extension against the bundled sample workspace at `~/Projects/code-vibe-testing/workspace` inside this repository

### VS Code Marketplace

_Coming soon_

## Quick Start

1. **Open a supported project**
   - TypeScript / JavaScript
   - Python
   - Shell scripts (`.sh`, `.bash`, `.zsh`)
   - JSON / JSONC

2. **Open the Vibe sidebar**
   - Click the Vibe icon in the Activity Bar (left sidebar)

3. **Build the code map**
   - Click "Refresh Index" in the Map view
   - Wait for indexing and AI project-overview generation to complete

4. **Ask about code**
   - Select code in the editor
   - Right-click → "Ask Vibe about Selection"
   - Type your question
   - View the answer in the Threads view

The first time you use the extension after installing it, it will ask you to:
- choose a language: Chinese or English
- configure your API: `baseUrl`, `apiKey`, and `model`

That configuration is stored as extension-level state in VS Code, so:
- `git pull` will not overwrite it
- opening a different project does not require configuring the API again
- recloning a project does not require configuring the API again

5. **Save understanding**
   - Select code or use a thread answer
   - Right-click → "Save Selection as Card"
   - Add title and tags

6. **Organize visually**
   - Run command: "Vibe: Open Canvas"
   - Drag cards onto the canvas
   - Connect related cards with edges

## Usage Guide

### Commands

| Command | Description | Shortcut |
|---------|-------------|----------|
| `Vibe: Refresh Index` | Rebuild workspace index and regenerate the AI project overview | - |
| `Vibe: Configure API` | Choose language and update API settings for the extension | - |
| `Vibe: Test Model Connection` | Verify current model settings and log provider diagnostics | - |
| `Vibe: Ask About Selection` | Ask question about selected code | - |
| `Vibe: Explain Current Symbol` | Explain symbol under cursor | - |
| `Vibe: Save Selection as Card` | Save selection as a card | - |
| `Vibe: Add Thread Answer to Canvas` | Add thread to canvas | - |
| `Vibe: Delete Thread` | Delete the selected thread | `Delete` / `Backspace` in Threads view |
| `Vibe: Open Canvas` | Open canvas view | - |
| `Vibe: Open Project Overview` | Open the current project's generated overview | - |
| `Vibe: Trace Call Path` | Trace callers/callees | - |

### Views

- **Map**: Tree view of workspace structure (files → symbols)
- **Threads**: Question/answer conversations with citations
- **Cards**: Saved understanding notes
- **Canvas**: Visual organization (webview)

### Editor Integration

- **Context Menu**: Right-click selected code for Vibe actions
- **CodeLens**: "Explain symbol" appears above functions/classes
- **Click Citations**: Jump to source from any citation

## Workspace Setup

### Shortcut Configuration

`Vibe: Ask About Selection` ships with a default shortcut:

- Windows/Linux: `Ctrl+Alt+Q`
- macOS: `Cmd+Alt+Q`

If you want to customize it:

1. Open **Keyboard Shortcuts**.
2. Search `@command:vibe.askAboutSelection`.
3. Bind your preferred key and run **Show Same Keybindings** to check conflicts.

### First-Time Configuration

When the extension starts for the first time, it asks for:
- language: `中文` or `English`
- `baseUrl`
- `apiKey`
- `model`

You can reopen that flow later with:

```text
Vibe: Configure API
```

The current project stores only its local indexed data here:

```text
.code-vibe/storage/
```

These files are local project state, not repository state. The repository `.gitignore` excludes `.code-vibe/`.

### Local Data Behavior

- `storage/` stores threads, cards, canvas state, and the cached index
- API configuration and language are stored by the extension globally and reused across projects
- `git pull` does not affect either the global extension config or the local project storage
- deleting the project folder removes these files
- recloning the project starts with empty project storage, but your API configuration stays available in the extension

### Example API Endpoints

Common combinations:

- Kimi Code
  - `baseUrl`: `https://api.kimi.com/coding/v1`
  - `model`: `kimi-for-coding`
- Moonshot Open Platform
  - `baseUrl`: `https://api.moonshot.cn/v1`
  - `model`: your enabled Moonshot model id
- OpenClaw gateway
  - `baseUrl`: `http://127.0.0.1:19001/v1`
  - `model`: `openclaw:<agentId>` or `openclaw:main`
- Local OpenAI-compatible endpoint
  - `baseUrl`: for example `http://localhost:11434/v1`
  - `model`: whatever your local server exposes

### Diagnose Connectivity

Run `Vibe: Test Model Connection` from the command palette after configuring the extension.

The command:
- validates that `baseUrl`, `apiKey`, and `model` are present
- issues a minimal chat completion request
- writes provider, base URL, model id, masked key, discovered models, and response text to the `Code Vibe Reading` output channel

## Project Overview

`Project Overview` is now AI-generated when you run `Vibe: Refresh Index`.

The generation flow is:
- the analyzer refreshes the workspace index
- the extension builds a grounded dossier from repository signals and indexed code
- an internal prompt bundle asks the model to explain:
  - what the whole project does
  - how the startup path works in code
  - which key modules are involved
  - what the end-to-end execution flow looks like
- the result is stored in the project's `.code-vibe/storage/project-overview.json`

The dossier currently includes:
- repository hints such as `README.md` and `package.json`
- likely entry files
- symbol outlines for key files
- grounded code excerpts from startup and high-signal files
- index-derived hints such as core directories, core modules, and high-frequency functions

The panel renders four developer-focused sections:
- project goal and implementation narrative
- startup entry and startup code logic
- key code modules
- execution flow with a Mermaid flowchart source block

The display language follows the language chosen during configuration:
- Chinese setup → Chinese overview text
- English setup → English overview text

## Publishing To GitHub

Before pushing:
- Keep `.code-vibe/` out of version control.
- Store real API keys only in the extension's own secure storage.
- If a secret was ever committed, rotate it before publishing.

Typical flow:

```bash
git add .
git commit -m "feat: improve extension workflow and indexing"
git remote add origin git@github.com:<your-account>/code-vibe-reading.git
git push -u origin main
```

## SSH Key For GitHub

You should add your **public SSH key** to your GitHub account if you want to push with SSH.

- Safe to upload to GitHub account settings: `~/.ssh/id_ed25519.pub` or another `*.pub` public key
- Never upload to GitHub or commit into the repository: your private key such as `~/.ssh/id_ed25519`

Check whether you already have a key:

```bash
ls ~/.ssh
```

Create one if needed:

```bash
ssh-keygen -t ed25519 -C "your_email@example.com"
```

Then copy the `.pub` file contents into GitHub:
- GitHub → Settings → SSH and GPG keys → New SSH key

## Project Structure

```
code-vibe-reading/
├── apps/
│   ├── extension/          # VS Code extension
│   └── webview/            # React webview UI
├── packages/
│   ├── shared/             # Types and utilities
│   ├── analyzer/           # Code analysis (TS/JS)
│   ├── retrieval/          # Evidence retrieval
│   ├── model-gateway/      # AI provider abstraction
│   ├── persistence/        # Local storage
│   └── testkit/            # Testing utilities
└── docs/                   # Documentation
```

## Development

### Prerequisites

- Node.js ≥ 20
- pnpm ≥ 10
- VS Code ≥ 1.97

### Setup

```bash
# Install dependencies
pnpm install

# Build all packages
pnpm build

# Run tests
pnpm test

# Watch mode for development
pnpm dev:extension    # Terminal 1
pnpm dev:webview      # Terminal 2
```

### Debugging

1. Open the project in VS Code
2. Press `F5` to launch Extension Development Host
3. Set breakpoints in extension code
4. Use "Developer: Toggle Developer Tools" for webview debugging

### Testing

```bash
# Run all tests
pnpm test

# Watch mode
pnpm test:watch

# With coverage
pnpm test -- --coverage
```

## Known Limitations

### Language Support
- **TypeScript/JavaScript only** in MVP
- Other languages planned (Python, Rust, Go)

### Call Graph
- **Best-effort only** - may miss some calls
- Dynamic calls (e.g., `obj[methodName]()`) not tracked
- Cross-file calls marked as "inferred"

### Retrieval
- **No embeddings** - uses lexical and structural search only
- Semantic similarity not yet implemented

### Canvas
- **Manual layout** - no auto-layout algorithms
- No zoom/pan animations

### AI Features
- Requires external API configuration
- No local LLM bundled
- Streaming responses not yet implemented

## Architecture

See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for detailed system design.

## Demo

See [docs/DEMO.md](docs/DEMO.md) for demonstration workflows.

## Roadmap

See [docs/ROADMAP.md](docs/ROADMAP.md) for future plans.

## Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Add tests
5. Submit a pull request

Please read our architecture documentation before major changes.

## Security and Privacy

- **Local-first**: All analysis happens on your machine
- **No code transmission** unless you configure a model endpoint
- **API keys** stored in VS Code settings (secure storage)
- **No telemetry** or analytics collection

## License

[License TBD]

## Acknowledgments

Built with:
- [VS Code Extension API](https://code.visualstudio.com/api)
- [TypeScript Compiler API](https://github.com/microsoft/TypeScript/wiki/Using-the-Compiler-API)
- [React](https://react.dev/)
- [esbuild](https://esbuild.github.io/)

---

**Happy reading!** 📚
