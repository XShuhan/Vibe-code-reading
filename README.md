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
   - The root `.vscode` config builds the monorepo first, then launches the extension against `/Users/xue/Projects/code-vibe-testing/workspace`

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
   - Wait for indexing to complete

4. **Ask about code**
   - Select code in the editor
   - Right-click → "Ask Vibe about Selection"
   - Type your question
   - View the answer in the Threads view

Default behavior after cloning is `mock` mode, so you can explore the full flow without any API key.
At startup, the extension shows a reminder if `vibe.model` is not fully configured for real thread model usage.
If you want real model responses in every project, configure the key once in VS Code User Settings rather than per-workspace settings.

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
| `Vibe: Refresh Index` | Rebuild workspace index | - |
| `Vibe: Test Model Connection` | Verify current model settings and log provider diagnostics | - |
| `Vibe: Ask About Selection` | Ask question about selected code | - |
| `Vibe: Explain Current Symbol` | Explain symbol under cursor | - |
| `Vibe: Save Selection as Card` | Save selection as a card | - |
| `Vibe: Add Thread Answer to Canvas` | Add thread to canvas | - |
| `Vibe: Open Canvas` | Open canvas view | - |
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

## Settings Reference

### Shortcut Configuration

`Vibe: Ask About Selection` ships with a default shortcut:

- Windows/Linux: `Ctrl+Alt+Q`
- macOS: `Cmd+Alt+Q`

If you want to customize it:

1. Open **Keyboard Shortcuts**.
2. Search `@command:vibe.askAboutSelection`.
3. Bind your preferred key and run **Show Same Keybindings** to check conflicts.

### Model Configuration

```jsonc
{
  // Provider type: "openai-compatible" or "mock"
  "vibe.model.provider": "openai-compatible",
  
  // Base URL for OpenAI-compatible API
  "vibe.model.baseUrl": "https://api.openai.com/v1",
  
  // API key (keep secret!)
  "vibe.model.apiKey": "your-api-key",
  
  // Model identifier
  "vibe.model.model": "gpt-4",
  
  // Sampling temperature (0-2)
  "vibe.model.temperature": 0.1,
  
  // Maximum tokens in response
  "vibe.model.maxTokens": 900
}
```

When thread model configuration is incomplete, Code Vibe Reading shows a startup warning with an `Open Vibe Settings` action. This opens the VS Code Settings UI filtered by `vibe.model`.

### Using Mock Provider (Offline)

For development or demo without API access:

```jsonc
{
  "vibe.model.provider": "mock"
}
```

The mock provider returns template responses useful for testing UI flows.

### Using Moonshot Globally

If you want `Ask About Selection` to work across any folder you open, set the model configuration in **VS Code User Settings** once.

Open Settings (`Ctrl+,` / `Cmd+,`), search for `vibe.model`, and set these fields in User Settings.
If you prefer JSON directly, open Command Palette → `Preferences: Open User Settings (JSON)` and add:

```jsonc
{
  "vibe.model.provider": "openai-compatible",
  "vibe.model.baseUrl": "https://api.moonshot.cn/v1",
  "vibe.model.apiKey": "your-moonshot-api-key",
  "vibe.model.model": "kimi-k2-0905-preview",
  "vibe.model.temperature": 0.1,
  "vibe.model.maxTokens": 8192
}
```

This keeps the secret out of the repository and makes the extension usable in every project without repeating workspace-level setup.

### Using Kimi Code Directly

Kimi Code officially documents an OpenAI-compatible endpoint for third-party coding agents:

```jsonc
{
  "vibe.model.provider": "openai-compatible",
  "vibe.model.baseUrl": "https://api.kimi.com/coding/v1",
  "vibe.model.apiKey": "your-kimi-code-api-key",
  "vibe.model.model": "kimi-for-coding",
  "vibe.model.maxTokens": 32768
}
```

This matches Kimi Code's Roo Code guidance: use the OpenAI-compatible provider with the `/coding/v1` entrypoint and `kimi-for-coding`.

Note: Kimi Code's membership docs explicitly describe Claude Code and Roo Code as the supported third-party agent targets, and recommend Moonshot Open Platform for broader enterprise or custom product integrations.

### Using Moonshot Open Platform

Moonshot Open Platform exposes an OpenAI-compatible Chat Completions API at `https://api.moonshot.cn/v1/chat/completions`. For this extension, use the `/v1` base URL and the exact model id enabled in your Moonshot account.

```jsonc
{
  "vibe.model.provider": "openai-compatible",
  "vibe.model.baseUrl": "https://api.moonshot.cn/v1",
  "vibe.model.apiKey": "your-moonshot-api-key",
  "vibe.model.model": "kimi-k2-0905-preview",
  "vibe.model.maxTokens": 8192
}
```

If your account has the faster K2 variant enabled, Moonshot's official platform posts also reference `kimi-k2-turbo-preview` as a valid API model.

### Using OpenClaw Gateway

If you want to route requests through OpenClaw, keep this extension on the standard OpenAI-compatible path and target an OpenClaw agent:

```jsonc
{
  "vibe.model.provider": "openai-compatible",
  "vibe.model.baseUrl": "http://127.0.0.1:19001/v1",
  "vibe.model.apiKey": "your-openclaw-gateway-token",
  "vibe.model.model": "openclaw:main"
}
```

`openclaw:main` uses whatever model your OpenClaw `main` agent is configured to run. To use Kimi K2.5 through OpenClaw, point `main` at K2.5 or create a dedicated agent and set `vibe.model.model` to `openclaw:<agentId>`.

Make sure OpenClaw's HTTP API is enabled in your OpenClaw config:
```jsonc
{
  "gateway": {
    "http": {
      "endpoints": {
        "chatCompletions": { "enabled": true }
      }
    }
  }
}
```

### Supported Providers

Any OpenAI-compatible endpoint:
- OpenAI (GPT-4, GPT-3.5)
- Azure OpenAI
- Local models (llama.cpp, Ollama, etc.)
- OpenClaw-compatible endpoints (with Kimi, Claude, etc.)
- Kimi-compatible endpoints (requires Coding Agent access)

Example for local Ollama:
```jsonc
{
  "vibe.model.provider": "openai-compatible",
  "vibe.model.baseUrl": "http://localhost:11434/v1",
  "vibe.model.apiKey": "ollama",
  "vibe.model.model": "codellama"
}
```

## Publishing To GitHub

Before pushing:
- Keep `vibe.model.apiKey` empty in the repository.
- Store real API keys only in VS Code User Settings or another local secret store.
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

### Diagnose Connectivity

Run `Vibe: Test Model Connection` from the command palette after updating your settings.

The command:
- validates that `baseUrl`, `apiKey`, and `model` are present
- issues a minimal chat completion request
- writes provider, base URL, model id, masked key, discovered models, and response text to the `Code Vibe Reading` output channel

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
