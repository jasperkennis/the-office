# Plan: Give Every Worker Their Own Memory and Tiny Description of Their Expertise

## Current State

The foundation is already in place:

- **Persistent agents** stored in `~/.pixel-agents/agents.json` with `PersistentAgent` interface (id, name, roleShort, roleFull, workspacePath, palette, hueShift, seatId, currentSessionId)
- **Per-agent MEMORY.md** files at `~/.pixel-agents/agents/<uuid>/MEMORY.md`, created by `agentStore.ts:ensureAgentMemory()`
- **System prompt injection** via `agentStore.ts:buildSystemPrompt()` — tells agents to read/update their MEMORY.md
- **Employee File UI** in `AgentSidebar.tsx` — editable name, roleShort, roleFull, workspacePath
- **Seat metadata persistence** in `~/.pixel-agents/seats.json`

## What's Missing

1. **MEMORY.md is a bare template** — just says "This file is your persistent memory. Update it as you work." No structure, no guidance on what to track
2. **No expertise field** — `roleShort`/`roleFull` exist but are generic free-text, not used to shape agent behavior
3. **No memory viewer in the UI** — you can edit name/role in the Employee File modal but can't see or edit the full MEMORY.md
4. **System prompt doesn't use roleShort/roleFull meaningfully** — it injects the name but doesn't instruct the agent to specialize based on their role
5. **No auto-population of expertise** — agents don't automatically learn what they're good at from their work history
6. **No memory search or indexing** — memories are stored but not queryable

## Plan

### Phase 1: Structured MEMORY.md Template

**Files to modify:** `standalone/agentStore.ts`

Update `ensureAgentMemory()` to write a structured template instead of the bare one:

```markdown
# Agent Memory

## My Expertise
<!-- What I'm good at, tools I prefer, patterns I've learned -->

## Project Context
<!-- Key facts about the projects I work on -->

## Preferences
<!-- How I like to work, conventions I follow -->

## Session Notes
<!-- Important things to remember across sessions -->
```

This gives agents guidance on what to track. Existing MEMORY.md files should NOT be overwritten — only new ones get the template.

### Phase 2: Expertise-Aware System Prompt

**Files to modify:** `standalone/agentStore.ts`

Enhance `buildSystemPrompt()` to incorporate `roleShort` and `roleFull` as behavioral instructions:

- If `roleFull` is set, inject it as: "Your role and area of expertise: {roleFull}. Lean into this expertise when making decisions."
- If `roleShort` is set but `roleFull` is not, use: "Your specialty: {roleShort}"
- Include the workspace path context: "You primarily work on: {workspacePath}"

This makes the role fields actually influence agent behavior rather than just being labels.

### Phase 3: Memory Viewer in Employee File

**Files to modify:** `webview-ui/src/components/AgentSidebar.tsx`, `standalone/server.ts`

Add a read-only (or editable) view of the agent's MEMORY.md content in the Employee File modal:

1. Add new message types: `getAgentMemory` (request) and `agentMemoryContent` (response)
2. In `server.ts`, handle `getAgentMemory` by reading `~/.pixel-agents/agents/<id>/MEMORY.md` and sending it back
3. In the Employee File modal, add a collapsible "Memory" section that shows the MEMORY.md content
4. Optionally allow editing — send `saveAgentMemory` message back to server to write the file

UI should match the pixel art aesthetic — monospace text area with `--pixel-bg` background.

### Phase 4: Auto-Expertise Summary (Optional Enhancement)

**Files to modify:** `standalone/agentStore.ts`, `standalone/standaloneAgentManager.ts`

When an agent session ends (detected via stale check), scan the JSONL transcript to extract a brief summary of what tools were used most and what files were touched. Append this as a "Session Summary" to the MEMORY.md:

```markdown
## Session Log
- 2026-03-08: Worked on src/components/ — heavy Edit/Write usage, 12 tool calls
```

This is a stretch goal — it adds complexity and requires JSONL parsing at session end.

## Implementation Order

1. Phase 2 first (smallest change, biggest behavioral impact)
2. Phase 1 second (improves new agent onboarding)
3. Phase 3 third (UI work, nice to have)
4. Phase 4 last (optional, most complex)

## Files Involved

| File | Role |
|------|------|
| `standalone/agentStore.ts` | Core changes: template, system prompt, memory read/write |
| `standalone/server.ts` | New message handlers for memory read/write |
| `webview-ui/src/components/AgentSidebar.tsx` | Memory viewer UI |
| `webview-ui/src/hooks/useExtensionMessages.ts` | New message type handling |
| `standalone/types.ts` | Any new message type definitions |
