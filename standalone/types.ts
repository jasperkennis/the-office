import type { BaseAgentState, ConversationEntry } from '../src/types.js';

export interface StandaloneAgentState extends BaseAgentState {
	sessionId: string;
	projectName: string;
	conversationBuffer: ConversationEntry[];
	/** Decoded actual workspace path (best-effort from project hash) */
	workspacePath?: string;
}

export interface OfflineAgent {
	sessionId: string;
	name?: string;
	projectName?: string;
	workspacePath?: string;
	palette?: number;
	hueShift?: number;
}
