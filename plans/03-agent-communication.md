# Plan: Ability to Make the Agents Talk to Each Other (Conference Room 5 Minutes!)

## Current State

There's a partial visual implementation but no actual data exchange:

- **Conference room generation** in `roomGenerator.ts` (lines 255-354) — creates a dedicated Conference room with 4 activity spots around a table and a whiteboard
- **Conference detection** in `transcriptParser.ts` — detects when Agent A uses the `Read` tool to read Agent B's JSONL transcript file, triggers `agentConference` message
- **`sendToConference(readerId, targetId)`** in `officeState.ts` — moves both characters to conference room activity spots, pathfinds them to the table
- **Activity spots system** — each spot has a `toolCategory` including `conference`, tracks occupancy
- **Sub-agent support** — parent-child agent relationships exist (negative IDs, shared palette), but this is hierarchical, not peer-to-peer
- **WebSocket broadcast infrastructure** — all messages broadcast to all connected webview clients

## What's Missing

1. **No actual data exchange** — the conference room is purely visual; agents reading each other's transcripts is passive, one-way, and doesn't constitute a conversation
2. **No MCP tools for inter-agent communication** — agents have no programmatic way to query another agent's status, send a message, or request collaboration
3. **No shared workspace or channel** — no common file/space where agents can leave messages for each other
4. **No agent directory** — agents can't discover who else is working or what they're doing
5. **No conversation protocol** — no structured way for agents to have a back-and-forth exchange

## Plan

### Phase 1: Agent Directory File

**Files to modify:** `standalone/standaloneAgentManager.ts`, `standalone/agentStore.ts`

Create a machine-readable agent directory that all agents can access:

1. Write `~/.pixel-agents/directory.json` whenever agents come or go
2. Contents:
   ```json
   {
     "agents": [
       {
         "name": "Dwight",
         "roleShort": "Backend Dev",
         "sessionId": "abc-123",
         "workspacePath": "/path/to/project",
         "status": "active",
         "currentActivity": "editing src/server.ts"
       }
     ],
     "lastUpdated": "2026-03-08T10:00:00Z"
   }
   ```
3. Agents can `Read` this file to discover who else is working
4. Update it on: agent added, agent removed, agent status change

This is passive but useful — agents can check who's around without any new tools.

### Phase 2: Shared Message Board (Conference Notes)

**Files to modify:** `standalone/server.ts`, `standalone/agentStore.ts`

Create a shared message board file that agents can read and write to:

1. Location: `~/.pixel-agents/conference-notes.md`
2. Any agent can append to this file using their normal `Edit` or `Write` tools
3. Structure:
   ```markdown
   # Conference Notes

   ## 2026-03-08 10:15 — Dwight
   Found a bug in the auth module. Anyone working on src/auth/ should be careful with the token refresh logic.

   ## 2026-03-08 10:30 — Jim
   I'll take a look at the auth issue. Working on it now.
   ```
4. Include the conference notes path in `buildSystemPrompt()`: "Check ~/.pixel-agents/conference-notes.md for messages from other agents."
5. This is the simplest form of inter-agent communication — asynchronous, file-based, zero new infrastructure

### Phase 3: Enhanced Conference Detection and Visualization

**Files to modify:** `src/transcriptParser.ts`, `webview-ui/src/office/engine/officeState.ts`, `webview-ui/src/hooks/useExtensionMessages.ts`

Improve the existing conference detection:

1. **Detect writes to conference-notes.md** — when an agent writes to the shared notes file, trigger `agentConference` for visual effect (agent walks to whiteboard in conference room)
2. **Detect reads of conference-notes.md** — when an agent reads the notes, also trigger conference room animation
3. **Detect reads of directory.json** — when an agent checks who's around, show a brief "looking around" animation
4. **Multiple agents in conference room** — when 2+ agents are interacting with conference notes simultaneously, show them at the conference table together

### Phase 4: Direct Agent Messaging via Files

**Files to modify:** `standalone/agentStore.ts`, `standalone/server.ts`

Enable direct agent-to-agent messages:

1. Create per-agent inbox: `~/.pixel-agents/agents/<id>/inbox.md`
2. Include in system prompt: "Your inbox is at {path}. Check it periodically. Other agents may leave messages for you."
3. Include in system prompt: "To message another agent, check ~/.pixel-agents/directory.json for their ID, then write to ~/.pixel-agents/agents/<their-id>/inbox.md"
4. When an agent writes to another agent's inbox, detect this in `transcriptParser.ts` and trigger a conference room meeting animation

This is still file-based (no new tools needed) but enables directed communication.

### Phase 5: "Conference Room 5 Minutes!" Button (Optional)

**Files to modify:** `webview-ui/src/components/AgentSidebar.tsx`, `standalone/server.ts`, `webview-ui/src/office/engine/officeState.ts`

Add a UI button that broadcasts a message to all agents:

1. Add "Conference!" button in the UI (perhaps in the bottom toolbar or conference room area)
2. Clicking it writes a message to all active agents' inboxes: "Conference room meeting requested by the user. Please check ~/.pixel-agents/conference-notes.md and share your status update."
3. All active agent characters walk to the conference room
4. Optionally, include a text field for the user to specify the meeting topic

This is the most "Office"-like feature — the user calls a meeting and all agents walk to the conference room.

## Architecture Decisions

**Why file-based instead of MCP tools?**
- Agents already have `Read`, `Write`, and `Edit` tools — no new tool infrastructure needed
- File-based communication is observable (you can read the files yourself)
- Works with the existing JSONL detection pipeline
- No need for a message broker or queue system
- Agents naturally handle file I/O — they don't need to learn a new protocol

**Why not real-time streaming?**
- Claude Code sessions are independent processes — there's no IPC channel between them
- The JSONL watching system is already the primary communication channel
- Real-time streaming would require hooks or MCP servers, adding significant complexity
- Asynchronous file-based communication is sufficient for the use case

## Implementation Order

1. Phase 1 (agent directory — foundational, enables everything else)
2. Phase 2 (shared message board — immediate value, simple)
3. Phase 3 (improved visuals — makes the conference room feel alive)
4. Phase 4 (direct messaging — enables targeted collaboration)
5. Phase 5 (conference button — the cherry on top)

## Files Involved

| File | Role |
|------|------|
| `standalone/standaloneAgentManager.ts` | Write directory.json on agent changes |
| `standalone/agentStore.ts` | System prompt updates, inbox creation |
| `standalone/server.ts` | Conference button handler, message broadcasting |
| `src/transcriptParser.ts` | Detect conference-notes and inbox writes/reads |
| `webview-ui/src/office/engine/officeState.ts` | Conference room animations |
| `webview-ui/src/hooks/useExtensionMessages.ts` | Handle conference events |
| `webview-ui/src/components/AgentSidebar.tsx` | Conference button UI |
