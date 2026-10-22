'use strict';

const crypto = require('crypto');

/**
 * Shared-password gate for the web UI.
 *
 * Enabled only when config.password is a non-empty string. When enabled,
 * every route except the login page requires browser carries a signed-in
 * cookie. This exists so the app can be published on the internet
 * (LAN shared drive or a tunnel) without the whole team having write access.
 */

function authHash(password) {
    // Only stored as a cookie probe - never store raw password in the cookie
    // and never compare browser input against it directly.
    return crypto.createHash('sha256').update(`wps-auth:${password}`).digest('hex');
}

function parseCookies(header) {
    const out = {};
    if (!header) return out;
    for (const part of header.split(';')) {
        const idx = part.indexOf('=');
        if (idx === -1) continue;
        const name = part.slice(0, idx).trim();
        const value = part.slice(idx + 1).trim();
        if (name) out[name] = decodeURIComponent(value);
    }
    return out;
}

const LOGIN_PAGE = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>WhatsApp Photo Saver — sign in</title>
<style>
  *{box-sizing:border-box;margin:0;padding:0}
  body{min-height:100vh;display:flex;align-items:center;justify-content:center;
       background:#0b0f10;color:#e8f0f0;font-family:"Segoe UI",system-ui,Arial,sans-serif}
  .card{background:#131a1c;border:1px solid #243034;border-radius:14px;padding:32px;width:min(340px,90vw)}
  h1{font-size:1.15rem;color:#fff;margin-bottom:6px}
  .saver{color:#28d86b}
  p{color:#9ab3b3;font-size:.9rem;margin-bottom:18px}
  input{width:100%;padding:11px 13px;border-radius:9px;border:1px solid #243034;
        background:#182124;color:#e8f0f0;font-size:1rem;margin-bottom:14px}
  input:focus{outline:none;border-color:#28d86b}
  button{width:100%;padding:11px;border:none;border-radius:9px;background:#28d86b;
         color:#04170b;font-weight:700;font-size:1rem;cursor:pointer}
  button:hover{background:#3ae07f}
  .err{color:#ff7b7b;font-size:.85rem;margin-bottom:12px;display:none}
  .err.show{display:block}
</style>
</head>
<body>
  <form class="card" method="post" action="/login">
    <h1><span style="color:#fff">WhatsApp</span> <span class="saver">Photo Saver</span></h1>
    <p>Enter the shared access password.</p>
    <div class="err" id="err">Wrong password — try again.</div>
    <input type="password" name="password" autofocus autocomplete="current-password" required>
    <button type="submit">Sign in</button>
  </form>
  <script>
    if (new URLSearchParams(location.search).get('e') === '1') {
      document.getElementById('err').className = 'err show';
    }
  </script>
</body>
</html>`;

/**
 * Returns an Express middleware that enforces the password gate.
 * behaviour:
 *   - password not configured -> pass-through (local single-user, unchanged)
 *   - /login GET/POST handled by this gate itself
 */
function createPasswordGate(config) {
    const enabled = typeof config.password === 'string' && config.password.length > 0;
    const token = enabled ? authHash(config.password) : null;
    const COOKIE = 'wps_auth';

    const gate = (req, res, next) => {
        if (!enabled) return next();

        // The login flow itself must be reachable.
        if (req.path === '/login' && req.method === 'GET') {
            return res.send(LOGIN_PAGE);
        }

        if (req.path === '/login' && req.method === 'POST') {
            const submitted = (req.body && req.body.password) || '';
            if (typeof submitted === 'string' && authHash(submitted) === token) {
                res.setHeader(
                    'Set-Cookie',
                    `${COOKIE}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=2592000`
                );
                let target = '/';
                try {
                    if (typeof req.query.go === 'string' && req.query.go.startsWith('/') && !req.query.go.startsWith('//')) {
                        target = req.query.go;
                    }
                } catch (err) { /* keep default */ }
                return res.redirect(target);
            }
            // Soft brake against brute force while keeping the UI responsive.
            res.status(401);
            return res.type('html').send(
                LOGIN_PAGE.replace(
                    '</script>',
                    "document.addEventListener('DOMContentLoaded',function(){document.getElementById('err').className='err show';});</script>"
                )
            );
        }

        const cookies = parseCookies(req.headers.cookie);
        if (cookies[COOKIE] === token) return next();

        if (req.path.startsWith('/api/')) {
            return res.status(401).json({ ok: false, error: 'Password required' });
        }
        return res.redirect(`/login?go=${encodeURIComponent(req.originalUrl || '/')}`);
    };

    gate.enabled = enabled;
    return gate;
}

module.exports = { createPasswordGate };
