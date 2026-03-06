import * as fs from 'fs';
import * as path from 'path';
import type { MessageSink } from '../src/types.js';
import type { StandaloneAgentState } from './types.js';
import { startFileWatching } from '../src/fileWatcher.js';
import { cancelWaitingTimer, cancelPermissionTimer } from '../src/timerManager.js';

/**
 * A MessageSink that delegates to the current broadcast sink.
 * This ensures agents always use the latest sink even if they were
 * created before any WebSocket client connected.
 */
class DelegatingSink implements MessageSink {
	current: MessageSink | undefined;
	postMessage(msg: unknown): void {
		this.current?.postMessage(msg);
	}
}

export class StandaloneAgentManager {
	agents = new Map<number, StandaloneAgentState>();
	private nextAgentId = 1;

	// Per-agent timers (shared with fileWatcher)
	fileWatchers = new Map<number, fs.FSWatcher>();
	pollingTimers = new Map<number, ReturnType<typeof setInterval>>();
	waitingTimers = new Map<number, ReturnType<typeof setTimeout>>();
	permissionTimers = new Map<number, ReturnType<typeof setTimeout>>();

	// File path → agent ID mapping
	private fileToAgent = new Map<string, number>();

	// Delegating sink — always points to the latest broadcast target
	private delegatingSink = new DelegatingSink();

	setSink(sink: MessageSink | undefined): void {
		this.delegatingSink.current = sink;
	}

	hasSession(jsonlFile: string): boolean {
		return this.fileToAgent.has(jsonlFile);
	}

	addSession(projectDir: string, jsonlFile: string, projectName: string): void {
		if (this.fileToAgent.has(jsonlFile)) return;

		const sessionId = path.basename(jsonlFile, '.jsonl');
		const id = this.nextAgentId++;

		const agent: StandaloneAgentState = {
			id,
			projectDir,
			jsonlFile,
			folderName: projectName,
			fileOffset: 0,
			lineBuffer: '',
			activeToolIds: new Set(),
			activeToolStatuses: new Map(),
			activeToolNames: new Map(),
			activeSubagentToolIds: new Map(),
			activeSubagentToolNames: new Map(),
			isWaiting: false,
			permissionSent: false,
			hadToolsInTurn: false,
			sessionId,
			projectName,
		};

		this.agents.set(id, agent);
		this.fileToAgent.set(jsonlFile, id);

		console.log(`[Standalone] Agent ${id}: tracking ${projectName}/${sessionId}`);
		this.delegatingSink.postMessage({ type: 'agentCreated', id, folderName: projectName });

		// Start watching from end of file (don't replay history)
		try {
			if (fs.existsSync(jsonlFile)) {
				const stat = fs.statSync(jsonlFile);
				agent.fileOffset = stat.size;
			}
		} catch {
			// File may not exist yet
		}

		startFileWatching(
			id, jsonlFile,
			this.agents, this.fileWatchers, this.pollingTimers,
			this.waitingTimers, this.permissionTimers,
			this.delegatingSink,
		);
	}

	removeSession(jsonlFile: string): void {
		const id = this.fileToAgent.get(jsonlFile);
		if (id === undefined) return;

		this.fileToAgent.delete(jsonlFile);
		const agent = this.agents.get(id);
		if (!agent) return;

		// Stop file watching
		this.fileWatchers.get(id)?.close();
		this.fileWatchers.delete(id);
		const pt = this.pollingTimers.get(id);
		if (pt) clearInterval(pt);
		this.pollingTimers.delete(id);
		try { fs.unwatchFile(agent.jsonlFile); } catch { /* ignore */ }

		// Cancel timers
		cancelWaitingTimer(id, this.waitingTimers);
		cancelPermissionTimer(id, this.permissionTimers);

		this.agents.delete(id);
		console.log(`[Standalone] Agent ${id}: removed (stale)`);
		this.delegatingSink.postMessage({ type: 'agentClosed', id });
	}

	getExistingAgentIds(): number[] {
		return [...this.agents.keys()].sort((a, b) => a - b);
	}

	getSessionIdForAgent(agentId: number): string | null {
		const agent = this.agents.get(agentId);
		return agent?.sessionId ?? null;
	}

	/** Send current tool/status state to the sink (for newly connected clients) */
	sendAgentStatuses(ws: MessageSink): void {
		for (const [agentId, agent] of this.agents) {
			for (const [toolId, status] of agent.activeToolStatuses) {
				ws.postMessage({
					type: 'agentToolStart',
					id: agentId,
					toolId,
					status,
				});
			}
			if (agent.isWaiting) {
				ws.postMessage({
					type: 'agentStatus',
					id: agentId,
					status: 'waiting',
				});
			}
		}
	}

	dispose(): void {
		for (const jsonlFile of [...this.fileToAgent.keys()]) {
			this.removeSession(jsonlFile);
		}
	}
}
