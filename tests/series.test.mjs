import test from 'node:test';
import assert from 'node:assert/strict';
import {newClub,applyAction,calculateStats,pairRound,weeklyStandings} from '../lib/chess.ts';
import {seriesKey,sessionGroups,priorSeriesSessions} from '../lib/series.ts';
const manager={id:'qa',email:'qa@example.com',role:'manager'};
const save=(c,a)=>applyAction(c,{tournamentId:c.tournaments.at(-1)?.id,...a},manager);
function start(c=newClub(),name='AYJ Weekly',count=4,maxRounds=1){
 c=save(c,{type:'createSession',name,date:`2026-10-${String(14+c.tournaments.length).padStart(2,'0')}`,timeControl:'10 min',maxRounds});
 return save(c,{type:'importNames',text:Array.from({length:count},(_,i)=>`Player ${i}`).join('\n')});
}
function score(c,result='draw'){
 const round=c.tournaments.at(-1).rounds.at(-1);
 for(const g of round.games.filter(g=>g.black))c=save(c,{type:'result',round:round.number,gameId:g.id,result});
 return c;
}
const finish=c=>save(score(save(c,{type:'publishRound'})),{type:'finishSession'});
const matchKey=g=>[g.white,g.black].sort().join('|');
const keys=t=>new Set(t.rounds.flatMap(r=>r.games.filter(g=>g.black).map(matchKey)));
test('same names group existing weekly sessions, ignoring case and Unicode spacing, without changing data',()=>{
 let c=finish(start());c=finish(start(c,' Other series '));c=start(c,' ayj   WEEKLY ');
 const before=structuredClone(c),groups=sessionGroups(c);
 assert.equal(seriesKey(' ＡＹＪ\u00a0 Weekly '),seriesKey('ayj weekly'));
 assert.equal(groups.length,2);assert.equal(groups[0].sessions.length,2);
 assert.equal(c.tournaments[2].name,'AYJ Weekly');
 assert.deepEqual(priorSeriesSessions(c,c.tournaments[2]).map(t=>t.id),[c.tournaments[0].id]);
 assert.deepEqual(priorSeriesSessions(c,c.tournaments[0]),[]);assert.deepEqual(c,before);
});
test('session points reset and ratings carry over unchanged when a same-name week begins',()=>{
 let c=save(start(),{type:'publishRound'});c=score(c,'white');c=save(c,{type:'finishSession'});
 const stats=calculateStats(c),past=structuredClone(c.tournaments[0]);c=start(c,'ayj weekly');
 assert.deepEqual(calculateStats(c),stats);assert.deepEqual(c.tournaments[0],past);
 assert.ok(weeklyStandings(c,c.tournaments[1]).every(p=>p.points===0&&p.played===0));
 const r=pairRound(c,c.tournaments[1]);assert.ok(r.games.every(g=>!keys(past).has(matchKey(g))));
});
test('first round favours close ratings; later rounds use only this week\'s points',()=>{
 let c=start(newClub(),'Ratings',8,2);c.players.forEach((p,i)=>p.initialRating=2000-i*100);
 const first=pairRound(c,c.tournaments[0]);
 for(const g of first.games){const a=c.players.find(p=>p.id===g.white),b=c.players.find(p=>p.id===g.black);assert.equal(Math.abs(a.initialRating-b.initialRating),100);}
 c=score(save(c,{type:'publishRound'}),'white');
 const standings=weeklyStandings(c,c.tournaments[0]),second=pairRound(c,c.tournaments[0]);
 for(const g of second.games)assert.equal(standings.find(p=>p.id===g.white).points,standings.find(p=>p.id===g.black).points);
});
test('different series do not inherit opponent restrictions',()=>{
 let c=finish(start());const old=keys(c.tournaments[0]);c=start(c,'New tournament');
 assert.deepEqual(new Set(pairRound(c,c.tournaments[1]).games.map(matchKey)),old);
});
test('older rematches are allowed only when necessary; this-week repeats still require override',()=>{
 let c=newClub();for(let i=0;i<3;i++)c=finish(start(c));
 const seen=new Set(c.tournaments.flatMap(t=>[...keys(t)]));assert.equal(seen.size,6);
 c=start(c,'AYJ Weekly',4,2);const stats=calculateStats(c),r=pairRound(c,c.tournaments[3]);
 assert.equal(r.games.length,2);assert.ok(r.warnings.some(w=>w.includes('earlier session')));assert.deepEqual(calculateStats(c),stats);
 let two=finish(start(newClub(),'Small',2));two=start(two,'Small',2,2);two=score(save(two,{type:'publishRound'}));
 assert.throws(()=>pairRound(two,two.tournaments[1]),/repeat opponents/);
 assert.equal(pairRound(two,two.tournaments[1],true).games.length,1);
});
test('manual old-opponent edits require override while existing fallback boards remain editable',()=>{
 let c=finish(start());const old=c.tournaments[0].rounds[0].games;c=save(start(c),{type:'publishRound'});
 const pairs=old.map(g=>({white:g.white,black:g.black}));
 assert.throws(()=>save(c,{type:'editPairings',round:1,pairings:pairs}),/already played/);
 c=save(c,{type:'editPairings',round:1,pairings:pairs,allowRematches:true});
 const unchanged=c.tournaments[1].rounds[0].games.map(g=>({id:g.id,white:g.white,black:g.black}));
 assert.doesNotThrow(()=>save(c,{type:'editPairings',round:1,pairings:unchanged}));
});
test('waiting pairing can use necessary older rematches without adding byes or changing recorded history',()=>{
 let c=newClub();for(let i=0;i<3;i++)c=finish(start(c));
 const old=structuredClone(c.tournaments),stats=calculateStats(c);c=save(start(c),{type:'publishRound'});
 c=save(c,{type:'editPairings',round:1,pairings:[]});c=save(c,{type:'pairWaiting',round:1});
 const r=c.tournaments[3].rounds[0];assert.equal(r.games.length,2);assert.ok(r.games.every(g=>g.black&&g.result===null));assert.deepEqual(r.unpaired,[]);
 assert.deepEqual(c.tournaments.slice(0,3),old);assert.deepEqual(calculateStats(c),stats);
});
test('late high-rated newcomers get zero points and rating-based pairings on their first week',()=>{
 let c=finish(start());c=start(c);
 c.players.forEach((p,i)=>p.initialRating=[1900,1800,1100,1000][i]);
 c=save(c,{type:'importNames',mode:'new',text:'Strong New\nAnother Strong'});
 c.players.find(p=>p.name==='Strong New').initialRating=1850;c.players.find(p=>p.name==='Another Strong').initialRating=1950;
 const fresh=c.players.filter(p=>p.name.includes('Strong')),stats=calculateStats(c),r=pairRound(c,c.tournaments[1]);
 for(const p of fresh){assert.equal(weeklyStandings(c,c.tournaments[1]).find(s=>s.id===p.id).points,0);const g=r.games.find(g=>g.white===p.id||g.black===p.id);assert.ok(stats[g.white===p.id?g.black:g.white].rating>=1800);}
});
