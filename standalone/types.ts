import type { BaseAgentState } from '../src/types.js';

export interface StandaloneAgentState extends BaseAgentState {
	sessionId: string;
	projectName: string;
}
