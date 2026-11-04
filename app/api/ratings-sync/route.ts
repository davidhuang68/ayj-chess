import {env} from 'cloudflare:workers';
import type {Club} from '@/lib/chess';
import {ratingsSnapshot,recordSheetSync,validRatingsSyncKey} from '@/lib/sheets-sync';
import {readJsonRequest,RequestError} from '@/lib/request-security';
export const dynamic='force-dynamic';
const json=(data:unknown,status=200)=>Response.json(data,{status,headers:{'Cache-Control':'no-store','X-Content-Type-Options':'nosniff','X-Robots-Tag':'noindex, nofollow'}});
async function authorized(request:Request){return validRatingsSyncKey(request.headers.get('authorization'),env.SHEETS_SYNC_KEY_HASH);}
async function source(){if(!env.DB)throw new Error('No database');return env.DB.prepare('SELECT version,document,updated_at FROM club_state WHERE id = ?').bind('main').first<{version:number;document:string;updated_at:string}>();}
export async function GET(request:Request){
  if(new URL(request.url).search)return json({error:'Not found.'},404);
  if(!await authorized(request))return json({error:'Sync access required.'},401);
  try{const row=await source();if(!row)return json({error:'Ratings are not ready.'},503);return json(ratingsSnapshot(JSON.parse(row.document) as Club,row.version,row.updated_at));}
  catch{return json({error:'Could not load ratings.'},503);}
}
export async function POST(request:Request){
  if(new URL(request.url).search)return json({error:'Not found.'},404);
  if(!await authorized(request))return json({error:'Sync access required.'},401);
  try{
    const body=await readJsonRequest(request,1024),row=await source();if(!row)return json({error:'Ratings are not ready.'},503);
    await recordSheetSync(env.DB!,body,row.version);return json({ok:true});
  }catch(e){if(e instanceof RequestError)return json({error:e.message},e.status);return json({error:'Could not record sync status.'},400);}
}
