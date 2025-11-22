# Phase 1: Core Agent Framework

## Overview

**Goal:** Build the foundational multi-agent system running on Mac Studio that client devices can connect to. Setup client devices (OWUI, phone) and ensure connectivity. Begin using System Builder Agent to design and implement vault systems with agent assistance.

**Key Deliverables:**
- Multi-agent system (Orchestrator + Journal + System Builder)
- REST API for client connectivity
- Session management for persistent conversations
- Basic WebSocket for completion notifications
- Device ID system for control device designation
- Client device connectivity (OWUI, phone)
- Initial vault systems built with agent assistance

---

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                Mac Studio (Control Device)                   │
│  ┌────────────────────────────────────────────────────────┐ │
│  │ Obsidian Plugin (Agent Server)                         │ │
│  │  ├─ REST API (:8001)                                   │ │
│  │  ├─ WebSocket Server (:8002) [completion summaries]   │ │
│  │  ├─ Agents SDK                                         │ │
│  │  │  ├─ Orchestrator (qwen3-30b)                       │ │
│  │  │  ├─ Journal Agent (qwen3-8b)                       │ │
│  │  │  └─ System Builder Agent (qwen3-8b)                │ │
│  │  ├─ Session Manager (persistent conversations)        │ │
│  │  ├─ Direct Vault Access (app.vault.*)                 │ │
│  │  └─ LiveSync Plugin (automatic sync)                  │ │
│  └────────────────────────────────────────────────────────┘ │
│  ┌────────────────────────────────────────────────────────┐ │
│  │ LM Studio (:1234)                                      │ │
│  │  ├─ qwen3-30b (orchestrator) ~20GB VRAM               │ │
│  │  └─ qwen3-8b (specialists) ~10GB VRAM                 │ │
│  └────────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────┘
                              ↕ Network
┌─────────────────────────────────────────────────────────────┐
│                      Client Devices                          │
│  ┌──────────────────────┐  ┌──────────────────────┐        │
│  │ MacBook              │  │ Phone                │        │
│  │  ├─ OWUI             │  │  ├─ Browser/App      │        │
│  │  ├─ Obsidian+LiveSync│  │  ├─ OWUI/Other       │        │
│  │  └─ Client Plugin    │  │  └─ (read vault)     │        │
│  └──────────────────────┘  └──────────────────────┘        │
└─────────────────────────────────────────────────────────────┘
```

---

## System Components

### 1. Agents

#### Orchestrator Agent
```typescript
{
    name: 'orchestrator',
    model: 'qwen/qwen3-30b-a3b-2507',
    instructions: `You are the central orchestrator for The Lab v2 vault.

    Analyze user queries and hand off to specialized agents:
    - journal_agent: Daily notes, tasks, scheduling, logging
    - system_builder_agent: Designing vault systems, plugin research, system implementation

    For complex queries involving multiple domains, hand off to multiple agents.
    Be concise. Always return [[wikilinks]] to created/updated notes.`,
    handoffs: [journalAgent, systemBuilderAgent]
}
```

#### Journal Agent
```typescript
{
    name: 'journal_agent',
    model: 'qwen3:8b',
    instructions: `You specialize in daily logging and task management.

    Use journals_create_today to create daily notes.
    Use journals_log_info to log tasks/notes quickly.
    Use search_notes to find past entries.

    CRITICAL: Daily note structure varies by day of week. Use journals_log_info when possible.
    Task syntax: Use 🔔 for scheduled tasks, 📅 for due dates, ⏫ for priority.
    Always return [[wikilinks]] to created notes.`,
    functions: [
        journals_create_today,
        journals_log_info,
        search_notes,
        util_get_datetime
    ]
}
```

#### System Builder Agent
```typescript
{
    name: 'system_builder_agent',
    model: 'qwen3:8b',
    instructions: `You specialize in helping users design and build vault systems.

    Your role:
    1. Work with user to understand what system they want to build
    2. Ask questions to clarify: purpose, scope, workflow, plugins needed
    3. Research plugin documentation to understand capabilities
    4. Design the system: folder structure, templates, metadata schemas
    5. Implement the system: create files, configure plugins, set up workflows
    6. Document the system for future reference

    Available systems to build (examples):
    - Goal tracking (OKRs, milestones, progress)
    - Finance management (expenses, budgets, accounts)
    - Restaurants & foods (reviews, recipes, favorites)
    - Entertainment (anime, manga, TV shows, movies, books)
    - Any other life tracking system user requests

    For each system, determine:
    - Which plugins to leverage (templater, dataview, metadata-menu, etc.)
    - What metadata schema to use (fileClass system)
    - How tasks/tracking will work (obsidian-tasks-plugin)
    - What templates are needed
    - How user will interact with it daily

    Use fetch_plugin_docs to research plugin capabilities.
    Use search_notes to see existing vault structure.
    Use util_create_file to create new files.
    Use util_edit_file to modify existing files.
    Use util_update_frontmatter to set metadata.

    Always collaborate with user - ask questions, get feedback, iterate.`,
    functions: [
        fetch_plugin_docs,
        search_notes,
        util_create_file,
        util_edit_file,
        util_update_frontmatter,
        util_list_files,
        util_get_datetime
    ]
}
```

### 2. REST API Endpoints

```
POST   /v1/chat/completions          # Main chat endpoint (OpenAI-compatible)
GET    /v1/models                    # List available agents
GET    /v1/status                    # Server health, queue status, LM Studio status
POST   /v1/tools/:toolName           # Direct tool invocation
GET    /v1/sessions                  # List active sessions
GET    /v1/sessions/:id              # Get session details
DELETE /v1/sessions/:id              # Clear session
POST   /v1/sessions/:id/clear        # Clear session history
```

### 3. WebSocket Server

```
WebSocket ws://mac-studio-ip:8002

Message Types (Phase 1):
{
    type: 'completion_summary',
    data: {
        sessionId: string,
        action: string,
        filesModified: string[],
        filesCreated: string[],
        summary: string,
        timestamp: number
    }
}

{
    type: 'error',
    data: {
        sessionId: string,
        error: string,
        timestamp: number
    }
}
```

### 4. Session Management

```typescript
interface Session {
    id: string;                    // UUID
    deviceId: string;              // Which client device
    agent: Agent;                  // Current agent
    messages: Message[];           // Conversation history
    metadata: {
        created: number;
        lastActivity: number;
        tags: string[];            // For organization
    };
}

// Storage: SQLite database in plugin data folder
// Persistence: Survives plugin reload/Obsidian restart
// Cleanup: Sessions inactive >7 days auto-archived
```

### 5. Device ID System

```typescript
interface PluginSettings {
    // Device identification
    deviceId: string;              // Auto-generated UUID on first install
    controlDeviceId: string;       // User pastes Mac Studio's deviceId here
    isControlDevice: boolean;      // Computed: deviceId === controlDeviceId

    // Server config (only used if isControlDevice)
    serverPort: number;            // Default: 8001
    websocketPort: number;         // Default: 8002

    // Plugin docs config (only used if isControlDevice)
    enabledPluginsForDocs: string[]; // Which plugins to fetch docs for
    fetchDocsOnStartup: boolean;   // Auto-fetch on plugin load
    pluginDocsCache: {             // Stored links to docs
        [pluginName: string]: {
            docsUrl: string;
            version: string;
            fetchedAt: number;
        }
    };
}

// Settings UI shows:
// - Current device ID (with copy button)
// - Input field for control device ID
// - Status indicator: "This is the control device" or "Connected to: Mac-Studio"
```

### 6. Functions for System Builder Agent

#### fetch_plugin_docs
```typescript
async function fetchPluginDocs(params: { pluginName: string }): Promise<any> {
    // 1. Check cache for existing docs URL
    const cached = this.settings.pluginDocsCache[pluginName];
    if (cached && Date.now() - cached.fetchedAt < 7 * 24 * 60 * 60 * 1000) {
        // Fetch from cached URL
        const response = await fetch(cached.docsUrl);
        return {
            plugin: pluginName,
            docs: await response.text(),
            url: cached.docsUrl,
            cached: true
        };
    }

    // 2. Search for docs (GitHub, plugin manifest, etc.)
    const manifest = this.getPluginManifest(pluginName);
    const docsUrl = manifest?.fundingUrl || manifest?.authorUrl;

    // 3. Fetch and cache
    if (docsUrl) {
        const response = await fetch(docsUrl);
        const docs = await response.text();

        // Save to cache
        this.settings.pluginDocsCache[pluginName] = {
            docsUrl,
            version: manifest.version,
            fetchedAt: Date.now()
        };
        await this.saveSettings();

        return { plugin: pluginName, docs, url: docsUrl, cached: false };
    }

    return { error: `No documentation found for ${pluginName}` };
}
```

#### util_create_file
```typescript
async function utilCreateFile(params: {
    filePath: string;
    content: string;
    openAfterCreate?: boolean;
}): Promise<any> {
    const { filePath, content, openAfterCreate = false } = params;

    // Check if file exists
    const exists = await this.app.vault.adapter.exists(filePath);
    if (exists) {
        return { error: `File already exists: ${filePath}` };
    }

    // Create file
    await this.app.vault.create(filePath, content);

    // Optionally open
    if (openAfterCreate) {
        await this.app.workspace.openLinkText(filePath, '', false);
    }

    return {
        success: true,
        filePath,
        message: `Created file: ${filePath}`
    };
}
```

#### util_list_files
```typescript
async function utilListFiles(params: {
    folder?: string;
    pattern?: string;
    recursive?: boolean;
}): Promise<any> {
    const { folder = '', pattern = '*.md', recursive = true } = params;

    const files = this.app.vault.getMarkdownFiles();
    let filtered = files;

    if (folder) {
        filtered = filtered.filter(f => f.path.startsWith(folder));
    }

    if (pattern !== '*.md') {
        const regex = new RegExp(pattern.replace('*', '.*'));
        filtered = filtered.filter(f => regex.test(f.name));
    }

    return {
        files: filtered.map(f => ({
            path: f.path,
            name: f.name,
            folder: f.parent?.path || ''
        })),
        count: filtered.length
    };
}
```

---

## Plugin Structure

```
obsidian-agent-server/
├── main.ts                      # Plugin entry point
├── manifest.json
├── styles.css
│
├── src/
│   ├── agents/
│   │   ├── orchestrator.ts      # Orchestrator agent definition
│   │   ├── journal-agent.ts     # Journal specialist
│   │   └── system-builder-agent.ts  # System builder specialist
│   │
│   ├── api/
│   │   ├── rest-server.ts       # REST API (Express/Fastify)
│   │   ├── websocket-server.ts  # WebSocket notifications
│   │   ├── routes.ts            # API route handlers
│   │   └── middleware.ts        # Auth, CORS, error handling
│   │
│   ├── functions/
│   │   ├── journals.ts          # Journal functions (direct vault access)
│   │   ├── search.ts            # Search functions
│   │   ├── util.ts              # Utility functions
│   │   └── plugin-docs.ts       # Plugin documentation fetching
│   │
│   ├── services/
│   │   ├── lm-studio-client.ts  # LM Studio connection
│   │   ├── health-monitor.ts    # LM Studio health checks
│   │   ├── request-queue.ts     # Queue manager
│   │   ├── session-manager.ts   # Session persistence (SQLite)
│   │   └── device-manager.ts    # Device ID management
│   │
│   ├── models/
│   │   └── types.ts             # TypeScript interfaces
│   │
│   └── ui/
│       └── settings-tab.ts      # Plugin settings UI
│
└── data/
    ├── sessions.db              # SQLite session storage
    └── plugin-docs-cache.json   # Cached plugin docs URLs
```

---

## Implementation Tasks

### Setup & Configuration

**Project Structure**
- [ ] Create folder structure (agents/, api/, functions/, services/, models/, ui/)
- [ ] Initialize TypeScript configuration
- [ ] Set up build system (esbuild/rollup)

**Dependencies**
```bash
npm install @openai/agents openai ws express cors better-sqlite3
npm install --save-dev @types/express @types/ws @types/better-sqlite3
```

**Device ID System**
- [ ] Generate UUID on first install
- [ ] Create settings UI for device ID display/copy
- [ ] Create input field for control device ID
- [ ] Add computed property: isControlDevice
- [ ] Add status indicator showing control/client mode

---

### Core Agent System

**LM Studio Client**
- [ ] Configure OpenAI client pointing to localhost:1234
- [ ] Set as global client: `setDefaultOpenAIClient(lmStudioClient)`
- [ ] Set API mode: `setOpenAIAPI('chat_completions')`

**Journal Agent**
- [ ] Implement journal functions (create_today, log_info)
- [ ] Create journal agent with direct function calls
- [ ] Test standalone journal agent

**System Builder Agent**
- [ ] Implement fetch_plugin_docs function
- [ ] Implement util_create_file function
- [ ] Implement util_edit_file function
- [ ] Implement util_list_files function
- [ ] Create system builder agent definition
- [ ] Test plugin docs fetching
- [ ] Test file creation/editing

**Orchestrator Agent**
- [ ] Create orchestrator with handoffs
- [ ] Test routing to journal agent
- [ ] Test routing to system builder agent
- [ ] Test multi-agent workflows

---

### REST API

**Server Setup**
- [ ] Initialize Express server
- [ ] Bind to 0.0.0.0 (network access)
- [ ] Configure CORS
- [ ] Add request logging

**Endpoints**
- [ ] POST /v1/chat/completions (main chat)
- [ ] GET /v1/models (list agents)
- [ ] GET /v1/status (health check)
- [ ] POST /v1/tools/:toolName (direct tool calls)
- [ ] GET /v1/sessions (list sessions)
- [ ] GET /v1/sessions/:id (session details)
- [ ] DELETE /v1/sessions/:id (clear session)

**Request Queue**
- [ ] Implement FIFO queue for concurrent requests
- [ ] Add queue status to /v1/status endpoint
- [ ] Set max queue size (reject if exceeded)

---

### Session Management

**Database Setup**
- [ ] Initialize SQLite database (sessions.db)
- [ ] Create sessions table schema
- [ ] Create messages table schema

**Session Manager**
- [ ] Create session on first message
- [ ] Load session by ID
- [ ] Append messages to session
- [ ] Persist to SQLite
- [ ] Cleanup old sessions (>7 days inactive)

**API Integration**
- [ ] Extract/generate session ID from requests
- [ ] Load session before processing query
- [ ] Save session after response
- [ ] Return session ID in response headers

---

### WebSocket Server

**Server Setup**
- [ ] Initialize WebSocket server on port 8002
- [ ] Track connected clients
- [ ] Handle client connect/disconnect
- [ ] Handle reconnection logic

**Notifications (Phase 1: Completion Summaries Only)**
- [ ] Send completion_summary after agent finishes
- [ ] Include filesModified, filesCreated, summary
- [ ] Send error notifications on failures
- [ ] Add session ID to all messages

---

### Error Handling

**Global Error Handlers**
- [ ] Process-level uncaughtException handler
- [ ] Process-level unhandledRejection handler
- [ ] Express error middleware
- [ ] WebSocket error handler

**LM Studio Health Monitoring**
- [ ] Periodic health check (every 10s)
- [ ] Check /v1/models endpoint
- [ ] Track health status
- [ ] Block requests if unhealthy
- [ ] Return clear errors to clients

**Request-Level Error Handling**
- [ ] Wrap all endpoints in try/catch
- [ ] Return structured error responses
- [ ] Log errors with context
- [ ] Never crash server on error

**Timeout Protection**
- [ ] 60s timeout on all agent queries
- [ ] Return timeout error to client
- [ ] Continue server operation

---

### Client Setup

**MacBook OWUI**
- [ ] Configure OpenAI connection
- [ ] Base URL: http://mac-studio-ip:8001/v1
- [ ] Test basic query
- [ ] Test multi-turn conversation
- [ ] Verify session persistence

**Phone Client**
- [ ] Install OWUI or other client
- [ ] Configure connection
- [ ] Test basic query
- [ ] Test simultaneous conversations with MacBook

**Client Plugin (MacBook Obsidian)**
- [ ] Create companion plugin
- [ ] WebSocket connection to Mac Studio
- [ ] Display completion notifications
- [ ] Show connected device status
- [ ] Settings: Mac Studio URL configuration

---

### Testing

**Agent Tests**
- [ ] Journal agent: Log task
- [ ] Journal agent: Create daily note
- [ ] System builder: Fetch plugin docs
- [ ] System builder: Create file
- [ ] Orchestrator: Route to correct agent
- [ ] Multi-agent: Complex query involving both agents

**API Tests**
- [ ] Chat completions endpoint
- [ ] Session creation and persistence
- [ ] Concurrent requests (queue)
- [ ] Error handling (LM Studio down)
- [ ] Timeout handling

**Integration Tests**
- [ ] OWUI → API → Agent → Response
- [ ] Phone → API → Agent → Response
- [ ] Multiple devices simultaneously
- [ ] Session continuity across requests
- [ ] WebSocket notifications received

**Stress Tests**
- [ ] 10 concurrent requests
- [ ] Long conversation (50+ messages)
- [ ] Large file operations
- [ ] Plugin docs fetching (all 38 enabled plugins)

---

## Vault Systems to Build (Example Workflows)

### Goal Tracking System

**Conversation with System Builder Agent:**
```
User: "I want to set up a goal tracking system"

Agent: "Great! Let me help you design this. A few questions:

1. What types of goals do you want to track?
   - Personal goals (fitness, learning, habits)
   - Professional goals (career, skills, projects)
   - Long-term life goals (1-5 years)
   - All of the above?

2. How do you want to organize them?
   - By time horizon (daily, weekly, monthly, yearly)
   - By category (health, career, relationships, etc.)
   - By status (active, completed, abandoned)

3. What tracking data matters to you?
   - Progress percentage
   - Milestones/checkpoints
   - Daily check-ins
   - Metrics (e.g., weight, savings, hours spent)

4. Which plugins should we use?
   - I can see you have: dataview, obsidian-tasks-plugin, metadata-menu, obsidian-projects
   - Let me research their capabilities..."

[Agent fetches plugin docs]

Agent: "Based on the plugin capabilities, here's what I recommend:

**Folder Structure:**
Goals/
├── Active/
├── Completed/
└── Templates/

**Metadata Schema (via metadata-menu):**
fileClass: Goal
Fields:
- category: [Health, Career, Finance, Learning, Relationships]
- timeHorizon: [Daily, Weekly, Monthly, Quarterly, Yearly]
- status: [Not Started, In Progress, Completed, Abandoned]
- progress: number (0-100)
- startDate: date
- targetDate: date
- metrics: text

**Template (via templater):**
```yaml
---
fileClass: Goal
category:
timeHorizon:
status: Not Started
progress: 0
startDate: <% tp.date.now("YYYY-MM-DD") %>
targetDate:
tags: [goal]
---

# <% tp.file.title %>

## Why This Goal?

## Success Criteria

## Action Steps
- [ ]

## Progress Log

### <% tp.date.now("YYYY-MM-DD") %>
-
```

**Dataview Queries:**
- Active goals dashboard
- Goals by category
- Overdue goals

Should I create these files and set this up for you?"

User: "Yes, create it"

[Agent creates folder structure, template, example goal file]
[Agent sends WebSocket notification: "Goal tracking system created"]

User (on MacBook): Receives notification, opens Goals/ folder, sees new system
```

### Finance Management System

**Similar workflow:**
1. Agent asks questions about tracking needs
2. Researches relevant plugins
3. Designs folder structure, metadata schema, templates
4. Creates files
5. Documents how to use it

---

## Settings UI

```typescript
class AgentServerSettingTab extends PluginSettingTab {
    display(): void {
        const { containerEl } = this;
        containerEl.empty();

        // Device ID Section
        containerEl.createEl('h2', { text: 'Device Configuration' });

        new Setting(containerEl)
            .setName('This Device ID')
            .setDesc('Copy this ID to designate this device as the control device')
            .addText(text => text
                .setValue(this.plugin.settings.deviceId)
                .setDisabled(true)
            )
            .addButton(button => button
                .setButtonText('Copy')
                .onClick(() => {
                    navigator.clipboard.writeText(this.plugin.settings.deviceId);
                    new Notice('Device ID copied to clipboard');
                })
            );

        new Setting(containerEl)
            .setName('Control Device ID')
            .setDesc('Paste the device ID of your Mac Studio here')
            .addText(text => text
                .setPlaceholder('Paste device ID')
                .setValue(this.plugin.settings.controlDeviceId)
                .onChange(async (value) => {
                    this.plugin.settings.controlDeviceId = value;
                    await this.plugin.saveSettings();
                    this.display(); // Refresh to show status
                })
            );

        // Status indicator
        if (this.plugin.settings.isControlDevice) {
            containerEl.createEl('p', {
                text: '✅ This is the control device (servers will start)',
                cls: 'agent-status-control'
            });
        } else if (this.plugin.settings.controlDeviceId) {
            containerEl.createEl('p', {
                text: '📱 This is a client device (connected to control device)',
                cls: 'agent-status-client'
            });
        } else {
            containerEl.createEl('p', {
                text: '⚠️ Control device not configured',
                cls: 'agent-status-unconfigured'
            });
        }

        // Server Configuration (only show if control device)
        if (this.plugin.settings.isControlDevice) {
            containerEl.createEl('h2', { text: 'Server Configuration' });

            new Setting(containerEl)
                .setName('REST API Port')
                .setDesc('Port for REST API (default: 8001)')
                .addText(text => text
                    .setValue(String(this.plugin.settings.serverPort))
                    .onChange(async (value) => {
                        this.plugin.settings.serverPort = parseInt(value) || 8001;
                        await this.plugin.saveSettings();
                    })
                );

            new Setting(containerEl)
                .setName('WebSocket Port')
                .setDesc('Port for WebSocket notifications (default: 8002)')
                .addText(text => text
                    .setValue(String(this.plugin.settings.websocketPort))
                    .onChange(async (value) => {
                        this.plugin.settings.websocketPort = parseInt(value) || 8002;
                        await this.plugin.saveSettings();
                    })
                );

            // Plugin Documentation
            containerEl.createEl('h2', { text: 'Plugin Documentation' });

            new Setting(containerEl)
                .setName('Fetch Docs on Startup')
                .setDesc('Automatically fetch plugin docs when plugin loads')
                .addToggle(toggle => toggle
                    .setValue(this.plugin.settings.fetchDocsOnStartup)
                    .onChange(async (value) => {
                        this.plugin.settings.fetchDocsOnStartup = value;
                        await this.plugin.saveSettings();
                    })
                );

            new Setting(containerEl)
                .setName('Plugins to Index')
                .setDesc('Select which plugins to fetch documentation for')
                .addButton(button => button
                    .setButtonText('Configure')
                    .onClick(() => {
                        new PluginSelectionModal(this.app, this.plugin).open();
                    })
                );

            new Setting(containerEl)
                .setName('Clear Plugin Docs Cache')
                .setDesc('Remove all cached plugin documentation')
                .addButton(button => button
                    .setButtonText('Clear Cache')
                    .onClick(async () => {
                        this.plugin.settings.pluginDocsCache = {};
                        await this.plugin.saveSettings();
                        new Notice('Plugin docs cache cleared');
                    })
                );
        }

        // Client Configuration (only show if client device)
        if (!this.plugin.settings.isControlDevice && this.plugin.settings.controlDeviceId) {
            containerEl.createEl('h2', { text: 'Client Configuration' });

            new Setting(containerEl)
                .setName('Mac Studio URL')
                .setDesc('URL of Mac Studio control device')
                .addText(text => text
                    .setPlaceholder('ws://192.168.1.x:8002')
                    .setValue(this.plugin.settings.macStudioUrl || '')
                    .onChange(async (value) => {
                        this.plugin.settings.macStudioUrl = value;
                        await this.plugin.saveSettings();
                    })
                );
        }
    }
}
```

---

## Success Criteria

Phase 1 is complete when:

- [ ] Mac Studio plugin starts without errors
- [ ] REST API accessible from MacBook and phone
- [ ] Journal agent can log tasks and create daily notes
- [ ] System Builder agent can fetch plugin docs
- [ ] System Builder agent can create files and edit frontmatter
- [ ] Orchestrator correctly routes queries to appropriate agent
- [ ] Sessions persist across requests
- [ ] Multiple devices can maintain separate conversations simultaneously
- [ ] WebSocket notifications received on clients
- [ ] Can build at least 2 vault systems with System Builder agent assistance
- [ ] No crashes after 100 queries
- [ ] LM Studio health monitoring works
- [ ] Error handling prevents server crashes

---

## Next: Phase 2

Once Phase 1 is complete and stable, Phase 2 will focus on:
- Augmenting System Builder Agent with vector search (Qdrant)
- Building remaining vault systems with enhanced agent
- Adding image/video/PDF support
- Enhanced WebSocket notifications (progress, status, errors)
- Settings integration for notification types
