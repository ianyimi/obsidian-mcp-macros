import { App, Plugin, PluginSettingTab, Setting, normalizePath, Notice, TFile, AbstractInputSuggest, Modal } from 'obsidian';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import {
	CallToolRequestSchema,
	ListToolsRequestSchema,
	CallToolResult,
	Tool,
	JSONRPCMessage,
	JSONRPCRequest,
	JSONRPCResponse,
	JSONRPCNotification,
	InitializeRequestSchema,
	InitializedNotificationSchema
} from '@modelcontextprotocol/sdk/types.js';
import * as path from 'path';
import * as http from 'http';
import { parse as parseComment } from 'comment-parser';
import { QdrantClient } from '@qdrant/js-client-rest';

interface SyncRule {
	id: string;
	name: string;
	enabled: boolean;
	type: 'extension' | 'folder' | 'file' | 'pattern';
	pattern: string;
	exclude?: string[];
}

interface VectorSyncSettings {
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

interface MCPPluginSettings {
	toolsFolder: string;
	enabled: boolean;
	serverPort: number;
	serverHost: string;
	hotReloading: boolean;
	showStartupLogs: boolean;
	vectorSync: VectorSyncSettings;
}

const DEFAULT_SETTINGS: MCPPluginSettings = {
	toolsFolder: 'mcp-tools',
	enabled: false,
	serverPort: 3000,
	serverHost: 'localhost',
	hotReloading: true,
	showStartupLogs: false,
	vectorSync: {
		enabled: false,
		qdrantUrl: 'http://localhost:6333',
		collectionName: 'obsidian-vault',
		dimension: 1536,
		syncRules: [
			{
				id: 'all-markdown',
				name: 'All Markdown Files',
				enabled: true,
				type: 'extension',
				pattern: 'md',
				exclude: ['templates/**', 'archive/**']
			}
		],
		chunkSize: 1000,
		overlapSize: 200,
		embeddingModel: 'openai',
		showStatusBar: true,
		showProgressNotifications: true
	}
};

interface ChunkData {
	text: string;
	index: number;
	metadata: Record<string, any>;
}

interface VectorRecord {
	id: string;
	vector: number[];
	metadata: Record<string, any>;
}

class VectorSyncManager {
	private plugin: MCPPlugin;
	private app: App;
	private settings: VectorSyncSettings;
	private syncQueue: Set<string> = new Set();
	private currentNotice: Notice | null = null;
	private qdrantClient: QdrantClient | null = null;

	constructor(plugin: MCPPlugin) {
		this.plugin = plugin;
		this.app = plugin.app;
		this.settings = plugin.settings.vectorSync;
		this.initializeQdrantClient();
	}

	initializeQdrantClient() {
		if (!this.settings.enabled) return;
		
		try {
			const config: any = { url: this.settings.qdrantUrl };
			if (this.settings.qdrantApiKey) {
				config.apiKey = this.settings.qdrantApiKey;
			}
			this.qdrantClient = new QdrantClient(config);
			console.log('Qdrant client initialized');
		} catch (error) {
			console.error('Failed to initialize Qdrant client:', error);
		}
	}

	setupEventListeners() {
		if (!this.settings.enabled) return;

		console.log('Setting up vector sync event listeners');

		// File created
		this.plugin.registerEvent(
			this.app.vault.on('create', (file) => {
				if (file instanceof TFile && this.matchesSyncRules(file)) {
					console.log(`Vector sync: File created - ${file.path}`);
					this.indexFile(file);
				}
			})
		);

		// File modified (saved)
		this.plugin.registerEvent(
			this.app.vault.on('modify', (file) => {
				if (file instanceof TFile && this.matchesSyncRules(file)) {
					console.log(`Vector sync: File modified - ${file.path}`);
					this.indexFile(file);
				}
			})
		);

		// File deleted
		this.plugin.registerEvent(
			this.app.vault.on('delete', (file) => {
				if (file instanceof TFile && this.matchesSyncRules(file)) {
					console.log(`Vector sync: File deleted - ${file.path}`);
					this.removeFromIndex(file.path);
				}
			})
		);

		// File renamed
		this.plugin.registerEvent(
			this.app.vault.on('rename', (file, oldPath) => {
				if (file instanceof TFile && this.matchesSyncRules(file)) {
					console.log(`Vector sync: File renamed - ${oldPath} -> ${file.path}`);
					this.removeFromIndex(oldPath);
					this.indexFile(file);
				}
			})
		);
	}

	private matchesSyncRules(file: TFile): boolean {
		if (!this.settings.enabled) return false;

		for (const rule of this.settings.syncRules) {
			if (!rule.enabled) continue;

			const matches = this.evaluateRule(file, rule);
			if (matches) {
				// Check exclude patterns
				if (rule.exclude?.some(pattern => this.matchesPattern(file.path, pattern))) {
					continue;
				}
				return true;
			}
		}
		return false;
	}

	private evaluateRule(file: TFile, rule: SyncRule): boolean {
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
		// Simple glob pattern matching
		const regex = pattern
			.replace(/\*\*/g, '.*')
			.replace(/\*/g, '[^/]*')
			.replace(/\?/g, '.');
		return new RegExp(`^${regex}$`).test(filePath);
	}

	private async indexFile(file: TFile): Promise<void> {
		try {
			// Add to queue and update status
			this.syncQueue.add(file.path);
			this.plugin.updateStatusBar('syncing', { 
				current: 0, 
				total: this.syncQueue.size 
			});

			const content = await this.app.vault.read(file);
			const chunks = this.chunkContent(content, file);

			console.log(`Vector sync: Indexing ${chunks.length} chunks for ${file.path}`);

			// Show progress notification if enabled
			if (this.settings.showProgressNotifications) {
				this.showProgressNotification(file.basename, 0, chunks.length);
			}

			for (let i = 0; i < chunks.length; i++) {
				const chunk = chunks[i];
				const vector = await this.generateEmbedding(chunk.text);
				if (vector) {
					await this.upsertToVectorDb({
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

				// Update progress notification
				if (this.settings.showProgressNotifications) {
					this.updateProgressNotification(file.basename, i + 1, chunks.length);
				}
			}

			// Remove from queue and update status
			this.syncQueue.delete(file.path);
			if (this.syncQueue.size === 0) {
				this.plugin.updateStatusBar('ready');
				this.dismissProgressNotification();
			} else {
				this.plugin.updateStatusBar('syncing', { 
					current: 0, 
					total: this.syncQueue.size 
				});
			}

		} catch (error) {
			console.error(`Vector sync: Error indexing file ${file.path}:`, error);
			this.syncQueue.delete(file.path);
			this.plugin.updateStatusBar('error');
			this.dismissProgressNotification();
		}
	}

	private showProgressNotification(fileName: string, current: number, total: number) {
		if (this.currentNotice) {
			this.currentNotice.hide();
		}
		
		const message = `Vectorizing: ${fileName} (${current}/${total} chunks)`;
		this.currentNotice = new Notice(message, 0); // 0 = don't auto-dismiss
	}

	private updateProgressNotification(fileName: string, current: number, total: number) {
		if (this.currentNotice) {
			this.currentNotice.setMessage(`Vectorizing: ${fileName} (${current}/${total} chunks)`);
		}
	}

	private dismissProgressNotification() {
		if (this.currentNotice) {
			this.currentNotice.hide();
			this.currentNotice = null;
		}
	}

	private chunkContent(content: string, file: TFile): ChunkData[] {
		const chunks: ChunkData[] = [];
		const chunkSize = this.settings.chunkSize;
		const overlapSize = this.settings.overlapSize;

		// Extract frontmatter if it exists
		const frontmatterRegex = /^---\n([\s\S]*?)\n---\n/;
		const frontmatterMatch = content.match(frontmatterRegex);
		let metadata: Record<string, any> = {};
		let textContent = content;

		if (frontmatterMatch) {
			try {
				// Simple YAML parsing - in production you'd want a proper YAML parser
				const frontmatter = frontmatterMatch[1];
				frontmatter.split('\n').forEach(line => {
					const [key, ...valueParts] = line.split(':');
					if (key && valueParts.length > 0) {
						metadata[key.trim()] = valueParts.join(':').trim();
					}
				});
				textContent = content.slice(frontmatterMatch[0].length);
			} catch (error) {
				console.error('Error parsing frontmatter:', error);
			}
		}

		// Simple chunking by character count
		for (let i = 0; i < textContent.length; i += chunkSize - overlapSize) {
			const chunkText = textContent.slice(i, i + chunkSize);
			chunks.push({
				text: chunkText,
				index: Math.floor(i / (chunkSize - overlapSize)),
				metadata: {
					...metadata,
					fileExtension: file.extension,
					totalChunks: Math.ceil(textContent.length / (chunkSize - overlapSize))
				}
			});
		}

		return chunks;
	}

	private async generateEmbedding(text: string): Promise<number[] | null> {
		try {
			switch (this.settings.embeddingModel) {
				case 'openai':
					return await this.generateOpenAIEmbedding(text);
				case 'local':
					// Placeholder for local embedding
					console.warn('Local embedding not implemented yet');
					return null;
				case 'huggingface':
					// Placeholder for HuggingFace embedding
					console.warn('HuggingFace embedding not implemented yet');
					return null;
				default:
					return null;
			}
		} catch (error) {
			console.error('Error generating embedding:', error);
			return null;
		}
	}

	private async generateOpenAIEmbedding(text: string): Promise<number[] | null> {
		if (!this.settings.embeddingApiKey) {
			console.error('OpenAI API key not set for embeddings');
			return null;
		}

		try {
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
		} catch (error) {
			console.error('Error calling OpenAI embedding API:', error);
			return null;
		}
	}

	private async upsertToVectorDb(record: VectorRecord): Promise<void> {
		try {
			await this.upsertToQdrant(record);
		} catch (error) {
			console.error('Error upserting to Qdrant:', error);
		}
	}

	private async upsertToQdrant(record: VectorRecord): Promise<void> {
		if (!this.qdrantClient) {
			throw new Error('Qdrant client not initialized');
		}

		// Ensure collection exists
		await this.ensureCollection();

		// Upsert the point
		await this.qdrantClient.upsert(this.settings.collectionName, {
			points: [{
				id: record.id,
				vector: record.vector,
				payload: record.metadata
			}]
		});
	}

	private async ensureCollection(): Promise<void> {
		if (!this.qdrantClient) return;

		try {
			// Check if collection exists
			const collections = await this.qdrantClient.getCollections();
			const exists = collections.collections.some(
				col => col.name === this.settings.collectionName
			);

			if (!exists) {
				// Create collection
				await this.qdrantClient.createCollection(this.settings.collectionName, {
					vectors: {
						size: this.settings.dimension,
						distance: 'Cosine'
					}
				});
				console.log(`Created Qdrant collection: ${this.settings.collectionName}`);
			}
		} catch (error) {
			console.error('Error ensuring collection exists:', error);
		}
	}

	private async removeFromIndex(filePath: string): Promise<void> {
		try {
			await this.deleteFromQdrant(filePath);
		} catch (error) {
			console.error('Error removing from Qdrant:', error);
		}
	}

	private async deleteFromQdrant(filePath: string): Promise<void> {
		if (!this.qdrantClient) {
			throw new Error('Qdrant client not initialized');
		}

		// Search for all points with this file path and delete them
		try {
			const searchResult = await this.qdrantClient.search(this.settings.collectionName, {
				vector: new Array(this.settings.dimension).fill(0), // Dummy vector
				filter: {
					must: [{
						key: 'filePath',
						match: { value: filePath }
					}]
				},
				limit: 1000 // Large limit to get all chunks
			});

			const pointIds = searchResult.map(point => point.id);
			if (pointIds.length > 0) {
				await this.qdrantClient.delete(this.settings.collectionName, {
					points: pointIds
				});
				console.log(`Deleted ${pointIds.length} chunks for file: ${filePath}`);
			}
		} catch (error) {
			console.error('Error deleting from Qdrant:', error);
		}
	}

	async searchSimilar(query: string, limit: number = 10): Promise<any[]> {
		try {
			const queryVector = await this.generateEmbedding(query);
			if (!queryVector) {
				throw new Error('Failed to generate embedding for query');
			}

			return await this.searchQdrant(queryVector, limit);
		} catch (error) {
			console.error('Error searching Qdrant:', error);
			return [];
		}
	}

	private async searchQdrant(vector: number[], limit: number): Promise<any[]> {
		if (!this.qdrantClient) {
			throw new Error('Qdrant client not initialized');
		}

		const searchResult = await this.qdrantClient.search(this.settings.collectionName, {
			vector,
			limit,
			with_payload: true
		});

		return searchResult.map(result => ({
			id: result.id,
			score: result.score,
			metadata: result.payload,
			text: result.payload?.text || ''
		}));
	}

	async syncEntireVault(): Promise<void> {
		if (!this.settings.enabled) {
			throw new Error('Vector sync is not enabled');
		}

		console.log('Starting full vault sync...');
		this.plugin.updateStatusBar('syncing', { current: 0, total: 0 });

		// Get all files in the vault
		const allFiles = this.app.vault.getFiles();
		const filesToSync = allFiles.filter(file => this.matchesSyncRules(file));

		console.log(`Found ${filesToSync.length} files to sync out of ${allFiles.length} total files`);

		if (filesToSync.length === 0) {
			console.log('No files match sync rules');
			return;
		}

		// Show initial notification
		if (this.settings.showProgressNotifications) {
			new Notice(`Starting sync of ${filesToSync.length} files...`);
		}

		let processed = 0;
		for (const file of filesToSync) {
			try {
				console.log(`Syncing file ${processed + 1}/${filesToSync.length}: ${file.path}`);
				
				// Update status bar
				this.plugin.updateStatusBar('syncing', { 
					current: processed, 
					total: filesToSync.length 
				});

				await this.indexFile(file);
				processed++;

				// Show progress every 10 files
				if (this.settings.showProgressNotifications && processed % 10 === 0) {
					new Notice(`Synced ${processed}/${filesToSync.length} files...`);
				}
			} catch (error) {
				console.error(`Failed to sync file ${file.path}:`, error);
				// Continue with other files
			}
		}

		// Update final status
		this.plugin.updateStatusBar('ready', { current: processed, total: filesToSync.length });
		console.log(`Full vault sync completed: ${processed}/${filesToSync.length} files synced`);
	}

	async clearAllVectors(): Promise<void> {
		if (!this.qdrantClient) {
			throw new Error('Qdrant client not initialized');
		}

		console.log('Clearing all vectors from collection...');

		try {
			// Delete the entire collection and recreate it
			await this.qdrantClient.deleteCollection(this.settings.collectionName);
			console.log(`Deleted collection: ${this.settings.collectionName}`);
			
			// Recreate the collection
			await this.ensureCollection();
			console.log(`Recreated collection: ${this.settings.collectionName}`);
			
			// Update status bar to show empty state
			this.plugin.updateStatusBar('ready', { current: 0, total: 0 });
			
		} catch (error) {
			console.error('Error clearing vectors:', error);
			throw error;
		}
	}
}

export default class MCPPlugin extends Plugin {
	private httpServer: http.Server | null = null;
	private sessions: Map<string, {
		server: Server;
		lastActivity: number;
	}> = new Map();
	settings: MCPPluginSettings;
	loadedTools: Map<string, Tool> = new Map();
	private customToolFunctions: Map<string, Function> = new Map();
	private fileWatcher: any = null;
	private previousToolNames: Set<string> = new Set();
	private isStarting: boolean = true;
	vectorSyncManager: VectorSyncManager | null = null;
	private statusBarItem: HTMLElement | null = null;

	async onload() {
		console.log('Loading MCP Tools Plugin');
		await this.loadSettings();
		this.addSettingTab(new MCPSettingTab(this.app, this));

		// Always load tools on startup
		await this.loadToolsFromFolder();

		if (this.settings.enabled) {
			await this.initializeMCPServer();
			await this.startHTTPServer();
		}

		// Mark startup as complete BEFORE setting up file monitoring
		this.isStarting = false;

		// Set up directory monitoring for automatic tool reloading (if enabled)
		if (this.settings.hotReloading) {
			this.setupDirectoryMonitoring();
		}

		// Initialize vector sync manager
		this.vectorSyncManager = new VectorSyncManager(this);
		this.vectorSyncManager.setupEventListeners();

		// Setup status bar if enabled
		this.setupStatusBar();

		// Add command to toggle MCP server
		this.addCommand({
			id: 'toggle-mcp-server',
			name: 'Toggle MCP Server',
			callback: () => this.toggleMCPServer()
		});

		// Add command to reload tools
		this.addCommand({
			id: 'reload-mcp-tools',
			name: 'Reload MCP Tools',
			callback: () => this.reloadTools()
		});
	}

	async initializeMCPServer() {
		try {
			// Tools are already loaded in onload(), no need to reload here
			// Server will be created per session in HTTP transport
			if (!this.isStarting || this.settings.showStartupLogs) {
				new Notice('MCP Server initialized successfully');
			}
			console.log('MCP server initialized with tools:', Array.from(this.loadedTools.keys()));
		} catch (error) {
			console.error('Failed to initialize MCP server:', error);
			if (!this.isStarting || this.settings.showStartupLogs) {
				new Notice('Failed to initialize MCP server: ' + error.message);
			}
		}
	}

	private createServerInstance(): Server {
		const server = new Server({
			name: 'obsidian-vault-tools',
			version: '0.1.0'
		}, {
			capabilities: {
				tools: {}
			}
		});

		// Register list tools handler
		server.setRequestHandler(ListToolsRequestSchema, async () => {
			return {
				tools: Array.from(this.loadedTools.values())
			};
		});

		// Register call tool handler
		server.setRequestHandler(CallToolRequestSchema, async (request) => {
			return await this.callTool(request.params.name, request.params.arguments || {});
		});

		return server;
	}

	async toggleMCPServer() {
		this.settings.enabled = !this.settings.enabled;
		await this.saveSettings();

		if (this.settings.enabled) {
			// Tools are already loaded, just initialize and start server
			await this.initializeMCPServer();
			await this.startHTTPServer();
			if (!this.isStarting || this.settings.showStartupLogs) {
				new Notice('MCP Server enabled');
			}
		} else {
			this.shutdownServer();
			if (!this.isStarting || this.settings.showStartupLogs) {
				new Notice('MCP Server disabled');
			}
		}
	}

	async reloadTools() {
		if (this.settings.enabled) {
			await this.loadToolsFromFolder();
			if (!this.isStarting || this.settings.showStartupLogs) {
				new Notice(`Reloaded ${this.loadedTools.size} tools`);
			}
		} else {
			if (!this.isStarting || this.settings.showStartupLogs) {
				new Notice('MCP Server is not running');
			}
		}
	}

	async restartServer() {
		if (this.settings.enabled) {
			console.log('Restarting MCP Server...');

			// Save current tool names for comparison
			const previousTools = new Set(this.loadedTools.keys());

			// Gracefully shutdown and wait for port to be released
			await this.shutdownServerGracefully();

			await this.loadToolsFromFolder();
			await this.initializeMCPServer();
			await this.startHTTPServer();

			// Compare and notify about changes
			const currentTools = new Set(this.loadedTools.keys());
			const newTools = [...currentTools].filter(tool => !previousTools.has(tool));
			const removedTools = [...previousTools].filter(tool => !currentTools.has(tool));

			let noticeMessage = `MCP Server restarted with ${this.loadedTools.size} tools`;

			if (newTools.length > 0) {
				noticeMessage += `\n✅ Added: ${newTools.join(', ')}`;
			}

			if (removedTools.length > 0) {
				noticeMessage += `\n❌ Removed: ${removedTools.join(', ')}`;
			}

			// Only show notification if not starting up or if startup logs are enabled
			if (!this.isStarting || this.settings.showStartupLogs) {
				new Notice(noticeMessage);
			}
			console.log('Server restart complete:', { total: this.loadedTools.size, newTools, removedTools });
		}
	}

	async shutdownServerGracefully(): Promise<void> {
		return new Promise((resolve) => {
			// Close all session servers
			for (const [sessionId, session] of this.sessions) {
				try {
					session.server.close();
				} catch (error) {
					console.error(`Error closing session ${sessionId}:`, error);
				}
			}
			this.sessions.clear();

			if (this.httpServer) {
				this.httpServer.close((err) => {
					if (err) {
						console.error('Error closing HTTP server:', err);
					}
					this.httpServer = null;
					// Wait a bit for the port to be fully released
					setTimeout(resolve, 100);
				});
			} else {
				resolve();
			}
		});
	}

	shutdownServer() {
		// Close all session servers
		for (const [sessionId, session] of this.sessions) {
			try {
				session.server.close();
			} catch (error) {
				console.error(`Error closing session ${sessionId}:`, error);
			}
		}
		this.sessions.clear();

		if (this.httpServer) {
			this.httpServer.close();
			this.httpServer = null;
		}
	}

	async startHTTPServer() {
		try {
			this.httpServer = http.createServer(async (req, res) => {
				const url = new URL(req.url || '/', `http://${req.headers.host}`);

				// Handle CORS
				const corsHeaders = {
					'Access-Control-Allow-Origin': '*',
					'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
					'Access-Control-Allow-Headers': 'Content-Type, Authorization, Mcp-Session-Id, Mcp-Protocol-Version',
				};

				// Set CORS headers
				Object.entries(corsHeaders).forEach(([key, value]) => {
					res.setHeader(key, value);
				});

				if (req.method === 'OPTIONS') {
					res.writeHead(200);
					res.end();
					return;
				}

				try {
					// Log all incoming requests for debugging
					console.log(`[MCP Server] ${req.method} ${url.pathname} - Headers:`, req.headers);

					// Handle MCP Streamable HTTP Transport
					if (url.pathname === '/mcp' && req.method === 'POST') {
						const body = await this.getRequestBody(req);
						const response = await this.handleMCPRequest(body, corsHeaders);
						res.setHeader('Content-Type', 'application/json');
						res.writeHead(200);
						res.end(JSON.stringify(response));
						return;
					}

					// Legacy endpoints for external clients
					if (url.pathname === '/mcp/tools' && req.method === 'GET') {
						const tools = await this.getToolsList();
						res.setHeader('Content-Type', 'application/json');
						res.writeHead(200);
						res.end(JSON.stringify({ tools }));
						return;
					}

					if (url.pathname === '/mcp/call' && req.method === 'POST') {
						const body = await this.getRequestBody(req);
						const { name, arguments: args } = JSON.parse(body);
						const result = await this.executeToolExternal(name, args ?? {});
						res.setHeader('Content-Type', 'application/json');
						res.writeHead(200);
						res.end(JSON.stringify(result));
						return;
					}

					// OpenAPI spec endpoint
					if (url.pathname === '/openapi.json' && req.method === 'GET') {
						const spec = this.generateOpenAPIConfig();
						res.setHeader('Content-Type', 'application/json');
						res.writeHead(200);
						res.end(JSON.stringify(spec));
						return;
					}

					// Handle OpenAPI tool calls
					if (url.pathname.startsWith('/tools/') && req.method === 'POST') {
						const toolName = url.pathname.substring(7); // Remove '/tools/'
						console.log(`[MCP Server] Calling tool: ${toolName}`);
						const body = await this.getRequestBody(req);
						console.log(`[MCP Server] Tool args:`, body);

						// Handle empty body for tools with no parameters
						let args = {};
						if (body.trim()) {
							try {
								args = JSON.parse(body);
							} catch (error) {
								console.error('Failed to parse JSON body:', error);
								args = {};
							}
						}

						const result = await this.executeToolExternal(toolName, args);
						console.log(`[MCP Server] Tool result:`, result);
						res.setHeader('Content-Type', 'application/json');
						res.writeHead(200);
						res.end(JSON.stringify(result));
						return;
					}

					if (url.pathname === '/mcp/config' && req.method === 'GET') {
						const config = this.generateOpenAPIConfig();
						res.setHeader('Content-Type', 'application/json');
						res.writeHead(200);
						res.end(JSON.stringify(config));
						return;
					}

					// Default response
					res.writeHead(200);
					res.end('Obsidian MCP Server');
				} catch (error) {
					console.error('Error handling request:', error);
					res.setHeader('Content-Type', 'application/json');
					res.writeHead(500);
					res.end(JSON.stringify({
						error: 'Internal server error',
						message: error.message
					}));
				}
			});

			this.httpServer.listen(this.settings.serverPort, this.settings.serverHost, () => {
				console.log(`HTTP MCP Server started on ${this.settings.serverHost}:${this.settings.serverPort}`);
				if (!this.isStarting || this.settings.showStartupLogs) {
					new Notice(`HTTP MCP Server started on ${this.settings.serverHost}:${this.settings.serverPort}`);
				}
			});

			this.httpServer.on('error', (error) => {
				console.error('HTTP server error:', error);
				new Notice('HTTP server error: ' + error.message);
			});
		} catch (error) {
			console.error('Failed to start HTTP server:', error);
			new Notice('Failed to start HTTP server: ' + error.message);
		}
	}

	private async getRequestBody(req: http.IncomingMessage): Promise<string> {
		return new Promise((resolve, reject) => {
			let body = '';
			req.on('data', (chunk) => {
				body += chunk.toString();
			});
			req.on('end', () => {
				resolve(body);
			});
			req.on('error', (error) => {
				reject(error);
			});
		});
	}

	private async handleMCPRequest(bodyStr: string, corsHeaders: Record<string, string>): Promise<any> {
		try {
			const sessionId = this.generateSessionId();
			const protocolVersion = '2024-11-05';

			// Get or create session
			let session = this.sessions.get(sessionId);
			if (!session) {
				session = {
					server: this.createServerInstance(),
					lastActivity: Date.now()
				};
				this.sessions.set(sessionId, session);
			} else {
				session.lastActivity = Date.now();
			}

			const body = JSON.parse(bodyStr) as JSONRPCMessage;

			// Handle JSON-RPC message
			let response: any = null;

			if ('method' in body && body.method) {
				// Handle JSON-RPC request
				const request = body as JSONRPCRequest;

				try {
					let result: any;

					switch (request.method) {
						case 'initialize':
							result = {
								protocolVersion: '2024-11-05',
								capabilities: {
									tools: {}
								},
								serverInfo: {
									name: 'obsidian-vault-tools',
									version: '0.1.0'
								}
							};
							break;

						case 'tools/list':
							result = {
								tools: Array.from(this.loadedTools.values())
							};
							break;

						case 'tools/call':
							const { name, arguments: toolArgs } = request.params as any;
							result = await this.callTool(name, toolArgs || {});
							break;

						default:
							throw new Error(`Unknown method: ${request.method}`);
					}

					response = {
						jsonrpc: '2.0',
						id: request.id,
						result
					};
				} catch (error) {
					response = {
						jsonrpc: '2.0',
						id: request.id,
						error: {
							code: -32603,
							message: error.message
						}
					};
				}
			}

			// Clean up old sessions (older than 1 hour)
			this.cleanupSessions();

			return response;
		} catch (error) {
			return {
				jsonrpc: '2.0',
				error: {
					code: -32700,
					message: 'Parse error'
				}
			};
		}
	}

	private generateSessionId(): string {
		return Math.random().toString(36).substr(2, 9) + Date.now().toString(36);
	}

	private cleanupSessions(): void {
		const now = Date.now();
		const maxAge = 60 * 60 * 1000; // 1 hour

		for (const [sessionId, session] of this.sessions) {
			if (now - session.lastActivity > maxAge) {
				try {
					session.server.close();
				} catch (error) {
					console.error(`Error closing session ${sessionId}:`, error);
				}
				this.sessions.delete(sessionId);
			}
		}
	}

	onunload() {
		this.shutdownServer();
	}

	setupDirectoryMonitoring() {
		// Register vault event handlers for file changes
		this.registerEvent(
			this.app.vault.on('create', (file) => {
				if (file instanceof TFile && file.path.startsWith(this.settings.toolsFolder) && file.extension === 'js') {
					console.log(`New JS tool file detected: ${file.path}`);
					this.reloadToolsQuietly();
				}
			})
		);

		this.registerEvent(
			this.app.vault.on('modify', (file) => {
				if (file instanceof TFile && file.path.startsWith(this.settings.toolsFolder) && file.extension === 'js') {
					console.log(`JS tool file modified: ${file.path}`);
					this.reloadToolsQuietly();
				}
			})
		);

		this.registerEvent(
			this.app.vault.on('delete', (file) => {
				if (file instanceof TFile && file.path.startsWith(this.settings.toolsFolder) && file.extension === 'js') {
					console.log(`JS tool file deleted: ${file.path}`);
					this.reloadToolsQuietly();
				}
			})
		);

		this.registerEvent(
			this.app.vault.on('rename', (file, oldPath) => {
				if (file instanceof TFile && (file.path.startsWith(this.settings.toolsFolder) || oldPath.startsWith(this.settings.toolsFolder)) && file.extension === 'js') {
					console.log(`JS tool file renamed: ${oldPath} -> ${file.path}`);
					this.reloadToolsQuietly();
				}
			})
		);
	}

	private async reloadToolsQuietly() {
		try {
			if (this.settings.hotReloading && this.settings.enabled) {
				console.log('Hot reloading: Restarting server with updated tools...');
				await this.restartServer();
			} else {
				await this.loadToolsFromFolder();
				console.log(`Quietly reloaded ${this.loadedTools.size} tools`);
			}
		} catch (error) {
			console.error('Error quietly reloading tools:', error);
		}
	}

	async loadToolsFromFolder(): Promise<void> {
		this.loadedTools.clear();
		this.customToolFunctions.clear();

		try {
			const folderPath = this.settings.toolsFolder;
			const folder = this.app.vault.getAbstractFileByPath(folderPath);

			if (!folder) {
				console.log('Tools folder not found, creating default tools');
				await this.createToolsFolder();
				this.createDefaultTools();
				return;
			}

			const files = this.app.vault.getFiles().filter(file =>
				file.path.startsWith(folderPath) && file.extension === 'js'
			);

			for (const file of files) {
				await this.loadToolFromFile(file);
			}

			// Always add default tools
			this.createDefaultTools();

			console.log(`Loaded ${this.loadedTools.size} total tools`);
		} catch (error) {
			console.error('Error loading tools from folder:', error);
			this.createDefaultTools();
		}
	}

	async createToolsFolder(): Promise<void> {
		try {
			await this.app.vault.createFolder(this.settings.toolsFolder);

			// Create an example tool file
			const exampleTool = `/**
 * @description Get the current date and time
 * @param {string} format Optional format string (e.g., "YYYY-MM-DD")
 */
function getCurrentDateTime(params) {
    const now = new Date();
    if (params.format) {
        // Simple format handling - in a real implementation you'd use a date library
        return now.toLocaleDateString() + ' ' + now.toLocaleTimeString();
    }
    return now.toISOString();
}

// Export the function (required for MCP tools)
module.exports = getCurrentDateTime;`;

			await this.app.vault.create(
				path.join(this.settings.toolsFolder, 'example-tool.js'),
				exampleTool
			);
		} catch (error) {
			console.error('Error creating tools folder:', error);
		}
	}

	async loadToolFromFile(file: TFile): Promise<void> {
		try {
			const content = await this.app.vault.read(file);

			// Parse JSDoc comments using comment-parser
			const comments = parseComment(content);
			const firstComment = comments[0];

			let description = 'No description available';
			const properties: Record<string, any> = {};
			const required: string[] = [];

			if (firstComment) {
				// Get description from @description tag or general description
				const descTag = firstComment.tags.find(tag => tag.tag === 'description');
				if (descTag) {
					// Handle cases where description spans name and description fields
					const namePart = descTag.name || '';
					const descPart = descTag.description || '';
					description = namePart ? `${namePart} ${descPart}`.trim() : descPart;
				} else {
					description = firstComment.description || 'No description available';
				}

				// Process @param tags
				const paramTags = firstComment.tags.filter(tag => tag.tag === 'param');
				for (const param of paramTags) {
					if (param.name) {
						const typeSchema = this.mapTypeToJsonSchema(param.type);
						properties[param.name] = {
							...typeSchema,
							description: param.description || `${param.name} parameter`
						};

						// Mark as required unless description contains 'optional' (case insensitive)
						if (!param.description?.toLowerCase().includes('optional')) {
							required.push(param.name);
						}
					}
				}
			}

			const toolName = file.basename;

			const tool: Tool = {
				name: toolName,
				description: description,
				inputSchema: {
					type: 'object',
					properties,
					required
				}
			};

			// Load the function as a proper module
			const toolFunction = await this.loadToolModule(content, toolName);
			if (toolFunction) {
				this.customToolFunctions.set(toolName, toolFunction);
				this.loadedTools.set(toolName, tool);
				console.log(`Loaded custom tool: ${toolName}`);
			}
		} catch (error) {
			console.error(`Error loading tool from ${file.path}:`, error);
		}
	}

	mapTypeToJsonSchema(type: string): any {
		if (!type) return { type: 'string' };

		const cleanType = type.trim();

		// Handle array types (e.g., "string[]", "number[]")
		if (cleanType.endsWith('[]')) {
			const itemType = cleanType.slice(0, -2);
			return {
				type: 'array',
				items: this.mapTypeToJsonSchema(itemType)
			};
		}

		// Handle union types (e.g., "string|number")
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
			case 'null':
				return { type: 'null' };
			default:
				// For unknown types, default to string
				return { type: 'string' };
		}
	}

	createDefaultTools(): void {
		// Create built-in tools that demonstrate Obsidian integration
		this.loadedTools.set('get-active-file', {
			name: 'get-active-file',
			description: 'Get the content of the currently active file in Obsidian',
			inputSchema: {
				type: 'object',
				properties: {},
				required: []
			}
		});

		this.loadedTools.set('create-note', {
			name: 'create-note',
			description: 'Create a new note in Obsidian',
			inputSchema: {
				type: 'object',
				properties: {
					title: { type: 'string', description: 'The title of the note' },
					content: { type: 'string', description: 'The content of the note' },
					folder: { type: 'string', description: 'Optional folder path' }
				},
				required: ['title', 'content']
			}
		});

		this.loadedTools.set('search-notes', {
			name: 'search-notes',
			description: 'Search for notes in the vault by title',
			inputSchema: {
				type: 'object',
				properties: {
					query: { type: 'string', description: 'The search query' },
					limit: { type: 'number', description: 'Maximum number of results (default: 10)' }
				},
				required: ['query']
			}
		});

		this.loadedTools.set('get-vault-stats', {
			name: 'get-vault-stats',
			description: 'Get statistics about the current vault',
			inputSchema: {
				type: 'object',
				properties: {},
				required: []
			}
		});

		// Vector search tools (only if vector sync is enabled)
		if (this.settings.vectorSync.enabled) {
			this.loadedTools.set('vector-search', {
				name: 'vector-search',
				description: 'Search for semantically similar content in the vault using vector embeddings',
				inputSchema: {
					type: 'object',
					properties: {
						query: { type: 'string', description: 'The search query to find similar content' },
						limit: { type: 'number', description: 'Maximum number of results (default: 10)' }
					},
					required: ['query']
				}
			});

			this.loadedTools.set('vector-sync-status', {
				name: 'vector-sync-status',
				description: 'Get the current status of vector database synchronization',
				inputSchema: {
					type: 'object',
					properties: {},
					required: []
				}
			});
		}
	}

	async callTool(name: string, arguments_: Record<string, any>): Promise<CallToolResult> {
		try {
			switch (name) {
				case 'get-active-file':
					return await this.getActiveFileContent();

				case 'create-note':
					return await this.createNote(arguments_.title, arguments_.content, arguments_.folder);

				case 'search-notes':
					return await this.searchNotes(arguments_.query, arguments_.limit || 10);

				case 'get-vault-stats':
					return await this.getVaultStats();

				case 'vector-search':
					return await this.vectorSearch(arguments_.query, arguments_.limit || 10);

				case 'vector-sync-status':
					return await this.getVectorSyncStatus();

				default:
					// Try to execute custom tool from file
					return await this.executeCustomTool(name, arguments_);
			}
		} catch (error) {
			return {
				content: [{
					type: 'text',
					text: `Error executing tool ${name}: ${error.message}`
				}],
				isError: true
			};
		}
	}

	async getActiveFileContent(): Promise<CallToolResult> {
		const activeFile = this.app.workspace.getActiveFile();
		if (!activeFile) {
			return {
				content: [{ type: 'text', text: 'No active file' }],
				isError: true
			};
		}

		const content = await this.app.vault.read(activeFile);
		return {
			content: [{
				type: 'text',
				text: `File: ${activeFile.path}\n\nContent:\n${content}`
			}]
		};
	}

	async createNote(title: string, content: string, folder?: string): Promise<CallToolResult> {
		try {
			const folderPath = folder || '';
			let filePath: string;

			if (folderPath) {
				// Ensure folder exists
				const folderExists = this.app.vault.getAbstractFileByPath(folderPath);
				if (!folderExists) {
					await this.app.vault.createFolder(folderPath);
				}
				filePath = normalizePath(path.join(folderPath, `${title}.md`));
			} else {
				filePath = normalizePath(`${title}.md`);
			}

			const file = await this.app.vault.create(filePath, content);
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

	async searchNotes(query: string, limit = 10): Promise<CallToolResult> {
		const files = this.app.vault.getMarkdownFiles();
		const results = [];

		for (const file of files) {
			if (file.basename.toLowerCase().includes(query.toLowerCase())) {
				results.push({
					path: file.path,
					name: file.basename,
					folder: file.parent?.path || '/'
				});

				if (results.length >= limit) break;
			}
		}

		return {
			content: [{
				type: 'text',
				text: results.length > 0
					? `Found ${results.length} notes:\n${results.map(r => `- ${r.name} (${r.path})`).join('\n')}`
					: 'No notes found matching the query'
			}]
		};
	}

	async getVaultStats(): Promise<CallToolResult> {
		const files = this.app.vault.getAllLoadedFiles();
		const markdownFiles = files.filter(f => f instanceof TFile && f.extension === 'md');
		const otherFiles = files.filter(f => f instanceof TFile && f.extension !== 'md');
		const folders = files.filter(f => !(f instanceof TFile));

		return {
			content: [{
				type: 'text',
				text: `Vault Statistics:
- Total files: ${files.length}
- Markdown files: ${markdownFiles.length}
- Other files: ${otherFiles.length}
- Folders: ${folders.length}
- Vault name: ${this.app.vault.getName()}`
			}]
		};
	}

	async vectorSearch(query: string, limit = 10): Promise<CallToolResult> {
		// Double check that vector sync is enabled (tool shouldn't be available otherwise)
		if (!this.settings.vectorSync.enabled) {
			return {
				content: [{
					type: 'text',
					text: 'Vector sync is not enabled. Please enable it in the plugin settings.'
				}],
				isError: true
			};
		}

		if (!this.vectorSyncManager) {
			return {
				content: [{
					type: 'text',
					text: 'Vector search manager is not initialized'
				}],
				isError: true
			};
		}

		try {
			const results = await this.vectorSyncManager.searchSimilar(query, limit);
			
			if (results.length === 0) {
				return {
					content: [{
						type: 'text',
						text: `No similar content found for query: "${query}"`
					}]
				};
			}

			const formattedResults = results.map((result, index) => {
				const metadata = result.metadata || {};
				const score = result.score || 0;
				return `${index + 1}. **${metadata.fileName || 'Unknown'}** (Score: ${score.toFixed(3)})
   Path: ${metadata.filePath || 'Unknown'}
   Chunk: ${metadata.chunkIndex || 0}/${metadata.totalChunks || 1}
   Last Modified: ${metadata.lastModified ? new Date(metadata.lastModified).toLocaleDateString() : 'Unknown'}`;
			}).join('\n\n');

			return {
				content: [{
					type: 'text',
					text: `Found ${results.length} similar content chunks for query: "${query}"\n\n${formattedResults}`
				}]
			};
		} catch (error) {
			return {
				content: [{
					type: 'text',
					text: `Error performing vector search: ${error.message}`
				}],
				isError: true
			};
		}
	}

	async getVectorSyncStatus(): Promise<CallToolResult> {
		if (!this.vectorSyncManager) {
			return {
				content: [{
					type: 'text',
					text: 'Vector sync manager is not initialized'
				}],
				isError: true
			};
		}

		const settings = this.settings.vectorSync;
		const enabledRules = settings.syncRules.filter(rule => rule.enabled);
		
		let statusText = `**Vector Database Sync Status**

**Configuration:**
- Enabled: ${settings.enabled ? '✅ Yes' : '❌ No'}
- Database: Qdrant
- Embedding Model: ${settings.embeddingModel}
- Chunk Size: ${settings.chunkSize} characters
- Overlap Size: ${settings.overlapSize} characters

**Sync Rules:**
${enabledRules.length > 0 ? 
	enabledRules.map(rule => `- ${rule.name}: ${rule.type} "${rule.pattern}"${rule.exclude ? ` (excludes: ${rule.exclude.join(', ')})` : ''}`).join('\n') :
	'No active sync rules'
}

**Qdrant Connection:**
- URL: ${settings.qdrantUrl}
- Collection: ${settings.collectionName}
- Dimension: ${settings.dimension}
- API Key: ${settings.qdrantApiKey ? '✅ Set' : '❌ Not set'}`;

		if (settings.embeddingModel === 'openai' && !settings.embeddingApiKey) {
			statusText += '\n❌ OpenAI API key not configured';
		}

		return {
			content: [{
				type: 'text',
				text: statusText
			}]
		};
	}

	async executeCustomTool(name: string, arguments_: Record<string, any>): Promise<CallToolResult> {
		const toolFunction = this.customToolFunctions.get(name);
		if (!toolFunction) {
			return {
				content: [{
					type: 'text',
					text: `Custom tool ${name} not found`
				}],
				isError: true
			};
		}

		try {
			// Simply call the function with arguments - clean and simple!
			const result = await toolFunction(arguments_);

			return {
				content: [{
					type: 'text',
					text: JSON.stringify(result)
				}],
				structuredContent: typeof result === 'object' ? result : undefined
			};
		} catch (error) {
			return {
				content: [{
					type: 'text',
					text: `Error executing custom tool ${name}: ${error.message}`
				}],
				isError: true
			};
		}
	}

	private async loadToolModule(content: string, toolName: string): Promise<Function | null> {
		try {
			// Create a data URL with the module content
			const moduleContent = `
// Obsidian APIs are available via the global plugin context
const app = window.obsidianApp;
const vault = window.obsidianVault; 
const workspace = window.obsidianWorkspace;

${content}

// Export the function
export default (typeof module !== 'undefined' && module.exports) || 
               (typeof exports !== 'undefined' && exports.default) ||
               getCurrentDateTime; // fallback for simple function declarations
`;

			// Set global context
			(window as any).obsidianApp = this.app;
			(window as any).obsidianVault = this.app.vault;
			(window as any).obsidianWorkspace = this.app.workspace;

			// Create blob URL and import
			const blob = new Blob([moduleContent], { type: 'application/javascript' });
			const moduleUrl = URL.createObjectURL(blob);

			try {
				const module = await import(moduleUrl);
				const exportedFunction = module.default;

				if (typeof exportedFunction === 'function') {
					console.log(`Successfully loaded tool module: ${toolName}`);
					return exportedFunction;
				} else {
					console.error(`Tool ${toolName} does not export a function, got:`, typeof exportedFunction);
					return null;
				}
			} finally {
				// Clean up the blob URL
				URL.revokeObjectURL(moduleUrl);
			}
		} catch (error) {
			console.error(`Failed to load tool module ${toolName}:`, error);
			return null;
		}
	}

	async loadSettings() {
		this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
	}

	async saveSettings() {
		await this.saveData(this.settings);
	}

	setupStatusBar() {
		if (this.settings.vectorSync.enabled && this.settings.vectorSync.showStatusBar) {
			if (!this.statusBarItem) {
				this.statusBarItem = this.addStatusBarItem();
			}
			this.updateStatusBar('ready');
		} else {
			if (this.statusBarItem) {
				this.statusBarItem.remove();
				this.statusBarItem = null;
			}
		}
	}

	updateStatusBar(status: 'ready' | 'syncing' | 'error', progress?: { current: number; total: number }) {
		if (!this.statusBarItem || !this.settings.vectorSync.showStatusBar) return;

		let text = 'Vector: ';
		switch (status) {
			case 'ready':
				text += '✅ Ready';
				break;
			case 'syncing':
				if (progress) {
					text += `⏳ Syncing ${progress.current}/${progress.total}`;
				} else {
					text += '⏳ Syncing...';
				}
				break;
			case 'error':
				text += '❌ Error';
				break;
		}

		this.statusBarItem.setText(text);
	}

	// Method to get active sessions count
	getActiveSessionsCount(): number {
		return this.sessions.size;
	}

	// Method to get tool list for external clients
	async getToolsList(): Promise<Tool[]> {
		return Array.from(this.loadedTools.values());
	}

	// Method to call tools from external clients
	async executeToolExternal(name: string, arguments_: Record<string, any>): Promise<CallToolResult> {
		return await this.callTool(name, arguments_);
	}

	// Generate MCP client configuration JSON
	generateMCPClientConfig(): string {
		const config = {
			mcpServers: {
				"obsidian-vault-tools": {
					transport: {
						type: "http",
						url: `http://${this.settings.serverHost}:${this.settings.serverPort}/mcp`,
						headers: {
							"Mcp-Protocol-Version": "2024-11-05"
						}
					},
					description: "Obsidian vault tools via MCP HTTP transport"
				}
			}
		};

		return JSON.stringify(config, null, 2);
	}

	// Generate OpenAPI spec for Open WebUI
	generateOpenAPIConfig(): object {
		const tools = Array.from(this.loadedTools.values());

		const paths: Record<string, any> = {};
		const components = {
			schemas: {} as Record<string, any>
		};

		// Convert each MCP tool to an OpenAPI endpoint
		tools.forEach(tool => {
			const operationId = tool.name; // Keep original name with dots and hyphens
			const schemaName = `${tool.name.replace(/[^a-zA-Z0-9]/g, '_')}Request`; // Schema names need to be valid identifiers

			// Create schema for the tool's input
			components.schemas[schemaName] = {
				type: 'object',
				properties: tool.inputSchema.properties || {},
				required: tool.inputSchema.required || []
			};

			// Check if tool has any parameters
			const hasParameters = Object.keys(tool.inputSchema.properties || {}).length > 0;

			// Create the path for this tool
			const pathConfig: any = {
				post: {
					summary: tool.description,
					description: tool.description,
					operationId: operationId,
				}
			};

			// Only add requestBody if the tool has parameters
			if (hasParameters) {
				pathConfig.post.requestBody = {
					required: tool.inputSchema.required && tool.inputSchema.required.length > 0,
					content: {
						'application/json': {
							schema: {
								$ref: `#/components/schemas/${schemaName}`
							}
						}
					}
				};
			}

			pathConfig.post.responses = {
				'200': {
					description: 'Tool execution result',
					content: {
						'application/json': {
							schema: {
								type: 'object',
								properties: {
									content: {
										type: 'array',
										items: {
											type: 'object',
											properties: {
												type: { type: 'string' },
												text: { type: 'string' }
											}
										}
									},
									isError: { type: 'boolean' }
								}
							}
						}
					}
				}
			};

			paths[`/tools/${tool.name}`] = pathConfig;
		});

		return {
			openapi: '3.0.0',
			info: {
				title: 'Obsidian Vault Tools',
				description: 'Obsidian MCP server with custom tools',
				version: '0.1.0'
			},
			servers: [{
				url: `http://${this.settings.serverHost}:${this.settings.serverPort}`,
				description: 'Local Obsidian MCP Server'
			}],
			paths,
			components
		};
	}

	// Generate simple MCP client config for testing
	generateSimpleMCPConfig(): object {
		return {
			name: "obsidian-vault-tools",
			description: "Obsidian MCP server with custom tools",
			version: "0.1.0",
			protocolVersion: "2024-11-05",
			transport: {
				type: "http",
				url: `http://${this.settings.serverHost}:${this.settings.serverPort}/mcp`,
				headers: {
					"Mcp-Protocol-Version": "2024-11-05"
				}
			},
			capabilities: {
				tools: {}
			},
			tools: Array.from(this.loadedTools.values()).map(tool => ({
				name: tool.name,
				description: tool.description,
				inputSchema: tool.inputSchema
			}))
		};
	}
}

class MCPSettingTab extends PluginSettingTab {
	plugin: MCPPlugin;

	constructor(app: App, plugin: MCPPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display(): void {
		const { containerEl } = this;
		containerEl.empty();

		containerEl.createEl('h2', { text: 'Obsidian MCP Macros Plugin' });

		new Setting(containerEl)
			.setName('Enable MCP Server')
			.setDesc('Enable the MCP server functionality')
			.addToggle((toggle) =>
				toggle
					.setValue(this.plugin.settings.enabled)
					.onChange(async (value) => {
						this.plugin.settings.enabled = value;
						await this.plugin.saveSettings();

						if (value) {
							await this.plugin.initializeMCPServer();
						} else {
							this.plugin.shutdownServer();
						}
					})
			);

		new Setting(containerEl)
			.setName('Tools Folder')
			.setDesc('Folder in vault where custom tool .js files are stored')
			.addSearch(search => {
				search
					.setPlaceholder('mcp-tools')
					.setValue(this.plugin.settings.toolsFolder)
					.onChange(async (value) => {
						this.plugin.settings.toolsFolder = value;
						await this.plugin.saveSettings();

						// Reload tools if server is running
						if (this.plugin.settings.enabled) {
							await this.plugin.loadToolsFromFolder();
						}
					});

				// Add folder suggestions
				new FolderSuggest(this.app, search.inputEl);
			});

		// Server configuration section
		containerEl.createEl('h3', { text: 'Server Configuration' });

		new Setting(containerEl)
			.setName('Server Host')
			.setDesc('Host address for the MCP server (default: localhost)')
			.addText(text => text
				.setPlaceholder('localhost')
				.setValue(this.plugin.settings.serverHost)
				.onChange(async (value) => {
					this.plugin.settings.serverHost = value || 'localhost';
					await this.plugin.saveSettings();
				}));

		new Setting(containerEl)
			.setName('Server Port')
			.setDesc('Port number for the MCP server (default: 3000)')
			.addText(text => text
				.setPlaceholder('3000')
				.setValue(this.plugin.settings.serverPort.toString())
				.onChange(async (value) => {
					const port = parseInt(value) || 3000;
					this.plugin.settings.serverPort = port;
					await this.plugin.saveSettings();
				}));

		// Hot reloading toggle
		new Setting(containerEl)
			.setName('Hot Reloading')
			.setDesc('Automatically restart server when tool files are modified')
			.addToggle((toggle) =>
				toggle
					.setValue(this.plugin.settings.hotReloading)
					.onChange(async (value) => {
						this.plugin.settings.hotReloading = value;
						await this.plugin.saveSettings();

						if (value && this.plugin.settings.enabled) {
							// Enable file monitoring
							this.plugin.setupDirectoryMonitoring();
							new Notice('Hot reloading enabled');
						} else {
							new Notice('Hot reloading disabled');
						}
					})
			);

		// Show startup logs toggle
		new Setting(containerEl)
			.setName('Show Startup Logs')
			.setDesc('Show notifications when MCP server starts up')
			.addToggle((toggle) =>
				toggle
					.setValue(this.plugin.settings.showStartupLogs)
					.onChange(async (value) => {
						this.plugin.settings.showStartupLogs = value;
						await this.plugin.saveSettings();
					})
			);

		// Manual reload tools button
		new Setting(containerEl)
			.setName('Reload Tools')
			.setDesc('Manually restart server with updated tools from the folder')
			.addButton((button) =>
				button
					.setButtonText('Restart Server')
					.setClass('mod-cta')
					.onClick(async () => {
						if (this.plugin.settings.enabled) {
							await this.plugin.restartServer();
						} else {
							new Notice('MCP Server is not running');
						}
					})
			);

		// MCP Client Configuration section
		containerEl.createEl('h3', { text: 'MCP Client Configuration' });

		containerEl.createEl('p', {
			text: 'Generate MCP client configuration to connect external clients like Ollama or other LLM tools to your Obsidian vault.'
		});

		new Setting(containerEl)
			.setName('Generate MCP Client Config')
			.setDesc('Generate JSON configuration for external MCP clients')
			.addButton((button) =>
				button
					.setButtonText('Generate & Copy')
					.onClick(async () => {
						try {
							const config = this.plugin.generateMCPClientConfig();
							await navigator.clipboard.writeText(config);
							new Notice('MCP client configuration copied to clipboard!');
						} catch (error) {
							new Notice('Failed to copy configuration: ' + error.message);
						}
					})
			)
			.addButton((button) =>
				button
					.setButtonText('Show Config')
					.onClick(async () => {
						const config = this.plugin.generateMCPClientConfig();
						const modal = new ConfigDisplayModal(this.app, config);
						modal.open();
					})
			);

		new Setting(containerEl)
			.setName('Generate OpenAPI Config')
			.setDesc('Generate OpenAPI specification for Open WebUI')
			.addButton((button) =>
				button
					.setButtonText('Generate & Copy')
					.onClick(async () => {
						try {
							const config = JSON.stringify(this.plugin.generateOpenAPIConfig(), null, 2);
							await navigator.clipboard.writeText(config);
							new Notice('OpenAPI configuration copied to clipboard!');
						} catch (error) {
							new Notice('Failed to copy configuration: ' + error.message);
						}
					})
			);

		// Vector Database Sync section
		containerEl.createEl('h3', { text: 'Vector Database Sync' });

		new Setting(containerEl)
			.setName('Enable Vector Sync')
			.setDesc('Enable automatic synchronization of vault content to vector database for semantic search')
			.addToggle((toggle) =>
				toggle
					.setValue(this.plugin.settings.vectorSync.enabled)
					.onChange(async (value) => {
						this.plugin.settings.vectorSync.enabled = value;
						await this.plugin.saveSettings();
						
						if (value && this.plugin.vectorSyncManager) {
							this.plugin.vectorSyncManager.setupEventListeners();
						}
						
						// Update status bar and tools
						this.plugin.setupStatusBar();
						await this.plugin.loadToolsFromFolder(); // Refresh tools to include/exclude vector tools
						
						// Refresh the display to show/hide dependent settings
						this.display();
					})
			);

		if (this.plugin.settings.vectorSync.enabled) {
			new Setting(containerEl)
				.setName('Qdrant URL')
				.setDesc('URL of your Qdrant instance')
				.addText(text => text
					.setPlaceholder('http://localhost:6333')
					.setValue(this.plugin.settings.vectorSync.qdrantUrl)
					.onChange(async (value) => {
						this.plugin.settings.vectorSync.qdrantUrl = value || 'http://localhost:6333';
						await this.plugin.saveSettings();
						// Reinitialize client with new URL
						if (this.plugin.vectorSyncManager) {
							this.plugin.vectorSyncManager.initializeQdrantClient();
						}
					}));

			new Setting(containerEl)
				.setName('Qdrant API Key')
				.setDesc('Your Qdrant API key (optional for local instances)')
				.addText(text => text
					.setPlaceholder('qdrant-api-key')
					.setValue(this.plugin.settings.vectorSync.qdrantApiKey || '')
					.onChange(async (value) => {
						this.plugin.settings.vectorSync.qdrantApiKey = value;
						await this.plugin.saveSettings();
						// Reinitialize client with new API key
						if (this.plugin.vectorSyncManager) {
							this.plugin.vectorSyncManager.initializeQdrantClient();
						}
					}));

			new Setting(containerEl)
				.setName('Collection Name')
				.setDesc('Name of the Qdrant collection to store vectors')
				.addText(text => text
					.setPlaceholder('obsidian-vault')
					.setValue(this.plugin.settings.vectorSync.collectionName)
					.onChange(async (value) => {
						this.plugin.settings.vectorSync.collectionName = value || 'obsidian-vault';
						await this.plugin.saveSettings();
					}));

			new Setting(containerEl)
				.setName('Vector Dimension')
				.setDesc('Dimension of the vectors (must match your embedding model)')
				.addText(text => text
					.setPlaceholder('1536')
					.setValue(this.plugin.settings.vectorSync.dimension.toString())
					.onChange(async (value) => {
						const dim = parseInt(value) || 1536;
						this.plugin.settings.vectorSync.dimension = dim;
						await this.plugin.saveSettings();
					}));

			new Setting(containerEl)
				.setName('Embedding Model')
				.setDesc('Choose the embedding model for generating vectors')
				.addDropdown((dropdown) =>
					dropdown
						.addOption('openai', 'OpenAI (text-embedding-3-small)')
						.addOption('local', 'Local Model (Not implemented)')
						.addOption('huggingface', 'HuggingFace (Not implemented)')
						.setValue(this.plugin.settings.vectorSync.embeddingModel)
						.onChange(async (value: any) => {
							this.plugin.settings.vectorSync.embeddingModel = value;
							await this.plugin.saveSettings();
							this.display(); // Refresh to show relevant API key settings
						})
				);

			if (this.plugin.settings.vectorSync.embeddingModel === 'openai') {
				new Setting(containerEl)
					.setName('OpenAI API Key')
					.setDesc('Your OpenAI API key for generating embeddings')
					.addText(text => text
						.setPlaceholder('sk-...')
						.setValue(this.plugin.settings.vectorSync.embeddingApiKey || '')
						.onChange(async (value) => {
							this.plugin.settings.vectorSync.embeddingApiKey = value;
							await this.plugin.saveSettings();
						}));
			}

			new Setting(containerEl)
				.setName('Chunk Size')
				.setDesc('Number of characters per chunk when splitting documents')
				.addText(text => text
					.setPlaceholder('1000')
					.setValue(this.plugin.settings.vectorSync.chunkSize.toString())
					.onChange(async (value) => {
						const size = parseInt(value) || 1000;
						this.plugin.settings.vectorSync.chunkSize = size;
						await this.plugin.saveSettings();
					}));

			new Setting(containerEl)
				.setName('Overlap Size')
				.setDesc('Number of characters to overlap between chunks')
				.addText(text => text
					.setPlaceholder('200')
					.setValue(this.plugin.settings.vectorSync.overlapSize.toString())
					.onChange(async (value) => {
						const size = parseInt(value) || 200;
						this.plugin.settings.vectorSync.overlapSize = size;
						await this.plugin.saveSettings();
					}));

			// UI Settings section
			containerEl.createEl('h4', { text: 'Display Options' });

			new Setting(containerEl)
				.setName('Show Status Bar')
				.setDesc('Display vector sync status in the status bar')
				.addToggle((toggle) =>
					toggle
						.setValue(this.plugin.settings.vectorSync.showStatusBar)
						.onChange(async (value) => {
							this.plugin.settings.vectorSync.showStatusBar = value;
							await this.plugin.saveSettings();
							this.plugin.setupStatusBar(); // Update status bar immediately
						})
				);

			new Setting(containerEl)
				.setName('Show Progress Notifications')
				.setDesc('Display notifications with progress when files are being vectorized')
				.addToggle((toggle) =>
					toggle
						.setValue(this.plugin.settings.vectorSync.showProgressNotifications)
						.onChange(async (value) => {
							this.plugin.settings.vectorSync.showProgressNotifications = value;
							await this.plugin.saveSettings();
						})
				);

			// Sync Rules section
			containerEl.createEl('h4', { text: 'Sync Rules' });
			containerEl.createEl('p', { 
				text: 'Configure which files should be synchronized to your vector database. Rules are evaluated in order and the first matching rule determines if a file is synced.' 
			});

			// Display existing sync rules
			this.plugin.settings.vectorSync.syncRules.forEach((rule, index) => {
				const ruleContainer = containerEl.createDiv({ cls: 'sync-rule-container' });
				
				new Setting(ruleContainer)
					.setName(`${rule.name} (${rule.type}: ${rule.pattern})`)
					.setDesc(`Enabled: ${rule.enabled ? 'Yes' : 'No'}${rule.exclude ? ` | Excludes: ${rule.exclude.join(', ')}` : ''}`)
					.addToggle((toggle) =>
						toggle
							.setValue(rule.enabled)
							.onChange(async (value) => {
								this.plugin.settings.vectorSync.syncRules[index].enabled = value;
								await this.plugin.saveSettings();
							})
					)
					.addButton((button) =>
						button
							.setButtonText('Remove')
							.setClass('mod-warning')
							.onClick(async () => {
								this.plugin.settings.vectorSync.syncRules.splice(index, 1);
								await this.plugin.saveSettings();
								this.display(); // Refresh to update the list
							})
					);
			});

			// Add new sync rule
			new Setting(containerEl)
				.setName('Add Sync Rule')
				.setDesc('Add a new rule to control which files are synchronized')
				.addButton((button) =>
					button
						.setButtonText('Add Rule')
						.setClass('mod-cta')
						.onClick(() => {
							// Simple rule addition - in a full implementation you'd want a modal
							const newRule: SyncRule = {
								id: Date.now().toString(),
								name: 'New Rule',
								enabled: true,
								type: 'extension',
								pattern: 'md',
								exclude: []
							};
							this.plugin.settings.vectorSync.syncRules.push(newRule);
							this.plugin.saveSettings().then(() => this.display());
						})
				);

			// Quick toggles section
			containerEl.createEl('h4', { text: 'Quick Options' });

			new Setting(containerEl)
				.setName('Sync Only Markdown Files')
				.setDesc('Enable to only sync .md files, disable to use custom sync rules above')
				.addToggle((toggle) =>
					toggle
						.setValue(this.plugin.settings.vectorSync.syncRules.length === 1 && 
								  this.plugin.settings.vectorSync.syncRules[0].type === 'extension' &&
								  this.plugin.settings.vectorSync.syncRules[0].pattern === 'md' &&
								  this.plugin.settings.vectorSync.syncRules[0].enabled)
						.onChange(async (value) => {
							if (value) {
								// Set to markdown only
								this.plugin.settings.vectorSync.syncRules = [{
									id: 'markdown-only',
									name: 'Markdown Files Only',
									enabled: true,
									type: 'extension',
									pattern: 'md',
									exclude: []
								}];
							} else {
								// Reset to default rules (or keep existing if user has customized)
								if (this.plugin.settings.vectorSync.syncRules.length === 1 && 
									this.plugin.settings.vectorSync.syncRules[0].id === 'markdown-only') {
									this.plugin.settings.vectorSync.syncRules = [{
										id: 'all-markdown',
										name: 'All Markdown Files',
										enabled: true,
										type: 'extension',
										pattern: 'md',
										exclude: ['templates/**', 'archive/**']
									}];
								}
							}
							await this.plugin.saveSettings();
							this.display(); // Refresh to show updated rules
						})
				);

			// Manual sync controls
			containerEl.createEl('h4', { text: 'Manual Sync Controls' });

			new Setting(containerEl)
				.setName('Sync Entire Vault')
				.setDesc('Manually sync all files in your vault that match the sync rules to the vector database')
				.addButton((button) =>
					button
						.setButtonText('Start Full Sync')
						.setClass('mod-cta')
						.onClick(async () => {
							if (!this.plugin.vectorSyncManager) {
								new Notice('Vector sync manager not initialized');
								return;
							}

							button.setButtonText('Syncing...');
							button.setDisabled(true);

							try {
								await this.plugin.vectorSyncManager.syncEntireVault();
								new Notice('Vault sync completed successfully!');
							} catch (error) {
								new Notice(`Sync failed: ${error.message}`);
								console.error('Vault sync error:', error);
							} finally {
								button.setButtonText('Start Full Sync');
								button.setDisabled(false);
							}
						})
				)
				.addButton((button) =>
					button
						.setButtonText('Clear All Vectors')
						.setClass('mod-warning')
						.onClick(async () => {
							if (!this.plugin.vectorSyncManager) {
								new Notice('Vector sync manager not initialized');
								return;
							}

							const confirmed = confirm('Are you sure you want to clear all vectors from the database? This cannot be undone.');
							if (!confirmed) return;

							button.setButtonText('Clearing...');
							button.setDisabled(true);

							try {
								await this.plugin.vectorSyncManager.clearAllVectors();
								new Notice('All vectors cleared successfully!');
							} catch (error) {
								new Notice(`Clear failed: ${error.message}`);
								console.error('Clear vectors error:', error);
							} finally {
								button.setButtonText('Clear All Vectors');
								button.setDisabled(false);
							}
						})
				);
		}

		containerEl.createEl('h3', { text: 'Tool Status' });

		if (this.plugin.settings.enabled) {
			const toolsList = Array.from(this.plugin.loadedTools.keys());
			containerEl.createEl('p', {
				text: `HTTP MCP Server running with ${toolsList.length} tools: ${toolsList.join(', ')}`
			});
			containerEl.createEl('p', {
				text: `Server URL: http://${this.plugin.settings.serverHost}:${this.plugin.settings.serverPort}/mcp`
			});
		} else {
			containerEl.createEl('p', { text: 'MCP Server not running' });
		}

		containerEl.createEl('h3', { text: 'Instructions' });
		containerEl.createEl('p', {
			text: 'This plugin creates a local MCP server within Obsidian that exposes your custom JavaScript tools. You can connect to it using any MCP client by accessing the plugin\'s server instance.'
		});
		containerEl.createEl('p', {
			text: 'Create .js files in the tools folder with JSDoc comments to define custom tools. Example:'
		});
		containerEl.createEl('pre', {
			text: `/**
 * @description Get the current date and time
 * @param {string} format - Optional format string
 */
function getCurrentDateTime(params) {
    const now = new Date();
    return moment(now).format(params?.format)
}

module.exports = getCurrentDateTime;`
		});
	}
}

class FolderSuggest extends AbstractInputSuggest<string> {
	private folders: string[];
	private inputElement: HTMLInputElement;

	constructor(app: App, inputEl: HTMLInputElement) {
		super(app, inputEl);
		this.inputElement = inputEl;
		// Get all folders and include root folder
		this.folders = ["/"].concat(this.app.vault.getAllFolders().map(folder => folder.path));
	}

	getSuggestions(inputStr: string): string[] {
		const inputLower = inputStr.toLowerCase();
		return this.folders.filter(folder =>
			folder.toLowerCase().includes(inputLower)
		);
	}

	renderSuggestion(folder: string, el: HTMLElement): void {
		el.createEl("div", { text: folder });
	}

	selectSuggestion(folder: string): void {
		this.inputElement.value = folder;
		const event = new Event('input');
		this.inputElement.dispatchEvent(event);
		this.close();
	}
}

class ConfigDisplayModal extends Modal {
	private config: string;

	constructor(app: App, config: string) {
		super(app);
		this.config = config;
	}

	onOpen() {
		const { contentEl } = this;
		contentEl.empty();

		contentEl.createEl('h2', { text: 'MCP Client Configuration' });

		const preEl = contentEl.createEl('pre', {
			cls: 'mcp-config-display'
		});
		preEl.createEl('code', { text: this.config });

		// Add copy button
		const buttonDiv = contentEl.createDiv({ cls: 'modal-button-container' });
		const copyButton = buttonDiv.createEl('button', {
			text: 'Copy to Clipboard',
			cls: 'mod-cta'
		});

		copyButton.addEventListener('click', async () => {
			try {
				await navigator.clipboard.writeText(this.config);
				new Notice('Configuration copied to clipboard!');
				this.close();
			} catch (error) {
				new Notice('Failed to copy to clipboard');
			}
		});

		const closeButton = buttonDiv.createEl('button', {
			text: 'Close'
		});
		closeButton.addEventListener('click', () => this.close());
	}

	onClose() {
		const { contentEl } = this;
		contentEl.empty();
	}
}
