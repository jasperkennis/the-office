import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { execSync } from 'child_process';
import { PROJECT_DIR_SCAN_INTERVAL_MS, JSONL_SCAN_INTERVAL_MS, STALE_CHECK_INTERVAL_MS } from './constants.js';

export interface ScannerCallbacks {
	onNewSession(projectDir: string, jsonlFile: string, projectName: string): void;
	onSessionStale(jsonlFile: string): void;
}

interface WatchedProject {
	dir: string;
	name: string;
	knownFiles: Set<string>;
	timer: ReturnType<typeof setInterval>;
}

/** Get the set of session IDs that have a live claude process */
function getLiveSessionIds(): Set<string> {
	const ids = new Set<string>();
	try {
		const output = execSync(
			'ps aux | grep "claude" | grep "session-id" | grep -v grep',
			{ encoding: 'utf-8', timeout: 3000 },
		).trim();
		if (!output) return ids;
		for (const line of output.split('\n')) {
			const match = line.match(/--session-id\s+([0-9a-f-]{36})/);
			if (match) {
				ids.add(match[1]);
			}
		}
	} catch {
		// No claude processes running
	}
	return ids;
}

export class ProjectScanner {
	private projectsRoot: string;
	private projects = new Map<string, WatchedProject>();
	private dirScanTimer: ReturnType<typeof setInterval> | null = null;
	private staleTimer: ReturnType<typeof setInterval> | null = null;
	private callbacks: ScannerCallbacks;
	/** Set of session IDs with live claude processes — refreshed periodically */
	private liveSessionIds = new Set<string>();

	constructor(callbacks: ScannerCallbacks) {
		this.projectsRoot = path.join(os.homedir(), '.claude', 'projects');
		this.callbacks = callbacks;
	}

	start(): void {
		// Get live sessions before initial scan
		this.liveSessionIds = getLiveSessionIds();
		console.log(`[Scanner] Found ${this.liveSessionIds.size} live Claude session(s)`);

		// Initial scan
		this.scanProjectDirs();

		// Poll for new project directories
		this.dirScanTimer = setInterval(() => this.scanProjectDirs(), PROJECT_DIR_SCAN_INTERVAL_MS);

		// Periodically refresh live sessions and check for stale agents
		this.staleTimer = setInterval(() => {
			this.liveSessionIds = getLiveSessionIds();
			this.checkStale();
		}, STALE_CHECK_INTERVAL_MS);
	}

	stop(): void {
		if (this.dirScanTimer) {
			clearInterval(this.dirScanTimer);
			this.dirScanTimer = null;
		}
		if (this.staleTimer) {
			clearInterval(this.staleTimer);
			this.staleTimer = null;
		}
		for (const proj of this.projects.values()) {
			clearInterval(proj.timer);
		}
		this.projects.clear();
	}

	private scanProjectDirs(): void {
		try {
			if (!fs.existsSync(this.projectsRoot)) return;
			const entries = fs.readdirSync(this.projectsRoot, { withFileTypes: true });
			for (const entry of entries) {
				if (!entry.isDirectory()) continue;
				const dirPath = path.join(this.projectsRoot, entry.name);
				if (!this.projects.has(dirPath)) {
					this.watchProject(dirPath, entry.name);
				}
			}
		} catch {
			// ~/.claude/projects may not exist yet
		}
	}

	private watchProject(dirPath: string, dirName: string): void {
		const projectName = this.deriveProjectName(dirName);
		const knownFiles = new Set<string>();

		// Seed with existing files — only report ones with a live claude process
		try {
			const files = fs.readdirSync(dirPath).filter(f => f.endsWith('.jsonl'));
			for (const f of files) {
				const fullPath = path.join(dirPath, f);
				knownFiles.add(fullPath);
				const sessionId = path.basename(f, '.jsonl');
				if (this.liveSessionIds.has(sessionId)) {
					this.callbacks.onNewSession(dirPath, fullPath, projectName);
				}
			}
		} catch {
			// Dir may have been removed
		}

		// Poll for new JSONL files
		const timer = setInterval(() => {
			this.scanJsonlFiles(dirPath, knownFiles, projectName);
		}, JSONL_SCAN_INTERVAL_MS);

		this.projects.set(dirPath, { dir: dirPath, name: projectName, knownFiles, timer });
	}

	private scanJsonlFiles(dirPath: string, knownFiles: Set<string>, projectName: string): void {
		try {
			const files = fs.readdirSync(dirPath).filter(f => f.endsWith('.jsonl'));
			for (const f of files) {
				const fullPath = path.join(dirPath, f);
				if (!knownFiles.has(fullPath)) {
					knownFiles.add(fullPath);
					// New file appeared — report it (likely a just-started session)
					this.callbacks.onNewSession(dirPath, fullPath, projectName);
				}
			}
		} catch {
			// Ignore read errors
		}
	}

	private checkStale(): void {
		for (const proj of this.projects.values()) {
			for (const filePath of proj.knownFiles) {
				const sessionId = path.basename(filePath, '.jsonl');
				if (!this.liveSessionIds.has(sessionId)) {
					this.callbacks.onSessionStale(filePath);
				}
			}
		}
	}

	/** Convert sanitized dir name back to a readable project name */
	private deriveProjectName(dirName: string): string {
		// Dir name is the workspace path with non-alphanumeric chars replaced by '-'
		// Try to get the last meaningful segment
		const parts = dirName.split('-').filter(p => p.length > 0);
		if (parts.length === 0) return dirName;
		return parts[parts.length - 1];
	}
}
