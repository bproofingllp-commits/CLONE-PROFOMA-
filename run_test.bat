@echo off
cd /d E:\PRO\ORIGINAL
taskkill /F /IM node.exe 2>nul
set PORT=3099
start /B node server.js
ping 127.0.0.1 -n 10 > nul
echo === Testing API ===
node -e "const http=require('http');['/api/ping','/api/all-data','/api/accounts','/api/server-info','/api/parties','/api/items'].forEach(p=>http.get('http://localhost:3099'+p,r=>{let d='';r.on('data',c=>d+=c);r.on('end',()=>console.log(p+': '+(r.statusCode==200?'OK':'FAIL '+r.statusCode)));}).on('error',e=>console.log(p+': ERROR '+e.message)));"
echo === Login Test ===
node -e "const http=require('http');const d=JSON.stringify({username:'admin',password:'admin123'});const r=http.request('http://localhost:3099/api/auth/login',{method:'POST',headers:{'Content-Type':'application/json'}},res=>{let b='';res.on('data',c=>b+=c);res.on('end',()=>{const j=JSON.parse(b);console.log('Login: '+(j.token?'OK (token received)':'FAIL'));if(j.token)console.log('Create invoice test...');});});r.write(d);r.end();"
pause
