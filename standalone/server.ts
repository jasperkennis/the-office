import * as http from 'http';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { WebSocketServer } from 'ws';
import type { WebSocket } from 'ws';
import type { MessageSink } from '../src/types.js';
import {
	loadFurnitureAssets,
	loadFloorTiles,
	loadWallTiles,
	loadCharacterSprites,
} from '../src/assetLoader.js';
import { loadKnownProjects, addKnownProject } from '../src/projectStore.js';
import { SERVER_PORT } from './constants.js';
import { ProjectScanner } from './projectScanner.js';
import { StandaloneAgentManager } from './standaloneAgentManager.js';
import { focusItermSession } from './itermFocus.js';

// ── Paths ────────────────────────────────────────────────────
const SETTINGS_DIR = path.join(os.homedir(), '.pixel-agents');
const SEATS_FILE = path.join(SETTINGS_DIR, 'seats.json');
const SETTINGS_FILE = path.join(SETTINGS_DIR, 'settings.json');

// Webview dist directory (built by Vite)
const WEBVIEW_DIR = path.join(__dirname, 'webview');

// Assets directory
const ASSETS_DIR = path.join(__dirname, 'assets');

// ── Persistence helpers ──────────────────────────────────────
function readJson(filePath: string): Record<string, unknown> | null {
	try {
		if (!fs.existsSync(filePath)) return null;
		return JSON.parse(fs.readFileSync(filePath, 'utf-8')) as Record<string, unknown>;
	} catch { return null; }
}

function writeJson(filePath: string, data: unknown): void {
	try {
		if (!fs.existsSync(SETTINGS_DIR)) {
			fs.mkdirSync(SETTINGS_DIR, { recursive: true });
		}
		fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf-8');
	} catch (err) {
		console.error(`[Standalone] Failed to write ${filePath}:`, err);
	}
}

// ── Pre-load assets ──────────────────────────────────────────
interface PreloadedAssets {
	characterSprites: unknown | null;
	floorTiles: unknown | null;
	wallTiles: unknown | null;
	furnitureAssets: { catalog: unknown; sprites: Map<string, string[][]> } | null;
}

async function preloadAssets(): Promise<PreloadedAssets> {
	const assetsRoot = fs.existsSync(path.join(ASSETS_DIR)) ? path.dirname(ASSETS_DIR) : null;
	if (!assetsRoot) {
		console.log('[Standalone] No assets directory found at', ASSETS_DIR);
		return { characterSprites: null, floorTiles: null, wallTiles: null, furnitureAssets: null };
	}

	console.log('[Standalone] Loading assets from', assetsRoot);
	const characterSprites = await loadCharacterSprites(assetsRoot);
	const floorTiles = await loadFloorTiles(assetsRoot);
	const wallTiles = await loadWallTiles(assetsRoot);
	const furnitureAssets = await loadFurnitureAssets(assetsRoot);

	return { characterSprites, floorTiles, wallTiles, furnitureAssets };
}

// ── Main ─────────────────────────────────────────────────────
async function main(): Promise<void> {
	const assets = await preloadAssets();

	const agentManager = new StandaloneAgentManager();

	// ── WebSocket broadcast sink ─────────────────────────────
	const clients = new Set<WebSocket>();

	const broadcastSink: MessageSink = {
		postMessage(msg: unknown) {
			const data = JSON.stringify(msg);
			for (const ws of clients) {
				if (ws.readyState === ws.OPEN) {
					ws.send(data);
				}
			}
		},
	};

	agentManager.setSink(broadcastSink);

	// ── Project scanner ──────────────────────────────────────
	const scanner = new ProjectScanner({
		onNewSession(projectDir, jsonlFile, projectName) {
			if (!agentManager.hasSession(jsonlFile)) {
				addKnownProject(projectName, projectDir);
				agentManager.addSession(projectDir, jsonlFile, projectName);
				broadcastSink.postMessage({ type: 'knownProjects', projects: loadKnownProjects() });
			}
		},
		onSessionStale(jsonlFile) {
			agentManager.removeSession(jsonlFile);
		},
	});
	scanner.start();

	// ── HTTP server ──────────────────────────────────────────
	const MIME_TYPES: Record<string, string> = {
		'.html': 'text/html',
		'.js': 'application/javascript',
		'.css': 'text/css',
		'.json': 'application/json',
		'.png': 'image/png',
		'.svg': 'image/svg+xml',
		'.woff': 'font/woff',
		'.woff2': 'font/woff2',
		'.ttf': 'font/ttf',
	};

	const server = http.createServer((req, res) => {
		let urlPath = req.url || '/';

		// Strip query strings
		const qIdx = urlPath.indexOf('?');
		if (qIdx >= 0) urlPath = urlPath.slice(0, qIdx);

		// Default to index.html
		if (urlPath === '/') urlPath = '/index.html';

		const filePath = path.join(WEBVIEW_DIR, urlPath);

		// Security: prevent path traversal
		if (!filePath.startsWith(WEBVIEW_DIR)) {
			res.writeHead(403);
			res.end('Forbidden');
			return;
		}

		try {
			if (!fs.existsSync(filePath)) {
				res.writeHead(404);
				res.end('Not Found');
				return;
			}

			const ext = path.extname(filePath);
			const contentType = MIME_TYPES[ext] || 'application/octet-stream';
			const content = fs.readFileSync(filePath);
			res.writeHead(200, { 'Content-Type': contentType });
			res.end(content);
		} catch {
			res.writeHead(500);
			res.end('Internal Server Error');
		}
	});

	// ── WebSocket server ─────────────────────────────────────
	const wss = new WebSocketServer({ noServer: true });

	server.on('upgrade', (req, socket, head) => {
		if (req.url === '/ws') {
			wss.handleUpgrade(req, socket, head, (ws) => {
				wss.emit('connection', ws, req);
			});
		} else {
			socket.destroy();
		}
	});

	wss.on('connection', (ws: WebSocket) => {
		clients.add(ws);
		console.log(`[Standalone] WebSocket client connected (${clients.size} total)`);

		ws.on('message', (raw) => {
			try {
				const msg = JSON.parse(raw.toString()) as Record<string, unknown>;
				handleClientMessage(ws, msg, agentManager, assets, broadcastSink);
			} catch {
				// Ignore malformed messages
			}
		});

		ws.on('close', () => {
			clients.delete(ws);
			console.log(`[Standalone] WebSocket client disconnected (${clients.size} total)`);
		});
	});

	server.listen(SERVER_PORT, () => {
		console.log(`\n  Pixel Agents standalone server`);
		console.log(`  Listening on http://localhost:${SERVER_PORT}\n`);
		console.log(`  Watching ~/.claude/projects/ for agent sessions...\n`);
	});

	// Graceful shutdown
	process.on('SIGINT', () => {
		console.log('\n[Standalone] Shutting down...');
		scanner.stop();
		agentManager.dispose();
		wss.close();
		server.close();
		process.exit(0);
	});
}

function handleClientMessage(
	ws: WebSocket,
	msg: Record<string, unknown>,
	agentManager: StandaloneAgentManager,
	assets: PreloadedAssets,
	broadcastSink: MessageSink,
): void {
	if (msg.type === 'webviewReady') {
		// Send all pre-loaded assets in order
		if (assets.characterSprites) {
			const cs = assets.characterSprites as { characters: unknown };
			ws.send(JSON.stringify({ type: 'characterSpritesLoaded', characters: cs.characters }));
		}
		if (assets.floorTiles) {
			const ft = assets.floorTiles as { sprites: unknown };
			ws.send(JSON.stringify({ type: 'floorTilesLoaded', sprites: ft.sprites }));
		}
		if (assets.wallTiles) {
			const wt = assets.wallTiles as { sprites: unknown };
			ws.send(JSON.stringify({ type: 'wallTilesLoaded', sprites: wt.sprites }));
		}
		if (assets.furnitureAssets) {
			const fa = assets.furnitureAssets;
			const spritesObj: Record<string, string[][]> = {};
			for (const [id, spriteData] of fa.sprites) {
				spritesObj[id] = spriteData;
			}
			ws.send(JSON.stringify({
				type: 'furnitureAssetsLoaded',
				catalog: fa.catalog,
				sprites: spritesObj,
			}));
		}

		// Send known projects
		const knownProjects = loadKnownProjects();
		ws.send(JSON.stringify({ type: 'knownProjects', projects: knownProjects }));

		// Send existing agents BEFORE layout (webview buffers them until layoutLoaded)
		const agentIds = agentManager.getExistingAgentIds();
		const agentMeta = readJson(SEATS_FILE) ?? {};
		const folderNames: Record<number, string> = {};
		for (const id of agentIds) {
			const agent = agentManager.agents.get(id);
			if (agent) folderNames[id] = agent.projectName;
		}
		ws.send(JSON.stringify({
			type: 'existingAgents',
			agents: agentIds,
			agentMeta,
			sessionIds: agentManager.getSessionIds(),
			folderNames,
		}));

		// Signal layout ready (rooms generated from known projects on webview side)
		ws.send(JSON.stringify({ type: 'layoutLoaded', layout: null }));

		// Send settings
		const settings = readJson(SETTINGS_FILE);
		const soundEnabled = settings?.soundEnabled !== false;
		ws.send(JSON.stringify({ type: 'settingsLoaded', soundEnabled }));

		// Send current tool/waiting statuses to this client
		const wsSink: MessageSink = { postMessage: (m) => ws.send(JSON.stringify(m)) };
		agentManager.sendAgentStatuses(wsSink);
	} else if (msg.type === 'focusAgent') {
		const agentId = msg.id as number;
		const sessionId = agentManager.getSessionIdForAgent(agentId);
		if (sessionId) {
			const focused = focusItermSession(sessionId);
			if (!focused) {
				console.log(`[Standalone] Could not focus iTerm session for agent ${agentId}`);
			}
		}
	} else if (msg.type === 'saveAgentSeats') {
		writeJson(SEATS_FILE, msg.seats);
	} else if (msg.type === 'setSoundEnabled') {
		writeJson(SETTINGS_FILE, { soundEnabled: msg.enabled });
	} else if (msg.type === 'openClaude' || msg.type === 'closeAgent' || msg.type === 'openSessionsFolder') {
		// Not supported in standalone mode — ignore
	}
}

main().catch((err) => {
	console.error('[Standalone] Fatal error:', err);
	process.exit(1);
});
