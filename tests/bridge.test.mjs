import {test} from 'node:test';
import assert from 'node:assert/strict';
import {bridge} from '../manager/bridge.mjs';
const config={CLUB_BACKEND_URL:'https://private.example/',CLUB_BACKEND_TOKEN:'server-token',CLUB_PROXY_KEY:'server-proxy'};
const req=(path='/api/auth',headers={},body)=>new Request('https://club.vercel.app'+path,{method:body?'POST':'GET',headers,body});
test('anonymous auth status uses only server credentials and app cookie',async()=>{
 let seen;
 const r=await bridge(req('/api/auth',{'OAI-Sites-Authorization':'attacker','oai-authenticated-user-email':'owner@example.com','cookie':'platform=secret; __Host-boardroom_session=test; other=value','x-boardroom-proxy-key':'attacker','x-boardroom-client-ip':'spoof','x-vercel-forwarded-for':'1.2.3.4','x-forwarded-for':'5.6.7.8'}),config,async(url,options)=>{seen={url,options};return Response.json({ready:true,user:null},{headers:{'Set-Cookie':'platform=secret; Path=/'}});});
 assert.equal(r.status,200);assert.equal(seen.url.href,'https://private.example/api/auth');assert.equal(seen.options.headers.get('OAI-Sites-Authorization'),'Bearer server-token');assert.equal(seen.options.headers.get('cookie'),'__Host-boardroom_session=test');assert.equal(seen.options.headers.get('oai-authenticated-user-email'),null);assert.equal(seen.options.headers.get('x-boardroom-client-ip'),'1.2.3.4');assert.equal(seen.options.headers.get('x-boardroom-proxy-key'),'server-proxy');assert.equal(r.headers.get('set-cookie'),null);
});
test('write requires same-origin JSON and is bounded even without content-length',async()=>{
 const never=()=>{throw new Error('Should not reach backend');};
 assert.equal((await bridge(req('/api/club',{origin:'https://evil.example','content-type':'application/json'},'{}'),config,never)).status,403);
 assert.equal((await bridge(req('/api/auth',{origin:'https://club.vercel.app','content-type':'application/json'},'x'.repeat(4097)),config,never)).status,413);
 assert.equal((await bridge(req('/api/club',{origin:'https://club.vercel.app','content-type':'text/plain'},'{}'),config,never)).status,415);
 assert.equal((await bridge(req('/api/club',{'content-type':'application/json'},'{}'),config,never)).status,403);
 assert.equal((await bridge(req('/api/club',{origin:'https://club.vercel.app','content-type':'application/jsonp'},'{}'),config,never)).status,415);
});

test('login retry timing is forwarded only for a numeric throttled response',async()=>{
 const r=await bridge(req(),config,async()=>Response.json({error:'Too many attempts'},{status:429,headers:{'Retry-After':'900'}}));
 assert.equal(r.status,429);assert.equal(r.headers.get('retry-after'),'900');
 const bad=await bridge(req(),config,async()=>Response.json({error:'Too many attempts'},{status:429,headers:{'Retry-After':'untrusted'}}));
 assert.equal(bad.headers.get('retry-after'),null);
});
test('app sessions and errors pass through; redirects and HTML do not',async()=>{
 const response=await bridge(req('/api/auth',{origin:'https://club.vercel.app','content-type':'application/json'},'{}'),config,async(url,options)=>{assert.equal(options.headers.get('origin'),'https://private.example');return Response.json({ok:true},{headers:{'Set-Cookie':'__Host-boardroom_session=random; Secure; HttpOnly; SameSite=Lax; Path=/'}});});
 assert.match(response.headers.get('set-cookie'),/HttpOnly/);
 assert.equal((await bridge(req('/api/club'),config,async()=>Response.json({error:'Sign in'}, {status:401}))).status,401);
 assert.equal((await bridge(req(),config,async()=>new Response('login',{status:302,headers:{Location:'https://auth.example/'}}))).status,502);
 assert.equal((await bridge(req(),config,async()=>new Response('<html>'))).status,502);
});
test('closed route set prevents forwarding arbitrary paths and queries',async()=>{
 const never=()=>{throw new Error('Unexpected fetch');};
 for(const path of ['/api/admin','/api/auth?url=https://evil.example','/signin-with-chatgpt','/api'])assert.equal((await bridge(req(path),config,never)).status,404);
});
test('Vercel rewrites preserve strict queries for the private endpoints',async()=>{
 for(const name of ['auth','club']){
  for(const path of [`/api?endpoint=${name}`,`/api/${name}?endpoint=${name}`]){
   const r=await bridge(req(path),config,async(url)=>{assert.equal(url.pathname,`/api/${name}`);return Response.json({ok:true});});
   assert.equal(r.status,200);
  }
 }
 for(const path of ['/api?endpoint=admin','/api?endpoint=auth&url=evil','/api?endpoint=auth&endpoint=club'])assert.equal((await bridge(req(path),config)).status,404);
});

test('public GET allows only the event selector and never forwards app cookies or setup keys',async()=>{
 const id='a1a1a1a1-0000-4000-8000-000000000001';
 for(const path of ['/api/public','/api?endpoint=public',`/api/public?event=${id}`,`/api?endpoint=public&event=${id}`,`/api/public?endpoint=public&event=${id}`]){
   const r=await bridge(req(path,{cookie:'__Host-boardroom_session=secret','x-boardroom-setup-key':'a'.repeat(64)}),config,async(url,options)=>{
     assert.equal(url.pathname,'/api/public');assert.equal(url.searchParams.get('event'),path.includes('event=')?id:null);
     assert.equal(options.headers.get('cookie'),null);assert.equal(options.headers.get('x-boardroom-setup-key'),null);
     assert.equal(options.headers.get('OAI-Sites-Authorization'),'Bearer server-token');
     return Response.json({events:[]},{headers:{'Set-Cookie':'__Host-boardroom_session=secret; Secure; HttpOnly; Path=/'}});
   });
   assert.equal(r.status,200);assert.equal(r.headers.get('set-cookie'),null);assert.equal(r.headers.get('cache-control'),'no-store');
 }
});

test('public writes and query tricks are rejected before reaching the private backend',async()=>{
 const never=()=>{throw new Error('Unexpected public write');},id='a1a1a1a1-0000-4000-8000-000000000001';
 for(const method of ['POST','PUT','PATCH','DELETE','HEAD']){
   const r=await bridge(new Request('https://club.vercel.app/api/public',{method}),config,never);assert.equal(r.status,405);assert.equal(r.headers.get('allow'),'GET');
 }
 for(const path of ['/api/public?url=https://evil.example','/api/public?event=bad',`/api/public?event=${id}&event=${id}`,`/api/public?event=${id}&extra=1`,'/api?endpoint=public&endpoint=public','/api/club?endpoint=public'])assert.equal((await bridge(req(path),config,never)).status,404);
});
