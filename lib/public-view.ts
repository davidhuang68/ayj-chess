import { weeklyStandings, type Club, type Result, type Tournament } from './chess.ts';
import { tournamentStandings } from './tournament.ts';

export type PublicEventSummary = {id:string;name:string;date:string;mode:'weekly'|'tournament';status:Tournament['status']};
export type PublicStanding = {rank:number;tied:boolean;name:string;rating:number;points:number;withdrawn:boolean;directEncounter?:number|null;buchholzCut1?:number;buchholz?:number;sonnebornBerger?:number;wins?:number};
export type PublicEventData = PublicEventSummary & {timeControl:string;maxRounds:number;rounds:{number:number;games:{board:number;white:string;black:string|null;result:Result}[];waiting:string[]}[];standings:PublicStanding[]};
const summary=(event:Tournament):PublicEventSummary=>({id:event.id,name:event.name,date:event.date,mode:event.mode==='tournament'?'tournament':'weekly',status:event.status});

export function publicEventList(club:Club):PublicEventSummary[]{
  return club.tournaments.filter(event=>event.publicVisible===true)
    .sort((a,b)=>b.date.localeCompare(a.date)||b.createdAt.localeCompare(a.createdAt)).map(summary);
}

// An allowlist projection, never a trimmed copy of the private club document.
export function publicEventData(club:Club,eventId:string):PublicEventData|null{
  const event=club.tournaments.find(t=>t.id===eventId&&t.publicVisible===true);if(!event)return null;
  const rounds=event.rounds.filter(round=>!!round.publishedAt);
  const visible=new Set(rounds.flatMap(round=>[...round.games.flatMap(g=>g.black?[g.white,g.black]:[g.white]),...(round.unpaired??[])]));
  const published={...event,rounds,roster:event.roster.filter(id=>visible.has(id))};
  const names=new Map(club.players.map(p=>[p.id,p.name]));
  const standings:PublicStanding[]=event.mode==='tournament'
    ?tournamentStandings(club,published).map(p=>({rank:p.rank,tied:p.tied,name:p.name,rating:p.rating,points:p.points,withdrawn:p.withdrawn,
      directEncounter:p.directEncounter,buchholzCut1:p.buchholzCut1,buchholz:p.buchholz,sonnebornBerger:p.sonnebornBerger,wins:p.wins}))
    :weeklyStandings(club,published).map((p,index)=>({rank:index+1,tied:false,name:p.name,rating:p.rating,points:p.points,withdrawn:event.withdrawn.includes(p.id)}));
  return {...summary(event),timeControl:event.timeControl,maxRounds:event.maxRounds,
    rounds:rounds.map(round=>({number:round.number,games:round.games.map(g=>({board:g.board,white:names.get(g.white)??'Deleted player',black:g.black?(names.get(g.black)??'Deleted player'):null,result:g.result})),
      waiting:(round.unpaired??[]).map(id=>names.get(id)??'Deleted player')})),standings};
}
