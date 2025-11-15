# Product Mission

## Pitch
Obsidian MCP Macros V2 is a multi-agent personal knowledge system that helps users maintain and interact with their knowledge vault by providing specialized AI agents that understand different note systems, coordinate complex tasks, and offer seamless access through text and voice interfaces—all running locally within your self-hosted infrastructure.

## Users

### Primary Customers
- **Knowledge Workers**: Individuals managing complex personal knowledge systems in Obsidian who need intelligent assistance across multiple note types and workflows
- **Self-Hosted Enthusiasts**: Privacy-conscious users running their own infrastructure who want AI capabilities without cloud dependencies
- **Productivity Power Users**: People with structured note systems for journaling, goal tracking, networking, and personal data management

### User Personas

**Alex** (28-45 years old)
- **Role:** Software Engineer / Knowledge Worker
- **Context:** Maintains extensive Obsidian vault with 1000+ notes across multiple systems (projects, people, journal, learning)
- **Pain Points:** Difficulty maintaining consistency across note types; manual effort to update related notes; context switching between different note systems; no way to query knowledge base conversationally
- **Goals:** Seamless voice and text interaction with vault; automatic maintenance of note relationships; intelligent suggestions for note creation and updates; access knowledge base from phone while away from desk

**Jordan** (30-50 years old)
- **Role:** Researcher / Writer / Content Creator
- **Context:** Uses Obsidian as second brain with structured systems for research, contacts, media consumption, and project management
- **Pain Points:** Time-consuming manual organization; difficulty finding related information across systems; cannot access vault intelligence on mobile; repetitive tasks like meeting notes, contact updates
- **Goals:** Natural language querying of entire knowledge base; automated note organization and linking; mobile access to vault intelligence; agents that understand context across multiple note systems

## The Problem

### Fragmented Knowledge Management
Current Obsidian workflows require manual coordination between different note systems (people, projects, journal, goals). Users spend significant time on organizational overhead instead of knowledge creation. Queries require remembering specific note locations and structures.

**Our Solution:** An orchestrator agent that understands all note systems and coordinates specialized sub-agents, each managing one system with deep understanding of its structure and relationships.

### Limited Intelligent Interaction
Obsidian lacks conversational AI capabilities that understand vault structure and context. Users cannot naturally query or update their knowledge base using voice or text while maintaining privacy.

**Our Solution:** Local AI agents with RAG capabilities running on user's own infrastructure, providing natural language interaction while keeping all data private within the user's network.

### No Mobile Intelligence Access
While Obsidian has mobile apps, users cannot access vault intelligence or perform complex queries on-the-go without desktop access.

**Our Solution:** Phone integration (text and voice) that connects to locally-hosted agents, enabling full vault intelligence from anywhere via secure Tailscale VPN.

### Inefficient Multi-System Tasks
Tasks requiring coordination across multiple note systems (e.g., "Update project status, log in journal, update related people notes") require manual work across different vault sections.

**Our Solution:** Agent coordination framework where orchestrator routes multi-step tasks to appropriate specialized agents, which can collaborate to complete complex workflows.

## Differentiators

### Fully Self-Hosted Multi-Agent Architecture
Unlike cloud-based AI note assistants (Mem, Reflect, Notion AI), we run entirely on user's infrastructure. All agents, memory, RAG, and processing happen locally on Mac Studio and Unraid NAS within Tailscale VPN. This provides complete privacy, no subscription costs, and unlimited usage.

### Specialized System Agents
Rather than a single general-purpose assistant, we provide specialized agents for each knowledge system (People, Journal, Goals, Food, Code Bugs, Games/Media, Experiences). Each agent deeply understands its domain's structure, conventions, and relationships, providing higher quality interactions than general-purpose assistants.

### Obsidian-Native Integration
Built as an Obsidian plugin with direct vault access, not an external service. Agents use QuickAdd functions and plugin APIs for native note manipulation, maintaining Obsidian conventions and file structure.

### Infrastructure Optimized
Designed for Mac Studio + Unraid NAS architecture, keeping high-frequency agent workloads on Mac Studio while offloading memory, storage, and supporting services to NAS. Maximizes available compute for agents while using network resources efficiently.

### Voice and Text Mobile Access
Full vault intelligence accessible via phone through Tailscale VPN, supporting both text and voice input. Unlike desktop-only solutions, users can query and update their knowledge base from anywhere securely.

## Key Features

### Core Agent System
- **Orchestrator Agent:** Main conversational interface that understands all systems, routes tasks to appropriate sub-agents, and coordinates multi-agent workflows
- **Specialized Sub-Agents:** Domain experts for People/Network, Journal/Calendar, Goals/Projects, Food/Restaurants, Code Bug Archive, Games/Media Tracking, and Experiences/Friends
- **Agent Coordination:** Protocol for agents to communicate, share context, and collaborate on tasks requiring multiple systems

### Memory & Context
- **Persistent Memory:** Long-term memory system for agents to maintain conversation history, user preferences, and learned patterns
- **RAG System:** Retrieval-augmented generation with vector database for semantic search across entire vault
- **Cross-System Context:** Agents understand relationships between different note systems (e.g., projects linked to people, journal entries referencing goals)

### Note Management
- **QuickAdd Integration:** Agents use existing QuickAdd functions to create and update notes following vault conventions
- **Obsidian API Access:** Direct plugin API access for reading vault, searching, linking notes, and metadata operations
- **Structure Preservation:** All agent operations maintain Obsidian file structure, frontmatter, and linking conventions

### Communication Protocols
- **Efficient Agent Protocol:** Lightweight communication protocol optimized for self-hosted environment (alternatives evaluated: MCP, ACP, custom protocol)
- **HTTP Transport:** RESTful endpoints for agent communication and mobile client access
- **Streaming Support:** Real-time response streaming for conversational interfaces

### Mobile Integration
- **Phone Client:** iOS app or web interface for text and voice interaction
- **Voice Input:** Speech-to-text processing with natural language understanding
- **Secure Access:** All communication over Tailscale VPN, no public endpoints
- **Offline Queuing:** Queue requests when offline, sync when connected

### Infrastructure Services
- **Mac Studio Services:** Primary agent runtime, Obsidian plugin server, high-frequency processing
- **Unraid NAS Services:** Vector database, persistent memory storage, backup services, container orchestration
- **Network Services:** Tailscale VPN, service discovery, inter-service communication
