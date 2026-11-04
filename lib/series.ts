import type { Club, Tournament } from './chess';

export function seriesKey(name:string){
  return name.normalize('NFKC').trim().replace(/\s+/g,' ').toLocaleLowerCase('en');
}
export function sessionGroups(club:Club){
  const groups=new Map<string,{key:string;name:string;sessions:Tournament[]}>();
  for(const session of [...club.tournaments].reverse()){
    const key=session.mode==='tournament'?`tournament:${session.id}`:seriesKey(session.name);
    if(!groups.has(key))groups.set(key,{key,name:session.name,sessions:[]});
    groups.get(key)!.sessions.push(session);
  }
  return [...groups.values()];
}
export function priorSeriesSessions(club:Club,event:Tournament){
  if(event.mode==='tournament')return [];
  const ordered=[...club.tournaments].sort((a,b)=>a.date.localeCompare(b.date)||a.createdAt.localeCompare(b.createdAt));
  const index=ordered.findIndex(t=>t.id===event.id);
  return index<0?[]:ordered.slice(0,index).filter(t=>t.mode!=='tournament'&&seriesKey(t.name)===seriesKey(event.name));
}
