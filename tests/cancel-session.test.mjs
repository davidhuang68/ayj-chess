import test from 'node:test';
import assert from 'node:assert/strict';
import {newClub,applyAction,calculateStats,pairRound} from '../lib/chess.ts';
const manager={id:'manager',email:'manager@example.com',role:'manager'},admin={...manager,role:'owner'};
const save=(c,a,actor=manager)=>applyAction(c,a,actor);
const create=c=>save(c,{type:'createSession',name:'QA',date:'2026-10-14',timeControl:'10 + 5'});
const cancel=(c,id=c.tournaments.at(-1).id,actor=manager)=>save(c,{type:'cancelSession',tournamentId:id,confirm:true},actor);
test('admins and managers can cancel empty sessions and immediately create another',()=>{
 for(const actor of [admin,manager]){const c=create(newClub()),next=cancel(c,undefined,actor);assert.equal(next.tournaments.length,0);assert.equal(c.tournaments.length,1);assert.equal(create(next).tournaments.length,1);}
});
test('cancelling before publication preserves imported players, ratings, settings and accounts',()=>{
 let c=create(newClub());c=save(c,{type:'importNames',tournamentId:c.tournaments[0].id,text:'A\nB\nC\nD'});c.members=[admin,manager];const before=structuredClone(c),stats=calculateStats(c);assert.equal(pairRound(c,c.tournaments[0]).games.length,2);
 c=cancel(c);assert.deepEqual(c.players,before.players);assert.deepEqual(c.members,before.members);assert.equal(c.kFactor,before.kFactor);assert.equal(c.startingRating,before.startingRating);assert.deepEqual(calculateStats(c),stats);assert.deepEqual(JSON.parse(JSON.stringify(c)).tournaments,[]);
});
test('published pairings cannot be cancelled even when no results have been recorded',()=>{
 let c=create(newClub());c=save(c,{type:'importNames',tournamentId:c.tournaments[0].id,text:'A\nB'});c=save(c,{type:'publishRound',tournamentId:c.tournaments[0].id});const before=structuredClone(c);assert.throws(()=>cancel(c),/without published pairings/);assert.deepEqual(c,before);
});
test('cancellation requires confirmation and manager access and rejects unknown/completed sessions',()=>{
 const c=create(newClub()),id=c.tournaments[0].id;assert.throws(()=>save(c,{type:'cancelSession',tournamentId:id}),/Confirm/);assert.throws(()=>cancel(c,'unknown'),/Session not found/);assert.throws(()=>cancel(c,id,{...manager,role:'viewer'}),/Manager access/);const done=structuredClone(c);done.tournaments[0].status='completed';assert.throws(()=>cancel(done),/without published pairings/);
});
test('cancelling a new session leaves previous results and ratings intact',()=>{
 let c=create(newClub()),id=c.tournaments[0].id;c=save(c,{type:'importNames',tournamentId:id,text:'A\nB'});c=save(c,{type:'publishRound',tournamentId:id});const g=c.tournaments[0].rounds[0].games[0];c=save(c,{type:'result',tournamentId:id,round:1,gameId:g.id,result:'white'});c=save(c,{type:'finishSession',tournamentId:id,confirmEarly:true});const history=structuredClone(c.tournaments[0]),stats=calculateStats(c);c=create(c);c=cancel(c);assert.deepEqual(c.tournaments,[history]);assert.deepEqual(calculateStats(c),stats);
});
