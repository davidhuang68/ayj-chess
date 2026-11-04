import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';

const source=readFileSync(new URL('../integrations/google-sheets/Code.gs',import.meta.url),'utf8');
function fixture(){
 const props=new Map([['AYJ_RATINGS_TOKEN','a'.repeat(64)]]),receipts=[],writes=[],clears=[],logs=[],triggers=[];
 let data={schema:1,spreadsheetId:'YOUR_SPREADSHEET_ID',version:10,updatedAt:'2026-11-03T10:00:00Z',players:[{id:'id1',name:'=IMPORTXML("evil")',rating:1200,games:2,wins:1,draws:0,losses:1}]};
 let lastRow=5,owned=false,failWrite=false,failFetch=false,locked=false,released=0;
 const range={setValues(rows){if(failWrite)throw Error('secret failure');writes.push(rows);return range;},clear(){clears.push('old-columns');return range;},clearContent(){clears.push('old-rows');return range;},setFontWeight(){return range;},setBackground(){return range;},setNumberFormat(){return range;},createFilter(){return range;}};
 const sheet={getSheetId:()=>1,getDeveloperMetadata:()=>owned?[{getKey:()=>'AYJ_CHESS_RATINGS_V1'}]:[],addDeveloperMetadata(){owned=true;},getLastRow:()=>lastRow,
  getMaxRows:()=>1000,getMaxColumns:()=>26,getRange:()=>range,setFrozenRows(){},getFilter:()=>null,autoResizeColumns(){},showColumns(){}};
 const spreadsheet={getId:()=>data.spreadsheetId,getSheets:()=>[sheet],getSheetByName:()=>sheet};
 const context=vm.createContext({console:{log:msg=>logs.push(msg)},PropertiesService:{getScriptProperties:()=>({getProperty:k=>props.get(k)??null,setProperty:(k,v)=>props.set(k,v)})},
  SpreadsheetApp:{getActiveSpreadsheet:()=>spreadsheet,flush(){}},LockService:{getScriptLock:()=>({tryLock:()=>!locked,releaseLock:()=>released++})},
  UrlFetchApp:{fetch(url,options){assert.equal(url,'https://ayjchess.vercel.app/api/ratings-sync');assert.equal(options.followRedirects,false);assert.equal(options.validateHttpsCertificates,true);
   if(failFetch)throw Error('HTTP secret request');if(options.payload)receipts.push(JSON.parse(options.payload));
   return {getResponseCode:()=>200,getContentText:()=>options.payload?'{"ok":true}':JSON.stringify(data)};}},
  ScriptApp:{getProjectTriggers:()=>triggers,newTrigger:name=>({timeBased(){return this;},everyMinutes(n){assert.equal(n,1);return this;},create(){triggers.push({getHandlerFunction:()=>name});}}),deleteTrigger(t){triggers.splice(triggers.indexOf(t),1);}}
 });
 vm.runInContext(source,context);
 return {context,props,receipts,writes,clears,logs,triggers,sheet,spreadsheet,get released(){return released;},set owned(v){owned=v;},set lastRow(v){lastRow=v;},set data(v){data=v;},get data(){return data;},set failWrite(v){failWrite=v;},set failFetch(v){failFetch=v;},set locked(v){locked=v;}};
}
test('sheet sync writes literal names and full snapshot, clears stale managed rows, and acknowledges success',()=>{
 const f=fixture();f.owned=true;f.context.syncAyjRatings();
 assert.equal(f.writes.length,1);assert.equal(f.writes[0][1][0],'\'=IMPORTXML("evil")');assert.equal(f.writes[0][1][1],1200);
 assert.deepEqual(Array.from(f.writes[0][0]),['Name','Rating']);assert.ok(f.writes[0].every(row=>row.length===2));
 assert.deepEqual(f.clears,['old-columns','old-rows']);assert.equal(f.props.get('AYJ_LAST_VERSION'),'10');assert.equal(f.receipts.at(-1).status,'synced');assert.equal(f.released,1);
 f.context.syncAyjRatings();assert.equal(f.writes.length,1);assert.equal(f.receipts.length,2);
 f.context.syncAyjRatingsNow();assert.equal(f.writes.length,2);
 assert.equal(f.clears.filter(c=>c==='old-columns').length,1);
 assert.ok(!f.logs.join().includes('a'.repeat(64)));
});
test('failed sheet updates do not advance version or create timer; existing tabs remain protected',()=>{
 const f=fixture();
 assert.throws(()=>f.context.setupAyjRatingsSync(),/Could not update Ratings/);assert.equal(f.writes.length,0);assert.equal(f.triggers.length,0);
 f.owned=true;f.failWrite=true;
 assert.throws(()=>f.context.syncAyjRatings(),/Could not update Ratings/);assert.equal(f.props.get('AYJ_LAST_VERSION'),undefined);
 assert.equal(f.receipts.at(-1).code,'sheet_update_failed');assert.equal(f.released,2);
});
test('timer setup is idempotent and never removes unrelated triggers',()=>{
 const f=fixture();f.owned=true;f.triggers.push({getHandlerFunction:()=>'otherTask'});
 f.context.setupAyjRatingsSync();f.context.setupAyjRatingsSync();assert.equal(f.triggers.length,2);
 f.context.disableAyjRatingsSync();assert.equal(f.triggers.length,1);assert.equal(f.triggers[0].getHandlerFunction(),'otherTask');
});
test('overlapping runs and older/invalid snapshots cannot overwrite ratings',()=>{
 const f=fixture();f.owned=true;f.locked=true;f.context.syncAyjRatings();assert.equal(f.writes.length,0);
 f.locked=false;f.props.set('AYJ_LAST_VERSION','11');assert.throws(()=>f.context.syncAyjRatings(),/Could not connect/);assert.equal(f.writes.length,0);
 f.props.delete('AYJ_LAST_VERSION');f.data.players[0].wins=99;assert.throws(()=>f.context.syncAyjRatings(),/Could not connect/);assert.equal(f.writes.length,0);
});
