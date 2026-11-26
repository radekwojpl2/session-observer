// Who may use the server, and the security headers every response carries.
//
// The dashboard shows prompts, file contents and command output, so only pages served by this server may use it.
// Host: a web page that points its own domain at 127.0.0.1 (DNS rebinding) sends that domain as Host, and is refused.
// Origin: a page on another site can still send a simple POST without a preflight; a request with a foreign Origin is
// refused, and a POST must carry this server's own Origin.
// Loopback names are always allowed; OBSERVER_HOST (when it names one address) and OBSERVER_ALLOWED_HOSTS add more.
'use strict';
const crypto = require('crypto');
const { PORT, HOST, TOKEN, EXTRA_ALLOWED_HOSTS } = require('../../building-blocks/config');

const LOOPBACK_NAMES = new Set(['localhost', '127.0.0.1', '::1']);
const WILDCARD_ADDRESSES = new Set(['0.0.0.0', '::', '']);
const ALLOWED_HOST_NAMES = new Set([
  ...LOOPBACK_NAMES,
  ...(WILDCARD_ADDRESSES.has(HOST) ? [] : [HOST.toLowerCase()]),
  ...EXTRA_ALLOWED_HOSTS,
]);

// "name", "name:port" or "[ipv6]:port"
const HOST_HEADER_PATTERN = /^(?:\[([0-9a-f:.]+)]|([^:[\]]+))(?::(\d+))?$/i;

function isAllowedHost(hostHeader) {
  const match = HOST_HEADER_PATTERN.exec(String(hostHeader || ''));
  if (!match) return false;
  const name = (match[1] || match[2]).toLowerCase();
  const port = match[3] ? Number(match[3]) : 80;
  return ALLOWED_HOST_NAMES.has(name) && port === PORT;
}

function isAllowedOrigin(origin) {
  try {
    const url = new URL(origin);
    return url.protocol === 'http:' && isAllowedHost(url.host);
  } catch {
    return false;
  }
}

// Another machine (possible only when OBSERVER_HOST is not loopback) can send any Host it likes, so the Host check
// doesn't stop it: a peer that isn't this machine needs OBSERVER_TOKEN, and is refused while no token is set.
// The token comes as "Authorization: Bearer <token>" or as the cookie that opening /?token=<token> once sets.
const TOKEN_COOKIE = 'so_token';

const isLoopbackPeer = request => /^(?:::ffff:)?127\.|^::1$/.test(request.socket.remoteAddress || '');

const sha256 = text => crypto.createHash('sha256').update(String(text)).digest();

// compared in constant time
function isValidToken(candidate) {
  return !!TOKEN && candidate != null && crypto.timingSafeEqual(sha256(candidate), sha256(TOKEN));
}

function tokenFromRequest(request) {
  const bearer = /^Bearer (.+)$/.exec(request.headers.authorization || '');
  if (bearer) return bearer[1];
  const cookie = new RegExp(`(?:^|;\\s*)${TOKEN_COOKIE}=([^;]+)`).exec(request.headers.cookie || '');
  try {
    return cookie ? decodeURIComponent(cookie[1]) : null;
  } catch {
    return null;
  }
}

const tokenCookieHeader = () => `${TOKEN_COOKIE}=${encodeURIComponent(TOKEN)}; HttpOnly; SameSite=Strict; Path=/`;

// sent with every response: no MIME sniffing, no framing (clickjacking), no referrer, no cross-site embedding
const SECURITY_HEADERS = {
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'no-referrer',
  'Cross-Origin-Resource-Policy': 'same-origin',
  'Cross-Origin-Opener-Policy': 'same-origin',
};

// The page's Content-Security-Policy: scripts only from this server, plus the page's own inline scripts by hash.
// The HTML parser turns CRLF into LF before the browser hashes a script, so the hash is taken over LF text.
function contentSecurityPolicy(html) {
  const inlineScriptHashes = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(match => {
    const hash = crypto.createHash('sha256').update(match[1].replace(/\r\n?/g, '\n'), 'utf8').digest('base64');
    return `'sha256-${hash}'`;
  });
  return [
    "default-src 'none'",
    `script-src 'self' ${inlineScriptHashes.join(' ')}`.trim(),
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data:",
    "connect-src 'self'",
    "base-uri 'none'",
    "form-action 'none'",
    "frame-ancestors 'none'",
  ].join('; ');
}

module.exports = {
  LOOPBACK_NAMES, WILDCARD_ADDRESSES, SECURITY_HEADERS,
  isAllowedHost, isAllowedOrigin, isLoopbackPeer, isValidToken, tokenFromRequest, tokenCookieHeader, contentSecurityPolicy,
};
