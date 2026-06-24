const http = require('http');
const data = JSON.stringify({ username: 'DBTestUser2', password: 'TestPass123' });
const req = http.request({
  hostname: 'localhost', port: 3000, path: '/api/auth/register', method: 'POST',
  headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) }
}, (res) => {
  let body = '';
  res.on('data', c => body += c);
  res.on('end', () => {
    const r = JSON.parse(body);
    console.log('Status:', res.statusCode, '| Success:', r.success, '| ID:', r.user?.id?.slice(0,12)+'...', '| Name:', r.user?.username);
  });
});
req.write(data);
req.end();
