import test from 'node:test';
import assert from 'node:assert/strict';
import {newClub,applyAction,calculateStats,demoClub,eloDelta,pairRound} from '../lib/chess.ts';
const manager={id:'manager',email:'manager@example.com',username:'qa-manager',role:'manager'};
const admin={...manager,id:'admin',role:'owner'};
const save=(c,a,actor=manager)=>applyAction(c,{tournamentId:c.tournaments.at(-1)?.id,...a},actor);
function fixture(){
 let c=save(newClub(),{type:'createSession',name:'QA',date:'2026-10-16',timeControl:'10 min'});
 return save(c,{type:'importNames',mode:'new',text:'A\nB\nC\nD',initialRatings:[{name:'A',rating:1800},{name:'B',rating:1600},{name:'C',rating:1200},{name:'D',rating:1000}]});
}
const edit=(c,id,rating,actor=manager)=>save(c,{type:'editRating',playerId:id,rating},actor);

test('admins and managers can edit current Elo without replacing starting ratings; each edit is logged',()=>{
 for(const actor of [admin,manager]){
   const c=fixture(),p=c.players[0],next=edit(c,p.id,2000,actor),stats=calculateStats(next);
   assert.equal(stats[p.id].rating,2000);assert.equal(next.players[0].initialRating,1800);
   assert.equal(stats[p.id].games,0);assert.deepEqual(stats[p.id].history,[]);
   assert.equal(c.players[0].ratingAdjustment,undefined);
   assert.equal(next.audit[0].action,'editRating');assert.equal(next.audit[0].actor,actor.username);
   assert.ok(next.audit[0].detail.includes('A'));assert.ok(next.audit[0].detail.includes('1800 → 2000'));
   assert.equal(calculateStats(edit(next,p.id,1500))[p.id].rating,1500);
   assert.equal(calculateStats(edit(next,p.id,2000))[p.id].rating,2000);
 }
});

test('editing Elo preserves every recorded game result, delta, history entry, count and opponent rating, including legacy games',()=>{
 let c=demoClub();for(const t of c.tournaments)for(const r of t.rounds)for(const g of r.games){delete g.ratingBefore;delete g.kFactor;}
 const before=calculateStats(c),p=c.players[0],next=edit(c,p.id,2100),after=calculateStats(next);
 for(const player of c.players)assert.deepEqual(after[player.id],{...before[player.id],...(player.id===p.id?{rating:2100}:{})});
 assert.deepEqual(next.tournaments.map(t=>t.rounds.map(r=>r.games.map(g=>[g.id,g.white,g.black,g.result]))),c.tournaments.map(t=>t.rounds.map(r=>r.games.map(g=>[g.id,g.white,g.black,g.result]))));
 const replay=JSON.parse(JSON.stringify(edit(next,p.id,1900)));
 for(const player of c.players)assert.deepEqual(calculateStats(replay)[player.id],{...before[player.id],...(player.id===p.id?{rating:1900}:{})});
});

test('future pairings use edited Elo and future results use it without changing earlier history',()=>{
 let c=save(fixture(),{type:'publishRound'});
 for(const g of c.tournaments[0].rounds[0].games)c=save(c,{type:'result',round:1,gameId:g.id,result:'white'});
 const id=c.players[0].id,before=calculateStats(c);c=edit(c,id,1300);
 c=save(c,{type:'publishRound'});const game=c.tournaments[0].rounds[1].games.find(g=>[g.white,g.black].includes(id));
 const baseline=calculateStats(c),expected=eloDelta(baseline[game.white].rating,baseline[game.black].rating,1,c.kFactor);
 c=save(c,{type:'result',round:2,gameId:game.id,result:'white'});const after=calculateStats(c);
 assert.equal(after[game.white].rating,baseline[game.white].rating+expected);
 assert.equal(after[game.black].rating,baseline[game.black].rating-expected);
 for(const player of c.players)assert.deepEqual(after[player.id].history.slice(0,before[player.id].history.length),before[player.id].history);
 for(const pid of [game.white,game.black])assert.equal(after[pid].history.at(-1).rating,after[pid].rating);
 const f=fixture(),moved=edit(f,f.players[0].id,1100),pair=pairRound(moved,moved.tournaments[0]).games.find(g=>[g.white,g.black].includes(f.players[0].id));
 assert.ok([pair.white,pair.black].includes(f.players[3].id));
});

test('editing between results preserves scored boards and uses the correction for unscored games in that round',()=>{
 let c=save(fixture(),{type:'publishRound'});const [first,second]=c.tournaments[0].rounds[0].games;
 c=save(c,{type:'result',round:1,gameId:first.id,result:'draw'});const before=calculateStats(c),original=structuredClone(c.tournaments[0].rounds[0].games[0]);
 c=edit(c,first.white,2000);c=edit(c,second.white,1500);
 assert.deepEqual(c.tournaments[0].rounds[0].games[0],original);
 assert.deepEqual(calculateStats(c)[first.black],before[first.black]);
 const baseline=calculateStats(c),delta=eloDelta(1500,baseline[second.black].rating,1,c.kFactor);
 c=save(c,{type:'result',round:1,gameId:second.id,result:'white'});
 assert.equal(calculateStats(c)[second.white].rating,1500+delta);
 assert.equal(calculateStats(c)[second.black].rating,baseline[second.black].rating-delta);
 assert.equal(calculateStats(c)[first.white].rating,2000);
});

test('result corrections and clearing do not double-apply manual adjustments; deletion preserves opponents',()=>{
 let c=save(fixture(),{type:'publishRound'});const g=c.tournaments[0].rounds[0].games[0];
 c=save(c,{type:'result',round:1,gameId:g.id,result:'white'});const delta=calculateStats(c)[g.white].change;
 c=edit(c,g.white,1900);const snapshot=structuredClone(c.tournaments[0].rounds[0].games[0].ratingBefore);
 c=save(c,{type:'result',round:1,gameId:g.id,result:null});assert.equal(calculateStats(c)[g.white].rating,1900-delta);
 c=save(c,{type:'result',round:1,gameId:g.id,result:'white'});assert.equal(calculateStats(c)[g.white].rating,1900);
 assert.deepEqual(c.tournaments[0].rounds[0].games[0].ratingBefore,snapshot);
 const before=calculateStats(c);c=save(c,{type:'deletePlayer',playerId:g.white,confirm:true});
 for(const p of c.players)assert.deepEqual(calculateStats(c)[p.id],before[p.id]);
});

test('invalid or unauthorized edits fail atomically',()=>{
 const c=fixture(),before=structuredClone(c),id=c.players[0].id;
 for(const rating of [99,3501,100.5,NaN,Infinity,'1500','',null,undefined])assert.throws(()=>edit(c,id,rating),/whole number/);
 assert.throws(()=>edit(c,'missing',1500),/Player not found/);
 assert.throws(()=>edit(c,id,1500,{...manager,role:'viewer'}),/Manager access/);
 assert.deepEqual(c,before);assert.equal(calculateStats(edit(c,id,100))[id].rating,100);assert.equal(calculateStats(edit(c,id,3500))[id].rating,3500);
});
