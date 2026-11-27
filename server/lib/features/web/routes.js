// HTTP: the request checks, the dashboard page and its files, and the JSON API.
'use strict';
const fs = require('fs');
const path = require('path');
const { PORT, SESSION_LOG_DIR, TOKEN, VERSION, DASHBOARD_PAGE, DASHBOARD_ASSETS_DIR } = require('../../building-blocks/config');
const guard = require('./request-guard');
const { sessions, sessionSummary, eventsOfAllSessions } = require('../sessions/sessions');
const { setPin } = require('../sessions/pins');
const { sessionContext } = require('../context/session-context');
const { publicAgents } = require('../agents/registry');
const { addClient, broadcast } = require('../../building-blocks/live-updates');

const ALL_SESSIONS = 'all'; // the session id in /api/events?session= that asks for every session's events
const ASSET_CONTENT_TYPES = { '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.png': 'image/png' };
// a file in the dashboard folder or its subfolders: every part of the path is a plain name (letters, digits, - and _,
// never a dot), and the file has a known extension, so a request can't leave the folder
const ASSET_PATH = /^\/dashboard\/((?:[A-Za-z0-9_-]+\/)*[A-Za-z0-9_-]+)([.]css|[.]js|[.]png)$/;

function sendJson(response, status, body) {
  response.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
  response.end(JSON.stringify(body));
}

const sendError = (response, status, message) => sendJson(response, status, { error: message });
// an unexpected failure: the details (file paths, say) go to the server's log, not to the client
function sendServerError(response, error) {
  console.error(error);
  sendError(response, 500, 'server error, see the server log');
}

// Why a request that isn't from this server's own pages is refused, or null when it is fine.
function foreignRequestRefusal(request) {
  if (!guard.isAllowedHost(request.headers.host)) return 'forbidden host';
  const origin = request.headers.origin;
  if (origin !== undefined && !guard.isAllowedOrigin(origin)) return 'forbidden origin';
  if (request.method !== 'GET' && request.method !== 'HEAD' && !origin) return 'origin required';
  // a browser marks a request another site's page makes; a link from another site (a navigation) may still open the page
  if (request.headers['sec-fetch-site'] === 'cross-site' && request.headers['sec-fetch-mode'] !== 'navigate') return 'cross-site request';
  return null;
}

// Another machine needs the token. Returns true when the request was answered here (refused, or redirected).
function answeredPeerWithoutToken(request, response, url) {
  if (guard.isLoopbackPeer(request)) return false;
  if (!TOKEN) {
    sendError(response, 403, 'access from another machine needs OBSERVER_TOKEN');
    return true;
  }
  const tokenInUrl = url.searchParams.get('token');
  if (tokenInUrl != null && guard.isValidToken(tokenInUrl)) {
    // trade the URL token for a cookie, and drop it from the address bar
    response.writeHead(302, { Location: '/', 'Set-Cookie': guard.tokenCookieHeader() });
    response.end();
    return true;
  }
  if (!guard.isValidToken(guard.tokenFromRequest(request))) {
    sendError(response, 401, 'token required');
    return true;
  }
  return false;
}

function serveDashboardPage(response) {
  let html;
  try { html = fs.readFileSync(DASHBOARD_PAGE, 'utf8'); } catch { return sendError(response, 500, 'dashboard missing'); }
  response.writeHead(200, {
    'Content-Type': 'text/html; charset=utf-8',
    'Cache-Control': 'no-store',
    'Content-Security-Policy': guard.contentSecurityPolicy(html),
  });
  response.end(html);
}

function serveDashboardAsset(response, [, relativePath, extension]) {
  fs.readFile(path.join(DASHBOARD_ASSETS_DIR, ...relativePath.split('/')) + extension, (error, body) => {
    if (error) return sendError(response, 404, 'not found');
    // the browser itself fetches a notification's icon, outside the page, so same-origin would block it;
    // an image here is only the app logo, safe for anyone to load
    if (extension === '.png') response.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
    response.writeHead(200, { 'Content-Type': ASSET_CONTENT_TYPES[extension], 'Cache-Control': 'no-store' });
    response.end(body);
  });
}

function sessionsNewestFirst() {
  return [...sessions.values()].map(sessionSummary).sort((a, b) => (b.last || '').localeCompare(a.last || ''));
}

function serveEvents(response, url) {
  const sessionId = url.searchParams.get('session');
  const since = url.searchParams.get('since') || null;
  if (sessionId === ALL_SESSIONS) return sendJson(response, 200, eventsOfAllSessions(since));
  const session = sessions.get(sessionId);
  if (!session) return sendError(response, 404, 'unknown session');
  sendJson(response, 200, since ? session.events.filter(event => event.ts >= since) : session.events);
}

function serveContext(response, url) {
  const session = sessions.get(url.searchParams.get('session'));
  if (!session) return sendError(response, 404, 'unknown session');
  try {
    sendJson(response, 200, sessionContext(session));
  } catch (error) {
    sendServerError(response, error);
  }
}

// Session mutations and the clear-log and load-older POSTs are handled before the read routes.
function createRequestHandler({ clearLog, deleteSession, logHistory, loadOlderDays }) {
  const routes = {
    '/': (request, response) => serveDashboardPage(response),
    '/index.html': (request, response) => serveDashboardPage(response),
    '/favicon.ico': (request, response) => { response.writeHead(204); response.end(); },
    '/api/health': (request, response) => sendJson(response, 200, { ok: true, version: VERSION, port: PORT, log: SESSION_LOG_DIR, sessions: sessions.size }),
    '/api/sessions': (request, response) => sendJson(response, 200, sessionsNewestFirst()),
    '/api/events': (request, response, url) => serveEvents(response, url),
    '/api/history': (request, response) => sendJson(response, 200, logHistory()),
    '/api/agents': (request, response) => sendJson(response, 200, publicAgents()),
    '/api/context': (request, response, url) => serveContext(response, url),
    '/api/stream': (request, response) => addClient(request, response, { version: VERSION }),
  };

  return (request, response) => {
    for (const [header, value] of Object.entries(guard.SECURITY_HEADERS)) response.setHeader(header, value);
    const refusal = foreignRequestRefusal(request);
    if (refusal) return sendError(response, 403, refusal);
    // a fixed base: the Host header is never parsed as part of the URL (a malformed one used to crash the server)
    let url;
    try { url = new URL(request.url, 'http://localhost'); } catch { return sendError(response, 400, 'bad request'); }
    if (answeredPeerWithoutToken(request, response, url)) return;

    const asset = ASSET_PATH.exec(url.pathname);
    if (asset) return serveDashboardAsset(response, asset);
    if (url.pathname === '/api/clear' && request.method === 'POST') {
      try { clearLog(); } catch (error) { return sendServerError(response, error); }
      broadcast('reset', {});
      return sendJson(response, 200, { ok: true });
    }
    if (url.pathname === '/api/history/older' && request.method === 'POST') {
      try { return sendJson(response, 200, loadOlderDays()); } catch (error) { return sendServerError(response, error); }
    }
    const sessionMatch = url.pathname.match(/^\/api\/sessions\/([^/]+)(\/pin)?$/);
    const pinChange = sessionMatch?.[2] && (request.method === 'PUT' || request.method === 'DELETE');
    const sessionDelete = sessionMatch && !sessionMatch[2] && request.method === 'DELETE';
    if (pinChange || sessionDelete) {
      let sessionId;
      try { sessionId = decodeURIComponent(sessionMatch[1]); } catch { return sendError(response, 400, 'bad session id'); }
      try {
        if (pinChange) {
          const session = sessions.get(sessionId);
          if (!session) return sendError(response, 404, 'unknown session');
          setPin(sessionId, request.method === 'PUT');
          const summary = sessionSummary(session);
          broadcast('session', summary);
          return sendJson(response, 200, { pinned: summary.pinned });
        }
        if (!deleteSession(sessionId)) return sendError(response, 404, 'unknown session');
        return sendJson(response, 200, { ok: true });
      } catch (error) {
        return sendServerError(response, error);
      }
    }
    const route = Object.hasOwn(routes, url.pathname) ? routes[url.pathname] : null;
    if (route) return route(request, response, url);
    sendError(response, 404, 'not found');
  };
}

module.exports = { createRequestHandler };
