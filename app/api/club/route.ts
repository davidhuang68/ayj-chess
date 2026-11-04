import { env } from 'cloudflare:workers';
import { currentUser, userMember, type ClubUser } from '@/lib/password-auth';
import { newClub, applyAction, type Club, type Action } from '@/lib/chess';
import { INITIAL_OWNER_EMAIL } from '@/lib/server-config';
import { clubForMember } from '@/lib/club-view';
import {readJsonRequest,RequestError} from '@/lib/request-security';
import {sheetSyncStatus} from '@/lib/sheets-sync';

export const dynamic = 'force-dynamic';
function json(data: unknown,status=200) { return Response.json(data,{status,headers:{'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}}); }
async function read() { if(!env.DB)throw new Error('Database is not connected.');return env.DB.prepare('SELECT version, document FROM club_state WHERE id = ?').bind('main').first<{version:number;document:string}>(); }
function allowedInitial(email:string,url:string) { const local=['localhost','127.0.0.1','[::1]'].includes(new URL(url).hostname);return [INITIAL_OWNER_EMAIL,...(local?['seedy@sites.test']:[])].includes(email.toLowerCase()); }
function memberFor(club:Club,user:ClubUser|null) { return userMember(club,user); }
async function response(club:Club,version:number,user:ClubUser|null) {
  const member=memberFor(club,user);
  if(!member)throw new RequestError('Your account does not have manager access.',403);
  return {club:clubForMember(club,member),version,user:user?{email:user.email,name:user.displayName,role:member?.role??'viewer'}:null,setupRequired:false,canInitialize:false,
    ...(member.role==='owner'?{sheetSync:await sheetSyncStatus(env.DB!,!!env.SHEETS_SYNC_KEY_HASH,version)}:{})};
}
export async function GET(request:Request) {
  try{const user=await currentUser(request);if(!user)return json({error:'Sign in to view this club.',club:null,user:null,authRequired:true},401);const row=await read();if(!row)return json({club:null,version:0,user:{email:user.email,name:user.displayName,role:user.role},setupRequired:true,canInitialize:allowedInitial(user.email,request.url)});return json(await response(JSON.parse(row.document),row.version,user));}
  catch(e){if(e instanceof RequestError)return json({error:e.message},e.status);console.error('Club read failed',e instanceof Error?e.message:'unknown');return json({error:'Could not load the club. Please try again.'},503);}
}
export async function POST(request:Request) {
  try{
    const body=await readJsonRequest(request,64000) as {version:number;action:Action};
    const user=await currentUser(request);if(!user)return json({error:'Sign in to manage the club.'},401);
    let row=await read();
    if(!row){
      if(body.action?.type!=='initialize'||!allowedInitial(user.email,request.url))return json({error:'Only the admin can set up the club.'},403);
      const club=newClub(typeof body.action.name==='string'?body.action.name.trim().slice(0,80)||'Chess Club':'Chess Club');
      club.members=[{id:crypto.randomUUID(),email:INITIAL_OWNER_EMAIL,role:'owner'}];
      // Development identity is supplied only by the starter's loopback-only mock.
      if(user.email==='seedy@sites.test'&&['localhost','127.0.0.1','[::1]'].includes(new URL(request.url).hostname))club.members.push({id:crypto.randomUUID(),email:user.email,userId:user.userId,role:'owner'});
      const m=memberFor(club,user);if(m)m.userId=user.userId;
      const result=await env.DB!.prepare('INSERT OR IGNORE INTO club_state (id, version, document, updated_at) VALUES (?, ?, ?, ?)').bind('main',1,JSON.stringify(club),new Date().toISOString()).run();
      if(!result.meta.changes)return json({error:'Another manager already created the club. Refresh to continue.'},409);
      return json(await response(club,1,user));
    }
    if(!Number.isInteger(body.version)||body.version!==row.version)return json({error:'Another manager changed the club. The latest version has been loaded; review it and try again.'},409);
    const club=JSON.parse(row.document) as Club;const member=memberFor(club,user);if(!member)return json({error:'Your account does not have manager access.'},403);
    if(!body.action||typeof body.action.type!=='string')return json({error:'Invalid action.'},400);
    const next=applyAction(club,body.action,{...member,username:user!.displayName});
    const result=await env.DB!.prepare('UPDATE club_state SET document = ?, version = version + 1, updated_at = ? WHERE id = ? AND version = ?').bind(JSON.stringify(next),new Date().toISOString(),'main',row.version).run();
    if(!result.meta.changes)return json({error:'Another manager saved first. Refresh and try again.'},409);
    return json(await response(next,row.version+1,user));
  }catch(e){if(e instanceof RequestError)return json({error:e.message},e.status);const message=e instanceof Error?e.message:'Unable to save.';if(/D1_|SQLITE|database|binding/i.test(message)){console.error('Club write failed',message);return json({error:'The database is temporarily unavailable. Your change was not saved.'},503);}return json({error:message},400);}
}
