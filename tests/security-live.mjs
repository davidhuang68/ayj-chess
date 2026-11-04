// Bounded, non-destructive production checks. No login guesses or valid mutations.
import assert from 'node:assert/strict';
const base='https://ayjchess.vercel.app';
const checks=[];
async function check(path,status,options={}){
  const r=await fetch(base+path,{redirect:'manual',...options});assert.equal(r.status,status,`${options.method??'GET'} ${path}`);
  checks.push({path,method:options.method??'GET',status:r.status});return r;
}
const page=await check('/',200),html=await page.text();assert.ok(html.includes('/assets/index-'));
for(const [name,part] of [['content-security-policy',"object-src 'none'"],['x-frame-options','DENY'],['strict-transport-security','max-age='],['permissions-policy','camera=()'],['cross-origin-opener-policy','same-origin']])assert.ok(page.headers.get(name)?.includes(part),name);
await check('/manage',200);
await check('/api/club',401);
await check('/api/ratings-sync',401);
await check('/api/ratings-sync',401,{headers:{Authorization:'Bearer '+'a'.repeat(64)}});
await check('/api/ratings-sync?token=not-a-key',404);
await check('/api/ratings-sync',401,{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+'a'.repeat(64)},body:'{"version":1,"status":"synced"}'});
await check('/api/club',401,{headers:{Cookie:'__Host-boardroom_session='+'a'.repeat(64),'oai-authenticated-user-email':'admin@example.com','x-boardroom-proxy-key':'forged','x-boardroom-client-ip':'1.2.3.4'}});
const auth=await (await check('/api/auth',200)).json();assert.equal(auth.ready,true);assert.equal(auth.user,null);assert.deepEqual(auth.accounts,[]);
const pubResponse=await check('/api/public',200);assert.equal(pubResponse.headers.get('cache-control'),'no-store');assert.equal(pubResponse.headers.get('set-cookie'),null);
const pub=await pubResponse.json();assert.deepEqual(Object.keys(pub),['events']);
for(const event of pub.events)assert.deepEqual(Object.keys(event).sort(),['date','id','mode','name','status']);
if(pub.events.length){
  const response=await check('/api/public?event='+pub.events[0].id,200),{event}=await response.json();
  assert.deepEqual(Object.keys(event).sort(),['date','id','maxRounds','mode','name','rounds','standings','status','timeControl']);
  for(const round of event.rounds)for(const game of round.games)assert.deepEqual(Object.keys(game).sort(),['black','board','result','white']);
  for(const row of event.standings){assert.ok(Number.isInteger(row.rating));for(const key of Object.keys(row))assert.ok(['rank','tied','name','rating','points','withdrawn','directEncounter','buchholzCut1','buchholz','sonnebornBerger','wins'].includes(key));}
}
await check('/api/public',405,{method:'POST'});
await check('/api/public?event=bad',404);
await check('/api/auth?url=https://example.com',404);
await check('/api/admin',404);
await check('/api/club',403,{method:'POST',headers:{'Content-Type':'application/json',Origin:'https://example.com'},body:'{}'});
await check('/api/auth',415,{method:'POST',headers:{'Content-Type':'application/jsonp',Origin:base},body:'{}'});
await check('/api/club',401,{method:'POST',headers:{'Content-Type':'application/json',Origin:base},body:JSON.stringify({version:0,action:{type:'settings',name:'Security probe must never save',startingRating:1000,kFactor:32}})});
console.log(JSON.stringify({passed:checks.length,publicEvents:pub.events.length,checks}));
