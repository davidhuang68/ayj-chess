import test from 'node:test';
import assert from 'node:assert/strict';
import {newClub,applyAction,calculateStats,pairRound} from '../lib/chess.ts';
import {tournamentStandings} from '../lib/tournament.ts';
import {priorSeriesSessions,sessionGroups} from '../lib/series.ts';
const manager={id:'qa',email:'qa@example.com',role:'manager'};
const save=(c,a)=>applyAction(c,{tournamentId:c.tournaments.at(-1)?.id,...a},manager);
function fixture(count=8,mode='tournament',rounds=5){
 let c=save(newClub(),{type:'createSession',name:'AYJ Open',mode,date:'2026-10-22',timeControl:'25 + 5',maxRounds:rounds});
 const names=Array.from({length:count},(_,i)=>'Player '+String(i+1).padStart(2,'0'));
 return save(c,{type:'importNames',mode:'new',text:names.join('\n'),initialRatings:names.map((name,i)=>({name,rating:2200-i*40}))});
}
const pairs=round=>round.games.filter(g=>g.black).map(g=>[g.white,g.black].sort().join('|')).sort();
const score=(c,choose=()=> 'white')=>{const r=c.tournaments.at(-1).rounds.at(-1);for(const [i,g] of r.games.entries())if(g.black)c=save(c,{type:'result',round:r.number,gameId:g.id,result:choose(g,i,r.number)});return c;};

test('creation keeps legacy and weekly defaults; tournaments default to five and support fifteen rounds',()=>{
 const a={type:'createSession',name:'QA',date:'2026-10-22',timeControl:'10 min'};
 assert.equal(save(newClub(),a).tournaments[0].maxRounds,2);
 assert.equal(save(newClub(),{...a,mode:'tournament'}).tournaments[0].maxRounds,5);
 assert.equal(save(newClub(),{...a,mode:'tournament',maxRounds:15}).tournaments[0].maxRounds,15);
 for(const n of [0,16,3.5])assert.throws(()=>save(newClub(),{...a,mode:'tournament',maxRounds:n}),/1–15/);
 assert.throws(()=>save(newClub(),{...a,maxRounds:11}),/1–10/);
 assert.throws(()=>save(newClub(),{...a,mode:'invalid'}),/Weekly or Tournament/);
 const c=fixture(8,'weekly');delete c.tournaments[0].mode;
 const r=pairRound(c,c.tournaments[0]);for(const g of r.games){const a=c.players.findIndex(p=>p.id===g.white),b=c.players.findIndex(p=>p.id===g.black);assert.equal(Math.abs(a-b),1);}
});

test('first-round tournament pairs top half with bottom half; preview is read-only',()=>{
 const c=fixture(),before=structuredClone(c),r=pairRound(c,c.tournaments[0]);
 assert.deepEqual(pairs(r),[0,1,2,3].map(i=>[c.players[i].id,c.players[i+4].id].sort().join('|')).sort());
 assert.deepEqual(c,before);assert.equal(r.games.length,4);
});

test('later rounds split each score group instead of pairing neighbouring ratings',()=>{
 let c=save(fixture(),{type:'publishRound'});const top=new Set(c.players.slice(0,4).map(p=>p.id));
 c=score(c,g=>top.has(g.white)?'white':'black');const r=pairRound(c,c.tournaments[0]);
 const expected=[[0,2],[1,3],[4,6],[5,7]].map(([a,b])=>[c.players[a].id,c.players[b].id].sort().join('|')).sort();
 assert.deepEqual(pairs(r),expected);
});

test('pairing numbers freeze at publication and late arrivals append without reseeding anyone',()=>{
 let c=save(fixture(),{type:'publishRound'});const seeds=structuredClone(c.tournaments[0].seeds),pid=c.players[7].id;
 c=save(c,{type:'editRating',playerId:pid,rating:3000});assert.deepEqual(c.tournaments[0].seeds,seeds);
 c=save(c,{type:'importNames',mode:'new',text:'Late Grandmaster\nLate Other\nLate Third',initialRatings:[{name:'Late Grandmaster',rating:3200}]});
 for(const id of Object.keys(seeds))assert.deepEqual(c.tournaments[0].seeds[id],seeds[id]);
 const late=c.players.find(p=>p.name==='Late Grandmaster');assert.equal(c.tournaments[0].seeds[late.id].number,9);
 const old=structuredClone(c.tournaments[0].rounds[0].games);c=save(c,{type:'pairWaiting',round:1});const r=c.tournaments[0].rounds[0];
 assert.equal(r.unpaired.length,1);assert.equal(r.games.length,old.length+1);assert.ok(r.games.every(g=>g.black));assert.deepEqual(r.games.slice(0,old.length),old);
});

test('thirty players complete seven Swiss rounds without rematches, duplicate seats or incomplete rankings',()=>{
 let c=fixture(30,'tournament',7);const seen=new Set();
 for(let n=1;n<=7;n++){
   c=save(c,{type:'publishRound'});const r=c.tournaments[0].rounds.at(-1);
   assert.equal(r.games.length,15);assert.equal(new Set(r.games.flatMap(g=>[g.white,g.black])).size,30);
   for(const key of pairs(r)){assert.ok(!seen.has(key));seen.add(key);}
   c=score(c,(g,i,round)=>(i+round)%5===0?'draw':(i+round)%3===0?'black':'white');
 }
 c=save(c,{type:'finishSession'});const table=tournamentStandings(c,c.tournaments[0]);
 assert.equal(table.length,30);assert.equal(table.reduce((sum,p)=>sum+p.points,0),105);
 for(let i=1;i<table.length;i++)assert.ok(table[i].rank>=table[i-1].rank);
 assert.deepEqual(tournamentStandings(JSON.parse(JSON.stringify(c)),c.tournaments[0]),table);
});

test('odd Swiss attendance uses one non-repeated full-point bye and does not change Elo for it',()=>{
 let c=fixture(9,'tournament',5);const byes=new Set();
 for(let i=0;i<5;i++){
   const before=calculateStats(c);c=save(c,{type:'publishRound'});const r=c.tournaments[0].rounds.at(-1),bye=r.games.find(g=>!g.black);
   assert.ok(bye);assert.ok(!byes.has(bye.white));byes.add(bye.white);assert.equal(calculateStats(c)[bye.white].rating,before[bye.white].rating);
   assert.equal(new Set(r.games.flatMap(g=>g.black?[g.white,g.black]:[g.white])).size,9);c=score(c,()=> 'draw');
 }
});

test('tournaments are independent of same-name weekly sessions and other tournaments',()=>{
 let c=score(save(fixture(8,'weekly',1),{type:'publishRound'}));c=save(c,{type:'finishSession'});
 c=save(c,{type:'createSession',mode:'tournament',name:'AYJ Open',date:'2026-10-22',timeControl:'25 + 5',maxRounds:1});
 c=save(c,{type:'importNames',mode:'existing',text:c.players.map(p=>p.name).join('\n')});
 assert.deepEqual(priorSeriesSessions(c,c.tournaments[1]),[]);assert.equal(sessionGroups(c).length,2);
 c=score(save(c,{type:'publishRound'}));c=save(c,{type:'finishSession'});
 const rankings=tournamentStandings(c,c.tournaments[1]).map(p=>[p.id,p.rank,p.points,p.buchholzCut1,p.buchholz,p.sonnebornBerger,p.wins]);
 c=save(c,{type:'createSession',mode:'weekly',name:'AYJ Open',date:'2026-10-22',timeControl:'10 min'});
 assert.deepEqual(priorSeriesSessions(c,c.tournaments[2]).map(t=>t.id),[c.tournaments[0].id]);
 c=save(c,{type:'importNames',mode:'existing',text:c.players.map(p=>p.name).join('\n')});c=score(save(c,{type:'publishRound'}));
 assert.deepEqual(tournamentStandings(c,c.tournaments[1]).map(p=>[p.id,p.rank,p.points,p.buchholzCut1,p.buchholz,p.sonnebornBerger,p.wins]),rankings);
});

function tableFixture(names,rounds){
 const c=newClub();c.players=names.map((name,i)=>({id:name,name,initialRating:2000-i*100,createdAt:'qa'}));
 const event={id:'event',name:'QA',date:'2026-10-22',createdAt:'qa',timeControl:'25 + 5',signupUrl:'',maxRounds:rounds.length,roster:names,withdrawn:[],status:'completed',mode:'tournament',
   rounds:rounds.map((games,i)=>({number:i+1,publishedAt:'qa',warnings:[],games:games.map(([white,black,result],j)=>({id:`${i}-${j}`,board:j+1,white,black,result}))}))};
 c.tournaments=[event];return {c,event};
}

test('Buchholz Cut 1, Buchholz and Sonneborn-Berger are hand-checked; Elo is not a ranking tie-break',()=>{
 const {c,event}=tableFixture(['A','B','C','D'],[[['A','C','white'],['B','D','white']],[['A','B','draw'],['C','D','white']],[['A','D','black'],['B','C','black']]]);
 const table=tournamentStandings(c,event);assert.deepEqual(table.map(p=>p.id),['C','A','B','D']);
 const a=table.find(p=>p.id==='A'),b=table.find(p=>p.id==='B');
 assert.equal(a.directEncounter,.5);assert.equal(b.directEncounter,.5);
 assert.deepEqual([a.points,a.buchholzCut1,a.buchholz,a.sonnebornBerger,a.wins],[1.5,3.5,4.5,2.75,1]);
 assert.deepEqual([b.points,b.buchholzCut1,b.buchholz,b.sonnebornBerger,b.wins],[1.5,3.5,4.5,1.75,1]);
 const before=table.map(p=>p.rank);const edited=save(c,{type:'editRating',playerId:'D',rating:3500});assert.deepEqual(tournamentStandings(edited,event).map(p=>p.rank),before);
});

test('direct encounter precedes higher Buchholz, while points remain the primary ranking',()=>{
 const {c,event}=tableFixture(['B','A','C','D','E','F','G','H'],[
  [['A','B','white'],['C','D','white'],['E','F','black'],['G','H','black']],
  [['A','C','black'],['B','E','white'],['D','G','black'],['F','H','white']],
  [['A','D','draw'],['B','F','draw'],['C','H','black'],['E','G','black']],
 ]);
 const before=structuredClone(c),rows=tournamentStandings(c,event),a=rows.find(p=>p.id==='A'),b=rows.find(p=>p.id==='B');
 assert.equal(a.points,b.points);assert.ok(b.buchholzCut1>a.buchholzCut1);
 assert.equal(a.directEncounter,1);assert.equal(b.directEncounter,0);assert.ok(a.rank<b.rank);
 assert.equal(rows[0].id,'F');assert.deepEqual(c,before);
});

test('complete tied mini-leagues recursively reapply direct encounter to smaller tied subsets',()=>{
 const {c,event}=tableFixture(['B','A','D','C','E'],[
  [['A','B','white'],['C','D','white']],[['A','C','white'],['B','D','white']],
  [['D','A','white'],['B','C','white']],[['C','E','white']],[['D','E','white']],
 ]);
 const rows=tournamentStandings(c,event);assert.deepEqual(rows.slice(0,4).map(p=>[p.id,p.points,p.rank]),[['A',2,1],['B',2,2],['C',2,3],['D',2,4]]);
 assert.deepEqual(rows.slice(0,4).map(p=>p.directEncounter),[2,2,1,1]);
});

test('a circular three-way head-to-head tie remains tied and never creates a pairwise sort cycle',()=>{
 const {c,event}=tableFixture(['C','B','A'],[[['A','B','white'],['C',null,'bye']],[['B','C','white'],['A',null,'bye']],[['C','A','white'],['B',null,'bye']]]);
 const rows=tournamentStandings(c,event);assert.ok(rows.every(p=>p.directEncounter===1&&p.rank===1&&p.tied));
});

test('incomplete Swiss direct encounter resolves only a guaranteed leader, then falls back for the rest',()=>{
 const {c,event}=tableFixture(['B','C','A','X','Y'],[
  [['A','B','white']],[['A','C','white']],[['B','X','white'],['C','Y','white']],[['B','Y','white'],['C','X','white']],
 ]);
 const rows=tournamentStandings(c,event);assert.equal(rows[0].id,'A');assert.equal(rows[0].directEncounter,2);
 assert.ok(rows.filter(p=>['B','C'].includes(p.id)).every(p=>p.directEncounter===null&&p.rank===2&&p.tied));
 const uncertain=tableFixture(['A','B','C','X'],[[['A','B','white']],[['B','C','white']],[['C','X','white']]]);
 assert.ok(tournamentStandings(uncertain.c,uncertain.event).filter(p=>p.points===1).every(p=>p.directEncounter===null));
});

test('direct encounter uses average scores for repeated meetings',()=>{
 const {c,event}=tableFixture(['B','A','C'],[[['A','B','white']],[['A','B','white']],[['A','B','black']],[['B','C','white']]]);
 const rows=tournamentStandings(c,event);assert.equal(rows[0].id,'A');assert.equal(rows[0].points,2);
 assert.equal(rows[0].directEncounter,2/3);assert.equal(rows[1].directEncounter,1/3);
});

test('forfeits, byes and pending encounters do not count toward direct encounter',()=>{
 const forfeits=tableFixture(['A','B','C','D'],[[['A','B','forfeit-white'],['C','D','white']],[['C','A','white'],['B','D','white']]]);
 assert.ok(tournamentStandings(forfeits.c,forfeits.event).filter(p=>['A','B'].includes(p.id)).every(p=>p.directEncounter===null));
 const pending=tableFixture(['A','B','C','D','E'],[[['A','B',null]],[['A','C','white'],['B','D','white']],[['C','D','white']],[['C','E','white']]]);
 assert.ok(tournamentStandings(pending.c,pending.event).filter(p=>['A','B'].includes(p.id)).every(p=>p.directEncounter===null));
 const byes=tableFixture(['A','B'],[[['A',null,'bye']],[['B',null,'bye']]]);
 assert.ok(tournamentStandings(byes.c,byes.event).every(p=>p.directEncounter===null));
});

test('fully unresolved ties share rank instead of pretending that rating or alphabetical order won',()=>{
 const {c,event}=tableFixture(['A','B','C','D','E','F'],[[['A','B','white'],['C','D','white'],['E','F','white']],[['B','C','white'],['D','E','white'],['F','A','white']]]);
 const table=tournamentStandings(c,event);assert.ok(table.every(p=>p.points===1&&p.rank===1&&p.tied));
});

test('full-point byes use capped dummy scores for BH and SB, without counting as played wins',()=>{
 const {c,event}=tableFixture(['A','B','C'],[[['A','B','white'],['C',null,'bye']],[['A',null,'bye'],['B','C','white']],[['A','C','black'],['B',null,'bye']]]);
 for(const p of tournamentStandings(c,event))assert.deepEqual([p.points,p.buchholz,p.buchholzCut1,p.sonnebornBerger,p.wins,p.rank],[2,5.5,4,3.5,1,1]);
});

test('finishing early uses the actual round count for final unplayed-round caps',()=>{
 const {c,event}=tableFixture(['A','B','C'],[[['A','B','white'],['C',null,'bye']]]);event.maxRounds=7;
 const bye=tournamentStandings(c,event).find(p=>p.id==='C');assert.equal(bye.buchholz,.5);assert.equal(bye.sonnebornBerger,.5);
});

test('forfeits use capped dummy opponents and voluntary missed rounds are cut first',()=>{
 const {c,event}=tableFixture(['A','B','C','D'],[[['A','B','forfeit-white'],['C','D','white']],[['A','C','black'],['B','D','white']]]);
 const rows=tournamentStandings(c,event),a=rows.find(p=>p.id==='A'),b=rows.find(p=>p.id==='B');
 assert.deepEqual([a.points,a.buchholz,a.buchholzCut1,a.sonnebornBerger,a.wins],[1,3,2,1,0]);
 assert.deepEqual([b.points,b.buchholz,b.buchholzCut1,b.sonnebornBerger,b.wins],[1,1,0,0,1]);
});

test('withdrawal tail absences adjust opponents scores; pending games are never treated as byes',()=>{
 const {c,event}=tableFixture(['A','B','C'],[[['A','B','white'],['C',null,'bye']],[['B','C','white']]]);event.withdrawn=['A'];
 const b=tournamentStandings(c,event).find(p=>p.id==='B');assert.equal(b.buchholz,2.5);
 event.rounds[1].games[0].result=null;event.status='running';
 const rows=tournamentStandings(c,event);assert.equal(rows.find(p=>p.id==='B').points,0);assert.equal(rows.find(p=>p.id==='C').points,1);
});

test('no legal repeat-free round produces an actionable error and does not silently rematch',()=>{
 let c=score(save(fixture(2),{type:'publishRound'}));assert.throws(()=>save(c,{type:'publishRound'}),/No Swiss pairing/);
 assert.equal(c.tournaments[0].rounds.length,1);
 assert.equal(save(c,{type:'publishRound',allowRematches:true}).tournaments[0].rounds.length,2);
});
