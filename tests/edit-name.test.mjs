import test from 'node:test';
import assert from 'node:assert/strict';
import {applyAction,calculateStats,demoClub,normalName} from '../lib/chess.ts';
import {tournamentStandings} from '../lib/tournament.ts';
const admin={id:'admin',email:'admin@example.com',username:'david',role:'owner'};
const rename=(c,id,name,actor=admin)=>applyAction(c,{type:'editName',playerId:id,name},actor);

test('admin renames one identity, preserving every rating, result, pairing and seed and recording old/new names',()=>{
 let c=demoClub();const p=c.players[0];
 c=applyAction(c,{type:'editRating',playerId:p.id,rating:2000},admin);
 c.tournaments[0].mode='tournament';c.tournaments[0].seeds=Object.fromEntries(c.players.map((p,i)=>[p.id,{number:i+1,rating:p.initialRating}]));
 const before=structuredClone(c),stats=calculateStats(c),ranks=tournamentStandings(c,c.tournaments[0]);
 const next=rename(c,p.id,'Corrected Player');
 assert.equal(next.players.length,c.players.length);assert.deepEqual(next.players[0],{...c.players[0],name:'Corrected Player'});
 assert.deepEqual(next.players.slice(1),c.players.slice(1));assert.deepEqual(next.tournaments,c.tournaments);assert.deepEqual(calculateStats(next),stats);
 assert.deepEqual(tournamentStandings(next,next.tournaments[0]).map(p=>[p.id,p.rank,p.points,p.buchholz,p.sonnebornBerger]),ranks.map(p=>[p.id,p.rank,p.points,p.buchholz,p.sonnebornBerger]));
 assert.equal(next.audit[0].actor,'david');assert.equal(next.audit[0].action,'editName');assert.ok(next.audit[0].detail.includes(p.name));assert.ok(next.audit[0].detail.includes('Corrected Player'));
 assert.deepEqual(next.audit.slice(1),c.audit);assert.deepEqual(c,before);
});

test('managers and viewers cannot rename, even by calling the reducer directly',()=>{
 const c=demoClub(),before=structuredClone(c),id=c.players[0].id;
 assert.throws(()=>rename(c,id,'Changed',{...admin,role:'manager'}),/Only the admin/);
 assert.throws(()=>rename(c,id,'Changed',{...admin,role:'viewer'}),/Manager access/);assert.deepEqual(c,before);
});

test('renames reject invalid, missing, long and duplicate names atomically, including archived duplicates',()=>{
 const c=demoClub(),before=structuredClone(c),id=c.players[0].id,other=c.players[1];other.archived=true;before.players[1].archived=true;
 for(const name of ['', '  ',null,undefined,{},'x'.repeat(101),'Ⅳ'.repeat(100)])assert.throws(()=>rename(c,id,name),/valid value/);
 for(const name of [other.name,other.name.toUpperCase(),'  '+other.name.replaceAll(' ','   ')+'  '])assert.throws(()=>rename(c,id,name),/already has that name/);
 assert.throws(()=>rename(c,'missing','Valid'),/Player not found/);assert.deepEqual(c,before);
});

test('case-only corrections and Unicode/spacing normalization keep the same player ID',()=>{
 const c=demoClub(),id=c.players[0].id;
 const next=rename(c,id,'  Ａｌｅｘ\u00a0  Chen  ');assert.equal(next.players[0].id,id);assert.equal(next.players[0].name,'Alex Chen');
 assert.equal(rename(next,id,'ALEX CHEN').players[0].name,'ALEX CHEN');assert.equal(normalName(next.players[0].name),normalName('alex chen'));
});
