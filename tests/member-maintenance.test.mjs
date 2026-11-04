import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {DatabaseSync} from 'node:sqlite';
import {removeConfiguredManager,clearConfiguredPlayerData,clearConfiguredSessionData} from '../lib/member-maintenance.ts';
import {calculateStats,demoClub,applyAction} from '../lib/chess.ts';
function fixture(){
 const sql=new DatabaseSync(':memory:');sql.exec('PRAGMA foreign_keys=ON;');
 for(const path of ['0000_sleepy_madame_hydra.sql','0001_fuzzy_forgotten_one.sql','0002_regular_living_tribunal.sql'])sql.exec(fs.readFileSync(new URL('../drizzle/'+path,import.meta.url),'utf8'));
 const club={name:'QA',startingRating:1000,kFactor:32,players:[{id:'player',name:'Keep player',initialRating:1000}],tournaments:[{id:'history',status:'completed',rounds:[]}],members:[{id:'admin',email:'admin@example.com',role:'owner'},{id:'target',email:'former-manager@example.com',role:'manager'},{id:'other',email:'other@example.com',role:'manager'}],audit:[]};
 sql.prepare('INSERT INTO club_state VALUES (?,?,?,?)').run('main',7,JSON.stringify(club),'before');
 for(const id of ['admin','target','other']){sql.prepare('INSERT INTO auth_accounts VALUES (?,?,?,?,?,?)').run(id,id,id,'local-placeholder',0,1);sql.prepare('INSERT INTO auth_sessions VALUES (?,?,?)').run(id,id,9999999999999);}
 const db={prepare(query){return {bind(...args){return {async first(){return sql.prepare(query).get(...args)??null;},async run(){return {meta:{changes:sql.prepare(query).run(...args).changes}};}};}};},async batch(statements){sql.exec('BEGIN');try{const result=[];for(const statement of statements)result.push(await statement.run());sql.exec('COMMIT');return result;}catch(e){sql.exec('ROLLBACK');throw e;}}};
 return {sql,db,club};
}
test('configured player reset clears only chess data, preserves accounts/settings, and runs once',async()=>{
 const {sql,db,club}=fixture();const accounts=sql.prepare('SELECT * FROM auth_accounts').all(),sessions=sql.prepare('SELECT * FROM auth_sessions').all();
 club.audit=[{id:'earlier',at:'2026-10-15T12:00:00Z',actor:'david',action:'createSession',detail:'Earlier entry'}];sql.prepare("UPDATE club_state SET document=? WHERE id='main'").run(JSON.stringify(club));
 for(const version of [undefined,'','invalid','6'])assert.equal(await clearConfiguredPlayerData(db,version),false);
 assert.equal(await clearConfiguredPlayerData(db,'7'),true);const row=sql.prepare('SELECT * FROM club_state').get(),next=JSON.parse(row.document);
 assert.equal(row.version,8);assert.deepEqual(next.players,[]);assert.deepEqual(next.tournaments,[]);assert.deepEqual(next.members,club.members);assert.equal(next.kFactor,club.kFactor);assert.equal(next.startingRating,club.startingRating);assert.equal(next.name,club.name);
 assert.deepEqual(next.audit.slice(1),club.audit);assert.equal(next.audit[0].action,'clearPlayers');for(const player of club.players)assert.ok(next.audit[0].detail.includes(player.name));
 assert.deepEqual(sql.prepare('SELECT * FROM auth_accounts').all(),accounts);assert.deepEqual(sql.prepare('SELECT * FROM auth_sessions').all(),sessions);
 assert.equal(await clearConfiguredPlayerData(db,'7'),false);assert.equal(sql.prepare('SELECT version FROM club_state').get().version,8);sql.close();
});
test('concurrent club edits prevent the configured reset from overwriting them',async()=>{
 const {sql,db,club}=fixture(),original=db.prepare;db.prepare=query=>{const statement=original(query);if(!query.startsWith('UPDATE'))return statement;return {bind(...args){const bound=statement.bind(...args);return {async run(){sql.exec("UPDATE club_state SET document=json_set(document,'$.name','Concurrent club'),version=version+1 WHERE id='main'");return bound.run();}};}};};
 assert.equal(await clearConfiguredPlayerData(db,'7'),false);const next=JSON.parse(sql.prepare('SELECT document FROM club_state').get().document);assert.deepEqual(next.players,club.players);assert.deepEqual(next.tournaments,club.tournaments);assert.equal(next.name,'Concurrent club');sql.close();
});

test('session-only reset preserves every current rating, profile, account, setting and prior audit entry',async()=>{
 const {sql,db}=fixture();let club=demoClub();
 club=applyAction(club,{type:'editRating',playerId:club.players[0].id,rating:2000},{id:'admin',email:'admin@example.com',role:'owner'});
 club.members=[{id:'admin',email:'admin@example.com',role:'owner'}];
 club.audit=[{id:'earlier',at:'2026-10-15T12:00:00Z',actor:'david',action:'createSession',detail:'Earlier entry'}];
 const ratings=calculateStats(club),profiles=structuredClone(club.players),audit=structuredClone(club.audit);
 sql.prepare("UPDATE club_state SET document=? WHERE id='main'").run(JSON.stringify(club));
 const accounts=sql.prepare('SELECT * FROM auth_accounts').all(),sessions=sql.prepare('SELECT * FROM auth_sessions').all();
 for(const version of [undefined,'','invalid','6'])assert.equal(await clearConfiguredSessionData(db,version),false);
 assert.equal(await clearConfiguredSessionData(db,'7'),true);
 const row=sql.prepare('SELECT * FROM club_state').get(),next=JSON.parse(row.document),after=calculateStats(next);
 assert.equal(row.version,8);assert.deepEqual(next.tournaments,[]);assert.equal(next.players.length,profiles.length);
 for(const player of next.players){assert.equal(after[player.id].rating,ratings[player.id].rating);assert.equal(player.ratingAdjustment,undefined);const original=profiles.find(p=>p.id===player.id);const {ratingAdjustment,...profile}=original;assert.deepEqual({...player,initialRating:original.initialRating},profile);}
 assert.deepEqual(next.members,club.members);assert.equal(next.kFactor,club.kFactor);assert.equal(next.startingRating,club.startingRating);assert.equal(next.name,club.name);
 assert.deepEqual(next.audit.slice(1),audit);assert.equal(next.audit[0].action,'clearSessions');
 assert.deepEqual(sql.prepare('SELECT * FROM auth_accounts').all(),accounts);assert.deepEqual(sql.prepare('SELECT * FROM auth_sessions').all(),sessions);
 assert.equal(await clearConfiguredSessionData(db,'7'),false);sql.close();
});

test('concurrent edits block session deletion without changing ratings or history',async()=>{
 const {sql,db,club}=fixture(),original=db.prepare;
 db.prepare=query=>{const statement=original(query);if(!query.startsWith('UPDATE'))return statement;return {bind(...args){const bound=statement.bind(...args);return {async run(){sql.exec("UPDATE club_state SET document=json_set(document,'$.name','Concurrent club'),version=version+1 WHERE id='main'");return bound.run();}};}};};
 assert.equal(await clearConfiguredSessionData(db,'7'),false);
 const next=JSON.parse(sql.prepare('SELECT document FROM club_state').get().document);assert.deepEqual(next.players,club.players);assert.deepEqual(next.tournaments,club.tournaments);assert.deepEqual(next.audit,club.audit);sql.close();
});
test('configured removal revokes only matching manager and preserves admin, other users, players and history',async()=>{
 const {sql,db,club}=fixture();await removeConfiguredManager(db,'former-manager@example.com');const row=sql.prepare('SELECT * FROM club_state').get();const next=JSON.parse(row.document);assert.equal(row.version,8);assert.deepEqual(next.members.map(m=>m.id),['admin','other']);assert.deepEqual(next.players,club.players);assert.deepEqual(next.tournaments,club.tournaments);assert.deepEqual(sql.prepare('SELECT id FROM auth_accounts ORDER BY id').all().map(a=>a.id),['admin','other']);assert.deepEqual(sql.prepare('SELECT account_id FROM auth_sessions ORDER BY account_id').all().map(a=>a.account_id),['admin','other']);await removeConfiguredManager(db,'former-manager@example.com');assert.equal(sql.prepare('SELECT version FROM club_state').get().version,8);await removeConfiguredManager(db,'admin@example.com');assert.ok(sql.prepare("SELECT id FROM auth_accounts WHERE id='admin'").get());sql.close();
});
test('concurrent save blocks the repair without revoking access; retry preserves that save',async()=>{
 const {sql,db}=fixture();const original=db.batch;let raced=false;db.batch=async statements=>{if(!raced){raced=true;sql.exec("UPDATE club_state SET document=json_set(document,'$.name','Concurrent club'),version=version+1 WHERE id='main'");}return original(statements);};await removeConfiguredManager(db,'former-manager@example.com');assert.ok(sql.prepare("SELECT id FROM auth_accounts WHERE id='target'").get());assert.ok(sql.prepare("SELECT account_id FROM auth_sessions WHERE account_id='target'").get());await removeConfiguredManager(db,'former-manager@example.com');assert.equal(JSON.parse(sql.prepare('SELECT document FROM club_state').get().document).name,'Concurrent club');assert.equal(sql.prepare("SELECT id FROM auth_accounts WHERE id='target'").get(),undefined);sql.close();
});
