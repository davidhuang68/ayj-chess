import test from 'node:test';
import assert from 'node:assert/strict';
import {newClub,applyAction,calculateStats,pairRound} from '../lib/chess.ts';
const manager={id:'manager',email:'qa@example.com',role:'manager'},admin={...manager,role:'owner'};
const save=(c,a,actor=manager)=>applyAction(c,{tournamentId:c.tournaments.at(-1)?.id,...a},actor);
const fixture=()=>save(newClub(),{type:'createSession',name:'QA',date:'2026-10-16',timeControl:'10 min'});
test('admins and managers can seed new players individually while blank ratings retain the club default',()=>{
 for(const actor of [admin,manager]){
   let c=fixture();c.startingRating=1200;
   c=save(c,{type:'importNames',mode:'new',text:'QA High\nQA Low\nQA Default',initialRatings:[{name:' qa  HIGH ',rating:2000},{name:'QA Low',rating:650}]},actor);
   assert.deepEqual(c.players.map(p=>p.initialRating),[2000,650,1200]);
   assert.deepEqual(Object.values(calculateStats(c)).map(s=>s.rating),[2000,650,1200]);
   assert.ok(c.audit[0].detail.includes('2 starting ratings supplied'));
 }
});
test('invalid ratings, unknown names, duplicates and wrong import modes reject the whole batch',()=>{
 const c=fixture(),before=structuredClone(c),base={type:'importNames',mode:'new',text:'QA One\nQA Two'};
 for(const initialRatings of [null,{},[{name:'QA One',rating:99}],[{name:'QA One',rating:3501}],[{name:'QA One',rating:800.5}],[{name:'QA One',rating:'800'}],[{name:'QA One',rating:null}],[{name:'Unknown',rating:800}],[{name:'QA One',rating:800},{name:'qa one',rating:900}]]){
   assert.throws(()=>save(c,{...base,initialRatings}));assert.deepEqual(c,before);
 }
 assert.throws(()=>save(c,{...base,mode:'mixed',initialRatings:[{name:'QA One',rating:1500}]}),/only.*new players/);
 assert.throws(()=>save(c,{...base,initialRatings:[{name:'QA One',rating:1500}]},{...manager,role:'viewer'}),/Manager access/);
});
test('existing players cannot be reseeded and retain ratings, IDs and result history',()=>{
 let c=save(fixture(),{type:'importNames',mode:'new',text:'QA One\nQA Two',initialRatings:[{name:'QA One',rating:1800},{name:'QA Two',rating:1500}]});
 c=save(c,{type:'publishRound'});const t=c.tournaments[0],g=t.rounds[0].games[0];
 c=save(c,{type:'result',round:1,gameId:g.id,result:'white'});c=save(c,{type:'finishSession',confirmEarly:true});
 const stats=calculateStats(c),profiles=structuredClone(c.players),past=structuredClone(c.tournaments[0]);
 c=save(c,{type:'createSession',name:'Next',date:'2026-10-17',timeControl:'10 min'});
 assert.throws(()=>save(c,{type:'importNames',mode:'existing',text:'QA One',initialRatings:[{name:'QA One',rating:100}]}),/only.*new players/);
 assert.throws(()=>save(c,{type:'importNames',mode:'new',text:'QA One',initialRatings:[{name:'QA One',rating:100}]}),/Already in the system/);
 c=save(c,{type:'importNames',mode:'existing',text:'QA One\nQA Two'});
 assert.deepEqual(calculateStats(c),stats);assert.deepEqual(c.players,profiles);assert.deepEqual(c.tournaments[0],past);
});
test('seeded ratings are used for first pairings and late arrivals keep current boards intact',()=>{
 let c=save(fixture(),{type:'importNames',mode:'new',text:'QA A\nQA B\nQA C\nQA D',initialRatings:[{name:'QA A',rating:1900},{name:'QA B',rating:1850},{name:'QA C',rating:700},{name:'QA D',rating:650}]});
 const r=pairRound(c,c.tournaments[0]),stats=calculateStats(c);
 for(const g of r.games)assert.equal(Math.abs(stats[g.white].rating-stats[g.black].rating),50);
 c=save(c,{type:'publishRound'});const before=structuredClone(c.tournaments[0].rounds);
 c=save(c,{type:'importNames',mode:'new',text:'QA Late',initialRatings:[{name:'QA Late',rating:1700}]});
 assert.equal(calculateStats(c)[c.players.at(-1).id].rating,1700);assert.deepEqual(c.tournaments[0].rounds.map(r=>r.games),before.map(r=>r.games));assert.deepEqual(c.tournaments[0].rounds[0].unpaired,[c.players.at(-1).id]);
});
test('names-only legacy imports and duplicate pasted names remain supported',()=>{
 let c=save(fixture(),{type:'importNames',text:'QA Legacy'});assert.equal(c.players[0].initialRating,1000);
 c=save(c,{type:'importNames',mode:'new',text:'QA New\nqa  NEW',initialRatings:[{name:'QA New',rating:100}]});assert.equal(c.players.length,2);assert.equal(c.players[1].initialRating,100);
 c=save(c,{type:'importNames',mode:'new',text:'constructor\n__proto__',initialRatings:[{name:'constructor',rating:3500},{name:'__proto__',rating:1100}]});assert.equal(c.players.at(-2).initialRating,3500);assert.equal(c.players.at(-1).initialRating,1100);
});
