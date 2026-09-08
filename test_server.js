const express = require('express');
const app = express();
app.get('/api/ping', (req, res) => res.json({ ok: true }));
const srv = app.listen(3001, () => {
  const http = require('http');
  http.get('http://localhost:3001/api/ping', (res) => {
    let data = '';
    res.on('data', c => data += c);
    res.on('end', () => {
      console.log('TEST RESULT:', data);
      srv.close();
    });
  });
});
