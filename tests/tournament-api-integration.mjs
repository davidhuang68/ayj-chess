// Disposable local QA database only. Never takes a production URL.
import assert from 'node:assert/strict';
import {calculateStats} from '../lib/chess.ts';
import {tournamentStandings} from '../lib/tournament.ts';
const base='http://localhost:5173';
const request=async(path,{body,cookie=''}={})=>{const r=await fetch(base+path,{method:body?'POST':'GET',headers:{...(cookie?{Cookie:cookie}:{}),...(body?{'Content-Type':'application/json',Origin:base}:{})},...(body?{body:JSON.stringify(body)}:{})});return {status:r.status,data:await r.json(),cookie:r.headers.getSetCookie().filter(x=>x.startsWith('boardroom_session_dev=')).map(x=>x.split(';')[0]).join('; ')};};
const login=await request('/api/auth',{body:{action:'login',username:'qa-delete-manager',password:'Local-Delete-QA-Password-Only!'}});assert.equal(login.status,200);const cookie=login.cookie;
let state=(await request('/api/club',{cookie})).data;assert.ok(state.club.name.startsWith('Local QA'));assert.ok(!state.club.tournaments.some(t=>t.status!=='completed'));
const before=calculateStats(state.club),prefix='Swiss QA '+crypto.randomUUID().slice(0,6);
const save=async action=>{const r=await request('/api/club',{cookie,body:{version:state.version,action}});assert.equal(r.status,200,JSON.stringify(r.data));state=r.data;};
await save({type:'createSession',name:'Local QA Swiss Tournament',mode:'tournament',date:'2026-10-22',timeControl:'25 + 5',maxRounds:7});
const id=state.club.tournaments.at(-1).id,names=Array.from({length:30},(_,i)=>prefix+' '+String(i+1).padStart(2,'0'));
await save({type:'importNames',tournamentId:id,mode:'new',text:names.join('\n'),initialRatings:names.map((name,i)=>({name,rating:2200-i*40}))});
const ids=[...state.club.tournaments.at(-1).roster],seen=new Set();
for(let round=1;round<=7;round++){
 await save({type:'publishRound',tournamentId:id});const event=state.club.tournaments.at(-1),r=event.rounds.at(-1);
 assert.equal(event.mode,'tournament');assert.equal(event.maxRounds,7);assert.equal(Object.keys(event.seeds).length,30);
 assert.equal(r.games.length,15);assert.equal(new Set(r.games.flatMap(g=>[g.white,g.black])).size,30);
 for(const [i,g] of r.games.entries()){
   const key=[g.white,g.black].sort().join('|');assert.ok(!seen.has(key));seen.add(key);
   if(round===1)assert.equal(Math.abs(ids.indexOf(g.white)-ids.indexOf(g.black)),15);
   await save({type:'result',tournamentId:id,round,gameId:g.id,result:(i+round)%5===0?'draw':(i+round)%3===0?'black':'white'});
 }
}
await save({type:'finishSession',tournamentId:id});
const table=tournamentStandings(state.club,state.club.tournaments.at(-1));
state=(await request('/api/club',{cookie})).data;
assert.equal(state.club.tournaments.at(-1).status,'completed');assert.deepEqual(tournamentStandings(state.club,state.club.tournaments.at(-1)),table);
assert.equal(table.length,30);assert.equal(table.reduce((n,p)=>n+p.points,0),105);assert.ok(table.every(p=>Number.isFinite(p.buchholzCut1)&&Number.isFinite(p.sonnebornBerger)));
for(const pid of ids)await save({type:'deletePlayer',playerId:pid,confirm:true});assert.deepEqual(calculateStats(state.club),before);
console.log('PASS: manager creates a seven-round Swiss tournament, persists frozen seeds, publishes 105 repeat-free games, reloads final ranked tie-break standings, and preserves existing QA players.');
