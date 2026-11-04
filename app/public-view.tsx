"use client";
import {useEffect,useState} from 'react';
import type {PublicEventData,PublicEventSummary} from '@/lib/public-view';
const results={white:'1–0',black:'0–1',draw:'½–½','forfeit-white':'1–0 (forfeit)','forfeit-black':'0–1 (forfeit)',bye:'1 (bye)'};

export default function PublicView(){
  const [events,setEvents]=useState<PublicEventSummary[]>([]),[selected,setSelected]=useState(''),
    [event,setEvent]=useState<PublicEventData|null>(null),[tab,setTab]=useState('standings'),[round,setRound]=useState(0),
    [loading,setLoading]=useState(true),[error,setError]=useState(''),[listError,setListError]=useState(''),
    [updated,setUpdated]=useState(''),[retry,setRetry]=useState(0);
  useEffect(()=>{
    const controller=new AbortController();let active=true,busy=false;
    const refresh=async()=>{
      if(busy)return;busy=true;
      try{
        const response=await fetch('/api/public',{cache:'no-store',credentials:'omit',signal:controller.signal});
        const data=await response.json() as {events?:PublicEventSummary[];error?:string};
        if(!response.ok||!Array.isArray(data.events))throw new Error(data.error??'Could not load sessions.');
        const choices=data.events;
        if(active){setEvents(choices);setListError('');setSelected(current=>current||choices[0]?.id||'');}
      }catch(e){if(active)setListError(e instanceof Error?e.message:'Could not load sessions.');}
      finally{busy=false;if(active)setLoading(false);}
    };
    void refresh();const timer=setInterval(()=>{if(document.visibilityState==='visible')void refresh();},10000);
    const focus=()=>void refresh();window.addEventListener('focus',focus);
    return()=>{active=false;controller.abort();clearInterval(timer);window.removeEventListener('focus',focus);};
  },[retry]);
  useEffect(()=>{
    if(!selected)return;
    const controller=new AbortController();let active=true,busy=false;
    const refresh=async()=>{
      if(busy)return;busy=true;
      try{
        const response=await fetch(`/api/public?event=${encodeURIComponent(selected)}`,{cache:'no-store',credentials:'omit',signal:controller.signal});
        const data=await response.json() as {event?:PublicEventData;error?:string};if(!response.ok||!data.event)throw new Error(data.error??'Public view unavailable.');
        if(active){setEvent(data.event);setError('');setUpdated(new Date().toLocaleTimeString('en-CA',{timeZone:'America/Toronto'}));}
      }catch(e){if(active){setEvent(null);setUpdated('');setError(e instanceof Error?e.message:'Could not load this session.');}}
      finally{busy=false;}
    };
    void refresh();const timer=setInterval(()=>{if(document.visibilityState==='visible')void refresh();},10000);
    const focus=()=>void refresh();window.addEventListener('focus',focus);
    return()=>{active=false;controller.abort();clearInterval(timer);window.removeEventListener('focus',focus);};
  },[selected,retry]);
  const current=event?.rounds.find(r=>r.number===round)??event?.rounds.at(-1);
  return <main className="tool public-view">
    <header><h1>AYJ Chess</h1><a href="/manage">TM Login</a></header>
    {!!events.length&&<div className="toolbar"><label>Session<select aria-label="Public session" value={selected}
      onChange={e=>{setSelected(e.target.value);setEvent(null);setError('');setRound(0);}}>
      {!events.some(e=>e.id===selected)&&<option value={selected}>Session unavailable</option>}
      {events.map(e=><option key={e.id} value={e.id}>{e.date} · {e.name}{e.status==='completed'?' · Completed':''}</option>)}
    </select></label></div>}
    {(listError||error)&&<p className="error" role="alert">{error||listError} <button onClick={()=>setRetry(n=>n+1)}>Retry</button></p>}
    {!event&&!error&&!listError&&<p role="status">{loading||selected?'Loading…':'No public tournaments yet.'}</p>}
    {event&&<>
      <div className="section-heading"><div><h2>{event.name}</h2><p>{event.date} · {event.timeControl}</p></div>
        <small>{updated&&`Updated ${updated}`}</small></div>
      <nav aria-label="Public view">
        <button aria-current={tab==='standings'?'page':undefined} onClick={()=>setTab('standings')}>Standings</button>
        <button aria-current={tab==='pairings'?'page':undefined} onClick={()=>setTab('pairings')}>Pairings</button>
      </nav>
      {tab==='pairings'?<section className="panel">
        <div className="section-heading"><h2>Pairings</h2>{current&&<label>Round<select aria-label="Public round" value={current.number} onChange={e=>setRound(Number(e.target.value))}>
          {event.rounds.map(r=><option key={r.number} value={r.number}>{r.number}</option>)}
        </select></label>}</div>
        {current?<><div className="table-scroll"><table><thead><tr><th>Board</th><th>White</th><th>Black</th><th>Result</th></tr></thead>
          <tbody>{current.games.map(g=><tr key={g.board}><td>{g.board}</td><td>{g.white}</td><td>{g.black??'Bye'}</td><td>{g.result?results[g.result]:'—'}</td></tr>)}</tbody></table></div>
          {!!current.waiting.length&&<p>Waiting: {current.waiting.join(', ')}</p>}</>:<p>Pairings not published yet.</p>}
      </section>:<section className="panel">
        <div className="section-heading"><h2>{event.status==='completed'?'Final rankings':'Standings'}</h2>{event.status!=='completed'&&<small>Provisional</small>}</div>
        <div className="table-scroll"><table><thead><tr><th>Rank</th><th>Name</th><th>Rating</th><th>Points</th>
          {event.mode==='tournament'&&<><th title="Direct encounter — first tie-break">DE</th><th title="Buchholz Cut 1">BH-C1</th><th title="Buchholz">BH</th><th title="Sonneborn-Berger">SB</th><th title="Games won over the board">Wins</th></>}
        </tr></thead><tbody>{event.standings.map((p,i)=><tr key={i}><td>{p.rank}{p.tied?'=':''}</td><td>{p.name}{p.withdrawn&&<small className="withdrawn-label">Withdrawn</small>}</td><td>{p.rating}</td><td><strong>{p.points}</strong></td>
          {event.mode==='tournament'&&<><td>{p.directEncounter==null?'—':Number(p.directEncounter.toFixed(3))}</td><td>{p.buchholzCut1}</td><td>{p.buchholz}</td><td>{p.sonnebornBerger}</td><td>{p.wins}</td></>}
        </tr>)}</tbody></table></div>
        {!event.standings.length&&<p>Standings appear after pairings are published.</p>}
      </section>}
    </>}
  </main>;
}
