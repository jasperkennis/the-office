import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import * as crypto from 'crypto';

const SETTINGS_DIR = path.join(os.homedir(), '.pixel-agents');
const AGENTS_FILE = path.join(SETTINGS_DIR, 'agents.json');
const AGENTS_DIR = path.join(SETTINGS_DIR, 'agents');

export interface PersistentAgent {
	id: string;
	name: string;
	roleShort: string;
	roleFull: string;
	workspacePath: string;
	palette?: number;
	hueShift?: number;
	seatId?: string;
	currentSessionId?: string;
}

export function loadPersistentAgents(): PersistentAgent[] {
	try {
		if (!fs.existsSync(AGENTS_FILE)) return [];
		return JSON.parse(fs.readFileSync(AGENTS_FILE, 'utf-8')) as PersistentAgent[];
	} catch { return []; }
}

export function savePersistentAgents(agents: PersistentAgent[]): void {
	if (!fs.existsSync(SETTINGS_DIR)) {
		fs.mkdirSync(SETTINGS_DIR, { recursive: true });
	}
	fs.writeFileSync(AGENTS_FILE, JSON.stringify(agents, null, 2), 'utf-8');
}

export function getAgentMemoryPath(agentId: string): string {
	return path.join(AGENTS_DIR, agentId, 'MEMORY.md');
}

export function ensureAgentMemory(agentId: string): void {
	const dir = path.join(AGENTS_DIR, agentId);
	if (!fs.existsSync(dir)) {
		fs.mkdirSync(dir, { recursive: true });
	}
	const memPath = getAgentMemoryPath(agentId);
	if (!fs.existsSync(memPath)) {
		fs.writeFileSync(memPath, '# Memory\n\nThis file is your persistent memory. Update it as you work.\n', 'utf-8');
	}
}

export function deleteAgentData(agentId: string): void {
	const dir = path.join(AGENTS_DIR, agentId);
	if (fs.existsSync(dir)) {
		fs.rmSync(dir, { recursive: true });
	}
}

export function generateAgentId(): string {
	return crypto.randomUUID();
}

export function buildSystemPrompt(agent: PersistentAgent): string {
	const memoryPath = getAgentMemoryPath(agent.id);
	const lines = [
		`You are ${agent.name}.`,
	];
	if (agent.roleFull) {
		lines.push('', agent.roleFull);
	} else if (agent.roleShort) {
		lines.push(`Your role: ${agent.roleShort}.`);
	}
	lines.push(
		'',
		`Your persistent memory file is at: ${memoryPath}`,
		'Read this file at the start of each session to recall context from previous sessions.',
		'Update it as you work with important decisions, progress, patterns, and context you want to remember across sessions.',
	);
	return lines.join('\n');
}
