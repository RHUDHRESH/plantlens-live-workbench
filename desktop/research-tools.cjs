const dns = require('node:dns').promises;
const net = require('node:net');
const https = require('node:https');
const { randomUUID } = require('node:crypto');

const blocked = (reason, action) => ({ status: 'BLOCKED', reason, action });
function isPrivate(address) {
  if (net.isIPv4(address)) {
    const p = address.split('.').map(Number);
    return p[0] === 10 || p[0] === 127 || p[0] === 0 || p[0] === 100 && p[1] >= 64 && p[1] <= 127 || p[0] === 169 && p[1] === 254 || p[0] === 172 && p[1] >= 16 && p[1] <= 31 || p[0] === 192 && p[1] === 168 || p[0] >= 224;
  }
  // Fail closed for non-global IPv6, including every IPv4-mapped/compatible
  // spelling. Only native global unicast 2000::/3 is eligible.
  if (!net.isIPv6(address)) return true;
  const v = new URL(`https://[${address}]/`).hostname.slice(1, -1).toLowerCase();
  const first = Number.parseInt(v.split(':')[0], 16);
  return !(first >= 0x2000 && first <= 0x3fff) || v.startsWith('2001:db8:') || v.startsWith('2002:');
}
async function assertPublicUrl(raw, timeoutMs = 8000) {
  let url;
  try { url = new URL(raw); } catch { throw new Error('Research result URL is invalid'); }
  if (url.protocol !== 'https:' || url.username || url.password || url.port) throw new Error('Only standard HTTPS research URLs are allowed');
  const host = url.hostname.toLowerCase();
  if (host === 'localhost' || host.endsWith('.localhost') || host.startsWith('[') || net.isIP(host)) throw new Error('IP-literal and local research URLs are blocked');
  let timer;
  const answers = await Promise.race([
    dns.lookup(host, { all: true }),
    new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('Research DNS lookup timed out')), timeoutMs); timer.unref?.(); }),
  ]).finally(() => clearTimeout(timer));
  if (!answers.length || answers.some(a => isPrivate(a.address))) throw new Error('Private or unresolved research hosts are blocked');
  const selected = answers.find(a => net.isIPv4(a.address)) || answers[0];
  return { url, address: selected.address, family: selected.family };
}
async function boundedTextFetch(raw, redirects = 0, deadline = Date.now() + 8000) {
  if (redirects > 3) throw new Error('Too many research redirects');
  if (Date.now() >= deadline) throw new Error('Research page timed out');
  const vetted = await assertPublicUrl(raw, Math.max(1, deadline - Date.now())); const url = vetted.url;
  const response = await new Promise((resolve, reject) => {
    const req = https.get(url, { signal: AbortSignal.timeout(Math.max(1, deadline - Date.now())), timeout: 8000, headers: { Accept: 'text/html,text/plain;q=0.9', 'User-Agent': 'PlantLens/0.1 local research importer' }, lookup: (_host, _opts, callback) => callback(null, vetted.address, vetted.family) }, resolve);
    req.on('timeout', () => req.destroy(new Error('Research page timed out'))); req.on('error', reject);
  });
  if ([301, 302, 303, 307, 308].includes(response.statusCode)) { response.destroy(); return boundedTextFetch(new URL(response.headers.location || '', url).href, redirects + 1, deadline); }
  if (response.statusCode < 200 || response.statusCode >= 300) { response.resume(); throw new Error(`Research page returned HTTP ${response.statusCode}`); }
  const type = String(response.headers['content-type'] || '').toLowerCase();
  if (!type.includes('text/html') && !type.includes('text/plain')) { response.destroy(); throw new Error('Research page is not supported text content'); }
  const declared = Number(response.headers['content-length'] || 0);
  if (declared > 512 * 1024) { response.destroy(); throw new Error('Research page exceeds 512 KiB'); }
  let total = 0; const parts = [];
  for await (const value of response) { total += value.byteLength; if (total > 512 * 1024) { response.destroy(); throw new Error('Research page exceeds 512 KiB'); } parts.push(value); }
  let text = Buffer.concat(parts.map(v => Buffer.from(v))).toString('utf8');
  if (type.includes('html')) text = text.replace(/<(script|style|noscript)[^>]*>[\s\S]*?<\/\1>/gi, ' ').replace(/<[^>]+>/g, ' ').replace(/&nbsp;/gi, ' ').replace(/&amp;/gi, '&').replace(/\s+/g, ' ').trim();
  return text.slice(0, 500_000);
}

class ResearchTools {
  constructor({ evidenceTools, apiKey = process.env.BRAVE_SEARCH_API_KEY, fetchImpl = fetch } = {}) { this.evidenceTools = evidenceTools; this.apiKey = apiKey; this.fetchImpl = fetchImpl; this.results = new Map(); }
  status() { return { provider: 'Brave Search', configured: Boolean(this.apiKey) }; }
  configure(apiKey) { this.apiKey = apiKey; return this.status(); }
  async search(input) {
    if (!input || input.approved !== true) return blocked('CONSENT_REQUIRED', 'Approve this specific web search before retrying.');
    if (typeof input.query !== 'string' || !input.query.trim() || input.query.length > 200 || Object.keys(input).some(k => !['query', 'approved'].includes(k))) throw new TypeError('query must contain 1-200 characters and approved must be true');
    if (!this.apiKey) return blocked('PROVIDER_NOT_CONFIGURED', 'Open Web research → Set up search and save a Brave Search API key, then approve the query.');
    const endpoint = new URL('https://api.search.brave.com/res/v1/web/search'); endpoint.searchParams.set('q', input.query.trim()); endpoint.searchParams.set('count', '5');
    const response = await this.fetchImpl(endpoint, { signal: AbortSignal.timeout(8000), headers: { Accept: 'application/json', 'X-Subscription-Token': this.apiKey } }).catch(() => null);
    if (!response?.ok) return blocked('PROVIDER_UNAVAILABLE', 'Check the Brave Search configuration and network, then retry.');
    if (Number(response.headers?.get?.('content-length') || 0) > 256 * 1024) return blocked('PROVIDER_UNAVAILABLE', 'The search provider returned an oversized response.');
    let raw;
    if (response.body) {
      const parts = []; let bytes = 0;
      for await (const chunk of response.body) {
        bytes += chunk.byteLength;
        if (bytes > 256 * 1024) return blocked('PROVIDER_UNAVAILABLE', 'The search provider returned an oversized response.');
        parts.push(Buffer.from(chunk));
      }
      raw = Buffer.concat(parts).toString('utf8');
    } else { raw = await response.text(); }
    if (Buffer.byteLength(raw) > 256 * 1024) return blocked('PROVIDER_UNAVAILABLE', 'The search provider returned an oversized response.');
    let payload; try { payload = JSON.parse(raw); } catch { return blocked('PROVIDER_UNAVAILABLE', 'The search provider returned an invalid response.'); }
    const results = (Array.isArray(payload.web?.results) ? payload.web.results : []).filter(row => row && typeof row === 'object').slice(0, 5).map(row => ({ resultId: randomUUID(), title: String(row.title || '').slice(0, 200), url: String(row.url || '').slice(0, 2048), snippet: String(row.description || '').replace(/<[^>]+>/g, '').slice(0, 600) })).filter(r => r.title && r.url.startsWith('https://'));
    results.forEach(result => this.results.set(result.resultId, result));
    while (this.results.size > 50) this.results.delete(this.results.keys().next().value);
    return { status: 'OK', provider: 'Brave Search', results };
  }
  async importResult(input) {
    if (!input || input.approved !== true || typeof input.resultId !== 'string' || Object.keys(input).some(k => !['resultId', 'approved'].includes(k))) throw new TypeError('Explicit approval and a resultId are required');
    const result = this.results.get(input.resultId); if (!result) throw new Error('Research result expired; run the approved search again');
    const text = await boundedTextFetch(result.url);
    return this.evidenceTools.import({ name: `${result.title.replace(/[\\/:*?"<>|]/g, '_').slice(0, 150) || 'research'}.txt`, mime: 'text/plain', text: `Source: ${result.url}\nTitle: ${result.title}\n\n${text}` });
  }
}
module.exports = { ResearchTools, assertPublicUrl, boundedTextFetch, isPrivate };
