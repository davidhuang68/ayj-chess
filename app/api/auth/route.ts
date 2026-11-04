import { getChatGPTUser } from '@/app/chatgpt-auth';
import { env } from 'cloudflare:workers';
import { INITIAL_OWNER_EMAIL } from '@/lib/server-config';
import { newClub, type Club, type Member } from '@/lib/chess';
import { database, clubDocument, accountsReady, currentUser, userMember, issueSession, rateLimit } from '@/lib/password-auth';
import { hashPassword, verifyPassword, normalizeUsername, tokenFromCookie, hashToken, sessionCookie, validSetupKey } from '@/lib/password';
import {readJsonRequest,RequestError} from '@/lib/request-security';
import {checkPasswordAttempts,LoginLimitError} from '@/lib/login-throttle';
import {changePasswordIfCurrent} from '@/lib/account-security';

export const dynamic='force-dynamic';
const dummyHash='$2b$10$N9qo8uLOickgx2ZMRZoMyeIjZAgcfl7p92ldGxad68LJZdL17lhWy';
function json(data:unknown,status=200,cookie?:string,retryAfter?:number) { return Response.json(data,{status,headers:{'Cache-Control':'no-store','X-Content-Type-Options':'nosniff',...(cookie?{'Set-Cookie':cookie}:{}),...(retryAfter?{'Retry-After':String(retryAfter)}:{})}}); }
async function initialOwner(request:Request) {
  if(env.OWNER_SETUP_KEY_HASH){
    if(!await validSetupKey(request.headers.get('x-boardroom-setup-key'),env.OWNER_SETUP_KEY_HASH,env.OWNER_SETUP_KEY_EXPIRES_AT))return null;
    return {userId:'owner-setup',email:INITIAL_OWNER_EMAIL,displayName:'Admin',fullName:null};
  }
  const identity=await getChatGPTUser();if(!identity)return null;
  const local=['localhost','127.0.0.1','[::1]'].includes(new URL(request.url).hostname);
  if(identity.email.toLowerCase()!==INITIAL_OWNER_EMAIL&&!(local&&identity.email==='seedy@sites.test'))return null;
  return identity;
}
async function status(request:Request) {
  const [ready,user]=await Promise.all([accountsReady(),currentUser(request)]);
  const setupAllowed=!ready&&!!await initialOwner(request);
  return {ready,setupAllowed,setupKeyRequired:!!env.OWNER_SETUP_KEY_HASH&&!ready,user:user?{name:user.displayName,role:user.role}:null};
}
export async function GET(request:Request) {
  try{
    await clubDocument();const data=await status(request);const user=await currentUser(request);
    let accounts:unknown[]=[];
    if(user?.role==='owner')accounts=(await database().prepare('SELECT id, username, member_id, active FROM auth_accounts ORDER BY username').all()).results;
    return json({...data,accounts});
  }catch{return json({error:'Could not connect to the account service. Please try again.'},503);}
}
export async function POST(request:Request) {
  try{
    const body=await readJsonRequest(request,4096) as {action:string;username?:unknown;password?:unknown;oldPassword?:unknown;memberId?:string;accountId?:string;active?:boolean};
    if(typeof body.action!=='string')return json({error:'Invalid account action.'},400);
    if(body.action==='login'){
      const username=normalizeUsername(body.username);await rateLimit(request,username);
      const account=await database().prepare('SELECT id, member_id, password_hash, active FROM auth_accounts WHERE username = ?').bind(username).first<{id:string;member_id:string;password_hash:string;active:number}>();
      const valid=await verifyPassword(body.password,account?.password_hash??dummyHash);
      const document=await clubDocument();
      if(!account||!account.active||!valid||!document?.club.members.some(m=>m.id===account.member_id))return json({error:'Incorrect username or password.'},401);
      return json({ok:true},200,await issueSession(request,account.id,account.password_hash));
    }
    if(body.action==='logout'){
      const token=tokenFromCookie(request.url,request.headers.get('cookie'));if(token)await database().prepare('DELETE FROM auth_sessions WHERE token_hash = ?').bind(await hashToken(token)).run();
      return json({ok:true},200,sessionCookie(request.url,'',0));
    }
    let document=await clubDocument();
    if(body.action==='setup'){
      if(await accountsReady())return json({error:'The admin account is already configured. Sign in instead.'},409);
      const identity=await initialOwner(request);if(!identity)return json({error:'Only the verified admin can create the first account.'},403);
      const username=normalizeUsername(body.username),passwordHash=await hashPassword(body.password);
      if(!document){
        const club=newClub();club.members=[{id:crypto.randomUUID(),email:INITIAL_OWNER_EMAIL,role:'owner'}];
        if(identity.email!==INITIAL_OWNER_EMAIL)club.members.push({id:crypto.randomUUID(),email:identity.email,role:'owner'});
        await database().prepare('INSERT OR IGNORE INTO club_state (id, version, document, updated_at) VALUES (?, 1, ?, ?)').bind('main',JSON.stringify(club),new Date().toISOString()).run();document=await clubDocument();
      }
      if(!document)throw new Error('Could not create the club.');
      const owner=document.club.members.find(m=>m.email===identity.email.toLowerCase()&&m.role==='owner');if(!owner)return json({error:'This account is not the admin.'},403);
      const result=await database().prepare('INSERT INTO auth_accounts (id, username, member_id, password_hash, created_at) VALUES (?, ?, ?, ?, ?)').bind(crypto.randomUUID(),username,owner.id,passwordHash,Date.now()).run();
      if(!result.success)throw new Error('Could not create the account.');
      const account=await database().prepare('SELECT id FROM auth_accounts WHERE member_id = ?').bind(owner.id).first<{id:string}>();
      return json({ok:true},200,await issueSession(request,account!.id,passwordHash));
    }
    const user=await currentUser(request);if(!user||!document)return json({error:'Sign in to manage accounts.'},401);
    const actor=userMember(document.club,user);if(!actor)return json({error:'Manager access required.'},403);
    if(body.action==='createAccount'){
      if(actor.role!=='owner')return json({error:'Only the admin can create manager accounts.'},403);
      const username=normalizeUsername(body.username),passwordHash=await hashPassword(body.password);
      if(await database().prepare('SELECT id FROM auth_accounts WHERE username = ?').bind(username).first())return json({error:'That username is already in use.'},409);
      let member:Member|undefined;
      if(body.memberId){member=document.club.members.find(m=>m.id===body.memberId);if(!member)return json({error:'Manager not found.'},404);if(member.role==='owner')return json({error:'Use the admin account settings to change your password.'},403);if(await database().prepare('SELECT id FROM auth_accounts WHERE member_id = ?').bind(member.id).first())return json({error:'This manager already has a login.'},409);}
      else {member={id:crypto.randomUUID(),email:`${username}@boardroom.local`,username,role:'manager'};document.club.members.push(member);}
      member.username=username;
      document.club.audit.unshift({id:crypto.randomUUID(),at:new Date().toISOString(),actor:user.displayName,action:'createAccount',detail:`Created manager login ${username}`});
      const results=await database().batch([
        database().prepare('UPDATE club_state SET document = ?, version = version + 1, updated_at = ? WHERE id = ? AND version = ? RETURNING version').bind(JSON.stringify(document.club),new Date().toISOString(),'main',document.version),
        database().prepare('INSERT INTO auth_accounts (id, username, member_id, password_hash, created_at) SELECT ?, ?, ?, ?, ? WHERE changes() = 1').bind(crypto.randomUUID(),username,member.id,passwordHash,Date.now()),
      ]);
      // Both statements run in one transaction; changes() gates the insert on this CAS.
      if(!results[0].meta.changes)return json({error:'Another manager saved first. Refresh and try again.'},409);
      return json({ok:true});
    }
    if(body.action==='changePassword'){
      await checkPasswordAttempts(database(),user.userId);
      const account=await database().prepare('SELECT password_hash FROM auth_accounts WHERE id = ?').bind(user.userId).first<{password_hash:string}>();
      if(!account||!await verifyPassword(body.oldPassword,account.password_hash))return json({error:'The current password is incorrect.'},401);
      const passwordHash=await hashPassword(body.password);
      if(!await changePasswordIfCurrent(database(),user.userId,account.password_hash,passwordHash))return json({error:'The account changed. Sign in again and retry.'},409);
      return json({ok:true},200,await issueSession(request,user.userId,passwordHash));
    }
    if(body.action==='setAccountActive'){
      if(actor.role!=='owner')return json({error:'Only the admin can enable or disable manager accounts.'},403);
      if(typeof body.active!=='boolean')return json({error:'Choose whether the account should be enabled.'},400);
      const account=await database().prepare('SELECT id, member_id FROM auth_accounts WHERE id = ?').bind(body.accountId??'').first<{id:string;member_id:string}>();
      if(!account||document.club.members.find(m=>m.id===account.member_id)?.role!=='manager')return json({error:'Manager account not found.'},404);
      await database().batch([database().prepare('UPDATE auth_accounts SET active = ? WHERE id = ?').bind(body.active?1:0,account.id),database().prepare('DELETE FROM auth_sessions WHERE account_id = ?').bind(account.id)]);return json({ok:true});
    }
    if(body.action==='resetPassword'){
      if(actor.role!=='owner')return json({error:'Only the admin can reset manager passwords.'},403);
      const account=await database().prepare('SELECT id, member_id FROM auth_accounts WHERE id = ?').bind(body.accountId??'').first<{id:string;member_id:string}>();
      const member=document.club.members.find(m=>m.id===account?.member_id);if(!account||member?.role!=='manager')return json({error:'Manager account not found.'},404);
      const passwordHash=await hashPassword(body.password);await database().batch([database().prepare('UPDATE auth_accounts SET password_hash = ? WHERE id = ?').bind(passwordHash,account.id),database().prepare('DELETE FROM auth_sessions WHERE account_id = ?').bind(account.id)]);return json({ok:true});
    }
    return json({error:'Unknown account action.'},400);
  }catch(e){if(e instanceof RequestError)return json({error:e.message},e.status);if(e instanceof LoginLimitError)return json({error:e.message},429,undefined,e.retryAfter);const message=e instanceof Error?e.message:'Unable to save account.';if(/UNIQUE constraint/i.test(message))return json({error:'That username or manager account is already configured.'},409);if(/D1_|SQLITE|database/i.test(message))return json({error:'The account service is temporarily unavailable.'},503);return json({error:message},400);}
}
