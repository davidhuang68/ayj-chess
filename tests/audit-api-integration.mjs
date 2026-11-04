// This test can only reach the disposable local QA database.
import assert from 'node:assert/strict';
const base='http://localhost:5173';
const request=async(path,{body,cookie=''}={})=>{
 const r=await fetch(base+path,{method:body?'POST':'GET',headers:{...(cookie?{Cookie:cookie}:{}),...(body?{'Content-Type':'application/json',Origin:base}:{})},...(body?{body:JSON.stringify(body)}:{})});
 return {status:r.status,data:await r.json(),cookie:r.headers.getSetCookie().filter(x=>x.startsWith('boardroom_session_dev=')).map(x=>x.split(';')[0]).join('; ')};
};
const adminLogin=await request('/api/auth',{body:{action:'login',username:'qa-owner',password:'Local-Owner-QA-Password-Only!'}});assert.equal(adminLogin.status,200);
const managerLogin=await request('/api/auth',{body:{action:'login',username:'qa-delete-manager',password:'Local-Delete-QA-Password-Only!'}});assert.equal(managerLogin.status,200);
const admin=adminLogin.cookie,manager=managerLogin.cookie;
let state=(await request('/api/club',{cookie:manager})).data;
assert.ok(state.club.name.startsWith('Local QA'));assert.equal(state.user.role,'manager');assert.deepEqual(state.club.audit,[]);
assert.ok(!state.club.tournaments.some(t=>t.status!=='completed'));
const save=async(action)=>{const r=await request('/api/club',{cookie:manager,body:{version:state.version,action}});assert.equal(r.status,200,JSON.stringify(r.data));assert.deepEqual(r.data.club.audit,[]);state=r.data;};
await save({type:'createSession',name:'Local QA Audit',date:state.club.tournaments.at(-1)?.date??'2026-10-15',timeControl:'10 min'});
const id=state.club.tournaments.at(-1).id,name='Private Audit QA '+crypto.randomUUID().slice(0,6);
await save({type:'importNames',tournamentId:id,mode:'new',text:name});
const p=state.club.players.find(p=>p.name===name);
await save({type:'deletePlayer',playerId:p.id,confirm:true});
assert.ok(!JSON.stringify(state).includes(name));
const managerRead=await request('/api/club',{cookie:manager});assert.equal(managerRead.status,200);assert.deepEqual(managerRead.data.club.audit,[]);assert.ok(!JSON.stringify(managerRead.data).includes(name));
const adminRead=await request('/api/club',{cookie:admin});assert.equal(adminRead.status,200);assert.equal(adminRead.data.user.role,'owner');
const entry=adminRead.data.club.audit.find(a=>a.action==='deletePlayer'&&a.detail.includes(name));assert.ok(entry);assert.equal(entry.actor,'qa-delete-manager');assert.ok(Number.isFinite(Date.parse(entry.at)));
await save({type:'cancelSession',tournamentId:id,confirm:true});
assert.equal((await request('/api/club')).status,401);
console.log('PASS: admin sees deletion name, manager and timestamp; managers receive no audit entries on GET or POST; manager backup cannot reveal the deleted name; anonymous access is rejected.');
