import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readJsonRequest,RequestError} from '../lib/request-security.ts';
import {checkLoginAttempts,checkPasswordAttempts,LoginLimitError,LOGIN_WINDOW_MS} from '../lib/login-throttle.ts';
import {csvCell} from '../lib/csv.ts';
import {changePasswordIfCurrent} from '../lib/account-security.ts';

const origin='https://club.example';
const request=(body,headers={})=>new Request(origin+'/api/auth',{method:'POST',headers:{origin,'content-type':'application/json',...headers},body});
const errorStatus=status=>error=>error instanceof RequestError&&error.status===status;
test('writes require exact same origin, JSON media type, and an object',async()=>{
  assert.deepEqual(await readJsonRequest(request('{"action":"login"}',{'content-type':'Application/JSON; charset=utf-8'}),100),{action:'login'});
  for(const value of ['https://evil.example','null',''])await assert.rejects(readJsonRequest(request('{}',{origin:value}),100),errorStatus(403));
  for(const type of ['text/plain','text/application/json','application/jsonp','application/json-extra'])await assert.rejects(readJsonRequest(request('{}',{'content-type':type}),100),errorStatus(415));
  for(const text of ['null','[]','"string"','{bad'])await assert.rejects(readJsonRequest(request(text),100),errorStatus(400));
});
test('limits count UTF-8 bytes and cancel oversized streaming requests before JSON parsing',async()=>{
  await assert.rejects(readJsonRequest(request(JSON.stringify({name:'🦊'.repeat(10)})),30),errorStatus(413));
  let canceled=false;
  const stream=new ReadableStream({pull(controller){controller.enqueue(new Uint8Array(40));},cancel(){canceled=true;}});
  const r=new Request(origin+'/api/auth',{method:'POST',headers:{origin,'content-type':'application/json'},body:stream,duplex:'half'});
  await assert.rejects(readJsonRequest(r,30),errorStatus(413));assert.equal(canceled,true);
  await assert.rejects(readJsonRequest(request('{}',{'content-length':'999'}),30),errorStatus(413));
});
function database(){
  const sql=new DatabaseSync(':memory:');sql.exec('CREATE TABLE auth_attempts (key TEXT PRIMARY KEY,count INTEGER NOT NULL,window_start INTEGER NOT NULL)');
  const db={prepare(query){return {bind(...args){return {async first(){return sql.prepare(query).get(...args)??null;},async run(){return {meta:{changes:sql.prepare(query).run(...args).changes}};}};}};}};
  return {sql,db};
}
test('username throttling spans IPs and resets only after the full rolling window',async()=>{
  const {sql,db}=database(),start=LOGIN_WINDOW_MS-100;
  for(let i=0;i<8;i++)await checkLoginAttempts(db,'ip-'+i,'same-user',start+i);
  await assert.rejects(checkLoginAttempts(db,'other-ip','same-user',start+200),error=>error instanceof LoginLimitError&&error.retryAfter>890);
  await checkLoginAttempts(db,'other-ip','same-user',start+LOGIN_WINDOW_MS+201);
  assert.ok(sql.prepare('SELECT COUNT(*) AS count FROM auth_attempts').get().count<=3);sql.close();
});
test('IP throttling stops new username allocation and counter growth',async()=>{
  const {sql,db}=database(),start=10000000;
  for(let i=0;i<30;i++)await checkLoginAttempts(db,'shared-ip','user-'+i,start);
  const before=sql.prepare('SELECT COUNT(*) AS count FROM auth_attempts').get().count;
  for(let i=30;i<60;i++)await assert.rejects(checkLoginAttempts(db,'shared-ip','user-'+i,start),LoginLimitError);
  assert.equal(sql.prepare('SELECT COUNT(*) AS count FROM auth_attempts').get().count,before);
  assert.equal(sql.prepare('SELECT MAX(count) AS count FROM auth_attempts').get().count,31);sql.close();
});
test('current password guessing is throttled independently per authenticated account',async()=>{
  const {sql,db}=database(),start=10000000;
  for(let i=0;i<8;i++)await checkPasswordAttempts(db,'account-a',start);
  await assert.rejects(checkPasswordAttempts(db,'account-a',start),LoginLimitError);
  await checkPasswordAttempts(db,'account-b',start);
  await checkPasswordAttempts(db,'account-a',start+LOGIN_WINDOW_MS);sql.close();
});
test('CSV exports neutralize spreadsheet formulas while preserving ordinary names and escaping quotes',()=>{
  assert.equal(csvCell('Alex Xu'),'"Alex Xu"');assert.equal(csvCell('A "Nickname" B'),'"A ""Nickname"" B"');
  assert.equal(csvCell(-16),'"-16"');
  for(const text of ['=1+1','+SUM(1,2)','-1+2','@SUM(A1:A2)',' \t=HYPERLINK("https://example.com")','\r\n=1+1'])assert.ok(csvCell(text).startsWith('"\''));
});

test('stale password changes cannot overwrite a newer password or revoke its new session',async()=>{
  const sql=new DatabaseSync(':memory:');sql.exec("CREATE TABLE auth_accounts (id TEXT,password_hash TEXT,active INTEGER); CREATE TABLE auth_sessions (account_id TEXT); INSERT INTO auth_accounts VALUES ('manager','old-hash',1); INSERT INTO auth_sessions VALUES ('manager')");
  const db={prepare(query){return {bind(...args){return {async run(){return {meta:{changes:sql.prepare(query).run(...args).changes}};}};}};},async batch(statements){sql.exec('BEGIN');try{const results=[];for(const s of statements)results.push(await s.run());sql.exec('COMMIT');return results;}catch(e){sql.exec('ROLLBACK');throw e;}}};
  assert.equal(await changePasswordIfCurrent(db,'manager','old-hash','new-hash'),true);
  assert.equal(sql.prepare('SELECT COUNT(*) AS count FROM auth_sessions').get().count,0);
  sql.exec("INSERT INTO auth_sessions VALUES ('manager')");
  assert.equal(await changePasswordIfCurrent(db,'manager','old-hash','stale-hash'),false);
  assert.equal(sql.prepare('SELECT password_hash FROM auth_accounts').get().password_hash,'new-hash');
  assert.equal(sql.prepare('SELECT COUNT(*) AS count FROM auth_sessions').get().count,1);
  sql.exec('UPDATE auth_accounts SET active=0');
  assert.equal(await changePasswordIfCurrent(db,'manager','new-hash','disabled-hash'),false);sql.close();
});
