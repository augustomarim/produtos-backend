import { test, before, after, mock } from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import express from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { createHash } from 'node:crypto';
process.env.JWT_SECRET = 'test-only-key-for-refresh-route-validation';
const hash = t => createHash('sha256').update(t).digest('hex');
let records = [], sequence = 0, failCreate = false;
const usuario = { id: 1, nome: 'Teste', email: 'teste@example.test', senha: await bcrypt.hash('senha-teste', 10) };
const refreshToken = {
  async create({data}) { if (failCreate) throw new Error('Injected failure'); const row = {id: ++sequence, revokedAt:null, ...data}; records.push(row); return {...row}; },
  async findUnique({where}) { const row = records.find(r => r.tokenHash === where.tokenHash); return row ? {...row, usuario} : null; },
  async updateMany({where, data}) { let count = 0; for (const r of records) { if ((where.id === undefined || r.id === where.id) && (where.tokenHash === undefined || r.tokenHash === where.tokenHash) && r.revokedAt === null && (!where.expiresAt || r.expiresAt > where.expiresAt.gt)) { Object.assign(r,data); count++; } } return {count}; },
};
// Serialize the simulated transactions and restore their state on failure.
// PostgreSQL isolation/locking is deliberately not represented by this fixture.
let queue = Promise.resolve();
const db = {usuario:{async findUnique({where}) { return where.email === usuario.email ? usuario : null; }},refreshToken,
  $transaction(fn) { const run = queue.then(async () => {const saved = structuredClone(records); try{return await fn(db);}catch(e){records=saved;throw e;}}); queue = run.catch(()=>{}); return run; }
};
mock.module('../src/prisma.js',{exports:{default:db}});
let server, base;
before(async()=> { const {default:routes}=await import('../src/routes/authRoutes.js'); const app=express(); app.use(express.json()); app.use('/auth', routes); server=app.listen(0,'127.0.0.1'); await once(server,'listening'); base=`http://127.0.0.1:${server.address().port}`; });
after(()=>new Promise(resolve=>server.close(resolve)));
async function post(path,body) {const response=await fetch(base+'/auth/'+path,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});return {status:response.status,data:response.status===204?null:await response.json()};}
async function login(){const r=await post('login',{email:usuario.email,senha:'senha-teste'});assert.equal(r.status,200);return r.data;}
test('login: JWT de 15 min, refresh de 7 dias, apenas hash no banco',async()=>{const before=Date.now();const r=await login();const decoded=jwt.verify(r.token,process.env.JWT_SECRET);assert.equal(decoded.exp-decoded.iat,900);assert.match(r.refreshToken,/^[a-f0-9]{64}$/);const row=records.find(x=>x.tokenHash===hash(r.refreshToken));assert.ok(row);assert.notEqual(row.tokenHash,r.refreshToken);assert.ok(row.expiresAt.getTime()>=before+7*86400000);assert.equal(r.usuario.senha,undefined);});
test('senha incorreta não cria sessão',async()=>{const n=records.length;assert.equal((await post('login',{email:usuario.email,senha:'errada'})).status,401);assert.equal(records.length,n);});
test('refresh: rotação, JWT válido e rejeição de reutilização',async()=>{const a=await login();const b=await post('refresh',{refreshToken:a.refreshToken});assert.equal(b.status,200);assert.notEqual(b.data.refreshToken,a.refreshToken);jwt.verify(b.data.token,process.env.JWT_SECRET);assert.ok(records.find(x=>x.tokenHash===hash(a.refreshToken)).revokedAt);assert.equal((await post('refresh',{refreshToken:a.refreshToken})).status,401);assert.equal((await post('refresh',{refreshToken:b.data.refreshToken})).status,200);});
test('refresh: expirado, desconhecido e revogado retornam 401',async()=>{const a=await login();records.find(x=>x.tokenHash===hash(a.refreshToken)).expiresAt=new Date(Date.now()-1);assert.equal((await post('refresh',{refreshToken:a.refreshToken})).status,401);assert.equal((await post('refresh',{refreshToken:'0'.repeat(64)})).status,401);const b=await login();await post('logout',{refreshToken:b.refreshToken});assert.equal((await post('refresh',{refreshToken:b.refreshToken})).status,401);});
test('refresh e logout: campos ausentes e formato inválido retornam 400',async()=>{for(const path of ['refresh','logout'])for(const body of [{},{refreshToken:null},{refreshToken:'abc'},{refreshToken:'A'.repeat(64)}])assert.equal((await post(path,body)).status,400);});
test('logout: 204 sem corpo, idempotência e preservação de outra sessão',async()=>{const a=await login(),b=await login();assert.deepEqual(await post('logout',{refreshToken:a.refreshToken}),{status:204,data:null});assert.equal((await post('logout',{refreshToken:a.refreshToken})).status,204);assert.equal((await post('logout',{refreshToken:'0'.repeat(64)})).status,204);assert.equal((await post('refresh',{refreshToken:a.refreshToken})).status,401);assert.equal((await post('refresh',{refreshToken:b.refreshToken})).status,200);jwt.verify(a.token,process.env.JWT_SECRET);});
test('falha ao criar novo refresh: resposta 500 e rollback da revogação',async()=>{const a=await login();failCreate=true;try{assert.equal((await post('refresh',{refreshToken:a.refreshToken})).status,500);}finally{failCreate=false;}assert.equal(records.find(x=>x.tokenHash===hash(a.refreshToken)).revokedAt,null);assert.equal((await post('refresh',{refreshToken:a.refreshToken})).status,200);});
test('duas renovações na simulação serializada: apenas uma tem sucesso',async()=>{const a=await login();const results=await Promise.all([post('refresh',{refreshToken:a.refreshToken}),post('refresh',{refreshToken:a.refreshToken})]);assert.deepEqual(results.map(r=>r.status).sort(),[200,401]);});
