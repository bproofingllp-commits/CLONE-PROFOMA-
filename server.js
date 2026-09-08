const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const fs = require('fs');
const path = require('path');

const PORT = process.env.PORT || 3000;
const DATA_DIR = path.join(__dirname, 'data');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' }, maxHttpBufferSize: 5e7 });

app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.static(__dirname));

fs.mkdirSync(DATA_DIR, { recursive: true });

// --- SQLite (sql.js) ---
const initSqlJs = require('sql.js');
let db;

async function initDB() {
  const SQL = await initSqlJs();
  const dbPath = path.join(DATA_DIR, 'database.db');
  if (fs.existsSync(dbPath)) {
    const buf = fs.readFileSync(dbPath);
    db = new SQL.Database(buf);
  } else {
    db = new SQL.Database();
  }
  db.run('PRAGMA journal_mode=WAL');
  db.run('PRAGMA foreign_keys=ON');
  createTables();
  seedDefaults();
  saveDB();
  console.log('Database ready');
}

function saveDB() {
  const data = db.export();
  const buffer = Buffer.from(data);
  fs.writeFileSync(path.join(DATA_DIR, 'database.db'), buffer);
}

// Helper wrappers for sql.js (used instead of monkey-patch since db.prepare
// is resolved asynchronously)
function dbAll(sql, params) {
  const stmt = db.prepare(sql);
  if (params !== undefined) { const a = Array.isArray(params) ? params : [params]; stmt.bind(a); }
  const rows = [];
  while (stmt.step()) rows.push(stmt.getAsObject());
  stmt.free();
  return rows;
}
function dbGet(sql, params) {
  const stmt = db.prepare(sql);
  if (params !== undefined) { const a = Array.isArray(params) ? params : [params]; stmt.bind(a); }
  const hasRow = stmt.step();
  let row = null;
  if (hasRow) row = stmt.getAsObject();
  stmt.free();
  return row;
}

function createTables() {
  db.run(`CREATE TABLE IF NOT EXISTS company (
    id TEXT PRIMARY KEY, name TEXT, address TEXT, phone TEXT, email TEXT,
    gst TEXT, fy TEXT, logo TEXT, watermarkText TEXT, watermarkOpacity REAL DEFAULT 0.2,
    seriesPrefix TEXT, bankName TEXT, accountName TEXT, accountNo TEXT,
    ifscCode TEXT, branch TEXT, bankQr TEXT, reportPhone TEXT,
    driveFolderId TEXT, driveWebAppUrl TEXT, driveLink TEXT,
    driveClientId TEXT, driveEmail TEXT, nextInvoiceNo INTEGER DEFAULT 1,
    createdAt TEXT, updatedAt TEXT
  )`);
  db.run(`CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY, username TEXT UNIQUE, password TEXT, role TEXT,
    name TEXT, active INTEGER DEFAULT 1, createdAt TEXT, updatedAt TEXT
  )`);
  db.run(`CREATE TABLE IF NOT EXISTS parties (
    id TEXT PRIMARY KEY, type TEXT, name TEXT, contactPerson TEXT,
    phone TEXT, email TEXT, gstin TEXT, address TEXT,
    balance REAL DEFAULT 0, balanceType TEXT, createdAt TEXT, updatedAt TEXT
  )`);
  db.run(`CREATE TABLE IF NOT EXISTS items (
    id TEXT PRIMARY KEY, name TEXT, category TEXT, hsn TEXT,
    rate REAL DEFAULT 0, unit TEXT, tax REAL DEFAULT 0,
    thickness REAL DEFAULT 0.45, width REAL DEFAULT 1060,
    colour TEXT, make TEXT, rnftWeight REAL DEFAULT 0,
    stock REAL DEFAULT 0, createdAt TEXT, updatedAt TEXT
  )`);
  db.run(`CREATE TABLE IF NOT EXISTS invoices (
    id TEXT PRIMARY KEY, invoiceNo TEXT UNIQUE, docType TEXT, date TEXT,
    dueDate TEXT, status TEXT, partyId TEXT, partyName TEXT,
    partyPhone TEXT, partyEmail TEXT, partyAddress TEXT,
    shippingName TEXT, shippingPhone TEXT, shippingAddress TEXT,
    discountPercent REAL DEFAULT 0, discountAmount REAL DEFAULT 0,
    subtotal REAL DEFAULT 0, taxTotal REAL DEFAULT 0,
    chargesTotal REAL DEFAULT 0, grandTotal REAL DEFAULT 0,
    watermarkText TEXT, watermarkOpacity REAL DEFAULT 0.2,
    notes TEXT, salesman TEXT, invoiceDelivered INTEGER DEFAULT 0,
    driveFileId TEXT, createdAt TEXT, updatedAt TEXT
  )`);
  db.run(`CREATE TABLE IF NOT EXISTS line_items (
    id TEXT PRIMARY KEY, invoiceId TEXT, itemId TEXT, name TEXT,
    category TEXT, hsn TEXT, sizeFt REAL, sizeIn REAL, sizeXPics TEXT,
    rnft REAL, ban REAL, kg REAL DEFAULT 0, unit TEXT, qty REAL, runningFeet REAL,
    rate REAL, taxRate REAL, amount REAL, thickness REAL, width REAL,
    colour TEXT, make TEXT, rnftWeight REAL, delivered INTEGER DEFAULT 0,
    FOREIGN KEY(invoiceId) REFERENCES invoices(id) ON DELETE CASCADE
  )`);
  try { db.run('ALTER TABLE line_items ADD COLUMN kg REAL DEFAULT 0'); } catch (e) {}
  // Delivery-tracking + WhatsApp-sent fields added after the original schema;
  // ALTER TABLE so existing server databases gain the columns without losing data.
  try { db.run('ALTER TABLE invoices ADD COLUMN deliveredDate TEXT'); } catch (e) {}
  try { db.run('ALTER TABLE invoices ADD COLUMN deliveredTime TEXT'); } catch (e) {}
  try { db.run('ALTER TABLE invoices ADD COLUMN whatsappSent TEXT'); } catch (e) {}
  try { db.run('ALTER TABLE production_slips ADD COLUMN readyNotifiedAt TEXT'); } catch (e) {}
  try { db.run('ALTER TABLE invoices ADD COLUMN shareToken TEXT'); } catch (e) {}
  try { db.run('CREATE UNIQUE INDEX IF NOT EXISTS idx_invoices_sharetoken ON invoices(shareToken)'); } catch (e) {}
  // Company settings prefix columns
  try { db.run('ALTER TABLE company ADD COLUMN estimatePrefix TEXT'); } catch (e) {}
  try { db.run('ALTER TABLE company ADD COLUMN quotationPrefix TEXT'); } catch (e) {}
  try { db.run('ALTER TABLE company ADD COLUMN driveEmail TEXT'); } catch (e) {}
  db.run(`CREATE TABLE IF NOT EXISTS deleted_records (
    entity TEXT NOT NULL, id TEXT NOT NULL, createdAt TEXT,
    PRIMARY KEY (entity, id)
  )`);
  db.run(`CREATE TABLE IF NOT EXISTS additional_charges (
    id TEXT PRIMARY KEY, invoiceId TEXT, name TEXT, rate REAL DEFAULT 0,
    FOREIGN KEY(invoiceId) REFERENCES invoices(id) ON DELETE CASCADE
  )`);
  db.run(`CREATE TABLE IF NOT EXISTS production_slips (
    id TEXT PRIMARY KEY, invoiceId TEXT, invoiceNo TEXT, orderNo TEXT,
    plantOutput TEXT, date TEXT, deliveryDate TEXT, orderTime TEXT,
    partyName TEXT, partyAddress TEXT, remarks TEXT,
    createdBy TEXT, checkedBy TEXT, deliveredBy TEXT,
    driverSize TEXT, vehicleNo TEXT, status TEXT,
    categories TEXT, totals TEXT, rows TEXT, screenshots TEXT,
    createdAt TEXT, updatedAt TEXT
  )`);
  db.run(`CREATE TABLE IF NOT EXISTS transactions (
    id TEXT PRIMARY KEY, type TEXT, date TEXT, voucherNo TEXT,
    partyId TEXT, partyName TEXT, amount REAL, description TEXT,
    accountId TEXT, mode TEXT, createdAt TEXT, updatedAt TEXT
  )`);
  db.run(`CREATE TABLE IF NOT EXISTS accounts (
    id TEXT PRIMARY KEY, name TEXT, type TEXT,
    openingBalance REAL DEFAULT 0, createdAt TEXT, updatedAt TEXT
  )`);
  db.run(`CREATE TABLE IF NOT EXISTS money_receipts (
    id TEXT PRIMARY KEY, receiptNo TEXT UNIQUE, date TEXT,
    partyId TEXT, partyName TEXT, partyPhone TEXT, partyAddress TEXT,
    amount REAL, mode TEXT, reference TEXT, description TEXT,
    createdAt TEXT, updatedAt TEXT
  )`);
  db.run(`CREATE TABLE IF NOT EXISTS salesmen (
    id TEXT PRIMARY KEY, name TEXT UNIQUE, createdAt TEXT
  )`);
  db.run(`CREATE TABLE IF NOT EXISTS sync_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT, action TEXT, entity TEXT,
    entityId TEXT, userId TEXT, createdAt TEXT
  )`);
}

function seedDefaults() {
  const row = dbGet('SELECT id FROM company WHERE id = ?', 'main');
  if (!row) {
    const now = new Date().toISOString();
    db.run('INSERT INTO company (id,name,fy,watermarkText,seriesPrefix,nextInvoiceNo,createdAt,updatedAt) VALUES (?,?,?,?,?,?,?,?)',
      ['main','My Company','2026-27','PROFORMA INVOICE','BR',1,now,now]);
    // Default accounts
    const accounts = [
      ['acc_cash','Cash','Asset',0],
      ['acc_bank','Bank','Asset',0],
      ['acc_capital',"Owner's Capital",'Equity',0],
      ['acc_sales','Sales Account','Revenue',0],
      ['acc_purchase','Purchase Account','Expense',0]
    ];
    accounts.forEach(a => db.run('INSERT INTO accounts (id,name,type,openingBalance,createdAt,updatedAt) VALUES (?,?,?,?,?,?)',
      [a[0],a[1],a[2],a[3],now,now]));
    // Default admin user
    const bcrypt = require('bcryptjs');
    const hash = bcrypt.hashSync('admin123', 10);
    db.run('INSERT INTO users (id,username,password,role,name,active,createdAt,updatedAt) VALUES (?,?,?,?,?,?,?,?)',
      ['user_admin','admin',hash,'Admin','Administrator',1,now,now]);
    // Default service items
    const items = [
      ['i_default_loading','Loading','Accessory','',0,'Nos',0,0.45,1060,'GREY','',0,0],
      ['i_default_crimping','Crimping','Accessory','',0,'Nos',0,0.45,1060,'GREY','',0,0],
      ['i_default_transportation','Transportation','Accessory','',0,'Nos',0,0.45,1060,'GREY','',0,0]
    ];
    items.forEach(it => db.run('INSERT INTO items (id,name,category,hsn,rate,unit,tax,thickness,width,colour,make,rnftWeight,stock,createdAt,updatedAt) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
      [...it,now,now]));
    // Default makes & colours
    const makes = ['GALAXY','JINDAL','RHINO','TATA'];
    makes.forEach(m => db.run('INSERT INTO salesmen (id,name,createdAt) VALUES (?,?,?)', ['make_'+m, m, now]));
    // We'll store makes as special salesmen entries with id prefix
    const colours = ['ENVIRONMENTAL GREEN','SECO RED','PEPSI BLUE','OFF-WHITE','GREY'];
    colours.forEach(c => db.run('INSERT INTO salesmen (id,name,createdAt) VALUES (?,?,?)', ['clr_'+c, c, now]));
  }
}

// --- Helper ---
function getNow() { return new Date().toISOString(); }
function uuid() { return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => { const r = Math.random()*16|0; return (c==='x'?r:r&0x3|0x8).toString(16); }); }

function logSync(action, entity, entityId, userId) {
  try {
    db.run('INSERT INTO sync_log (action,entity,entityId,userId,createdAt) VALUES (?,?,?,?,?)',
      [action, entity, entityId||'', userId||'', getNow()]);
    saveDB();
  } catch(e) {}
}

function parsePS(slips) {
  for (const s of slips) {
    try { s.rows = JSON.parse(s.rows); } catch {}
    try { s.categories = JSON.parse(s.categories); } catch {}
    try { s.totals = JSON.parse(s.totals); } catch {}
    try { s.screenshots = JSON.parse(s.screenshots); } catch {}
  }
  return slips;
}

// Stringifies an already-parsed field (array/object) back for DB storage; passes strings through
function toJsonStr(v, def) {
  if (v === undefined || v === null) return def !== undefined ? def : '[]';
  if (typeof v === 'string') return v;
  try { return JSON.stringify(v); } catch { return def !== undefined ? def : '[]'; }
}

// --- Auth Middleware ---
function authMiddleware(req, res, next) {
  const auth = req.headers.authorization;
  if (!auth || !auth.startsWith('Bearer ')) return res.status(401).json({ error: 'Unauthorized' });
  const jwt = require('jsonwebtoken');
  try {
    const decoded = jwt.verify(auth.split(' ')[1], 'busy_secret_2026');
    req.user = decoded;
    next();
  } catch(e) { return res.status(401).json({ error: 'Invalid token' }); }
}

function adminOnly(req, res, next) {
  if (req.user.role !== 'Admin') return res.status(403).json({ error: 'Admin only' });
  next();
}

// Tombstones: remember deleted record ids so stale copies on other PCs
// can never be re-uploaded (prevents deleted records from resurrecting).
function tombstone(entity, id) {
  try {
    db.run('INSERT OR IGNORE INTO deleted_records (entity,id,createdAt) VALUES (?,?,?)', [entity, id, getNow()]);
  } catch (e) {}
}
function isTombstoned(entity, id) {
  try {
    return !!dbGet('SELECT 1 AS x FROM deleted_records WHERE entity=? AND id=?', [entity, id]);
  } catch (e) { return false; }
}

// --- REST API ---

app.get('/api/ping', (req, res) => res.json({ ok: true }));

// Auth
app.post('/api/auth/login', (req, res) => {
  const { username, password } = req.body;
  const user = dbGet('SELECT * FROM users WHERE username = ? AND active = 1', username);
  if (!user) return res.status(401).json({ error: 'Invalid credentials' });
  const bcrypt = require('bcryptjs');
  if (!bcrypt.compareSync(password, user.password)) return res.status(401).json({ error: 'Invalid credentials' });
  const jwt = require('jsonwebtoken');
  const token = jwt.sign({ id: user.id, username: user.username, role: user.role, name: user.name }, 'busy_secret_2026', { expiresIn: '1y' });
  res.json({ token, user: { id: user.id, username: user.username, role: user.role, name: user.name } });
});

app.get('/api/auth/me', authMiddleware, (req, res) => {
  res.json({ id: req.user.id, username: req.user.username, role: req.user.role, name: req.user.name });
});

app.post('/api/auth/change-password', authMiddleware, (req, res) => {
  const bcrypt = require('bcryptjs');
  const user = dbGet('SELECT * FROM users WHERE id = ?', req.user.id);
  if (!bcrypt.compareSync(req.body.oldPassword, user.password)) return res.status(400).json({ error: 'Wrong password' });
  const hash = bcrypt.hashSync(req.body.newPassword, 10);
  db.run('UPDATE users SET password = ?, updatedAt = ? WHERE id = ?', [hash, getNow(), req.user.id]);
  saveDB();
  res.json({ ok: true });
});

// Users (admin only)
app.get('/api/users', authMiddleware, adminOnly, (req, res) => {
  const users = dbAll('SELECT id, username, role, name, active, createdAt FROM users');
  res.json(users);
});
app.post('/api/users', authMiddleware, adminOnly, (req, res) => {
  const bcrypt = require('bcryptjs');
  const hash = bcrypt.hashSync(req.body.password, 10);
  const id = 'user_' + Date.now();
  const now = getNow();
  db.run('INSERT INTO users (id,username,password,role,name,active,createdAt,updatedAt) VALUES (?,?,?,?,?,?,?,?)',
    [id, req.body.username, hash, req.body.role||'Operator', req.body.name||'', 1, now, now]);
  saveDB();
  logSync('create','user',id,req.user.id);
  res.json({ id });
});
app.put('/api/users/:id', authMiddleware, adminOnly, (req, res) => {
  const now = getNow();
  if (req.body.password) {
    const bcrypt = require('bcryptjs');
    req.body.password = bcrypt.hashSync(req.body.password, 10);
  }
  const fields = Object.keys(req.body).filter(k => k !== 'id').map(k => `${k}=?`).join(',');
  const vals = Object.keys(req.body).filter(k => k !== 'id').map(k => req.body[k]);
  db.run(`UPDATE users SET ${fields}, updatedAt=? WHERE id=?`, [...vals, now, req.params.id]);
  saveDB();
  res.json({ ok: true });
});
app.delete('/api/users/:id', authMiddleware, adminOnly, (req, res) => {
  db.run('DELETE FROM users WHERE id=? AND id!=?', [req.params.id, req.user.id]);
  saveDB();
  res.json({ ok: true });
});

// Company
app.get('/api/company', (req, res) => {
  const c = dbGet('SELECT * FROM company WHERE id=?', 'main');
  res.json(c || {});
});
app.put('/api/company', authMiddleware, (req, res) => {
  const fields = Object.keys(req.body).filter(k => k !== 'id').map(k => `${k}=?`).join(',');
  const vals = Object.keys(req.body).filter(k => k !== 'id').map(k => req.body[k]);
  db.run(`UPDATE company SET ${fields}, updatedAt=? WHERE id=?`, [...vals, getNow(), 'main']);
  saveDB();
  logSync('update','company','main',req.user.id);
  io.emit('data-changed', { entity: 'company', id: 'main' });
  res.json({ ok: true });
});

// Parties
app.get('/api/parties', (req, res) => {
  const list = dbAll('SELECT * FROM parties ORDER BY name');
  res.json(list);
});
app.get('/api/parties/:id', (req, res) => {
  res.json(dbGet('SELECT * FROM parties WHERE id=?', req.params.id) || null);
});
app.post('/api/parties', authMiddleware, (req, res) => {
  const now = getNow();
  const id = req.body.id || ('p_' + Date.now());
  if (isTombstoned('parties', id)) { saveDB(); return res.json({ id }); }
  db.run('INSERT INTO parties (id,type,name,contactPerson,phone,email,gstin,address,balance,balanceType,createdAt,updatedAt) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)',
    [id, req.body.type||'customer', req.body.name, req.body.contactPerson||'', req.body.phone||'', req.body.email||'',
     req.body.gstin||'', req.body.address||'', req.body.balance||0, req.body.balanceType||'receivable', now, now]);
  saveDB();
  logSync('create','party',id,req.user.id);
  io.emit('data-changed', { entity: 'parties', id });
  res.json({ id });
});
app.put('/api/parties/:id', authMiddleware, (req, res) => {
  const fields = Object.keys(req.body).filter(k => k !== 'id').map(k => `${k}=?`).join(',');
  const vals = Object.keys(req.body).filter(k => k !== 'id').map(k => req.body[k]);
  db.run(`UPDATE parties SET ${fields}, updatedAt=? WHERE id=?`, [...vals, getNow(), req.params.id]);
  saveDB();
  logSync('update','party',req.params.id,req.user.id);
  io.emit('data-changed', { entity: 'parties', id: req.params.id });
  res.json({ ok: true });
});
app.delete('/api/parties/:id', authMiddleware, adminOnly, (req, res) => {
  db.run('DELETE FROM parties WHERE id=?', [req.params.id]);
  tombstone('parties', req.params.id);
  saveDB();
  logSync('delete','party',req.params.id,req.user.id);
  io.emit('data-changed', { entity: 'parties', id: req.params.id });
  res.json({ ok: true });
});

// Items
app.get('/api/items', (req, res) => {
  res.json(dbAll('SELECT * FROM items ORDER BY name'));
});
app.post('/api/items', authMiddleware, (req, res) => {
  const now = getNow();
  const id = req.body.id || ('i_' + Date.now());
  if (isTombstoned('items', id)) { saveDB(); return res.json({ id }); }
  db.run('INSERT INTO items (id,name,category,hsn,rate,unit,tax,thickness,width,colour,make,rnftWeight,stock,createdAt,updatedAt) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
    [id, req.body.name, req.body.category||'Roofing Sheet', req.body.hsn||'', req.body.rate||0,
     req.body.unit||'Nos', req.body.tax||0, req.body.thickness||0.45, req.body.width||1060,
     req.body.colour||'GREY', req.body.make||'', req.body.rnftWeight||0, req.body.stock||0, now, now]);
  saveDB();
  logSync('create','item',id,req.user.id);
  io.emit('data-changed', { entity: 'items', id });
  res.json({ id });
});
app.put('/api/items/:id', authMiddleware, (req, res) => {
  const fields = Object.keys(req.body).filter(k => k !== 'id').map(k => `${k}=?`).join(',');
  const vals = Object.keys(req.body).filter(k => k !== 'id').map(k => req.body[k]);
  db.run(`UPDATE items SET ${fields}, updatedAt=? WHERE id=?`, [...vals, getNow(), req.params.id]);
  saveDB();
  logSync('update','item',req.params.id,req.user.id);
  io.emit('data-changed', { entity: 'items', id: req.params.id });
  res.json({ ok: true });
});
app.delete('/api/items/:id', authMiddleware, adminOnly, (req, res) => {
  db.run('DELETE FROM items WHERE id=?', [req.params.id]);
  tombstone('items', req.params.id);
  saveDB();
  logSync('delete','item',req.params.id,req.user.id);
  io.emit('data-changed', { entity: 'items', id: req.params.id });
  res.json({ ok: true });
});

// Invoices (with line items + charges)
app.get('/api/invoices', (req, res) => {
  const invoices = dbAll('SELECT * FROM invoices ORDER BY createdAt DESC');
  const result = invoices.map(inv => {
    inv.items = dbAll('SELECT * FROM line_items WHERE invoiceId=?', inv.id);
    inv.additionalCharges = dbAll('SELECT * FROM additional_charges WHERE invoiceId=?', inv.id);
    return inv;
  });
  res.json(result);
});app.get('/api/invoices/:id', (req, res) => {
  const inv = dbGet('SELECT * FROM invoices WHERE id=?', req.params.id);
  if (!inv) return res.status(404).json({ error: 'Not found' });
  inv.items = dbAll('SELECT * FROM line_items WHERE invoiceId=?', inv.id);
  inv.additionalCharges = dbAll('SELECT * FROM additional_charges WHERE invoiceId=?', inv.id);
  res.json(inv);
});
app.post('/api/invoices', authMiddleware, (req, res) => {
  const now = getNow();
  const id = req.body.id || ('inv_' + Date.now());
  if (isTombstoned('invoices', id)) { saveDB(); return res.json({ id }); }
  const inv = req.body;
  const company = dbGet('SELECT * FROM company WHERE id=?', 'main');
  const docType = inv.docType || 'PROFORMA INVOICE';
  // Document-type-specific prefixes: Estimate=ES, Quotation=QS,
  // Proforma/Tax use the seriesPrefix from company settings.
  const prefixMap = { ESTIMATE: 'ES', QUOTATION: 'QS' };
  let invoiceNo = inv.invoiceNo;
  const prefix = prefixMap[docType] || (company?.seriesPrefix) || 'BR';
  if (!invoiceNo || !invoiceNo.trim()) {
    const nextNo = (company?.nextInvoiceNo) || 1;
    invoiceNo = prefix + '-' + String(nextNo).padStart(4, '0');
    db.run('UPDATE company SET nextInvoiceNo=? WHERE id=?', [nextNo + 1, 'main']);
  } else {
    const existing = dbGet('SELECT id FROM invoices WHERE invoiceNo=? AND id!=?', [invoiceNo, id]);
    if (existing) invoiceNo = invoiceNo + '-' + Date.now().toString().slice(-3);
  }
  // Keep the server counter ahead of any client-assigned number (prevents BR-0001 collisions)
  const mNum = String(invoiceNo || '').match(/(\d+)$/);
  const invNum = mNum ? parseInt(mNum[1], 10) || 0 : 0;
  if (invNum + 1 > ((company?.nextInvoiceNo) || 1)) {
    db.run('UPDATE company SET nextInvoiceNo=? WHERE id=?', [invNum + 1, 'main']);
  }
  db.run(`INSERT INTO invoices (id,invoiceNo,docType,date,dueDate,status,partyId,partyName,partyPhone,partyEmail,
    partyAddress,shippingName,shippingPhone,shippingAddress,discountPercent,discountAmount,subtotal,taxTotal,
    chargesTotal,grandTotal,watermarkText,watermarkOpacity,notes,salesman,invoiceDelivered,driveFileId,createdAt,updatedAt)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    [id, invoiceNo, inv.docType||'PROFORMA INVOICE', inv.date||'', inv.dueDate||'', inv.status||'draft',
     inv.partyId||'', inv.partyName||'', inv.partyPhone||'', inv.partyEmail||'', inv.partyAddress||'',
     inv.shippingName||'', inv.shippingPhone||'', inv.shippingAddress||'',
     inv.discountPercent||0, inv.discountAmount||0, inv.subtotal||0, inv.taxTotal||0,
     inv.chargesTotal||0, inv.grandTotal||0, inv.watermarkText||'', inv.watermarkOpacity||0.2,
     inv.notes||'', inv.salesman||'', inv.invoiceDelivered?1:0, inv.driveFileId||'', now, now]);
  // Line items
  if (inv.items) {
    inv.items.forEach(it => {
      const liId = it.id || uuid();
      db.run('INSERT INTO line_items (id,invoiceId,itemId,name,category,hsn,sizeFt,sizeIn,sizeXPics,rnft,ban,kg,unit,qty,runningFeet,rate,taxRate,amount,thickness,width,colour,make,rnftWeight,delivered) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
        [liId, id, it.itemId||'', it.name||'', it.category||'Roofing Sheet', it.hsn||'', it.sizeFt||0, it.sizeIn||0,
         it.sizeXPics||'', it.rnft||0, it.ban||0, it.kg||0, it.unit||'RNFT', it.qty||0, it.runningFeet||0,
         it.rate||0, it.taxRate||0, it.amount||0, it.thickness||0.45, it.width||1060,
         it.colour||'GREY', it.make||'', it.rnftWeight||0, it.delivered?1:0]);
    });
  }
  // Additional charges
  if (inv.additionalCharges) {
    inv.additionalCharges.forEach(ch => {
      const acId = ch.id || uuid();
      db.run('INSERT INTO additional_charges (id,invoiceId,name,rate) VALUES (?,?,?,?)', [acId, id, ch.name||'', ch.rate||0]);
    });
  }
  saveDB();
  logSync('create','invoice',id,req.user.id);
  io.emit('data-changed', { entity: 'invoices', id });
  res.json({ id, invoiceNo });
});
app.put('/api/invoices/:id', authMiddleware, (req, res) => {
  const now = getNow();
  const inv = req.body;
  // Full update: delete and re-insert children
  if (inv.items) {
    db.run('DELETE FROM line_items WHERE invoiceId=?', [req.params.id]);
    inv.items.forEach(it => {
      const liId = it.id || uuid();
      db.run('INSERT INTO line_items (id,invoiceId,itemId,name,category,hsn,sizeFt,sizeIn,sizeXPics,rnft,ban,kg,unit,qty,runningFeet,rate,taxRate,amount,thickness,width,colour,make,rnftWeight,delivered) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
        [liId, req.params.id, it.itemId||'', it.name||'', it.category||'Roofing Sheet', it.hsn||'', it.sizeFt||0, it.sizeIn||0,
         it.sizeXPics||'', it.rnft||0, it.ban||0, it.kg||0, it.unit||'RNFT', it.qty||0, it.runningFeet||0,
         it.rate||0, it.taxRate||0, it.amount||0, it.thickness||0.45, it.width||1060,
         it.colour||'GREY', it.make||'', it.rnftWeight||0, it.delivered?1:0]);
    });
  }
  if (inv.additionalCharges) {
    db.run('DELETE FROM additional_charges WHERE invoiceId=?', [req.params.id]);
    inv.additionalCharges.forEach(ch => {
      const acId = ch.id || uuid();
      db.run('INSERT INTO additional_charges (id,invoiceId,name,rate) VALUES (?,?,?,?)', [acId, req.params.id, ch.name||'', ch.rate||0]);
    });
  }
  // Partial update: only update fields that are sent AND exist as columns.
  // Unknown/extra fields (e.g. client versions with newer features) are
  // dropped instead of failing the whole UPDATE and breaking cross-PC sync.
  const KNOWN_INVOICE_FIELDS = new Set([
    'invoiceNo','docType','date','dueDate','status','partyId','partyName','partyPhone','partyEmail','partyAddress',
    'shippingName','shippingPhone','shippingAddress','discountPercent','discountAmount','subtotal','taxTotal',
    'chargesTotal','grandTotal','watermarkText','watermarkOpacity','notes','salesman','invoiceDelivered',
    'deliveredDate','deliveredTime','whatsappSent','driveFileId','updatedAt'
  ]);
  const updKeys = Object.keys(inv).filter(k => KNOWN_INVOICE_FIELDS.has(k));
  const invoiceFields = updKeys.map(k => `${k}=?`).join(',');
  const invoiceVals = updKeys.map(k => inv[k]);
  if (invoiceFields) {
    db.run(`UPDATE invoices SET ${invoiceFields}, updatedAt=? WHERE id=?`, [...invoiceVals, now, req.params.id]);
  }
  // Keep the server counter ahead of any client-assigned number
  if (inv.invoiceNo) {
    const mNum = String(inv.invoiceNo).match(/(\d+)$/);
    const invNum = mNum ? parseInt(mNum[1], 10) || 0 : 0;
    const company = dbGet('SELECT * FROM company WHERE id=?', 'main');
    if (invNum + 1 > ((company?.nextInvoiceNo) || 1)) {
      db.run('UPDATE company SET nextInvoiceNo=? WHERE id=?', [invNum + 1, 'main']);
    }
  }
  saveDB();
  logSync('update','invoice',req.params.id,req.user.id);
  io.emit('data-changed', { entity: 'invoices', id: req.params.id });
  res.json({ ok: true });
});
app.delete('/api/invoices/:id', authMiddleware, adminOnly, (req, res) => {
  db.run('DELETE FROM line_items WHERE invoiceId=?', [req.params.id]);
  db.run('DELETE FROM additional_charges WHERE invoiceId=?', [req.params.id]);
  db.run('DELETE FROM invoices WHERE id=?', [req.params.id]);
  tombstone('invoices', req.params.id);
  saveDB();
  logSync('delete','invoice',req.params.id,req.user.id);
  io.emit('data-changed', { entity: 'invoices', id: req.params.id });
  res.json({ ok: true });
});

// Public share routes (no auth required)
app.post('/api/invoices/:id/share', authMiddleware, (req, res) => {
  const id = req.params.id;
  const inv = dbGet('SELECT id, shareToken FROM invoices WHERE id=?', id);
  if (!inv) return res.status(404).json({ error: 'Not found' });
  let token = inv.shareToken;
  if (!token) {
    token = require('crypto').randomBytes(16).toString('hex');
    db.run('UPDATE invoices SET shareToken=? WHERE id=?', [token, id]);
    saveDB();
    logSync('share','invoice',id,req.user.id);
    io.emit('data-changed', { entity: 'invoices', id });
  }
  const baseUrl = `${req.protocol}://${req.get('host')}`;
  res.json({ shareUrl: `${baseUrl}/share/${token}`, token });
});

app.delete('/api/invoices/:id/share', authMiddleware, (req, res) => {
  const id = req.params.id;
  db.run('UPDATE invoices SET shareToken=NULL WHERE id=?', [id]);
  saveDB();
  logSync('unshare','invoice',id,req.user.id);
  io.emit('data-changed', { entity: 'invoices', id });
  res.json({ ok: true });
});

// Public view route (no auth) - accessible from anywhere
app.get('/share/:token', (req, res) => {
  const token = req.params.token;
  const inv = dbGet('SELECT * FROM invoices WHERE shareToken=?', token);
  if (!inv) return res.status(404).send('<h1>Link expired or invalid</h1>');
  const items = dbAll('SELECT * FROM line_items WHERE invoiceId=?', inv.id);
  const charges = dbAll('SELECT * FROM additional_charges WHERE invoiceId=?', inv.id);
  const company = dbGet('SELECT * FROM company WHERE id=?', 'main');
  
  // Render HTML view
  const itemsHtml = items.map(it => `
    <tr>
      <td>${it.name || ''}</td>
      <td>${it.category || ''}</td>
      <td>${it.qty || 0}</td>
      <td>${it.unit || ''}</td>
      <td>${Number(it.rate || 0).toFixed(2)}</td>
      <td>${Number(it.amount || 0).toFixed(2)}</td>
    </tr>
  `).join('');
  
  const chargesHtml = charges.map(ch => `
    <tr>
      <td>${ch.name || ''}</td>
      <td>${Number(ch.rate || 0).toFixed(2)}</td>
    </tr>
  `).join('');
  
  const html = `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${inv.docType || 'Invoice'} ${inv.invoiceNo}</title>
  <style>
    body { font-family: Arial, sans-serif; margin: 20px; background: #f5f5f5; }
    .container { max-width: 800px; margin: 0 auto; background: white; padding: 30px; border-radius: 8px; box-shadow: 0 2px 10px rgba(0,0,0,0.1); }
    .header { text-align: center; margin-bottom: 30px; border-bottom: 2px solid #333; padding-bottom: 20px; }
    .company-name { font-size: 28px; font-weight: bold; color: #1e3a5f; }
    .doc-title { font-size: 18px; color: #666; margin-top: 10px; }
    .info-grid { display: grid; grid-template-columns: repeat(2, 1fr); gap: 15px; margin-bottom: 20px; }
    .info-box { background: #f8f9fa; padding: 15px; border-radius: 6px; }
    .info-label { font-size: 12px; color: #666; text-transform: uppercase; }
    .info-value { font-size: 14px; font-weight: 600; }
    table { width: 100%; border-collapse: collapse; margin-top: 20px; }
    th, td { padding: 12px; text-align: left; border-bottom: 1px solid #eee; }
    th { background: #1e3a5f; color: white; font-weight: 600; }
    .totals { margin-top: 20px; text-align: right; }
    .total-row { display: flex; justify-content: space-between; padding: 8px 0; border-top: 1px solid #eee; }
    .total-label { font-weight: 600; }
    .total-value { font-weight: bold; color: #1e3a5f; }
    .grand-total { font-size: 18px; border-top: 2px solid #1e3a5f; color: #1e3a5f; }
    .notes { margin-top: 30px; padding: 15px; background: #f8f9fa; border-radius: 6px; }
    .footer { margin-top: 30px; text-align: center; color: #999; font-size: 12px; }
    @media print { body { background: none; } .container { box-shadow: none; padding: 0; } }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <div class="company-name">${company?.name || 'Company'}</div>
      <div class="doc-title">${inv.docType || 'Invoice'} #${inv.invoiceNo}</div>
    </div>
    <div class="info-grid">
      <div class="info-box"><div class="info-label">Date</div><div class="info-value">${inv.date || ''}</div></div>
      <div class="info-box"><div class="info-label">Due Date</div><div class="info-value">${inv.dueDate || '—'}</div></div>
      <div class="info-box"><div class="info-label">Party</div><div class="info-value">${inv.partyName || '—'}</div></div>
      <div class="info-box"><div class="info-label">Phone</div><div class="info-value">${inv.partyPhone || '—'}</div></div>
    </div>
    <table>
      <thead><tr><th>Item</th><th>Category</th><th>Qty</th><th>Unit</th><th>Rate</th><th>Amount</th></tr></thead>
      <tbody>${itemsHtml}</tbody>
    </table>
    ${charges.length ? `
    <h4>Additional Charges</h4>
    <table>
      <thead><tr><th>Charge</th><th>Amount</th></tr></thead>
      <tbody>${chargesHtml}</tbody>
    </table>` : ''}
    <div class="totals">
      <div class="total-row"><span class="total-label">Subtotal</span><span class="total-value">${Number(inv.subtotal || 0).toFixed(2)}</span></div>
      <div class="total-row"><span class="total-label">Discount</span><span class="total-value">-${Number(inv.discountAmount || 0).toFixed(2)}</span></div>
      <div class="total-row"><span class="total-label">Tax</span><span class="total-value">${Number(inv.taxTotal || 0).toFixed(2)}</span></div>
      <div class="total-row"><span class="total-label">Charges</span><span class="total-value">${Number(inv.chargesTotal || 0).toFixed(2)}</span></div>
      <div class="total-row grand-total"><span class="total-label">Grand Total</span><span class="total-value">${Number(inv.grandTotal || 0).toFixed(2)}</span></div>
    </div>
    ${inv.notes ? `<div class="notes"><strong>Notes:</strong> ${inv.notes}</div>` : ''}
    <div class="footer">
      Generated from Busy Accounting Pro | Shared link
    </div>
  </div>
</body>
</html>
  `;
  res.send(html);
});

// Production Slips
app.get('/api/production-slips', (req, res) => {
  res.json(parsePS(dbAll('SELECT * FROM production_slips ORDER BY createdAt DESC')));
});
app.post('/api/production-slips', authMiddleware, (req, res) => {
  const now = getNow();
  const id = req.body.id || ('ps_' + Date.now());
  if (isTombstoned('productionSlips', id)) { saveDB(); return res.json({ id }); }
  const s = req.body;
  db.run(`INSERT INTO production_slips (id,invoiceId,invoiceNo,orderNo,plantOutput,date,deliveryDate,orderTime,
    partyName,partyAddress,remarks,createdBy,checkedBy,deliveredBy,driverSize,vehicleNo,status,
    categories,totals,rows,screenshots,createdAt,updatedAt) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    [id, s.invoiceId||'', s.invoiceNo||'', s.orderNo||'', s.plantOutput||'PLANT A', s.date||'', s.deliveryDate||'',
     s.orderTime||'', s.partyName||'', s.partyAddress||'', s.remarks||'', s.createdBy||'', s.checkedBy||'',
     s.deliveredBy||'', s.driverSize||'', s.vehicleNo||'', s.status||'Pending',
     JSON.stringify(s.categories||{}), JSON.stringify(s.totals||{}),
     JSON.stringify(s.rows||[]), JSON.stringify(s.screenshots||[]), now, now]);
  saveDB();
  logSync('create','production_slip',id,req.user.id);
  io.emit('data-changed', { entity: 'production_slips', id });
  res.json({ id });
});
app.put('/api/production-slips/:id', authMiddleware, (req, res) => {
  const jsonFields = ['categories','totals','rows','screenshots'];
  // Merge against the current stored values so a PC with a stale copy
  // (or a queued replay) cannot wipe screenshots/rows added by another PC.
  const cur = dbGet('SELECT screenshots, rows FROM production_slips WHERE id=?', [req.params.id]);
  if (cur) {
    const removeIds = new Set((req.body.removeScreenshots || []).filter(Boolean));
    try {
      const oldSs = JSON.parse(cur.screenshots || '[]');
      if (Array.isArray(req.body.screenshots) && Array.isArray(oldSs)) {
        const map = new Map(oldSs.filter(s => s && s.id && !removeIds.has(s.id)).map(s => [s.id, s]));
        req.body.screenshots.forEach(s => { if (s && s.id && !removeIds.has(s.id)) map.set(s.id, s); });
        req.body.screenshots = Array.from(map.values());
      }
    } catch {}
    try {
      const oldRows = JSON.parse(cur.rows || '[]');
      if (Array.isArray(req.body.rows) && Array.isArray(oldRows)) {
        const merged = req.body.rows.map((r, i) => i < oldRows.length ? Object.assign({}, oldRows[i], r) : r);
        if (merged.length < oldRows.length) merged.push(...oldRows.slice(merged.length));
        req.body.rows = merged;
      }
    } catch {}
  }
  delete req.body.removeScreenshots;
  const KNOWN_PS_FIELDS = new Set([
    'invoiceId','invoiceNo','orderNo','plantOutput','date','deliveryDate','orderTime','partyName','partyAddress',
    'remarks','createdBy','checkedBy','deliveredBy','driverSize','vehicleNo','status','categories','totals','rows',
    'screenshots','readyNotifiedAt','updatedAt','createdAt'
  ]);
  const updKeys = Object.keys(req.body).filter(k => KNOWN_PS_FIELDS.has(k));
  const fields = updKeys.map(k => `${k}=?`).join(',');
  const vals = updKeys.map(k => {
    const v = req.body[k];
    if (jsonFields.includes(k) && v !== null && v !== undefined) return JSON.stringify(v);
    return v;
  });
  if (!fields) return res.status(400).json({ error: 'No fields to update' });
  db.run(`UPDATE production_slips SET ${fields}, updatedAt=? WHERE id=?`, [...vals, getNow(), req.params.id]);
  saveDB();
  logSync('update','production_slip',req.params.id,req.user.id);
  io.emit('data-changed', { entity: 'production_slips', id: req.params.id });
  res.json({ ok: true });
});
app.delete('/api/production-slips/:id', authMiddleware, adminOnly, (req, res) => {
  db.run('DELETE FROM production_slips WHERE id=?', [req.params.id]);
  tombstone('productionSlips', req.params.id);
  saveDB();
  logSync('delete','production_slip',req.params.id,req.user.id);
  io.emit('data-changed', { entity: 'production_slips', id: req.params.id });
  res.json({ ok: true });
});

// Transactions
app.get('/api/transactions', (req, res) => {
  let sql = 'SELECT * FROM transactions';
  const filters = [];
  if (req.query.fromDate) { sql += ' WHERE date>=?'; filters.push(req.query.fromDate); }
  if (req.query.toDate) { sql += (filters.length?' AND':' WHERE') + ' date<=?'; filters.push(req.query.toDate); }
  if (req.query.partyId) { sql += (filters.length?' AND':' WHERE') + ' partyId=?'; filters.push(req.query.partyId); }
  if (req.query.type) { sql += (filters.length?' AND':' WHERE') + ' type=?'; filters.push(req.query.type); }
  sql += ' ORDER BY date DESC';
  res.json(dbAll(sql, filters));
});
app.post('/api/transactions', authMiddleware, (req, res) => {
  const now = getNow();
  const id = req.body.id || ('txn_' + Date.now());
  if (isTombstoned('transactions', id)) { saveDB(); return res.json({ id }); }
  const t = req.body;
  db.run('INSERT INTO transactions (id,type,date,voucherNo,partyId,partyName,amount,description,accountId,mode,createdAt,updatedAt) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)',
    [id, t.type, t.date, t.voucherNo||'', t.partyId||'', t.partyName||'', t.amount||0, t.description||'',
     t.accountId||'', t.mode||'Cash', now, now]);
  saveDB();
  logSync('create','transaction',id,req.user.id);
  io.emit('data-changed', { entity: 'transactions', id });
  res.json({ id });
});
app.delete('/api/transactions/:id', authMiddleware, adminOnly, (req, res) => {
  db.run('DELETE FROM transactions WHERE id=?', [req.params.id]);
  tombstone('transactions', req.params.id);
  saveDB();
  logSync('delete','transaction',req.params.id,req.user.id);
  io.emit('data-changed', { entity: 'transactions', id: req.params.id });
  res.json({ ok: true });
});

// Accounts
app.get('/api/accounts', (req, res) => res.json(dbAll('SELECT * FROM accounts ORDER BY name')));
app.post('/api/accounts', authMiddleware, (req, res) => {
  const now = getNow();
  const id = req.body.id || ('acc_' + Date.now());
  db.run('INSERT INTO accounts (id,name,type,openingBalance,createdAt,updatedAt) VALUES (?,?,?,?,?,?)',
    [id, req.body.name, req.body.type||'Asset', req.body.openingBalance||0, now, now]);
  saveDB();
  io.emit('data-changed', { entity: 'accounts', id });
  res.json({ id });
});

// Tombstone list: lets clients purge records deleted on another PC
app.get('/api/deleted', (req, res) => {
  res.json(dbAll('SELECT entity, id FROM deleted_records'));
});

// Money Receipts
app.get('/api/money-receipts', (req, res) => res.json(dbAll('SELECT * FROM money_receipts ORDER BY createdAt DESC')));
app.post('/api/money-receipts', authMiddleware, (req, res) => {
  const now = getNow();
  const id = req.body.id || ('mr_' + Date.now());
  if (isTombstoned('moneyReceipts', id)) { saveDB(); return res.json({ id }); }
  const r = req.body;
  const count = dbGet("SELECT COUNT(*) as c FROM money_receipts").c;
  const receiptNo = r.receiptNo || ('MR-' + String(count+1).padStart(4,'0'));
  db.run('INSERT INTO money_receipts (id,receiptNo,date,partyId,partyName,partyPhone,partyAddress,amount,mode,reference,description,createdAt,updatedAt) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)',
    [id, receiptNo, r.date||'', r.partyId||'', r.partyName||'', r.partyPhone||'', r.partyAddress||'',
     r.amount||0, r.mode||'Cash', r.reference||'', r.description||'', now, now]);
  saveDB();
  logSync('create','money_receipt',id,req.user.id);
  io.emit('data-changed', { entity: 'money_receipts', id });
  res.json({ id, receiptNo });
});
app.delete('/api/money-receipts/:id', authMiddleware, adminOnly, (req, res) => {
  db.run('DELETE FROM money_receipts WHERE id=?', [req.params.id]);
  tombstone('moneyReceipts', req.params.id);
  saveDB();
  logSync('delete','money_receipt',req.params.id,req.user.id);
  io.emit('data-changed', { entity: 'money_receipts', id: req.params.id });
  res.json({ ok: true });
});

// Salesmen / Makes / Colours
app.get('/api/salesmen', (req, res) => {
  const list = dbAll("SELECT * FROM salesmen WHERE id NOT LIKE 'make_%' AND id NOT LIKE 'clr_%' ORDER BY name");
  res.json(list.map(s => s.name));
});
app.post('/api/salesmen', authMiddleware, (req, res) => {
  const now = getNow();
  const name = req.body.name;
  if (!name) return res.status(400).json({ error: 'Name required' });
  db.run('INSERT OR IGNORE INTO salesmen (id,name,createdAt) VALUES (?,?,?)', ['s_'+Date.now(), name, now]);
  saveDB();
  io.emit('data-changed', { entity: 'salesmen' });
  res.json({ ok: true });
});
app.delete('/api/salesmen', authMiddleware, (req, res) => {
  db.run("DELETE FROM salesmen WHERE name=? AND id NOT LIKE 'make_%' AND id NOT LIKE 'clr_%'", [req.body.name]);
  saveDB();
  io.emit('data-changed', { entity: 'salesmen' });
  res.json({ ok: true });
});

app.get('/api/makes', (req, res) => {
  const list = dbAll("SELECT name FROM salesmen WHERE id LIKE 'make_%' ORDER BY name");
  res.json(list.map(r => r.name));
});
app.post('/api/makes', authMiddleware, (req, res) => {
  const now = getNow();
  const name = req.body.name;
  if (!name) return res.status(400).json({ error: 'Name required' });
  db.run('INSERT OR IGNORE INTO salesmen (id,name,createdAt) VALUES (?,?,?)', ['make_'+name, name, now]);
  saveDB();
  io.emit('data-changed', { entity: 'makes' });
  res.json({ ok: true });
});
app.delete('/api/makes', authMiddleware, (req, res) => {
  db.run("DELETE FROM salesmen WHERE name=? AND id LIKE 'make_%'", [req.body.name]);
  saveDB();
  io.emit('data-changed', { entity: 'makes' });
  res.json({ ok: true });
});

app.get('/api/colours', (req, res) => {
  const list = dbAll("SELECT name FROM salesmen WHERE id LIKE 'clr_%' ORDER BY name");
  res.json(list.map(r => r.name));
});
app.post('/api/colours', authMiddleware, (req, res) => {
  const now = getNow();
  const name = req.body.name;
  if (!name) return res.status(400).json({ error: 'Name required' });
  db.run('INSERT OR IGNORE INTO salesmen (id,name,createdAt) VALUES (?,?,?)', ['clr_'+name, name, now]);
  saveDB();
  io.emit('data-changed', { entity: 'colours' });
  res.json({ ok: true });
});
app.delete('/api/colours', authMiddleware, (req, res) => {
  db.run("DELETE FROM salesmen WHERE name=? AND id LIKE 'clr_%'", [req.body.name]);
  saveDB();
  io.emit('data-changed', { entity: 'colours' });
  res.json({ ok: true });
});

// Attach line items + charges to an invoice row (used by pull, all-data and backups)
function attachInvoiceChildren(inv) {
  if (!inv) return inv;
  inv.items = dbAll('SELECT * FROM line_items WHERE invoiceId=?', inv.id);
  inv.additionalCharges = dbAll('SELECT * FROM additional_charges WHERE invoiceId=?', inv.id);
  return inv;
}

// Backup helper — saves a full-data JSON snapshot to data/backups/YYYY-MM-DD/backup_HH-MM-SS.json
function createBackup() {
  const invoices = dbAll('SELECT * FROM invoices ORDER BY createdAt DESC').map(attachInvoiceChildren);
  const snapshot = {
    company: dbGet('SELECT * FROM company WHERE id=?', 'main'),
    parties: dbAll('SELECT * FROM parties ORDER BY name'),
    items: dbAll('SELECT * FROM items ORDER BY name'),
    invoices,
    productionSlips: parsePS(dbAll('SELECT * FROM production_slips ORDER BY createdAt DESC')),
    transactions: dbAll('SELECT * FROM transactions ORDER BY date DESC'),
    accounts: dbAll('SELECT * FROM accounts ORDER BY name'),
    moneyReceipts: dbAll('SELECT * FROM money_receipts ORDER BY createdAt DESC'),
    salesmen: dbAll("SELECT name FROM salesmen WHERE id NOT LIKE 'make_%' AND id NOT LIKE 'clr_%' ORDER BY name").map(r => r.name),
    makes: dbAll("SELECT name FROM salesmen WHERE id LIKE 'make_%' ORDER BY name").map(r => r.name),
    colours: dbAll("SELECT name FROM salesmen WHERE id LIKE 'clr_%' ORDER BY name").map(r => r.name),
  };
  const now = new Date();
  const dateStr = now.toISOString().split('T')[0];
  const timeStr = now.toTimeString().split(' ')[0].replace(/:/g, '-');
  const backupDir = path.join(DATA_DIR, 'backups', dateStr);
  fs.mkdirSync(backupDir, { recursive: true });
  const backupPath = path.join(backupDir, `backup_${timeStr}.json`);
  fs.writeFileSync(backupPath, JSON.stringify(snapshot, null, 2));
  return backupPath;
}

// List available backups
app.get('/api/backups', (req, res) => {
  const backupsDir = path.join(DATA_DIR, 'backups');
  if (!fs.existsSync(backupsDir)) return res.json([]);
  const dates = fs.readdirSync(backupsDir).filter(d => /^\d{4}-\d{2}-\d{2}$/.test(d)).sort().reverse();
  const list = [];
  for (const date of dates) {
    const dayDir = path.join(backupsDir, date);
    const files = fs.readdirSync(dayDir).filter(f => f.endsWith('.json')).map(f => {
      const stat = fs.statSync(path.join(dayDir, f));
      return { file: f, date, size: stat.size, mtime: stat.mtime };
    });
    list.push({ date, backups: files });
  }
  res.json(list);
});

// Sync push endpoint — creates a backup and forces all clients to refresh
app.get('/api/sync/push', authMiddleware, async (req, res) => {
  const backupPath = createBackup();
  const result = { customers: 0, invoices: 0, productionSlips: 0, stock: 0, backup: backupPath };
  result.customers = dbGet("SELECT COUNT(*) as c FROM parties").c;
  result.invoices = dbGet("SELECT COUNT(*) as c FROM invoices").c;
  result.productionSlips = dbGet("SELECT COUNT(*) as c FROM production_slips").c;
  result.stock = dbGet("SELECT SUM(stock) as s FROM items").s || 0;
  logSync('push','all','',req.user.id);
  // Broadcast backup info to all connected clients
  const parts = backupPath.replace(/\\/g, '/').split('/');
  const fileName = parts.pop();
  const dateDir = parts.pop();
  io.emit('backup-created', { date: dateDir, file: fileName, path: backupPath, time: new Date().toISOString() });
  io.emit('force-refresh');
  res.json(result);
});

// Shared restore logic — clears all tables and rebuilds them from a backup JSON object
function restoreFromData(data) {
  // Clear all tables
  db.run('DELETE FROM line_items');
  db.run('DELETE FROM additional_charges');
  db.run('DELETE FROM transactions');
  db.run('DELETE FROM production_slips');
  db.run('DELETE FROM money_receipts');
  db.run('DELETE FROM invoices');
  db.run('DELETE FROM items');
  db.run('DELETE FROM parties');
  db.run('DELETE FROM sync_log');
  db.run('DELETE FROM salesmen');
  db.run('DELETE FROM users');
  db.run('DELETE FROM accounts');
  db.run('DELETE FROM company');
  // Restore company
  if (data.company) {
    const c = data.company;
    db.run('INSERT INTO company (id,name,address,phone,email,gst,fy,logo,watermarkText,watermarkOpacity,seriesPrefix,bankName,accountName,accountNo,ifscCode,branch,bankQr,reportPhone,driveFolderId,driveWebAppUrl,driveLink,driveClientId,driveEmail,nextInvoiceNo) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
      [c.id||'main', c.name, c.address, c.phone, c.email, c.gst, c.fy, c.logo, c.watermarkText, c.watermarkOpacity||0.2, c.seriesPrefix, c.bankName, c.accountName, c.accountNo, c.ifscCode, c.branch, c.bankQr, c.reportPhone, c.driveFolderId, c.driveWebAppUrl, c.driveLink, c.driveClientId, c.driveEmail, c.nextInvoiceNo||1]);
  }
  // Restore parties
  if (data.parties && Array.isArray(data.parties)) {
    for (const p of data.parties) {
      db.run('INSERT INTO parties (id,type,name,contactPerson,phone,email,gstin,address,balance,balanceType,createdAt) VALUES (?,?,?,?,?,?,?,?,?,?,?)',
        [p.id, p.type, p.name, p.contactPerson, p.phone, p.email, p.gstin, p.address, p.balance, p.balanceType, p.createdAt]);
    }
  }
  // Restore items
    if (data.items && Array.isArray(data.items)) {
      for (const it of data.items) {
        db.run('INSERT INTO items (id,name,category,hsn,rate,unit,tax,rnftWeight,thickness,width,colour,make,stock) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)',
          [it.id, it.name, it.category, it.hsn, it.rate, it.unit, it.tax, it.rnftWeight, it.thickness, it.width, it.colour, it.make, it.stock||0]);
      }
    }
    // Restore invoices (line items and charges go to separate tables)
    if (data.invoices && Array.isArray(data.invoices)) {
      for (const inv of data.invoices) {
        db.run('INSERT INTO invoices (id,invoiceNo,docType,date,dueDate,status,partyId,partyName,partyPhone,partyEmail,partyAddress,shippingName,shippingPhone,shippingAddress,discountPercent,discountAmount,subtotal,taxTotal,chargesTotal,grandTotal,watermarkText,watermarkOpacity,notes,salesman,invoiceDelivered,driveFileId,createdAt,updatedAt) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
          [inv.id, inv.invoiceNo, inv.docType||'PROFORMA INVOICE', inv.date, inv.dueDate||'', inv.status||'sent', inv.partyId||'', inv.partyName||'', inv.partyPhone||'', inv.partyEmail||'', inv.partyAddress||'', inv.shippingName||'', inv.shippingPhone||'', inv.shippingAddress||'', inv.discountPercent||0, inv.discountAmount||0, inv.subtotal||0, inv.taxTotal||0, inv.chargesTotal||0, inv.grandTotal||0, inv.watermarkText||'', inv.watermarkOpacity||0.2, inv.notes||'', inv.salesman||'', inv.invoiceDelivered?1:0, inv.driveFileId||'', inv.createdAt, inv.updatedAt||inv.createdAt]);
        // Restore line items
        if (inv.items && Array.isArray(inv.items)) {
          for (const it of inv.items) {
            const liId = it.id || ('li_' + Date.now() + '_' + Math.random().toString(36).substr(2,5));
            db.run('INSERT INTO line_items (id,invoiceId,itemId,name,category,hsn,sizeFt,sizeIn,sizeXPics,rnft,ban,unit,qty,runningFeet,rate,taxRate,amount,thickness,width,colour,make,rnftWeight,delivered) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
              [liId, inv.id, it.itemId||'', it.name||'', it.category||'Roofing Sheet', it.hsn||'', it.sizeFt||0, it.sizeIn||0, it.sizeXPics||'', it.rnft||0, it.ban||0, it.unit||'RNFT', it.qty||0, it.runningFeet||0, it.rate||0, it.taxRate||0, it.amount||0, it.thickness||0.45, it.width||1060, it.colour||'GREY', it.make||'', it.rnftWeight||0, it.delivered?1:0]);
          }
        }
        // Restore additional charges
        if (inv.additionalCharges && Array.isArray(inv.additionalCharges)) {
          for (const ch of inv.additionalCharges) {
            const chId = 'ch_' + Date.now() + '_' + Math.random().toString(36).substr(2,5);
            db.run('INSERT INTO additional_charges (id,invoiceId,name,rate) VALUES (?,?,?,?)',
              [chId, inv.id, ch.name||'', ch.rate||0]);
          }
        }
      }
    }
    // Restore transactions
    if (data.transactions && Array.isArray(data.transactions)) {
      for (const t of data.transactions) {
        db.run('INSERT INTO transactions (id,createdAt,type,date,voucherNo,partyId,partyName,amount,description,accountId,mode) VALUES (?,?,?,?,?,?,?,?,?,?,?)',
          [t.id, t.createdAt, t.type, t.date, t.voucherNo, t.partyId, t.partyName, t.amount, t.description, t.accountId, t.mode]);
      }
    }
    // Restore accounts
    if (data.accounts && Array.isArray(data.accounts)) {
      for (const a of data.accounts) {
        db.run('INSERT INTO accounts (id,name,type,openingBalance) VALUES (?,?,?,?)',
          [a.id, a.name, a.type, a.openingBalance]);
      }
    }
    // Restore money receipts
    if (data.moneyReceipts && Array.isArray(data.moneyReceipts)) {
      for (const r of data.moneyReceipts) {
        db.run('INSERT INTO money_receipts (id,receiptNo,date,partyId,partyName,amount,mode,description,createdAt) VALUES (?,?,?,?,?,?,?,?,?)',
          [r.id, r.receiptNo, r.date, r.partyId, r.partyName, r.amount, r.mode, r.description, r.createdAt]);
      }
    }
  // Restore production slips
  if (data.productionSlips && Array.isArray(data.productionSlips)) {
    for (const s of data.productionSlips) {
      db.run('INSERT INTO production_slips (id,invoiceId,invoiceNo,orderNo,plantOutput,date,deliveryDate,orderTime,partyName,partyAddress,remarks,createdBy,checkedBy,deliveredBy,driverSize,vehicleNo,status,categories,totals,rows,screenshots,createdAt,updatedAt) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
        [s.id, s.invoiceId||'', s.invoiceNo||'', s.orderNo||'', s.plantOutput||'', s.date||'', s.deliveryDate||'', s.orderTime||'', s.partyName||'', s.partyAddress||'', s.remarks||'', s.createdBy||'', s.checkedBy||'', s.deliveredBy||'', s.driverSize||'', s.vehicleNo||'', s.status||'Pending', toJsonStr(s.categories), toJsonStr(s.totals), toJsonStr(s.rows), toJsonStr(s.screenshots), s.createdAt, s.updatedAt||s.createdAt]);
    }
  }
  // Restore salesmen/makes/colours
  if (data.salesmen && Array.isArray(data.salesmen)) {
    for (const name of data.salesmen) {
      db.run("INSERT OR IGNORE INTO salesmen (id,name,createdAt) VALUES (?,?,datetime('now'))", ['s_'+name, name]);
    }
  }
  if (data.makes && Array.isArray(data.makes)) {
    for (const name of data.makes) {
      db.run("INSERT OR IGNORE INTO salesmen (id,name,createdAt) VALUES (?,?,datetime('now'))", ['make_'+name, name]);
    }
  }
  if (data.colours && Array.isArray(data.colours)) {
    for (const name of data.colours) {
      db.run("INSERT OR IGNORE INTO salesmen (id,name,createdAt) VALUES (?,?,datetime('now'))", ['clr_'+name, name]);
    }
  }
  // Re-seed the default admin user (backups do not store users)
  const bcrypt = require('bcryptjs');
  const hash = bcrypt.hashSync('admin123', 10);
  db.run("INSERT OR IGNORE INTO users (id,username,password,role,name,active,createdAt,updatedAt) VALUES ('user_admin','admin',?,'Admin','Administrator',1,datetime('now'),datetime('now'))", [hash]);
  saveDB();
}

// Restore from server-side backup file (data/backups/...)
app.post('/api/backups/restore', authMiddleware, (req, res) => {
  const { file, date } = req.body;
  if (!file) return res.status(400).json({ error: 'File name required' });
  const backupDir = date ? path.join(DATA_DIR, 'backups', date) : path.join(DATA_DIR, 'backups');
  const backupPath = path.join(backupDir, file);
  if (!fs.existsSync(backupPath)) return res.status(404).json({ error: 'Backup file not found: ' + backupPath });
  try {
    const raw = fs.readFileSync(backupPath, 'utf8');
    const data = JSON.parse(raw);
    if (!data || typeof data !== 'object') throw new Error('Backup file is not a valid JSON object');
    restoreFromData(data);
    logSync('restore','backup',file,req.user.id);
    io.emit('force-refresh');
    res.json({ ok: true, file, date, restored: { parties: data.parties?.length||0, items: data.items?.length||0, invoices: data.invoices?.length||0 } });
  } catch (err) {
    res.status(500).json({ error: 'Restore failed: ' + (err && err.message ? err.message : String(err)) });
  }
});

// Restore from a client-uploaded backup JSON (sent in the request body)
app.post('/api/backups/restore-upload', authMiddleware, (req, res) => {
  try {
    const data = req.body;
    if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error('Backup JSON body required');
    restoreFromData(data);
    logSync('restore','upload','client',req.user.id);
    io.emit('force-refresh');
    res.json({ ok: true, restored: { parties: data.parties?.length||0, items: data.items?.length||0, invoices: data.invoices?.length||0, productionSlips: data.productionSlips?.length||0 } });
  } catch (err) {
    res.status(500).json({ error: 'Restore failed: ' + (err && err.message ? err.message : String(err)) });
  }
});

// Maintenance: restore invoice line items + charges from the BusyBooks import file
// (used once to repair invoices whose items were wiped by old backup restores)
app.post('/api/maintenance/repair-items', authMiddleware, adminOnly, (req, res) => {
  try {
    const importDir = path.join(DATA_DIR, 'busybooks_import');
    const files = fs.existsSync(importDir) ? fs.readdirSync(importDir).filter(f => f.endsWith('.json')).sort() : [];
    let repaired = 0, skipped = 0, missingFile = true;
    for (const file of files) {
      const data = JSON.parse(fs.readFileSync(path.join(importDir, file), 'utf8'));
      if (!data.sales || !data.items) continue;
      missingFile = false;
      const fileItems = {};
      (data.items || []).forEach(it => { fileItems[it.id] = it; });
      const nameToDbId = {};
      dbAll('SELECT * FROM items').forEach(it => { if (!nameToDbId[it.name]) nameToDbId[it.name] = it.id; });
      const saleByNo = {};
      (data.sales || []).forEach(s => { if (!saleByNo[s.number]) saleByNo[s.number] = s; });
      for (const inv of dbAll('SELECT * FROM invoices')) {
        const s = saleByNo[inv.invoiceNo];
        if (!s || !Array.isArray(s.lines) || !s.lines.length) { skipped++; continue; }
        const existing = dbGet('SELECT COUNT(*) c FROM line_items WHERE invoiceId=?', inv.id);
        if (existing.c > 0) continue;
        db.run('DELETE FROM line_items WHERE invoiceId=?', [inv.id]);
        db.run('DELETE FROM additional_charges WHERE invoiceId=?', [inv.id]);
        for (const line of s.lines) {
          const fi = fileItems[line.itemId] || {};
          const dbId = nameToDbId[fi.name] || '';
          const liId = 'li_' + Date.now() + '_' + Math.random().toString(36).substr(2, 5);
          const amount = (line.qty || 0) * (line.rate || 0);
          db.run('INSERT INTO line_items (id,invoiceId,itemId,name,category,hsn,sizeFt,sizeIn,sizeXPics,rnft,ban,unit,qty,runningFeet,rate,taxRate,amount,thickness,width,colour,make,rnftWeight,delivered) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
            [liId, inv.id, dbId, line.description || fi.name || '', 'Roofing Sheet', fi.hsn || '', 0, 0, line.sizeXPics || '', line.rnft || 0, line.ban || 0, line.unit || 'RNFT', line.qty || 0, 0, line.rate || 0, line.taxRate || 0, amount, 0.45, 1060, 'GREY', '', fi.rnftWeight || 0, 0]);
        }
        const charges = [];
        if (s.loadingCharges) charges.push({ name: 'Loading', rate: s.loadingCharges });
        if (s.crimpingCharges) charges.push({ name: 'Crimping', rate: s.crimpingCharges });
        if (s.transportCharges) charges.push({ name: 'Transportation', rate: s.transportCharges });
        if (s.otherCharges) charges.push({ name: 'Other', rate: s.otherCharges });
        for (const ch of charges) {
          db.run('INSERT INTO additional_charges (id,invoiceId,name,rate) VALUES (?,?,?,?)',
            ['ch_' + Date.now() + '_' + Math.random().toString(36).substr(2, 5), inv.id, ch.name, ch.rate]);
        }
        repaired++;
      }
      break;
    }
    if (missingFile) return res.status(400).json({ error: 'No BusyBooks backup file found in data/busybooks_import/' });
    saveDB();
    logSync('maintenance', 'repair-items', '', req.user.id);
    res.json({ ok: true, repaired, skipped });
  } catch (err) {
    res.status(500).json({ error: 'Repair failed: ' + (err && err.message ? err.message : String(err)) });
  }
});

// Clear all data (factory reset)
app.post('/api/backups/clear-all', authMiddleware, (req, res) => {
  db.run('DELETE FROM line_items');
  db.run('DELETE FROM additional_charges');
  db.run('DELETE FROM transactions');
  db.run('DELETE FROM production_slips');
  db.run('DELETE FROM money_receipts');
  db.run('DELETE FROM invoices');
  db.run('DELETE FROM items');
  db.run('DELETE FROM parties');
  db.run('DELETE FROM sync_log');
  db.run('DELETE FROM salesmen');
  db.run('DELETE FROM users');
  db.run('DELETE FROM accounts');
  db.run('DELETE FROM company');
  // Re-seed defaults
  db.run("INSERT OR REPLACE INTO company (id,name,address,phone,email,gst,fy,logo,watermarkText,watermarkOpacity,seriesPrefix) VALUES ('main','My Company','','','','','2026-27','','PROFORMA INVOICE',0.2,'BR')");
  db.run("INSERT OR IGNORE INTO accounts (id,name,type,openingBalance) VALUES ('acc_cash','Cash','Asset',0)");
  db.run("INSERT OR IGNORE INTO accounts (id,name,type,openingBalance) VALUES ('acc_bank','Bank','Asset',0)");
  db.run("INSERT OR IGNORE INTO accounts (id,name,type,openingBalance) VALUES ('acc_capital',\"Owner's Capital\",'Equity',0)");
  db.run("INSERT OR IGNORE INTO accounts (id,name,type,openingBalance) VALUES ('acc_sales','Sales Account','Revenue',0)");
  db.run("INSERT OR IGNORE INTO accounts (id,name,type,openingBalance) VALUES ('acc_purchase','Purchase Account','Expense',0)");
  db.run("INSERT OR IGNORE INTO users (id,username,password,role,name) VALUES ('user_admin','admin','$2b$10$dummyhash','Admin','Administrator')");
  // Update user password hash properly
  const bcrypt = require('bcryptjs');
  const hash = bcrypt.hashSync('admin123', 10);
  db.run('UPDATE users SET password=? WHERE username=?', [hash, 'admin']);
  saveDB();
  logSync('clear-all','all','',req.user.id);
  io.emit('force-refresh');
  res.json({ ok: true, message: 'All data cleared' });
});

// Shared BusyBooks import logic — clears DB and inserts all data from a parsed backup object
function _importBusyBooksData(data, source, userId) {
  db.run('DELETE FROM line_items');
  db.run('DELETE FROM additional_charges');
  db.run('DELETE FROM transactions');
  db.run('DELETE FROM production_slips');
  db.run('DELETE FROM money_receipts');
  db.run('DELETE FROM invoices');
  db.run('DELETE FROM items');
  db.run('DELETE FROM parties');
  db.run('DELETE FROM sync_log');
  db.run('DELETE FROM salesmen');
  db.run('DELETE FROM accounts');
  db.run('DELETE FROM company');

  const now = new Date().toISOString();
  const ledgerMap = {};
  const parties = [];
  const extraAccounts = [];

  // ── 1. Cash Sale party ──
  const csId = 'p_cash_sale_' + Date.now();
  parties.push({ id: csId, type: 'customer', name: 'Cash Sale', contactPerson: '', phone: '', email: '', gstin: '', address: 'Cash Sale', balance: 0, balanceType: 'receivable', createdAt: now });

  // ── 2. Ledgers → Parties/Accounts ──
  for (const l of data.ledgers || []) {
    const signForGroup = (group, openingType, opening) => {
      if (!opening) return 0;
      const drGroups = ['Sundry Debtors', 'Current Assets', 'Fixed Assets', 'Bank Accounts'];
      const crGroups = ['Sundry Creditors', 'Duties & Taxes', 'Current Liabilities', 'Capital Account', 'Loans (Liability)', 'Secured Loans', 'Unsecured Loans', 'Provisions', 'Reserves & Surplus'];
      if (drGroups.includes(group)) return openingType === 'Cr' ? -opening : opening;
      if (crGroups.includes(group)) return openingType === 'Dr' ? -opening : opening;
      return opening;
    };
    if (l.group === 'Sundry Debtors') {
      const pId = 'p_' + Date.now() + '_' + Math.random().toString(36).substr(2, 6);
      ledgerMap[l.id] = { type: 'party', id: pId };
      parties.push({ id: pId, type: 'customer', name: l.name || '', contactPerson: '', phone: l.phone || '', email: '', gstin: l.gstin || '', address: l.address || '', balance: signForGroup(l.group, l.openingType, l.opening), balanceType: 'receivable', createdAt: now });
    } else if (l.group === 'Sundry Creditors') {
      const pId = 'p_' + Date.now() + '_' + Math.random().toString(36).substr(2, 6);
      ledgerMap[l.id] = { type: 'party', id: pId };
      parties.push({ id: pId, type: 'supplier', name: l.name || '', contactPerson: '', phone: l.phone || '', email: '', gstin: l.gstin || '', address: l.address || '', balance: signForGroup(l.group, l.openingType, l.opening), balanceType: 'payable', createdAt: now });
    } else {
      const nl = (l.name || '').toLowerCase().trim();
      if (nl === 'sales') ledgerMap[l.id] = { type: 'account', id: 'acc_sales' };
      else if (nl === 'purchase') ledgerMap[l.id] = { type: 'account', id: 'acc_purchase' };
      else if (nl === 'cash') ledgerMap[l.id] = { type: 'account', id: 'acc_cash' };
      else {
        const aId = 'acc_' + Date.now() + '_' + Math.random().toString(36).substr(2, 6);
        ledgerMap[l.id] = { type: 'account', id: aId };
        extraAccounts.push({ id: aId, name: l.name, type: l.group === 'Duties & Taxes' ? 'Liability' : l.group === 'Current Assets' || l.group === 'Fixed Assets' ? 'Asset' : 'Liability', openingBalance: signForGroup(l.group, l.openingType, l.opening) });
      }
    }
  }

  // ── 3. Insert parties ──
  for (const p of parties) {
    db.run('INSERT INTO parties (id,type,name,contactPerson,phone,email,gstin,address,balance,balanceType,createdAt) VALUES (?,?,?,?,?,?,?,?,?,?,?)',
      [p.id, p.type, p.name, p.contactPerson||'', p.phone||'', p.email||'', p.gstin||'', p.address||'', p.balance, p.balanceType, p.createdAt]);
  }

  // ── 4. Insert accounts ──
  const defaultAccounts = [
    { id: 'acc_cash', name: 'Cash', type: 'Asset' },
    { id: 'acc_bank', name: 'Bank', type: 'Asset' },
    { id: 'acc_capital', name: "Owner's Capital", type: 'Equity' },
    { id: 'acc_sales', name: 'Sales Account', type: 'Revenue' },
    { id: 'acc_purchase', name: 'Purchase Account', type: 'Expense' },
  ];
  for (const a of [...defaultAccounts, ...extraAccounts]) {
    db.run('INSERT OR IGNORE INTO accounts (id,name,type,openingBalance) VALUES (?,?,?,?)', [a.id, a.name, a.type, a.openingBalance||0]);
  }

  // ── 4b. Company ──
  if (data.company) {
    const bc = data.company;
    let fy = '';
    if (bc.fyStart) { const sy = new Date(bc.fyStart).getFullYear(); fy = sy + '-' + String(sy + 1).slice(-2); }
    db.run('INSERT OR REPLACE INTO company (id,name,address,phone,email,gst,fy,logo,watermarkText,watermarkOpacity,seriesPrefix,bankName,accountName,accountNo,ifscCode,branch,bankQr,reportPhone,nextInvoiceNo,driveFolderId,driveWebAppUrl,driveLink,createdAt,updatedAt) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
      ['main', bc.name||'My Company', bc.address||'', bc.whatsappNumber||'', bc.email||'', bc.gstin||'', fy||'2026-27', bc.logoDataUrl||'', bc.watermarkText||'PROFORMA INVOICE', 0.2, bc.seriesPrefix||'BR', (bc.bank&&bc.bank.name)||'', (bc.bank&&bc.bank.holder)||'', (bc.bank&&bc.bank.account)||'', (bc.bank&&bc.bank.ifsc)||'', (bc.bank&&bc.bank.branch)||'', (bc.bank&&bc.bank.qr)||'', bc.whatsappNumber||'', bc.nextInvoiceNo||1, (bc.drive&&bc.drive.folderId)||'', (bc.drive&&bc.drive.webAppUrl)||'', (bc.drive&&bc.drive.link)||'', now, now]);
  }

  // ── 5. Items ──
  const itemMap = {};
  const items = [];
  for (const it of data.items || []) {
    const newId = 'i_' + Date.now() + '_' + Math.random().toString(36).substr(2, 6);
    itemMap[it.id] = newId;
    const item = { id: newId, name: it.name||'', category: it.category||'Roofing Sheet', hsn: it.hsn||'', rate: it.saleRate||0, unit: it.unit||'Pcs', tax: it.taxRate||0, thickness: it.thickness||0.45, width: it.width||1060, colour: it.colour||'GREY', make: it.make||'', rnftWeight: it.rnftWeight||0, stock: 0 };
    items.push(item);
    db.run('INSERT INTO items (id,name,category,hsn,rate,unit,tax,thickness,width,colour,make,rnftWeight,stock) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)',
      [newId, item.name, item.category, item.hsn, item.rate, item.unit, item.tax, item.thickness, item.width, item.colour, item.make, item.rnftWeight, item.stock]);
  }
  // Default service items
  const svcItems = [
    { id: 'i_default_loading', name: 'Loading' },
    { id: 'i_default_crimping', name: 'Crimping' },
    { id: 'i_default_transportation', name: 'Transportation' },
  ];
  for (const s of svcItems) {
    const exists = items.find(it => it.id === s.id || it.name === s.name);
    if (!exists) {
      const svcItem = { id: s.id, name: s.name, category: 'Accessory', hsn: '', rate: 0, unit: 'Nos', tax: 0, thickness: 0, width: 0, colour: '', make: '', rnftWeight: 0, stock: 0 };
      items.push(svcItem);
      if (!dbGet('SELECT id FROM items WHERE id=? OR name=?', [s.id, s.name]))
        db.run('INSERT INTO items (id,name,category,hsn,rate,unit,tax,rnftWeight,stock) VALUES (?,?,\'Accessory\',\'\',0,\'Nos\',0,0,0)', [s.id, s.name]);
    }
  }

  // ── 6. Sales → Invoices ──
  const usedInvNos = {};
  for (const s of data.sales || []) {
    const pm = ledgerMap[s.partyId] || {};
    const partyId = (pm.type === 'party') ? pm.id : csId;
    const party = parties.find(p => p.id === partyId);
    const dtMap = { 'Proforma Invoice': 'PROFORMA INVOICE', 'Quotation': 'QUOTATION', 'Estimate': 'ESTIMATE', 'Tax Invoice': 'TAX INVOICE' };
    const docType = dtMap[s.invoiceTitle] || 'PROFORMA INVOICE';
    let invNo = s.number || '';
    if (usedInvNos[invNo]) { let i = 2; while (usedInvNos[invNo + '-' + i]) i++; invNo += '-' + i; }
    usedInvNos[invNo] = true;

    const lineItems = (s.lines || []).map(line => {
      const mi = items.find(it => it.id === itemMap[line.itemId]);
      return { itemId: itemMap[line.itemId] || '', name: line.description || (mi ? mi.name : ''), hsn: mi ? mi.hsn : '', sizeXPics: line.sizeXPics || '', rnft: line.rnft || 0, ban: line.ban || 0, unit: line.unit || 'RNFT', qty: line.qty || 0, rate: line.rate || 0, taxRate: line.taxRate || 0, amount: (line.qty || 0) * (line.rate || 0), rnftWeight: mi ? mi.rnftWeight : 0 };
    });

    const subtotal = lineItems.reduce((a, it) => a + it.amount, 0);
    const taxTotal = lineItems.reduce((a, it) => a + it.amount * it.taxRate / 100, 0);
    const charges = [];
    if (s.loadingCharges) charges.push({ name: 'Loading', rate: s.loadingCharges });
    if (s.crimpingCharges) charges.push({ name: 'Crimping', rate: s.crimpingCharges });
    if (s.transportCharges) charges.push({ name: 'Transportation', rate: s.transportCharges });
    if (s.otherCharges) charges.push({ name: 'Other', rate: s.otherCharges });
    const chargesTotal = charges.reduce((a, ch) => a + (ch.rate || 0), 0);
    const discountAmount = s.discount || 0;
    const baseForDiscount = subtotal + taxTotal;
    const discountPercent = (discountAmount > 0 && baseForDiscount > 0) ? Math.round((discountAmount / baseForDiscount) * 10000) / 100 : 0;
    const grandTotal = baseForDiscount + chargesTotal - discountAmount;

    const invId = 'inv_' + Date.now() + '_' + Math.random().toString(36).substr(2, 6);
    db.run('INSERT INTO invoices (id,invoiceNo,docType,date,dueDate,status,partyId,partyName,partyPhone,partyEmail,partyAddress,shippingName,shippingPhone,shippingAddress,discountPercent,discountAmount,subtotal,taxTotal,chargesTotal,grandTotal,watermarkText,notes,createdAt,updatedAt) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
      [invId, invNo, docType, s.date||'', '', 'sent', partyId, party ? party.name : '', party ? party.phone||'' : '', party ? party.email||'' : '', party ? party.address||'' : '', '', '', '', discountPercent, discountAmount, subtotal, taxTotal, chargesTotal, grandTotal, '', s.narration||'Thank you for your business!', now, now]);
    for (const it of lineItems) {
      const liId = 'li_' + Date.now() + '_' + Math.random().toString(36).substr(2, 5);
      db.run('INSERT INTO line_items (id,invoiceId,itemId,name,category,hsn,sizeFt,sizeIn,sizeXPics,rnft,ban,unit,qty,runningFeet,rate,taxRate,amount,thickness,width,colour,make,rnftWeight,delivered) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
        [liId, invId, it.itemId, it.name, 'Roofing Sheet', it.hsn, 0, 0, it.sizeXPics||'', it.rnft||0, it.ban||0, it.unit||'RNFT', it.qty||0, 0, it.rate||0, it.taxRate||0, it.amount||0, 0.45, 1060, 'GREY', '', it.rnftWeight||0, 0]);
    }
    for (const ch of charges) {
      db.run('INSERT INTO additional_charges (id,invoiceId,name,rate) VALUES (?,?,?,?)',
        ['ch_' + Date.now() + '_' + Math.random().toString(36).substr(2, 5), invId, ch.name, ch.rate]);
    }
  }

  // ── 7. Vouchers → Transactions ──
  for (const v of data.vouchers || []) {
    const txnType = v.type === 'Receipt' ? 'receipt' : v.type === 'Payment' ? 'payment' : null;
    if (!txnType) continue;
    const partyLine = (v.lines || []).find(l => { const m = ledgerMap[l.ledgerId]; return m && m.type === 'party'; });
    if (!partyLine) continue;
    const pm = ledgerMap[partyLine.ledgerId];
    const party = parties.find(p => p.id === pm.id);
    const amount = txnType === 'receipt' ? (partyLine.cr || 0) : (partyLine.dr || 0);
    if (!amount) continue;
    const accLine = (v.lines || []).find(l => { const m = ledgerMap[l.ledgerId]; return m && m.type === 'account'; });
    const accId = accLine ? (ledgerMap[accLine.ledgerId]?.id || '') : '';
    const mode = accId === 'acc_cash' ? 'Cash' : 'Bank Transfer';
    db.run('INSERT INTO transactions (id,type,date,voucherNo,partyId,partyName,amount,description,accountId,mode,createdAt) VALUES (?,?,?,?,?,?,?,?,?,?,?)',
      ['txn_' + Date.now() + '_' + Math.random().toString(36).substr(2, 6), txnType, v.date||'', v.number||'', pm.id, party ? party.name : '', amount, v.narration||txnType, accId, mode, now]);
    if (party) {
      if (txnType === 'receipt') party.balance = (party.balance || 0) - amount;
      else party.balance = (party.balance || 0) + amount;
      db.run('UPDATE parties SET balance=? WHERE id=?', [party.balance, party.id]);
    }
  }

  saveDB();
  logSync('import', source || 'busybooks', '', userId);
  io.emit('force-refresh');
}

// Import BusyBooks data from raw JSON body (used by file-picker upload)
app.post('/api/busybooks/import-data', authMiddleware, (req, res) => {
  try {
    const data = req.body;
    if (!data || !data.ledgers || !data.items) return res.status(400).json({ error: 'Invalid BusyBooks backup format' });
    _importBusyBooksData(data, 'upload', req.user.id);
    const counts = {
      parties: (data.ledgers||[]).filter(l => l.group === 'Sundry Debtors' || l.group === 'Sundry Creditors').length + 1,
      items: (data.items||[]).length,
      invoices: (data.sales||[]).length,
      transactions: (data.vouchers||[]).length,
    };
    res.json({ ok: true, imported: counts });
  } catch (err) {
    res.status(500).json({ error: 'Import failed: ' + err.message });
  }
});

// List BusyBooks backup files in data/busybooks_import/
app.get('/api/busybooks/files', (req, res) => {
  const importDir = path.join(DATA_DIR, 'busybooks_import');
  fs.mkdirSync(importDir, { recursive: true });
  const files = fs.readdirSync(importDir)
    .filter(f => f.endsWith('.json'))
    .map(f => {
      const stat = fs.statSync(path.join(importDir, f));
      return { file: f, size: stat.size, mtime: stat.mtime };
    })
    .sort((a, b) => b.mtime - a.mtime);
  res.json(files);
});

// Import a BusyBooks backup file from data/busybooks_import/
app.post('/api/busybooks/import', authMiddleware, (req, res) => {
  const { file } = req.body;
  if (!file) return res.status(400).json({ error: 'File name required' });
  const filePath = path.join(DATA_DIR, 'busybooks_import', file);
  if (!fs.existsSync(filePath)) return res.status(404).json({ error: 'File not found' });
  try {
    const raw = fs.readFileSync(filePath, 'utf8');
    const data = JSON.parse(raw);
    if (!data || !data.ledgers || !data.items) return res.status(400).json({ error: 'Invalid BusyBooks backup format' });
    _importBusyBooksData(data, 'busybooks_file=' + file, req.user.id);
    res.json({ ok: true, file, imported: { parties: (data.ledgers||[]).filter(l => l.group === 'Sundry Debtors' || l.group === 'Sundry Creditors').length + 1, items: (data.items||[]).length, invoices: (data.sales||[]).length, transactions: (data.vouchers||[]).length } });
  } catch (err) {
    res.status(500).json({ error: 'Import failed: ' + err.message });
  }
});

// Pull endpoint — returns all data with a server timestamp
app.get('/api/sync/pull', (req, res) => {
  const psSlips = parsePS(dbAll('SELECT * FROM production_slips ORDER BY createdAt DESC'));
  res.json({
    serverTime: new Date().toISOString(),
    deleted: dbAll('SELECT entity, id FROM deleted_records'),
    company: dbGet('SELECT * FROM company WHERE id=?', 'main'),
    parties: dbAll('SELECT * FROM parties ORDER BY name'),
    items: dbAll('SELECT * FROM items ORDER BY name'),
    invoices: dbAll('SELECT * FROM invoices ORDER BY createdAt DESC').map(attachInvoiceChildren),
    productionSlips: psSlips,
    transactions: dbAll('SELECT * FROM transactions ORDER BY date DESC'),
    accounts: dbAll('SELECT * FROM accounts ORDER BY name'),
    moneyReceipts: dbAll('SELECT * FROM money_receipts ORDER BY createdAt DESC'),
    salesmen: dbAll("SELECT name FROM salesmen WHERE id NOT LIKE 'make_%' AND id NOT LIKE 'clr_%' ORDER BY name").map(r => r.name),
    makes: dbAll("SELECT name FROM salesmen WHERE id LIKE 'make_%' ORDER BY name").map(r => r.name),
    colours: dbAll("SELECT name FROM salesmen WHERE id LIKE 'clr_%' ORDER BY name").map(r => r.name),
  });
});

// Server info
app.get('/api/server-info', (req, res) => {
  const dbSize = fs.existsSync(path.join(DATA_DIR, 'database.db'))
    ? fs.statSync(path.join(DATA_DIR, 'database.db')).size : 0;
  const today = new Date().toISOString().split('T')[0];
  const syncCount = dbGet("SELECT COUNT(*) as c FROM sync_log WHERE createdAt LIKE ?", today+'%').c;
  res.json({
    uptime: process.uptime(),
    connectedUsers: io.engine.clientsCount,
    dbSize,
    syncCount,
    serverTime: new Date().toISOString(),
    serverIP: getLocalIP(),
    port: PORT,
    version: '3.0.0'
  });
});

// All data (for initial sync client-side)
app.get('/api/all-data', (req, res) => {
  const psSlips = parsePS(dbAll('SELECT * FROM production_slips ORDER BY createdAt DESC'));
  const invoices = dbAll('SELECT * FROM invoices ORDER BY createdAt DESC');
  for (const inv of invoices) {
    inv.items = dbAll('SELECT * FROM line_items WHERE invoiceId=?', inv.id);
    inv.additionalCharges = dbAll('SELECT * FROM additional_charges WHERE invoiceId=?', inv.id);
  }
  res.json({
    deleted: dbAll('SELECT entity, id FROM deleted_records'),
    company: dbGet('SELECT * FROM company WHERE id=?', 'main'),
    parties: dbAll('SELECT * FROM parties ORDER BY name'),
    items: dbAll('SELECT * FROM items ORDER BY name'),
    invoices,
    productionSlips: psSlips,
    transactions: dbAll('SELECT * FROM transactions ORDER BY date DESC'),
    accounts: dbAll('SELECT * FROM accounts ORDER BY name'),
    moneyReceipts: dbAll('SELECT * FROM money_receipts ORDER BY createdAt DESC'),
    salesmen: dbAll("SELECT name FROM salesmen WHERE id NOT LIKE 'make_%' AND id NOT LIKE 'clr_%' ORDER BY name").map(r => r.name),
    makes: dbAll("SELECT name FROM salesmen WHERE id LIKE 'make_%' ORDER BY name").map(r => r.name),
    colours: dbAll("SELECT name FROM salesmen WHERE id LIKE 'clr_%' ORDER BY name").map(r => r.name),
  });
});

// --- Server Control ---
app.get('/api/server/status', (req, res) => {
  res.json({ running: true, port: PORT });
});
app.post('/api/server/stop', authMiddleware, (req, res) => {
  res.json({ message: 'Server stopping...' });
  setTimeout(() => { process.exit(0); }, 500);
});

// --- Socket.IO Events ---
io.on('connection', (socket) => {
  console.log('Client connected (' + io.engine.clientsCount + ' total)');
  socket.emit('server-info', {
    connectedUsers: io.engine.clientsCount,
    serverTime: new Date().toISOString()
  });
  socket.on('disconnect', () => {
    console.log('Client disconnected (' + io.engine.clientsCount + ' remaining)');
    io.emit('server-info', { connectedUsers: io.engine.clientsCount });
  });
});

// --- Start ---
initDB().then(() => {
  // Guard: if no users exist, seed the default admin so sign-in always works
  const userCount = dbGet('SELECT COUNT(*) AS c FROM users').c || 0;
  if (!userCount) {
    const bcrypt = require('bcryptjs');
    const hash = bcrypt.hashSync('admin123', 10);
    db.run("INSERT OR IGNORE INTO users (id,username,password,role,name,active,createdAt,updatedAt) VALUES ('user_admin','admin',?,'Admin','Administrator',1,datetime('now'),datetime('now'))", [hash]);
    saveDB();
    console.log('Seeded default admin user (admin / admin123)');
  }
  server.listen(PORT, '0.0.0.0', () => {
    console.log('Server running: http://localhost:' + PORT);
    console.log('Network:      http://' + getLocalIP() + ':' + PORT);
  });
  // Automatic backups: once on startup (if none exists today) and every 6 hours
  const autoBackupNow = () => {
    try {
      const hasData = (dbGet('SELECT COUNT(*) AS c FROM parties').c || 0) > 0;
      if (!hasData) return;
      createBackup();
      console.log('Auto backup created: ' + new Date().toISOString());
    } catch (e) { console.error('Auto backup failed:', e.message); }
  };
  try {
    const today = new Date().toISOString().split('T')[0];
    const dayDir = path.join(DATA_DIR, 'backups', today);
    if (!fs.existsSync(dayDir) || fs.readdirSync(dayDir).filter(f => f.endsWith('.json')).length === 0) autoBackupNow();
  } catch (e) {}
  setInterval(autoBackupNow, 6 * 60 * 60 * 1000);
}).catch(e => { console.error('Failed to init DB:', e); process.exit(1); });

function getLocalIP() {
  const os = require('os');
  const nets = os.networkInterfaces();
  for (const name of Object.keys(nets)) {
    for (const net of nets[name]) {
      if (net.family === 'IPv4' && !net.internal) return net.address;
    }
  }
  return 'localhost';
}
