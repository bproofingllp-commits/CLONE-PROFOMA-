const initSqlJs = require('sql.js');
const fs = require('fs');
async function test() {
  const SQL = await initSqlJs();
  const db = new SQL.Database();
  db.run("CREATE TABLE test (id INTEGER PRIMARY KEY, name TEXT)");
  db.run("INSERT INTO test VALUES (1, 'hello')");
  const stmt = db.prepare("SELECT * FROM test");
  while (stmt.step()) {
    console.log(stmt.getAsObject());
  }
  console.log('sql.js works!');
}
test().catch(console.error);
