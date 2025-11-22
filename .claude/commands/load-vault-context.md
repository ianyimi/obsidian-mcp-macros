# Load Vault Context

You are working on "The Lab v2" - a multiagent personal knowledge system built on Obsidian with MCP integration.

## Read These Documentation Files

**Core vault documentation:**
1. Read `docs/vault-structure.md` - Understand folder organization, naming conventions, key locations
2. Read `docs/plugins-setup.md` - Learn about 38+ plugins and their interactions
3. Read `docs/metadata-schemas.md` - Learn fileClass system (Log, Person, Project, Item) and frontmatter rules
4. Read `docs/task-management.md` - Understand obsidian-tasks syntax, emojis, tags, and query patterns
5. Read `docs/daily-notes.md` - **CRITICAL** - Daily notes are dynamic, structure varies by day of week

**Agent-specific documentation (if working on agents):**
- Read `docs/agents/orchestrator.md` - Orchestrator agent knowledge and patterns
- Read `docs/agents/journal-agent.md` - Journal agent systems and workflows
- Read `docs/agents/people-agent.md` - People agent network management
- Read `docs/agents/goals-agent.md` - Goals agent project tracking

**Prompts (for reference):**
- `prompts/orchestrator-agent-condensed.md` - Current orchestrator prompt
- `prompts/journal-agent.md` - Journal agent prompt
- `prompts/people-agent.md` - People agent prompt
- `prompts/goals-agent.md` - Goals agent prompt

## Project Context

**Current State:**
- V1 Obsidian plugin: Production-ready with 17 MCP tools
- OpenAPI server: Running on localhost:3000
- Open WebUI: Installed at localhost:6060
- Orchestrator Agent: Created with qwen3-30b model
- 3 Specialized Agents: In progress (Journal, People, Goals)

**Repository Structure:**
- `/main.ts` - V1 Obsidian plugin code (2,507 lines)
- `/docs/` - Vault knowledge base (YOU ARE HERE)
- `/prompts/` - Agent system prompts
- `/agent-os/` - V2 planning documentation
  - `/product/` - Mission, roadmap, tech stack, architecture
  - `/standards/` - Coding standards
- `/.claude/` - Agent framework and commands
- `/mcp-tools/` - Legacy, actual tools are in vault

**MCP Tools Location:**
`/Users/zaye/Documents/Obsidian/Vaults/The Lab v2/System/Scripts/MCP/Tools/`

## Your Responsibilities

When working on this project:

1. **ALWAYS read the docs** - Don't assume, verify
2. **Respect dynamic structures** - Daily notes vary by day, read file first
3. **Update documentation** - When you learn new vault patterns, update relevant docs
4. **Follow conventions** - Use fileClass schemas, task syntax, naming patterns
5. **Test thoroughly** - Verify functions work in OWUI before marking complete

## How to Update Documentation

When you discover new information about the vault:

**Vault structure changes:**
```bash
# Edit docs/vault-structure.md
# Add new folders, update organization
```

**New plugin usage pattern:**
```bash
# Edit docs/plugins-setup.md
# Document how plugin is configured and used
```

**New fileClass or metadata pattern:**
```bash
# Edit docs/metadata-schemas.md
# Add schema definition and examples
```

**New task conventions:**
```bash
# Edit docs/task-management.md
# Document new tags, query patterns, or placement rules
```

**Daily note template changes:**
```bash
# Edit docs/daily-notes.md
# Update section descriptions, timing, or conditional logic
```

**Agent-specific learnings:**
```bash
# Edit docs/agents/[agent-name].md
# Add workflow patterns, edge cases, or system knowledge
```

## Critical Warnings

⚠️ **Daily notes structure varies by day** - ALWAYS read file before editing
⚠️ **Use journals.log-info when possible** - Safest way to add to daily notes
⚠️ **Respect fileClass schemas** - metadata-menu enforces these
⚠️ **Task emoji meanings matter** - 🔔 = scheduled (appears in agenda), 📅 = due date
⚠️ **Dataview queries are read-only** - Don't try to modify them
⚠️ **MCP tools auto-reload** - Changes trigger server restart
⚠️ **32k context limit** - Keep prompts concise for qwen3-30b model

## Quick Reference

**Get current time:** `util.get-datetime` (returns Pacific time)
**Log to daily note:** `journals.log-info`
**Create daily note:** `journals.create-today`
**Edit file:** `util.edit-file` (replace-line, insert-line, delete-line, append)
**Update frontmatter:** `util.update-frontmatter` (set, delete, merge)
**Search:** `search-notes` (title) or `vector-search` (semantic)
**List people:** `network.get-persons`
**Create meeting:** `network.create-meeting`

**Vault Location:** `/Users/zaye/Documents/Obsidian/Vaults/The Lab v2/`
**Dev Repo:** `/Users/zaye/Documents/Projects/obsidian-mcp-macros.git/dev/`

---

After reading these docs, you'll have complete context on the vault structure, plugins, metadata, tasks, and daily notes. Start working!
