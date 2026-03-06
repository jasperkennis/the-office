import { execSync } from 'child_process';

/**
 * Attempt to focus the iTerm2 tab running the Claude session with the given session ID.
 *
 * Strategy:
 * 1. Find `claude` process with `--session-id <sessionId>`, get its TTY
 * 2. Use osascript to find and select the iTerm2 session with that TTY
 */
export function focusItermSession(sessionId: string): boolean {
	try {
		// Find the TTY for the claude process with this session ID
		const tty = findTtyForSession(sessionId);
		if (tty) {
			return focusByTty(tty);
		}
		return false;
	} catch (err) {
		console.log(`[iTerm Focus] Error: ${err}`);
		return false;
	}
}

function findTtyForSession(sessionId: string): string | null {
	try {
		// Look for claude process with --session-id argument
		const output = execSync(
			`ps aux | grep -F "session-id ${sessionId}" | grep -v grep`,
			{ encoding: 'utf-8', timeout: 3000 },
		).trim();

		if (!output) return null;

		// Parse ps output to get the TTY column (column 7)
		const lines = output.split('\n');
		for (const line of lines) {
			const parts = line.trim().split(/\s+/);
			if (parts.length >= 7) {
				const tty = parts[6];
				if (tty && tty !== '??' && tty !== '?') {
					return tty;
				}
			}
		}
		return null;
	} catch {
		return null;
	}
}

function focusByTty(tty: string): boolean {
	try {
		const script = `
tell application "iTerm2"
	activate
	repeat with w in windows
		repeat with t in tabs of w
			repeat with s in sessions of t
				if tty of s contains "${tty}" then
					select t
					tell w to select
					return true
				end if
			end repeat
		end repeat
	end repeat
end tell
return false
`;
		const result = execSync(`osascript -e '${script.replace(/'/g, "'\"'\"'")}'`, {
			encoding: 'utf-8',
			timeout: 5000,
		}).trim();

		return result === 'true';
	} catch {
		return false;
	}
}
