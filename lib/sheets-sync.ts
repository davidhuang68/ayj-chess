import {calculateStats,type Club} from './chess.ts';
import {hashToken} from './password.ts';

export const RATINGS_SPREADSHEET_ID='YOUR_SPREADSHEET_ID';
export const RATINGS_SPREADSHEET_URL=`https://docs.google.com/spreadsheets/d/${RATINGS_SPREADSHEET_ID}/edit`;
const STATE_ID='ratings-sheet-sync';
export type SheetSyncRecord={lastSyncedVersion:number;lastSyncedAt:string|null;lastCheckedAt:string|null;error:string|null};
export type SheetSyncStatus=SheetSyncRecord&{status:'not_connected'|'pending'|'synced'|'stale'|'error';sheetUrl:string};
const empty=():SheetSyncRecord=>({lastSyncedVersion:0,lastSyncedAt:null,lastCheckedAt:null,error:null});

// A separate allowlist for this private integration: no club, accounts, logs or game history.
export function ratingsSnapshot(club:Club,version:number,updatedAt:string){
  const stats=calculateStats(club);
  const players=club.players.map(player=>({id:player.id,name:player.name,rating:stats[player.id].rating,
    games:stats[player.id].games,wins:stats[player.id].wins,draws:stats[player.id].draws,losses:stats[player.id].losses}))
    .sort((a,b)=>b.rating-a.rating||a.name.localeCompare(b.name)||a.id.localeCompare(b.id));
  return {schema:1,spreadsheetId:RATINGS_SPREADSHEET_ID,version,updatedAt,players};
}
export async function validRatingsSyncKey(authorization:string|null,expectedHash:string|undefined){
  if(!expectedHash||!/^[a-f0-9]{64}$/.test(expectedHash))return false;
  const match=/^Bearer ([a-f0-9]{64})$/.exec(authorization??'');if(!match)return false;
  const actual=await hashToken(match[1]);let difference=0;
  for(let i=0;i<64;i++)difference|=actual.charCodeAt(i)^expectedHash.charCodeAt(i);
  return difference===0;
}
export async function sheetSyncStatus(db:D1Database,configured:boolean,clubVersion:number,now=Date.now()):Promise<SheetSyncStatus>{
  const base={...empty(),sheetUrl:RATINGS_SPREADSHEET_URL};
  if(!configured)return {...base,status:'not_connected'};
  try{
    const row=await db.prepare('SELECT document FROM club_state WHERE id = ?').bind(STATE_ID).first<{document:string}>();
    const state:SheetSyncRecord=row?{...empty(),...JSON.parse(row.document)}:empty();
    const stale=!!state.lastCheckedAt&&now-Date.parse(state.lastCheckedAt)>10*60*1000;
    return {...state,sheetUrl:RATINGS_SPREADSHEET_URL,status:state.error?'error':stale?'stale':!state.lastSyncedAt||state.lastSyncedVersion<clubVersion?'pending':'synced'};
  }catch{return {...base,status:'error',error:'Sync status unavailable.'};}
}
export async function recordSheetSync(db:D1Database,input:unknown,clubVersion:number,now=new Date().toISOString()){
  if(!input||typeof input!=='object'||Array.isArray(input))throw new Error('Invalid sync receipt.');
  const body=input as Record<string,unknown>;
  if(Object.keys(body).some(key=>!['version','status','code'].includes(key))||!Number.isSafeInteger(body.version)||Number(body.version)<0||Number(body.version)>clubVersion||(body.status!=='synced'&&body.status!=='error'))throw new Error('Invalid sync receipt.');
  if(body.status==='synced'&&Number(body.version)<1)throw new Error('Invalid sync receipt.');
  if(body.status==='synced'&&body.code!==undefined)throw new Error('Invalid sync receipt.');
  if(body.status==='error'&&body.code!=='connection_failed'&&body.code!=='sheet_update_failed')throw new Error('Invalid sync receipt.');
  for(let attempt=0;attempt<3;attempt++){
    const row=await db.prepare('SELECT version, document FROM club_state WHERE id = ?').bind(STATE_ID).first<{version:number;document:string}>();
    const before:SheetSyncRecord=row?{...empty(),...JSON.parse(row.document)}:empty();
    // Old or retried acknowledgements cannot replace a newer successful version.
    if(Number(body.version)<before.lastSyncedVersion)return;
    const next={...before,lastCheckedAt:now,error:body.status==='error'?(body.code==='connection_failed'?'Could not fetch ratings.':'Could not update the sheet.'):null};
    if(body.status==='synced'&&Number(body.version)>before.lastSyncedVersion){next.lastSyncedVersion=Number(body.version);next.lastSyncedAt=now;}
    const result=row
      ?await db.prepare('UPDATE club_state SET document = ?, version = version + 1, updated_at = ? WHERE id = ? AND version = ?').bind(JSON.stringify(next),now,STATE_ID,row.version).run()
      :await db.prepare('INSERT OR IGNORE INTO club_state (id,version,document,updated_at) VALUES (?,1,?,?)').bind(STATE_ID,JSON.stringify(next),now).run();
    if(result.meta.changes)return;
  }
  throw new Error('Sync status changed. Try again.');
}
