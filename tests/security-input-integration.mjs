// Injection and authorization probes against the disposable local QA database only.
import assert from 'node:assert/strict';
import fs from 'node:fs';
const base='http://localhost:5173';
async function request(path,{body,cookie='',headers={}}={}){
  const r=await fetch(base+path,{method:body===undefined?'GET':'POST',headers:{...(cookie?{Cookie:cookie}:{}),...(body===undefined?{}:{Origin:base,'Content-Type':'application/json'}),...headers},...(body===undefined?{}:{body:typeof body==='string'?body:JSON.stringify(body)})});
  return {status:r.status,data:await r.json(),cookie:r.headers.getSetCookie().filter(v=>v.startsWith('boardroom_session_dev=')).map(v=>v.split(';')[0]).join('; ')};
}
const login=async(username,password)=>{const r=await request('/api/auth',{body:{action:'login',username,password}});assert.equal(r.status,200);return r.cookie;};
const owner=await login('qa-owner','Local-Owner-QA-Password-Only!');
let state=(await request('/api/club',{cookie:owner})).data;assert.ok(state.club.name.startsWith('Local QA'));
const before=JSON.stringify({players:state.club.players,tournaments:state.club.tournaments}),spoof={'oai-authenticated-user-email':'admin@example.com','x-boardroom-proxy-key':'fake',Cookie:'boardroom_session_dev='+'a'.repeat(64)};
assert.equal((await request('/api/club',{headers:spoof})).status,401);
assert.equal((await request('/api/auth',{headers:spoof})).data.user,null);
for(const username of ["qa-owner' OR '1'='1",{username:'qa-owner'},['qa-owner']])assert.equal((await request('/api/auth',{body:{action:'login',username,password:'not-a-real-password'}})).status,400);
assert.equal((await request('/api/club',{body:{version:state.version,actor:{role:'owner'},action:{type:'settings',name:'Must not save',startingRating:1000,kFactor:32}}})).status,401);
assert.equal((await request('/api/club',{body:'{}',headers:{Origin:''}})).status,403);
assert.equal((await request('/api/club',{body:'{}',headers:{'Content-Type':'application/jsonp'}})).status,415);
assert.equal((await request('/api/auth',{body:'{broken'})).status,400);
assert.equal((await request('/api/club',{body:JSON.stringify({name:'🦊'.repeat(17000)})})).status,413);
const manager=await login('qa-delete-manager','Local-Delete-QA-Password-Only!');
const info=(await request('/api/auth',{cookie:manager})).data;assert.equal(info.user.role,'manager');assert.deepEqual(info.accounts,[]);
for(const action of [{type:'settings',name:'Must not save',startingRating:1000,kFactor:32},{type:'setPublicView',tournamentId:state.club.tournaments.at(-1).id,enabled:false},{type:'editName',playerId:state.club.players[0].id,name:'Must not save'},{type:'addManager',email:'never@example.com'},{type:'removeManager',memberId:state.club.members[0].id}]){
  assert.equal((await request('/api/club',{cookie:manager,body:{version:state.version,action,role:'owner'}})).status,400);
}
assert.equal((await request('/api/auth',{cookie:manager,body:{action:'createAccount',username:'never-create-this',password:'test-only',role:'owner'}})).status,403);
state=(await request('/api/club',{cookie:owner})).data;assert.equal(JSON.stringify({players:state.club.players,tournaments:state.club.tournaments}),before);
const qa=JSON.parse(fs.readFileSync(new URL('../.sites-runtime/public-qa.json',import.meta.url),'utf8'));
assert.ok(state.club.tournaments.find(t=>t.id===qa.eventId)?.name.startsWith('Local QA Public'));
const name='Local QA <img src=x onerror=alert(1)> =1+1';
const changed=await request('/api/club',{cookie:owner,body:{version:state.version,action:{type:'editName',playerId:qa.players[0],name}}});assert.equal(changed.status,200);
const event=(await request('/api/public?event='+qa.eventId)).data.event;assert.ok(event.standings.some(row=>row.name===name));
console.log('PASS: forged identity/cookies, SQL-like usernames, role spoofing, admin-action bypasses, malformed media/JSON, missing Origin, and oversized Unicode bodies were rejected without changing existing club data. Disposable HTML-like player name ready for browser escaping verification.');
