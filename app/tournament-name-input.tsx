"use client";
import {useEffect,useId,useRef,useState} from 'react';
import {seriesKey} from '@/lib/series';

export default function TournamentNameInput({value,names,onChange,disabled=false}:{
  value:string;names:string[];onChange:(name:string)=>void;disabled?:boolean;
}){
  const id=useId(),root=useRef<HTMLDivElement>(null),input=useRef<HTMLInputElement>(null);
  const [open,setOpen]=useState(false),[query,setQuery]=useState(''),[active,setActive]=useState(-1);
  const options=names.filter(name=>seriesKey(name).includes(seriesKey(query)));
  const expanded=open&&options.length>0;
  useEffect(()=>{
    if(!open)return;
    const close=(event:PointerEvent)=>{if(!root.current?.contains(event.target as Node))setOpen(false);};
    document.addEventListener('pointerdown',close);
    return()=>document.removeEventListener('pointerdown',close);
  },[open]);
  const choose=(name:string)=>{onChange(name);setOpen(false);setActive(-1);input.current?.focus();};
  return (
    <div className="tournament-name-field" ref={root}
      onBlur={event=>{if(event.relatedTarget&&!event.currentTarget.contains(event.relatedTarget))setOpen(false);}}>
      <label htmlFor={id}>Tournament</label>
      <div className="tournament-name-control">
        <input id={id} ref={input} value={value} required maxLength={80} disabled={disabled}
          role="combobox" aria-autocomplete="list" aria-expanded={expanded}
          aria-controls={expanded?`${id}-options`:undefined}
          aria-activedescendant={expanded&&active>=0&&active<options.length?`${id}-option-${active}`:undefined}
          onClick={()=>{if(!open){setQuery('');setOpen(true);setActive(-1);}}}
          onChange={event=>{onChange(event.target.value);setQuery(event.target.value);setOpen(true);setActive(-1);}}
          onKeyDown={event=>{
            if(event.key==='ArrowDown'||event.key==='ArrowUp'){
              event.preventDefault();
              if(!expanded){setQuery('');setOpen(true);setActive(event.key==='ArrowDown'?0:names.length-1);}
              else setActive(index=>index<0?(event.key==='ArrowDown'?0:options.length-1):(index+(event.key==='ArrowDown'?1:-1)+options.length)%options.length);
            }else if(event.key==='Enter'&&expanded&&active>=0&&active<options.length){
              event.preventDefault();choose(options[active]);
            }else if(event.key==='Escape'&&open){event.preventDefault();setOpen(false);}
          }}
        />
        {names.length>0&&<button type="button" className="tournament-name-toggle"
          disabled={disabled} aria-label={expanded?'Hide tournaments':'Show tournaments'} aria-expanded={expanded}
          aria-controls={expanded?`${id}-options`:undefined}
          onClick={()=>{setQuery('');setOpen(!expanded);setActive(-1);input.current?.focus();}}>
          <span aria-hidden="true">▾</span>
        </button>}
      </div>
      {expanded&&<div id={`${id}-options`} className="tournament-name-options" role="listbox" aria-label="Existing tournaments">
        {options.map((name,index)=><button key={seriesKey(name)} id={`${id}-option-${index}`} type="button"
          role="option" aria-selected={seriesKey(name)===seriesKey(value)} tabIndex={-1}
          className={index===active?'is-active':undefined}
          onMouseDown={event=>event.preventDefault()} onMouseEnter={()=>setActive(index)}
          onClick={()=>choose(name)}>{name}</button>)}
      </div>}
    </div>
  );
}
