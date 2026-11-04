import {hashToken} from './password.ts';

export const LOGIN_WINDOW_MS=15*60*1000;
export class LoginLimitError extends Error {
  retryAfter:number;
  constructor(retryAfter:number){super('Too many sign-in attempts. Try again later.');this.retryAfter=retryAfter;}
}
async function consume(db:D1Database,label:string,limit:number,now:number){
  const key=await hashToken(label),cutoff=now-LOGIN_WINDOW_MS;
  // A rolling window starting at the first attempt avoids a double burst at a clock boundary.
  const row=await db.prepare(`INSERT INTO auth_attempts (key,count,window_start) VALUES (?,1,?)
    ON CONFLICT(key) DO UPDATE SET
      count=CASE WHEN window_start<=? THEN 1 ELSE MIN(count+1,?) END,
      window_start=CASE WHEN window_start<=? THEN excluded.window_start ELSE window_start END
    RETURNING count,window_start`).bind(key,now,cutoff,limit+1,cutoff).first<{count:number;window_start:number}>();
  if(!row)throw new Error('Account service unavailable.');
  if(row.count>limit)throw new LoginLimitError(Math.max(1,Math.ceil((row.window_start+LOGIN_WINDOW_MS-now)/1000)));
}
export async function checkLoginAttempts(db:D1Database,ip:string,username:string,now=Date.now()){
  // Expire old keys, and throttle the IP before allocating arbitrary username keys.
  await db.prepare('DELETE FROM auth_attempts WHERE window_start <= ?').bind(now-LOGIN_WINDOW_MS).run();
  await consume(db,`ip:${ip}`,30,now);
  await consume(db,`username:${username}`,8,now);
}
export async function checkPasswordAttempts(db:D1Database,accountId:string,now=Date.now()){
  await consume(db,`password-change:${accountId}`,8,now);
}
