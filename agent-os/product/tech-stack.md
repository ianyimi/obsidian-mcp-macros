# Tech Stack - Obsidian MCP Macros V2

## Communication Protocol Recommendation

### Protocol Comparison Analysis

For the multi-agent architecture, we evaluated three agent communication protocols:

#### 1. MCP (Model Context Protocol) with Code Execution

**Architecture:**
- JSON-RPC 2.0 over HTTP/transport layers
- Client-server model with tool/resource exposure
- Currently implemented in V1 of this project

**Strengths:**
- Mature ecosystem with SDK support (TypeScript, Python)
- Well-documented specification
- Native code execution support through tool calling
- Good IDE/tooling support (your V1 already uses this)
- Large community adoption (Anthropic-backed)

**Weaknesses for this use case:**
- Token-heavy: Verbose JSON-RPC message format adds 100-300 tokens per request
- Designed for external client-to-server (not agent-to-agent coordination)
- Protocol overhead includes capability negotiation, server metadata
- Each tool call requires full request/response cycle with metadata wrapping
- Not optimized for rapid agent-to-agent coordination patterns

**Token overhead example:**
```json
{
  "jsonrpc": "2.0",
  "id": "request-123",
  "method": "tools/call",
  "params": {
    "name": "query_people",
    "arguments": {
      "query": "John Smith"
    }
  }
}
```
Plus response envelope, error handling structures, protocol metadata.

#### 2. ACP (Agent Communication Protocol)

**Status:** Could not locate public specification or implementation. This may be:
- Internal Anthropic protocol (not publicly documented)
- Conflated with MCP (which Anthropic maintains)
- Early-stage or deprecated project

**Recommendation:** Cannot evaluate without accessible documentation or SDK.

#### 3. A2A (Agent-to-Agent Protocol)

**Architecture:**
- JSON-RPC 2.0 over HTTP(S)
- Peer-to-peer agent collaboration model
- Developed by Google, open source (Apache 2.0)

**Strengths:**
- Purpose-built for agent-to-agent communication (matches your architecture)
- Agent Cards for capability discovery (dynamic routing potential)
- Supports three interaction patterns: sync request/response, streaming (SSE), async push
- Handles text, files, and structured JSON data
- Preserves agent opacity (agents don't expose internal tools/state)
- Enterprise-ready: Security, auth, observability built-in
- Multi-language SDK support (Python, Go, JavaScript, Java, .NET)

**Considerations for this use case:**
- Still JSON-RPC based (similar token overhead to MCP)
- Designed for inter-company agent collaboration (more complex than needed for single-user system)
- Agent Cards add discovery overhead (unnecessary in controlled environment where you define all agents)
- Async patterns add complexity for your synchronous orchestrator model
- May be overkill for self-hosted, single-user architecture

**Token overhead:** Similar to MCP (JSON-RPC base), plus Agent Card metadata for capability exchange.

### Selected Protocol: MCP with Code Execution

**Recommendation:** Continue using MCP, but optimize for your use case.

**Reasoning:**

1. **Already Implemented:** Your V1 has working MCP server in the Obsidian plugin. Don't throw away working code.

2. **Code Execution Native:** MCP's tool calling directly maps to QuickAdd functions, which is core to your architecture.

3. **Controlled Environment Optimization:** In your self-hosted Tailscale network, you can:
   - Strip unnecessary protocol metadata between trusted agents
   - Use HTTP/2 for request multiplexing (reduce overhead)
   - Implement streaming with SSE or WebSocket (bypass JSON-RPC for streamed responses)
   - Cache capability negotiations (run once at startup, not per request)

4. **A2A Doesn't Solve Token Problem:** A2A uses JSON-RPC too. Token overhead is similar. The "agent-to-agent" framing is conceptual, not a token efficiency gain.

5. **ACP Unavailable:** Can't recommend what we can't evaluate or implement.

6. **Token Overhead Mitigation Strategies:**
   - Use binary protocol for internal agent communication (HTTP/2 binary frames)
   - Compress JSON payloads with gzip/brotli (HTTP level)
   - Implement request batching for multi-step tasks
   - Use WebSocket for streaming to avoid repeated handshakes
   - Create "lite" message format for common operations (skip full JSON-RPC for internal calls)

**Hybrid Approach:**

```typescript
// External clients (mobile, desktop): Full MCP protocol
// Internal agent-to-agent: Optimized lightweight envelope over MCP transport

// Lightweight internal format:
{
  "a": "people",           // agent (short key)
  "op": "query",          // operation
  "d": { "q": "John" },  // data (short keys in payload)
  "sid": "abc123"         // session ID
}

// Still uses MCP SDK for transport/connection, but minimal payload
// Agents translate to full MCP tool calls when hitting QuickAdd functions
```

This gives you:
- MCP compatibility for plugin API
- Reduced token overhead for agent coordination (50-100 tokens vs 200-300)
- Code execution through existing MCP tool infrastructure
- Flexibility to swap in A2A later if multi-tenant/external agents needed

**Implementation Path:**

1. Keep MCP server in Obsidian plugin (external API)
2. Create lightweight agent protocol layer (internal coordination)
3. Orchestrator translates between formats
4. Specialized agents use lightweight format to talk to orchestrator
5. Orchestrator uses MCP to call Obsidian QuickAdd functions

**Alternative Consideration:**

If token costs truly become prohibitive in practice:
- Evaluate gRPC (binary protocol, ~10x smaller than JSON-RPC)
- Consider Cap'n Proto or FlatBuffers for zero-copy serialization
- But: Start with optimized MCP, measure actual overhead, then optimize if needed

## Core Framework & Runtime

### Agent Framework
- **Primary:** LangChain + LangGraph for agent orchestration
  - Mature ecosystem with agent coordination patterns
  - Excellent tooling for RAG and memory integration
  - Supports streaming and async operations
  - Python-based (good for ML/AI ecosystem)

- **Alternative:** Custom TypeScript agent framework
  - Better Obsidian plugin integration
  - Consider for simpler agents or specific performance needs

### Language Runtime
- **Agents:** Python 3.11+ (LangChain, ML libraries, async support)
- **Obsidian Plugin:** TypeScript/Node.js 16+ (existing codebase)
- **Orchestration:** Docker Compose for service coordination

### Package Management
- **Python:** Poetry (better dependency resolution than pip)
- **Node.js:** pnpm (already in use, faster than npm)
- **Containers:** Docker Compose with volume management

## Agent Infrastructure

### LLM Runtime
- **Local Models:** Ollama running on Mac Studio
  - Models: Llama 3.1 70B for orchestrator, Llama 3.1 8B for sub-agents
  - Hardware acceleration: Metal (Apple Silicon)
  - API: OpenAI-compatible endpoints

- **Alternative:** LM Studio as backup runtime
- **Embeddings:** nomic-embed-text (Ollama) or sentence-transformers (local)

### Agent Memory
- **Short-term (Conversation):** Redis on Unraid NAS
  - In-memory speed for active conversations
  - Persistence for crash recovery
  - Pub/sub for agent coordination events

- **Long-term (Knowledge):** PostgreSQL on Unraid NAS
  - Structured storage for user preferences, learned patterns
  - Timestamped conversation history
  - Agent-specific metadata

### RAG System
- **Vector Database:** Qdrant on Unraid NAS (already integrated in V1)
  - Collections per note system (people, journal, goals, etc.)
  - Existing Obsidian vault sync functionality
  - REST API for agent access

- **Embedding Model:** nomic-embed-text via Ollama
  - 768-dimensional embeddings
  - Fast, runs locally
  - Good quality for knowledge base RAG

- **Chunking Strategy:**
  - Semantic chunking by heading/section (preserve note structure)
  - 512 tokens per chunk, 64 token overlap
  - Metadata: note type, frontmatter, links, creation date

## Obsidian Plugin Integration

### Plugin Architecture
- **Language:** TypeScript (maintain existing codebase)
- **Build:** esbuild (already configured)
- **APIs Used:**
  - Obsidian Vault API (file operations)
  - Workspace API (active file, views)
  - MetadataCache (frontmatter, links)
  - Custom HTTP server (agent communication)

### QuickAdd Integration
- **Function Execution:** Dynamic import of QuickAdd macros from vault
- **Agent Actions:** Map agent commands to QuickAdd functions
- **Note Templates:** Leverage existing QuickAdd templates per note type

## Phone Integration

### Mobile Client
- **Option 1 (Recommended):** Progressive Web App (PWA)
  - Built with: Next.js + React
  - Voice: Web Speech API + Whisper.cpp fallback
  - Advantages: Single codebase, no app store, works on iOS/Android
  - Hosted: Mac Studio (always available via Tailscale)

- **Option 2:** Native iOS App (if PWA limitations hit)
  - Built with: Swift + SwiftUI
  - Voice: iOS Speech framework
  - Advantages: Better iOS integration, background processing

### Voice Processing
- **Speech-to-Text:** Whisper.cpp running on Mac Studio
  - Faster than cloud APIs
  - Completely private
  - Good accuracy for command recognition

- **Text-to-Speech:** macOS `say` command or Festival (optional)
  - For voice responses if desired

### Network Access
- **VPN:** Tailscale (already in infrastructure)
  - All services on Tailscale IPs
  - MagicDNS for service discovery
  - No port forwarding or public exposure

## Infrastructure Services

### Mac Studio (Primary Compute)
**Services:**
- Obsidian with MCP Macros plugin
- Ollama LLM runtime (Llama models)
- Orchestrator agent process
- Mobile PWA web server
- Whisper.cpp voice processing

**Why Mac Studio:**
- Primary workspace machine (Obsidian always running)
- M-series chip excellent for LLM inference
- High RAM capacity for large models
- Low latency for interactive agent responses

### Unraid NAS (Supporting Services)
**Services:**
- Qdrant vector database (Docker)
- PostgreSQL memory database (Docker)
- Redis short-term memory (Docker)
- Specialized agent containers (Docker)
- Backup services
- Monitoring (Prometheus + Grafana)

**Why Unraid:**
- Free up Mac Studio RAM for agent inference
- Persistent storage for databases
- Container orchestration for agent services
- Always-on availability
- Easy service management and updates

### Container Orchestration
- **Tool:** Docker Compose on Unraid
- **Networking:** Tailscale sidecar containers
- **Volumes:** NAS storage mounted into containers
- **Configs:** Environment variables + mounted config files

### Service Discovery
- **Method:** Tailscale MagicDNS
- **Naming Convention:**
  - `obsidian-server.tailnet-name.ts.net`
  - `qdrant.tailnet-name.ts.net`
  - `postgres.tailnet-name.ts.net`
  - `redis.tailnet-name.ts.net`

## Agent Communication Architecture

### Agent Deployment
- **Orchestrator:** Python process on Mac Studio (low latency to Obsidian)
- **Specialized Agents:** Docker containers on Unraid (resource isolation)
- **Communication:** HTTP/2 over Tailscale network (optimized MCP protocol)
- **Load Balancing:** Not needed (single user), but round-robin if scaling

### Request Flow
```
Phone/Desktop -> Orchestrator Agent (Mac Studio)
    -> Determine required agents
    -> Parallel requests to specialized agents (Unraid)
    -> Agents query Qdrant RAG, call Obsidian API
    -> Aggregate responses
    -> Stream back to client
```

### Protocol Endpoints
- `POST /mcp/tools/call` - MCP tool execution (external clients)
- `POST /agent/:agent_name/action` - Lightweight agent action (internal)
- `GET /agent/:agent_name/status` - Agent health check
- `POST /orchestrator/query` - Main user query endpoint (streaming)
- `WS /orchestrator/stream` - WebSocket for real-time streaming

## Development & Testing

### Testing Framework
- **Python Agents:** pytest + pytest-asyncio
- **TypeScript Plugin:** Jest (already configured)
- **Integration:** Docker Compose test environment
- **Mocking:** Mock LLM responses for deterministic tests

### Development Tools
- **Python:** Black (formatting), ruff (linting), mypy (type checking)
- **TypeScript:** ESLint (already configured), Prettier
- **Debugging:** VS Code debugger, Python debugpy for agents
- **Logging:** Structured logging (structlog for Python, pino for Node)

### Monitoring
- **Metrics:** Prometheus (agent response times, LLM tokens, error rates)
- **Visualization:** Grafana dashboards on Unraid
- **Logs:** Centralized logging to Unraid (Loki + Grafana)
- **Alerting:** Grafana alerts for service failures

## Data Flow & Storage

### Note Storage
- **Primary:** Obsidian vault (markdown files on Mac Studio)
- **Backup:** Unraid NAS (automated sync)
- **Version Control:** Git repository (optional)

### Vector Embeddings
- **Storage:** Qdrant collections on Unraid
- **Sync Trigger:** Obsidian file watcher in plugin (v1 feature)
- **Update Strategy:** Incremental (only changed notes)

### Agent Memory
- **Conversation Context:** Redis (TTL-based, last 24 hours)
- **Long-term Memory:** PostgreSQL (permanent, indexed)
- **User Preferences:** PostgreSQL with agent-specific tables

## Security & Privacy

### Authentication
- **Network:** Tailscale authentication (device-level trust)
- **API Keys:** Shared secret between plugin and agents (env vars)
- **No External Auth:** All services trusted within Tailscale network

### Data Privacy
- **All Processing Local:** No cloud API calls except optional Tailscale coordination
- **No Telemetry:** All data stays in your infrastructure
- **Encryption:** Tailscale WireGuard tunnel for all communication

### Backup Strategy
- **Vault:** Unraid NAS + optional cloud sync (encrypted)
- **Databases:** Daily snapshots on Unraid (postgres dump, qdrant backup)
- **Agent Code:** Git repository
- **Configuration:** Version controlled in repo

## Third-Party Dependencies

### Critical Services
- **Tailscale:** VPN infrastructure (has free tier, stable)
- **Ollama:** LLM runtime (open source, self-hosted)
- **Qdrant:** Vector DB (open source, self-hosted)

### OSS Components
- **LangChain:** Agent framework (MIT license)
- **Whisper.cpp:** Voice transcription (MIT license)
- **PostgreSQL:** Database (PostgreSQL license)
- **Redis:** Cache/memory (BSD license)

### No External API Dependencies
- No OpenAI API calls (use Ollama local models)
- No cloud vector databases
- No cloud voice services
- No analytics or tracking services
