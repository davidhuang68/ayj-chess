import test from 'node:test';
import assert from 'node:assert/strict';
import {newClub,applyAction,calculateStats,eloDelta} from '../lib/chess.ts';
const admin={id:'admin',email:'admin@example.com',role:'owner'},manager={id:'manager',email:'manager@example.com',role:'manager'};
const save=(c,a,actor=admin)=>applyAction(c,a,actor);
const settings=(c,k)=>save(c,{type:'settings',name:c.name,startingRating:c.startingRating,kFactor:k});
const score=(c,g,result)=>save(c,{type:'result',tournamentId:c.tournaments[0].id,round:1,gameId:g.id,result});
function fixture(){let c=save(newClub(),{type:'createSession',name:'QA',date:'2026-10-12',timeControl:'10 + 5'});c=save(c,{type:'importNames',tournamentId:c.tournaments[0].id,text:'A\nB\nC\nD'});return save(c,{type:'publishRound',tournamentId:c.tournaments[0].id});}
test('K can change after legacy results without recalculating their ratings',()=>{
 let c=fixture(),games=c.tournaments[0].rounds[0].games;c=score(c,games[0],'white');delete c.tournaments[0].rounds[0].games[0].kFactor;
 const before=calculateStats(c);c=settings(c,64);assert.deepEqual(calculateStats(c),before);assert.equal(c.tournaments[0].rounds[0].games[0].kFactor,32);
 c=score(c,games[1],'white');assert.equal(calculateStats(c)[games[1].white].rating,1032);assert.equal(c.tournaments[0].rounds[0].games[1].kFactor,64);
 const mixed=calculateStats(c);c=JSON.parse(JSON.stringify(settings(c,8)));assert.deepEqual(calculateStats(c),mixed);
});
test('corrected and cleared results retain their original K after a settings change',()=>{
 let c=fixture(),game=c.tournaments[0].rounds[0].games[0];c=score(c,game,'white');c=settings(c,64);c=score(c,game,'black');
 assert.equal(calculateStats(c)[game.white].rating,984);assert.equal(calculateStats(c)[game.black].rating,1016);
 c=score(c,game,null);c=settings(c,8);c=score(c,game,'white');assert.equal(calculateStats(c)[game.white].rating,1016);assert.equal(c.tournaments[0].rounds[0].games[0].kFactor,32);
});
test('new rounds use the changed K while prior rated games keep their effect',()=>{
 let c=fixture(),t=c.tournaments[0];for(const g of t.rounds[0].games)c=score(c,g,'white');const before=calculateStats(c);c=settings(c,8);assert.deepEqual(calculateStats(c),before);
 c=save(c,{type:'publishRound',tournamentId:t.id});const game=c.tournaments[0].rounds[1].games[0],expected=eloDelta(before[game.white].rating,before[game.black].rating,1,8);
 c=save(c,{type:'result',tournamentId:t.id,round:2,gameId:game.id,result:'white'});assert.equal(calculateStats(c)[game.white].rating,before[game.white].rating+expected);assert.equal(c.tournaments[0].rounds[1].games[0].kFactor,8);
});
test('K bounds and admin-only permissions still apply',()=>{
 const c=fixture(),action={type:'settings',name:c.name,startingRating:1000,kFactor:64};assert.throws(()=>save(c,action,manager),/Only the admin/);
 for(const k of [0,7,65,8.5,NaN])assert.throws(()=>settings(c,k),/8–64/);assert.equal(settings(c,8).kFactor,8);assert.equal(settings(c,64).kFactor,64);
});
test('creating a session saves the selected K while preserving legacy ratings',()=>{
 let c=fixture();for(const g of c.tournaments[0].rounds[0].games)c=score(c,g,'white');c=save(c,{type:'finishSession',tournamentId:c.tournaments[0].id,confirmEarly:true});
 delete c.tournaments[0].rounds[0].games[0].kFactor;const before=calculateStats(c);
 c=save(c,{type:'createSession',name:'Next week',date:'2026-10-19',timeControl:'10 + 5',kFactor:64});assert.equal(c.kFactor,64);assert.deepEqual(calculateStats(c),before);assert.equal(c.tournaments[0].rounds[0].games[0].kFactor,32);
 const id=c.tournaments[1].id;c=save(c,{type:'importNames',tournamentId:id,mode:'existing',text:c.players.map(p=>p.name).join('\n')});c=save(c,{type:'publishRound',tournamentId:id});const g=c.tournaments[1].rounds[0].games[0];
 c=save(c,{type:'result',tournamentId:id,round:1,gameId:g.id,result:'white'});assert.equal(c.tournaments[1].rounds[0].games[0].kFactor,64);assert.equal(calculateStats(c)[g.white].rating,before[g.white].rating+eloDelta(before[g.white].rating,before[g.black].rating,1,64));
});
test('session K validates bounds and preserves admin-only editing',()=>{
 const c=newClub(),a={type:'createSession',name:'QA',date:'2026-10-12',timeControl:'10 + 5'};
 for(const k of [0,7,65,8.5,''])assert.throws(()=>save(c,{...a,kFactor:k}),/8–64/);
 assert.throws(()=>save(c,{...a,kFactor:64},manager),/Only the admin/);assert.equal(save(c,{...a,kFactor:32},manager).kFactor,32);assert.equal(save(c,a,manager).kFactor,32);assert.equal(c.tournaments.length,0);
});
test('failed session creation cannot change K or past ratings',()=>{
 const c=fixture(),before=structuredClone(c);assert.throws(()=>save(c,{type:'createSession',name:'Invalid',date:'2026-10-12',timeControl:'10 + 5',kFactor:64}),/Finish the active/);assert.deepEqual(c,before);
});
