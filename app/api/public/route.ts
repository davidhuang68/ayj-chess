import {env} from 'cloudflare:workers';
import {publicEventData,publicEventList} from '@/lib/public-view';
import type {Club} from '@/lib/chess';
export const dynamic='force-dynamic';
const headers={'Cache-Control':'no-store','X-Content-Type-Options':'nosniff','X-Robots-Tag':'noindex, nofollow'};
const json=(body:unknown,status=200)=>Response.json(body,{status,headers});
export async function GET(request:Request){
  const params=new URL(request.url).searchParams;
  if([...params].some(([key])=>key!=='event')||params.getAll('event').length>1)return json({error:'Public view unavailable.'},404);
  const id=params.get('event');
  if(id!==null&&!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(id))return json({error:'Public view unavailable.'},404);
  try{
    if(!env.DB)throw new Error('No database');
    // Public reads never touch authentication sessions or maintenance actions.
    const row=await env.DB.prepare('SELECT document FROM club_state WHERE id = ?').bind('main').first<{document:string}>();
    if(!row)return id?json({error:'Public view unavailable.'},404):json({events:[]});
    const club=JSON.parse(row.document) as Club;
    if(!id)return json({events:publicEventList(club)});
    const event=publicEventData(club,id);return event?json({event}):json({error:'Public view unavailable.'},404);
  }catch{return json({error:'Could not load the public view. Try again.'},503);}
}
export function POST(){return Response.json({error:'This view is read-only.'},{status:405,headers:{...headers,Allow:'GET'}});}
