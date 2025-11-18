# Obsidian MCP Plugin - Refactoring Proposal

## Current State

The entire plugin is contained in a single `main.ts` file (2,508 lines) with:
- 5 interfaces/types
- 2 major classes (VectorSyncManager, MCPPlugin)
- 1 settings UI class
- 2 helper classes
- Mixed concerns (MCP protocol, HTTP server, vector DB, UI, tool loading)

**Issues:**
- ❌ Hard to maintain and test
- ❌ No clear separation of concerns
- ❌ Difficult to understand code flow
- ❌ Hard to add new features without touching everything
- ❌ No code reusability

---

## Proposed File Structure

```
obsidian-mcp-macros/
├── src/
│   ├── main.ts                          # Plugin entry point (150 lines)
│   │
│   ├── types/                           # Type definitions
│   │   ├── index.ts                     # Re-exports all types
│   │   ├── settings.ts                  # Settings interfaces
│   │   ├── mcp.ts                       # MCP-related types
│   │   └── vector.ts                    # Vector DB types
│   │
│   ├── services/                        # Business logic services
│   │   ├── http/
│   │   │   ├── HTTPServer.ts            # HTTP server management
│   │   │   ├── MCPRequestHandler.ts     # MCP protocol request handling
│   │   │   ├── OpenAPIHandler.ts        # OpenAPI endpoint handling
│   │   │   └── SessionManager.ts        # MCP session management
│   │   │
│   │   ├── vector/
│   │   │   ├── VectorSyncManager.ts     # Main vector sync coordinator
│   │   │   ├── QdrantClient.ts          # Qdrant operations wrapper
│   │   │   ├── EmbeddingService.ts      # Embedding generation (OpenAI, local, etc.)
│   │   │   ├── ChunkingService.ts       # Document chunking logic
│   │   │   └── SyncRuleEngine.ts        # Sync rule evaluation
│   │   │
│   │   ├── tools/
│   │   │   ├── ToolLoader.ts            # Load tools from folder
│   │   │   ├── ToolRegistry.ts          # Tool registration and lookup
│   │   │   ├── ToolExecutor.ts          # Execute tools with error handling
│   │   │   ├── JSDocParser.ts           # Parse JSDoc to tool schema
│   │   │   └── ModuleLoader.ts          # Dynamic module loading
│   │   │
│   │   └── config/
│   │       ├── MCPConfigGenerator.ts    # Generate MCP client config
│   │       └── OpenAPIGenerator.ts      # Generate OpenAPI spec
│   │
│   ├── tools/                           # Built-in tool implementations
│   │   ├── index.ts                     # Register all default tools
│   │   ├── VaultTools.ts                # get-active-file, create-note, etc.
│   │   ├── SearchTools.ts               # search-notes, get-vault-stats
│   │   └── VectorTools.ts               # vector-search, vector-sync-status
│   │
│   ├── ui/                              # User interface components
│   │   ├── SettingTab.ts                # Main settings tab
│   │   ├── sections/
│   │   │   ├── ServerSettings.ts        # Server configuration section
│   │   │   ├── VectorSettings.ts        # Vector sync settings section
│   │   │   ├── ToolsSettings.ts         # Tools folder settings
│   │   │   └── ConfigExport.ts          # Config export section
│   │   ├── components/
│   │   │   ├── FolderSuggest.ts         # Folder autocomplete
│   │   │   └── ConfigDisplayModal.ts    # Config display modal
│   │   └── StatusBar.ts                 # Status bar management
│   │
│   ├── utils/                           # Utility functions
│   │   ├── logger.ts                    # Logging utilities
│   │   ├── paths.ts                     # Path manipulation helpers
│   │   ├── validation.ts                # Input validation
│   │   └── frontmatter.ts               # Frontmatter parsing
│   │
│   └── constants/                       # Constants and defaults
│       ├── defaults.ts                  # DEFAULT_SETTINGS, etc.
│       └── schemas.ts                   # JSON schemas for validation
│
├── main.ts                              # Obsidian plugin entry (exports src/main.ts)
├── manifest.json
├── package.json
├── tsconfig.json
└── README.md
```

---

## Detailed Component Breakdown

### 1. Entry Point: `src/main.ts` (~150 lines)

**Responsibility**: Plugin lifecycle management, dependency injection

```typescript
import { Plugin } from 'obsidian';
import { DEFAULT_SETTINGS } from './constants/defaults';
import { MCPPluginSettings } from './types/settings';
import { HTTPServer } from './services/http/HTTPServer';
import { VectorSyncManager } from './services/vector/VectorSyncManager';
import { ToolRegistry } from './services/tools/ToolRegistry';
import { SettingTab } from './ui/SettingTab';
import { StatusBarManager } from './ui/StatusBar';

export default class MCPPlugin extends Plugin {
  settings: MCPPluginSettings;

  // Services
  private httpServer: HTTPServer;
  private vectorSync: VectorSyncManager;
  private toolRegistry: ToolRegistry;
  private statusBar: StatusBarManager;

  async onload() {
    await this.loadSettings();

    // Initialize services
    this.toolRegistry = new ToolRegistry(this);
    this.httpServer = new HTTPServer(this, this.toolRegistry);
    this.vectorSync = new VectorSyncManager(this);
    this.statusBar = new StatusBarManager(this);

    // Setup UI
    this.addSettingTab(new SettingTab(this.app, this));

    // Start services if enabled
    if (this.settings.enabled) {
      await this.startServices();
    }

    // Register commands
    this.registerCommands();
  }

  async startServices() {
    await this.toolRegistry.loadTools();
    await this.httpServer.start();
    this.vectorSync.start();
    this.statusBar.show();
  }

  async onunload() {
    await this.httpServer.stop();
    this.vectorSync.stop();
    this.statusBar.hide();
  }

  // ... other lifecycle methods
}
```

---

### 2. Types: `src/types/`

#### `types/settings.ts`
```typescript
export interface MCPPluginSettings {
  toolsFolder: string;
  enabled: boolean;
  serverPort: number;
  serverHost: string;
  hotReloading: boolean;
  showStartupLogs: boolean;
  vectorSync: VectorSyncSettings;
}

export interface VectorSyncSettings {
  enabled: boolean;
  qdrantUrl: string;
  qdrantApiKey?: string;
  collectionName: string;
  dimension: number;
  syncRules: SyncRule[];
  chunkSize: number;
  overlapSize: number;
  embeddingModel: 'openai' | 'local' | 'huggingface';
  embeddingApiKey?: string;
  showStatusBar: boolean;
  showProgressNotifications: boolean;
}

export interface SyncRule {
  id: string;
  name: string;
  enabled: boolean;
  type: 'extension' | 'folder' | 'file' | 'pattern';
  pattern: string;
  exclude?: string[];
}
```

#### `types/mcp.ts`
```typescript
import { Tool, CallToolResult } from '@modelcontextprotocol/sdk/types.js';

export interface MCPSession {
  id: string;
  server: Server;
  lastActivity: number;
}

export interface ToolFunction {
  (args: Record<string, any>): Promise<any>;
}

// ... other MCP-related types
```

#### `types/vector.ts`
```typescript
export interface ChunkData {
  text: string;
  index: number;
  metadata: Record<string, any>;
}

export interface VectorRecord {
  id: string;
  vector: number[];
  metadata: Record<string, any>;
}

export interface EmbeddingProvider {
  generateEmbedding(text: string): Promise<number[] | null>;
}
```

---

### 3. Services: `src/services/`

#### `services/http/HTTPServer.ts` (~150 lines)
```typescript
import * as http from 'http';
import { MCPPlugin } from '../../main';
import { MCPRequestHandler } from './MCPRequestHandler';
import { OpenAPIHandler } from './OpenAPIHandler';
import { ToolRegistry } from '../tools/ToolRegistry';

export class HTTPServer {
  private server: http.Server | null = null;
  private mcpHandler: MCPRequestHandler;
  private apiHandler: OpenAPIHandler;

  constructor(
    private plugin: MCPPlugin,
    private toolRegistry: ToolRegistry
  ) {
    this.mcpHandler = new MCPRequestHandler(plugin, toolRegistry);
    this.apiHandler = new OpenAPIHandler(plugin, toolRegistry);
  }

  async start(): Promise<void> {
    const { serverHost, serverPort } = this.plugin.settings;

    this.server = http.createServer(async (req, res) => {
      await this.handleRequest(req, res);
    });

    return new Promise((resolve, reject) => {
      this.server!.listen(serverPort, serverHost, () => {
        console.log(`HTTP MCP Server started on ${serverHost}:${serverPort}`);
        resolve();
      });

      this.server!.on('error', reject);
    });
  }

  private async handleRequest(
    req: http.IncomingMessage,
    res: http.ServerResponse
  ): Promise<void> {
    const url = new URL(req.url || '/', `http://${req.headers.host}`);

    // Set CORS headers
    this.setCORSHeaders(res);

    if (req.method === 'OPTIONS') {
      res.writeHead(200);
      res.end();
      return;
    }

    try {
      // Route to appropriate handler
      if (url.pathname === '/mcp') {
        await this.mcpHandler.handle(req, res);
      } else if (url.pathname === '/openapi.json') {
        await this.apiHandler.handleSpec(req, res);
      } else if (url.pathname.startsWith('/tools/')) {
        await this.apiHandler.handleToolCall(req, res, url);
      } else {
        this.sendDefaultResponse(res);
      }
    } catch (error) {
      this.sendError(res, error);
    }
  }

  async stop(): Promise<void> {
    return new Promise((resolve) => {
      if (this.server) {
        this.server.close(() => {
          this.server = null;
          resolve();
        });
      } else {
        resolve();
      }
    });
  }

  private setCORSHeaders(res: http.ServerResponse): void {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, Mcp-Session-Id');
  }

  private sendDefaultResponse(res: http.ServerResponse): void {
    res.writeHead(200);
    res.end('Obsidian MCP Server');
  }

  private sendError(res: http.ServerResponse, error: Error): void {
    res.setHeader('Content-Type', 'application/json');
    res.writeHead(500);
    res.end(JSON.stringify({
      error: 'Internal server error',
      message: error.message
    }));
  }
}
```

#### `services/http/MCPRequestHandler.ts` (~200 lines)
```typescript
import * as http from 'http';
import { JSONRPCMessage, JSONRPCRequest } from '@modelcontextprotocol/sdk/types.js';
import { SessionManager } from './SessionManager';
import { ToolRegistry } from '../tools/ToolRegistry';

export class MCPRequestHandler {
  private sessionManager: SessionManager;

  constructor(
    private plugin: MCPPlugin,
    private toolRegistry: ToolRegistry
  ) {
    this.sessionManager = new SessionManager(plugin, toolRegistry);
  }

  async handle(
    req: http.IncomingMessage,
    res: http.ServerResponse
  ): Promise<void> {
    const body = await this.getRequestBody(req);
    const response = await this.processRequest(body);

    res.setHeader('Content-Type', 'application/json');
    res.writeHead(200);
    res.end(JSON.stringify(response));
  }

  private async processRequest(bodyStr: string): Promise<any> {
    try {
      const message = JSON.parse(bodyStr) as JSONRPCMessage;

      if ('method' in message) {
        return await this.handleJSONRPCRequest(message as JSONRPCRequest);
      }

      throw new Error('Invalid message format');
    } catch (error) {
      return this.createErrorResponse(error);
    }
  }

  private async handleJSONRPCRequest(request: JSONRPCRequest): Promise<any> {
    const session = this.sessionManager.getOrCreateSession();

    try {
      let result: any;

      switch (request.method) {
        case 'initialize':
          result = this.handleInitialize();
          break;
        case 'tools/list':
          result = await this.handleToolsList();
          break;
        case 'tools/call':
          result = await this.handleToolCall(request.params);
          break;
        default:
          throw new Error(`Unknown method: ${request.method}`);
      }

      return {
        jsonrpc: '2.0',
        id: request.id,
        result
      };
    } catch (error) {
      return {
        jsonrpc: '2.0',
        id: request.id,
        error: {
          code: -32603,
          message: error.message
        }
      };
    }
  }

  private handleInitialize() {
    return {
      protocolVersion: '2024-11-05',
      capabilities: { tools: {} },
      serverInfo: {
        name: 'obsidian-vault-tools',
        version: '0.1.0'
      }
    };
  }

  private async handleToolsList() {
    return {
      tools: await this.toolRegistry.getAllTools()
    };
  }

  private async handleToolCall(params: any) {
    const { name, arguments: args } = params;
    return await this.toolRegistry.executeTool(name, args || {});
  }

  private async getRequestBody(req: http.IncomingMessage): Promise<string> {
    return new Promise((resolve, reject) => {
      let body = '';
      req.on('data', chunk => body += chunk.toString());
      req.on('end', () => resolve(body));
      req.on('error', reject);
    });
  }

  private createErrorResponse(error: Error) {
    return {
      jsonrpc: '2.0',
      error: {
        code: -32700,
        message: 'Parse error'
      }
    };
  }
}
```

#### `services/http/SessionManager.ts` (~100 lines)
```typescript
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { MCPSession } from '../../types/mcp';

export class SessionManager {
  private sessions: Map<string, MCPSession> = new Map();
  private readonly SESSION_MAX_AGE = 60 * 60 * 1000; // 1 hour

  constructor(
    private plugin: MCPPlugin,
    private toolRegistry: ToolRegistry
  ) {
    // Start cleanup interval
    setInterval(() => this.cleanupSessions(), 60000); // Every minute
  }

  getOrCreateSession(sessionId?: string): MCPSession {
    const id = sessionId || this.generateSessionId();

    let session = this.sessions.get(id);

    if (!session) {
      session = {
        id,
        server: this.createServerInstance(),
        lastActivity: Date.now()
      };
      this.sessions.set(id, session);
    } else {
      session.lastActivity = Date.now();
    }

    return session;
  }

  private createServerInstance(): Server {
    const server = new Server({
      name: 'obsidian-vault-tools',
      version: '0.1.0'
    }, {
      capabilities: { tools: {} }
    });

    // Register handlers
    this.toolRegistry.registerHandlers(server);

    return server;
  }

  private generateSessionId(): string {
    return Math.random().toString(36).substr(2, 9) + Date.now().toString(36);
  }

  private cleanupSessions(): void {
    const now = Date.now();

    for (const [id, session] of this.sessions) {
      if (now - session.lastActivity > this.SESSION_MAX_AGE) {
        try {
          session.server.close();
        } catch (error) {
          console.error(`Error closing session ${id}:`, error);
        }
        this.sessions.delete(id);
      }
    }
  }

  closeAll(): void {
    for (const [id, session] of this.sessions) {
      try {
        session.server.close();
      } catch (error) {
        console.error(`Error closing session ${id}:`, error);
      }
    }
    this.sessions.clear();
  }
}
```

#### `services/vector/VectorSyncManager.ts` (~150 lines)
```typescript
import { TFile } from 'obsidian';
import { MCPPlugin } from '../../main';
import { QdrantClientWrapper } from './QdrantClient';
import { EmbeddingService } from './EmbeddingService';
import { ChunkingService } from './ChunkingService';
import { SyncRuleEngine } from './SyncRuleEngine';

export class VectorSyncManager {
  private qdrant: QdrantClientWrapper;
  private embedding: EmbeddingService;
  private chunking: ChunkingService;
  private ruleEngine: SyncRuleEngine;
  private syncQueue: Set<string> = new Set();

  constructor(private plugin: MCPPlugin) {
    const { vectorSync } = plugin.settings;

    this.qdrant = new QdrantClientWrapper(vectorSync);
    this.embedding = new EmbeddingService(vectorSync);
    this.chunking = new ChunkingService(vectorSync);
    this.ruleEngine = new SyncRuleEngine(vectorSync.syncRules);
  }

  start(): void {
    if (!this.plugin.settings.vectorSync.enabled) return;

    this.setupEventListeners();
    this.qdrant.connect();
  }

  stop(): void {
    this.qdrant.disconnect();
  }

  private setupEventListeners(): void {
    const { vault } = this.plugin.app;

    this.plugin.registerEvent(
      vault.on('create', (file) => this.handleFileCreate(file))
    );
    this.plugin.registerEvent(
      vault.on('modify', (file) => this.handleFileModify(file))
    );
    this.plugin.registerEvent(
      vault.on('delete', (file) => this.handleFileDelete(file))
    );
    this.plugin.registerEvent(
      vault.on('rename', (file, oldPath) => this.handleFileRename(file, oldPath))
    );
  }

  private async handleFileCreate(file: TFile): Promise<void> {
    if (this.ruleEngine.shouldSync(file)) {
      await this.indexFile(file);
    }
  }

  private async handleFileModify(file: TFile): Promise<void> {
    if (this.ruleEngine.shouldSync(file)) {
      await this.indexFile(file);
    }
  }

  private async handleFileDelete(file: TFile): Promise<void> {
    if (this.ruleEngine.shouldSync(file)) {
      await this.removeFromIndex(file.path);
    }
  }

  private async handleFileRename(file: TFile, oldPath: string): Promise<void> {
    if (this.ruleEngine.shouldSync(file)) {
      await this.removeFromIndex(oldPath);
      await this.indexFile(file);
    }
  }

  private async indexFile(file: TFile): Promise<void> {
    try {
      this.syncQueue.add(file.path);
      this.updateStatus('syncing');

      const content = await this.plugin.app.vault.read(file);
      const chunks = this.chunking.chunkContent(content, file);

      for (const chunk of chunks) {
        const vector = await this.embedding.generateEmbedding(chunk.text);

        if (vector) {
          await this.qdrant.upsert({
            id: `${file.path}_chunk_${chunk.index}`,
            vector,
            metadata: {
              filePath: file.path,
              fileName: file.basename,
              chunkIndex: chunk.index,
              lastModified: file.stat.mtime,
              ...chunk.metadata
            }
          });
        }
      }

      this.syncQueue.delete(file.path);

      if (this.syncQueue.size === 0) {
        this.updateStatus('ready');
      }
    } catch (error) {
      console.error(`Error indexing file ${file.path}:`, error);
      this.syncQueue.delete(file.path);
      this.updateStatus('error');
    }
  }

  private async removeFromIndex(filePath: string): Promise<void> {
    await this.qdrant.deleteByFilePath(filePath);
  }

  async searchSimilar(query: string, limit: number = 10): Promise<any[]> {
    const queryVector = await this.embedding.generateEmbedding(query);
    if (!queryVector) {
      throw new Error('Failed to generate embedding for query');
    }
    return await this.qdrant.search(queryVector, limit);
  }

  async syncEntireVault(): Promise<void> {
    const allFiles = this.plugin.app.vault.getFiles();
    const filesToSync = allFiles.filter(file => this.ruleEngine.shouldSync(file));

    for (const file of filesToSync) {
      await this.indexFile(file);
    }
  }

  async clearAllVectors(): Promise<void> {
    await this.qdrant.clearCollection();
  }

  private updateStatus(status: 'ready' | 'syncing' | 'error'): void {
    this.plugin.updateStatusBar?.(status);
  }
}
```

#### `services/vector/QdrantClient.ts` (~150 lines)
```typescript
import { QdrantClient as QdrantSDK } from '@qdrant/js-client-rest';
import { VectorSyncSettings, VectorRecord } from '../../types/vector';

export class QdrantClientWrapper {
  private client: QdrantSDK | null = null;

  constructor(private settings: VectorSyncSettings) {}

  connect(): void {
    const config: any = { url: this.settings.qdrantUrl };

    if (this.settings.qdrantApiKey) {
      config.apiKey = this.settings.qdrantApiKey;
    }

    this.client = new QdrantSDK(config);
    console.log('Qdrant client connected');
  }

  disconnect(): void {
    this.client = null;
  }

  async upsert(record: VectorRecord): Promise<void> {
    if (!this.client) throw new Error('Qdrant client not initialized');

    await this.ensureCollection();

    await this.client.upsert(this.settings.collectionName, {
      points: [{
        id: record.id,
        vector: record.vector,
        payload: record.metadata
      }]
    });
  }

  async search(vector: number[], limit: number): Promise<any[]> {
    if (!this.client) throw new Error('Qdrant client not initialized');

    const results = await this.client.search(this.settings.collectionName, {
      vector,
      limit,
      with_payload: true
    });

    return results.map(result => ({
      id: result.id,
      score: result.score,
      metadata: result.payload
    }));
  }

  async deleteByFilePath(filePath: string): Promise<void> {
    if (!this.client) throw new Error('Qdrant client not initialized');

    const searchResult = await this.client.search(this.settings.collectionName, {
      vector: new Array(this.settings.dimension).fill(0),
      filter: {
        must: [{
          key: 'filePath',
          match: { value: filePath }
        }]
      },
      limit: 1000
    });

    const pointIds = searchResult.map(point => point.id);

    if (pointIds.length > 0) {
      await this.client.delete(this.settings.collectionName, {
        points: pointIds
      });
    }
  }

  async clearCollection(): Promise<void> {
    if (!this.client) throw new Error('Qdrant client not initialized');

    await this.client.deleteCollection(this.settings.collectionName);
    await this.ensureCollection();
  }

  private async ensureCollection(): Promise<void> {
    if (!this.client) return;

    const collections = await this.client.getCollections();
    const exists = collections.collections.some(
      col => col.name === this.settings.collectionName
    );

    if (!exists) {
      await this.client.createCollection(this.settings.collectionName, {
        vectors: {
          size: this.settings.dimension,
          distance: 'Cosine'
        }
      });
      console.log(`Created Qdrant collection: ${this.settings.collectionName}`);
    }
  }
}
```

#### `services/vector/EmbeddingService.ts` (~100 lines)
```typescript
import { VectorSyncSettings, EmbeddingProvider } from '../../types/vector';
import { OpenAIEmbedding } from './providers/OpenAIEmbedding';
import { LocalEmbedding } from './providers/LocalEmbedding';

export class EmbeddingService {
  private provider: EmbeddingProvider;

  constructor(settings: VectorSyncSettings) {
    switch (settings.embeddingModel) {
      case 'openai':
        this.provider = new OpenAIEmbedding(settings);
        break;
      case 'local':
        this.provider = new LocalEmbedding(settings);
        break;
      default:
        throw new Error(`Unsupported embedding model: ${settings.embeddingModel}`);
    }
  }

  async generateEmbedding(text: string): Promise<number[] | null> {
    try {
      return await this.provider.generateEmbedding(text);
    } catch (error) {
      console.error('Error generating embedding:', error);
      return null;
    }
  }
}

// providers/OpenAIEmbedding.ts
export class OpenAIEmbedding implements EmbeddingProvider {
  constructor(private settings: VectorSyncSettings) {}

  async generateEmbedding(text: string): Promise<number[] | null> {
    if (!this.settings.embeddingApiKey) {
      throw new Error('OpenAI API key not set');
    }

    const response = await fetch('https://api.openai.com/v1/embeddings', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.settings.embeddingApiKey}`
      },
      body: JSON.stringify({
        input: text,
        model: 'text-embedding-3-small'
      })
    });

    if (!response.ok) {
      throw new Error(`OpenAI API error: ${response.statusText}`);
    }

    const data = await response.json();
    return data.data[0].embedding;
  }
}
```

#### `services/vector/ChunkingService.ts` (~80 lines)
```typescript
import { TFile } from 'obsidian';
import { ChunkData, VectorSyncSettings } from '../../types/vector';
import { parseFrontmatter } from '../../utils/frontmatter';

export class ChunkingService {
  constructor(private settings: VectorSyncSettings) {}

  chunkContent(content: string, file: TFile): ChunkData[] {
    const { chunkSize, overlapSize } = this.settings;
    const chunks: ChunkData[] = [];

    // Extract frontmatter
    const { metadata, body } = parseFrontmatter(content);

    // Chunk the body content
    for (let i = 0; i < body.length; i += chunkSize - overlapSize) {
      const chunkText = body.slice(i, i + chunkSize);

      chunks.push({
        text: chunkText,
        index: Math.floor(i / (chunkSize - overlapSize)),
        metadata: {
          ...metadata,
          fileExtension: file.extension,
          totalChunks: Math.ceil(body.length / (chunkSize - overlapSize))
        }
      });
    }

    return chunks;
  }
}
```

#### `services/vector/SyncRuleEngine.ts` (~100 lines)
```typescript
import { TFile } from 'obsidian';
import { SyncRule } from '../../types/settings';

export class SyncRuleEngine {
  constructor(private rules: SyncRule[]) {}

  shouldSync(file: TFile): boolean {
    for (const rule of this.rules) {
      if (!rule.enabled) continue;

      if (this.matchesRule(file, rule)) {
        // Check excludes
        if (rule.exclude?.some(pattern => this.matchesPattern(file.path, pattern))) {
          continue;
        }
        return true;
      }
    }
    return false;
  }

  private matchesRule(file: TFile, rule: SyncRule): boolean {
    switch (rule.type) {
      case 'extension':
        return file.extension === rule.pattern.replace('.', '');
      case 'folder':
        return file.path.startsWith(rule.pattern);
      case 'file':
        return file.path === rule.pattern;
      case 'pattern':
        return this.matchesPattern(file.path, rule.pattern);
      default:
        return false;
    }
  }

  private matchesPattern(filePath: string, pattern: string): boolean {
    const regex = pattern
      .replace(/\*\*/g, '.*')
      .replace(/\*/g, '[^/]*')
      .replace(/\?/g, '.');
    return new RegExp(`^${regex}$`).test(filePath);
  }
}
```

#### `services/tools/ToolRegistry.ts` (~200 lines)
```typescript
import { Tool, CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { MCPPlugin } from '../../main';
import { ToolLoader } from './ToolLoader';
import { ToolExecutor } from './ToolExecutor';
import { createDefaultTools } from '../../tools';

export class ToolRegistry {
  private tools: Map<string, Tool> = new Map();
  private functions: Map<string, Function> = new Map();
  private loader: ToolLoader;
  private executor: ToolExecutor;

  constructor(private plugin: MCPPlugin) {
    this.loader = new ToolLoader(plugin);
    this.executor = new ToolExecutor(plugin);
  }

  async loadTools(): Promise<void> {
    this.tools.clear();
    this.functions.clear();

    // Load custom tools from folder
    const customTools = await this.loader.loadFromFolder(
      this.plugin.settings.toolsFolder
    );

    for (const [name, { tool, func }] of customTools) {
      this.tools.set(name, tool);
      this.functions.set(name, func);
    }

    // Load default built-in tools
    const defaultTools = createDefaultTools(this.plugin);

    for (const [name, tool] of defaultTools) {
      this.tools.set(name, tool);
    }

    console.log(`Loaded ${this.tools.size} tools`);
  }

  async executeTool(name: string, args: Record<string, any>): Promise<CallToolResult> {
    return await this.executor.execute(name, args, this.functions);
  }

  getAllTools(): Tool[] {
    return Array.from(this.tools.values());
  }

  getTool(name: string): Tool | undefined {
    return this.tools.get(name);
  }

  registerHandlers(server: Server): void {
    server.setRequestHandler(ListToolsRequestSchema, async () => {
      return { tools: this.getAllTools() };
    });

    server.setRequestHandler(CallToolRequestSchema, async (request) => {
      return await this.executeTool(
        request.params.name,
        request.params.arguments || {}
      );
    });
  }
}
```

#### `services/tools/ToolLoader.ts` (~150 lines)
```typescript
import { TFile } from 'obsidian';
import { Tool } from '@modelcontextprotocol/sdk/types.js';
import { JSDocParser } from './JSDocParser';
import { ModuleLoader } from './ModuleLoader';

export class ToolLoader {
  private jsDocParser: JSDocParser;
  private moduleLoader: ModuleLoader;

  constructor(private plugin: MCPPlugin) {
    this.jsDocParser = new JSDocParser();
    this.moduleLoader = new ModuleLoader(plugin);
  }

  async loadFromFolder(folderPath: string): Promise<Map<string, { tool: Tool, func: Function }>> {
    const tools = new Map();

    const folder = this.plugin.app.vault.getAbstractFileByPath(folderPath);
    if (!folder) {
      console.log('Tools folder not found');
      return tools;
    }

    const files = this.plugin.app.vault.getFiles().filter(file =>
      file.path.startsWith(folderPath) && file.extension === 'js'
    );

    for (const file of files) {
      const loaded = await this.loadFromFile(file);
      if (loaded) {
        tools.set(file.basename, loaded);
      }
    }

    return tools;
  }

  async loadFromFile(file: TFile): Promise<{ tool: Tool, func: Function } | null> {
    try {
      const content = await this.plugin.app.vault.read(file);

      // Parse JSDoc to create tool schema
      const tool = this.jsDocParser.parseToToolSchema(content, file.basename);

      // Load the actual function
      const func = await this.moduleLoader.loadFunction(content, file.basename);

      if (!func) {
        console.error(`Failed to load function from ${file.path}`);
        return null;
      }

      return { tool, func };
    } catch (error) {
      console.error(`Error loading tool from ${file.path}:`, error);
      return null;
    }
  }
}
```

#### `services/tools/JSDocParser.ts` (~100 lines)
```typescript
import { parse as parseComment } from 'comment-parser';
import { Tool } from '@modelcontextprotocol/sdk/types.js';

export class JSDocParser {
  parseToToolSchema(content: string, toolName: string): Tool {
    const comments = parseComment(content);
    const firstComment = comments[0];

    let description = 'No description available';
    const properties: Record<string, any> = {};
    const required: string[] = [];

    if (firstComment) {
      // Get description
      const descTag = firstComment.tags.find(tag => tag.tag === 'description');
      if (descTag) {
        description = `${descTag.name || ''} ${descTag.description || ''}`.trim();
      } else {
        description = firstComment.description || description;
      }

      // Process @param tags
      const paramTags = firstComment.tags.filter(tag => tag.tag === 'param');
      for (const param of paramTags) {
        if (param.name) {
          properties[param.name] = {
            ...this.mapTypeToJsonSchema(param.type),
            description: param.description || `${param.name} parameter`
          };

          // Required unless marked optional
          if (!param.description?.toLowerCase().includes('optional')) {
            required.push(param.name);
          }
        }
      }
    }

    return {
      name: toolName,
      description,
      inputSchema: {
        type: 'object',
        properties,
        required
      }
    };
  }

  private mapTypeToJsonSchema(type: string): any {
    if (!type) return { type: 'string' };

    const cleanType = type.trim();

    // Handle arrays
    if (cleanType.endsWith('[]')) {
      const itemType = cleanType.slice(0, -2);
      return {
        type: 'array',
        items: this.mapTypeToJsonSchema(itemType)
      };
    }

    // Handle unions
    if (cleanType.includes('|')) {
      const types = cleanType.split('|').map(t => t.trim());
      return {
        oneOf: types.map(t => this.mapTypeToJsonSchema(t))
      };
    }

    // Handle basic types
    const lowerType = cleanType.toLowerCase();
    switch (lowerType) {
      case 'string':
        return { type: 'string' };
      case 'number':
      case 'int':
      case 'integer':
        return { type: 'number' };
      case 'boolean':
      case 'bool':
        return { type: 'boolean' };
      case 'array':
        return { type: 'array' };
      case 'object':
        return { type: 'object' };
      default:
        return { type: 'string' };
    }
  }
}
```

---

### 4. Built-in Tools: `src/tools/`

#### `tools/index.ts`
```typescript
import { Tool } from '@modelcontextprotocol/sdk/types.js';
import { MCPPlugin } from '../main';
import { VaultTools } from './VaultTools';
import { SearchTools } from './SearchTools';
import { VectorTools } from './VectorTools';

export function createDefaultTools(plugin: MCPPlugin): Map<string, Tool> {
  const tools = new Map<string, Tool>();

  // Vault tools
  const vaultTools = new VaultTools(plugin);
  tools.set('get-active-file', vaultTools.getActiveFileTool());
  tools.set('create-note', vaultTools.createNoteTool());

  // Search tools
  const searchTools = new SearchTools(plugin);
  tools.set('search-notes', searchTools.searchNotesTool());
  tools.set('get-vault-stats', searchTools.getVaultStatsTool());

  // Vector tools (if enabled)
  if (plugin.settings.vectorSync.enabled) {
    const vectorTools = new VectorTools(plugin);
    tools.set('vector-search', vectorTools.vectorSearchTool());
    tools.set('vector-sync-status', vectorTools.syncStatusTool());
  }

  return tools;
}
```

#### `tools/VaultTools.ts`
```typescript
import { Tool, CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { normalizePath } from 'obsidian';

export class VaultTools {
  constructor(private plugin: MCPPlugin) {}

  getActiveFileTool(): Tool {
    return {
      name: 'get-active-file',
      description: 'Get the content of the currently active file',
      inputSchema: {
        type: 'object',
        properties: {},
        required: []
      }
    };
  }

  async executeGetActiveFile(): Promise<CallToolResult> {
    const activeFile = this.plugin.app.workspace.getActiveFile();

    if (!activeFile) {
      return {
        content: [{ type: 'text', text: 'No active file' }],
        isError: true
      };
    }

    const content = await this.plugin.app.vault.read(activeFile);
    return {
      content: [{
        type: 'text',
        text: `File: ${activeFile.path}\n\nContent:\n${content}`
      }]
    };
  }

  createNoteTool(): Tool {
    return {
      name: 'create-note',
      description: 'Create a new note in the vault',
      inputSchema: {
        type: 'object',
        properties: {
          title: { type: 'string', description: 'Note title' },
          content: { type: 'string', description: 'Note content' },
          folder: { type: 'string', description: 'Optional folder path' }
        },
        required: ['title', 'content']
      }
    };
  }

  async executeCreateNote(
    title: string,
    content: string,
    folder?: string
  ): Promise<CallToolResult> {
    try {
      const folderPath = folder || '';
      let filePath: string;

      if (folderPath) {
        const folderExists = this.plugin.app.vault.getAbstractFileByPath(folderPath);
        if (!folderExists) {
          await this.plugin.app.vault.createFolder(folderPath);
        }
        filePath = normalizePath(`${folderPath}/${title}.md`);
      } else {
        filePath = normalizePath(`${title}.md`);
      }

      const file = await this.plugin.app.vault.create(filePath, content);

      return {
        content: [{
          type: 'text',
          text: `Created note: ${file.path}`
        }]
      };
    } catch (error) {
      return {
        content: [{
          type: 'text',
          text: `Failed to create note: ${error.message}`
        }],
        isError: true
      };
    }
  }
}
```

---

### 5. UI Components: `src/ui/`

#### `ui/SettingTab.ts` (~100 lines)
```typescript
import { App, PluginSettingTab, Setting } from 'obsidian';
import { MCPPlugin } from '../main';
import { ServerSettings } from './sections/ServerSettings';
import { VectorSettings } from './sections/VectorSettings';
import { ToolsSettings } from './sections/ToolsSettings';

export class SettingTab extends PluginSettingTab {
  private serverSettings: ServerSettings;
  private vectorSettings: VectorSettings;
  private toolsSettings: ToolsSettings;

  constructor(app: App, private plugin: MCPPlugin) {
    super(app, plugin);

    this.serverSettings = new ServerSettings(plugin);
    this.vectorSettings = new VectorSettings(plugin);
    this.toolsSettings = new ToolsSettings(plugin);
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();

    containerEl.createEl('h2', { text: 'Obsidian MCP Macros' });

    // Render sections
    this.serverSettings.render(containerEl);
    this.vectorSettings.render(containerEl);
    this.toolsSettings.render(containerEl);
  }
}
```

#### `ui/sections/ServerSettings.ts`
```typescript
import { Setting } from 'obsidian';

export class ServerSettings {
  constructor(private plugin: MCPPlugin) {}

  render(containerEl: HTMLElement): void {
    containerEl.createEl('h3', { text: 'Server Configuration' });

    new Setting(containerEl)
      .setName('Enable MCP Server')
      .setDesc('Enable the MCP server functionality')
      .addToggle(toggle => toggle
        .setValue(this.plugin.settings.enabled)
        .onChange(async (value) => {
          this.plugin.settings.enabled = value;
          await this.plugin.saveSettings();

          if (value) {
            await this.plugin.startServices();
          } else {
            await this.plugin.stopServices();
          }
        })
      );

    // ... other server settings
  }
}
```

---

### 6. Utils: `src/utils/`

#### `utils/frontmatter.ts`
```typescript
export function parseFrontmatter(content: string): {
  metadata: Record<string, any>;
  body: string;
} {
  const frontmatterRegex = /^---\n([\s\S]*?)\n---\n/;
  const match = content.match(frontmatterRegex);

  if (match) {
    const metadata: Record<string, any> = {};
    const frontmatter = match[1];

    frontmatter.split('\n').forEach(line => {
      const [key, ...valueParts] = line.split(':');
      if (key && valueParts.length > 0) {
        metadata[key.trim()] = valueParts.join(':').trim();
      }
    });

    const body = content.slice(match[0].length);
    return { metadata, body };
  }

  return { metadata: {}, body: content };
}
```

---

## Migration Strategy

### Phase 1: Setup New Structure (Week 1)
1. Create new `src/` directory structure
2. Move type definitions to `src/types/`
3. Setup build configuration to compile from `src/`
4. Update imports in `main.ts`

### Phase 2: Extract Services (Week 2)
1. Extract VectorSyncManager → `services/vector/`
2. Extract HTTP server → `services/http/`
3. Extract tool loading → `services/tools/`
4. Update main.ts to use new services

### Phase 3: Extract UI (Week 3)
1. Extract settings UI → `ui/sections/`
2. Extract modals → `ui/components/`
3. Extract status bar → `ui/StatusBar.ts`

### Phase 4: Testing & Polish (Week 4)
1. Test all functionality still works
2. Add unit tests for services
3. Update documentation
4. Clean up any remaining code smells

---

## Benefits of This Structure

### Maintainability
- ✅ Clear separation of concerns
- ✅ Easy to find code (logical grouping)
- ✅ Small, focused files (~100-200 lines each)
- ✅ Easy to understand data flow

### Testability
- ✅ Services are isolated and testable
- ✅ Can mock dependencies easily
- ✅ Can test each component independently

### Scalability
- ✅ Easy to add new features
- ✅ New embedding providers → just add to `services/vector/providers/`
- ✅ New tools → just add to `tools/`
- ✅ New HTTP endpoints → just update handlers

### Code Reusability
- ✅ Services can be reused across plugin
- ✅ Utils can be shared
- ✅ Types ensure consistency

### Developer Experience
- ✅ Clear where to add new code
- ✅ Import paths make sense
- ✅ Easier for new contributors
- ✅ Better IDE autocomplete

---

## Build Configuration Updates

### `tsconfig.json`
```json
{
  "compilerOptions": {
    "target": "ES2020",
    "module": "ESNext",
    "moduleResolution": "node",
    "outDir": "dist",
    "rootDir": "src",
    "baseUrl": "src",
    "paths": {
      "@/*": ["*"]
    },
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "resolveJsonModule": true
  },
  "include": ["src/**/*"],
  "exclude": ["node_modules"]
}
```

### Root `main.ts` (export from src)
```typescript
// Re-export the plugin from src
export { default } from './src/main';
```

---

## Conclusion

This refactoring transforms a 2,500-line monolithic file into a well-organized, modular codebase following standard npm package conventions. Each file has a single responsibility, making the code easier to understand, test, and maintain.

**Estimated LOC after refactor**: ~3,000 lines total (20% increase in code, 500% increase in maintainability)

**Time to implement**: 3-4 weeks part-time

**Risk**: Low (incremental migration, can test at each phase)

**ROI**: High (easier to add features, fewer bugs, better DX)
