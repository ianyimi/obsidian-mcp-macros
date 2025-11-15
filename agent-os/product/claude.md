# Getting Started with Obsidian MCP Macros V2

This guide will help you plan and implement the V2 multi-agent system transformation. Use this document as a reference when working with AI assistants on V2 development.

## Project Overview

**Current State (V1):**
- Obsidian plugin with embedded MCP server
- Exposes QuickAdd functions as MCP tools
- Basic vector sync with Qdrant
- HTTP transport for external clients

**Target State (V2):**
- Multi-agent architecture with orchestrator + specialized agents
- Custom lightweight protocol (CLAP) replacing MCP
- Distributed system: Mac Studio (primary compute) + Unraid NAS (services)
- Mobile PWA with voice support via Tailscale VPN
- Agent memory and RAG across all note systems

## Architecture Quick Reference

### System Components

**Mac Studio (Primary Compute):**
- Obsidian plugin with CLAP server
- Orchestrator agent (Python/LangChain)
- Ollama LLM runtime (Llama 3.1 70B/8B)
- Whisper.cpp voice processing
- Mobile PWA web server (Next.js)

**Unraid NAS (Supporting Services):**
- Specialized agent containers (People, Journal, Goals, Food, Code, Games, Experiences)
- Qdrant vector database (multi-collection RAG)
- PostgreSQL (agent memory, conversation history)
- Redis (active conversation context)
- Monitoring stack (Prometheus, Grafana, Loki)

**Network:**
- All communication over Tailscale VPN
- CLAP protocol for agent communication
- WebSocket streaming for real-time responses

### Agent System Design

**Orchestrator Agent:**
- Main conversational interface
- Routes queries to appropriate specialized agents
- Coordinates multi-agent tasks
- Manages streaming responses to clients

**Specialized Agents (7 types):**
1. People/Network - Contact management and relationships
2. Journal/Calendar - Daily entries and temporal queries
3. Goals/Projects - Task tracking and progress monitoring
4. Food/Restaurants - Dining experiences and recipes
5. Code Bug Archive - Technical solutions and code snippets
6. Games/Media - Entertainment consumption tracking
7. Experiences/Friends - Social memories and events

## Development Phases

Refer to `/Users/zaye/Documents/Obsidian/Plugins/obsidian-mcp-macros/agent-os/product/roadmap.md` for detailed roadmap with effort estimates.

**Phase 1: Foundation & Infrastructure** (Estimated: 6-8 weeks)
- Custom protocol design and implementation
- Mac Studio agent runtime setup with Ollama
- Unraid service deployment (PostgreSQL, Redis, Qdrant)
- Enhanced vector sync with multi-collection support
- Agent memory system

**Phase 2: Core Agent System** (Estimated: 8-10 weeks)
- Orchestrator agent with routing and streaming
- First 3 specialized agents (People, Journal, Goals)
- Agent coordination framework for multi-step tasks

**Phase 3: Specialized Agents** (Estimated: 4-5 weeks)
- Remaining 4 specialized agents
- Enhanced RAG with re-ranking

**Phase 4: Mobile Integration** (Estimated: 6-7 weeks)
- PWA foundation with text chat
- Voice input with Whisper.cpp
- Voice-first UI and offline support

**Phase 5: Polish & Advanced** (Estimated: 5-6 weeks)
- Agent learning system
- Multi-modal support (images, OCR)
- Scheduled automation
- Monitoring and observability

**Phase 6: Ecosystem** (Estimated: 4-5 weeks)
- Custom agent builder
- Plugin API for integrations
- Community sharing

## Technical Stack Reference

Refer to `/Users/zaye/Documents/Obsidian/Plugins/obsidian-mcp-macros/agent-os/product/tech-stack.md` for complete technical specifications.

**Key Technologies:**
- **Protocol:** Custom CLAP (lightweight agent protocol)
- **Agents:** Python 3.11+ with LangChain/LangGraph
- **LLM:** Ollama (Llama 3.1 models, local inference)
- **Vector DB:** Qdrant (already integrated)
- **Memory:** PostgreSQL (long-term) + Redis (short-term)
- **Voice:** Whisper.cpp (speech-to-text)
- **Mobile:** Next.js PWA with WebSockets
- **Network:** Tailscale VPN for all services

## Development Setup

### Prerequisites

**Mac Studio:**
- macOS 14+ (Sonoma or later)
- Ollama installed: `brew install ollama`
- Python 3.11+: `brew install python@3.11`
- Node.js 16+: Already installed (check `node --version`)
- pnpm: Already installed
- Docker Desktop (for local testing)

**Unraid NAS:**
- Unraid OS 6.10+
- Docker containers enabled
- Tailscale plugin installed
- Minimum 16GB RAM for services

### Initial Setup Steps

1. **Install Ollama Models:**
   ```bash
   ollama pull llama3.1:70b   # For orchestrator (requires ~40GB RAM)
   ollama pull llama3.1:8b    # For sub-agents (requires ~8GB RAM each)
   ollama pull nomic-embed-text  # For embeddings
   ```

2. **Set up Python Environment:**
   ```bash
   cd /Users/zaye/Documents/Obsidian/Plugins/obsidian-mcp-macros
   python3.11 -m venv venv
   source venv/bin/activate
   pip install poetry
   poetry init  # Create new pyproject.toml for agents
   ```

3. **Install Agent Dependencies:**
   ```bash
   poetry add langchain langchain-community langgraph
   poetry add qdrant-client psycopg2 redis
   poetry add httpx websockets
   poetry add python-dotenv pydantic structlog
   ```

4. **Configure Tailscale (if not already):**
   ```bash
   # On Mac Studio
   brew install tailscale
   sudo tailscale up

   # On Unraid: Install Tailscale plugin from Community Applications
   # Enable and authenticate through Unraid web UI
   ```

5. **Deploy Unraid Services:**
   Create `docker-compose.yml` on Unraid:
   ```yaml
   version: '3.8'
   services:
     postgres:
       image: postgres:15
       environment:
         POSTGRES_DB: agent_memory
         POSTGRES_USER: agent
         POSTGRES_PASSWORD: ${POSTGRES_PASSWORD}
       volumes:
         - /mnt/user/appdata/agent-memory/postgres:/var/lib/postgresql/data
       network_mode: container:tailscale

     redis:
       image: redis:7-alpine
       volumes:
         - /mnt/user/appdata/agent-memory/redis:/data
       network_mode: container:tailscale

     qdrant:
       image: qdrant/qdrant:latest
       volumes:
         - /mnt/user/appdata/qdrant:/qdrant/storage
       network_mode: container:tailscale

     tailscale:
       image: tailscale/tailscale:latest
       hostname: agent-services
       environment:
         TS_AUTHKEY: ${TS_AUTHKEY}
         TS_STATE_DIR: /var/lib/tailscale
       volumes:
         - /mnt/user/appdata/tailscale/agent-services:/var/lib/tailscale
       cap_add:
         - NET_ADMIN
         - SYS_MODULE
   ```

## Working with AI Assistants

### When Starting a New Conversation

Provide this context:
```
I'm working on Obsidian MCP Macros V2 - a multi-agent personal knowledge system.

Current task: [Describe what you're working on]
Phase: [Reference roadmap phase, e.g., "Phase 1: Foundation"]
Component: [e.g., "Orchestrator Agent", "Vector Sync", "Mobile PWA"]

Project root: /Users/zaye/Documents/Obsidian/Plugins/obsidian-mcp-macros
Key docs:
- agent-os/product/mission.md (product vision)
- agent-os/product/roadmap.md (development phases)
- agent-os/product/tech-stack.md (technical decisions)
- agent-os/product/claude.md (this file)

V1 codebase: main.ts (TypeScript Obsidian plugin)
V2 development: Will add agent/ directory for Python agents

Architecture: Mac Studio (primary) + Unraid NAS (services) over Tailscale VPN
```

### Common Development Tasks

**Task: Implement Custom CLAP Protocol**
- Create TypeScript types in `src/types/clap.ts`
- Create Python models in `agents/protocol/clap.py`
- Define request/response schemas with validation
- Add streaming support with Server-Sent Events or WebSocket
- Write unit tests for both implementations

**Task: Build Orchestrator Agent**
- Create `agents/orchestrator/` directory
- Implement LangChain agent with routing logic
- Add tool definitions for each specialized agent
- Configure Ollama client for Llama 3.1 70B
- Implement streaming response handler
- Add conversation context management with Redis

**Task: Create Specialized Agent (Example: People Agent)**
- Create `agents/people/` directory with agent class
- Define Qdrant collection schema for people notes
- Implement QuickAdd function mapping for note operations
- Add RAG query logic with semantic search
- Create LangChain tools for: search_people, get_person, update_person
- Write integration tests with mock Qdrant/Obsidian

**Task: Deploy Agent Container to Unraid**
- Create `Dockerfile` for agent with Python 3.11 base
- Add `docker-compose.yml` entry with Tailscale networking
- Configure environment variables (Qdrant URL, Ollama endpoint)
- Set up health check endpoint
- Deploy and test via Tailscale connection

**Task: Build Mobile PWA**
- Create `mobile/` directory with Next.js app
- Implement chat UI with message streaming
- Add WebSocket connection to orchestrator
- Create voice input component with Whisper.cpp integration
- Add offline support with service worker
- Deploy to Mac Studio with PM2 or systemd

### Debugging Tips

**Agent not responding:**
1. Check Ollama is running: `ollama list` and `ollama ps`
2. Verify Tailscale connectivity: `tailscale status`
3. Check agent logs: `docker logs <container_name>` on Unraid
4. Test Qdrant: `curl http://qdrant.tailnet.ts.net:6333/collections`

**Vector search not finding results:**
1. Verify collection exists in Qdrant UI
2. Check embedding dimension matches (768 for nomic-embed-text)
3. Test embedding generation: Call Ollama API directly
4. Inspect Qdrant vector count: Should match chunk count

**Voice transcription issues:**
1. Test Whisper.cpp directly with audio file
2. Check audio format (prefer 16kHz mono WAV)
3. Verify model downloaded: `whisper.cpp/models/`
4. Monitor Mac Studio CPU/RAM during transcription

## Code Organization

### Current V1 Structure
```
obsidian-mcp-macros/
├── main.ts                  # Plugin entry point with MCP server
├── manifest.json
├── package.json
├── node_modules/
└── mcp-tools/               # User-defined QuickAdd function tools
```

### Planned V2 Structure
```
obsidian-mcp-macros/
├── main.ts                  # Enhanced plugin with CLAP server
├── src/
│   ├── types/
│   │   └── clap.ts         # CLAP protocol types
│   ├── server/
│   │   └── clap-server.ts  # Protocol server implementation
│   ├── vector/
│   │   └── multi-collection.ts  # Enhanced Qdrant sync
│   └── utils/
├── agents/                  # New: Python agent system
│   ├── pyproject.toml      # Poetry dependencies
│   ├── protocol/
│   │   ├── clap.py         # Protocol client/server
│   │   └── types.py        # Pydantic models
│   ├── orchestrator/
│   │   ├── agent.py        # Orchestrator implementation
│   │   ├── routing.py      # Agent routing logic
│   │   └── streaming.py    # Response streaming
│   ├── specialized/
│   │   ├── base.py         # Base agent class
│   │   ├── people.py       # People/Network agent
│   │   ├── journal.py      # Journal/Calendar agent
│   │   ├── goals.py        # Goals/Projects agent
│   │   ├── food.py         # Food/Restaurants agent
│   │   ├── code.py         # Code Bug Archive agent
│   │   ├── games.py        # Games/Media agent
│   │   └── experiences.py  # Experiences/Friends agent
│   ├── memory/
│   │   ├── postgres.py     # Long-term memory
│   │   └── redis.py        # Short-term memory
│   └── rag/
│       ├── qdrant.py       # Vector search
│       └── chunking.py     # Document chunking
├── mobile/                  # New: PWA application
│   ├── package.json
│   ├── next.config.js
│   ├── src/
│   │   ├── app/            # Next.js app router
│   │   ├── components/     # React components
│   │   │   ├── chat/       # Chat interface
│   │   │   ├── voice/      # Voice input UI
│   │   │   └── layout/     # App layout
│   │   ├── lib/
│   │   │   ├── websocket.ts  # WS client
│   │   │   ├── api.ts      # API client
│   │   │   └── audio.ts    # Audio processing
│   │   └── types/          # TypeScript types
│   └── public/
├── docker/                  # New: Container configs
│   ├── Dockerfile.agent    # Base agent image
│   ├── docker-compose.unraid.yml  # Unraid services
│   └── docker-compose.dev.yml     # Local development
├── scripts/                 # Deployment and utility scripts
│   ├── deploy-agents.sh
│   ├── setup-ollama.sh
│   └── migrate-v1-to-v2.sh
├── mcp-tools/               # Existing QuickAdd functions
├── agent-os/
│   ├── product/            # This documentation
│   │   ├── mission.md
│   │   ├── roadmap.md
│   │   ├── tech-stack.md
│   │   └── claude.md       # You are here
│   └── standards/          # Coding standards
└── README.md
```

## Testing Strategy

### Unit Tests
- **Plugin (TypeScript):** Jest for CLAP server, protocol types
- **Agents (Python):** pytest for agent logic, mocking LLM responses
- Run before each commit

### Integration Tests
- Test orchestrator → specialized agent communication
- Test Qdrant RAG with sample notes
- Test QuickAdd function execution from agents
- Run before merging to main branch

### End-to-End Tests
- Full user query from mobile → orchestrator → agents → response
- Multi-agent coordination scenarios
- Voice input to action completion
- Run weekly on staging environment

### Performance Tests
- Agent response time under load
- Concurrent query handling
- Vector search performance with 10k+ notes
- LLM inference latency
- Run monthly or before major releases

## Common Pitfalls & Solutions

**Pitfall:** Running out of RAM on Mac Studio with multiple LLM instances
**Solution:** Use 8B model for sub-agents, keep 70B only for orchestrator. Consider model quantization (Q4/Q5).

**Pitfall:** Qdrant sync overwhelming system when vault is large
**Solution:** Implement rate limiting in sync manager, process files in batches of 10-20.

**Pitfall:** Agent responses too slow for conversational feel
**Solution:** Implement streaming from first token, show thinking indicators, cache common queries.

**Pitfall:** Voice transcription accuracy poor with background noise
**Solution:** Use noise cancellation in mobile app, implement command detection, add user correction feedback loop.

**Pitfall:** Losing conversation context between agent calls
**Solution:** Pass conversation ID through all agent calls, store in Redis with 24h TTL.

**Pitfall:** Agents making incorrect updates to notes
**Solution:** Add dry-run mode for destructive operations, show preview before execution, implement undo functionality.

## Next Steps

To begin V2 development:

1. **Review Product Documentation:**
   - Read mission.md for product vision and user needs
   - Study roadmap.md for phased development plan
   - Review tech-stack.md for technical decisions and rationale

2. **Set Up Development Environment:**
   - Follow "Development Setup" section above
   - Install all prerequisites on Mac Studio
   - Deploy baseline services to Unraid (PostgreSQL, Redis, Qdrant)

3. **Start with Phase 1:**
   - Begin with "Custom Agent Protocol Design" (roadmap item #1)
   - Create TypeScript and Python protocol implementations
   - Write comprehensive tests for protocol
   - Document protocol specification in `agent-os/standards/`

4. **Iterative Development:**
   - Complete each roadmap item in order
   - Test thoroughly at each stage
   - Keep V1 running until V2 reaches parity
   - Get user feedback early with Journal agent (easiest to test)

5. **When Working with AI:**
   - Reference this document and related product docs
   - Be specific about which phase and component you're working on
   - Share relevant error messages and logs
   - Ask for code reviews before committing major changes

## Resources

**Internal Documentation:**
- `/agent-os/product/mission.md` - Product vision and features
- `/agent-os/product/roadmap.md` - Development phases and architecture
- `/agent-os/product/tech-stack.md` - Technical stack and decisions
- `/agent-os/standards/` - Coding standards and conventions

**External References:**
- LangChain docs: https://python.langchain.com/docs/
- LangGraph docs: https://langchain-ai.github.io/langgraph/
- Ollama docs: https://ollama.ai/docs
- Qdrant docs: https://qdrant.tech/documentation/
- Whisper.cpp: https://github.com/ggerganov/whisper.cpp
- Tailscale docs: https://tailscale.com/kb/

**Community:**
- Obsidian Discord: Plugin development channel
- LangChain Discord: Agent building discussions
- r/selfhosted: Infrastructure ideas and troubleshooting

## Questions?

When you have questions during development:
1. Check this document first
2. Review product documentation (mission, roadmap, tech-stack)
3. Search existing V1 codebase for similar patterns
4. Ask AI assistant with full context from "Working with AI Assistants" section
5. Document learnings back into this file for future reference

Happy building!
