import type { BaseAgentState, ConversationEntry } from '../src/types.js';

export interface StandaloneAgentState extends BaseAgentState {
	sessionId: string;
	projectName: string;
	conversationBuffer: ConversationEntry[];
}
