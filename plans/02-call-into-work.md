# Plan: Make It Possible to "Call Into Work" Any Employee That Is Currently Away

## Current State

Significant groundwork exists:

- **Offline agent tracking**: `getOfflineAgents()` returns persistent agents without active processes
- **AgentSidebar** already shows offline agents grouped by project, with status indicators
- **`launchAgent(agentId)`** in `server.ts` creates a new session for a persistent agent — generates new UUID, builds system prompt, launches iTerm2 tab via osascript
- **`restartAgent(sessionId, workspacePath)`** attempts `claude --resume <sessionId>` for non-persistent offline agents
- **Persistent agent storage** in `~/.pixel-agents/agents.json` preserves identity, appearance, seat, and last session ID across restarts
- **MEMORY.md** per agent provides continuity context
- **System prompt injection** via `buildSystemPrompt()` gives returning agents their name, role, and memory file path
- **UI buttons** in AgentSidebar: "Hire" (launch), "Fire" (delete), "Forget" (remove from offline list)

## What's Missing

1. **No "Call In" UX** — the "Hire" button exists but the metaphor is wrong; calling someone back to work is different from hiring a new employee
2. **No task assignment on call-in** — when you bring someone back, you can't tell them what to work on
3. **No session continuity** — `launchAgent()` creates a brand new session; the agent has no idea what they were doing last time beyond what's in MEMORY.md
4. **No "last seen" or session history** — no record of when an agent was last active or what they accomplished
5. **No visual "away" state** — offline agents are in a sidebar list, not visually represented in the office (e.g., empty desk, ghost character)

## Plan

### Phase 1: Rename and Clarify the Call-In UX

**Files to modify:** `webview-ui/src/components/AgentSidebar.tsx`

The existing "Hire" link for offline persistent agents should become "Call In" (or "📞 Call In"). This is a label/metaphor change:

- Offline persistent agents → "Call In" button (brings them back with their existing identity)
- New agent creation → "Hire" button (creates a fresh persistent agent)
- Make the distinction clear in the UI

### Phase 2: Task Assignment on Call-In

**Files to modify:** `webview-ui/src/components/AgentSidebar.tsx`, `standalone/server.ts`, `standalone/agentStore.ts`

When clicking "Call In", show a small text input: "What should they work on?" (optional). This becomes the initial user prompt for the new session:

1. Add a `callInTask` field to the `launchAgent` message
2. In `server.ts`, when handling `launchAgent`:
   - Build the system prompt as before (name, role, memory path)
   - If `callInTask` is provided, pass it as the initial prompt: `claude --session-id <uuid> --prompt "<task>"`
   - If no task, launch normally (agent arrives and waits for instructions)
3. The system prompt already tells agents to read their MEMORY.md, so they'll have context from their last session

### Phase 3: Session History Tracking

**Files to modify:** `standalone/agentStore.ts`, `standalone/standaloneAgentManager.ts`

Track when agents come and go:

1. Add `lastSessionEnd?: string` (ISO timestamp) and `sessionCount?: number` to `PersistentAgent`
2. When a session goes stale (process dies), update the persistent agent:
   - Set `lastSessionEnd` to current time
   - Increment `sessionCount`
   - Clear `currentSessionId`
3. Display "Last active: 2 hours ago" in the AgentSidebar for offline agents

### Phase 4: Enhanced System Prompt for Returning Agents

**Files to modify:** `standalone/agentStore.ts`

Improve `buildSystemPrompt()` for returning agents (agents that have `sessionCount > 0`):

- Add: "You're returning to work. Check your memory file at {path} for context from your previous sessions."
- Add: "Your last session ended on {lastSessionEnd}."
- This nudges the agent to read MEMORY.md and pick up where they left off

### Phase 5: Visual "Away" Indicator (Optional)

**Files to modify:** `webview-ui/src/office/engine/officeState.ts`, `webview-ui/src/office/engine/renderer.ts`

Show offline agents as faded/ghost characters at their assigned seats:

1. When an agent goes offline but has a seat assignment, keep a ghost `Character` in the office state
2. Render ghost characters at 30% opacity with a "zzz" or "away" bubble
3. Clicking a ghost character opens the AgentSidebar with focus on that agent's "Call In" button
4. When the agent is called back in, the ghost transitions to a real character (spawn effect)

This is the most visually impactful change but also the most complex. It should be treated as a stretch goal.

## Implementation Order

1. Phase 1 (trivial UI label change, immediate clarity improvement)
2. Phase 2 (core feature — task assignment makes call-in useful)
3. Phase 3 (small persistence change, enables Phase 4)
4. Phase 4 (enhances returning agent experience)
5. Phase 5 (visual polish, stretch goal)

## Files Involved

| File | Role |
|------|------|
| `webview-ui/src/components/AgentSidebar.tsx` | Call-in UX, task input, last-active display |
| `standalone/server.ts` | Handle call-in with task, pass prompt to claude |
| `standalone/agentStore.ts` | Session history fields, enhanced system prompt |
| `standalone/standaloneAgentManager.ts` | Update persistent agent on session end |
| `webview-ui/src/office/engine/officeState.ts` | Ghost characters (Phase 5) |
| `webview-ui/src/office/engine/renderer.ts` | Ghost rendering (Phase 5) |
