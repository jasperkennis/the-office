import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import type { AgentState } from './types.js';
import {
	launchNewTerminal,
	removeAgent,
	restoreAgents,
	persistAgents,
	sendExistingAgents,
	getProjectDirPath,
} from './agentManager.js';
import { ensureProjectScan } from './vscodeFileScanner.js';
import { loadFurnitureAssets, sendAssetsToWebview, loadFloorTiles, sendFloorTilesToWebview, loadWallTiles, sendWallTilesToWebview, loadCharacterSprites, sendCharacterSpritesToWebview } from './assetLoader.js';
import { GLOBAL_KEY_SOUND_ENABLED } from './constants.js';
import { addKnownProject, getKnownProjectsForWorkspace } from './projectStore.js';

export class PixelAgentsViewProvider implements vscode.WebviewViewProvider {
	nextAgentId = { current: 1 };
	nextTerminalIndex = { current: 1 };
	agents = new Map<number, AgentState>();
	webviewView: vscode.WebviewView | undefined;

	// Per-agent timers
	fileWatchers = new Map<number, fs.FSWatcher>();
	pollingTimers = new Map<number, ReturnType<typeof setInterval>>();
	waitingTimers = new Map<number, ReturnType<typeof setTimeout>>();
	jsonlPollTimers = new Map<number, ReturnType<typeof setInterval>>();
	permissionTimers = new Map<number, ReturnType<typeof setTimeout>>();

	// /clear detection: project-level scan for new JSONL files
	activeAgentId = { current: null as number | null };
	knownJsonlFiles = new Set<string>();
	projectScanTimer = { current: null as ReturnType<typeof setInterval> | null };

	constructor(private readonly context: vscode.ExtensionContext) {}

	private get extensionUri(): vscode.Uri {
		return this.context.extensionUri;
	}

	private get webview(): vscode.Webview | undefined {
		return this.webviewView?.webview;
	}

	private persistAgents = (): void => {
		persistAgents(this.agents, this.context);
	};

	resolveWebviewView(webviewView: vscode.WebviewView) {
		this.webviewView = webviewView;
		webviewView.webview.options = { enableScripts: true };
		webviewView.webview.html = getWebviewContent(webviewView.webview, this.extensionUri);

		webviewView.webview.onDidReceiveMessage(async (message) => {
			if (message.type === 'openClaude') {
				const folderPath = message.folderPath as string | undefined;
				await launchNewTerminal(
					this.nextAgentId, this.nextTerminalIndex,
					this.agents, this.activeAgentId, this.knownJsonlFiles,
					this.fileWatchers, this.pollingTimers, this.waitingTimers, this.permissionTimers,
					this.jsonlPollTimers, this.projectScanTimer,
					this.webview, this.persistAgents,
					folderPath,
				);
				// Register the project in known-projects store
				const folders = vscode.workspace.workspaceFolders;
				const cwd = folderPath || folders?.[0]?.uri.fsPath;
				const name = cwd ? path.basename(cwd) : (folders?.[0]?.name ?? 'Project');
				this.registerAgentProject(name, cwd);
			} else if (message.type === 'focusAgent') {
				const agent = this.agents.get(message.id);
				if (agent) {
					agent.terminalRef.show();
				}
			} else if (message.type === 'closeAgent') {
				const agent = this.agents.get(message.id);
				if (agent) {
					agent.terminalRef.dispose();
				}
			} else if (message.type === 'setSoundEnabled') {
				this.context.globalState.update(GLOBAL_KEY_SOUND_ENABLED, message.enabled);
			} else if (message.type === 'webviewReady') {
				restoreAgents(
					this.context,
					this.nextAgentId, this.nextTerminalIndex,
					this.agents, this.knownJsonlFiles,
					this.fileWatchers, this.pollingTimers, this.waitingTimers, this.permissionTimers,
					this.jsonlPollTimers, this.projectScanTimer, this.activeAgentId,
					this.webview, this.persistAgents,
				);
				// Send persisted settings to webview
				const soundEnabled = this.context.globalState.get<boolean>(GLOBAL_KEY_SOUND_ENABLED, true);
				this.webview?.postMessage({ type: 'settingsLoaded', soundEnabled });

				// Send workspace folders to webview (always, for room labels)
				const wsFolders = vscode.workspace.workspaceFolders;
				if (wsFolders && wsFolders.length > 1) {
					this.webview?.postMessage({
						type: 'workspaceFolders',
						folders: wsFolders.map(f => ({ name: f.name, path: f.uri.fsPath })),
					});
				}

				// Send known projects to webview
				this.sendKnownProjects();

				// Ensure project scan runs even with no restored agents (to adopt external terminals)
				const projectDir = getProjectDirPath();
				const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
				if (projectDir) {
					ensureProjectScan(
						projectDir, this.knownJsonlFiles, this.projectScanTimer, this.activeAgentId,
						this.nextAgentId, this.agents,
						this.fileWatchers, this.pollingTimers, this.waitingTimers, this.permissionTimers,
						this.webview, this.persistAgents,
					);
				}

				// Load assets then signal layout ready
				(async () => {
					try {
						const extensionPath = this.extensionUri.fsPath;
						const bundledAssetsDir = path.join(extensionPath, 'dist', 'assets');
						let assetsRoot: string | null = null;
						if (fs.existsSync(bundledAssetsDir)) {
							assetsRoot = path.join(extensionPath, 'dist');
						} else if (workspaceRoot) {
							assetsRoot = workspaceRoot;
						}

						if (assetsRoot) {
							const charSprites = await loadCharacterSprites(assetsRoot);
							if (charSprites && this.webview) {
								sendCharacterSpritesToWebview(this.webview, charSprites);
							}
							const floorTiles = await loadFloorTiles(assetsRoot);
							if (floorTiles && this.webview) {
								sendFloorTilesToWebview(this.webview, floorTiles);
							}
							const wallTiles = await loadWallTiles(assetsRoot);
							if (wallTiles && this.webview) {
								sendWallTilesToWebview(this.webview, wallTiles);
							}
							const assets = await loadFurnitureAssets(assetsRoot);
							if (assets && this.webview) {
								sendAssetsToWebview(this.webview, assets);
							}
						}
					} catch (err) {
						console.error('[Extension] Error loading assets:', err);
					}
					// Signal layout ready (webview generates its own layout from known projects)
					if (this.webview) {
						this.webview.postMessage({ type: 'layoutLoaded', layout: null });
					}
				})();
				sendExistingAgents(this.agents, this.context, this.webview);
			} else if (message.type === 'openSessionsFolder') {
				const projectDir = getProjectDirPath();
				if (projectDir && fs.existsSync(projectDir)) {
					vscode.env.openExternal(vscode.Uri.file(projectDir));
				}
			}
		});

		vscode.window.onDidChangeActiveTerminal((terminal) => {
			this.activeAgentId.current = null;
			if (!terminal) return;
			for (const [id, agent] of this.agents) {
				if (agent.terminalRef === terminal) {
					this.activeAgentId.current = id;
					webviewView.webview.postMessage({ type: 'agentSelected', id });
					break;
				}
			}
		});

		vscode.window.onDidCloseTerminal((closed) => {
			for (const [id, agent] of this.agents) {
				if (agent.terminalRef === closed) {
					if (this.activeAgentId.current === id) {
						this.activeAgentId.current = null;
					}
					removeAgent(
						id, this.agents,
						this.fileWatchers, this.pollingTimers, this.waitingTimers, this.permissionTimers,
						this.jsonlPollTimers, this.persistAgents,
					);
					webviewView.webview.postMessage({ type: 'agentClosed', id });
				}
			}
		});
	}

	private sendKnownProjects(): void {
		const wsFolders = vscode.workspace.workspaceFolders;
		if (!wsFolders) return;
		const paths = wsFolders.map(f => f.uri.fsPath);
		const projects = getKnownProjectsForWorkspace(paths);
		this.webview?.postMessage({ type: 'knownProjects', projects });
	}

	/** Register a project when an agent is created for it */
	registerAgentProject(folderName: string, folderPath?: string): void {
		const workspacePath = folderPath || vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
		if (workspacePath) {
			addKnownProject(folderName, workspacePath);
			this.sendKnownProjects();
		}
	}

	dispose() {
		for (const id of [...this.agents.keys()]) {
			removeAgent(
				id, this.agents,
				this.fileWatchers, this.pollingTimers, this.waitingTimers, this.permissionTimers,
				this.jsonlPollTimers, this.persistAgents,
			);
		}
		if (this.projectScanTimer.current) {
			clearInterval(this.projectScanTimer.current);
			this.projectScanTimer.current = null;
		}
	}
}

export function getWebviewContent(webview: vscode.Webview, extensionUri: vscode.Uri): string {
	const distPath = vscode.Uri.joinPath(extensionUri, 'dist', 'webview');
	const indexPath = vscode.Uri.joinPath(distPath, 'index.html').fsPath;

	let html = fs.readFileSync(indexPath, 'utf-8');

	html = html.replace(/(href|src)="\.\/([^"]+)"/g, (_match, attr, filePath) => {
		const fileUri = vscode.Uri.joinPath(distPath, filePath);
		const webviewUri = webview.asWebviewUri(fileUri);
		return `${attr}="${webviewUri}"`;
	});

	return html;
}
