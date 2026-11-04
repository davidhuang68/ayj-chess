import { calculateStats, type Club } from './chess.ts';

// Clear only competition history, retaining each player's current Elo as their new baseline.
export async function clearConfiguredSessionData(db:D1Database,version:string|undefined){
  if(!version || !/^[1-9]\d*$/.test(version) || !Number.isSafeInteger(Number(version)))return false;
  const row=await db.prepare('SELECT version, document FROM club_state WHERE id = ?').bind('main').first<{version:number;document:string}>();
  if(!row || row.version!==Number(version))return false;
  const club=JSON.parse(row.document) as Club,ratings=calculateStats(club),count=club.tournaments.length;
  for(const player of club.players){player.initialRating=ratings[player.id].rating;delete player.ratingAdjustment;}
  club.tournaments=[];delete club.deletedPlayers;
  club.audit.unshift({id:crypto.randomUUID(),at:new Date().toISOString(),actor:'Admin',action:'clearSessions',detail:`Deleted all ${count} tournaments/sessions and their results; kept ${club.players.length} players, current ratings, accounts and earlier logs`});
  // Keep reset results visible even when the database viewer truncates large documents.
  const {tournaments,audit,...rest}=club;
  const document=JSON.stringify({tournaments,audit,...rest});
  const result=await db.prepare('UPDATE club_state SET document = ?, version = version + 1, updated_at = ? WHERE id = ? AND version = ?').bind(document,new Date().toISOString(),'main',row.version).run();
  return !!result.meta.changes;
}

// An explicitly configured reset applies once to the reviewed document version.
export async function clearConfiguredPlayerData(db:D1Database,version:string|undefined){
  if(!version || !/^[1-9]\d*$/.test(version) || !Number.isSafeInteger(Number(version)))return false;
  const row=await db.prepare('SELECT version, document FROM club_state WHERE id = ?').bind('main').first<{version:number;document:string}>();
  if(!row || row.version!==Number(version))return false;
  const club=JSON.parse(row.document) as Club;
  const names=club.players.map(player=>player.name);
  club.players=[];club.tournaments=[];delete club.deletedPlayers;
  club.audit.unshift({id:crypto.randomUUID(),at:new Date().toISOString(),actor:'Admin',action:'clearPlayers',detail:`Deleted all ${names.length} players${names.length?`: ${names.join(', ')}`:''}; cleared ratings and results; kept accounts and earlier logs`});
  const {players,tournaments,audit,...rest}=club;
  const document=JSON.stringify({players,tournaments,audit,...rest});
  const result=await db.prepare('UPDATE club_state SET document = ?, version = version + 1, updated_at = ? WHERE id = ? AND version = ?').bind(document,new Date().toISOString(),'main',row.version).run();
  return !!result.meta.changes;
}

// A server-configured, one-time data repair. Browsers cannot select its target.
export async function removeConfiguredManager(db:D1Database,email:string|undefined){
  if(!email)return;
  const row=await db.prepare('SELECT version, document FROM club_state WHERE id = ?').bind('main').first<{version:number;document:string}>();
  if(!row)return;
  const club=JSON.parse(row.document) as Club;
  const ids=club.members.filter(m=>m.role==='manager'&&m.email.toLowerCase()===email.toLowerCase()).map(m=>m.id);
  if(!ids.length)return;
  club.members=club.members.filter(m=>!ids.includes(m.id));
  club.audit.unshift({id:crypto.randomUUID(),at:new Date().toISOString(),actor:'Admin',action:'removeManager',detail:'Removed preconfigured tournament manager'});
  const placeholders=ids.map(()=>'?').join(',');
  // Account revocation is gated on membership actually being absent after the CAS.
  const absent="NOT EXISTS (SELECT 1 FROM club_state c, json_each(c.document, '$.members') m WHERE c.id = 'main' AND json_extract(m.value, '$.id') = a.member_id)";
  const results=await db.batch([
    db.prepare('UPDATE club_state SET document = ?, version = version + 1, updated_at = ? WHERE id = ? AND version = ?').bind(JSON.stringify(club),new Date().toISOString(),'main',row.version),
    db.prepare(`DELETE FROM auth_sessions WHERE account_id IN (SELECT a.id FROM auth_accounts a WHERE a.member_id IN (${placeholders}) AND ${absent})`).bind(...ids),
    db.prepare(`DELETE FROM auth_accounts AS a WHERE a.member_id IN (${placeholders}) AND ${absent}`).bind(...ids),
  ]);
  if(results[0].meta.changes)console.info('Removed configured tournament manager.');
}
