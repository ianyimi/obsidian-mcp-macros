import { App, Plugin, PluginSettingTab, Setting, normalizePath, Notice, TFile } from 'obsidian';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
	CallToolRequestSchema,
	ListToolsRequestSchema,
	CallToolResult,
	Tool
} from '@modelcontextprotocol/sdk/types.js';
import * as path from 'path';

interface MCPPluginSettings {
	toolsFolder: string;
	enabled: boolean;
}

const DEFAULT_SETTINGS: MCPPluginSettings = {
	toolsFolder: 'mcp-tools',
	enabled: false,
};

export default class MCPPlugin extends Plugin {
	server: Server | null = null;
	private transport: StdioServerTransport | null = null;
	settings: MCPPluginSettings;
	loadedTools: Map<string, Tool> = new Map();
	private customToolFunctions: Map<string, Function> = new Map();

	async onload() {
		console.log('Loading MCP Tools Plugin');
		await this.loadSettings();
		this.addSettingTab(new MCPSettingTab(this.app, this));

		if (this.settings.enabled) {
			await this.initializeMCPServer();
		}

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
			await this.loadToolsFromFolder();

			this.server = new Server({
				name: 'obsidian-vault-tools',
				version: '0.1.0'
			}, {
				capabilities: {
					tools: {}
				}
			});

			// Register list tools handler
			this.server.setRequestHandler(ListToolsRequestSchema, async () => {
				return {
					tools: Array.from(this.loadedTools.values())
				};
			});

			// Register call tool handler
			this.server.setRequestHandler(CallToolRequestSchema, async (request) => {
				return await this.callTool(request.params.name, request.params.arguments || {});
			});

			// For stdio transport in a plugin, we need to create a mock transport
			// since we can't actually use stdio within Obsidian
			// Instead, we'll expose the server methods directly

			new Notice('MCP Server initialized successfully');
			console.log('MCP server initialized with tools:', Array.from(this.loadedTools.keys()));
		} catch (error) {
			console.error('Failed to initialize MCP server:', error);
			new Notice('Failed to initialize MCP server: ' + error.message);
		}
	}

	async toggleMCPServer() {
		this.settings.enabled = !this.settings.enabled;
		await this.saveSettings();

		if (this.settings.enabled) {
			await this.initializeMCPServer();
			new Notice('MCP Server enabled');
		} else {
			this.shutdownServer();
			new Notice('MCP Server disabled');
		}
	}

	async reloadTools() {
		if (this.settings.enabled && this.server) {
			await this.loadToolsFromFolder();
			new Notice(`Reloaded ${this.loadedTools.size} tools`);
		} else {
			new Notice('MCP Server is not running');
		}
	}

	shutdownServer() {
		if (this.server) {
			this.server.close();
			this.server = null;
		}
		if (this.transport) {
			this.transport.close();
			this.transport = null;
		}
	}

	onunload() {
		this.shutdownServer();
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

			// Store the tool function for execution
			// In a real implementation, you'd need to safely evaluate the JS
			// For now, we'll store the content and handle execution differently
			this.customToolFunctions.set(toolName, () => content);
			this.loadedTools.set(toolName, tool);
			console.log(`Loaded custom tool: ${toolName}`);
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
		const toolContent = this.customToolFunctions.get(name);
		if (!toolContent) {
			return {
				content: [{
					type: 'text',
					text: `Custom tool ${name} not found`
				}],
				isError: true
			};
		}

		// For security and simplicity, we'll just return a placeholder
		// In a real implementation, you'd need to safely execute the JavaScript
		// This would require a secure sandbox or VM context
		return {
			content: [{
				type: 'text',
				text: `Custom tool ${name} would execute with arguments: ${JSON.stringify(arguments_)}\n\nNote: Custom tool execution is not yet implemented for security reasons. The tool definition has been loaded and can be used by external MCP clients.`
			}]
		};
	}

	async loadSettings() {
		this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
	}

	async saveSettings() {
		await this.saveData(this.settings);
	}

	// Method to expose tools to external MCP clients
	getServerInstance(): Server | null {
		return this.server;
	}

	// Method to get tool list for external clients
	async getToolsList(): Promise<Tool[]> {
		return Array.from(this.loadedTools.values());
	}

	// Method to call tools from external clients
	async executeToolExternal(name: string, arguments_: Record<string, any>): Promise<CallToolResult> {
		return await this.callTool(name, arguments_);
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
			.addText((text) =>
				text
					.setPlaceholder('mcp-tools')
					.setValue(this.plugin.settings.toolsFolder)
					.onChange(async (value) => {
						this.plugin.settings.toolsFolder = value;
						await this.plugin.saveSettings();

						// Reload tools if server is running
						if (this.plugin.settings.enabled && this.plugin.server) {
							await this.plugin.loadToolsFromFolder();
						}
					})
			);

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

		containerEl.createEl('h3', { text: 'Tool Status' });

		if (this.plugin.settings.enabled && this.plugin.server) {
			const toolsList = Array.from(this.plugin.loadedTools.keys());
			containerEl.createEl('p', {
				text: `Server running with ${toolsList.length} tools: ${toolsList.join(', ')}`
			});
		} else {
			containerEl.createEl('p', { text: 'Server not running' });
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
