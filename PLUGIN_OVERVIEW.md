# Obsidian MCP Macros Plugin Overview

## Table of Contents
1. [Plugin Purpose and Features](#plugin-purpose-and-features)
2. [Qdrant Vector Database Integration](#qdrant-vector-database-integration)
3. [MCP Implementation](#mcp-implementation)
4. [Overall Architecture](#overall-architecture)
5. [How This Enhances Agent Usage](#how-this-enhances-agent-usage)
6. [Converting to Code Execution with MCP](#converting-to-code-execution-with-mcp)

---

## Plugin Purpose and Features

**Obsidian MCP Macros** transforms your Obsidian vault into an intelligent, agent-accessible knowledge system.

### Current V1 Features

- **MCP Server Integration**: Embedded Model Context Protocol server that exposes custom JavaScript tools to AI agents
- **Custom Macro System**: Users can write JavaScript functions with JSDoc comments in a designated folder (`mcp-tools/`) that automatically become MCP tools
- **OpenAPI Compatibility**: Generates OpenAPI 3.0 specifications for integration with tools like Open WebUI
- **Vector Database Sync**: Automatic synchronization of vault content to Qdrant for semantic search
- **Hot Reloading**: Automatically detects changes to tool files and reloads without restart
- **Built-in Tools**: Includes default tools like `get-active-file`, `create-note`, `search-notes`, `get-vault-stats`, and `vector-search`
- **Multi-Protocol Support**: Serves both MCP (for Claude Desktop, Cline) and OpenAPI (for Open WebUI) simultaneously

### Architecture Overview

- **Plugin Entry Point**: `main.ts` (2,508 lines)
- **Server Type**: HTTP server (Node.js `http` module) running on configurable host/port (default: localhost:3000)
- **Tool Discovery**: Scans `mcp-tools/` folder for `.js` files, parses JSDoc comments using `comment-parser` library
- **Dynamic Execution**: Uses dynamic imports with blob URLs to execute custom tools in the plugin runtime, giving access to Obsidian APIs

---

## Qdrant Vector Database Integration

### Purpose
Qdrant provides **semantic search capabilities** over vault content, enabling AI agents to find relevant information based on meaning rather than just keywords.

### Key Features

#### 1. Automatic File Synchronization
- Watches vault events: `create`, `modify`, `delete`, `rename`
- Automatically indexes files matching sync rules
- Real-time updates when files change

#### 2. Configurable Sync Rules
```typescript
interface SyncRule {
  id: string;
  name: string;
  enabled: boolean;
  type: 'extension' | 'folder' | 'file' | 'pattern';
  pattern: string;
  exclude?: string[];
}
```
- Default rule: All markdown files, excluding templates and archives
- User can add custom rules through settings

#### 3. Document Chunking
- Splits documents into configurable chunk sizes (default: 1000 characters)
- Overlap between chunks (default: 200 characters) for context preservation
- Extracts frontmatter metadata
- Each chunk stored separately with metadata

#### 4. Embedding Generation
- Supports multiple embedding models: `openai`, `local`, `huggingface`
- Currently implemented: OpenAI (`text-embedding-3-small`)
- Generates 1536-dimensional vectors (configurable)

#### 5. Qdrant Operations
- **Collection Management**: Automatically creates collections if they don't exist
- **Upsert**: Inserts or updates vectors with file metadata
- **Delete**: Removes all chunks when files are deleted
- **Search**: Semantic search returning scored results

#### 6. Vector Record Structure
```typescript
{
  id: `${file.path}_chunk_${chunk.index}`,
  vector: number[], // embedding
  metadata: {
    filePath: string,
    fileName: string,
    chunkIndex: number,
    lastModified: number,
    ...frontmatter
  }
}
```

### Configuration
```typescript
vectorSync: {
  enabled: boolean,
  qdrantUrl: string,              // Default: http://localhost:6333
  qdrantApiKey?: string,
  collectionName: string,         // Default: 'obsidian-vault'
  dimension: number,              // Default: 1536
  syncRules: SyncRule[],
  chunkSize: number,              // Default: 1000
  overlapSize: number,            // Default: 200
  embeddingModel: 'openai' | 'local' | 'huggingface',
  embeddingApiKey?: string,
  showStatusBar: boolean,
  showProgressNotifications: boolean
}
```

### Automatic Indexing Flow
```
File created/modified in Obsidian
  ↓ Matches sync rules? (*.md, exclude templates)
  ↓ Yes
Split into 1000-char chunks (200 overlap)
  ↓ Extract frontmatter metadata
  ↓ Send to OpenAI embedding API
  ↓ Get 1536-dim vectors
  ↓ Store in Qdrant collection "obsidian-vault"
Status bar updated
```

### Agent Benefits
- **RAG-Enabled Queries**: Agents can search by *meaning* not just keywords
- **Context Discovery**: Find relevant notes across thousands of files instantly
- **Multi-Modal Memory**: Each chunk stores metadata (file path, chunk index, frontmatter)
- **Real-Time Sync**: Changes to vault automatically update vector index

### Built-in Tools Exposed
- `vector-search`: Semantic search returning scored results
- `vector-sync-status`: Check sync configuration

---

## MCP Implementation

### Dual Protocol Architecture

The plugin implements **both MCP and OpenAPI** protocols simultaneously, serving different use cases:

#### MCP Endpoint: `/mcp`
- **Protocol**: JSON-RPC 2.0 over HTTP
- **Methods Supported**:
  - `initialize`: Returns protocol version and capabilities
  - `tools/list`: Returns all available tools
  - `tools/call`: Executes a specific tool
- **Session Management**: Multi-session support with 1-hour TTL cleanup
- **Use Cases**: Claude Desktop, Cline, other MCP clients

#### OpenAPI Endpoints
- `/openapi.json`: Returns OpenAPI 3.0 specification
- `/tools/{toolName}`: Execute specific tool via POST
- `/mcp/tools`: List all tools (legacy)
- `/mcp/call`: Execute tool (legacy)
- `/mcp/config`: Get OpenAPI config
- **Use Cases**: Open WebUI, external HTTP clients

### MCP Server Features

#### 1. Tool Schema Generation
```typescript
Tool = {
  name: string,
  description: string,
  inputSchema: {
    type: 'object',
    properties: Record<string, any>,
    required: string[]
  }
}
```

#### 2. JSDoc Parsing
- Uses `comment-parser` library (not regex)
- Extracts `@description` and `@param` tags
- Maps TypeScript types to JSON Schema
- Automatically determines required vs optional parameters

#### 3. Dynamic Tool Loading
- Creates blob URLs from JavaScript code
- Sets up global context with Obsidian APIs
- Dynamic import for execution
- Access to `app`, `vault`, `workspace` via globals

#### 4. Response Format
```typescript
CallToolResult = {
  content: [{ type: 'text', text: string }],
  structuredContent?: any, // Added in recent commit
  isError?: boolean
}
```

---

## Overall Architecture

### Component Hierarchy

```
MCPPlugin (main class)
├── Settings Management
│   ├── MCPPluginSettings interface
│   └── MCPSettingTab (UI)
├── HTTP Server
│   ├── MCP Endpoint Handler
│   ├── OpenAPI Endpoint Handler
│   └── Session Management
├── Tool System
│   ├── loadToolsFromFolder()
│   ├── loadToolFromFile()
│   ├── createDefaultTools()
│   └── customToolFunctions Map
├── VectorSyncManager
│   ├── File Event Listeners
│   ├── Chunk Processing
│   ├── Embedding Generation
│   └── Qdrant Client
└── Status Bar Integration
```

### Data Flow

#### Tool Execution Flow
```
External Client (Claude, Open WebUI)
  ↓ HTTP Request
HTTP Server (port 3000)
  ↓ Route to handler
MCP/OpenAPI Handler
  ↓ Parse tool name + args
callTool() / executeCustomTool()
  ↓ Load function from Map
Tool Function Execution
  ↓ Access Obsidian APIs
Vault Operations (create, search, etc.)
  ↓ Return result
Response serialization
  ↓ HTTP Response
Client receives result
```

#### Vector Sync Flow
```
File Event (create/modify/delete)
  ↓ Check sync rules
matchesSyncRules()
  ↓ If matches
indexFile() / removeFromIndex()
  ↓ Read file content
chunkContent()
  ↓ Split into chunks
generateEmbedding() (OpenAI API)
  ↓ For each chunk
upsertToQdrant()
  ↓ Store in collection
Update status bar
```

### Key Technical Patterns

#### 1. Hot Reloading
- Watches `mcp-tools/` directory via Obsidian vault events
- Detects `.js` file changes (create, modify, delete, rename)
- Triggers `reloadToolsQuietly()` → `restartServer()`
- Graceful shutdown with port release before restart

#### 2. CORS Handling
- Allows all origins (`*`)
- Supports OPTIONS preflight
- Custom headers: `Mcp-Session-Id`, `Mcp-Protocol-Version`

#### 3. Error Handling
- Try-catch blocks around tool execution
- Returns `isError: true` in response
- Logs errors to console
- Shows notices to user when appropriate

---

## How This Enhances Agent Usage

### Current V1 Agent Capabilities

#### 1. Knowledge Base Access
- Agents can read any file via `get-active-file`
- Search by keywords or semantic similarity
- Get vault structure and statistics

#### 2. Content Creation
- Create structured notes following templates
- Automatic folder organization
- Proper wikilink formatting

#### 3. Semantic Search
- RAG-enabled queries over entire vault
- Find relevant information across thousands of notes
- Context-aware responses based on vault content

#### 4. Multi-Client Support
- Claude Desktop (via MCP)
- Cline (via MCP)
- Open WebUI (via OpenAPI)
- Any HTTP client (via REST API)

#### 5. Extensibility
- Users can add domain-specific tools
- QuickAdd templates become agent actions
- No code changes to plugin required

### Custom Tool System

#### Tool Definition Example
```javascript
/**
 * @description Get the current date and time
 * @param {string} format Optional format string
 */
function getCurrentDateTime(params) {
    const now = new Date();
    return moment(now).format(params?.format)
}

module.exports = getCurrentDateTime;
```

#### Key Features
1. **JSDoc-Driven Configuration**: No separate config files needed
2. **TypeScript Type Mapping**: Supports string, number, boolean, array, object types
3. **Obsidian API Access**: Tools run in plugin context with full vault access
4. **Parameter Validation**: Required vs optional based on JSDoc
5. **Automatic Tool Discovery**: Just drop `.js` file in folder

### Built-in Automation Tools

1. **get-active-file**: Returns content of currently active file
2. **create-note**: Creates new notes with frontmatter, folders
3. **search-notes**: Searches by title (keyword matching)
4. **get-vault-stats**: Returns vault statistics (file counts, etc.)
5. **vector-search**: Semantic search using Qdrant (if enabled)
6. **vector-sync-status**: Shows current sync configuration

### Planned V2 Enhancements

#### Multi-Agent Architecture
- Orchestrator agent coordinates specialized sub-agents
- 7 specialized agents: People, Journal, Goals, Food, Code, Games, Experiences
- Each agent has domain expertise and RAG over specific collections
- Agent-to-agent communication for complex tasks

#### Mobile Voice Integration
- PWA with voice input via Whisper.cpp
- Secure access over Tailscale VPN
- Voice-first UI for hands-free knowledge management
- Offline queuing with background sync

#### Enhanced Memory System
- PostgreSQL for long-term conversation history
- Redis for active conversation context
- Agent learning from user preferences
- Cross-session context preservation

#### Infrastructure Distribution
- Mac Studio: Primary compute, orchestrator, Obsidian plugin
- Unraid NAS: Specialized agents, Qdrant, PostgreSQL, Redis
- All communication over Tailscale VPN (private network)

#### Advanced RAG
- Multi-collection strategy (one per note system)
- Two-stage retrieval with re-ranking
- Query expansion and semantic caching
- Multimodal support (images, audio, video)

---

## Converting to Code Execution with MCP

### Background: Code Execution Model

The Anthropic engineering blog post describes an approach where:

**Standard MCP**: Tool definitions loaded upfront into model context; all intermediate results flow through model.

**Code Execution MCP**: Tools loaded on-demand as a filesystem of TypeScript files; data processing happens in execution environment before returning results to model.

**Key Benefits**:
- **Token Savings**: 98.7% reduction (150k → 2k tokens)
- **Progressive Disclosure**: Models navigate filesystem, read tools on-demand
- **Data Filtering**: Process large datasets (10k-row spreadsheets) in code, return only relevant results
- **Control Flow Efficiency**: Loops and conditionals execute natively without model round-trips
- **State Persistence**: Agents maintain workspace files across executions

### Current Architecture (Tool-Based)
```
Claude Desktop
  ↓ MCP JSON-RPC call: tools/call
Obsidian HTTP Server (port 3000)
  ↓ Parse tool name + args
Execute customToolFunctions.get(toolName)
  ↓ Returns result
Claude receives structured response
```

**Token Cost**: All tools loaded upfront (~150k tokens for complex systems)
**Limitation**: Each operation requires model round-trip

### Proposed Architecture (Code Execution)

#### 1. Filesystem-Based Tool Discovery

Instead of loading all tool schemas upfront, expose tools as TypeScript files:

```
mcp-api/           # New folder (auto-generated from mcp-tools)
├── index.d.ts     # Type definitions
├── obsidian/
│   ├── getActiveFile.ts
│   ├── createNote.ts
│   └── searchNotes.ts
├── vector/
│   ├── semanticSearch.ts
│   └── getSyncStatus.ts
└── vault/
    └── getStats.ts
```

Each wrapper file:
```typescript
// mcp-api/vector/semanticSearch.ts
/**
 * Performs semantic search over the vault using Qdrant
 * @param query Search query string
 * @param limit Maximum results to return
 */
export async function semanticSearch(
  query: string,
  limit: number = 10
): Promise<Array<{
  content: string;
  score: number;
  metadata: Record<string, any>;
}>> {
  // Calls internal plugin API
  const response = await fetch('http://localhost:3000/tools/vector-search', {
    method: 'POST',
    body: JSON.stringify({ query, limit })
  });
  return response.json();
}
```

#### 2. Add Code Execution Endpoint

```typescript
// New endpoint: /mcp/execute
if (url.pathname === '/mcp/execute' && req.method === 'POST') {
    const body = await this.getRequestBody(req);
    const { code, language } = JSON.parse(body);
    const result = await this.executeCode(code, language);
    res.setHeader('Content-Type', 'application/json');
    res.writeHead(200);
    res.end(JSON.stringify(result));
    return;
}
```

#### 3. Code Execution Sandbox

Use VM2 or isolated-vm for safe TypeScript execution:

```typescript
import { NodeVM } from 'vm2';

async executeCode(code: string, language: 'typescript' | 'javascript') {
  const vm = new NodeVM({
    console: 'redirect',
    sandbox: {
      // Expose your API
      obsidian: this.generateObsidianAPI(),
      vector: this.generateVectorAPI(),
      vault: this.generateVaultAPI()
    },
    require: {
      external: ['moment'], // Whitelist safe libraries
      builtin: [] // Disable node builtins for security
    },
    timeout: 30000 // 30 second timeout
  });

  try {
    // Transpile TypeScript to JavaScript if needed
    const jsCode = language === 'typescript'
      ? transpileTypeScript(code)
      : code;

    const result = await vm.run(jsCode, 'agent-code.js');
    return { success: true, result };
  } catch (error) {
    return { success: false, error: error.message };
  }
}
```

#### 4. Add MCP Resource for API Discovery

```typescript
// New MCP method: resources/list
async handleResourcesList() {
  return {
    resources: [
      {
        uri: 'file:///mcp-api/obsidian/getActiveFile.ts',
        name: 'Obsidian: Get Active File',
        mimeType: 'text/typescript'
      },
      {
        uri: 'file:///mcp-api/vector/semanticSearch.ts',
        name: 'Vector: Semantic Search',
        mimeType: 'text/typescript'
      }
      // ... all your tools as resources
    ]
  };
}

// New MCP method: resources/read
async handleResourcesRead(uri: string) {
  // Return the TypeScript wrapper code
  const apiPath = uri.replace('file:///mcp-api/', '');
  const code = this.getAPIWrapperCode(apiPath);
  return {
    contents: [{
      uri,
      mimeType: 'text/typescript',
      text: code
    }]
  };
}
```

### Benefits for Qdrant Use Case

#### Before (Current): Agent needs 3 round-trips
```
Claude → vector-search (returns 100 results) → Claude
Claude → processes in context (token-heavy) → Claude
Claude → create-note (final result) → Claude
```

#### After (Code Execution): Single execution
```typescript
// Agent writes this, executes once
import { semanticSearch } from './vector/semanticSearch';
import { createNote } from './obsidian/createNote';

const results = await semanticSearch("qdrant integration notes", 100);

// Process 100 results in code, not in model context!
const relevant = results
  .filter(r => r.score > 0.85)
  .filter(r => r.metadata.tags?.includes('vector-db'))
  .slice(0, 5);

const summary = relevant.map((r, i) =>
  `## ${i+1}. ${r.metadata.fileName}\nScore: ${r.score}\n\n${r.content}`
).join('\n\n---\n\n');

await createNote({
  path: 'Agent Generated/Qdrant Integration Summary.md',
  content: `# Qdrant Integration Summary\n\n${summary}`,
  frontmatter: {
    generated: new Date().toISOString(),
    source: 'vector-search',
    query: 'qdrant integration notes'
  }
});

return `Created summary with ${relevant.length} high-scoring results`;
```

**Token Savings**: Instead of 100 search results in context (~50k tokens), only final message (~200 tokens).

### Security Considerations for NAS Setup

Since Qdrant runs on your NAS:

#### 1. Sandbox Network Access
Only allow connections to:
- `localhost:3000` (Obsidian HTTP server)
- Your NAS Qdrant URL (from settings)
- OpenAI API (for embeddings)

#### 2. Resource Limits
```typescript
const vm = new NodeVM({
  timeout: 30000,        // 30s max execution
  maxOldSpaceSize: 256,  // 256MB memory limit
  maxYoungSpaceSize: 64  // Prevent memory leaks
});
```

#### 3. File System Isolation
Don't allow direct file writes, only through Obsidian vault API

### Implementation Checklist

- [ ] Add /mcp/execute endpoint to HTTP server
- [ ] Install vm2 or isolated-vm for sandboxing
- [ ] Generate mcp-api/ folder structure from existing tools
- [ ] Create TypeScript wrapper generator function
- [ ] Add resources/list and resources/read to MCP handlers
- [ ] Add TypeScript transpilation (esbuild or ts-node)
- [ ] Implement security sandbox with network/memory limits
- [ ] Add code execution toggle to settings UI
- [ ] Update status bar to show "Code Mode" when enabled
- [ ] Test with simple code execution before complex RAG flows

### V2 Multi-Agent Enhancement

For your planned multi-agent system, code execution is **perfect** because:

#### 1. Agent-to-Agent Communication
```typescript
// Orchestrator can coordinate multiple agents in one execution
const peopleResults = await agents.people.search("john doe");
const journalResults = await agents.journal.search("meetings with john");
const context = [...peopleResults, ...journalResults];

// Process and synthesize without model round-trips
const summary = synthesizeContext(context);
return summary;
```

#### 2. State Persistence
Agents can maintain workspace files:
```typescript
// Agent builds skills over time
import { persistentWorkspace } from './workspace';

// Load previous analysis
const lastAnalysis = await persistentWorkspace.read('qdrant-analysis.json');

// Update with new findings
lastAnalysis.insights.push(newInsight);
await persistentWorkspace.write('qdrant-analysis.json', lastAnalysis);
```

#### 3. Multi-Collection RAG (Your V2 vision)
```typescript
// Query multiple Qdrant collections in parallel
const [people, journal, goals] = await Promise.all([
  qdrant.search('people-collection', query),
  qdrant.search('journal-collection', query),
  qdrant.search('goals-collection', query)
]);

// Re-rank and synthesize across collections
const reranked = rerank([...people, ...journal, ...goals]);
return reranked.slice(0, 10);
```

---

## Recent Development Activity

From git commits:
1. **182cb43**: Added agent-os project documentation for V2 architecture
2. **e8b1635**: Added `structuredContent` field to MCP responses for richer data
3. **4505170**: Made OpenAPI server compliant, added auto-reloading
4. **c084a95**: Switched from regex to `comment-parser` library for better JSDoc parsing
5. **ba0dbb5**: Implemented dynamic import system for live runtime tool execution

---

## Architecture Vision Summary

**Current State (V1)**: Single Obsidian plugin with embedded MCP server, basic vector sync, custom tool support

**Target State (V2)**: Distributed multi-agent system with:
- Orchestrator + 7 specialized agents
- Separation of compute (Mac Studio) and services (Unraid NAS)
- Mobile PWA with voice interface
- Advanced RAG with multi-collection strategy
- Agent memory and learning
- Custom lightweight protocol (considering optimization over MCP)

The V1 implementation is already **production-ready** for single-agent use cases (Claude Desktop, Open WebUI), while V2 planning focuses on scaling to a sophisticated multi-agent personal knowledge system with mobile access and distributed infrastructure.
