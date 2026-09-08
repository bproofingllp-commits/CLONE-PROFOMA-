const http = require('http');
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');

const PORT = 3001;
const MAIN_PORT = 3000;
const DATA_FILE = path.join(__dirname, 'data', 'server-pid.txt');
const LOG_FILE = path.join(__dirname, 'data', 'server.log');

fs.mkdirSync(path.join(__dirname, 'data'), { recursive: true });

let child = null;

function getPid() {
  try {
    const pid = parseInt(fs.readFileSync(DATA_FILE, 'utf8').trim());
    try { process.kill(pid, 0); return pid; }
    catch { fs.unlinkSync(DATA_FILE); return null; }
  } catch { return null; }
}

function startServer() {
  if (child) { return 'already running'; }
  const existing = getPid();
  if (existing) { return 'already running (pid ' + existing + ')'; }
  const log = fs.openSync(LOG_FILE, 'a');
  child = spawn('node', ['server.js'], {
    cwd: __dirname,
    stdio: ['ignore', log, log],
    detached: false,
  });
  child.on('exit', () => { child = null; });
  setTimeout(() => {
    if (child) {
      fs.writeFileSync(DATA_FILE, String(child.pid));
    }
  }, 3000);
  return 'starting...';
}

function stopServer() {
  if (child) { child.kill(); child = null; }
  const pid = getPid();
  if (pid) { try { process.kill(pid); } catch {} fs.unlinkSync(DATA_FILE); }
  try { fs.unlinkSync(DATA_FILE); } catch {}
  return 'stopped';
}

function restartServer() {
  stopServer();
  setTimeout(() => startServer(), 1000);
  return 'restarting...';
}

function getStatus() {
  const running = child !== null || getPid() !== null;
  return {
    running,
    pid: child ? child.pid : getPid() || null,
    mainPort: MAIN_PORT,
    controlPort: PORT,
  };
}

const HTML = `<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0">
<title>Server Control</title>
<style>
*{margin:0;padding:0;box-sizing:border-box}
body{font-family:Arial,sans-serif;background:#1e3a5f;color:#fff;display:flex;justify-content:center;align-items:center;min-height:100vh;padding:20px}
.card{background:#fff;color:#333;border-radius:12px;padding:30px;width:100%;max-width:400px;text-align:center;box-shadow:0 8px 32px rgba(0,0,0,0.3)}
h1{font-size:22px;color:#1e3a5f;margin-bottom:6px}
.sub{font-size:13px;color:#888;margin-bottom:20px}
.btn{display:block;width:100%;padding:14px;margin:8px 0;border:none;border-radius:8px;font-size:16px;font-weight:700;cursor:pointer;transition:opacity 0.2s}
.btn:hover{opacity:0.85}
.green{background:#16a34a;color:#fff}
.red{background:#dc2626;color:#fff}
.blue{background:#2563eb;color:#fff}
.gray{background:#e2e8f0;color:#666;cursor:default}
#status{font-size:13px;margin-top:16px;padding:10px;border-radius:8px;background:#f1f5f9;color:#333}
.status-dot{display:inline-block;width:10px;height:10px;border-radius:50%;margin-right:6px}
.dot-green{background:#16a34a}
.dot-red{background:#dc2626}
.footer{margin-top:16px;font-size:11px;color:#aaa}
a{color:#2563eb;text-decoration:none}
</style></head>
<body>
<div class="card">
  <h1>&#9881; Server Control</h1>
  <div class="sub">Busy Accounting Pro</div>
  <div id="status"><span class="status-dot" id="dot">&#9679;</span> Checking...</div>
  <button class="btn green" id="btnStart" onclick="action('start')">&#9654; Start Server</button>
  <button class="btn blue" id="btnRestart" onclick="action('restart')">&#8635; Restart Server</button>
  <button class="btn red" id="btnStop" onclick="action('stop')">&#9632; Stop Server</button>
  <div class="footer"><a href="http://localhost:${MAIN_PORT}" target="_blank">Open App (port ${MAIN_PORT})</a></div>
</div>
<script>
async function fetchStatus(){
  const r=await fetch('/status');const s=await r.json();
  document.getElementById('dot').className='status-dot '+(s.running?'dot-green':'dot-red');
  document.getElementById('status').innerHTML='<span class="status-dot '+(s.running?'dot-green':'dot-red')+'"></span> '+(s.running?'Server is RUNNING (pid: '+s.pid+')':'Server is STOPPED');
  document.getElementById('btnStart').className='btn '+(s.running?'gray':'green');
  document.getElementById('btnStart').disabled=s.running;
  document.getElementById('btnStop').className='btn '+(s.running?'red':'gray');
  document.getElementById('btnStop').disabled=!s.running;
  document.getElementById('btnRestart').className='btn blue';
  document.getElementById('btnRestart').disabled=false;
}
async function action(a){
  document.getElementById('status').textContent='Executing '+a+'...';
  document.getElementById('btnStart').disabled=true;
  document.getElementById('btnStop').disabled=true;
  document.getElementById('btnRestart').disabled=true;
  const r=await fetch('/'+a,{method:'POST'});const d=await r.json();
  document.getElementById('status').textContent=d.message;
  setTimeout(fetchStatus,2000);
}
fetchStatus();
</script>
</body>
</html>`;

const server = http.createServer((req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') { res.writeHead(200); res.end(); return; }

  const url = new URL(req.url, 'http://localhost');
  const path = url.pathname;

  if (path === '/status') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(getStatus()));
  } else if (path === '/start' && req.method === 'POST') {
    const msg = startServer();
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ message: msg }));
  } else if (path === '/stop' && req.method === 'POST') {
    const msg = stopServer();
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ message: msg }));
  } else if (path === '/restart' && req.method === 'POST') {
    const msg = restartServer();
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ message: msg }));
  } else {
    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end(HTML);
  }
});

server.listen(PORT, '0.0.0.0', () => {
  console.log('Control server running on http://0.0.0.0:' + PORT);
  // Auto-start main server if not running
  setTimeout(() => {
    if (!getPid()) {
      console.log('Auto-starting main server...');
      startServer();
    }
  }, 1000);
});
