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

interface MCPPluginSettings {
	toolsFolder: string;
	enabled: boolean;
	serverPort: number;
	serverHost: string;
}

const DEFAULT_SETTINGS: MCPPluginSettings = {
	toolsFolder: 'mcp-tools',
	enabled: false,
	serverPort: 3000,
	serverHost: 'localhost',
};

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

		// Set up directory monitoring for automatic tool reloading
		this.setupDirectoryMonitoring();

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
			new Notice('MCP Server initialized successfully');
			console.log('MCP server initialized with tools:', Array.from(this.loadedTools.keys()));
		} catch (error) {
			console.error('Failed to initialize MCP server:', error);
			new Notice('Failed to initialize MCP server: ' + error.message);
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
			new Notice('MCP Server enabled');
		} else {
			this.shutdownServer();
			new Notice('MCP Server disabled');
		}
	}

	async reloadTools() {
		if (this.settings.enabled) {
			await this.loadToolsFromFolder();
			new Notice(`Reloaded ${this.loadedTools.size} tools`);
		} else {
			new Notice('MCP Server is not running');
		}
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
						const result = await this.executeToolExternal(name, args || {});
						res.setHeader('Content-Type', 'application/json');
						res.writeHead(200);
						res.end(JSON.stringify(result));
						return;
					}

					if (url.pathname === '/mcp/config' && req.method === 'GET') {
						const config = this.generateSimpleMCPConfig();
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
				new Notice(`HTTP MCP Server started on port ${this.settings.serverPort}`);
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

	private setupDirectoryMonitoring() {
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
			await this.loadToolsFromFolder();
			console.log(`Quietly reloaded ${this.loadedTools.size} tools`);
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

			// Extract metadata from comments
			const descMatch = content.match(/@description\s+(.+)/);
			const paramMatches = [...content.matchAll(/@param\s+\{(\w+)\}\s+(\w+)\s*(.+)?/g)];

			const description = descMatch?.[1]?.trim() || 'No description available';
			const toolName = file.basename;

			// Build input schema from @param comments
			const properties: Record<string, any> = {};
			const required: string[] = [];

			for (const [, type, name, desc] of paramMatches) {
				properties[name] = {
					type: this.mapTypeToJsonSchema(type),
					description: desc?.trim() || `${name} parameter`
				};
				// For now, make all params optional - you can modify this logic
				if (!desc?.includes('Optional')) {
					required.push(name);
				}
			}

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

	mapTypeToJsonSchema(type: string): string {
		switch (type.toLowerCase()) {
			case 'string': return 'string';
			case 'number': return 'number';
			case 'boolean': return 'boolean';
			case 'array': return 'array';
			case 'object': return 'object';
			default: return 'string';
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
					text: typeof result === 'string' ? result : JSON.stringify(result, null, 2)
				}]
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

		// Add button to reload tools
		new Setting(containerEl)
			.setName('Reload Tools')
			.setDesc('Reload all tools from the tools folder')
			.addButton((button) =>
				button
					.setButtonText('Reload')
					.onClick(async () => {
						await this.plugin.reloadTools();
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
			.setName('Generate Simple Config')
			.setDesc('Generate simple configuration object for testing')
			.addButton((button) =>
				button
					.setButtonText('Generate & Copy')
					.onClick(async () => {
						try {
							const config = JSON.stringify(this.plugin.generateSimpleMCPConfig(), null, 2);
							await navigator.clipboard.writeText(config);
							new Notice('Simple MCP configuration copied to clipboard!');
						} catch (error) {
							new Notice('Failed to copy configuration: ' + error.message);
						}
					})
			);

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
 * @param {string} format Optional format string
 */
function getCurrentDateTime(params) {
    const now = new Date();
    return now.toISOString();
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
