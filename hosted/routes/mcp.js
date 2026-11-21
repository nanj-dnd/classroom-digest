import { open, base, cors } from '../lib/oauth.js';
import { refresh } from '../lib/google.js';
import { TOOLS, toolList } from '../lib/tools.js';
import { json } from '../lib/http.js';

// A stateless MCP server over Streamable HTTP: each POST is one JSON-RPC
// message answered with plain JSON. No sessions, no SSE, no storage.

const SERVER = { name: 'classroom-digest', title: 'Classroom Digest', version: '1.0.0' };
const KNOWN = ['2024-11-05', '2025-03-26', '2025-06-18', '2025-11-25'];
const INSTRUCTIONS = 'Read-only access to the signed-in student\'s Google Classroom. For "what\'s due" questions call get_digest first. Course ids come from list_courses. Deadlines found in announcements are candidates; quote them. Attached file contents are not available, only titles and links.';

function unauthorized(req, res, description) {
  res.setHeader('WWW-Authenticate', `Bearer resource_metadata="${base(req)}/.well-known/oauth-protected-resource", error="invalid_token", error_description="${description}"`);
  json(res, 401, { error: 'invalid_token', error_description: description });
}

const reply = (id, result) => ({ jsonrpc: '2.0', id, result });
const rpcError = (id, code, message) => ({ jsonrpc: '2.0', id: id ?? null, error: { code, message } });

async function handle(msg, token) {
  const { id, method, params = {} } = msg || {};
  if (!msg || msg.jsonrpc !== '2.0' || typeof method !== 'string') return rpcError(id, -32600, 'Invalid request');
  if (id === undefined) return null; // notification: nothing to say
  switch (method) {
    case 'initialize': {
      const v = KNOWN.includes(params.protocolVersion) ? params.protocolVersion : KNOWN.at(-1);
      return reply(id, { protocolVersion: v, capabilities: { tools: { listChanged: false } }, serverInfo: SERVER, instructions: INSTRUCTIONS });
    }
    case 'ping': return reply(id, {});
    case 'tools/list': return reply(id, { tools: toolList() });
    case 'tools/call': {
      const tool = TOOLS.find((t) => t.name === params.name);
      if (!tool) return rpcError(id, -32602, `Unknown tool: ${params.name}`);
      try {
        const out = await tool.run(await token(), params.arguments || {});
        return reply(id, { content: [{ type: 'text', text: JSON.stringify(out) }], structuredContent: Array.isArray(out) ? { items: out } : out });
      } catch (e) {
        if (e.status === 401 || e.code === 'invalid_grant') throw Object.assign(new Error('Google access expired or was revoked.'), { auth: true });
        const text = e.status === 403 ? `Classroom refused access (${e.message}). The school may block third-party apps, or this course isn't visible to the student.`
          : e.status === 404 ? 'Not found. Check the course or assignment id with list_courses / list_assignments.'
          : `Classroom request failed: ${e.message}`;
        return reply(id, { content: [{ type: 'text', text }], isError: true });
      }
    }
    default: return rpcError(id, -32601, `Method not found: ${method}`);
  }
}

export default async function handler(req, res) {
  cors(res);
  if (req.method === 'OPTIONS') { res.statusCode = 204; return res.end(); }
  if (req.method !== 'POST') { res.setHeader('Allow', 'POST'); return json(res, 405, rpcError(null, -32000, 'Use POST. This server does not offer an SSE stream.')); }

  const at = open('at', String(req.headers.authorization || '').replace(/^Bearer\s+/i, ''));
  if (!at) return unauthorized(req, res, 'Missing, invalid or expired access token');

  // The token carries a Google access token; refresh it only if it lapsed.
  let gat = at.gexp > Date.now() ? at.gat : null;
  const token = async () => gat || (gat = (await refresh(at.rt)).access_token);

  let body = req.body;
  if (typeof body === 'string' || Buffer.isBuffer(body)) { try { body = JSON.parse(body.toString()); } catch { return json(res, 400, rpcError(null, -32700, 'Parse error')); } }
  try {
    const out = Array.isArray(body) ? (await Promise.all(body.map((m) => handle(m, token)))).filter(Boolean) : await handle(body, token);
    if (out === null || (Array.isArray(out) && !out.length)) { res.statusCode = 202; return res.end(); }
    json(res, 200, out);
  } catch (e) {
    if (e.auth) return unauthorized(req, res, e.message);
    console.error('mcp', e);
    json(res, 500, rpcError(body?.id, -32603, 'Internal error'));
  }
}
