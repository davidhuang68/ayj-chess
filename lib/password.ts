import bcrypt from 'bcryptjs';

export function normalizeUsername(input: unknown): string {
  if (typeof input !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9._-]{2,31}$/.test(input.trim())) throw new Error('Use a username of 3–32 letters, numbers, dots, underscores, or hyphens.');
  return input.trim().toLowerCase();
}
export function validatePassword(input: unknown): string {
  if (typeof input !== 'string' || input.length === 0) throw new Error('Enter a password.');
  if (new TextEncoder().encode(input).length > 72) throw new Error('Use a password of no more than 72 bytes.');
  return input;
}
export async function hashPassword(input: unknown) { return bcrypt.hash(validatePassword(input), 10); }
export async function verifyPassword(input: unknown, hash: string) {
  if (typeof input !== 'string' || input.length > 72 || new TextEncoder().encode(input).length > 72) return false;
  return bcrypt.compare(input, hash);
}
export function randomToken() { return [...crypto.getRandomValues(new Uint8Array(32))].map(n=>n.toString(16).padStart(2,'0')).join(''); }
export async function hashToken(token: string) { return [...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(token)))].map(n=>n.toString(16).padStart(2,'0')).join(''); }
export function cookieName(url:string) { return new URL(url).protocol==='https:'?'__Host-boardroom_session':'boardroom_session_dev'; }
export function sessionCookie(url:string,token:string,maxAge=60*60*24*7) { return `${cookieName(url)}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${new URL(url).protocol==='https:'?'; Secure':''}`; }
export function tokenFromCookie(url:string,header:string|null) { const name=cookieName(url);const found=(header??'').split(';').map(p=>p.trim()).filter(p=>p.startsWith(name+'='));if(found.length!==1)return null;const token=found[0].slice(name.length+1);return /^[a-f0-9]{64}$/.test(token)?token:null; }
export async function validSetupKey(key:string|null,expectedHash:string|undefined,expiresAt:string|undefined){
  if(!expectedHash||!key||!/^[a-f0-9]{64}$/.test(key)||!expiresAt||!Number.isFinite(Number(expiresAt))||Date.now()>Number(expiresAt))return false;
  const actual=await hashToken(key);let difference=0;if(actual.length!==expectedHash.length)return false;
  for(let i=0;i<actual.length;i++)difference|=actual.charCodeAt(i)^expectedHash.charCodeAt(i);
  return difference===0;
}
