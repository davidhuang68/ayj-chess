// Runs against the loopback development server only; never use a deployed URL.
import assert from 'node:assert/strict';
const base='http://localhost:5173';
const signin=await fetch(`${base}/signin-with-chatgpt?return_to=%2F`,{redirect:'manual'});
assert.equal(signin.status,302);
const legacyCookie=signin.headers.getSetCookie().map(v=>v.split(';')[0]).join('; ');
const authState=await (await fetch(base+'/api/auth',{headers:{Cookie:legacyCookie}})).json();
if(!authState.ready){const r=await fetch(base+'/api/auth',{method:'POST',headers:{Cookie:legacyCookie,Origin:base,'Content-Type':'application/json'},body:JSON.stringify({action:'setup',username:'qa-owner',password:'Local-Owner-QA-Password-Only!'})});assert.equal(r.status,200);}
const signIn=await fetch(base+'/api/auth',{method:'POST',headers:{Origin:base,'Content-Type':'application/json'},body:JSON.stringify({action:'login',username:'qa-owner',password:'Local-Owner-QA-Password-Only!'})});assert.equal(signIn.status,200);
const cookie=signIn.headers.getSetCookie().filter(v=>v.startsWith('boardroom_session_dev=')).map(v=>v.split(';')[0]).join('; ');
const get=async(auth=true)=>{const r=await fetch(`${base}/api/club`,{headers:auth?{Cookie:cookie}:{}});assert.equal(r.status,200);return r.json();};
const post=async(version,action,auth=true,origin=base)=>{const r=await fetch(`${base}/api/club`,{method:'POST',headers:{'Content-Type':'application/json',Origin:origin,...(auth?{Cookie:cookie}:{})},body:JSON.stringify({version,action})});const text=await r.text();return {status:r.status,data:r.headers.get('content-type')?.includes('application/json')?JSON.parse(text):{error:text}};};
let state=await get();
if(state.setupRequired){const initialized=await post(0,{type:'initialize',name:'Local QA Club'});assert.equal(initialized.status,200,JSON.stringify(initialized.data));state=initialized.data;}
assert.equal(state.user.role,'owner');
const denied=await post(state.version,{type:'createSession',name:'Denied',date:'2026-10-10',timeControl:'10 + 5'},false);assert.equal(denied.status,401);
const crossOrigin=await post(state.version,{type:'settings',name:'Denied',startingRating:1000,kFactor:32},true,'https://example.com');assert.equal(crossOrigin.status,403);
assert.ok(state.club.name.startsWith('Local QA'),'Preserve non-QA local data.');
let result=await post(state.version,{type:'createSession',name:'Local QA · 30 players',date:'2026-10-10',timeControl:'10 + 5',maxRounds:2});assert.equal(result.status,200,JSON.stringify(result.data));state=result.data;
const id=state.club.tournaments.at(-1).id;
const roster=Array.from({length:30},(_,i)=>`Test Player ${String(i+1).padStart(2,'0')}`).join('\n');
const imports=await Promise.all([post(state.version,{type:'importNames',tournamentId:id,text:roster}),post(state.version,{type:'importNames',tournamentId:id,text:roster})]);
assert.deepEqual(imports.map(r=>r.status).sort(),[200,409]);state=await get();assert.equal(state.club.players.length,30);assert.equal(state.club.tournaments.at(-1).roster.length,30);
const publications=await Promise.all([post(state.version,{type:'publishRound',tournamentId:id}),post(state.version,{type:'publishRound',tournamentId:id})]);assert.deepEqual(publications.map(r=>r.status).sort(),[200,409]);state=await get();assert.equal(state.club.tournaments.at(-1).rounds.length,1);
const first=state.club.tournaments.at(-1).rounds[0];assert.equal(first.games.length,15);
for(const g of first.games){result=await post(state.version,{type:'result',tournamentId:id,round:1,gameId:g.id,result:'white'});assert.equal(result.status,200,JSON.stringify(result.data));state=result.data;}
result=await post(state.version,{type:'publishRound',tournamentId:id});assert.equal(result.status,200,JSON.stringify(result.data));state=result.data;
const second=state.club.tournaments.at(-1).rounds[1];assert.equal(second.games.length,15);for(const g of second.games){assert.ok(!first.games.some(old=>[old.white,old.black].includes(g.white)&&[old.white,old.black].includes(g.black)));result=await post(state.version,{type:'result',tournamentId:id,round:2,gameId:g.id,result:'draw'});assert.equal(result.status,200,JSON.stringify(result.data));state=result.data;}
result=await post(state.version,{type:'finishSession',tournamentId:id});assert.equal(result.status,200);state=result.data;
const refreshed=await get();assert.equal(refreshed.club.tournaments.at(-1).status,'completed');assert.equal(refreshed.version,state.version);assert.equal(refreshed.club.tournaments.at(-1).rounds.reduce((sum,r)=>sum+r.games.filter(g=>g.result).length,0),30);
const viewer=await fetch(base+'/api/club');assert.equal(viewer.status,401);const deniedData=await viewer.json();assert.equal(deniedData.club,null);assert.equal(deniedData.user,null);
console.log('PASS: anonymous writes blocked, cross-origin writes blocked, two concurrent imports and two concurrent round publications safely resolved, 30 players completed two distinct rounds, 30 results persisted, finalized state survived reload, unauthenticated visitors received no club records.');
