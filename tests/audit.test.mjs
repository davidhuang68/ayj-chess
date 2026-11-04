import test from 'node:test';
import assert from 'node:assert/strict';
import {newClub,applyAction,calculateStats} from '../lib/chess.ts';
import {clubForMember} from '../lib/club-view.ts';
const admin={id:'admin',email:'admin@example.com',username:'david',role:'owner'};
const manager={id:'manager',email:'manager@boardroom.local',username:'manager',role:'manager'};
function fixture(){
 let c=newClub();c.members=[admin,manager];
 c=applyAction(c,{type:'createSession',name:'QA',date:'2026-10-15',timeControl:'10 min'},manager);
 return applyAction(c,{type:'importNames',tournamentId:c.tournaments[0].id,text:'Private Deleted Name\nOther Player'},manager);
}
test('only admin sees logs and memberships; managers exclude audit details and outsiders are denied',()=>{
 const c=fixture(),before=structuredClone(c),visible=clubForMember(c,admin);
 assert.deepEqual(visible.audit,c.audit);assert.deepEqual(visible.members,c.members);
 for(const actor of [manager]){
   const view=clubForMember(c,actor);assert.deepEqual(view.audit,[]);assert.deepEqual(view.members,[]);
   assert.deepEqual(view.players,c.players);assert.deepEqual(view.tournaments,c.tournaments);
 }
 for(const actor of [undefined,{...manager,role:'viewer'},{...admin,id:'outsider'},{...manager,role:'owner'}])assert.throws(()=>clubForMember(c,actor),/Manager access required/);
 assert.deepEqual(c,before);
});
test('player deletion records exact name, authenticated manager, and timestamp without changing other ratings',()=>{
 const c=fixture(),p=c.players[0],stats=calculateStats(c),next=applyAction(c,{type:'deletePlayer',playerId:p.id,confirm:true},manager);
 const entry=next.audit[0];assert.equal(entry.action,'deletePlayer');assert.equal(entry.actor,'manager');assert.ok(Number.isFinite(Date.parse(entry.at)));assert.ok(entry.detail.includes(p.name));
 assert.deepEqual(calculateStats(next)[next.players[0].id],stats[next.players[0].id]);
 assert.ok(clubForMember(next,admin).audit.some(a=>a.detail.includes(p.name)));
 assert.ok(!JSON.stringify(clubForMember(next,manager)).includes(p.name));
 assert.equal(next.audit.length,c.audit.length+1);
});
test('admin actions use david as actor; invalid/unconfirmed deletions create no audit entries',()=>{
 const c=fixture(),before=structuredClone(c),id=c.players[0].id;
 for(const action of [{type:'deletePlayer',playerId:id},{type:'deletePlayer',playerId:'missing',confirm:true}])assert.throws(()=>applyAction(c,action,admin));
 assert.deepEqual(c,before);
 const next=applyAction(c,{type:'deletePlayer',playerId:id,confirm:true},admin);assert.equal(next.audit[0].actor,'david');
});
