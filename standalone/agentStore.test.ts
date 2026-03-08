import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { PersistentAgent } from './agentStore.js';

// Mock fs and os before importing the module
vi.mock('fs', () => ({
	existsSync: vi.fn(),
	readFileSync: vi.fn(),
	writeFileSync: vi.fn(),
	mkdirSync: vi.fn(),
	rmSync: vi.fn(),
}));

vi.mock('os', () => ({
	homedir: () => '/mock-home',
}));

vi.mock('crypto', () => ({
	randomUUID: () => 'test-uuid-1234',
}));

import {
	pickRandomName,
	buildSystemPrompt,
	getAgentMemoryPath,
} from './agentStore.js';

function makeAgent(overrides: Partial<PersistentAgent> = {}): PersistentAgent {
	return {
		id: 'agent-1',
		name: 'Michael',
		roleShort: 'Manager',
		roleFull: 'Regional Manager of the Scranton branch',
		workspacePath: '/projects/dunder-mifflin',
		...overrides,
	};
}

describe('pickRandomName', () => {
	it('returns a name not already used', () => {
		const existing = [makeAgent({ name: 'Michael' }), makeAgent({ name: 'Dwight' })];
		const name = pickRandomName(existing);
		expect(name).not.toBe('Michael');
		expect(name).not.toBe('Dwight');
		expect(typeof name).toBe('string');
		expect(name.length).toBeGreaterThan(0);
	});

	it('returns any available name when no agents exist', () => {
		const name = pickRandomName([]);
		expect(typeof name).toBe('string');
		expect(name.length).toBeGreaterThan(0);
	});

	it('appends a numeric suffix when all names are taken', () => {
		// Create agents with every name from the OFFICE_NAMES list
		const allNames = [
			'Michael', 'Dwight', 'Jim', 'Pam', 'Ryan', 'Andy', 'Stanley',
			'Kevin', 'Meredith', 'Angela', 'Oscar', 'Phyllis', 'Kelly',
			'Toby', 'Creed', 'Darryl', 'Jan', 'Holly', 'Erin', 'Gabe',
			'Clark', 'Pete', 'Nellie', 'Robert', 'Karen', 'Roy', 'Todd',
			'Devon', 'Madge', 'Lonny', 'Hank', 'Nate', 'Val', 'Cathy',
			'Jordan', 'Hannah', 'Troy', 'Nick', 'Sadiq', 'Hidetoshi',
		];
		const existing = allNames.map(name => makeAgent({ name }));
		const name = pickRandomName(existing);
		// Should be "SomeName 2"
		expect(name).toMatch(/^.+ \d+$/);
	});

	it('increments suffix if "Name 2" is also taken', () => {
		const allNames = [
			'Michael', 'Dwight', 'Jim', 'Pam', 'Ryan', 'Andy', 'Stanley',
			'Kevin', 'Meredith', 'Angela', 'Oscar', 'Phyllis', 'Kelly',
			'Toby', 'Creed', 'Darryl', 'Jan', 'Holly', 'Erin', 'Gabe',
			'Clark', 'Pete', 'Nellie', 'Robert', 'Karen', 'Roy', 'Todd',
			'Devon', 'Madge', 'Lonny', 'Hank', 'Nate', 'Val', 'Cathy',
			'Jordan', 'Hannah', 'Troy', 'Nick', 'Sadiq', 'Hidetoshi',
		];
		// Also add all "Name 2" variants
		const suffixedNames = allNames.map(n => `${n} 2`);
		const existing = [...allNames, ...suffixedNames].map(name => makeAgent({ name }));
		const name = pickRandomName(existing);
		// Should be "SomeName 3"
		expect(name).toMatch(/^.+ 3$/);
	});
});

describe('buildSystemPrompt', () => {
	it('includes agent name', () => {
		const agent = makeAgent();
		const prompt = buildSystemPrompt(agent);
		expect(prompt).toContain('You are Michael.');
	});

	it('includes roleFull when present', () => {
		const agent = makeAgent({ roleFull: 'Head of quality assurance' });
		const prompt = buildSystemPrompt(agent);
		expect(prompt).toContain('Head of quality assurance');
	});

	it('falls back to roleShort when roleFull is empty', () => {
		const agent = makeAgent({ roleFull: '', roleShort: 'QA Lead' });
		const prompt = buildSystemPrompt(agent);
		expect(prompt).toContain('Your role: QA Lead.');
		expect(prompt).not.toContain('Head of quality');
	});

	it('includes memory path', () => {
		const agent = makeAgent();
		const prompt = buildSystemPrompt(agent);
		expect(prompt).toContain('MEMORY.md');
		expect(prompt).toContain('Read this file at the start of each session');
	});

	it('omits role line when both roleShort and roleFull are empty', () => {
		const agent = makeAgent({ roleShort: '', roleFull: '' });
		const prompt = buildSystemPrompt(agent);
		expect(prompt).not.toContain('Your role:');
		// Name should still be there
		expect(prompt).toContain('You are Michael.');
	});
});

describe('getAgentMemoryPath', () => {
	it('returns correct path for agent ID', () => {
		const memPath = getAgentMemoryPath('abc-123');
		expect(memPath).toBe('/mock-home/.pixel-agents/agents/abc-123/MEMORY.md');
	});
});
