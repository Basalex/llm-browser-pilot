# LLM Browser Pilot

A Chrome Extension (Manifest V3 Side Panel) + zero-dependency local CLI bridge that works like **LLM Desktop** inside your browser — **no authentication or API keys required**.

## Features
- **Zero-Auth Local CLI Wrapper**: Wraps installed CLIs (`agy`, `claude`, `codex`, `grok`, `gemini`, `ollama`, plus any custom CLI command) via a local HTTP/SSE bridge (`http://127.0.0.1:4399`).
- **LLM & Model Selection**: Auto-detects installed CLIs and lets you switch providers and models directly in the Side Panel.
- **Browser Pilot**: Reads active tab context (URL, title, selection, page text, viewport, `<canvas>` regions, and indexed interactive DOM elements `[#0]`, `[#1]`, ...) and executes `browser_action` blocks (`click`, `type`, `select`, `scroll`, `navigate`, `press_key`, `highlight`, `hover`, `click_xy`, `move_xy`, `mouse_path`, `screenshot`) with visual element highlighting, automatic `<iframe>` coordinate forwarding, and zero-delay **Game Mode**.
- **Native MCP Browser Tools (`bridge/mcp.js`)**: Exposes typed MCP functions (`browser_get_state`, `browser_screenshot`, `browser_click`, `browser_click_xy`, `browser_move_xy`, `browser_mouse_path`, `browser_type`, `browser_select`, `browser_scroll`, `browser_press_key`, `browser_navigate`) over stdio so compatible CLIs (`agy`, `claude`, `codex`, `grok`, `gemini`) can control the browser directly via native tool calls.
- **Custom Modules & Domain/Page Binding**:
  - Create custom modules with their own system prompt, quick-action chips, preferred provider/model, and optional custom HTML widget.
  - Bind modules to domains (`github.com`), wildcards (`*.youtube.com/*`), specific URL paths (`docs.google.com/forms/*`), or `/regex/` patterns.
  - Matching modules are automatically badged and auto-activated when you navigate to a bound site.

## Quick Start

### Option 1: Interactive Launcher (Windows)
Double-click `launch.cmd` — it checks Node.js, starts the local CLI bridge on `http://127.0.0.1:4399`, detects installed LLM CLIs, **automatically registers the `llm-browser-pilot` MCP server** (`bridge/mcp.js`) for detected compatible CLIs (`agy`, `claude`, `codex`, `grok`, `gemini`), and lets you choose which Chrome or Edge profile to open/install the extension in (copying the `extension\` path to your clipboard automatically).

### Option 2: Manual Setup
1. **Start the local CLI bridge**:
   ```cmd
   cd D:\projects\LLMBrowserPilot
   npm start
   ```
   Or double-click `start-bridge.cmd`.

2. **Load the extension in Chrome / Edge**:
   - Open `chrome://extensions`
   - Enable **Developer mode**
   - Click **Load unpacked** and select `D:\projects\LLMBrowserPilot\extension`
   - Click the **LLM Browser Pilot** toolbar icon to open the Side Panel.

## Disclaimer & License

**USE AT YOUR OWN RISK.** This software is provided **"AS IS"**, without warranty of any kind, express or implied. In no event shall the authors or copyright holders be liable for any claim, damages, account restrictions, data loss, or other liability arising from the use of this software. You are responsible for complying with the terms of any third-party services or websites you interact with.

Licensed under the [MIT License](LICENSE).

