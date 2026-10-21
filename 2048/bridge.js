import http from 'node:http';
import { spawn } from 'node:child_process';
import { mkdir, open } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { Game2048, GameError } from './game.js';

const directory = path.dirname(fileURLToPath(import.meta.url));
const runtime = path.join(directory, 'runtime');
const args = process.argv.slice(2);
const command = args[0] || 'help';
const option = (name, fallback) => args.includes(name) ? args[args.indexOf(name) + 1] : fallback;
const port = Number(option('--port', '20480'));
const profile = String(option('--profile', '137'));
const endpoint = `http://127.0.0.1:${port}`;
const output = value => console.log(JSON.stringify(value));

async function request(action, extra = {}) {
    const response = await fetch(endpoint, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, ...extra }), signal: AbortSignal.timeout(90000),
    });
    const result = await response.json();
    if (!response.ok || result.error) throw new GameError(result.error || 'BRIDGE_REQUEST_FAILED');
    return result;
}

async function serve() {
    // Завантажуємо конфігурацію штатним способом без друку секретів, незалежно від поточної папки.
    const dotenv = await import('dotenv');
    dotenv.config({ path: path.join(directory, '..', '.env'), quiet: true });
    const game = new Game2048(profile);
    let queue = Promise.resolve();
    let stopping = false;
    const stop = async () => {
        if (stopping) return;
        stopping = true;
        await game.disconnect();
        server.close();
        server.closeIdleConnections();
    };
    const server = http.createServer(async (req, res) => {
        res.setHeader('Content-Type', 'application/json; charset=utf-8');
        res.setHeader('Cache-Control', 'no-store');
        // Забороняємо команди зі сторінок браузера та доступ через інші адреси.
        if (req.headers.origin || req.headers.host !== `127.0.0.1:${port}` || req.url !== '/' ||
            req.method !== 'POST' || req.headers['content-type'] !== 'application/json') {
            res.writeHead(403).end(JSON.stringify({ error: 'LOCAL_CLI_ONLY' }));
            return;
        }
        let input;
        try {
            let body = '';
            for await (const chunk of req) {
                body += chunk;
                if (body.length > 4096) throw new GameError('REQUEST_TOO_LARGE');
            }
            input = JSON.parse(body);
            if (!input || typeof input !== 'object') throw new GameError('INVALID_REQUEST');
        } catch {
            res.writeHead(400).end(JSON.stringify({ error: 'INVALID_REQUEST' }));
            return;
        }
        const run = async () => {
            try {
                if (stopping) throw new GameError('BRIDGE_STOPPING');
                let result;
                switch (input.action) {
                    case 'ping': result = { bridge: 'adsbot-2048', profile }; break;
                    case 'open': result = await game.open(); break;
                    case 'state': result = await game.state(); break;
                    case 'move': result = await game.move(input.moves, input.trace === true); break;
                    case 'new': result = await game.newGame(); break;
                    case 'inspect': result = await game.inspect(); break;
                    case 'screenshot': {
                        await mkdir(runtime, { recursive: true });
                        result = await game.screenshot(path.join(runtime, 'game.png'));
                        break;
                    }
                    case 'stop': result = { stopped: true }; break;
                    default: throw new GameError('UNKNOWN_COMMAND');
                }
                res.end(JSON.stringify(result));
                if (input.action === 'stop') await stop();
            } catch (error) {
                // Сторонні помилки можуть містити адресу CDP або дані авторизації.
                res.writeHead(400).end(JSON.stringify({
                    error: error instanceof GameError ? error.message : 'BROWSER_OR_ADSPOWER_ERROR',
                }));
            }
        };
        queue = queue.then(run, run);
    });
    server.requestTimeout = 10000;
    server.on('error', () => { output({ error: 'PORT_UNAVAILABLE' }); process.exitCode = 1; });
    server.listen(port, '127.0.0.1', () => output({ listening: port, profile }));
    process.on('SIGINT', stop);
    process.on('SIGTERM', stop);
}

async function start() {
    let running;
    try { running = await request('ping'); } catch {}
    if (running) {
        if (running.bridge !== 'adsbot-2048' || running.profile !== profile) {
            throw new GameError('PORT_USED_BY_ANOTHER_PROFILE');
        }
        return request('open');
    }
    await mkdir(runtime, { recursive: true });
    const log = await open(path.join(runtime, 'bridge.log'), 'a');
    const child = spawn(process.execPath, [fileURLToPath(import.meta.url), 'serve', '--profile', profile, '--port', String(port)], {
        cwd: directory, detached: true, windowsHide: true, stdio: ['ignore', log.fd, log.fd],
    });
    const spawned = new Promise((resolve, reject) => {
        child.once('spawn', resolve);
        child.once('error', reject);
    });
    await spawned;
    child.unref();
    await log.close();
    for (let attempt = 0; attempt < 40; attempt++) {
        await new Promise(resolve => setTimeout(resolve, 250));
        try { running = await request('ping'); } catch { continue; }
        if (running.bridge !== 'adsbot-2048' || running.profile !== profile) {
            throw new GameError('PORT_USED_BY_ANOTHER_PROFILE');
        }
        return request('open');
    }
    throw new GameError('START_FAILED_SEE_RUNTIME_LOG');
}

try {
    if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new GameError('INVALID_PORT');
    if (!/^\d+$/.test(profile)) throw new GameError('INVALID_PROFILE');
    if (command === 'serve') await serve();
    else if (command === 'start') output(await start());
    else if (['open', 'state', 'new', 'inspect', 'screenshot', 'stop'].includes(command)) output(await request(command));
    else if (command === 'move') output(await request('move', { moves: args[1], trace: args.includes('--trace') }));
    else if (command === 'help') output({ commands: ['start --profile 137', 'state', 'move LDDL', 'move LDDL --trace', 'new', 'open', 'inspect', 'screenshot', 'stop'], port: 20480 });
    else throw new GameError('UNKNOWN_COMMAND');
} catch (error) {
    output({ error: error instanceof GameError ? error.message : 'BRIDGE_UNAVAILABLE_OR_RUNTIME_ERROR' });
    process.exitCode = 1;
}
