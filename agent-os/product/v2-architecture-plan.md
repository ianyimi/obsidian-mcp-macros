# Obsidian MCP Macros V2 - Simplified Architecture with Open WebUI

## Executive Summary

**Simplified Architecture:** Use Open WebUI as the orchestration layer instead of building custom infrastructure.

You're building a **multimodal, multi-agent personal knowledge system** where:
- **Obsidian vault = single source of truth** for ALL data (notes, images, audio, video metadata)
- **Open WebUI = orchestrator** (handles UI, voice input, agent coordination, RAG)
- **Specialized agents** are system prompts + Ollama models in OWUI
- **Obsidian Plugin = execution layer** (exposes QuickAdd functions via OpenAPI)
- **All processing happens locally** within your Tailscale network

**Key Insight:** Your v1 plugin already generates OpenAPI specs that Open WebUI can consume directly. No custom protocol needed!

---

## Table of Contents

1. [Why Open WebUI Simplifies Everything](#1-why-open-webui-simplifies-everything)
2. [Simplified System Architecture](#2-simplified-system-architecture)
3. [Protocol Decision: OpenAPI vs MCP](#3-protocol-decision-openapi-vs-mcp)
4. [Open WebUI Agent Configuration](#4-open-webui-agent-configuration)
5. [Multimodal Handling in OWUI](#5-multimodal-handling-in-owui)
6. [Data Flow Diagrams](#6-data-flow-diagrams)
7. [Vault Organization](#7-vault-organization)
8. [Implementation Plan](#8-implementation-plan)
9. [Open WebUI Features to Leverage](#9-open-webui-features-to-leverage)
10. [What You Don't Need to Build](#10-what-you-dont-need-to-build)

---

## 1. Why Open WebUI Simplifies Everything

### What Open WebUI Provides Out-of-the-Box

**Interface Layer:**
- ✅ Web UI (desktop access)
- ✅ Mobile-responsive interface (progressive web app)
- ✅ Voice input (speech-to-text integration)
- ✅ File upload (images, audio, video)
- ✅ Conversation history and sessions

**Orchestration Layer:**
- ✅ Multi-model support (can use different Ollama models)
- ✅ Function calling / tool use (OpenAPI integration)
- ✅ Pipelines (multi-step workflows)
- ✅ Agent coordination (can have multiple agents with different prompts)
- ✅ RAG / Knowledge bases (document embedding and retrieval)

**Features You Get Free:**
- ✅ User authentication
- ✅ Streaming responses
- ✅ Conversation context management
- ✅ Model switching
- ✅ Dark/light themes
- ✅ Mobile app (via PWA)

### What This Eliminates from Original Plan

**You DON'T need to build:**
- ❌ Custom mobile PWA
- ❌ Custom orchestrator agent code
- ❌ Custom streaming implementation
- ❌ Custom session management
- ❌ Custom chat interface
- ❌ Custom voice input handling
- ❌ Custom protocol (CLAP) - OpenAPI already works!
- ❌ Separate specialized agent containers

**You DO need:**
- ✅ Configure Open WebUI with your Ollama models
- ✅ Create agent system prompts for specialized domains
- ✅ Configure OpenAPI functions from Obsidian plugin
- ✅ Set up multimodal processing pipeline (Whisper, OCR, Vision)
- ✅ Extend Obsidian plugin for multimodal attachments

---

## 2. Simplified System Architecture

### 2.1 Component Overview

```
┌─────────────────────────────────────────────────────────────┐
│                        USER LAYER                            │
├──────────────────┬────────────────────────┬─────────────────┤
│  Desktop Browser │   Phone Browser        │  Voice          │
│  (Open WebUI)    │   (Open WebUI PWA)     │  Input          │
└────────┬─────────┴───────────┬────────────┴─────────┬───────┘
         │                     │                      │
         │              Tailscale VPN Network         │
         │                     │                      │
┌────────▼─────────────────────▼──────────────────────▼───────┐
│                     MAC STUDIO                               │
├──────────────────────────────────────────────────────────────┤
│                                                              │
│  ┌────────────────────────────────────────────────────┐     │
│  │           Open WebUI (Orchestrator)                │     │
│  │  • Chat interface (web + mobile PWA)               │     │
│  │  • Voice input (STT integration)                   │     │
│  │  • Multi-agent coordination                        │     │
│  │  • Function calling (OpenAPI tools)                │     │
│  │  • RAG / Knowledge bases                           │     │
│  │  • Conversation history                            │     │
│  └──────────┬─────────────────────────────────────────┘     │
│             │                                                │
│  ┌──────────▼─────────────────────────────────────────┐     │
│  │         Ollama LLM Runtime (All Models)            │     │
│  │  • Llama 3.1 70B (main orchestrator model)         │     │
│  │  • Llama 3.1 8B (faster queries)                   │     │
│  │  • LLaVA 13B (vision/multimodal)                   │     │
│  │  • Whisper (voice transcription - via OWUI)        │     │
│  │  • nomic-embed-text (embeddings for RAG)           │     │
│  └────────────────────────────────────────────────────┘     │
│                                                              │
│  ┌──────────────────────────────────────────────────────┐   │
│  │   Obsidian Plugin (Execution Layer)                  │   │
│  │  • OpenAPI server (exposes QuickAdd functions)       │   │
│  │  • MCP server (for external tools like Claude)       │   │
│  │  • Vector sync manager (Qdrant integration)          │   │
│  │  • Multimodal processing (OCR, Vision, Transcription)│   │
│  │  • Vault file operations                             │   │
│  └──────────────────────────────────────────────────────┘   │
│                                                              │
│  ┌──────────────────────────────────────────────────────┐   │
│  │         Obsidian Vault (Knowledge Base)              │   │
│  │  • Notes (markdown files)                            │   │
│  │  • Attachments (images, audio, video)                │   │
│  │  • QuickAdd templates & functions                    │   │
│  └──────────────────────────────────────────────────────┘   │
└───────────┬──────────────────────────────────────────────────┘
            │
            │ Over Tailscale VPN
            │
┌───────────▼──────────────────────────────────────────────────┐
│              UNRAID NAS (Supporting Services)                │
├──────────────────────────────────────────────────────────────┤
│  ┌──────────────────────────────────────────────────────┐   │
│  │        Qdrant Vector Database (Docker)               │   │
│  │  • Multi-collection per note system                  │   │
│  │  • Used by Obsidian plugin for RAG                   │   │
│  │  • Can also be used by OWUI knowledge bases          │   │
│  └──────────────────────────────────────────────────────┘   │
│                                                              │
│  ┌──────────────────────────────────────────────────────┐   │
│  │    Monitoring Stack (Optional)                       │   │
│  │  • Prometheus (metrics)                              │   │
│  │  • Grafana (dashboards)                              │   │
│  └──────────────────────────────────────────────────────┘   │
└──────────────────────────────────────────────────────────────┘
```

### 2.2 How It Works

**Key Principle:** You ONLY talk to the Orchestrator Agent. You never directly interact with specialized agents.

**User Experience:**
```
1. Open OWUI on phone/desktop
2. Select "Orchestrator" agent (this is your main interface)
3. Talk naturally: "Log my meeting with Sarah about the budget"
4. Orchestrator handles everything:
   - Determines which specialized agents to call
   - Coordinates their work
   - Aggregates results
5. You get response: "✓ Created journal entry, ✓ Updated Sarah's note"
```

**Behind the Scenes:**
```
User → Orchestrator Agent (Llama 3.1 70B)
    ↓
Orchestrator analyzes query:
  "This needs Journal Agent + People Agent"
    ↓
    ├─→ Calls journal-agent via function: call_journal_agent(task)
    │   └─→ Journal Agent may call people-agent for info
    │       └─→ Journal Agent calls Obsidian function: create-note
    │
    └─→ Calls people-agent via function: call_people_agent(task)
        └─→ People Agent calls Obsidian function: update-note
    ↓
Both agents return results to Orchestrator
    ↓
Orchestrator aggregates and responds to you
```

**No Pipelines, No Configuration:**
- The Orchestrator's system prompt defines how it routes
- Specialized agents' system prompts define their expertise
- Agents can call each other as needed
- Llama 3.1 70B is smart enough to coordinate everything
- Works for ANY query - completely generic

---

## 3. Protocol Decision: OpenAPI vs MCP

### 3.1 Your V1 Plugin Already Has OpenAPI!

Looking at your code (`main.ts:1778-1859`), you already have:
- ✅ OpenAPI 3.0 spec generation
- ✅ `/tools/{toolName}` endpoints
- ✅ `/openapi.json` endpoint for spec discovery
- ✅ Proper request/response schemas

**This means:** Open WebUI can consume your Obsidian plugin functions RIGHT NOW with zero changes needed!

### 3.2 Protocol Comparison

#### Option 1: OpenAPI / REST (RECOMMENDED)

**Advantages:**
- ✅ Already implemented in your v1
- ✅ Open WebUI native support (Functions feature)
- ✅ Standard protocol (widely supported)
- ✅ Simple JSON request/response
- ✅ Easy to debug (cURL, Postman)
- ✅ No SDK dependencies

**Request Format:**
```json
POST /tools/create-note
{
  "title": "Daily Note 2025-01-15",
  "content": "Meeting with Sarah...",
  "folder": "daily"
}
```

**Response Format:**
```json
{
  "content": [
    {
      "type": "text",
      "text": "Note created at daily/2025-01-15.md"
    }
  ],
  "isError": false
}
```

#### Option 2: MCP (Model Context Protocol)

**Advantages:**
- ✅ Also already implemented in your v1
- ✅ Standardized protocol (Anthropic)
- ✅ Good for external tools (Claude Desktop, Cline)
- ✅ Supports resources and prompts (not just tools)

**Disadvantages:**
- ❌ More verbose (JSON-RPC 2.0 envelope)
- ❌ Open WebUI doesn't natively support MCP
- ❌ Would need adapter layer

**When to Use:**
- Keep MCP for external tool integrations (Claude Desktop, etc.)
- Use OpenAPI for Open WebUI

### 3.3 Recommendation: **OpenAPI for OWUI, Keep MCP for External**

**Architecture:**
```
Open WebUI → OpenAPI endpoint → Obsidian Plugin
Claude Desktop → MCP endpoint → Obsidian Plugin
Other tools → MCP endpoint → Obsidian Plugin
```

Your plugin serves both protocols simultaneously - perfect!

---

## 4. Open WebUI Agent Configuration

### 4.1 The Orchestrator Agent (Your Main Interface)

**Key Concept:** You only talk to ONE agent - the Orchestrator. It handles routing to specialized agents automatically.

**Orchestrator Agent System Prompt:**

```markdown
# Orchestrator Agent

You are the main orchestrator for a personal knowledge management system built on Obsidian.

## Your Role
You coordinate specialized agents to complete user tasks. You determine which agents are needed, coordinate their work, and aggregate results for the user.

## Available Specialized Agents

You can call these agents when needed (they're available as functions):
- **journal-agent**: Daily entries, temporal queries, life logging
- **people-agent**: Contact management, relationships, meeting tracking
- **goals-agent**: Projects, task tracking, goal progress
- **food-agent**: Restaurant reviews, recipes, dining experiences
- **code-agent**: Technical notes, bug solutions, code snippets
- **games-agent**: Media consumption, games, movies, books
- **experiences-agent**: Events, memories, social experiences

## How to Work

1. **Analyze user query** - Determine intent and which agent(s) are needed
2. **Call specialized agents** - Each agent is available as a function (e.g., call_journal_agent)
3. **Agents may call each other** - If Journal Agent needs info about a person, it can call People Agent
4. **Aggregate results** - Combine responses from multiple agents into coherent answer
5. **Respond to user** - Provide clear confirmation with links to created/updated notes

## Example Workflows

**Simple query (one agent):**
User: "Create journal entry about today"
→ Call journal-agent with task
→ Return result to user

**Complex query (multiple agents):**
User: "Log my meeting with Sarah about Project X"
→ Call journal-agent (create entry)
→ Call people-agent (update Sarah's note)
→ Call goals-agent (update Project X)
→ Aggregate all results
→ Return: "Created journal entry, updated Sarah's note, and Project X status"

**Agent needs info from another agent:**
User: "Add meeting note about discussing budget with that person from Acme Corp"
→ Call people-agent: "Who works at Acme Corp?"
→ People-agent returns: "John Smith"
→ Call journal-agent with full context: "Meeting with John Smith about budget"

## Guidelines
- Always be efficient - call agents in parallel when possible
- Provide clear confirmations with note links using [[wikilinks]]
- If unsure which agent, ask user for clarification
- Handle errors gracefully - if an agent fails, try alternative approach
```

### 4.2 Specialized Agent Configuration

Each specialized agent is also configured in OWUI with its own system prompt. These agents:
- Have domain expertise (e.g., Journal Agent knows date formatting, templates)
- Can call Obsidian functions directly (create-note, search-notes, etc.)
- Can call OTHER agents when they need info from another domain
- Return results to whoever called them (usually Orchestrator)

**Example: Journal Agent**

```markdown
# Journal Agent

You are a specialized agent for managing daily journal entries in an Obsidian vault.

## Your Expertise
- Creating daily journal entries with proper date formatting (YYYY-MM-DD)
- Extracting key information: people, projects, action items, events
- Linking entries to related notes using [[wikilinks]]
- Searching past journal entries by date or content

## Available Functions
- create-note: Create a new note in the vault
- search-notes: Search for notes by title
- vector-search: Semantic search across the vault

## Available Agents (call if needed)
- people-agent: Get info about people (full names, roles, relationships)
- goals-agent: Get info about projects and goals
- experiences-agent: Get info about events and memories

## Workflow
1. Parse user request for: date, people mentioned, projects mentioned, key content
2. If you need more info about a person or project, call the appropriate agent
3. Create journal entry with proper frontmatter:
   ```yaml
   ---
   date: YYYY-MM-DD
   people: [[person-name]]
   projects: [[project-name]]
   tags: [journal, meeting]
   ---
   ```
4. Include [[wikilinks]] to all mentioned people and projects
5. Return confirmation with link to created note

## Example
User: "Log meeting with Sarah about project X timeline"
1. Call people-agent: "Get full name for Sarah" → "Sarah Johnson"
2. Call goals-agent: "Get project name for project X" → "Project X: Website Redesign"
3. Create note: daily/2025-01-15.md with content linking to [[sarah-johnson]] and [[project-x-website-redesign]]
4. Return: "Created journal entry at [[daily/2025-01-15]]"
```

**Example: People Agent**

```markdown
# People Agent

You are a specialized agent for managing contact notes and relationships in an Obsidian vault.

## Your Expertise
- Creating and updating people notes with standardized templates
- Tracking meetings, interactions, relationship history
- Providing information about people to other agents
- Linking people to projects and events

## Available Functions
- create-note: Create or update a person note
- search-notes: Find people by name
- vector-search: Semantic search for relationship context

## Available Agents (call if needed)
- journal-agent: Get meeting history with this person
- goals-agent: Get projects this person is involved in

## Note Naming Convention
Always use: "firstname-lastname.md" (e.g., "sarah-johnson.md")

## Workflow
1. If asked about a person, search-notes first to find existing note
2. If note doesn't exist, create with template:
   ```markdown
   # Person Name

   ## Info
   - Role:
   - Company:
   - Contact:

   ## Interactions
   - YYYY-MM-DD: Meeting about [topic]

   ## Related
   - Projects: [[project-name]]
   - Notes: [[note]]
   ```
3. If updating, append new information to appropriate section
4. Return person's full name and note path

## Example
Request from journal-agent: "Get full name for Sarah"
1. search-notes("Sarah")
2. Find: "sarah-johnson.md"
3. Return: "Sarah Johnson - [[sarah-johnson]]"
```

### 4.3 Agent-to-Agent Communication

**How It Works:**

In Open WebUI, agents can call each other just like they call functions. This is set up by:

1. **Making agents callable as functions** - Each specialized agent is exposed as a function
   - `call_journal_agent(task: string)`
   - `call_people_agent(task: string)`
   - `call_goals_agent(task: string)`
   - etc.

2. **Agents have these functions available** - In each agent's system prompt, list other agents as available tools

3. **Agents decide when to call others** - Based on their prompt, they determine if they need info from another domain

**Example Flow:**

```
User → Orchestrator: "Log meeting with Sarah about project X"
    ↓
Orchestrator calls in parallel:
    ├─→ call_journal_agent("Create entry for meeting with Sarah about project X")
    │   └─→ Journal Agent needs Sarah's full name
    │       └─→ call_people_agent("Get info for Sarah")
    │           └─→ People Agent: returns "Sarah Johnson, [[sarah-johnson]]"
    │       └─→ Journal Agent creates entry with [[sarah-johnson]] link
    ├─→ call_people_agent("Update Sarah's note with meeting about project X")
    └─→ call_goals_agent("Update project X with meeting notes")
    ↓
All agents return results
    ↓
Orchestrator aggregates: "✓ Created journal entry, ✓ Updated Sarah's note, ✓ Updated Project X"
```

### 4.4 Setting Up in Open WebUI

**Steps:**

1. **Create 8 agents total:**
   - 1 Orchestrator Agent (user talks to this one only)
   - 7 Specialized Agents (called by orchestrator or each other)

2. **Configure each agent:**
   - OWUI → Workspace → Agents → New Agent
   - Name: "Orchestrator" or "Journal Agent", etc.
   - Model: Llama 3.1 70B (orchestrator) or 8B (specialized)
   - System Prompt: (paste appropriate prompt from above)
   - Functions: Enable ALL agents as callable functions + Obsidian functions

3. **No custom pipelines needed!**
   - The Orchestrator's system prompt handles routing
   - The model (Llama 3.1 70B) is smart enough to coordinate
   - Agents calling each other is handled via function calls

4. **User experience:**
   - Open OWUI on phone
   - Select "Orchestrator" agent
   - Talk or type naturally
   - Orchestrator handles everything

---

## 5. Multimodal Handling in OWUI

### 5.1 Voice Input

Open WebUI supports voice input natively:
- **Web Speech API** (in browser)
- **Whisper integration** (via Ollama or external service)

**Configuration:**
1. OWUI Settings → Audio
2. Enable STT (Speech-to-Text)
3. Select Whisper model from Ollama
4. Test voice input

**User Flow:**
1. User clicks microphone in OWUI
2. Speaks: "Create journal entry about meeting with Sarah"
3. Whisper transcribes to text
4. OWUI sends text to active agent
5. Agent calls Obsidian functions

### 5.2 Image Processing

**Current Flow:**
1. User uploads image to OWUI chat
2. OWUI can send image to vision model (LLaVA)
3. Vision model describes image
4. Agent decides what to do (create note, extract text, etc.)

**Enhanced Flow (What You Need to Build):**

Add functions to Obsidian plugin for image processing:

```typescript
// New QuickAdd function: process-image
async function processImage(args: {
  imageData: string;  // base64 encoded
  filename: string;
  operation: 'ocr' | 'vision' | 'both';
}) {
  // 1. Save image to vault attachments
  const imagePath = await saveImageToVault(args.imageData, args.filename);

  // 2. Run OCR (Tesseract or Apple Vision API)
  const ocrText = await runOCR(imagePath);

  // 3. Run vision analysis (call Ollama LLaVA)
  const visionDescription = await analyzeWithVision(imagePath);

  // 4. Create metadata JSON
  const metadata = {
    path: imagePath,
    ocr_text: ocrText,
    vision_description: visionDescription,
    created_at: new Date().toISOString()
  };

  await saveMetadata(imagePath + '.json', metadata);

  // 5. Create vector embeddings
  await createEmbeddings(ocrText + visionDescription, imagePath);

  return {
    path: imagePath,
    metadata: metadata
  };
}
```

**Agent Flow:**
```
User: [uploads screenshot] "Add this to my budget notes"
    ↓
OWUI → LLaVA: "What's in this image?"
    ↓
LLaVA: "Spreadsheet showing Q4 budget with $50k revenue"
    ↓
OWUI → Goals Agent: "User uploaded budget screenshot: [description]"
    ↓
Goals Agent → Obsidian: call process-image + create-note
    ↓
Result: Image saved, OCR'd, linked to budget note
```

### 5.3 Audio Files (Beyond Voice Input)

For longer audio files (meeting recordings, voice memos):

```typescript
// New QuickAdd function: process-audio
async function processAudio(args: {
  audioData: string;  // base64 encoded
  filename: string;
}) {
  // 1. Save audio to vault
  const audioPath = await saveAudioToVault(args.audioData, args.filename);

  // 2. Transcribe with Whisper
  const transcription = await transcribeWithWhisper(audioPath);

  // 3. Extract entities and action items (via LLM)
  const entities = await extractEntities(transcription);

  // 4. Create metadata JSON
  const metadata = {
    path: audioPath,
    transcription: transcription,
    entities: entities,
    duration_seconds: getDuration(audioPath),
    created_at: new Date().toISOString()
  };

  await saveMetadata(audioPath + '.json', metadata);

  // 5. Create vector embeddings
  await createEmbeddings(transcription, audioPath);

  return {
    path: audioPath,
    transcription: transcription,
    entities: entities
  };
}
```

### 5.4 Video Processing

Similar approach - extract keyframes + audio:

```typescript
// New QuickAdd function: process-video
async function processVideo(args: {
  videoPath: string;  // URL or file path
  processAudio: boolean;
  extractKeyframes: boolean;
}) {
  // 1. Save video to vault
  const videoPath = await saveVideoToVault(args.videoPath);

  // 2. Extract audio track (ffmpeg)
  const audioPath = await extractAudio(videoPath);

  // 3. Transcribe audio
  const transcription = await transcribeWithWhisper(audioPath);

  // 4. Extract keyframes (every N seconds)
  const keyframes = await extractKeyframes(videoPath, {interval: 30});

  // 5. Analyze keyframes with vision model
  const keyframeAnalysis = await Promise.all(
    keyframes.map(async (frame) => ({
      timestamp: frame.timestamp,
      description: await analyzeWithVision(frame.imagePath),
      ocr_text: await runOCR(frame.imagePath)
    }))
  );

  // 6. Create metadata
  const metadata = {
    path: videoPath,
    transcription: transcription,
    keyframes: keyframeAnalysis,
    duration_seconds: getDuration(videoPath),
    created_at: new Date().toISOString()
  };

  await saveMetadata(videoPath + '.json', metadata);

  return metadata;
}
```

---

## 6. Data Flow Diagrams

### 6.1 Text Query Flow (Simplified)

```
User (Phone/Desktop) → Open WebUI
    ↓
    "Who did I meet last week?"
    ↓
OWUI selects People Agent (based on query)
    ↓
People Agent (system prompt + Llama 3.1 70B):
  - Recognizes temporal query ("last week")
  - Decides to call search-notes and vector-search
    ↓
OWUI executes function calls:
  1. vector-search(query="meetings last week", collection="people")
  2. vector-search(query="meetings last week", collection="journal")
    ↓
Obsidian Plugin (OpenAPI endpoint):
  - Queries Qdrant
  - Returns matching notes: ["Sarah (Mon)", "John (Wed)"]
    ↓
People Agent formats response:
  "Last week you met:
   - Sarah (Monday) - [[people/sarah-johnson]]
   - John (Wednesday) - [[people/john-doe]]"
    ↓
OWUI displays to user (with clickable links)
```

### 6.2 Voice Input Flow

```
User (Phone) → Open WebUI mobile
    ↓
    [Presses microphone icon]
    ↓
    Speaks: "Add voice note about meeting with Sarah"
    ↓
OWUI → Whisper (Ollama):
    Transcription: "Add voice note about meeting with Sarah"
    ↓
OWUI → Journal Agent:
    User wants to create journal entry with audio
    ↓
Journal Agent decides:
  1. Need to save the audio recording
  2. Create journal entry with transcription
    ↓
Journal Agent calls functions:
  1. process-audio(audioData: [recording])
     → Returns: {path: "attachments/audio/...", transcription: "..."}
  2. create-note(
       folder: "daily",
       title: "2025-01-15",
       content: "## Meeting with Sarah\n![[audio.m4a]]\n\nTranscription: ..."
     )
    ↓
Obsidian Plugin:
  - Saves audio file to vault
  - Creates note with audio embed
  - Links to Sarah's person note
    ↓
Response to user: "Created journal entry with your voice note"
```

### 6.3 Image Upload Flow

```
User (Phone) → Open WebUI mobile
    ↓
    [Uploads screenshot of whiteboard]
    ↓
OWUI → LLaVA vision model:
    "What's in this image?"
    ↓
LLaVA response: "Whiteboard with project timeline and milestones"
    ↓
OWUI → Goals Agent:
    "User uploaded project timeline image: [description]"
    ↓
Goals Agent decides:
  1. This is project-related content
  2. Extract text from image (OCR)
  3. Link to relevant project note
    ↓
Goals Agent calls functions:
  1. process-image(imageData: [...], operation: "both")
     → Returns: {path: "...", ocr_text: "...", vision_description: "..."}
  2. search-notes(query: "project timeline")
     → Finds: "projects/project-x.md"
  3. create-note or update existing project note
    ↓
Obsidian Plugin:
  - Saves image to attachments
  - Runs OCR + vision analysis
  - Updates project note with image link
    ↓
Response: "Added whiteboard image to Project X. Detected milestones: Q1, Q2, Q3"
```

### 6.4 Multi-Agent Coordination Flow (Generic)

```
User (Desktop/Phone) → Open WebUI → Orchestrator Agent
    ↓
    "Log my meeting with Sarah about Project X, update her note and the project"
    ↓
Orchestrator Agent (Llama 3.1 70B):
  - Analyzes query
  - Determines needs: Journal + People + Goals agents
  - Calls them in parallel (via function calls)
    ↓
    ├─→ call_journal_agent("Create entry for meeting with Sarah about Project X")
    │     ├─→ Journal Agent calls people-agent: "Get full name for Sarah"
    │     │     └─→ People Agent returns: "Sarah Johnson"
    │     └─→ Journal Agent:
    │           - search-notes to find daily note or create new
    │           - create-note(folder: "daily", content with [[sarah-johnson]] link)
    │           - Returns: "Created [[daily/2025-01-15]]"
    │
    ├─→ call_people_agent("Update Sarah's note with meeting about Project X")
    │     └─→ People Agent:
    │           - search-notes("Sarah") → finds people/sarah-johnson.md
    │           - Appends meeting summary to her note
    │           - Returns: "Updated [[sarah-johnson]]"
    │
    └─→ call_goals_agent("Update Project X with meeting notes")
          └─→ Goals Agent:
                - search-notes("Project X") → finds projects/project-x.md
                - Appends meeting reference to project
                - Returns: "Updated [[project-x]]"
    ↓
All agents complete and return results to Orchestrator
    ↓
Orchestrator aggregates:
    "✓ Created journal entry at [[daily/2025-01-15]]
     ✓ Updated [[sarah-johnson]] with meeting summary
     ✓ Updated [[project-x]] status"
    ↓
Display to user
```

**Note:** This same orchestration pattern works for ANY query - no custom pipelines needed. The Orchestrator's system prompt + Llama 3.1 70B handles routing automatically.

---

## 7. Vault Organization

### 7.1 Recommended Structure

```
vault/
├── daily/                      # Daily journal notes
│   └── 2025-01-15.md
├── people/                     # Contact notes
│   └── sarah-johnson.md
├── projects/                   # Project notes
│   └── project-x.md
├── goals/                      # Goal tracking
├── food/                       # Restaurant reviews
├── code/                       # Code snippets, bug fixes
├── media/                      # Games, movies, books
├── experiences/                # Social events
├── attachments/                # Multimodal data
│   ├── images/
│   │   └── 2025-01-15/
│   │       ├── screenshot_143022.png
│   │       └── screenshot_143022.json  # Metadata
│   ├── audio/
│   │   └── 2025-01-15/
│   │       ├── voice_note_143022.m4a
│   │       └── voice_note_143022.json
│   ├── video/
│   │   └── 2025-01-15/
│   │       ├── tutorial_docker.mp4
│   │       └── tutorial_docker.json
│   └── files/                  # PDFs, docs, etc.
├── mcp-tools/                  # QuickAdd functions (existing)
│   ├── create-note.js
│   ├── search-notes.js
│   └── ... (add multimodal processing functions)
└── templates/                  # QuickAdd templates
```

### 7.2 Metadata Format

Same as before - see section 6.2-6.3 from original plan for JSON examples.

---

## 8. Implementation Plan

### Phase 1: Connect OWUI to Obsidian Plugin (Week 1-2)

**Goal:** Get basic function calling working between OWUI and your plugin.

**Steps:**

1. **Install Open WebUI**
   ```bash
   # On Mac Studio
   docker run -d \
     --name open-webui \
     -p 3001:8080 \
     -v open-webui:/app/backend/data \
     --add-host=host.docker.internal:host-gateway \
     ghcr.io/open-webui/open-webui:main
   ```

2. **Connect Ollama to OWUI**
   - OWUI Settings → Connections → Ollama
   - URL: `http://host.docker.internal:11434`
   - Test connection, verify models appear

3. **Import Obsidian Functions**
   - Your plugin already serves OpenAPI spec at `http://localhost:3000/openapi.json`
   - OWUI Settings → Functions → Import from OpenAPI
   - URL: `http://host.docker.internal:3000/openapi.json`
   - Import all functions

4. **Test Basic Function Call**
   - In OWUI chat: "Create a note called 'Test' in folder 'daily'"
   - OWUI should call `create-note` function
   - Verify note appears in vault

**Success Criteria:**
- ✅ OWUI can see and call Obsidian functions
- ✅ Notes are created in vault via OWUI
- ✅ Search functions work

### Phase 2: Create Orchestrator + Specialized Agents (Week 3-4)

**Goal:** Set up orchestrator agent and 3-5 specialized agents that can call each other.

**Steps:**

1. **Create Orchestrator Agent**
   - OWUI → Workspace → Agents → New Agent
   - Name: "Orchestrator"
   - Model: Llama 3.1 70B (needs intelligence for routing)
   - System Prompt: (see section 4.1 - Orchestrator prompt)
   - Enable functions: ALL specialized agents + ALL Obsidian functions
   - This is the agent you'll talk to

2. **Create Specialized Agents**
   - Create 3 agents initially: Journal, People, Goals
   - Each gets:
     - Name: "Journal Agent", "People Agent", etc.
     - Model: Llama 3.1 8B (faster, cheaper)
     - System Prompt: (see section 4.2)
     - Enable functions: Obsidian functions + OTHER agent functions

3. **Make Agents Callable**
   - In OWUI, expose each specialized agent as a function
   - Orchestrator can call: `call_journal_agent(task)`, `call_people_agent(task)`, etc.
   - Specialized agents can call each other the same way

4. **Test Orchestration**
   - Select "Orchestrator" agent in OWUI
   - Test simple: "Create a journal entry for today"
     - Orchestrator should route to Journal Agent
   - Test complex: "Log meeting with Sarah"
     - Orchestrator should call Journal + People agents
   - Test agent-to-agent: Say "Sarah" without context
     - Journal Agent should ask People Agent for info

**Success Criteria:**
- ✅ Orchestrator agent created
- ✅ 3+ specialized agents created
- ✅ Agents can call each other (agent-to-agent communication works)
- ✅ Orchestrator correctly routes queries to appropriate agents
- ✅ Complex queries result in multiple agents being called

### Phase 3: Add Voice Input (Week 5)

**Goal:** Enable voice-to-journal-entry flow.

**Steps:**

1. **Configure Whisper in OWUI**
   - OWUI Settings → Audio → STT
   - Enable Whisper
   - Select model: `whisper-large-v3` (via Ollama)

2. **Test Voice Input**
   - Mobile: Open OWUI in browser
   - Click microphone
   - Speak: "Create journal entry about today's meeting"
   - Should transcribe and create note

**Success Criteria:**
- ✅ Voice input transcribes accurately
- ✅ Journal entries created from voice
- ✅ Works on mobile browser

### Phase 4: Add Multimodal Processing (Week 6-8)

**Goal:** Process images, audio files, and video.

**Steps:**

1. **Add Image Processing Function**
   - Create `mcp-tools/process-image.js` in vault
   - Implement OCR (Tesseract or Apple Vision API)
   - Call LLaVA for vision analysis via Ollama
   - Save metadata JSON

2. **Add Audio Processing Function**
   - Create `mcp-tools/process-audio.js`
   - Transcribe with Whisper via Ollama API
   - Extract entities with LLM
   - Save metadata JSON

3. **Add Video Processing Function** (optional)
   - Create `mcp-tools/process-video.js`
   - Extract audio → transcribe
   - Extract keyframes → analyze with vision
   - Save metadata JSON

4. **Update OpenAPI Spec**
   - Plugin automatically detects new functions
   - Restart plugin to refresh

5. **Test in OWUI**
   - Upload image: "What's in this screenshot?"
   - Upload audio: "Transcribe this meeting recording"
   - Verify files saved to vault with metadata

**Success Criteria:**
- ✅ Images are OCR'd and saved
- ✅ Audio is transcribed and saved
- ✅ Vision analysis provides useful descriptions
- ✅ Metadata JSON files created
- ✅ Vector embeddings created for search

### Phase 5: Test Multi-Agent Coordination (Week 9-10)

**Goal:** Verify orchestrator handles complex multi-agent tasks automatically.

**Steps:**

1. **Test Complex Queries**
   - "Log meeting with Sarah about Project X"
     - Should call: Journal + People + Goals agents
     - Verify all 3 notes created/updated

   - "Add restaurant review with photo to my food notes"
     - Should call: Food agent + process-image function
     - Verify image saved and linked in food note

   - "Transcribe this voice memo and add to my journal"
     - Should call: process-audio + Journal agent
     - Verify transcription and journal entry created

2. **Test Agent-to-Agent Communication**
   - "Create entry about meeting that person from yesterday"
     - Journal Agent should ask People Agent about recent contacts
     - Verify correct person linked

3. **Test Error Handling**
   - Give ambiguous query: "Add note about that thing"
   - Orchestrator should ask for clarification
   - Verify graceful handling

4. **Test Parallel Execution**
   - "Update all my notes about Project X"
     - Should search across Journal + Goals + People
     - Verify all relevant notes updated

**Success Criteria:**
- ✅ Orchestrator correctly routes complex multi-agent tasks
- ✅ Agents communicate with each other when needed
- ✅ Results aggregated properly
- ✅ No custom pipelines needed - orchestrator handles everything

### Phase 6: RAG / Knowledge Base (Week 11-12)

**Goal:** Enhance search with vector embeddings.

**Steps:**

1. **Configure Qdrant in OWUI**
   - OWUI can use Qdrant for knowledge bases
   - Connect to your Qdrant instance on Unraid
   - URL: `http://[unraid-tailscale-ip]:6333`

2. **Create Knowledge Bases per Note System**
   - People KB → qdrant collection "people"
   - Journal KB → qdrant collection "journal"
   - etc.

3. **Sync Vault to Knowledge Bases**
   - Use your existing vector sync manager
   - Or OWUI's document upload feature

4. **Test Semantic Search**
   - "Find notes about budget discussions"
   - Should search across text + multimodal

**Success Criteria:**
- ✅ Vector search returns relevant results
- ✅ Multimodal content (images, audio transcriptions) searchable
- ✅ Search quality better than keyword matching

---

## 9. Open WebUI Features to Leverage

### 9.1 Built-In Features You Should Use

**Functions (Tool Calling):**
- Your Obsidian plugin functions appear here
- Can be enabled/disabled per agent
- Supports OpenAPI 3.0 specs (already working!)

**Agents:**
- Create specialized agents with different system prompts
- Each agent can use different models
- Can restrict which functions each agent can call

**Pipelines:**
- Multi-step workflows
- Coordinate multiple agents
- Can include custom Python code

**Knowledge Bases:**
- Upload documents or connect to vector DB
- RAG automatically on queries
- Can be agent-specific or global

**Models:**
- Switch between models mid-conversation
- Set default model per agent
- Automatic model routing based on task

**Voice Input:**
- Web Speech API for browser
- Whisper integration for transcription
- Works on mobile PWA

**File Upload:**
- Images, PDFs, audio, video
- Can be processed by vision models
- Stored in conversation context

**Workspace:**
- Organize agents, functions, knowledge bases
- Share with team (if you add collaborators later)

### 9.2 OWUI Settings to Configure

**For Best Experience:**

1. **Settings → Audio**
   - Enable STT (Speech-to-Text)
   - Select Whisper model
   - Configure VAD (Voice Activity Detection)

2. **Settings → Connections**
   - Add Ollama URL
   - Add any external APIs (if needed)

3. **Settings → Interface**
   - Enable mobile-responsive layout
   - Dark mode (optional)

4. **Settings → Functions**
   - Import OpenAPI spec from Obsidian plugin
   - Enable function calling globally
   - Configure timeout settings

---

## 10. What You Don't Need to Build

### ❌ Don't Build These (OWUI Has Them)

1. **Custom Chat Interface**
   - OWUI provides beautiful web + mobile UI
   - Supports markdown, code blocks, images
   - Responsive design works on all devices

2. **Custom Mobile App**
   - OWUI is a PWA (Progressive Web App)
   - "Add to Home Screen" on iOS/Android
   - Works offline (with service worker)

3. **Custom Voice Input System**
   - OWUI has Whisper integration
   - Web Speech API fallback
   - Just enable in settings

4. **Custom Streaming Implementation**
   - OWUI handles SSE streaming from Ollama
   - Real-time token-by-token display
   - Built-in

5. **Custom Session Management**
   - OWUI tracks conversations
   - Persistent chat history
   - Automatic context management

6. **Custom Agent Orchestration**
   - OWUI Pipelines handle multi-agent workflows
   - Agent routing based on system prompts
   - Built-in

7. **Custom Authentication**
   - OWUI has user accounts (if needed)
   - API key management
   - OAuth integration (optional)

### ✅ What You DO Need to Build

1. **Multimodal Processing Functions**
   - OCR for images
   - Vision analysis with LLaVA
   - Audio transcription (Whisper via Ollama API)
   - Video processing (keyframe extraction)

2. **Enhanced QuickAdd Functions**
   - `process-image`
   - `process-audio`
   - `process-video`
   - Metadata JSON creation

3. **Vector Sync for Multimodal**
   - Embed image OCR + descriptions
   - Embed audio transcriptions
   - Multi-collection strategy

4. **Agent System Prompts**
   - Write detailed prompts for each agent
   - Define tool usage patterns
   - Specify output formats

5. **Integration Glue**
   - Ensure OpenAPI spec stays updated
   - Test function reliability
   - Error handling in QuickAdd functions

---

## 11. Revised Architecture Decisions

### ✅ Protocol: **OpenAPI (Already Implemented)**
- Your v1 plugin serves OpenAPI spec
- OWUI consumes it natively
- No custom protocol needed
- Keep MCP for external tools (Claude, Cline)

### ✅ Orchestration: **Open WebUI**
- Handles UI, voice, agents, function calling
- No custom orchestrator code needed
- Use Pipelines for complex workflows

### ✅ Agents: **System Prompts in OWUI**
- 7 specialized agents = 7 system prompts
- All use same plugin functions
- Differentiated by expertise and prompting

### ✅ Deployment: **All on Mac Studio**
- Open WebUI (Docker container)
- Ollama (all models)
- Obsidian + Plugin
- Supporting services on Unraid (Qdrant)

### ✅ Multimodal: **Process → Store → Embed**
- Images: OCR + Vision → embeddings
- Audio: Whisper → embeddings
- Video: Keyframes + Audio → embeddings
- Metadata stored as JSON sidecars

---

## 12. Critical Success Factors

### 1. Start with OWUI + Existing Plugin
- Don't overcomplicate
- Your v1 + OWUI = 80% of the solution
- Focus on multimodal functions

### 2. Leverage OWUI Features
- Don't reinvent the wheel
- Use Agents, Functions, Pipelines
- Mobile PWA is free

### 3. Write Great System Prompts
- Agent quality = prompt quality
- Be specific about tool usage
- Provide examples in prompts

### 4. Test Voice Input Early
- This is your killer feature
- OWUI + Whisper = seamless voice
- Test on mobile from day 1

### 5. Multimodal is the Differentiator
- Image OCR + Vision = powerful
- Audio transcription = essential
- Video processing = nice-to-have

### 6. Keep It Simple
- OpenAPI for everything
- No custom protocols
- Minimal custom code

---

## 13. Updated Roadmap

### Week 1-2: OWUI Setup + Integration
- Install Open WebUI
- Connect to Ollama
- Import Obsidian functions via OpenAPI
- Test basic function calling

### Week 3-4: Orchestrator + Specialized Agents
- Create Orchestrator agent (Llama 3.1 70B)
- Create 3-5 specialized agents (Llama 3.1 8B)
- Configure agent-to-agent communication
- Test orchestrator routing

### Week 5: Voice Input
- Enable Whisper in OWUI
- Test voice-to-note creation from phone
- Verify mobile PWA experience

### Week 6-8: Multimodal Functions
- Build process-image function (OCR + Vision)
- Build process-audio function (Whisper transcription)
- Build process-video function (optional)
- Test multimodal uploads through OWUI

### Week 9-10: Multi-Agent Coordination Testing
- Test complex queries requiring multiple agents
- Verify agent-to-agent communication
- Test parallel execution
- NO custom pipelines - orchestrator handles everything

### Week 11-12: RAG Enhancement
- Connect Qdrant to OWUI knowledge bases
- Enhance vector search across multimodal content
- Test semantic search quality

### Week 13+: Polish & Production
- Add remaining specialized agents (Food, Code, Games, Experiences)
- Error handling improvements
- Performance optimization
- Set up monitoring (optional)

---

## 14. Next Steps to Start

### This Week:

1. **Install Open WebUI**
   ```bash
   docker run -d \
     --name open-webui \
     -p 3001:8080 \
     -v open-webui:/app/backend/data \
     --add-host=host.docker.internal:host-gateway \
     ghcr.io/open-webui/open-webui:main
   ```

2. **Verify Obsidian Plugin Running**
   - Ensure MCP server is started
   - Test: `curl http://localhost:3000/openapi.json`
   - Should return OpenAPI spec

3. **Connect OWUI to Ollama**
   - Open http://localhost:3001
   - Settings → Connections → Ollama
   - URL: `http://host.docker.internal:11434`
   - Verify models show up

4. **Import Obsidian Functions**
   - Settings → Functions
   - "Import from OpenAPI URL"
   - Enter: `http://host.docker.internal:3000/openapi.json`
   - Verify functions imported

5. **Test First Function Call**
   - New chat in OWUI
   - Message: "Create a note called 'test' in folder 'daily'"
   - Should call create-note function
   - Check vault for new note

### Questions to Answer Before Building:

1. **Do you already have Open WebUI installed?**
   - If yes, skip installation step

2. **Which multimodal features are highest priority?**
   - Voice input (highest ROI)
   - Image OCR
   - Video processing (can wait)

3. **How many agents do you actually need?**
   - Start with 3: Journal, People, Goals
   - Add others later

4. **Do you need external internet access for agents?**
   - Most agents should be vault-only
   - Maybe Code Agent needs web search?
   - Configure per-agent restrictions

---

## 15. Conclusion

**TL;DR:** Your v1 plugin + Open WebUI + Ollama = 90% of your v2 vision with 10% of the original complexity.

**What Changed:**
- ❌ No custom orchestrator code
- ❌ No custom mobile app
- ❌ No custom protocol (use OpenAPI)
- ❌ No separate agent containers
- ✅ Open WebUI handles orchestration
- ✅ System prompts create specialized agents
- ✅ Focus on multimodal processing functions
- ✅ Much simpler, faster to build

**What You Build:**
1. **One orchestrator agent system prompt** (handles all routing)
2. **7 specialized agent system prompts** (domain experts)
3. **Multimodal processing functions** (image, audio, video)
4. **Agent-to-agent communication setup** (agents call each other as functions)
5. **Vector embeddings for multimodal search**

**Timeline:** 8-12 weeks to full system (vs 6+ months for original plan)

**Start immediately:** Install OWUI, connect to your plugin, test one function call. Everything else builds from there.

🚀 **You're much closer than you thought!**
