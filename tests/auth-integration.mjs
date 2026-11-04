// Disposable loopback QA accounts only. Never point this test at a deployed site.
import assert from 'node:assert/strict';
const base='http://localhost:5173';
const ownerPassword='Local-Owner-QA-Password-Only!';
const managerPassword='Local-Manager-QA-Password-Only!';
const nextPassword='Local-Manager-QA-Changed-Only!';
const resetPassword='Local-Manager-QA-Reset-Only!';
async function request(path,{method='GET',body,cookie='',origin=base}={}){const r=await fetch(base+path,{method,headers:{...(cookie?{Cookie:cookie}:{}),...(body?{'Content-Type':'application/json',Origin:origin}:{})},...(body?{body:JSON.stringify(body)}:{})});const text=await r.text();return {status:r.status,data:r.headers.get('content-type')?.includes('json')?JSON.parse(text):{error:text},cookie:r.headers.getSetCookie().filter(v=>v.startsWith('boardroom_session_dev=')).map(v=>v.split(';')[0]).join('; '),setCookie:r.headers.getSetCookie().join('; ')};}
const auth=(body,cookie='',origin=base)=>request('/api/auth',{method:'POST',body,cookie,origin});
const signin=await fetch(base+'/signin-with-chatgpt?return_to=%2F',{redirect:'manual'});assert.equal(signin.status,302);const legacy=signin.headers.getSetCookie().map(v=>v.split(';')[0]).join('; ');
let status=await request('/api/auth',{cookie:legacy});assert.equal(status.status,200);
assert.equal((await request('/api/club')).status,401);
assert.equal((await request('/api/club',{cookie:legacy})).status,401,'ChatGPT identity cannot bypass username authentication');
if(!status.data.ready){
  assert.equal((await auth({action:'setup',username:'qa-owner',password:ownerPassword})).status,403);
  const setup=await auth({action:'setup',username:'qa-owner',password:ownerPassword},legacy);assert.equal(setup.status,200,JSON.stringify(setup.data));assert.match(setup.setCookie,/HttpOnly/);
}
let logged=await auth({action:'login',username:'QA-OWNER',password:ownerPassword});assert.equal(logged.status,200,JSON.stringify(logged.data));let ownerCookie=logged.cookie;
let state=await request('/api/club',{cookie:ownerCookie});assert.equal(state.status,200);assert.equal(state.data.user.role,'owner');assert.ok(state.data.club.name.startsWith('Local QA'),'Existing non-QA local data must be preserved.');
const playersBefore=JSON.stringify(state.data.club.players),eventsBefore=JSON.stringify(state.data.club.tournaments);
let accounts=(await request('/api/auth',{cookie:ownerCookie})).data.accounts;
let managerAccount=accounts.find(a=>a.username==='qa-manager');
if(!managerAccount){const created=await auth({action:'createAccount',username:'qa-manager',password:managerPassword},ownerCookie);assert.equal(created.status,200,JSON.stringify(created.data));}
else assert.equal((await auth({action:'resetPassword',accountId:managerAccount.id,password:managerPassword},ownerCookie)).status,200);
logged=await auth({action:'login',username:'qa-manager',password:managerPassword});assert.equal(logged.status,200,JSON.stringify(logged.data));const managerCookie=logged.cookie;
let managerState=await request('/api/club',{cookie:managerCookie});assert.equal(managerState.status,200);assert.equal(managerState.data.user.role,'manager');assert.deepEqual(managerState.data.club.members,[]);
assert.equal((await auth({action:'createAccount',username:'bad-owner',password:ownerPassword,role:'owner'},managerCookie)).status,403);
assert.equal((await auth({action:'resetPassword',accountId:'bad',password:ownerPassword},managerCookie)).status,403);
const version=managerState.data.version;
const setting=await request('/api/club',{method:'POST',cookie:managerCookie,body:{version,action:{type:'settings',name:'Unauthorized',startingRating:1000,kFactor:32}}});assert.equal(setting.status,400);assert.match(setting.data.error,/Only the admin/);
assert.equal((await auth({action:'logout'},ownerCookie,'https://example.com')).status,403);
const second=await auth({action:'login',username:'qa-manager',password:managerPassword});assert.equal(second.status,200);const secondCookie=second.cookie;
const changed=await auth({action:'changePassword',oldPassword:managerPassword,password:nextPassword},managerCookie);assert.equal(changed.status,200,JSON.stringify(changed.data));assert.equal((await request('/api/club',{cookie:managerCookie})).status,401);assert.equal((await request('/api/club',{cookie:secondCookie})).status,401);assert.equal((await request('/api/club',{cookie:changed.cookie})).status,200);
assert.equal((await auth({action:'login',username:'qa-manager',password:managerPassword})).status,401);
assert.equal((await auth({action:'login',username:'qa-manager',password:nextPassword})).status,200);
accounts=(await request('/api/auth',{cookie:ownerCookie})).data.accounts;managerAccount=accounts.find(a=>a.username==='qa-manager');assert.ok(managerAccount);assert.ok(!JSON.stringify(accounts).includes('password_hash'));
const reset=await auth({action:'resetPassword',accountId:managerAccount.id,password:resetPassword},ownerCookie);assert.equal(reset.status,200);assert.equal((await request('/api/club',{cookie:changed.cookie})).status,401);
assert.equal((await auth({action:'login',username:'qa-manager',password:nextPassword})).status,401);const afterReset=await auth({action:'login',username:'qa-manager',password:resetPassword});assert.equal(afterReset.status,200);
assert.equal((await auth({action:'setAccountActive',accountId:managerAccount.id,active:false},afterReset.cookie)).status,403);
assert.equal((await auth({action:'setAccountActive',accountId:managerAccount.id,active:false},ownerCookie)).status,200);assert.equal((await request('/api/club',{cookie:afterReset.cookie})).status,401);assert.equal((await auth({action:'login',username:'qa-manager',password:resetPassword})).status,401);
assert.equal((await auth({action:'setAccountActive',accountId:managerAccount.id,active:true},ownerCookie)).status,200);assert.equal((await auth({action:'login',username:'qa-manager',password:resetPassword})).status,200);
const suffix=crypto.randomUUID().slice(0,6);const concurrent=await Promise.all([auth({action:'createAccount',username:`qa-race-a-${suffix}`,password:managerPassword},ownerCookie),auth({action:'createAccount',username:`qa-race-b-${suffix}`,password:managerPassword},ownerCookie)]);assert.ok(concurrent.every(r=>[200,409].includes(r.status)));
const finalState=(await request('/api/club',{cookie:ownerCookie})).data;const finalAccounts=(await request('/api/auth',{cookie:ownerCookie})).data.accounts;const racers=finalAccounts.filter(a=>a.username.includes(`-${suffix}`));assert.equal(racers.length,concurrent.filter(r=>r.status===200).length);assert.ok(racers.every(account=>finalState.club.members.some(m=>m.id===account.member_id)));
const racerLogin=await auth({action:'login',username:racers[0].username,password:managerPassword});assert.equal(racerLogin.status,200);
const removal=await request('/api/club',{method:'POST',cookie:ownerCookie,body:{version:finalState.version,action:{type:'removeManager',memberId:racers[0].member_id}}});assert.equal(removal.status,200);assert.equal((await request('/api/club',{cookie:racerLogin.cookie})).status,401);
const preserved=(await request('/api/club',{cookie:ownerCookie})).data.club;assert.equal(JSON.stringify(preserved.players),playersBefore);assert.equal(JSON.stringify(preserved.tournaments),eventsBefore);
const failedUsername='qa-bad-'+suffix;for(let i=0;i<8;i++)assert.equal((await auth({action:'login',username:failedUsername,password:managerPassword})).status,401);assert.equal((await auth({action:'login',username:failedUsername,password:managerPassword})).status,429);
const logout=await auth({action:'logout'},ownerCookie);assert.equal(logout.status,200);assert.match(logout.setCookie,/Max-Age=0/);assert.equal((await request('/api/club',{cookie:ownerCookie})).status,401);
console.log('PASS: protected reads/writes, owner bootstrap, username sign-in without ChatGPT, manager restrictions, salted credentials, password changes and resets revoke sessions, concurrent account creation is atomic, removed managers lose access, existing tournament data is preserved, login throttling, and logout.');
