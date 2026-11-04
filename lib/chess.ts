import { changePendingAttendance, replacePendingPairings, resultLocked } from './round-editing.ts';
import { priorSeriesSessions, seriesKey } from './series.ts';
import { pairTournamentRound, tournamentSeeds, type TournamentSeed } from './tournament.ts';
export type Result = 'white' | 'black' | 'draw' | 'forfeit-white' | 'forfeit-black' | 'bye' | null;
export type Player = { id: string; name: string; initialRating: number; createdAt: string; archived?: boolean; ratingAdjustment?: number };
export type Game = { id: string; board: number; white: string; black: string | null; result: Result; kFactor?: number; ratingBefore?: { white:number; black:number } };
export type Round = { number: number; games: Game[]; publishedAt: string; warnings: string[]; unpaired?: string[]; eligiblePlayers?: string[] };
export type Tournament = { id: string; name: string; date: string; signupUrl: string; timeControl: string; maxRounds: number; roster: string[]; withdrawn: string[]; rounds: Round[]; status: 'registration' | 'running' | 'completed'; createdAt: string; mode?:'weekly'|'tournament'; seeds?:Record<string,TournamentSeed>; publicVisible?:boolean };
export type Member = { id: string; email: string; role: 'owner' | 'manager'; userId?: string; username?: string };
export type Audit = { id: string; at: string; actor: string; action: string; detail: string };
export type Club = { name: string; startingRating: number; kFactor: number; players: Player[]; deletedPlayers?: {id:string;initialRating:number}[]; tournaments: Tournament[]; members: Member[]; audit: Audit[] };
export type Action = { type: string; [key: string]: unknown };
export type RatingPoint = { date: string; tournament: string; round: number; rating: number; delta: number };
export type Stats = { rating: number; games: number; wins: number; draws: number; losses: number; points: number; appearances: number; change: number; history: RatingPoint[] };

export function newClub(name = 'Chess Club'): Club {
  return { name, startingRating: 1000, kFactor: 32, players: [], tournaments: [], members: [], audit: [] };
}
export function normalName(name: string) { return name.normalize('NFKC').trim().replace(/\s+/g, ' ').toLocaleLowerCase('en'); }
export function parseNames(value: string) {
  const unique = new Map<string, string>(); let duplicates = 0;
  for (const line of value.split(/[\r\n\t]+/)) {
    const name = line.normalize('NFKC').trim().replace(/\s+/g, ' ');
    if (!name) continue;
    if (name.length > 100) throw new Error('Names must be 100 characters or fewer.');
    if (unique.has(normalName(name))) duplicates++; else unique.set(normalName(name), name);
  }
  if (unique.size > 200) throw new Error('Please import at most 200 players at a time.');
  return { names: [...unique.values()], duplicates };
}
export type ImportMode = 'new' | 'existing' | 'mixed';
export type InitialRatingInput = { name:string; rating:number };
export function parseInitialRatings(names:string[],input:unknown,mode:ImportMode){
  const ratings=new Map<string,number>();
  if(input===undefined)return ratings;
  if(!Array.isArray(input)||input.length>200)throw new Error('Choose valid starting ratings.');
  if(input.length&&mode!=='new')throw new Error('Starting ratings can only be set for new players.');
  const allowed=new Set(names.map(normalName));
  for(const entry of input){
    if(!entry||typeof entry!=='object'||typeof entry.name!=='string'||typeof entry.rating!=='number'||!Number.isInteger(entry.rating)||entry.rating<100||entry.rating>3500)
      throw new Error('Starting ratings must be whole numbers from 100 to 3500.');
    const key=normalName(entry.name);
    if(!allowed.has(key))throw new Error('A starting rating must match a new player in this import.');
    if(ratings.has(key))throw new Error('Enter only one starting rating per player.');
    ratings.set(key,entry.rating);
  }
  return ratings;
}
export function parsePlayerImport(club:Club,text:string,mode:ImportMode){
  const parsed=parseNames(text),known=new Set(club.players.map(p=>normalName(p.name)));
  const wrong=parsed.names.filter(name=>mode==='new'?known.has(normalName(name)):mode==='existing'?!known.has(normalName(name)):false);
  if(wrong.length)throw new Error(`${mode==='new'?'Already in the system':'Not in the system'}: ${wrong.join(', ')}`);
  return parsed;
}
export function parseCSV(text: string): string[][] {
  const rows: string[][] = []; let row: string[] = [], field = '', quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === '"') { if (quoted && text[i + 1] === '"') { field += '"'; i++; } else quoted = !quoted; }
    else if (c === ',' && !quoted) { row.push(field.trim()); field = ''; }
    else if ((c === '\n' || c === '\r') && !quoted) { if (c === '\r' && text[i + 1] === '\n') i++; row.push(field.trim()); if (row.some(Boolean)) rows.push(row); row = []; field = ''; }
    else field += c;
  }
  if (quoted) throw new Error('The CSV contains an unclosed quoted field.');
  row.push(field.trim()); if (row.some(Boolean)) rows.push(row);
  if (rows.length && rows[0].length) rows[0][0] = rows[0][0].replace(/^\uFEFF/, '');
  return rows;
}
export function eloDelta(a: number, b: number, score: number, k = 32) { return Math.round(k * (score - 1 / (1 + 10 ** ((b - a) / 400)))); }
export function gameScore(game: Game, id: string): number {
  if (!game.result || (game.white !== id && game.black !== id)) return 0;
  if (game.result === 'bye') return game.white === id ? 1 : 0;
  if (game.result === 'draw') return .5;
  const whiteWon = game.result === 'white' || game.result === 'forfeit-white';
  return (whiteWon && id === game.white) || (!whiteWon && id === game.black) ? 1 : 0;
}
export function orderedTournaments(club: Club) { return [...club.tournaments].sort((a, b) => a.date.localeCompare(b.date) || a.createdAt.localeCompare(b.createdAt)); }
export function calculateStats(club: Club): Record<string, Stats> { return ratingStats(club); }
function ratingStats(club: Club, preserveGames = false): Record<string, Stats> {
  const participants = [...(club.deletedPlayers ?? []), ...club.players];
  const stats: Record<string, Stats> = Object.fromEntries(participants.map(p => [p.id, { rating: p.initialRating, games: 0, wins: 0, draws: 0, losses: 0, points: 0, appearances: 0, change: 0, history: [] }]));
  for (const event of orderedTournaments(club)) {
    const appeared = new Set<string>();
    for (const round of event.rounds) {
      const baseline = Object.fromEntries(Object.entries(stats).map(([id, s]) => [id, s.rating]));
      for (const game of round.games) {
        if (!game.result) continue;
        appeared.add(game.white); if (game.black) appeared.add(game.black);
        for (const id of [game.white, game.black].filter((x): x is string => !!x)) stats[id].points += gameScore(game, id);
        if (!game.black || !['white', 'black', 'draw'].includes(game.result)) continue;
        // Snapshots preserve a game's original calculation across manual rating edits.
        if(preserveGames){game.ratingBefore??={white:baseline[game.white],black:baseline[game.black]};game.kFactor??=club.kFactor;}
        const before=game.ratingBefore;
        const delta = eloDelta(before?.white??baseline[game.white], before?.black??baseline[game.black], gameScore(game, game.white), game.kFactor ?? club.kFactor);
        for (const [id, change] of [[game.white, delta], [game.black, -delta]] as [string, number][]) {
          const s = stats[id]; const score = gameScore(game, id); s.rating += change; s.games++;
          if (score === 1) s.wins++; else if (score === .5) s.draws++; else s.losses++;
          const historicalRating=before?(id===game.white?before.white:before.black)+change:s.rating;
          s.history.push({ date: event.date, tournament: event.name, round: round.number, rating: historicalRating, delta: change });
          s.change = change;
        }
      }
    }
    appeared.forEach(id => stats[id].appearances++);
  }
  // Manual corrections affect current Elo, while recorded history keeps its snapshots.
  for(const player of club.players)stats[player.id].rating+=player.ratingAdjustment??0;
  return Object.fromEntries(club.players.map(p=>[p.id,stats[p.id]]));
}
export function weeklyStandings(club: Club, event: Tournament) {
  const stats = calculateStats(club);
  return event.roster.map(id => {
    let points = 0, played = 0, colourBalance = 0; const opponents: string[] = []; let byes = 0;
    for (const round of event.rounds) for (const game of round.games) {
      if (game.white !== id && game.black !== id) continue;
      const other = game.white === id ? game.black : game.white;
      if (other) { opponents.push(other); colourBalance += game.white === id ? 1 : -1; }
      if (game.result) { played++; points += gameScore(game, id); if (game.result === 'bye') byes++; }
    }
    return { id, name: club.players.find(p => p.id === id)!.name, points, played, colourBalance, opponents, byes, rating: stats[id].rating };
  }).sort((a,b) => b.points - a.points || b.rating - a.rating || a.name.localeCompare(b.name));
}
export function pairRound(club: Club, event: Tournament, allowRematches = false, leaveUnmatched = false): Round {
  if (event.status === 'completed') throw new Error('Reopen this session before adding a round.');
  if (event.rounds.length >= event.maxRounds) throw new Error('All scheduled rounds have already been published.');
  if (event.rounds.some(r => r.unpaired?.length)) throw new Error('Pair the waiting players before starting the next round.');
  if (event.rounds.some(r => r.games.some(g => !g.result))) throw new Error('Record every result before pairing the next round.');
  if(event.mode==='tournament')return pairTournamentRound(club,event,allowRematches,leaveUnmatched);
  const prior=priorSeriesSessions(club,event);
  const priorGames=prior.flatMap(t=>t.rounds.flatMap(r=>r.games)).filter(g=>g.black);
  let pool = weeklyStandings(club, event).filter(p => !event.withdrawn.includes(p.id)).map(p=>({
    ...p,
    pastOpponents:priorGames.filter(g=>g.white===p.id||g.black===p.id).map(g=>g.white===p.id?g.black!:g.white),
  }));
  if (pool.length < 2) throw new Error('Check in at least two players to generate pairings.');
  let bye: typeof pool[number] | undefined;
  if (pool.length % 2 && !leaveUnmatched) {
    const pastByes = (id: string) => club.tournaments.reduce((sum, t) => sum + t.rounds.reduce((n,r) => n + r.games.filter(g => g.white === id && g.result === 'bye').length, 0),0);
    bye = [...pool].sort((a,b) => a.byes - b.byes || pastByes(a.id) - pastByes(b.id) || a.points-b.points || a.rating-b.rating)[0];
    pool = pool.filter(p => p.id !== bye!.id);
  }
  // Bounded perfect-matching search: prioritize players with fewest legal opponents.
  // This is reviewed club pairing, not an official FIDE Swiss implementation.
  let attempts = 0;
  let allowPastRematches=false;
  const valid=(a:typeof pool[number],b:typeof pool[number])=>a.id!==b.id&&
    (allowRematches||!a.opponents.includes(b.id))&&
    (allowRematches||allowPastRematches||!a.pastOpponents.includes(b.id));
  const repeatCount=(a:typeof pool[number],b:typeof pool[number])=>a.pastOpponents.filter(id=>id===b.id).length;
  // Older repeats are a preference, equivalent to a 200-point rating gap per prior meeting.
  // Current-week score groups and the same-week repeat lock take priority.
  const compareOpponents=(a:typeof pool[number],x:typeof pool[number],y:typeof pool[number])=>
    Math.abs(a.points-x.points)-Math.abs(a.points-y.points)||
    (Math.abs(a.rating-x.rating)+200*repeatCount(a,x))-(Math.abs(a.rating-y.rating)+200*repeatCount(a,y));
  type Match=[typeof pool[number],typeof pool[number]];
  const costs=(matches:Match[])=>matches.reduce((cost,[a,b])=>[
    cost[0]+Math.abs(a.points-b.points),cost[1]+Math.abs(a.rating-b.rating)+200*repeatCount(a,b),
  ],[0,0]);
  const prefer=(a:Match[],b:Match[])=>{
    if(a.length!==b.length)return a.length>b.length;
    const ca=costs(a),cb=costs(b);return ca[0]<cb[0]||(ca[0]===cb[0]&&ca[1]<cb[1]);
  };
  const search = (remaining: typeof pool): [typeof pool[number], typeof pool[number]][] | null => {
    if (!remaining.length) return [];
    if (++attempts > 80000) return null;
    const a = [...remaining].sort((x,y) => remaining.filter(p=>valid(x,p)).length - remaining.filter(p=>valid(y,p)).length || y.points-x.points)[0];
    const choices = remaining.filter(b => valid(a,b)).sort((x,y) => compareOpponents(a,x,y));
    for (const b of choices) { const rest = search(remaining.filter(p => p.id !== a.id && p.id !== b.id)); if (rest) return [[a,b],...rest]; }
    return null;
  };
  let pairs: ReturnType<typeof search>;
  if(leaveUnmatched){
    const findPartial=()=>{
    let best: NonNullable<typeof pairs>=[];
    const partial=(remaining:typeof pool,matches:NonNullable<typeof pairs>)=>{
      if(matches.length>best.length)best=matches;
      if(++attempts>80000||best.length===Math.floor(pool.length/2)||matches.length+Math.floor(remaining.length/2)<=best.length)return;
      const a=[...remaining].sort((x,y)=>remaining.filter(p=>valid(x,p)).length-remaining.filter(p=>valid(y,p)).length||y.points-x.points)[0];
      const choices=remaining.filter(b=>valid(a,b)).sort((x,y)=>compareOpponents(a,x,y));
      for(const b of choices)partial(remaining.filter(p=>p.id!==a.id&&p.id!==b.id),[...matches,[a,b]]);
      partial(remaining.filter(p=>p.id!==a.id),matches);
    };
    partial(pool,[]);return best;
    };
    pairs=findPartial();
    if(priorGames.length){allowPastRematches=true;attempts=0;const fallback=findPartial();if(prefer(fallback,pairs))pairs=fallback;}
  }else{
    pairs=search(pool);
    if(priorGames.length){allowPastRematches=true;attempts=0;const fallback=search(pool);if(fallback&&(!pairs||prefer(fallback,pairs)))pairs=fallback;}
  }
  if (!pairs) throw new Error('No pairing found without repeat opponents. Adjust attendance or explicitly allow rematches.');
  const warnings: string[] = [];
  const games: Game[] = pairs.map(([a,b], index) => {
    if (a.opponents.includes(b.id)) warnings.push(`${a.name} and ${b.name} have already played this week.`);
    else if(a.pastOpponents.includes(b.id))warnings.push(`${a.name} and ${b.name} played in an earlier session.`);
    if (Math.abs(a.points-b.points) > 0) warnings.push(`Board ${index+1} pairs different score groups.`);
    const aWhite = Math.abs(a.colourBalance+1)+Math.abs(b.colourBalance-1);
    const bWhite = Math.abs(a.colourBalance-1)+Math.abs(b.colourBalance+1);
    const white = aWhite < bWhite || (aWhite === bWhite && (index+event.rounds.length)%2 === 0) ? a : b;
    return { id: crypto.randomUUID(), board: index+1, white: white.id, black: white.id === a.id ? b.id : a.id, result: null };
  });
  if (bye) games.push({ id: crypto.randomUUID(), board: games.length+1, white: bye.id, black: null, result: 'bye' });
  return { number: event.rounds.length+1, games, warnings, publishedAt: '', eligiblePlayers:[...event.roster], ...(leaveUnmatched?{unpaired:pool.filter(p=>!games.some(g=>g.white===p.id||g.black===p.id)).map(p=>p.id)}:{}) };
}
function cleanString(value: unknown, max = 100): string { if (typeof value !== 'string' || !value.trim() || value.trim().length > max) throw new Error('Please enter a valid value.'); return value.trim(); }
function safeUrl(value: unknown) { if (!value) return ''; const url = new URL(cleanString(value,1000)); if (url.protocol !== 'https:') throw new Error('Signup links must use HTTPS.'); return url.href; }
function changeKFactor(club:Club,k:number) {
  if(k===club.kFactor)return;
  // Legacy results retain their original factor when the default changes.
  for(const t of club.tournaments)for(const r of t.rounds)for(const g of r.games){
    if(g.black&&['white','black','draw'].includes(g.result??'')&&g.kFactor===undefined)g.kFactor=club.kFactor;
  }
  club.kFactor=k;
}
export function applyAction(source: Club, action: Action, actor: Member): Club {
  const club = structuredClone(source);
  if (!['owner','manager'].includes(actor.role)) throw new Error('Manager access required.');
  let detail = ''; const now = new Date().toISOString();
  const event = () => { const t = club.tournaments.find(t => t.id === action.tournamentId); if (!t) throw new Error('Session not found.'); return t; };
  switch (action.type) {
    case 'setPublicView': {
      if(actor.role!=='owner')throw new Error('Only the admin can change public visibility.');
      if(typeof action.enabled!=='boolean')throw new Error('Choose whether the session is public.');
      const t=event();t.publicVisible=action.enabled;
      detail=`${action.enabled?'Enabled':'Disabled'} public view for ${t.name}`;break;
    }
    case 'editName': {
      if(actor.role!=='owner')throw new Error('Only the admin can edit player names.');
      const player=club.players.find(p=>p.id===action.playerId);
      if(!player)throw new Error('Player not found.');
      const name=cleanString(typeof action.name==='string'?action.name.normalize('NFKC').replace(/\s+/g,' '):action.name,100);
      if(club.players.some(p=>p.id!==player.id&&normalName(p.name)===normalName(name)))throw new Error('Another player already has that name.');
      const previous=player.name;player.name=name;
      detail=`Renamed player ${previous} → ${name}`;break;
    }
    case 'editRating': {
      const player=club.players.find(p=>p.id===action.playerId);
      if(!player)throw new Error('Player not found.');
      const rating=action.rating;
      if(typeof rating!=='number'||!Number.isInteger(rating)||rating<100||rating>3500)throw new Error('Rating must be a whole number from 100 to 3500.');
      const previous=ratingStats(club,true)[player.id].rating;
      player.ratingAdjustment=(player.ratingAdjustment??0)+rating-previous;
      detail=`Changed ${player.name}'s rating: ${previous} → ${rating}; past games unchanged`;break;
    }
    case 'settings': {
      if (actor.role !== 'owner') throw new Error('Only the admin can change club settings.');
      club.name = cleanString(action.name,80);
      const rating = Number(action.startingRating), k = Number(action.kFactor);
      if (!Number.isInteger(rating) || rating<100 || rating>3000 || !Number.isInteger(k) || k<8 || k>64) throw new Error('Starting rating must be 100–3000 and K must be 8–64.');
      const previousK = club.kFactor;
      club.startingRating = rating; changeKFactor(club,k); detail = previousK === k ? 'Updated club settings' : `Updated club settings, K ${previousK} → ${k}`; break;
    }
    case 'createSession': {
      const mode=action.mode??'weekly';if(mode!=='weekly'&&mode!=='tournament')throw new Error('Choose Weekly or Tournament.');
      if (club.tournaments.some(t=>t.status !== 'completed')) throw new Error('Finish the active session before creating another.');
      const date = cleanString(action.date,10); if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(Date.parse(date))) throw new Error('Choose a valid date.');
      const last = orderedTournaments(club).at(-1); if (last && date<last.date) throw new Error('New sessions must be dated on or after the latest session.');
      const limit=mode==='tournament'?15:10;
      const maxRounds = Number(action.maxRounds ?? (mode==='tournament'?5:2)); if (!Number.isInteger(maxRounds) || maxRounds<1 || maxRounds>limit) throw new Error(`Choose 1–${limit} rounds.`);
      const k = Number(action.kFactor ?? club.kFactor);
      if(!Number.isInteger(k)||k<8||k>64)throw new Error('K must be 8–64.');
      if(actor.role!=='owner'&&k!==club.kFactor)throw new Error('Only the admin can change K.');
      const suppliedName=cleanString(action.name,80);
      const seriesName=(mode==='weekly'?club.tournaments.find(t=>t.mode!=='tournament'&&seriesKey(t.name)===seriesKey(suppliedName))?.name:undefined)??suppliedName.normalize('NFKC').replace(/\s+/g,' ');
      const t: Tournament = { id: crypto.randomUUID(), name: seriesName, date, signupUrl: safeUrl(action.signupUrl), timeControl: cleanString(action.timeControl,40), maxRounds, roster: [], withdrawn: [], rounds: [], status:'registration', createdAt:now,mode };
      changeKFactor(club,k);club.tournaments.push(t); detail=`${t.name}, ${mode==='tournament'?'Swiss tournament':'weekly'}, ${maxRounds} rounds, K ${k}`; break;
    }
    case 'cancelSession': {
      const t=event();
      if(t.status==='completed'||t.rounds.length)throw new Error('Only sessions without published pairings can be cancelled.');
      if(action.confirm!==true)throw new Error('Confirm session cancellation.');
      club.tournaments=club.tournaments.filter(x=>x.id!==t.id);
      detail=`Cancelled ${t.name} before pairings`;break;
    }
    case 'importNames': {
      const t=event(); if(t.status==='completed')throw new Error('This session is completed.');
      if(action.mode!==undefined&&(typeof action.mode!=='string'||!['new','existing','mixed'].includes(action.mode)))throw new Error('Choose New players or Existing players.');
      const {names}=parsePlayerImport(club,cleanString(action.text,30000),(action.mode??'mixed') as ImportMode); if (!names.length) throw new Error('Paste at least one name.');
      const initialRatings=parseInitialRatings(names,action.initialRatings,(action.mode??'mixed') as ImportMode);
      // Older saved rounds need their original eligibility retained before adding late arrivals.
      for(const r of t.rounds)r.eligiblePlayers??=[...t.roster];
      for (const name of names) {
        let p=club.players.find(p=>normalName(p.name)===normalName(name));
        if (!p) { p={id:crypto.randomUUID(),name,initialRating:initialRatings.get(normalName(name))??club.startingRating,createdAt:now};club.players.push(p); }
        if (p.archived) p.archived=false;
        if (!t.roster.includes(p.id)) t.roster.push(p.id);
        t.withdrawn=t.withdrawn.filter(id=>id!==p.id);
        const round=t.rounds.at(-1);
        if(round){
          if(!round.eligiblePlayers!.includes(p.id))round.eligiblePlayers!.push(p.id);
          if(!round.games.some(game=>game.white===p.id||game.black===p.id)){
            round.unpaired??=[];
            if(!round.unpaired.includes(p.id))round.unpaired.push(p.id);
          }
        }
      }
      if (t.roster.length>200 || club.players.length>2000) throw new Error('Club capacity reached. Export an archive before continuing.');
      if(t.mode==='tournament'&&t.rounds.length)t.seeds=tournamentSeeds(club,t);
      detail=`Imported ${names.length} names into ${t.name}${initialRatings.size?`; ${initialRatings.size} starting ratings supplied`:''}`; break;
    }
    case 'deletePlayer': {
      if(action.confirm!==true)throw new Error('Confirm player deletion.');
      const id=cleanString(action.playerId),player=club.players.find(p=>p.id===id);
      if(!player)throw new Error('Player not found.');
      let hasHistory=false;
      for(const t of club.tournaments){
        t.roster=t.roster.filter(p=>p!==id);t.withdrawn=t.withdrawn.filter(p=>p!==id);
        for(const r of t.rounds){
          const waiting=new Set((r.unpaired??[]).filter(p=>p!==id));
          r.games=r.games.filter(g=>{
            if(g.white!==id&&g.black!==id)return true;
            if(resultLocked(g)){hasHistory=true;return true;}
            const other=g.white===id?g.black:g.white;
            if(other&&t.status!=='completed'&&r.number===t.rounds.length&&t.roster.includes(other)&&!t.withdrawn.includes(other))waiting.add(other);
            return false;
          });
          if(r.unpaired||waiting.size)r.unpaired=[...waiting];
        }
      }
      if(hasHistory)club.deletedPlayers=[...(club.deletedPlayers??[]),{id,initialRating:player.initialRating}];
      club.players=club.players.filter(p=>p.id!==id);
      detail=`Deleted player ${player.name}; recorded games and other ratings preserved`;break;
    }
    case 'attendance': {
      const t=event(); if (t.status==='completed') throw new Error('This session is completed.'); const id=cleanString(action.playerId);
      if (!club.players.some(p=>p.id===id)) throw new Error('Player not found.');
      if (!t.rounds.length) { t.roster=t.roster.filter(x=>x!==id); if (action.present===true) t.roster.push(id); }
      else { if (!t.roster.includes(id)) throw new Error('Cannot add new players after pairings have started.'); t.withdrawn=t.withdrawn.filter(x=>x!==id); if (action.present!==true) t.withdrawn.push(id); changePendingAttendance(t,id,action.present===true); }
      detail=`${action.present===true?'Checked in':'Withdrew'} ${club.players.find(p=>p.id===id)!.name}`; break;
    }
    case 'publishRound': {
      const t=event();if(t.mode==='tournament')t.seeds=tournamentSeeds(club,t); const expected=pairRound(club,t,action.allowRematches===true);
      // Pair server-side; the submitted preview is display-only, never trusted as state.
      expected.publishedAt=now; t.rounds.push(expected);t.status='running';detail=`Published ${t.name}, round ${expected.number}`;break;
    }
    case 'result': {
      const t=event(); if (t.status==='completed') throw new Error('Reopen the session to correct a result.');
      const r=t.rounds.find(r=>r.number===Number(action.round)); if(!r)throw new Error('Round not found.');
      const g=r.games.find(g=>g.id===action.gameId);if(!g || !g.black)throw new Error('Game not found or is a bye.');
      if([g.white,g.black].some(id=>!club.players.some(p=>p.id===id)))throw new Error('This game is locked because a player was deleted.');
      if (r.number!==t.rounds.length) throw new Error('Earlier rounds are locked after the next round is published.');
      const result=action.result as Result; if (!['white','black','draw','forfeit-white','forfeit-black',null].includes(result)) throw new Error('Invalid result.');
      if(result&&['white','black','draw'].includes(result)&&!g.ratingBefore){
        // Use this round's starting ratings, including corrections made before scoring.
        const beforeRound=structuredClone(club);
        const copy=beforeRound.tournaments.find(event=>event.id===t.id)!.rounds.find(round=>round.number===r.number)!;
        for(const game of copy.games)game.result=null;
        const ratings=calculateStats(beforeRound);
        g.ratingBefore={white:ratings[g.white].rating,black:ratings[g.black].rating};
      }
      if (result && ['white','black','draw'].includes(result) && g.kFactor === undefined) g.kFactor = club.kFactor;
      detail=`${t.name}, R${r.number}, board ${g.board}: ${g.result??'pending'} → ${result??'pending'}`;g.result=result;
      if(result===null)for(const id of [g.white,g.black].filter((id):id is string=>!!id))if(t.withdrawn.includes(id))changePendingAttendance(t,id,false);
      break;
    }
    case 'assignBye': {
      const t=event(); if(t.status==='completed')throw new Error('Reopen the session before assigning a bye.');
      const r=t.rounds.find(r=>r.number===Number(action.round));if(!r||r.number!==t.rounds.length)throw new Error('Only the latest round can be edited.');
      const id=cleanString(action.playerId);
      if(!r.unpaired?.includes(id)||t.withdrawn.includes(id))throw new Error('Choose a waiting player.');
      if(r.games.some(g=>g.black===null))throw new Error('This round already has a bye.');
      const pairs=r.games.filter(g=>!resultLocked(g)).map(g=>({id:g.id,white:g.white,black:g.black}));
      replacePendingPairings(t,r,[...pairs,{white:id,black:null}],false,priorSeriesSessions(club,t));
      detail=`Assigned bye to ${club.players.find(p=>p.id===id)!.name}, ${t.name}, R${r.number}`;break;
    }
    case 'editPairings': {
      const t=event(); if(t.status==='completed')throw new Error('Reopen the session before editing pairings.');
      const r=t.rounds.find(r=>r.number===Number(action.round));if(!r||r.number!==t.rounds.length)throw new Error('Only the latest round can be edited.');
      replacePendingPairings(t,r,action.pairings,action.allowRematches===true,priorSeriesSessions(club,t));
      detail=`Edited ${t.name}, round ${r.number} pairings`;break;
    }
    case 'pairWaiting': {
      const t=event();if(t.status==='completed')throw new Error('Reopen the session before editing pairings.');
      const r=t.rounds.at(-1);if(!r||r.number!==Number(action.round))throw new Error('Only the latest round can be edited.');
      const waiting=[...(r.unpaired??[])].filter(id=>!t.withdrawn.includes(id));if(waiting.length<2)throw new Error('At least two players must be waiting.');
      const existing=r.games.filter(g=>!resultLocked(g)).map(g=>({id:g.id,white:g.white,black:g.black}));
      const generated=pairRound(club,{...t,roster:waiting,rounds:t.rounds.slice(0,-1)},action.allowRematches===true,true);
      if(!generated.games.length)throw new Error('No pairing available without rematches. Players remain waiting.');
      replacePendingPairings(t,r,[...existing,...generated.games.map(g=>({white:g.white,black:g.black}))],action.allowRematches===true,priorSeriesSessions(club,t),true);
      detail=`Paired waiting players in ${t.name}, round ${r.number}`;break;
    }
    case 'finishSession': { const t=event(); if(t.rounds.some(r=>r.unpaired?.length))throw new Error('Pair the waiting players before finishing.');if (!t.rounds.length || t.rounds.some(r=>r.games.some(g=>!g.result)))throw new Error('Record all results before finishing.');if(t.rounds.length<t.maxRounds && action.confirmEarly!==true)throw new Error('Confirm that you want to finish before all rounds have been played.');t.status='completed';detail=`Finalized ${t.name}`;break; }
    case 'reopenSession': { const t=event(); if(orderedTournaments(club).at(-1)?.id!==t.id)throw new Error('Only the latest session can be reopened.');if(club.tournaments.some(x=>x.id!==t.id && x.status!=='completed'))throw new Error('Finish the active session first.');t.status=t.rounds.length?'running':'registration';detail=`Reopened ${t.name}`;break; }
    case 'addManager': {
      if(actor.role!=='owner')throw new Error('Only the admin can manage access.');const email=cleanString(action.email,254).toLowerCase();if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))throw new Error('Enter a valid email address.');if(club.members.some(m=>m.email===email))throw new Error('This manager already has access.');club.members.push({id:crypto.randomUUID(),email,role:'manager'});detail=`Added manager ${email}`;break;
    }
    case 'removeManager': { if(actor.role!=='owner')throw new Error('Only the admin can manage access.');const m=club.members.find(m=>m.id===action.memberId);if(!m || m.role==='owner')throw new Error('The admin cannot be removed.');club.members=club.members.filter(x=>x.id!==m.id);detail=`Removed manager ${m.email}`;break; }
    default: throw new Error('Unknown action.');
  }
  club.audit.unshift({id:crypto.randomUUID(),at:now,actor:actor.username??actor.email,action:action.type,detail});
  calculateStats(club); // Validate all participant references and rating history before saving.
  return club;
}
export function demoClub(): Club {
  const club=newClub(); const names=['Alex Chen','Maya Patel','Daniel Kim','Sofia Rodriguez','Ethan Wang','Olivia Nguyen','Lucas Martin','Aisha Ahmed','Noah Thompson','Emma Li','Leo Zhang','Isabella Brown','Jack Wilson','Chloe Park','Arjun Shah','Grace Liu','Benjamin Lee','Zoe Davis','Ryan Singh','Ella Taylor','William Wu','Amelia Scott','Nathan Huang','Lily Anderson','Owen Clark','Hannah Zhao','Samuel Young','Eva Moore','Adam Ali','Charlotte White'];
  club.players=names.map((name,i)=>({id:`demo-${i}`,name,initialRating:1450-i*24,createdAt:'2026-09-01T12:00:00Z'}));
  for(let week=0;week<3;week++){const t: Tournament={id:`week-${week}`,name:`Weekly session ${week+1}`,date:`2026-10-${String(1+week*3).padStart(2,'0')}`,signupUrl:'',timeControl:'10 + 5',maxRounds:2,roster:club.players.map(p=>p.id),withdrawn:[],rounds:[],status:'registration',createdAt:`2026-10-01T${12+week}:00:00Z`};club.tournaments.push(t);for(let r=0;r<2;r++){const round=pairRound(club,t);round.publishedAt=t.createdAt;round.games.forEach((g,i)=>{if(g.black)g.result=i%5===0?'draw':(i+week+r)%3?'white':'black';});t.rounds.push(round);}t.status='completed';}
  club.tournaments.push({id:'current-demo',name:'Weekly session 4',date:'2026-10-10',signupUrl:'',timeControl:'10 + 5',maxRounds:2,roster:club.players.map(p=>p.id),withdrawn:[],rounds:[],status:'registration',createdAt:'2026-10-10T12:00:00Z'});
  return club;
}
