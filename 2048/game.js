import puppeteer from 'puppeteer-core';
import AdsPower from '../classes/AdsPower.js';

const URL_GAME = 'https://crm.we-can.xyz/dailies/';
const KEYS = { L: 'ArrowLeft', U: 'ArrowUp', R: 'ArrowRight', D: 'ArrowDown' };

export class GameError extends Error {
    constructor(code) { super(code); }
}

export class Game2048 {
    constructor(profile) {
        this.profile = profile;
        this.adsPower = new AdsPower();
    }

    async connect() {
        if (this.browser?.connected) return;
        if (!this.adsPower.apiUrl) throw new GameError('ADSPOWER_CONFIG_MISSING');
        const data = await this.adsPower.openProfile(this.profile, {
            browserMode: 'visible', restoreLastOpenedTabs: true,
        });
        this.browser = await puppeteer.connect({
            browserWSEndpoint: data.ws.puppeteer, defaultViewport: null, protocolTimeout: 15000,
        });
        this.page = null;
    }

    async open() {
        await this.connect();
        if (!this.page || this.page.isClosed() || !this.isGameUrl(this.page.url())) {
            this.page = (await this.browser.pages()).find(page => this.isGameUrl(page.url()));
            if (!this.page) {
                this.page = await this.browser.newPage();
                await this.page.goto(URL_GAME, { waitUntil: 'domcontentloaded', timeout: 45000 });
            }
        }
        if (!this.isGameUrl(this.page.url())) throw new GameError('LOGIN_REQUIRED');
        this.page.setDefaultTimeout(5000);
        try { await this.page.waitForSelector('#g2048-open'); }
        catch { throw new GameError('GAME_NOT_FOUND'); }
        await this.page.bringToFront();
        if (!await this.page.$eval('#g2048-dlg', element => element.open)) {
            await this.page.click('#g2048-open');
        }
        await this.page.waitForSelector('#g2048-board .g2048-cell');
        await this.page.focus('#g2048-board');
        return this.state();
    }

    isGameUrl(url) {
        try {
            const parsed = new URL(url);
            return parsed.origin === new URL(URL_GAME).origin && parsed.pathname === '/dailies/';
        } catch { return false; }
    }

    async state() {
        if (!this.browser?.connected) return { status: 'disconnected' };
        if (!this.page || this.page.isClosed()) return { status: 'page_closed' };
        if (!this.isGameUrl(this.page.url())) return { status: 'page_changed' };
        return this.page.evaluate(() => {
            const root = document.querySelector('#g2048-dlg');
            const cells = [...document.querySelectorAll('#g2048-board .g2048-cell')];
            if (!root || cells.length !== 16) return { status: 'game_not_found' };
            const flat = cells.map(cell => Number(cell.textContent.trim()) || 0);
            const board = Array.from({ length: 4 }, (_, row) => flat.slice(row * 4, row * 4 + 4));
            // Хід можливий, якщо плитка має порожнього сусіда або рівного сусіда в цьому напрямку.
            const vectors = { L: [0, -1], U: [-1, 0], R: [0, 1], D: [1, 0] };
            const legal = Object.entries(vectors).filter(([, [dr, dc]]) => board.some((row, r) =>
                row.some((value, c) => value && board[r + dr]?.[c + dc] !== undefined &&
                    (board[r + dr][c + dc] === 0 || board[r + dr][c + dc] === value)),
            )).map(([key]) => key).join('');
            const overlay = document.querySelector('#g2048-over');
            // Прихований блок містить старий текст завершення навіть під час активної гри.
            const overlayVisible = !!overlay && !overlay.hidden && overlay.getBoundingClientRect().width > 0;
            const over = overlayVisible || !legal;
            return {
                status: !root.open ? 'closed' : over ? 'over' : 'playing',
                board,
                score: Number(document.querySelector('#g2048-score').textContent.replace(/\D/g, '')),
                legal, over, max: Math.max(...flat),
            };
        });
    }

    async move(moves, trace = false) {
        if (typeof moves !== 'string' || !/^[LURD]{1,4}$/i.test(moves)) {
            throw new GameError('MOVES_MUST_BE_1_TO_4_LURD');
        }
        let state = await this.open();
        const steps = [];
        let applied = '';
        let skipped = '';
        for (const direction of moves.toUpperCase()) {
            if (state.over) break;
            if (!state.legal.includes(direction)) {
                skipped += direction;
                continue;
            }
            await this.page.focus('#g2048-board');
            await this.page.keyboard.press(KEYS[direction]);
            // Чекаємо оновлення поля після справжнього натискання, а не змінюємо стан гри.
            try {
                await this.page.waitForFunction(previous => {
                    const next = [...document.querySelectorAll('#g2048-board .g2048-cell')]
                        .map(cell => Number(cell.textContent.trim()) || 0);
                    return JSON.stringify(next) !== previous;
                }, { timeout: 2000 }, JSON.stringify(state.board.flat()));
            } catch { throw new GameError('MOVE_NOT_APPLIED'); }
            await new Promise(resolve => setTimeout(resolve, 120));
            state = await this.state();
            if (!['playing', 'over'].includes(state.status)) throw new GameError('GAME_INTERRUPTED');
            applied += direction;
            if (trace) steps.push({ move: direction, ...state });
        }
        return { ...state, applied, ...(skipped ? { skipped } : {}), ...(trace ? { steps } : {}) };
    }

    async newGame() {
        const previous = await this.open();
        await this.page.click(previous.over ? '#g2048-again' : '#g2048-new');
        await this.page.waitForFunction(() =>
            document.querySelector('#g2048-over').hidden &&
            document.querySelector('#g2048-score').textContent.trim() === '0',
        );
        return this.state();
    }

    async inspect() {
        await this.open();
        const details = await this.page.evaluate(() => ({
            title: document.querySelector('#g2048-dlg h2')?.textContent,
            hint: document.querySelector('.g2048-hint')?.textContent,
            controls: [...document.querySelectorAll('#g2048-dlg button')]
                .filter(button => button.getBoundingClientRect().width > 0)
                .map(button => ({ id: button.id, text: button.textContent.trim() })),
            endMessage: !document.querySelector('#g2048-over').hidden
                ? document.querySelector('#g2048-over-title').textContent : null,
        }));
        return { ...await this.state(), ...details };
    }

    async screenshot(path) {
        await this.open();
        await (await this.page.$('#g2048-dlg')).screenshot({ path });
        return { ...await this.state(), screenshot: path };
    }

    async disconnect() {
        await this.browser?.disconnect();
    }
}
