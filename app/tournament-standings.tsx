"use client";
import {useMemo} from 'react';
import type {Club,Tournament} from '@/lib/chess';
import {tournamentStandings,TIE_BREAK_ORDER} from '@/lib/tournament';
import {csvCell} from '@/lib/csv';

export default function TournamentStandings({club,event}:{club:Club;event:Tournament}){
  const rows=useMemo(()=>tournamentStandings(club,event),[club,event]);
  const exportStandings=()=>{
    const data=[['Rank','Name','Points','Direct encounter','Buchholz Cut 1','Buchholz','Sonneborn-Berger','Wins (played)','Elo','Status'],
      ...rows.map(row=>[row.rank,row.name,row.points,row.directEncounter??'',row.buchholzCut1,row.buchholz,row.sonnebornBerger,row.wins,row.rating,row.withdrawn?'Withdrawn':''])];
    const csv=data.map(row=>row.map(csvCell).join(',')).join('\r\n');
    const url=URL.createObjectURL(new Blob([csv],{type:'text/csv;charset=utf-8'}));
    const link=document.createElement('a');link.href=url;link.download='tournament-standings.csv';link.click();URL.revokeObjectURL(url);
  };
  return <section className="panel">
    <div className="section-heading">
      <h2>{event.status==='completed'?'Final rankings':'Tournament standings'}</h2>
      <button onClick={exportStandings}>Export standings</button>
    </div>
    <details className="tie-break-rules">
      <summary>Tie-break rules</summary>
      <p>{TIE_BREAK_ORDER}. Any remaining ties share a place.</p>
      <p>DE: results between players tied on points, reapplied to smaller tied groups. If the group has not all played each other, DE only separates a guaranteed leader; otherwise the next tie-break applies. Byes, forfeits and pending games do not count. Repeated meetings use their average score. A dash means DE is not applicable.</p>
      <p>BH-C1: opponents’ scores, dropping one contribution. BH: total opponents’ scores. SB: opponents’ scores weighted by your results. Wins: games won over the board.</p>
      <p>Byes and forfeits use adjusted opponent scores; a voluntary missed round is cut first for BH-C1. Standings are provisional until the tournament is finished.</p>
    </details>
    <div className="table-scroll"><table>
      <thead><tr><th>Rank</th><th>Name</th><th>Points</th>
        <th title="Direct encounter — first tie-break">DE</th><th title="Buchholz Cut 1 — second tie-break">BH-C1</th><th title="Buchholz — third tie-break">BH</th>
        <th title="Sonneborn-Berger — fourth tie-break">SB</th><th title="Games won over the board — fifth tie-break">Wins</th><th>Elo</th></tr></thead>
      <tbody>{rows.map(row=><tr key={row.id}>
        <td>{row.rank}{row.tied?'=':''}</td><td>{row.name}{row.withdrawn&&<small className="withdrawn-label">Withdrawn</small>}</td>
        <td><strong>{row.points}</strong></td><td>{row.directEncounter===null?'—':Number(row.directEncounter.toFixed(3))}</td><td>{row.buchholzCut1}</td><td>{row.buchholz}</td><td>{row.sonnebornBerger}</td><td>{row.wins}</td><td>{row.rating}</td>
      </tr>)}</tbody>
    </table></div>
  </section>;
}
