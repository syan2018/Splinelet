import http from 'node:http';
const queue = [],
  pending = new Map();
let state = { connected: false },
  lastSeen = 0;
const origin = 'http://localhost:3000';
const server = http.createServer(async (req, res) => {
  if (!['127.0.0.1:4318', 'localhost:4318'].includes(req.headers.host)) {
    res.writeHead(403).end();
    return;
  }
  if (req.headers.origin && req.headers.origin !== origin) {
    res.writeHead(403).end();
    return;
  }
  res.setHeader('Access-Control-Allow-Origin', origin);
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Content-Type', 'application/json');
  if (req.method === 'OPTIONS') {
    res.writeHead(204).end();
    return;
  }
  const send = (status, data) => {
    res.writeHead(status);
    res.end(JSON.stringify(data));
  };
  let body = '';
  for await (const b of req) {
    body += b;
    if (body.length > 50e6) {
      send(413, { error: 'Request too large' });
      return;
    }
  }
  let data;
  try {
    data = body ? JSON.parse(body) : {};
  } catch {
    send(400, { error: 'Invalid JSON' });
    return;
  }
  if (req.url === '/state' && req.method === 'GET') {
    send(200, { ...state, connected: Date.now() - lastSeen < 4000 });
    return;
  }
  if (req.url === '/next' && req.method === 'POST') {
    state = data;
    lastSeen = Date.now();
    send(200, queue.splice(0));
    return;
  }
  if (req.url === '/result' && req.method === 'POST') {
    const task = pending.get(data.id);
    if (task) {
      clearTimeout(task.timer);
      pending.delete(data.id);
      task.respond(
        data.error ? 400 : 200,
        data.error ? { error: data.error } : data.result,
      );
    }
    send(200, { ok: true });
    return;
  }
  if (req.url === '/command' && req.method === 'POST') {
    if (Date.now() - lastSeen > 4000) {
      send(503, {
        error: 'Open http://localhost:3000/ first; companion is loopback only.',
      });
      return;
    }
    const allowed = [
      'state',
      'detect_candidates',
      'create_path',
      'refit_path',
      'set_node_mode',
      'manage_group',
      'move_path',
      'select_paths',
      'move_paths',
      'merge_paths',
      'straighten_span',
      'select_node',
      'delete_node',
      'commit_preview',
      'discard_preview',
      'get_project',
      'inspect_geometry',
      'undo',
      'set_view',
      'select_path',
      'set_point',
      'export',
      'load_project',
      'set_candidates_visible',
    ];
    if (!allowed.includes(data.action)) {
      send(400, { error: 'Unknown action' });
      return;
    }
    const id = crypto.randomUUID(),
      timer = setTimeout(() => {
        pending.delete(id);
        const i = queue.findIndex((q) => q.id === id);
        if (i >= 0) queue.splice(i, 1);
        send(504, {
          error: 'Command timed out; read state before retrying a mutation.',
        });
      }, 60000);
    pending.set(id, { timer, respond: send });
    queue.push({ id, action: data.action, args: data.args || {} });
    return;
  }
  send(404, { error: 'Not found' });
});
server.listen(4318, '127.0.0.1', () =>
  console.log('Bezier Agent companion: http://127.0.0.1:4318 (local only)'),
);
