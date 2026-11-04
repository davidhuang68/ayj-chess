import { env } from 'cloudflare:workers';
import { hashToken, tokenFromCookie, randomToken, sessionCookie } from './password';
import type { Club, Member } from './chess';
import { removeConfiguredManager, clearConfiguredPlayerData, clearConfiguredSessionData } from './member-maintenance';
import {checkLoginAttempts} from './login-throttle';

export type ClubUser = { userId:string; memberId:string; email:string; displayName:string; role:'owner'|'manager' };
export function database() { if(!env.DB)throw new Error('Database is unavailable.');return env.DB; }
export async function clubDocument() { await removeConfiguredManager(database(),env.REMOVE_MANAGER_EMAIL);await clearConfiguredPlayerData(database(),env.CLEAR_PLAYER_DATA_VERSION);await clearConfiguredSessionData(database(),env.CLEAR_SESSION_DATA_VERSION);const row=await database().prepare('SELECT version, document FROM club_state WHERE id = ?').bind('main').first<{version:number;document:string}>();return row?{version:row.version,club:JSON.parse(row.document) as Club}:null; }
export async function accountsReady() { return !!await database().prepare('SELECT id FROM auth_accounts LIMIT 1').first(); }
export async function currentUser(request:Request):Promise<ClubUser|null> {
  const token=tokenFromCookie(request.url,request.headers.get('cookie'));if(!token)return null;
  const row=await database().prepare('SELECT a.id, a.username, a.member_id FROM auth_sessions s JOIN auth_accounts a ON a.id = s.account_id WHERE s.token_hash = ? AND s.expires_at > ? AND a.active = 1').bind(await hashToken(token),Date.now()).first<{id:string;username:string;member_id:string}>();
  if(!row)return null;const document=await clubDocument();const member=document?.club.members.find(m=>m.id===row.member_id);if(!member)return null;
  return {userId:row.id,memberId:member.id,email:member.email,displayName:row.username,role:member.role};
}
export function userMember(club:Club,user:ClubUser|null):Member|undefined { return user?club.members.find(m=>m.id===user.memberId):undefined; }
export async function issueSession(request:Request,accountId:string,passwordHash:string) {
  const token=randomToken();const results=await database().batch([
    database().prepare('DELETE FROM auth_sessions WHERE expires_at <= ?').bind(Date.now()),
    database().prepare('INSERT INTO auth_sessions (token_hash, account_id, expires_at) SELECT ?, ?, ? WHERE EXISTS (SELECT 1 FROM auth_accounts WHERE id = ? AND password_hash = ? AND active = 1)').bind(await hashToken(token),accountId,Date.now()+7*24*60*60*1000,accountId,passwordHash),
  ]);if(!results[1].meta.changes)throw new Error('The account changed while signing in. Please try again.');return sessionCookie(request.url,token);
}
export async function rateLimit(request:Request,username:string) {
  // Only the authenticated Vercel bridge may supply a visitor IP for throttling.
  const proxyKey=request.headers.get('x-boardroom-proxy-key');
  const trustedProxy=!!env.PROXY_KEY_HASH&&!!proxyKey&&await hashToken(proxyKey)===env.PROXY_KEY_HASH;
  const ip=(trustedProxy?request.headers.get('x-boardroom-client-ip'):null)??request.headers.get('CF-Connecting-IP')??'unknown';
  await checkLoginAttempts(database(),ip,username);
}
