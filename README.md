# 🏛️ Keystone CLI

[![Bun](https://img.shields.io/badge/Bun-%23000000.svg?style=flat&logo=bun&logoColor=white)](https://bun.sh)
[![NPM Version](https://img.shields.io/npm/v/keystone-cli.svg?style=flat)](https://www.npmjs.com/package/keystone-cli)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

**Keystone** is a local-first, declarative, agentic workflow orchestrator built on **Bun**.

It allows you to define complex automation workflows using a simple YAML syntax, featuring first-class support for LLM agents, persistent state management via SQLite, and high-concurrency execution with built-in resilience.

---

## ✨ Key Features

- ⚡ **Local-First & Fast:** Powered by Bun with a local SQLite database. No external "cloud state" required—your data and workflow history stay on your machine.
- 🧩 **Declarative Workflows:** Define logic in YAML. Keystone automatically calculates the execution graph (DAG) and detects dependencies from your expressions.
- 🤖 **Agentic by Design:** Seamlessly integrate LLM agents defined in Markdown. Agents can use tools, which are just other workflow steps.
- 🔌 **Built-in MCP Server:** Expose your workflows as tools to other AI assistants (like Claude Desktop) using the Model Context Protocol.
- 🔄 **Resilient Execution:** Built-in retries, exponential backoff, and timeouts. Interrupted workflows can be resumed exactly where they stopped.
- 🧑‍💻 **Human-in-the-Loop:** Support for manual approval and text input steps for sensitive or creative operations.
- 📊 **Interactive TUI:** A beautiful terminal dashboard to monitor concurrent runs and history.
- 🛡️ **Security-First:** Automatic secret redaction from logs/database and AST-based safe expression evaluation.

---

## 🚀 Installation

Ensure you have [Bun](https://bun.sh) installed (v1.0.0 or higher).

```bash
# Install globally via Bun
bun add -g keystone-cli

# Or via NPM
npm install -g keystone-cli
```

### Shell Completion

To enable tab completion for workflow names and commands:

**Zsh:** Add `source <(keystone completion zsh)` to your `.zshrc`
**Bash:** Add `source <(keystone completion bash)` to your `.bashrc`

---

## 🚥 Quick Start

### 1. Initialize a Project
```bash
keystone init
```
This creates a `.keystone/` directory for configuration and a `workflows/` directory for your files.

### 2. Configure Environment
Add your API keys to the generated `.env` file:
```env
OPENAI_API_KEY=sk-...
ANTHROPIC_API_KEY=sk-ant-...
```

### 3. Run Your First Workflow
```bash
keystone run basic-shell
```

---

## ⚙️ How it Works

### Workflows (.yaml)
Workflows are defined by steps. Steps run in **parallel** by default unless a dependency is defined via `needs` or detected in an expression like `${{ steps.previous_step.output }}`.

```yaml
name: analyze-repo
steps:
  - id: list_files
    type: shell
    run: ls -R
    transform: stdout.split('\n')

  - id: analyze
    type: llm
    foreach: ${{ steps.list_files.output }}
    concurrency: 5
    agent: code-reviewer
    prompt: "Analyze this file: ${{ item }}"
```

### Agents (.md)
Agents are defined in Markdown with YAML frontmatter. This keeps the "personality" and tools of the agent together in a human-readable format.

```markdown
---
name: code-reviewer
model: claude-3-5-sonnet-latest
tools:
  - name: read_file
    execution:
      type: file
      op: read
      path: "${{ args.path }}"
---
You are an expert security researcher. Review the provided code for vulnerabilities.
```

---

## 🛠️ CLI Reference

| Command | Description |
| :--- | :--- |
| `init` | Initialize a new Keystone project |
| `run <workflow>` | Execute a workflow (supports `-i key=val` for inputs) |
| `resume <run_id>` | Resume a paused or failed workflow run |
| `ui` | Open the interactive TUI dashboard |
| `mcp` | Start the MCP server to use workflows in other tools |
| `graph <workflow>` | Visualize the DAG as an ASCII or Mermaid diagram |
| `history` | List recent runs and their status |
| `auth login` | Authenticate with GitHub for Copilot support |
| `validate` | Check workflow files for schema and logic errors |

---

## 🔒 Security & Privacy

1. **Local State:** All run history, logs, and outputs are stored in a local SQLite database (`.keystone/state.db`).
2. **Redaction:** Keystone automatically scans for your environment variables and masks them in all logs and database entries.
3. **AST Evaluation:** Expressions are parsed into an Abstract Syntax Tree and executed in a sandbox, preventing arbitrary code execution within `${{ }}` blocks.
4. **Shell Safety:** Use the built-in `escape()` function when passing user input to shell commands to prevent injection.

---

## 📄 License

MIT © [Mark Hingston](https://github.com/mhingston)
