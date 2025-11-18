# OpenWebUI Multi-Agent Architecture with Obsidian MCP

## Architecture Clarification

### System Components

```
┌─────────────────────────────────────────────────────────────┐
│ LibreChat (Desktop/Web Client)                              │
│ - Chat interface for non-mobile devices                     │
│ - Connects to OWUI orchestrator via OpenAI-compatible API   │
└────────────────────┬────────────────────────────────────────┘
                     │
                     ↓
┌─────────────────────────────────────────────────────────────┐
│ Mac Studio: OpenWebUI Instance                              │
├─────────────────────────────────────────────────────────────┤
│                                                              │
│  [Orchestrator Agent]                                       │
│         ↓                                                    │
│  ┌──────┴──────┬──────────┬──────────┬──────────┐         │
│  ↓             ↓          ↓          ↓          ↓          │
│  [People]  [Journal]  [Goals]    [Code]    [Food]          │
│  [Games]   [Experiences]                                    │
│                                                              │
│  Each agent has:                                            │
│  - Own RAG pipeline configuration                           │
│  - Own pruning model/settings                               │
│  - Access to Obsidian MCP tools                            │
│                                                              │
└────────────────────┬────────────────────────────────────────┘
                     │
                     ↓ (HTTP/MCP calls)
┌─────────────────────────────────────────────────────────────┐
│ Obsidian Plugin (MCP Server)                                │
├─────────────────────────────────────────────────────────────┤
│                                                              │
│  Responsibilities:                                          │
│  1. Maintain Qdrant vector DB (auto-sync on file changes)  │
│  2. Provide MCP tools for agents:                          │
│     - vector-search                                         │
│     - create-note                                           │
│     - search-notes                                          │
│     - get-active-file                                       │
│     - Custom tools from mcp-tools/ folder                   │
│  3. Execute vault operations on behalf of agents            │
│                                                              │
│  NOT responsible for:                                       │
│  - Running LLM models                                       │
│  - Agent coordination                                       │
│  - Result pruning/reranking                                 │
│                                                              │
└────────────────────┬────────────────────────────────────────┘
                     │
                     ↓
┌─────────────────────────────────────────────────────────────┐
│ Unraid NAS                                                  │
│  - Qdrant Vector DB                                         │
│  - PostgreSQL (conversation history)                        │
│  - Redis (context cache)                                    │
└─────────────────────────────────────────────────────────────┘
```

---

## RAG Pipeline: Where Does It Happen?

### Option 1: Orchestrator-Level RAG (Recommended)
**Flow**:
```
User query
  ↓
Orchestrator Agent receives query
  ↓
[RAG Pipeline in Orchestrator]:
  1. Generate embedding (local model in OWUI)
  2. Call Obsidian MCP: vector-search(query, limit=100)
  3. Prune results using query-context-pruner-multilingual-Qwen3-4B
  4. Inject pruned context into orchestrator prompt
  ↓
Orchestrator determines which specialized agents to invoke
  ↓
Orchestrator sends pruned context + instructions to specialized agents
  ↓
Specialized agents use context to generate responses
  ↓
Orchestrator synthesizes multi-agent responses
  ↓
Return to user
```

**Pros**:
- ✅ Single RAG call per user query (efficient)
- ✅ Orchestrator has full context before routing
- ✅ Specialized agents work on pre-filtered data
- ✅ Simpler setup in OWUI

**Cons**:
- ❌ Generic pruning (not domain-specific)
- ❌ All agents see same context (less specialized)

### Option 2: Specialized-Agent-Level RAG (More Powerful)
**Flow**:
```
User query
  ↓
Orchestrator Agent receives query
  ↓
Orchestrator determines which specialized agents to invoke
  ↓
[RAG Pipeline in EACH Specialized Agent]:
  1. Agent receives original query + orchestrator instructions
  2. Generate embedding (local model in OWUI)
  3. Call Obsidian MCP: vector-search(query, limit=100, collection=agent-specific)
  4. Prune results using query-context-pruner (agent can use agent-specific prompts)
  5. Agent generates response with its specialized context
  ↓
Each agent returns response to orchestrator
  ↓
Orchestrator synthesizes multi-agent responses
  ↓
Return to user
```

**Pros**:
- ✅ Domain-specific context for each agent
- ✅ Can search different Qdrant collections per agent
- ✅ Agent-specific pruning strategies
- ✅ More accurate specialized responses

**Cons**:
- ❌ Multiple RAG calls per query (slower)
- ❌ More complex OWUI configuration
- ❌ Higher token usage across agents

### Option 3: Hybrid (Best of Both)
**Flow**:
```
User query
  ↓
Orchestrator Agent receives query
  ↓
[Orchestrator RAG - High-level context]:
  1. Call Obsidian MCP: vector-search(query, limit=20)
  2. Quick pruning for routing decisions
  3. Orchestrator understands query intent + available context
  ↓
Orchestrator determines which specialized agents to invoke
  ↓
[Each Specialized Agent RAG - Deep context]:
  1. Agent receives query + orchestrator's high-level context
  2. Call Obsidian MCP: vector-search(query, limit=50, collection=agent-specific)
  3. Agent-specific pruning
  4. Agent generates detailed response
  ↓
Orchestrator synthesizes responses
  ↓
Return to user
```

**Pros**:
- ✅ Best accuracy (2-stage retrieval)
- ✅ Orchestrator makes informed routing decisions
- ✅ Agents get specialized deep context
- ✅ Balances efficiency and quality

**Cons**:
- ❌ Most complex to setup
- ❌ Highest latency (multiple RAG calls)

**Recommendation**: Start with **Option 1** (orchestrator-level RAG), migrate to **Option 3** (hybrid) once you understand your query patterns.

---

## Model Recommendations

### 1. Embedding Model (Running in OWUI)
**nomic-embed-text-v1.5**
```bash
ollama pull nomic-embed-text
```
- Use in OWUI's RAG configuration
- 768 dimensions
- Fast, accurate

### 2. Pruning/Reranking Model
**query-context-pruner-multilingual-Qwen3-4B**
```bash
# Download GGUF from HuggingFace
cd ~/.ollama/models
wget https://huggingface.co/mradermacher/query-context-pruner-multilingual-Qwen3-4B-GGUF/resolve/main/query-context-pruner-multilingual-Qwen3-4B.Q5_K_M.gguf

# Create Modelfile
cat > Modelfile <<EOF
FROM ./query-context-pruner-multilingual-Qwen3-4B.Q5_K_M.gguf
PARAMETER temperature 0.1
PARAMETER top_p 0.95
EOF

# Import to Ollama
ollama create query-pruner -f Modelfile
```

**How to use in OWUI RAG pipeline**:
OWUI doesn't have built-in pruning model support yet, so you'll need to use a custom function or pipeline. See below for workaround.

### 3. Orchestrator Agent Model
**Qwen2.5-14B-Instruct** or **Llama-3.3-70B-Instruct**
```bash
# Balanced option
ollama pull qwen2.5:14b-instruct-q5_K_M

# Maximum quality option (if you have memory)
ollama pull llama3.3:70b-instruct-q3_K_M
```
- Excellent at coordination
- Strong reasoning for agent routing
- 128k context window

### 4. Specialized Agent Models
**Option A: All agents share Qwen2.5-7B** (Simpler)
```bash
ollama pull qwen2.5:7b-instruct-q5_K_M
```
- 5GB per instance
- Fast (60-80 tok/sec)
- Good enough for domain-specific tasks

**Option B: Mixed models** (More specialized)
- **People, Journal, Goals**: Qwen2.5-7B
- **Code**: DeepSeek-Coder-V2-Lite-16B
- **Food, Games, Experiences**: Qwen2.5-3B (lighter, still capable)

---

## OpenWebUI Setup

### Step 1: Configure RAG in OWUI

OpenWebUI has built-in RAG support. Configure it to use your Obsidian MCP server:

**Admin Panel → Documents → Settings**:
```yaml
Vector DB: Qdrant
URL: http://your-nas-ip:6333
API Key: your-api-key
Collection: obsidian-vault
Embedding Model: nomic-embed-text (via Ollama)
Chunk Size: 1000
Chunk Overlap: 200
```

### Step 2: Create Orchestrator Agent

**Admin Panel → Workspace → Agents → New Agent**:

```yaml
Name: Orchestrator
Model: qwen2.5:14b-instruct-q5_K_M
Temperature: 0.7
Context Length: 32768

System Prompt: |
  You are the Orchestrator Agent for a personal knowledge management system.

  Your responsibilities:
  1. Understand user queries and determine which specialized agents to invoke
  2. Coordinate between multiple specialized agents
  3. Synthesize responses from multiple agents into coherent answers
  4. You have access to the user's Obsidian vault via RAG

  Available specialized agents:
  - People: Manages contacts, relationships, social interactions
  - Journal: Handles daily logs, reflections, time-based queries
  - Goals: Tracks objectives, progress, achievements
  - Food: Manages recipes, meal planning, nutrition
  - Code: Handles programming projects, technical docs
  - Games: Tracks gaming experiences, reviews
  - Experiences: Manages travel, events, memorable moments

  When routing queries:
  - Simple queries: Invoke 1 agent
  - Complex queries: Invoke multiple agents and synthesize results
  - Always explain your reasoning for agent selection

RAG Settings:
  Enabled: true
  Top K: 20 (after pruning, you want top results)
  Relevance Threshold: 0.7

Tools (MCP):
  - Add Obsidian MCP server endpoint (see Step 4)
```

### Step 3: Create Specialized Agents

**Example: People Agent**

```yaml
Name: People Agent
Model: qwen2.5:7b-instruct-q5_K_M
Temperature: 0.7
Context Length: 16384

System Prompt: |
  You are the People Agent, specialized in managing personal relationships and contacts.

  Your expertise:
  - Contact information and relationship history
  - Communication patterns and interaction tracking
  - Social context and relationship dynamics
  - Event planning involving people

  You search the "people-collection" in Qdrant for relevant context.
  Use the Obsidian MCP tools to create/update people notes.

  Always be concise and relationship-focused in your responses.

RAG Settings:
  Enabled: true
  Collection: people-collection (if you've setup multi-collection)
  Top K: 10
  Relevance Threshold: 0.75

Tools (MCP):
  - Add Obsidian MCP server endpoint
```

Repeat for all 7 specialized agents with their own system prompts.

### Step 4: Connect Obsidian MCP Server to OWUI

OpenWebUI supports MCP tools via the "Functions" feature:

**Admin Panel → Workspace → Functions → New Function**:

```python
"""
title: Obsidian Vector Search
author: your-name
version: 0.1.0
"""

import requests
from typing import Optional

class Tools:
    def __init__(self):
        self.mcp_endpoint = "http://localhost:3000/tools"

    def vector_search(
        self,
        query: str,
        limit: int = 20,
        collection: str = "obsidian-vault",
        __user__: dict = {}
    ) -> str:
        """
        Search the Obsidian vault using semantic search.

        :param query: The search query
        :param limit: Number of results to return
        :param collection: Qdrant collection to search
        """
        response = requests.post(
            f"{self.mcp_endpoint}/vector-search",
            json={
                "query": query,
                "limit": limit,
                "collection": collection
            }
        )

        if response.status_code == 200:
            results = response.json()
            # Format results for context
            formatted = []
            for r in results.get('results', []):
                formatted.append(
                    f"[{r['metadata']['fileName']}] (score: {r['score']:.2f})\n{r['content']}"
                )
            return "\n\n---\n\n".join(formatted)
        else:
            return f"Error searching vault: {response.text}"

    def create_note(
        self,
        path: str,
        content: str,
        frontmatter: Optional[dict] = None,
        __user__: dict = {}
    ) -> str:
        """
        Create a new note in the Obsidian vault.

        :param path: File path (e.g., "Notes/New Note.md")
        :param content: Note content
        :param frontmatter: Optional YAML frontmatter as dict
        """
        response = requests.post(
            f"{self.mcp_endpoint}/create-note",
            json={
                "path": path,
                "content": content,
                "frontmatter": frontmatter
            }
        )

        if response.status_code == 200:
            return f"Created note: {path}"
        else:
            return f"Error creating note: {response.text}"
```

### Step 5: Configure Agent Intercommunication

**In Orchestrator Agent Settings**:
```yaml
Agent Tools:
  - Enable "Call Other Agents"
  - Add all 7 specialized agents to available tools
```

**Example orchestrator prompt with agent calls**:
```
User query: "What projects am I working on and who am I collaborating with?"

Orchestrator reasoning:
- This requires both Code agent (for projects) and People agent (for collaborators)
- I'll invoke both agents in parallel

[Calls Code Agent with query: "What are my active projects?"]
[Calls People Agent with query: "Who am I collaborating with on projects?"]

[Receives responses from both agents]
[Synthesizes into unified response]
```

---

## Handling Async Operations & Latency in OWUI

### OWUI's Built-in Async Handling

OpenWebUI already handles async operations gracefully:

1. **Streaming Responses**: OWUI streams tokens as they're generated
2. **Tool Calls**: When agents call tools (like your MCP server), OWUI shows loading states
3. **Multi-Agent Calls**: When orchestrator calls specialized agents, OWUI handles sequential/parallel execution

**User Experience**:
```
User: "Find my project notes and create a summary"
  ↓
[Orchestrator Agent is thinking...] ← OWUI shows this
  ↓
[Calling tool: vector_search...] ← Shows tool execution
  ↓ (2-3 seconds for RAG retrieval)
[Tool completed. Results: 10 documents found]
  ↓
[Calling agent: Code Agent...] ← Shows agent invocation
  ↓ (1-2 seconds for agent processing)
[Agent completed]
  ↓
[Generating response...] ← Streaming response starts
"I found 10 relevant project documents..." ← Tokens stream in real-time
```

### Pruning Model Integration

**Challenge**: OWUI doesn't have built-in pruning/reranking model support yet.

**Workaround Options**:

**Option A: Prune in Obsidian Plugin (Simplest)**

Add pruning to your `vector-search` tool:

```typescript
// In main.ts
async vectorSearch(query: string, limit: number = 20) {
  // 1. Generate embedding
  const embedding = await this.generateEmbedding(query);

  // 2. Over-retrieve from Qdrant
  const results = await this.qdrant.search({
    collection: 'obsidian-vault',
    vector: embedding,
    limit: limit * 5 // Get 5x more results
  });

  // 3. Call pruning model (local Ollama)
  const pruned = await this.pruneResults(query, results, limit);

  return pruned;
}

async pruneResults(query: string, results: any[], targetCount: number) {
  // Format for pruning model
  const context = results.map((r, i) =>
    `[${i}] ${r.content}`
  ).join('\n\n');

  const prompt = `Query: ${query}\n\nContext:\n${context}\n\nSelect the ${targetCount} most relevant passages by their indices.`;

  const response = await fetch('http://localhost:11434/api/generate', {
    method: 'POST',
    body: JSON.stringify({
      model: 'query-pruner',
      prompt: prompt,
      stream: false
    })
  });

  const indices = parseIndices(response.json().response);
  return indices.map(i => results[i]);
}
```

**Option B: Prune in OWUI Function (More Control)**

Add pruning to the OWUI function:

```python
class Tools:
    def vector_search_with_pruning(
        self,
        query: str,
        limit: int = 20,
        collection: str = "obsidian-vault",
        __user__: dict = {}
    ) -> str:
        # 1. Retrieve more results than needed
        results = self._retrieve_from_obsidian(query, limit * 5, collection)

        # 2. Call pruning model
        pruned = self._prune_with_model(query, results, limit)

        # 3. Format for context
        return self._format_results(pruned)

    def _prune_with_model(self, query: str, results: list, target: int) -> list:
        # Call local Ollama pruning model
        context = "\n\n".join([f"[{i}] {r['content']}" for i, r in enumerate(results)])

        response = requests.post(
            "http://localhost:11434/api/generate",
            json={
                "model": "query-pruner",
                "prompt": f"Query: {query}\n\nContext:\n{context}\n\nSelect the {target} most relevant passages by their indices.",
                "stream": False
            }
        )

        indices = self._parse_indices(response.json()['response'])
        return [results[i] for i in indices if i < len(results)]
```

**Option C: Use OWUI's Pipeline Feature (Most Flexible)**

OWUI has a "Pipelines" feature for custom processing:

Create a pipeline: `~/.ollama/pipelines/rag_with_pruning.py`

```python
from typing import List, Optional
import requests

class Pipeline:
    def __init__(self):
        self.name = "RAG with Pruning"
        self.obsidian_mcp = "http://localhost:3000/tools"
        self.pruning_model = "query-pruner"

    async def pipe(
        self,
        body: dict,
        __user__: Optional[dict] = None
    ) -> dict:
        messages = body.get("messages", [])
        user_query = messages[-1]["content"]

        # 1. Retrieve from Obsidian
        results = self._retrieve(user_query, limit=100)

        # 2. Prune results
        pruned = self._prune(user_query, results, limit=20)

        # 3. Inject into context
        context = self._format_context(pruned)
        messages.insert(-1, {
            "role": "system",
            "content": f"Relevant context from vault:\n\n{context}"
        })

        body["messages"] = messages
        return body
```

Then in OWUI agent settings, select this pipeline as the preprocessing step.

---

## Obsidian Plugin Changes Needed

Your plugin should be **minimal**:

### Update `main.ts` to Support Multi-Collection

```typescript
interface MCPPluginSettings {
  vectorSync: {
    enabled: boolean;
    qdrantUrl: string;
    qdrantApiKey?: string;

    // Support multiple collections
    collections: Array<{
      name: string;
      syncRules: SyncRule[];
      dimension: number;
    }>;

    // Use local embedding endpoint (Ollama)
    embeddingEndpoint: string; // http://localhost:11434/api/embeddings
    embeddingModelName: string; // nomic-embed-text

    chunkSize: number;
    overlapSize: number;
  };
}

// Default collections for your 7 agents
DEFAULT_COLLECTIONS = [
  {
    name: 'obsidian-vault',
    syncRules: [{ type: 'extension', pattern: '*.md', exclude: ['templates/', 'archive/'] }],
    dimension: 768
  },
  {
    name: 'people-collection',
    syncRules: [{ type: 'folder', pattern: 'People/**' }],
    dimension: 768
  },
  {
    name: 'journal-collection',
    syncRules: [{ type: 'folder', pattern: 'Journal/**' }],
    dimension: 768
  },
  {
    name: 'code-collection',
    syncRules: [
      { type: 'folder', pattern: 'Code/**' },
      { type: 'pattern', pattern: '**/*.{js,ts,py,md}', tags: ['code'] }
    ],
    dimension: 768
  },
  // ... goals, food, games, experiences collections
];
```

### Update `vector-search` Tool

```typescript
async vectorSearch(params: {
  query: string;
  limit?: number;
  collection?: string;
  scoreThreshold?: number;
}) {
  const {
    query,
    limit = 20,
    collection = 'obsidian-vault',
    scoreThreshold = 0.7
  } = params;

  // Generate embedding using local Ollama
  const embedding = await this.generateEmbedding(query);

  // Search specific collection
  const results = await this.qdrant.search({
    collection_name: collection,
    vector: embedding,
    limit: limit,
    score_threshold: scoreThreshold
  });

  return {
    query,
    collection,
    count: results.length,
    results: results.map(r => ({
      content: r.payload.content,
      score: r.score,
      metadata: {
        filePath: r.payload.filePath,
        fileName: r.payload.fileName,
        chunkIndex: r.payload.chunkIndex,
        ...r.payload
      }
    }))
  };
}
```

### Update Embedding Generation

```typescript
async generateEmbedding(text: string): Promise<number[]> {
  const endpoint = this.settings.vectorSync.embeddingEndpoint;
  const model = this.settings.vectorSync.embeddingModelName;

  const response = await fetch(`${endpoint}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: model,
      prompt: text
    })
  });

  const data = await response.json();
  return data.embedding;
}
```

---

## LibreChat as Client

LibreChat is a **great choice** for your use case:

### Pros
- ✅ Open source, self-hosted
- ✅ OpenAI-compatible API (works with OWUI)
- ✅ Multi-platform (web, desktop, mobile)
- ✅ Conversation management
- ✅ Can connect directly to OWUI's API endpoint
- ✅ Beautiful UI, similar to ChatGPT
- ✅ Supports custom endpoints and agents

### Setup LibreChat → OWUI

**LibreChat Configuration** (`.env`):
```bash
# Point to your OWUI instance
OPENAI_API_KEY=your-owui-api-key
OPENAI_REVERSE_PROXY=http://your-mac-studio-ip:3000/ollama/v1

# Or directly to specific agent
CUSTOM_API_KEY=your-owui-api-key
CUSTOM_ENDPOINT=http://your-mac-studio-ip:3000/api/chat
```

**OWUI API Key**:
1. OWUI → Settings → Account → API Keys
2. Generate new key
3. Use in LibreChat

### Alternative: Tailscale + Mobile PWA

If you want mobile access:
- Install Tailscale on Mac Studio and mobile devices
- Access OWUI directly via Tailscale IP
- OWUI has responsive web UI that works on mobile
- No need for separate client

---

## Timeline & Implementation Steps

### Phase 1: Setup OWUI + Basic RAG (Week 1)
1. ✅ Install OpenWebUI on Mac Studio
2. ✅ Pull all models (nomic-embed-text, qwen2.5, query-pruner)
3. ✅ Configure OWUI to connect to Qdrant on NAS
4. ✅ Update Obsidian plugin to use local embeddings (Ollama)
5. ✅ Test basic vector search from OWUI

### Phase 2: Create Agents (Week 2)
1. ✅ Create orchestrator agent in OWUI
2. ✅ Create 7 specialized agents with system prompts
3. ✅ Enable agent-to-agent communication
4. ✅ Test simple queries through orchestrator

### Phase 3: Add MCP Tools (Week 3)
1. ✅ Create OWUI functions for Obsidian MCP tools
2. ✅ Test create-note, vector-search from agents
3. ✅ Setup multi-collection support in Obsidian plugin
4. ✅ Configure each agent to use correct collection

### Phase 4: Add Pruning (Week 4)
1. ✅ Import query-context-pruner model to Ollama
2. ✅ Implement pruning in Obsidian plugin or OWUI function
3. ✅ Benchmark quality improvement
4. ✅ Tune pruning parameters per agent

### Phase 5: Add Client (Week 5)
1. ✅ Install LibreChat
2. ✅ Connect to OWUI API
3. ✅ Test cross-device access
4. ✅ Setup Tailscale for mobile access

---

## Summary: Your Actual Architecture

| Component | Location | Responsibility |
|-----------|----------|----------------|
| **LibreChat** | Desktop/Web | Chat UI, connects to OWUI |
| **Orchestrator Agent** | OpenWebUI (Mac Studio) | Query routing, agent coordination |
| **7 Specialized Agents** | OpenWebUI (Mac Studio) | Domain-specific responses with RAG |
| **RAG + Pruning** | OpenWebUI (Mac Studio) | Embedding, search, result pruning |
| **Obsidian Plugin** | Mac Studio | Vault sync, MCP tools, task execution |
| **Qdrant** | Unraid NAS | Vector storage (8 collections) |
| **PostgreSQL/Redis** | Unraid NAS | Agent memory, context cache |

**Key Insight**: Your Obsidian plugin is just a **data provider and task executor**, not the agent host. All intelligence lives in OWUI.

Does this architecture match your vision? Want me to help implement any specific part?
