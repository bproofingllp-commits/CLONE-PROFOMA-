const http = require('http');
http.get('http://localhost:3000/api/ping', r => {
  let d = '';
  r.on('data', c => d += c);
  r.on('end', () => {
    console.log('Response:', d);
    process.exit(0);
  });
}).on('error', e => {
  console.log('Error:', e.message);
  process.exit(1);
});
setTimeout(() => { console.log('Timeout'); process.exit(1); }, 5000);
