// Disposable local QA database only. Production is never accepted as a target.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {calculateStats} from '../lib/chess.ts';
const base='http://localhost:5173',file=new URL('../.sites-runtime/public-qa.json',import.meta.url);
const request=async(path,{body,cookie=''}={})=>{const r=await fetch(base+path,{method:body?'POST':'GET',headers:{...(cookie?{Cookie:cookie}:{}),...(body?{'Content-Type':'application/json',Origin:base}:{})},...(body?{body:JSON.stringify(body)}:{})});return {status:r.status,data:await r.json(),cookie:r.headers.getSetCookie().filter(x=>x.startsWith('boardroom_session_dev=')).map(x=>x.split(';')[0]).join('; ')};};
const login=async(username,password)=>{const r=await request('/api/auth',{body:{action:'login',username,password}});assert.equal(r.status,200);return r.cookie;};
const owner=await login('qa-owner','Local-Owner-QA-Password-Only!'),manager=await login('qa-delete-manager','Local-Delete-QA-Password-Only!');
let state=(await request('/api/club',{cookie:owner})).data;assert.ok(state.club.name.startsWith('Local QA'));
const save=async(action,cookie=owner)=>{const r=await request('/api/club',{cookie,body:{version:state.version,action}});assert.equal(r.status,200,JSON.stringify(r.data));state=r.data;};
if(process.argv[2]==='update'){
 const qa=JSON.parse(fs.readFileSync(file,'utf8')),event=state.club.tournaments.find(t=>t.id===qa.eventId);assert.ok(event.name.startsWith('Local QA Public'));
 const round=event.rounds.at(-1),game=round.games.find(g=>g.black&&!g.result);assert.ok(game);
 await save({type:'result',tournamentId:event.id,round:round.number,gameId:game.id,result:'white'},manager);
 console.log('PASS: manager recorded a win in the local public test session.');process.exit(0);
}
if(process.argv[2]==='cleanup'){
 const qa=JSON.parse(fs.readFileSync(file,'utf8')),event=state.club.tournaments.find(t=>t.id===qa.eventId);assert.ok(event.name.startsWith('Local QA Public'));
 await save({type:'setPublicView',tournamentId:event.id,enabled:false});
 for(const round of event.rounds)for(const g of round.games)if(g.black&&!g.result)await save({type:'result',tournamentId:event.id,round:round.number,gameId:g.id,result:'draw'});
 if(event.status!=='completed')await save({type:'finishSession',tournamentId:event.id});
 for(const id of qa.players)if(state.club.players.some(p=>p.id===id))await save({type:'deletePlayer',playerId:id,confirm:true});assert.deepEqual(JSON.parse(JSON.stringify(calculateStats(state.club))),qa.before);
 assert.equal((await request('/api/public?event='+event.id)).status,404);console.log('PASS: disabled public view, finalized disposable QA session, and removed test profiles; prior QA ratings/history unchanged.');process.exit(0);
}
assert.ok(!state.club.tournaments.some(t=>t.status!=='completed'));
const before=calculateStats(state.club),prefix='Public QA '+crypto.randomUUID().slice(0,6);
await save({type:'createSession',name:'Local QA Public Tournament',mode:'tournament',date:'2026-10-24',timeControl:'25 + 5',maxRounds:1});const id=state.club.tournaments.at(-1).id;
await save({type:'importNames',tournamentId:id,mode:'new',text:['A','B','C','D'].map(n=>prefix+' '+n).join('\n')});const players=[...state.club.tournaments.at(-1).roster];
assert.equal((await request('/api/public?event='+id)).status,404);assert.ok(!(await request('/api/public')).data.events.some(e=>e.id===id));
assert.equal((await request('/api/club')).status,401);
assert.equal((await request('/api/club',{cookie:manager,body:{version:state.version,action:{type:'setPublicView',tournamentId:id,enabled:true}}})).status,400);
assert.equal((await request('/api/club',{body:{version:state.version,action:{type:'setPublicView',tournamentId:id,enabled:true}}})).status,401);
await save({type:'setPublicView',tournamentId:id,enabled:true});
let pub=await request('/api/public?event='+id);assert.equal(pub.status,200);assert.deepEqual(pub.data.event.rounds,[]);assert.deepEqual(pub.data.event.standings,[]);assert.ok(!JSON.stringify(pub.data).includes(prefix));
await save({type:'publishRound',tournamentId:id});const g=state.club.tournaments.at(-1).rounds[0].games[0];
await save({type:'result',tournamentId:id,round:1,gameId:g.id,result:'draw'},manager);
pub=await request('/api/public?event='+id);assert.equal(pub.status,200);assert.equal(pub.data.event.rounds[0].games.length,2);assert.equal(pub.data.event.standings.length,4);assert.equal(pub.data.event.rounds[0].games[0].result,'draw');
const json=JSON.stringify(pub.data);for(const field of ['members','audit','seeds','ratingBefore','initialRating','email','username','password','signupUrl','roster'])assert.ok(!json.includes(field),field);
for(const player of state.club.players)assert.ok(!json.includes(player.id));
assert.equal((await request('/api/public',{body:{action:'result'}})).status,405);
assert.equal((await request('/api/public?event=bad')).status,404);assert.equal((await request('/api/public?event='+id+'&event='+id)).status,404);
await save({type:'setPublicView',tournamentId:id,enabled:false});assert.equal((await request('/api/public?event='+id)).status,404);assert.ok(!(await request('/api/public')).data.events.some(e=>e.id===id));
await save({type:'setPublicView',tournamentId:id,enabled:true});
fs.writeFileSync(file,JSON.stringify({eventId:id,players,before,prefix}));
console.log('PASS: anonymous reads are whitelisted, drafts/rosters remain hidden, live results appear, admin-only visibility is enforced, writes are blocked, and disabling immediately returns 404. Disposable public fixture ready for browser QA.');
