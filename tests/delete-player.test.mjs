import test from 'node:test';
import assert from 'node:assert/strict';
import {newClub,applyAction,calculateStats,demoClub,weeklyStandings} from '../lib/chess.ts';
const manager={id:'manager',email:'manager@example.com',role:'manager'},admin={...manager,role:'owner'};
const save=(c,a,actor=manager)=>applyAction(c,a,actor);
const remove=(c,id,actor=manager)=>save(c,{type:'deletePlayer',playerId:id,confirm:true},actor);
function fixture(n=6){let c=save(newClub(),{type:'createSession',name:'QA',date:'2026-10-14',timeControl:'10 + 5'});c=save(c,{type:'importNames',tournamentId:c.tournaments[0].id,text:Array.from({length:n},(_,i)=>`Player ${i}`).join('\n')});return save(c,{type:'publishRound',tournamentId:c.tournaments[0].id});}
const score=(c,g,result='white')=>save(c,{type:'result',tournamentId:c.tournaments[0].id,round:1,gameId:g.id,result});
test('managers and admins can delete profiles; confirmation, valid ID and manager access are required',()=>{
 const c=fixture(),id=c.players[0].id,before=structuredClone(c);assert.throws(()=>save(c,{type:'deletePlayer',playerId:id}),/Confirm/);assert.throws(()=>remove(c,'unknown'),/not found/);assert.throws(()=>remove(c,id,{...manager,role:'viewer'}),/Manager access/);assert.deepEqual(c,before);assert.equal(remove(c,id).players.length,5);assert.equal(remove(c,id,admin).players.length,5);
});
test('deleting a pending player frees the present opponent without changing other boards or ratings',()=>{
 let c=fixture();const round=c.tournaments[0].rounds[0],g=round.games[0],other=structuredClone(round.games.slice(1)),before=calculateStats(c);c=remove(c,g.white);
 assert.ok(!c.players.some(p=>p.id===g.white));assert.equal(c.deletedPlayers?.length??0,0);assert.deepEqual(c.tournaments[0].rounds[0].games,other);assert.deepEqual(c.tournaments[0].rounds[0].unpaired,[g.black]);assert.ok(!c.tournaments[0].roster.includes(g.white));for(const p of c.players)assert.deepEqual(calculateStats(c)[p.id],before[p.id]);
 c=save(c,{type:'assignBye',tournamentId:c.tournaments[0].id,round:1,playerId:g.black});assert.deepEqual(c.tournaments[0].rounds[0].unpaired,[]);
});
test('deleting a player with years of results keeps every other rating/history unchanged and retains only anonymous historical data',()=>{
 let c=demoClub();const before=calculateStats(c),games=structuredClone(c.tournaments.map(t=>t.rounds.map(r=>r.games))),ids=c.players.slice(0,3).map(p=>p.id);
 for(const id of ids)c=remove(c,id);
 c=JSON.parse(JSON.stringify(c));for(const p of c.players)assert.deepEqual(calculateStats(c)[p.id],before[p.id]);assert.deepEqual(c.tournaments.map(t=>t.rounds.map(r=>r.games)),games);
 assert.ok(ids.every(id=>!c.players.some(p=>p.id===id)&&!(id in calculateStats(c))));assert.ok(c.deletedPlayers.every(p=>Object.keys(p).sort().join(',')==='id,initialRating'));
 assert.ok(c.tournaments.every(t=>ids.every(id=>!t.roster.includes(id)&&!t.withdrawn.includes(id)&&t.rounds.every(r=>!r.unpaired?.includes(id)))));for(const t of c.tournaments)assert.doesNotThrow(()=>weeklyStandings(c,t));
});
test('recorded games with a deleted participant are locked while remaining games still work',()=>{
 let c=fixture(),g=c.tournaments[0].rounds[0].games[0];c=score(c,g);const before=calculateStats(c),recorded=structuredClone(c.tournaments[0].rounds[0].games[0]);c=remove(c,g.white);assert.deepEqual(c.tournaments[0].rounds[0].games[0],recorded);assert.deepEqual(calculateStats(c)[g.black],before[g.black]);assert.throws(()=>score(c,g,'black'),/locked.*deleted/);assert.throws(()=>score(c,g,null),/locked.*deleted/);
 const next=c.tournaments[0].rounds[0].games[1];c=score(c,next,'draw');assert.equal(c.tournaments[0].rounds[0].games[1].result,'draw');assert.throws(()=>remove(c,g.white),/not found/);
});
test('deleting waiting/bye/withdrawn players leaves no stale pairings and does not alter ratings',()=>{
 let c=fixture(5),r=c.tournaments[0].rounds[0],bye=r.games.find(g=>!g.black),before=calculateStats(c);c=remove(c,bye.white);assert.ok(c.tournaments[0].rounds[0].games.every(g=>g.black));for(const p of c.players)assert.equal(calculateStats(c)[p.id].rating,before[p.id].rating);
 const game=c.tournaments[0].rounds[0].games[0];c=save(c,{type:'attendance',tournamentId:c.tournaments[0].id,playerId:game.white,present:false});c=remove(c,game.white);assert.ok(!c.tournaments[0].withdrawn.includes(game.white));c=remove(c,game.black);assert.deepEqual(c.tournaments[0].rounds[0].unpaired,[]);
});
test('a deleted name can be registered as a new player without reclaiming the anonymous history',()=>{
 let c=fixture(4);for(const g of c.tournaments[0].rounds[0].games)c=score(c,g);const p=c.players[0];c=remove(c,p.id);c=save(c,{type:'finishSession',tournamentId:c.tournaments[0].id,confirmEarly:true});c=save(c,{type:'createSession',name:'Next',date:'2026-10-21',timeControl:'10 + 5'});c=save(c,{type:'importNames',tournamentId:c.tournaments[1].id,mode:'new',text:p.name});const recreated=c.players.find(x=>x.name===p.name);assert.notEqual(recreated.id,p.id);assert.equal(calculateStats(c)[recreated.id].rating,1000);assert.equal(calculateStats(c)[recreated.id].games,0);assert.ok(c.deletedPlayers.some(x=>x.id===p.id));
});
