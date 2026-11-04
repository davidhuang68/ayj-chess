import test from 'node:test';
import assert from 'node:assert/strict';
import {newClub,applyAction,calculateStats} from '../lib/chess.ts';
import {publicEventData,publicEventList} from '../lib/public-view.ts';
import {tournamentStandings} from '../lib/tournament.ts';
const admin={id:'admin',email:'private-admin@example.com',username:'private-admin',role:'owner'},manager={...admin,id:'manager',role:'manager'};
const save=(c,a,actor=admin)=>applyAction(c,{tournamentId:c.tournaments[0]?.id,...a},actor);
function fixture(mode='tournament'){
 let c=save(newClub('PRIVATE CLUB'),{type:'createSession',name:'Public Open',date:'2026-10-24',timeControl:'25 + 5',maxRounds:3,mode});
 c=save(c,{type:'importNames',mode:'new',text:'Public A\nPublic B\nPublic C\nPublic D'});
 c.members=[admin];c.audit.unshift({id:'private-log',at:'private-time',actor:'PRIVATE ACTOR',action:'private',detail:'PRIVATE AUDIT'});
 c.players.push({id:'unrelated-player-id',name:'PRIVATE OUTSIDER',initialRating:2200,createdAt:'PRIVATE CREATED'});
 c.tournaments.push({...structuredClone(c.tournaments[0]),id:'private-event-id',name:'PRIVATE TOURNAMENT',roster:['unrelated-player-id'],status:'completed',createdAt:'qa'});
 return c;
}

test('public visibility defaults off and only admins can change it, with an audit record',()=>{
 const c=fixture(),before=structuredClone(c),id=c.tournaments[0].id;
 assert.deepEqual(publicEventList(c),[]);assert.equal(publicEventData(c,id),null);
 assert.throws(()=>save(c,{type:'setPublicView',enabled:true},manager),/Only the admin/);
 assert.throws(()=>save(c,{type:'setPublicView',enabled:true},{...manager,role:'viewer'}),/Manager access/);
 for(const enabled of [undefined,null,1,'true'])assert.throws(()=>save(c,{type:'setPublicView',enabled}),/whether the session is public/);
 assert.throws(()=>save(c,{type:'setPublicView',tournamentId:'missing',enabled:true}),/Session not found/);
 assert.deepEqual(c,before);
 const next=save(c,{type:'setPublicView',enabled:true});assert.equal(next.tournaments[0].publicVisible,true);assert.deepEqual(calculateStats(next),calculateStats(c));
 assert.equal(next.audit[0].action,'setPublicView');assert.match(next.audit[0].detail,/Enabled public view/);assert.deepEqual(next.audit.slice(1),c.audit);
 assert.deepEqual(publicEventList(next),[{id,name:'Public Open',date:'2026-10-24',mode:'tournament',status:'registration'}]);
});

test('unpublished registration shows only event details, never the roster or unrelated club data',()=>{
 const c=save(fixture(),{type:'setPublicView',enabled:true}),data=publicEventData(c,c.tournaments[0].id),text=JSON.stringify(data);
 assert.deepEqual(data.rounds,[]);assert.deepEqual(data.standings,[]);
 for(const secret of ['Public A','PRIVATE','private-admin','members','audit','initialRating','ratingAdjustment','seeds','roster','withdrawn'])assert.ok(!text.includes(secret),secret);
});

test('published projection contains only selected games and ranking fields; drafts and unpaired private roster additions do not leak',()=>{
 let c=save(fixture(),{type:'publishRound'});const t=c.tournaments[0],game=t.rounds[0].games[0];
 c=save(c,{type:'result',round:1,gameId:game.id,result:'white'});c=save(c,{type:'setPublicView',enabled:true});
 c.tournaments[0].signupUrl='https://private.example/signup';
 const late={id:'late-private-id',name:'PRIVATE LATE NAME',initialRating:1500,createdAt:'private'};c.players.push(late);c.tournaments[0].roster.push(late.id);
 c.tournaments[0].rounds.push({number:2,publishedAt:'',warnings:['PRIVATE WARNING'],eligiblePlayers:[late.id],games:[{id:'private-game-id',board:1,white:late.id,black:'unrelated-player-id',result:null}]});
 const before=structuredClone(c),data=publicEventData(c,t.id),text=JSON.stringify(data);
 assert.equal(data.rounds.length,1);assert.equal(data.rounds[0].games.length,2);assert.equal(data.standings.length,4);
 assert.deepEqual(Object.keys(data.rounds[0].games[0]).sort(),['black','board','result','white']);
 const expected=tournamentStandings(c,{...c.tournaments[0],rounds:c.tournaments[0].rounds.slice(0,1),roster:c.tournaments[0].roster.filter(id=>id!==late.id)});
 assert.deepEqual(data.standings.map(p=>[p.name,p.rank,p.points,p.directEncounter,p.buchholzCut1,p.buchholz,p.sonnebornBerger,p.wins]),expected.map(p=>[p.name,p.rank,p.points,p.directEncounter,p.buchholzCut1,p.buchholz,p.sonnebornBerger,p.wins]));
 for(const secret of ['PRIVATE','private-admin','private.example','members','audit','ratingBefore','kFactor','initialRating','createdAt','eligiblePlayers','seeds','signupUrl','roster'])assert.ok(!text.includes(secret),secret);
 for(const player of c.players)assert.ok(!text.includes(player.id));assert.deepEqual(c,before);
});

test('public data refreshes from results and name changes, then disappears when disabled',()=>{
 let c=save(fixture(),{type:'publishRound'});c=save(c,{type:'setPublicView',enabled:true});const id=c.tournaments[0].id,g=c.tournaments[0].rounds[0].games[0];
 assert.equal(publicEventData(c,id).rounds[0].games[0].result,null);
 c=save(c,{type:'result',round:1,gameId:g.id,result:'draw'},manager);assert.equal(publicEventData(c,id).rounds[0].games[0].result,'draw');
 c=save(c,{type:'editName',playerId:g.white,name:'Public Corrected'});assert.equal(publicEventData(c,id).rounds[0].games[0].white,'Public Corrected');
 c=save(c,{type:'setPublicView',enabled:false});assert.deepEqual(publicEventList(c),[]);assert.equal(publicEventData(c,id),null);assert.match(c.audit[0].detail,/Disabled public view/);
});

test('weekly public standings include current ratings without exporting private rating history',()=>{
 let c=save(fixture('weekly'),{type:'publishRound'});c=save(c,{type:'setPublicView',enabled:true});
 const data=publicEventData(c,c.tournaments[0].id);assert.equal(data.mode,'weekly');assert.equal(data.standings.length,4);
 const stats=calculateStats(c);
 for(const p of data.standings){
  assert.deepEqual(Object.keys(p).sort(),['name','points','rank','rating','tied','withdrawn']);
  assert.equal(p.rating,stats[c.players.find(player=>player.name===p.name).id].rating);
 }
});

test('public ratings follow manual corrections in both modes without changing recorded games',()=>{
 for(const mode of ['weekly','tournament']){
  let c=save(fixture(mode),{type:'publishRound'});c=save(c,{type:'setPublicView',enabled:true});
  const id=c.tournaments[0].id,game=c.tournaments[0].rounds[0].games[0];
  c=save(c,{type:'result',round:1,gameId:game.id,result:'white'});
  const before=publicEventData(c,id),history=structuredClone(c.tournaments[0].rounds),player=c.players.find(p=>p.id===game.white);
  c=save(c,{type:'editRating',playerId:player.id,rating:850});
  const after=publicEventData(c,id);
  assert.equal(after.standings.find(p=>p.name===player.name).rating,850);
  assert.deepEqual(after.rounds,before.rounds);assert.deepEqual(c.tournaments[0].rounds,history);
  for(const standing of after.standings)assert.equal(standing.points,before.standings.find(p=>p.name===standing.name).points);
  for(const field of ['ratingAdjustment','initialRating','ratingBefore','history','private-admin','PRIVATE OUTSIDER'])assert.ok(!JSON.stringify(after).includes(field));
 }
});
