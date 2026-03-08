# Plan: Give Every Worker a Job Description and Regular Performance Reviews

## Current State

Basic agent identity exists:

- **`roleShort` and `roleFull`** fields on `PersistentAgent` — editable via Employee File modal in AgentSidebar
- **Employee File UI** in `AgentSidebar.tsx` — modal with name, roleShort, roleFull, workspacePath fields
- **System prompt injection** via `buildSystemPrompt()` — includes agent name and memory path, but does NOT currently use roleShort/roleFull to shape behavior
- **MEMORY.md** per agent — unstructured persistent memory
- **Agent metadata persistence** across sessions via `agents.json` and `seats.json`

## What's Missing

1. **Job descriptions don't influence behavior** — roleFull is stored but not injected into the system prompt as a behavioral directive
2. **No structured job description format** — it's a free-text field with no guidance
3. **No performance tracking** — no metrics on what agents do, how many tools they use, what files they touch, how long their sessions last
4. **No review mechanism** — no way to evaluate an agent's work, provide feedback, or adjust their role
5. **No review history** — no record of past reviews
6. **No performance dashboard** — no UI to see agent stats

## Plan

### Phase 1: Job Descriptions That Matter

**Files to modify:** `standalone/agentStore.ts`, `webview-ui/src/components/AgentSidebar.tsx`

Make job descriptions actually influence agent behavior:

1. **Enhance `buildSystemPrompt()`** to inject the role as a behavioral directive:
   - "Your job title: {roleShort}"
   - "Your job description: {roleFull}"
   - "Stay within your area of expertise. If a task falls outside your job description, mention it but still do your best."

2. **Add placeholder text** to the Employee File modal's role fields:
   - roleShort placeholder: "e.g., Frontend Dev, QA Engineer, DevOps"
   - roleFull placeholder: "e.g., Specializes in React components, CSS, and accessibility. Prefers functional patterns and thorough testing."

3. **Add preset job descriptions** — a dropdown of common roles with pre-filled descriptions:
   - Frontend Developer
   - Backend Developer
   - QA Engineer
   - DevOps / Infrastructure
   - Full-Stack Developer
   - Code Reviewer
   - Technical Writer

### Phase 2: Session Metrics Collection

**Files to modify:** `standalone/standaloneAgentManager.ts`, `standalone/agentStore.ts`, `src/transcriptParser.ts`

Track basic metrics per session:

1. Add to `PersistentAgent`:
   ```typescript
   stats?: {
     totalSessions: number
     totalToolCalls: number
     lastActive: string          // ISO timestamp
     toolBreakdown: Record<string, number>  // tool name → count
     filesModified: string[]     // unique file paths touched
   }
   ```

2. During file watching, increment tool call counts per agent (already tracking `agentToolStart` events)

3. On session end (stale check), finalize the session stats:
   - Scan the JSONL file for tool_use records
   - Count by tool type (Read, Write, Edit, Bash, Grep, etc.)
   - Extract file paths from tool arguments
   - Update the persistent agent's cumulative stats

4. Write stats to `~/.pixel-agents/agents/<id>/stats.json`

### Phase 3: Performance Review UI

**Files to modify:** `webview-ui/src/components/AgentSidebar.tsx`, `standalone/server.ts`

Add a "Performance Review" section to the Employee File modal:

1. **Stats display** — show the agent's metrics:
   - Total sessions
   - Last active
   - Most-used tools (bar chart or simple list)
   - Files most frequently modified
   - Average session activity

2. **Review form** — let the user write a review:
   - Text area for review notes
   - Simple rating (1-5 stars or "Exceeds / Meets / Needs Improvement")
   - Save button

3. **Review storage** — append reviews to `~/.pixel-agents/agents/<id>/reviews.json`:
   ```json
   [
     {
       "date": "2026-03-08",
       "rating": "meets",
       "notes": "Good work on the auth refactor. Could improve test coverage.",
       "stats_snapshot": { ... }
     }
   ]
   ```

4. **Review history** — show past reviews in the modal (scrollable list, newest first)

### Phase 4: Review Injection into System Prompt

**Files to modify:** `standalone/agentStore.ts`

Feed the most recent review back to the agent:

1. When building the system prompt, read the latest review from `reviews.json`
2. Inject: "Your most recent performance review ({date}): {notes}. Rating: {rating}."
3. This creates a feedback loop — the user reviews the agent, the agent adjusts behavior

### Phase 5: Automated Review Scheduling (Optional)

**Files to modify:** `standalone/standaloneAgentManager.ts`, `standalone/server.ts`

Remind the user to review agents periodically:

1. Track `lastReviewDate` on `PersistentAgent`
2. After N sessions (e.g., 10) or N days (e.g., 7) since last review, show a notification in the webview: "Time for {agent}'s performance review!"
3. Clicking the notification opens the Employee File with the review section expanded
4. This is purely a nudge — the user decides whether to actually write a review

## Architecture Decisions

**Why not auto-generate reviews?**
- The user should be in control of feedback — automated reviews could be inaccurate or misleading
- Metrics are provided for the user to base their review on, but the judgment is human
- The review text becomes part of the system prompt, so it needs to be intentional

**Why track stats in a separate file?**
- `agents.json` should stay lightweight (loaded on every startup)
- Stats can grow large over time (file lists, tool breakdowns)
- Separate `stats.json` per agent keeps things organized and independently readable

## Implementation Order

1. Phase 1 (job descriptions in system prompt — immediate behavioral impact, minimal code)
2. Phase 2 (metrics collection — enables meaningful reviews)
3. Phase 3 (review UI — the core feature)
4. Phase 4 (review → system prompt — closes the feedback loop)
5. Phase 5 (review reminders — polish)

## Files Involved

| File | Role |
|------|------|
| `standalone/agentStore.ts` | System prompt with role/review, stats types, review storage |
| `standalone/standaloneAgentManager.ts` | Session-end stats collection, review scheduling |
| `standalone/server.ts` | Message handlers for stats, reviews |
| `src/transcriptParser.ts` | Tool call counting during file watching |
| `webview-ui/src/components/AgentSidebar.tsx` | Review UI, stats display, role presets |
| `webview-ui/src/hooks/useExtensionMessages.ts` | New message types for stats/reviews |
