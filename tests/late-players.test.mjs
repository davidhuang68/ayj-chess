import test from 'node:test';
import assert from 'node:assert/strict';
import {newClub,applyAction,calculateStats,weeklyStandings} from '../lib/chess.ts';
const manager={id:'qa',email:'qa@example.com',role:'manager'};
const save=(c,a)=>applyAction(c,{tournamentId:c.tournaments[0]?.id,...a},manager);
function fixture(count=4){
 let c=save(newClub(),{type:'createSession',name:'QA',date:'2026-10-16',timeControl:'10 min'});
 c=save(c,{type:'importNames',text:Array.from({length:count},(_,i)=>`Player ${i}`).join('\n')});
 return save(c,{type:'publishRound'});
}
function score(c){for(const g of c.tournaments[0].rounds.at(-1).games.filter(g=>g.black))c=save(c,{type:'result',round:c.tournaments[0].rounds.length,gameId:g.id,result:'white'});return c;}
const pairs=r=>r.games.map(g=>({id:g.id,white:g.white,black:g.black}));
test('late new and existing players wait in the published round without changing boards or previous ratings',()=>{
 let c=fixture();c.players.push({id:'returning',name:'Returning',initialRating:1500,createdAt:'2026-09-01'});
 const games=structuredClone(c.tournaments[0].rounds[0].games),before=calculateStats(c);
 c=save(c,{type:'importNames',mode:'new',text:'Late New',initialRatings:[{name:'Late New',rating:1700}]});
 c=save(c,{type:'importNames',mode:'existing',text:'Returning'});
 const late=c.players.find(p=>p.name==='Late New').id,round=c.tournaments[0].rounds[0];
 assert.deepEqual(round.games,games);assert.deepEqual(round.unpaired,[late,'returning']);assert.ok(round.eligiblePlayers.includes(late));
 for(const id of Object.keys(before))assert.deepEqual(calculateStats(c)[id],before[id]);
 assert.equal(calculateStats(c)[late].rating,1700);assert.equal(weeklyStandings(c,c.tournaments[0]).find(p=>p.id===late).points,0);
 assert.throws(()=>save(score(c),{type:'publishRound'}),/waiting players/);
 c=save(c,{type:'pairWaiting',round:1});assert.equal(c.tournaments[0].rounds[0].games.length,3);assert.deepEqual(c.tournaments[0].rounds[0].unpaired,[]);
 for(const g of games)assert.deepEqual(c.tournaments[0].rounds[0].games.find(next=>next.id===g.id),g);
 c=save(score(c),{type:'publishRound'});assert.equal(c.tournaments[0].rounds[1].games.length,3);
});
test('three arrivals get one pairing and one remains waiting with no automatic bye',()=>{
 let c=fixture();const games=structuredClone(c.tournaments[0].rounds[0].games);
 c=save(c,{type:'importNames',mode:'new',text:'Late A\nLate B\nLate C'});assert.equal(c.tournaments[0].rounds[0].unpaired.length,3);
 c=save(c,{type:'pairWaiting',round:1});const r=c.tournaments[0].rounds[0];
 assert.equal(r.games.length,3);assert.equal(r.unpaired.length,1);assert.ok(r.games.every(g=>g.black&&g.result===null));
 for(const g of games)assert.deepEqual(r.games.find(next=>next.id===g.id),g);
 assert.throws(()=>save(c,{type:'finishSession',confirmEarly:true}),/waiting players/);
});
test('arrivals are available in manual edits and attendance can remove and restore them',()=>{
 let c=fixture();c=save(c,{type:'importNames',mode:'new',text:'Late A\nLate B'});
 const [a,b]=c.players.slice(-2).map(p=>p.id),original=structuredClone(c.tournaments[0].rounds[0].games);
 c=save(c,{type:'attendance',playerId:a,present:false});assert.deepEqual(c.tournaments[0].rounds[0].unpaired,[b]);
 c=save(c,{type:'attendance',playerId:a,present:true});assert.deepEqual(new Set(c.tournaments[0].rounds[0].unpaired),new Set([a,b]));
 c=save(c,{type:'editPairings',round:1,pairings:[...pairs(c.tournaments[0].rounds[0]),{white:a,black:b}]});
 assert.deepEqual(c.tournaments[0].rounds[0].unpaired,[]);for(const g of original)assert.deepEqual(c.tournaments[0].rounds[0].games.find(next=>next.id===g.id),g);
});
test('imports retain assigned byes and recorded games; duplicate imports never requeue a seated player',()=>{
 let c=score(fixture(5));const r=structuredClone(c.tournaments[0].rounds[0]),before=calculateStats(c),seated=c.players[0];
 c=save(c,{type:'importNames',mode:'new',text:'Late'});const late=c.players.at(-1).id;
 c=save(c,{type:'importNames',mode:'existing',text:seated.name+'\nLate\nLate'});
 assert.deepEqual(c.tournaments[0].rounds[0].games,r.games);assert.deepEqual(c.tournaments[0].rounds[0].unpaired,[late]);
 for(const id of Object.keys(before))assert.deepEqual(calculateStats(c)[id],before[id]);
 assert.equal(calculateStats(c)[late].points,0);assert.equal(calculateStats(c)[late].games,0);
 c=save(c,{type:'attendance',playerId:late,present:false});c=save(c,{type:'importNames',mode:'existing',text:'Late'});assert.ok(!c.tournaments[0].withdrawn.includes(late));assert.deepEqual(c.tournaments[0].rounds[0].unpaired,[late]);
});
test('legacy eligibility is frozen for earlier rounds while the latest accepts arrivals',()=>{
 let c=save(score(fixture()),{type:'publishRound'});for(const r of c.tournaments[0].rounds)delete r.eligiblePlayers;
 const roster=[...c.tournaments[0].roster],games=structuredClone(c.tournaments[0].rounds.map(r=>r.games));
 c=save(c,{type:'importNames',text:'Late'});const t=c.tournaments[0],late=c.players.at(-1).id;
 assert.deepEqual(t.rounds[0].eligiblePlayers,roster);assert.deepEqual(t.rounds[1].eligiblePlayers,[...roster,late]);
 assert.deepEqual(t.rounds.map(r=>r.games),games);assert.deepEqual(t.rounds[1].unpaired,[late]);
});
test('the final published round accepts arrivals, completed sessions and viewers still cannot import',()=>{
 let c=save(score(fixture()),{type:'publishRound'});const past=structuredClone(c.tournaments[0].rounds[0]);
 c=save(c,{type:'importNames',mode:'new',text:'Final A\nFinal B'});assert.equal(c.tournaments[0].rounds[1].unpaired.length,2);assert.deepEqual(c.tournaments[0].rounds[0],past);
 c=save(c,{type:'pairWaiting',round:2});c=save(score(c),{type:'finishSession'});
 const before=structuredClone(c);assert.throws(()=>save(c,{type:'importNames',text:'Too Late'}),/completed/);assert.deepEqual(c,before);
 assert.throws(()=>applyAction(fixture(),{type:'importNames',text:'Late'},{...manager,role:'viewer'}),/Manager access/);
});
