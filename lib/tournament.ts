import type { Club, Game, Round, Tournament } from './chess';
import { calculateStats, gameScore, weeklyStandings } from './chess.ts';

export type TournamentSeed = { number:number; rating:number };
export const TIE_BREAK_ORDER = 'Points → Direct encounter → Buchholz Cut 1 → Buchholz → Sonneborn-Berger → wins';

// FIDE 2026 article 6: rank a tied group, not individual pairs in a sort
// comparator (which would give inconsistent results for circular wins).
function directEncounterGroups(ids:string[],games:Game[],values:Map<string,number>){
  const meetings=new Map(ids.map(id=>[id,new Map<string,{score:number;count:number}>()]));
  for(const game of games){
    if(!game.black||!['white','black','draw'].includes(game.result??''))continue;
    if(!meetings.has(game.white)||!meetings.has(game.black))continue;
    for(const [id,opponent] of [[game.white,game.black],[game.black,game.white]]){
      const record=meetings.get(id)!.get(opponent)??{score:0,count:0};
      record.score+=gameScore(game,id);record.count++;meetings.get(id)!.set(opponent,record);
    }
  }
  const equal=(a:number,b:number)=>Math.abs(a-b)<1e-9;
  const resolve=(group:string[]):string[][]=>{
    if(group.length<2)return [group];
    const table=group.map(id=>{
      let score=0,missing=0;
      for(const other of group)if(id!==other){
        const record=meetings.get(id)!.get(other);
        if(record)score+=record.score/record.count;else missing++;
      }
      return {id,score,missing};
    });
    if(table.every(row=>row.missing===0)){
      // Average repeated encounters, and reapply DE to each smaller tied subset.
      table.sort((a,b)=>b.score-a.score);
      const buckets:typeof table[]=[];
      for(const row of table){
        if(!values.has(row.id))values.set(row.id,row.score);
        const last=buckets.at(-1);
        if(last&&equal(last[0].score,row.score))last.push(row);else buckets.push([row]);
      }
      if(buckets.length===1)return [group];
      return buckets.flatMap(bucket=>resolve(bucket.map(row=>row.id)));
    }
    // Incomplete Swiss mini-leagues can decide a place only if it is guaranteed
    // even when every missing game has the least favourable result for the leader.
    const leader=table.find(row=>table.every(other=>other.id===row.id||row.score>other.score+other.missing+1e-9));
    if(!leader)return [group];
    if(!values.has(leader.id))values.set(leader.id,leader.score);
    return [[leader.id],...resolve(group.filter(id=>id!==leader.id))];
  };
  return resolve(ids);
}

// Freeze pairing numbers at first publication. Late entrants are appended, never reseeded.
export function tournamentSeeds(club:Club,event:Tournament):Record<string,TournamentSeed>{
  const seeds={...event.seeds},stats=calculateStats(club);
  let number=Math.max(0,...Object.values(seeds).map(seed=>seed.number));
  const fresh=event.roster.filter(id=>!seeds[id]).map(id=>club.players.find(p=>p.id===id)).filter(p=>p!==undefined)
    .sort((a,b)=>stats[b.id].rating-stats[a.id].rating||a.name.localeCompare(b.name)||a.id.localeCompare(b.id));
  for(const player of fresh)seeds[player.id]={number:++number,rating:stats[player.id].rating};
  return seeds;
}

type RecordEntry = { game?:Game; score:number; opponent:string|null; played:boolean; pending:boolean; voluntary:boolean; requested:boolean };
export function tournamentStandings(club:Club,event:Tournament){
  const seeds=tournamentSeeds(club,event),stats=calculateStats(club);
  const roundLimit=event.status==='completed'?event.rounds.length:event.maxRounds;
  const ids=new Set([...event.roster,...event.rounds.flatMap(r=>r.games.flatMap(g=>g.black?[g.white,g.black]:[g.white]))]);
  const records=new Map<string,RecordEntry[]>();
  for(const id of ids)records.set(id,event.rounds.map(round=>{
    const game=round.games.find(g=>g.white===id||g.black===id);
    const pending=game?game.result===null:!!round.unpaired?.includes(id)||(!event.withdrawn.includes(id)&&round.games.some(g=>!g.result));
    const score=game?.result?gameScore(game,id):0;
    const played=!!game?.black&&['white','black','draw'].includes(game.result??'');
    return {game,score,opponent:game?(game.white===id?game.black:game.white):null,played,pending,
      voluntary:!pending&&!played&&score===0,requested:!pending&&!game};
  }));
  const scores=new Map([...records].map(([id,list])=>[id,list.reduce((n,r)=>n+r.score,0)]));
  // FIDE 2026 articles 16.3–16.5: tail zero-point absences become draws for
  // opponents' tie-breaks; own unplayed rounds use capped dummy opponents.
  const adjusted=new Map([...records].map(([id,list])=>[id,list.reduce((sum,r,index)=>sum+
    (r.requested&&list.slice(index+1).every(next=>next.voluntary||next.pending)?.5:r.score),0)]));
  const rows=event.roster.filter(id=>club.players.some(p=>p.id===id)).map(id=>{
    const list=records.get(id)??[],points=scores.get(id)??0;
    const contributions=list.filter(r=>!r.pending).map(r=>{
      const opponentScore=r.played?(adjusted.get(r.opponent!)??0):Math.min(points,
        r.game?.black?(adjusted.get(r.opponent!)??0):roundLimit*.5);
      return {value:opponentScore,weighted:opponentScore*r.score,voluntary:r.voluntary};
    });
    const buchholz=contributions.reduce((n,c)=>n+c.value,0);
    const cuts=contributions.some(c=>c.voluntary)?contributions.filter(c=>c.voluntary):contributions;
    const cut=cuts.length?Math.min(...cuts.map(c=>c.value)):0;
    return {id,name:club.players.find(p=>p.id===id)!.name,points,buchholzCut1:buchholz-cut,buchholz,
      sonnebornBerger:contributions.reduce((n,c)=>n+c.weighted,0),wins:list.filter(r=>r.played&&r.score===1).length,
      rating:stats[id].rating,seed:seeds[id]?.number??0,withdrawn:event.withdrawn.includes(id),rank:0,tied:false};
  });
  const directValues=new Map<string,number>(),directOrder=new Map<string,number>(),scoreGroups=new Map<number,string[]>();
  for(const row of rows){const group=scoreGroups.get(row.points)??[];group.push(row.id);scoreGroups.set(row.points,group);}
  const games=event.rounds.flatMap(round=>round.games);
  for(const group of scoreGroups.values())directEncounterGroups(group,games,directValues)
    .forEach((bucket,index)=>bucket.forEach(id=>directOrder.set(id,index)));
  const ranked=rows.map(row=>({...row,directEncounter:directValues.get(row.id)??null}));
  const compare=(a:typeof ranked[number],b:typeof ranked[number])=>b.points-a.points||directOrder.get(a.id)!-directOrder.get(b.id)!||b.buchholzCut1-a.buchholzCut1||b.buchholz-a.buchholz||b.sonnebornBerger-a.sonnebornBerger||b.wins-a.wins;
  ranked.sort((a,b)=>compare(a,b)||a.seed-b.seed||a.name.localeCompare(b.name));
  ranked.forEach((row,index)=>{
    row.rank=index&&compare(ranked[index-1],row)===0?ranked[index-1].rank:index+1;
    row.tied=(index>0&&compare(ranked[index-1],row)===0)||(index+1<ranked.length&&compare(row,ranked[index+1])===0);
  });
  return ranked;
}

type PairPlayer = ReturnType<typeof weeklyStandings>[number] & { seed:number; colours:string[]; byeEligible:boolean };
type Choice = { a:PairPlayer; b:PairPlayer; white:PairPlayer; cost:number[]; colourWarning:boolean };
const compareCost=(a:number[],b:number[])=>{for(let i=0;i<a.length;i++)if(a[i]!==b[i])return a[i]-b[i];return 0;};

// A bounded Dutch-style Swiss matcher for club tournaments. It honours score
// groups, split-half seeds and colour preferences, with reviewed manual fallback.
// It is not a FIDE-certified pairing engine.
export function pairTournamentRound(club:Club,event:Tournament,allowRematches=false,leaveUnmatched=false):Round{
  const seeds=tournamentSeeds(club,event);
  const players:PairPlayer[]=weeklyStandings(club,event).filter(p=>!event.withdrawn.includes(p.id)).map(p=>{
    const games=event.rounds.flatMap(r=>r.games.filter(g=>g.white===p.id||g.black===p.id));
    const played=games.filter(g=>g.black&&['white','black','draw'].includes(g.result??''));
    return {...p,seed:seeds[p.id].number,colours:played.map(g=>g.white===p.id?'white':'black'),
      colourBalance:played.reduce((n,g)=>n+(g.white===p.id?1:-1),0),
      byeEligible:!games.some(g=>!['white','black','draw'].includes(g.result??'')&&gameScore(g,p.id)===1)};
  }).sort((a,b)=>b.points-a.points||a.seed-b.seed);
  if(players.length<2&&!event.rounds.length)throw new Error('Check in at least two players to generate pairings.');
  if(!players.length)throw new Error('No players are checked in.');
  const odd=players.length%2&&!leaveUnmatched;
  const byes=odd?players.filter(p=>p.byeEligible).sort((a,b)=>a.points-b.points||b.seed-a.seed):[undefined];
  if(!byes.length)throw new Error('No player is eligible for another full-point bye. Adjust attendance or edit pairings.');
  let chosen:Choice[]|null=null,bye:PairPlayer|undefined,waiting:PairPlayer[]=[];
  for(const candidate of byes){
    const pool=players.filter(p=>p.id!==candidate?.id),groups=new Map<number,PairPlayer[]>();
    for(const p of pool){if(!groups.has(p.points))groups.set(p.points,[]);groups.get(p.points)!.push(p);}
    const edges=new Map<string,Choice>();
    for(let i=0;i<pool.length;i++)for(let j=i+1;j<pool.length;j++){
      const a=pool[i],b=pool[j];if(!allowRematches&&a.opponents.includes(b.id))continue;
      const colourCost=(white:PairPlayer,black:PairPlayer)=>{
        const violations=Number(Math.abs(white.colourBalance+1)>2)+Number(Math.abs(black.colourBalance-1)>2)+
          Number(white.colours.slice(-2).join(',')==='white,white')+Number(black.colours.slice(-2).join(',')==='black,black');
        const preference=Math.abs(white.colourBalance+1)+Math.abs(black.colourBalance-1)+
          Number(white.colours.at(-1)==='white')+Number(black.colours.at(-1)==='black');
        return [violations,preference];
      };
      const aw=colourCost(a,b),bw=colourCost(b,a),aWhite=compareCost(aw,bw)<0||(compareCost(aw,bw)===0&&(a.seed+event.rounds.length)%2===1);
      const colour=aWhite?aw:bw,group=groups.get(a.points)!,ia=group.indexOf(a),ib=group.indexOf(b),half=Math.floor(group.length/2);
      const split=a.points===b.points?((ia<half)===(ib<half)?group.length:0)+Math.abs(Math.abs(ia-ib)-half):group.length-1-ia;
      edges.set([a.id,b.id].sort().join('|'),{a,b,white:aWhite?a:b,cost:[Math.abs(a.points-b.points),colour[0],split,colour[1]],colourWarning:colour[0]>0});
    }
    const edge=(a:PairPlayer,b:PairPlayer)=>edges.get([a.id,b.id].sort().join('|'));
    let attempts=0,best:Choice[]|null=null,bestCost:number[]|null=null,bestWaiting:PairPlayer[]=[];
    const search=(remaining:PairPlayer[],matches:Choice[],cost:number[],unmatched:PairPlayer[])=>{
      if(++attempts>30000)return;
      if(best&&matches.length+Math.floor(remaining.length/2)<best.length)return;
      if(bestCost&&matches.length+Math.floor(remaining.length/2)===best!.length&&compareCost(cost,bestCost)>0)return;
      if(!remaining.length){
        if(!best||matches.length>best.length||(matches.length===best.length&&compareCost(cost,bestCost!)<0)){
          best=[...matches];bestCost=cost;bestWaiting=unmatched;
        }return;
      }
      if(!leaveUnmatched&&remaining.length%2)return;
      const a=remaining[0],choices=remaining.slice(1).map(b=>edge(a,b)).filter((c):c is Choice=>!!c).sort((x,y)=>compareCost(x.cost,y.cost));
      for(const match of choices){const b=match.a.id===a.id?match.b:match.a;
        search(remaining.filter(p=>p.id!==a.id&&p.id!==b.id),[...matches,match],cost.map((n,i)=>n+match.cost[i]),unmatched);
      }
      if(leaveUnmatched)search(remaining.slice(1),matches,cost,[...unmatched,a]);
    };
    search(pool,[],[0,0,0,0],[]);
    if(best!==null){chosen=best;bye=candidate;waiting=bestWaiting;break;}
  }
  if(chosen===null)throw new Error('No Swiss pairing found without repeat opponents. Review attendance or edit pairings.');
  const warnings:string[]=[],games:Game[]=(chosen as Choice[]).map((pair,index)=>{
    if(pair.a.points!==pair.b.points)warnings.push(`${pair.a.name} and ${pair.b.name} have different scores.`);
    if(pair.a.opponents.includes(pair.b.id))warnings.push(`${pair.a.name} and ${pair.b.name} have already played in this tournament.`);
    if(pair.colourWarning)warnings.push(`Review colours for ${pair.a.name} and ${pair.b.name}.`);
    return {id:crypto.randomUUID(),board:index+1,white:pair.white.id,black:pair.white.id===pair.a.id?pair.b.id:pair.a.id,result:null};
  });
  if(bye)games.push({id:crypto.randomUUID(),board:games.length+1,white:bye.id,black:null,result:'bye'});
  return {number:event.rounds.length+1,games,warnings,publishedAt:'',eligiblePlayers:[...event.roster],...(leaveUnmatched?{unpaired:waiting.map(p=>p.id)}:{})};
}
