'use strict';

/**
 * Waiting mini-games.
 *
 * Hooked in from index.html:
 *   startWaitTimer()  - called when a range download starts
 *   stopWaitTimer(ok) - called when it finishes (ok = success)
 *
 * Shows a small popup after 30s, a full-screen pixel-game overlay with three
 * original mini-games, a 2-minute play alert, a live status bar and a
 * "Download complete" banner. No libraries, no images: canvas rectangles only.
 */
(function () {
    const POPUP_DELAY_MS = 30000;
    const PLAY_LIMIT_S = 120;

    const C = {
        bg: '#0f1417',
        panel: '#182126',
        border: '#2a3942',
        text: '#e9edef',
        muted: '#8696a0',
        accent: '#25d366',
        accentDark: '#1d8f4c',
        ground: '#22303a',
        pipe: '#2c6b45',
        pipeLight: '#3f8f5d',
        water: '#123039',
        waterLine: '#1d4652',
        rock: '#3a4b55',
    };
    const FONT =
        "'Segoe UI', system-ui, 'Noto Sans Khmer', 'Khmer OS', sans-serif";

    const state = {
        downloadActive: false,
        popupShown: false,
        dismissed: false,
        popupTimer: null,
        overlay: false,
        completed: false,
        paused: false,
        alertOpen: false,
        playSeconds: 0,
        game: null,
        raf: null,
        last: 0,
        stats: { downloaded: 0, skipped: 0, failed: 0 },
        poll: null,
    };

    let ui = null;

    function h(tag, css, text) {
        const el = document.createElement(tag);
        if (css) el.style.cssText = css;
        if (text != null) el.textContent = text;
        return el;
    }

    function injectStyles() {
        if (document.getElementById('wg-styles')) return;
        const style = document.createElement('style');
        style.id = 'wg-styles';
        style.textContent = `
#wg-popup, #wg-overlay { font-family: ${FONT}; }
#wg-popup *, #wg-overlay * { box-sizing: border-box; }
#wg-popup {
  position: fixed; right: 24px; bottom: 24px; z-index: 90; width: 300px;
  background: var(--panel, ${C.panel});
  border: 1px solid var(--border, ${C.border});
  border-radius: 10px; padding: 14px;
  color: var(--text, ${C.text});
  box-shadow: 0 12px 34px rgba(0,0,0,.55);
}
#wg-popup .wg-btn {
  background: var(--chip, #22303a); color: var(--text, ${C.text});
  border-color: var(--border, ${C.border});
}
#wg-popup .wg-btn.primary {
  background: var(--accent, ${C.accent}); color: #062e14; border: 0;
}
.wg-khmer { font-family: ${FONT}; line-height: 1.45; }
#wg-overlay {
  position: fixed; inset: 0; z-index: 100; display: none;
  flex-direction: column; background: ${C.bg}; color: ${C.text};
}
#wg-overlay.wg-open { display: flex; }
.wg-btn {
  background: #22303a; color: ${C.text}; border: 1px solid ${C.border};
  border-radius: 6px; padding: 8px 14px; font: inherit; cursor: pointer;
}
.wg-btn:hover { border-color: ${C.accent}; }
.wg-btn.primary { background: ${C.accent}; color: #062e14; border: 0; font-weight: 600; }
.wg-top { padding: 8px 16px; background: ${C.panel}; border-bottom: 1px solid ${C.border}; }
.wg-track { height: 4px; background: #22303a; border-radius: 2px; overflow: hidden; }
.wg-fill {
  height: 100%; width: 100%;
  background: repeating-linear-gradient(90deg, ${C.accent} 0 12px, ${C.accentDark} 12px 24px);
  animation: wg-stripes 1s linear infinite;
}
.wg-fill.wg-done { animation: none; background: ${C.accent}; }
@keyframes wg-stripes { from { background-position: 0 0; } to { background-position: 24px 0; } }
.wg-stats { font-size: 12px; color: ${C.muted}; margin-top: 6px; }
.wg-menu {
  flex: 1; display: flex; flex-direction: column; align-items: center;
  justify-content: center; gap: 18px; padding: 24px;
}
.wg-menu h2 { margin: 0; font-size: 15px; letter-spacing: .08em; text-transform: uppercase; color: ${C.muted}; }
.wg-cards { display: flex; gap: 16px; flex-wrap: wrap; justify-content: center; }
.wg-card {
  width: 190px; padding: 14px; background: ${C.panel}; border: 1px solid ${C.border};
  border-radius: 10px; color: ${C.text}; font: inherit; cursor: pointer;
  display: flex; flex-direction: column; align-items: center; gap: 10px;
}
.wg-card:hover { border-color: ${C.accent}; }
.wg-card canvas { image-rendering: pixelated; background: ${C.bg}; border-radius: 4px; }
.wg-play { flex: 1; display: none; flex-direction: column; align-items: center; justify-content: center; gap: 10px; padding: 16px; }
.wg-play.wg-active { display: flex; }
.wg-canvas-wrap { width: min(92vw, 900px); }
#wg-canvas {
  width: 100%; height: auto; aspect-ratio: 16 / 9; image-rendering: pixelated;
  background: ${C.bg}; border: 1px solid ${C.border}; border-radius: 8px;
  touch-action: none; cursor: pointer;
}
.wg-hud {
  width: min(92vw, 900px); display: flex; justify-content: space-between;
  align-items: center; font-size: 13px; color: ${C.muted};
}
.wg-hint { color: ${C.muted}; font-size: 12px; }
.wg-alert {
  position: absolute; inset: 0; display: none; align-items: center;
  justify-content: center; background: rgba(0,0,0,.62);
}
.wg-alert.wg-open { display: flex; }
.wg-modal {
  background: ${C.panel}; border: 1px solid ${C.border}; border-radius: 12px;
  padding: 24px; text-align: center; min-width: 300px;
  box-shadow: 0 18px 50px rgba(0,0,0,.6);
}
.wg-modal p { font-size: 18px; margin: 0 0 18px; }
.wg-banner {
  position: absolute; left: 50%; bottom: 24px; transform: translateX(-50%);
  display: none; align-items: center; gap: 12px;
  background: ${C.panel}; border: 1px solid ${C.accent}; border-radius: 999px;
  padding: 10px 16px; color: ${C.text}; font-family: ${FONT};
  box-shadow: 0 12px 34px rgba(0,0,0,.55);
}
.wg-banner.wg-open { display: flex; }
`;
        document.head.appendChild(style);
    }

    /* ---------------------------------------------------------------- games */

    function px(ctx, x, y, w, h, color) {
        ctx.fillStyle = color;
        ctx.fillRect(Math.round(x), Math.round(y), Math.round(w), Math.round(h));
    }

    function label(ctx, text, x, y, color, size, align) {
        ctx.fillStyle = color;
        ctx.font = size + 'px "Courier New", monospace';
        ctx.textAlign = align || 'left';
        ctx.textBaseline = 'alphabetic';
        ctx.fillText(text, Math.round(x), Math.round(y));
    }

    class FlappyGame {
        constructor(ctx) {
            this.ctx = ctx;
            this.reset();
        }
        reset() {
            this.bird = { x: 96, y: 118, vy: 0 };
            this.pipes = [];
            this.spawn = 1.2;
            this.score = 0;
            this.over = false;
            this.t = 0;
        }
        action() {
            if (this.over) {
                this.reset();
                return;
            }
            this.bird.vy = -195;
        }
        update(dt) {
            if (this.over) return;
            this.t += dt;
            this.bird.vy += 520 * dt;
            this.bird.y += this.bird.vy * dt;
            if (this.bird.y < 0) {
                this.bird.y = 0;
                this.bird.vy = 0;
            }
            if (this.bird.y > 236) {
                this.over = true;
                return;
            }
            this.spawn -= dt;
            if (this.spawn <= 0) {
                this.spawn = 1.55;
                const gap = 88;
                const gy = 30 + Math.random() * (200 - gap);
                this.pipes.push({ x: 480, gy, gap, passed: false });
            }
            const speed = 108 + Math.min(40, this.t * 2);
            for (const p of this.pipes) p.x -= speed * dt;
            this.pipes = this.pipes.filter((p) => p.x > -60);

            const bx = this.bird.x - 9;
            const by = this.bird.y - 7;
            for (const p of this.pipes) {
                if (!p.passed && p.x + 46 < bx) {
                    p.passed = true;
                    this.score += 1;
                }
                const overlapX = bx + 18 > p.x && bx < p.x + 46;
                const outsideGap = by < p.gy || by + 14 > p.gy + p.gap;
                if (overlapX && outsideGap) this.over = true;
            }
        }
        draw() {
            const ctx = this.ctx;
            px(ctx, 0, 0, 480, 270, C.bg);
            for (let i = 0; i < 7; i += 1) {
                const bx = i * 70 + ((this.t * 8) % 70);
                px(ctx, bx, 188, 30, 52, '#152026');
            }
            for (const p of this.pipes) {
                px(ctx, p.x, 0, 46, p.gy, C.pipe);
                px(ctx, p.x + 6, 0, 10, p.gy, C.pipeLight);
                px(ctx, p.x, p.gy + p.gap, 46, 270 - (p.gy + p.gap), C.pipe);
                px(ctx, p.x + 6, p.gy + p.gap, 10, 270 - (p.gy + p.gap), C.pipeLight);
            }
            px(ctx, 0, 250, 480, 20, C.ground);
            const b = this.bird;
            px(ctx, b.x - 9, b.y - 7, 18, 14, C.accent);
            px(ctx, b.x + 3, b.y - 4, 4, 4, C.bg);
            px(ctx, b.x - 13, b.y - 1, 6, 6, C.accentDark);
            label(ctx, 'SCORE ' + this.score, 12, 20, C.muted, 10);
            if (this.over) this.drawOver();
        }
        drawOver() {
            const ctx = this.ctx;
            ctx.fillStyle = 'rgba(8,12,14,.7)';
            ctx.fillRect(0, 0, 480, 270);
            label(ctx, 'GAME OVER', 240, 120, C.text, 22, 'center');
            label(ctx, 'SPACE / TAP TO RESTART', 240, 148, C.muted, 10, 'center');
            label(ctx, 'SCORE ' + this.score, 240, 174, C.accent, 12, 'center');
        }
    }

    class RunnerGame {
        constructor(ctx) {
            this.ctx = ctx;
            this.reset();
        }
        reset() {
            this.y = 0;
            this.vy = 0;
            this.obstacles = [];
            this.spawn = 1.1;
            this.score = 0;
            this.over = false;
            this.t = 0;
        }
        action() {
            if (this.over) {
                this.reset();
                return;
            }
            if (this.y >= 0) this.vy = -350;
        }
        update(dt) {
            if (this.over) return;
            this.t += dt;
            this.y += this.vy * dt;
            this.vy += 1100 * dt;
            if (this.y > 0) {
                this.y = 0;
                this.vy = 0;
            }
            const speed = 150 + Math.min(150, this.t * 6);
            this.spawn -= dt;
            if (this.spawn <= 0) {
                this.spawn = Math.max(0.72, 1.15 - this.t * 0.01);
                this.obstacles.push({ x: 480, w: 16, h: 24 + Math.random() * 22 });
            }
            for (const o of this.obstacles) o.x -= speed * dt;
            this.obstacles = this.obstacles.filter((o) => o.x > -30);

            const playerX = 60;
            const playerY = 238 - 28 + this.y;
            for (const o of this.obstacles) {
                if (!o.passed && o.x + o.w < playerX) {
                    o.passed = true;
                    this.score += 1;
                }
                const oy = 238 - o.h;
                const hit =
                    playerX + 16 > o.x &&
                    playerX < o.x + o.w &&
                    playerY + 28 > oy;
                if (hit) this.over = true;
            }
        }
        draw() {
            const ctx = this.ctx;
            px(ctx, 0, 0, 480, 270, C.bg);
            for (let i = 0; i < 5; i += 1) {
                const bx = i * 110 + ((this.t * 12) % 110);
                px(ctx, bx, 40, 34, 8, '#152026');
                px(ctx, bx + 8, 32, 18, 8, '#152026');
            }
            px(ctx, 0, 238, 480, 32, C.ground);
            for (const o of this.obstacles) {
                const oy = 238 - o.h;
                px(ctx, o.x, oy, o.w, o.h, C.rock);
                px(ctx, o.x + 3, oy + 3, 4, o.h - 6, '#51646f');
            }
            const playerY = 238 - 28 + this.y;
            px(ctx, 60, playerY, 16, 28, C.text);
            px(ctx, 72, playerY + 6, 4, 4, C.bg);
            px(ctx, 60, playerY + 22, 16, 6, C.accent);
            label(ctx, 'SCORE ' + this.score, 12, 20, C.muted, 10);
            if (this.over) this.drawOver();
        }
        drawOver() {
            const ctx = this.ctx;
            ctx.fillStyle = 'rgba(8,12,14,.7)';
            ctx.fillRect(0, 0, 480, 270);
            label(ctx, 'GAME OVER', 240, 120, C.text, 22, 'center');
            label(ctx, 'SPACE / TAP TO RESTART', 240, 148, C.muted, 10, 'center');
            label(ctx, 'SCORE ' + this.score, 240, 174, C.accent, 12, 'center');
        }
    }

    class SurfGame {
        constructor(ctx) {
            this.ctx = ctx;
            this.reset();
        }
        reset() {
            this.y = 0;
            this.vy = 0;
            this.obstacles = [];
            this.spawn = 1;
            this.score = 0;
            this.over = false;
            this.t = 0;
        }
        action() {
            if (this.over) {
                this.reset();
                return;
            }
            if (this.y >= 0) this.vy = -320;
        }
        update(dt) {
            if (this.over) return;
            this.t += dt;
            this.y += this.vy * dt;
            this.vy += 1000 * dt;
            if (this.y > 0) {
                this.y = 0;
                this.vy = 0;
            }
            const speed = 165 + Math.min(140, this.t * 5);
            this.spawn -= dt;
            if (this.spawn <= 0) {
                this.spawn = Math.max(0.75, 1.05 - this.t * 0.01);
                this.obstacles.push({
                    x: 480,
                    w: 20,
                    h: this.t % 3 > 1.5 ? 30 : 18,
                });
            }
            for (const o of this.obstacles) o.x -= speed * dt;
            this.obstacles = this.obstacles.filter((o) => o.x > -30);

            const playerX = 68;
            const playerY = 200 - 14 + this.y;
            for (const o of this.obstacles) {
                if (!o.passed && o.x + o.w < playerX) {
                    o.passed = true;
                    this.score += 1;
                }
                const oy = 214 - o.h;
                const hit =
                    playerX + 22 > o.x &&
                    playerX < o.x + o.w &&
                    playerY + 16 > oy;
                if (hit) this.over = true;
            }
        }
        draw() {
            const ctx = this.ctx;
            px(ctx, 0, 0, 480, 270, C.water);
            const shift = (this.t * 60) % 40;
            for (let i = 0; i < 8; i += 1) {
                const y = 30 + i * 28;
                for (let x = -40; x < 500; x += 40) {
                    px(ctx, x - shift, y, 24, 2, C.waterLine);
                }
            }
            px(ctx, 0, 214, 480, 56, '#0d2229');
            for (const o of this.obstacles) {
                const oy = 214 - o.h;
                px(ctx, o.x, oy, o.w, o.h, C.rock);
                px(ctx, o.x + 4, oy + 3, o.w - 8, 4, '#51646f');
            }
            const playerY = 200 - 14 + this.y;
            px(ctx, 68, playerY + 12, 22, 6, C.accent);
            px(ctx, 74, playerY, 10, 14, C.accentDark);
            px(ctx, 80, playerY + 3, 4, 4, C.bg);
            label(ctx, 'SCORE ' + this.score, 12, 20, C.muted, 10);
            if (this.over) this.drawOver();
        }
        drawOver() {
            const ctx = this.ctx;
            ctx.fillStyle = 'rgba(8,13,15,.72)';
            ctx.fillRect(0, 0, 480, 270);
            label(ctx, 'GAME OVER', 240, 120, C.text, 22, 'center');
            label(ctx, 'SPACE / TAP TO RESTART', 240, 148, C.muted, 10, 'center');
            label(ctx, 'SCORE ' + this.score, 240, 174, C.accent, 12, 'center');
        }
    }

    function drawIcon(canvas, kind) {
        const ctx = canvas.getContext('2d');
        px(ctx, 0, 0, 96, 56, C.bg);
        if (kind === 'flappy') {
            px(ctx, 58, 0, 12, 20, C.pipe);
            px(ctx, 58, 34, 12, 22, C.pipe);
            px(ctx, 23, 22, 16, 12, C.accent);
            px(ctx, 35, 25, 3, 3, C.bg);
            px(ctx, 0, 49, 96, 7, C.ground);
        } else if (kind === 'dino') {
            px(ctx, 0, 49, 96, 7, C.ground);
            px(ctx, 26, 24, 12, 22, C.text);
            px(ctx, 36, 29, 3, 3, C.bg);
            px(ctx, 26, 41, 12, 5, C.accent);
            px(ctx, 64, 30, 10, 19, C.rock);
        } else {
            px(ctx, 0, 0, 96, 56, C.water);
            for (let y = 12; y < 50; y += 12) px(ctx, 4, y, 40, 2, C.waterLine);
            px(ctx, 30, 34, 22, 6, C.accent);
            px(ctx, 36, 24, 10, 12, C.accentDark);
            px(ctx, 70, 28, 10, 20, C.rock);
        }
    }

    /* ------------------------------------------------------------------- UI */

    function ensureUi() {
        if (ui) return ui;
        injectStyles();

        const popup = h('div');
        popup.id = 'wg-popup';
        popup.style.display = 'none';
        popup.innerHTML =
            '<div class="wg-khmer" style="font-size:15px">' +
            'ចាំយូរមែន?😪 លេងហ្គេម ហេ?😂' +
            '</div>' +
            '<div style="display:flex;gap:8px;margin-top:12px;justify-content:flex-end">' +
            '<button class="wg-play-btn wg-btn primary">Play</button>' +
            '<button class="wg-work-btn wg-btn">ជាប់ធ្វើការ🙄</button>' +
            '</div>';
        document.body.appendChild(popup);

        const overlay = h('div');
        overlay.id = 'wg-overlay';
        overlay.innerHTML =
            '<div class="wg-top">' +
            '<div class="wg-track"><div class="wg-fill"></div></div>' +
            '<div class="wg-stats">saved 0 · skipped 0 · failed 0</div>' +
            '</div>' +
            '<div class="wg-menu">' +
            '<h2>Pick a game</h2>' +
            '<div class="wg-cards">' +
            '<button class="wg-card" data-game="flappy"><canvas width="96" height="56"></canvas><span>Flappy Bird style</span></button>' +
            '<button class="wg-card" data-game="dino"><canvas width="96" height="56"></canvas><span>Chrome Dino style</span></button>' +
            '<button class="wg-card" data-game="surf"><canvas width="96" height="56"></canvas><span>Edge Surf style</span></button>' +
            '</div>' +
            '<button class="wg-close wg-btn">Close</button>' +
            '</div>' +
            '<div class="wg-play">' +
            '<div class="wg-hud"><span class="wg-score">Score 0</span>' +
            '<div><button class="wg-menu-btn wg-btn">Menu</button> ' +
            '<button class="wg-close wg-btn">Close</button></div></div>' +
            '<div class="wg-canvas-wrap"><canvas id="wg-canvas" width="480" height="270"></canvas></div>' +
            '<div class="wg-hint">Space / ↑ / tap to play</div>' +
            '</div>' +
            '<div class="wg-alert">' +
            '<div class="wg-modal"><p class="wg-khmer">ហ្អេ ! ធ្វើការ 😑</p>' +
            '<div><button class="wg-quit wg-btn">Quit game</button> ' +
            '<button class="wg-continue wg-btn primary">Continue game</button></div></div>' +
            '</div>' +
            '<div class="wg-banner">Download complete ' +
            '<button class="wg-back wg-btn primary">Back to work</button></div>';
        document.body.appendChild(overlay);

        const q = (sel) => overlay.querySelector(sel);
        ui = {
            popup,
            overlay,
            menu: q('.wg-menu'),
            play: q('.wg-play'),
            alert: q('.wg-alert'),
            banner: q('.wg-banner'),
            stats: q('.wg-stats'),
            fill: q('.wg-fill'),
            score: q('.wg-score'),
            canvas: q('#wg-canvas'),
        };

        popup.querySelector('.wg-play-btn').addEventListener('click', () => {
            hidePopup();
            openOverlay();
        });
        popup.querySelector('.wg-work-btn').addEventListener('click', () => {
            state.dismissed = true;
            hidePopup();
        });
        overlay.querySelectorAll('.wg-close').forEach((btn) =>
            btn.addEventListener('click', closeOverlay),
        );
        q('.wg-menu-btn').addEventListener('click', backToMenu);
        q('.wg-quit').addEventListener('click', () => {
            closeAlert();
            closeOverlay();
        });
        q('.wg-continue').addEventListener('click', () => {
            closeAlert();
            state.playSeconds = 0;
            state.paused = false;
            state.last = performance.now();
            startLoop();
        });
        q('.wg-back').addEventListener('click', closeOverlay);
        overlay.querySelectorAll('.wg-card').forEach((card) => {
            drawIcon(card.querySelector('canvas'), card.dataset.game);
            card.addEventListener('click', () => startGame(card.dataset.game));
        });

        ui.canvas.addEventListener('pointerdown', (ev) => {
            ev.preventDefault();
            gameInput();
        });

        return ui;
    }

    function showPopup() {
        const u = ensureUi();
        u.popup.style.display = 'block';
    }
    function hidePopup() {
        if (ui) ui.popup.style.display = 'none';
    }

    function openOverlay() {
        const u = ensureUi();
        state.overlay = true;
        state.completed = false;
        u.overlay.classList.add('wg-open');
        u.banner.classList.remove('wg-open');
        u.menu.style.display = 'flex';
        u.play.classList.remove('wg-active');
        document.body.style.overflow = 'hidden';
        renderStats();
        startPoll();
    }

    function closeOverlay() {
        if (!ui) return;
        stopLoop();
        closeAlert();
        hideBanner();
        ui.overlay.classList.remove('wg-open');
        ui.menu.style.display = 'flex';
        ui.play.classList.remove('wg-active');
        state.overlay = false;
        state.game = null;
        state.paused = false;
        state.playSeconds = 0;
        state.completed = false;
        document.body.style.overflow = '';
        stopPoll();
    }

    function backToMenu() {
        stopLoop();
        state.game = null;
        if (!ui) return;
        ui.play.classList.remove('wg-active');
        ui.menu.style.display = 'flex';
    }

    function startGame(kind) {
        const u = ensureUi();
        ui.menu.style.display = 'none';
        ui.play.classList.add('wg-active');
        const ctx = u.canvas.getContext('2d');
        if (kind === 'dino') state.game = new RunnerGame(ctx);
        else if (kind === 'surf') state.game = new SurfGame(ctx);
        else state.game = new FlappyGame(ctx);
        state.paused = false;
        state.alertOpen = false;
        state.last = performance.now();
        updateScore();
        state.game.draw();
        startLoop();
    }

    function startLoop() {
        if (state.raf || !state.overlay || state.paused || !state.game) return;
        state.last = performance.now();
        state.raf = requestAnimationFrame(loop);
    }

    function stopLoop() {
        if (state.raf) {
            cancelAnimationFrame(state.raf);
            state.raf = null;
        }
    }

    function loop(ts) {
        state.raf = null;
        if (!state.overlay || state.paused || !state.game) return;
        const dt = Math.min(0.05, Math.max(0, (ts - state.last) / 1000));
        state.last = ts;
        state.playSeconds += dt;
        if (state.playSeconds >= PLAY_LIMIT_S) {
            openAlert();
            return;
        }
        state.game.update(dt);
        state.game.draw();
        updateScore();
        state.raf = requestAnimationFrame(loop);
    }

    function updateScore() {
        if (ui && state.game) {
            ui.score.textContent = 'Score ' + state.game.score;
        }
    }

    function gameInput() {
        if (!state.game || state.paused || state.alertOpen || !state.overlay) return;
        state.game.action();
    }

    function openAlert() {
        state.paused = true;
        stopLoop();
        state.alertOpen = true;
        if (ui) ui.alert.classList.add('wg-open');
    }

    function closeAlert() {
        state.alertOpen = false;
        if (ui) ui.alert.classList.remove('wg-open');
    }

    function showBanner() {
        if (!ui) return;
        ui.banner.classList.add('wg-open');
        ui.fill.classList.add('wg-done');
    }
    function hideBanner() {
        if (ui) ui.banner.classList.remove('wg-open');
    }

    function renderStats() {
        if (!ui) return;
        const s = state.stats;
        ui.stats.textContent =
            'saved ' + s.downloaded + ' · skipped ' + s.skipped + ' · failed ' + s.failed;
    }

    async function pollStats() {
        if (!state.overlay) return;
        try {
            const res = await fetch('/api/status');
            const data = await res.json();
            if (data.stats) {
                state.stats = data.stats;
                renderStats();
            }
        } catch (err) {
            /* offline / server restarting: keep the last numbers */
        }
    }

    function startPoll() {
        pollStats();
        if (state.poll) clearInterval(state.poll);
        state.poll = setInterval(pollStats, 1500);
    }

    function stopPoll() {
        if (state.poll) {
            clearInterval(state.poll);
            state.poll = null;
        }
    }

    /* --------------------------------------------------------------- public */

    function startWaitTimer() {
        ensureUi();
        state.downloadActive = true;
        state.popupShown = false;
        state.dismissed = false;
        state.completed = false;
        hidePopup();
        hideBanner();
        if (ui) ui.fill.classList.remove('wg-done');
        clearTimeout(state.popupTimer);
        state.popupTimer = setTimeout(() => {
            if (!state.downloadActive || state.dismissed || state.overlay) return;
            state.popupShown = true;
            showPopup();
        }, POPUP_DELAY_MS);
    }

    function stopWaitTimer(ok) {
        state.downloadActive = false;
        clearTimeout(state.popupTimer);
        state.popupTimer = null;
        hidePopup();
        if (state.overlay) {
            if (ok !== false) {
                state.completed = true;
                showBanner();
                if (ui) {
                    ui.fill.classList.add('wg-done');
                    ui.stats.textContent =
                        'saved ' + state.stats.downloaded +
                        ' · skipped ' + state.stats.skipped +
                        ' · failed ' + state.stats.failed;
                }
            } else {
                if (ui) {
                    ui.fill.classList.add('wg-done');
                    ui.stats.textContent = 'Download stopped';
                }
            }
        }
    }

    document.addEventListener('keydown', (ev) => {
        if (!state.overlay) return;
        if (
            ev.code === 'Space' ||
            ev.code === 'ArrowUp' ||
            ev.code === 'ArrowDown' ||
            ev.code === 'ArrowLeft' ||
            ev.code === 'ArrowRight'
        ) {
            ev.preventDefault();
        }
        if (ev.code === 'Escape') {
            if (!state.alertOpen) closeOverlay();
            return;
        }
        if (ev.code === 'Space' || ev.code === 'ArrowUp') gameInput();
    });

    window.startWaitTimer = startWaitTimer;
    window.stopWaitTimer = stopWaitTimer;
})();
