# Product Roadmap - Obsidian MCP Macros V2

## Phase 1: Foundation & Infrastructure

1. [ ] Custom Agent Protocol Design - Define lightweight protocol spec with request/response formats, streaming support, and error handling. Create TypeScript and Python client libraries for protocol implementation. `S`

2. [ ] Mac Studio Agent Runtime Setup - Install Ollama with Llama 3.1 models (70B for orchestrator, 8B for sub-agents). Create Python agent base class with LangChain integration and protocol support. Set up development environment with debugging capabilities. `M`

3. [ ] Unraid Service Deployment - Deploy PostgreSQL for agent memory, Redis for conversation context, and upgrade Qdrant configuration for multi-collection RAG. Configure Docker Compose with Tailscale networking and persistent storage. `M`

4. [ ] Enhanced Vector Sync System - Extend existing Qdrant integration to support multiple collections (one per note system). Implement semantic chunking by note structure with metadata preservation. Add collection management UI in plugin settings. `M`

5. [ ] Agent Memory System - Build PostgreSQL schema for conversation history, user preferences, and agent-specific metadata. Create Redis integration for active conversation state with TTL management. Implement memory APIs for read/write with LangChain memory integration. `M`

## Phase 2: Core Agent System

6. [ ] Orchestrator Agent - Build primary conversational agent with routing logic to determine which sub-agents to invoke. Implement context management across conversations and multi-step task coordination. Add streaming response support for real-time user feedback. `L`

7. [ ] People/Network Agent - Create specialized agent for managing contact notes with QuickAdd integration. Implement RAG over people collection, relationship tracking, and context-aware note updates. Add queries like "Who did I meet in Q3?" and "Update meeting notes with Sarah". `M`

8. [ ] Journal/Calendar Agent - Build agent for daily journal entries and calendar integration. Support queries like "What did I do last week?", automatic journal entry creation, and goal/project cross-references from journal entries. `M`

9. [ ] Goals/Projects Agent - Create agent for goal tracking and project management notes. Implement project status queries, milestone tracking, automatic journal cross-referencing, and progress summaries. Support multi-project queries and prioritization. `M`

10. [ ] Agent Coordination Framework - Build inter-agent communication system for tasks requiring multiple agents (e.g., "Log meeting with Sarah in journal and update her contact note"). Implement shared context passing, parallel agent execution with result aggregation, and error handling for partial failures. `L`

## Phase 3: Specialized Agents & Intelligence

11. [ ] Food & Restaurants Agent - Create agent for restaurant reviews and meal tracking. Support queries like "Best sushi places I've tried", recipe note management, and dietary preference tracking. `S`

12. [ ] Code Bug Archive Agent - Build agent for technical problem-solving notes and code snippets. Implement semantic search over code examples, solution retrieval by error message, and automatic tagging/categorization. `S`

13. [ ] Games & Media Tracking Agent - Create agent for games, movies, books, and media consumption tracking. Support queries like "Games I'm currently playing", recommendation based on past enjoyment, and completion status tracking. `S`

14. [ ] Experiences & Friends Agent - Build agent for event memories, friend interactions, and social experiences. Support temporal queries ("What did we do for my birthday last year?") and relationship context tracking. `S`

15. [ ] Enhanced RAG with Re-ranking - Implement two-stage RAG with initial vector search and LLM-based re-ranking for higher quality results. Add query expansion and semantic caching for common queries. `M`

## Phase 4: Mobile Integration

16. [ ] Mobile PWA Foundation - Build Next.js PWA with responsive UI for text chat interface. Implement authentication with Tailscale integration and WebSocket streaming for real-time responses. Deploy to Mac Studio with HTTPS support. `M`

17. [ ] Voice Input Integration - Integrate Whisper.cpp on Mac Studio for speech-to-text processing. Add Web Speech API support in PWA for iOS integration. Implement noise filtering and command detection for better accuracy. `M`

18. [ ] Mobile Voice Interface - Create voice-first UI mode in PWA with push-to-talk and hands-free modes. Add conversation history with voice/text mixed context and offline request queuing with background sync. `M`

19. [ ] Mobile Quick Actions - Implement common shortcut actions (quick journal entry, add person note, check goal progress). Add iOS Shortcuts integration for voice commands and widget support for vault stats. `S`

## Phase 5: Polish & Advanced Features

20. [ ] Agent Learning System - Build feedback loop for agents to learn user preferences (note structure, language style, preferred information density). Store learned patterns in PostgreSQL and apply to future interactions. `M`

21. [ ] Multi-Modal Support - Add image processing for photo notes and OCR for scanned documents. Support voice note transcription and automatic insertion into appropriate note types. `L`

22. [ ] Advanced Task Automation - Create scheduled agent tasks (weekly journal summaries, monthly goal reviews, contact relationship maintenance reminders). Build workflow templates for common multi-agent operations. `M`

23. [ ] Monitoring & Observability - Deploy Prometheus and Grafana on Unraid for agent performance metrics. Add logging infrastructure (Loki) and create dashboards for system health, LLM token usage, and agent response times. `S`

24. [ ] Performance Optimization - Implement response caching for common queries, optimize LLM inference with quantization/batching, and add parallel agent execution improvements. Profile and optimize critical paths. `M`

## Phase 6: Ecosystem & Extensibility

25. [ ] Custom Agent Builder - Create toolkit for users to define new specialized agents for custom note systems. Provide agent template with RAG configuration and simple DSL for agent behavior definition. `L`

26. [ ] Plugin API for External Integrations - Build API for other Obsidian plugins to query agents or trigger actions. Enable Calendar plugin, Dataview, and other popular plugin integrations. `M`

27. [ ] Agent Marketplace/Sharing - Create system for exporting/importing agent configurations. Build community repository for sharing agent templates and QuickAdd macro integrations. `M`

## System Architecture Diagram

```
┌─────────────────────────────────────────────────────────────┐
│                        USER LAYER                            │
├──────────────────┬────────────────────────┬─────────────────┤
│  Desktop         │   Phone (iOS)          │  Voice          │
│  Obsidian UI     │   PWA Web Interface    │  Input          │
└────────┬─────────┴───────────┬────────────┴─────────┬───────┘
         │                     │                      │
         │              Tailscale VPN Network         │
         │                     │                      │
┌────────▼─────────────────────▼──────────────────────▼───────┐
│                    MAC STUDIO (Primary Compute)              │
├──────────────────────────────────────────────────────────────┤
│  ┌────────────────────────────────────────────────────┐     │
│  │         Obsidian MCP Macros Plugin                 │     │
│  │  • Custom HTTP Server (CLAP Protocol)              │     │
│  │  • QuickAdd Integration                            │     │
│  │  • Vector Sync Manager                             │     │
│  │  • Vault File Operations                           │     │
│  └──────────┬─────────────────────────────────────────┘     │
│             │                                                │
│  ┌──────────▼─────────────────────────────────────────┐     │
│  │      Orchestrator Agent (Python/LangChain)         │     │
│  │  • Task routing to specialized agents              │     │
│  │  • Multi-agent coordination                        │     │
│  │  • Context management                              │     │
│  │  • Streaming response aggregation                  │     │
│  └──────────┬─────────────────────────────────────────┘     │
│             │                                                │
│  ┌──────────▼─────────────────────────────────────────┐     │
│  │         Ollama LLM Runtime                         │     │
│  │  • Llama 3.1 70B (orchestrator)                    │     │
│  │  • Llama 3.1 8B (sub-agents)                       │     │
│  │  • nomic-embed-text (embeddings)                   │     │
│  └────────────────────────────────────────────────────┘     │
│                                                              │
│  ┌──────────────────────────────────────────────────────┐   │
│  │         Whisper.cpp (Voice Processing)               │   │
│  └──────────────────────────────────────────────────────┘   │
│                                                              │
│  ┌──────────────────────────────────────────────────────┐   │
│  │         Mobile PWA Web Server (Next.js)              │   │
│  └──────────────────────────────────────────────────────┘   │
└───────────┬──────────────────────────────────────────────────┘
            │
            │ CLAP Protocol over Tailscale
            │
┌───────────▼──────────────────────────────────────────────────┐
│              UNRAID NAS (Supporting Services)                │
├──────────────────────────────────────────────────────────────┤
│  ┌──────────────────────────────────────────────────────┐   │
│  │     Specialized Agents (Docker Containers)           │   │
│  │  ┌──────────────┐  ┌──────────────┐  ┌────────────┐ │   │
│  │  │   People/    │  │  Journal/    │  │   Goals/   │ │   │
│  │  │   Network    │  │  Calendar    │  │  Projects  │ │   │
│  │  └──────────────┘  └──────────────┘  └────────────┘ │   │
│  │  ┌──────────────┐  ┌──────────────┐  ┌────────────┐ │   │
│  │  │    Food/     │  │   Code Bug   │  │   Games/   │ │   │
│  │  │ Restaurants  │  │   Archive    │  │   Media    │ │   │
│  │  └──────────────┘  └──────────────┘  └────────────┘ │   │
│  │  ┌──────────────┐                                    │   │
│  │  │ Experiences/ │                                    │   │
│  │  │   Friends    │                                    │   │
│  │  └──────────────┘                                    │   │
│  └──────────────────────────────────────────────────────┘   │
│                                                              │
│  ┌──────────────────────────────────────────────────────┐   │
│  │        Qdrant Vector Database (Docker)               │   │
│  │  • People collection                                 │   │
│  │  • Journal collection                                │   │
│  │  • Goals collection                                  │   │
│  │  • [Other collections per note system]               │   │
│  └──────────────────────────────────────────────────────┘   │
│                                                              │
│  ┌──────────────────────────────────────────────────────┐   │
│  │        PostgreSQL (Docker)                           │   │
│  │  • Conversation history                              │   │
│  │  • User preferences                                  │   │
│  │  • Agent metadata & learned patterns                 │   │
│  └──────────────────────────────────────────────────────┘   │
│                                                              │
│  ┌──────────────────────────────────────────────────────┐   │
│  │        Redis (Docker)                                │   │
│  │  • Active conversation context                       │   │
│  │  • Agent coordination events                         │   │
│  │  • Session management                                │   │
│  └──────────────────────────────────────────────────────┘   │
│                                                              │
│  ┌──────────────────────────────────────────────────────┐   │
│  │    Monitoring Stack (Docker)                         │   │
│  │  • Prometheus (metrics)                              │   │
│  │  • Grafana (dashboards)                              │   │
│  │  • Loki (logs)                                       │   │
│  └──────────────────────────────────────────────────────┘   │
└──────────────────────────────────────────────────────────────┘
```

## Data Flow Examples

### Example 1: Simple Query
```
User (Phone): "Who did I meet in Q3?"
  → Orchestrator Agent (Mac Studio)
    → People Agent (Unraid)
      → Qdrant RAG search (people collection)
      → PostgreSQL (meeting metadata)
    ← Response: List of people with dates
  ← Orchestrator aggregates and formats
← User receives answer
```

### Example 2: Multi-Agent Coordination
```
User (Desktop): "Log meeting with Sarah about project X,
                 update both our notes and project status"
  → Orchestrator Agent (Mac Studio)
    ├→ Journal Agent (Unraid)
    │   → Create journal entry via QuickAdd
    │   → Link to person and project notes
    ├→ People Agent (Unraid)
    │   → Update Sarah's note with meeting summary
    │   → Update last contact date
    └→ Goals/Projects Agent (Unraid)
        → Update Project X status note
        → Link to today's journal entry
  ← All agents complete
  ← Orchestrator confirms all updates
← User sees success message with links
```

### Example 3: Voice Query with RAG
```
User (Phone/Voice): "What did I work on last Tuesday?"
  → Whisper.cpp transcription (Mac Studio)
  → Orchestrator Agent (Mac Studio)
    → Journal Agent (Unraid)
      → Qdrant semantic search (journal collection)
      → Parse specific date from query
      → Retrieve journal note + linked projects
    ← Journal content with project links
  ← Orchestrator formats for voice response
← User hears summary (optional TTS)
```

## Migration Path from V1 to V2

### V1 Current State
- Single MCP server in Obsidian plugin
- QuickAdd function exposure via MCP tools
- Basic vector sync with Qdrant
- HTTP transport for external clients
- OpenAPI spec generation

### V2 Changes
- Custom protocol (CLAP) replaces MCP
- Distributed agents (orchestrator + specialized)
- Enhanced multi-collection vector RAG
- Agent memory and learning system
- Mobile PWA with voice support
- Infrastructure split: Mac Studio + Unraid

### Migration Strategy
1. Keep V1 running during V2 development (parallel systems)
2. Develop V2 on separate port/endpoint
3. Migrate QuickAdd functions to new protocol incrementally
4. Test with single note system (e.g., Journal) before rolling out all agents
5. Cut over when V2 reaches feature parity + mobile support
6. Maintain V1 compatibility layer for external tools if needed

## Success Metrics

- Agent response time < 2 seconds for simple queries
- RAG relevance > 80% (user feedback)
- Voice transcription accuracy > 95% for commands
- Mobile PWA load time < 1 second on phone
- Zero data leaving Tailscale network
- System uptime > 99% (Mac Studio + Unraid)
- User performs 10+ agent interactions per day (adoption)
