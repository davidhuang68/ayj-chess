import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {newClub,demoClub,calculateStats,applyAction} from '../lib/chess.ts';
import {hashToken} from '../lib/password.ts';
import {ratingsSnapshot,validRatingsSyncKey,sheetSyncStatus,recordSheetSync,RATINGS_SPREADSHEET_ID} from '../lib/sheets-sync.ts';
import {bridge} from '../manager/bridge.mjs';

function database(){
 const sql=new DatabaseSync(':memory:');
 sql.exec('CREATE TABLE club_state (id TEXT PRIMARY KEY, version INTEGER NOT NULL, document TEXT NOT NULL, updated_at TEXT NOT NULL)');
 sql.prepare('INSERT INTO club_state VALUES (?, ?, ?, ?)').run('main',10,JSON.stringify(newClub()),'2026-11-03T10:00:00Z');
 const db={prepare(query){return {bind(...args){return {async first(){return sql.prepare(query).get(...args)??null;},async run(){return {meta:{changes:sql.prepare(query).run(...args).changes}};}};}};}};
 return {sql,db};
}
test('ratings export mirrors current Elo with stable IDs and only approved player fields',()=>{
 let club=demoClub();
 const actor={id:'owner',email:'private@example.com',username:'admin',role:'owner'};
 const id=club.players[0].id;
 club=applyAction(club,{type:'editRating',playerId:id,rating:2200},actor);
 club.players[0].name='Renamed player';
 const original=structuredClone(club),stats=calculateStats(club),snapshot=ratingsSnapshot(club,10,'2026-11-03T10:00:00Z');
 assert.equal(snapshot.spreadsheetId,RATINGS_SPREADSHEET_ID);
 assert.equal(snapshot.players.length,club.players.length);
 assert.deepEqual(snapshot.players.find(p=>p.id===id),{id,name:'Renamed player',rating:2200,games:stats[id].games,wins:stats[id].wins,draws:stats[id].draws,losses:stats[id].losses});
 assert.ok(snapshot.players.every((p,i)=>!i||snapshot.players[i-1].rating>=p.rating));
 assert.ok(snapshot.players.every(p=>Object.keys(p).sort().join(',')==='draws,games,id,losses,name,rating,wins'));
 assert.ok(!JSON.stringify(snapshot).includes(actor.email));assert.deepEqual(club,original);
 club=applyAction(club,{type:'deletePlayer',playerId:id,confirm:true},actor);
 assert.ok(!ratingsSnapshot(club,11,'2026-11-03T10:00:00Z').players.some(p=>p.id===id));
});
test('ratings key must match the secret hash and exact header shape',async()=>{
 const key='a'.repeat(64),hash=await hashToken(key);
 assert.equal(await validRatingsSyncKey('Bearer '+key,hash),true);
 for(const header of [null,key,'Bearer '+hash,'Bearer '+'b'.repeat(64),'bearer '+key,'Bearer '+key+' extra'])assert.equal(await validRatingsSyncKey(header,hash),false);
 assert.equal(await validRatingsSyncKey('Bearer '+key,undefined),false);
});
test('receipts are monotonic, independent of chess saves, and expose useful health',async()=>{
 const {sql,db}=database(),main=sql.prepare("SELECT * FROM club_state WHERE id='main'").get();
 const time='2026-11-03T10:00:00Z',later='2026-11-03T10:01:00Z';
 assert.equal((await sheetSyncStatus(db,false,10)).status,'not_connected');
 assert.equal((await sheetSyncStatus(db,true,10)).status,'pending');
 await recordSheetSync(db,{version:9,status:'synced'},10,time);
 assert.equal((await sheetSyncStatus(db,true,10,Date.parse(time))).status,'pending');
 await recordSheetSync(db,{version:10,status:'synced'},10,later);
 await recordSheetSync(db,{version:9,status:'error',code:'sheet_update_failed'},10,time);
 let state=await sheetSyncStatus(db,true,10,Date.parse(later));
 assert.equal(state.status,'synced');assert.equal(state.lastSyncedAt,later);
 await recordSheetSync(db,{version:10,status:'synced'},10,'2026-11-03T10:02:00Z');
 state=await sheetSyncStatus(db,true,10,Date.parse(later));
 assert.equal(state.lastSyncedAt,later);assert.equal(state.lastCheckedAt,'2026-11-03T10:02:00Z');
 assert.equal((await sheetSyncStatus(db,true,10,Date.parse('2026-11-03T10:13:00Z'))).status,'stale');
 await recordSheetSync(db,{version:10,status:'error',code:'sheet_update_failed'},10,later);
 state=await sheetSyncStatus(db,true,10,Date.parse(later));
 assert.equal(state.status,'error');assert.equal(state.lastSyncedVersion,10);
 assert.deepEqual(sql.prepare("SELECT * FROM club_state WHERE id='main'").get(),main);
 sql.close();
});
test('invalid receipt data cannot change either database row',async()=>{
 const {sql,db}=database();
 for(const input of [null,[],{version:11,status:'synced'},{version:0,status:'synced'},{version:1.5,status:'synced'},
  {version:1,status:'error',code:'anything'},{version:1,status:'synced',action:'deletePlayer'},{version:1,status:'other'}])await assert.rejects(recordSheetSync(db,input,10));
 assert.equal(sql.prepare('SELECT COUNT(*) n FROM club_state').get().n,1);sql.close();
});
test('sync proxy requires a bearer key, strips cookies and isolates service requests',async()=>{
 const config={CLUB_BACKEND_URL:'https://private.example/',CLUB_BACKEND_TOKEN:'server-token',CLUB_PROXY_KEY:'server-proxy'};
 const key='a'.repeat(64),headers={authorization:'Bearer '+key,'content-type':'application/json',cookie:'__Host-boardroom_session=private'};
 const never=()=>assert.fail('Must not reach upstream');
 assert.equal((await bridge(new Request('https://club.example/api/ratings-sync'),config,never)).status,401);
 assert.equal((await bridge(new Request('https://club.example/api/ratings-sync?token='+key,{headers}),config,never)).status,404);
 assert.equal((await bridge(new Request('https://club.example/api/ratings-sync',{method:'POST',headers,body:'x'.repeat(1025)}),config,never)).status,413);
 for(const path of ['/api/ratings-sync','/api?endpoint=ratings-sync']){
  const response=await bridge(new Request('https://club.example'+path,{method:'POST',headers,body:'{"version":1,"status":"synced"}'}),config,async(url,options)=>{
   assert.equal(url.href,'https://private.example/api/ratings-sync');assert.equal(options.headers.get('authorization'),'Bearer '+key);
   assert.equal(options.headers.get('cookie'),null);assert.equal(options.headers.get('origin'),'https://private.example');
   return Response.json({ok:true},{headers:{'Set-Cookie':'__Host-boardroom_session=private; Secure; Path=/'}});
  });
  assert.equal(response.status,200);assert.equal(response.headers.get('set-cookie'),null);
 }
 assert.equal((await bridge(new Request('https://club.example/api/club',{method:'POST',headers,body:'{}'}),config,never)).status,403);
 await bridge(new Request('https://club.example/api/auth',{headers}),config,async(url,options)=>{
  assert.equal(options.headers.get('authorization'),null);return Response.json({user:null});
 });
});
