import test from 'node:test';
import assert from 'node:assert/strict';
import {ViewerSelection} from '../selection.mjs';
import {filteredObjects,mmiStatus,proxyType} from '../statistics.mjs';
const guid='0000000000000000000001';
const object=(documentId='one',extra={})=>({globalId:guid,buildingId:'b',documentId,type:'IFCBUILDINGELEMENTPROXY',properties:{},...extra});
function viewer(){const highlighted=new Set(['old']);const calls=[];return {highlighted,calls,api:{getProjectId:async()=>123,findObjects:async()=>[`one~${guid}`,`two~${guid}`],getObjectInfo:async id=>({guid:id,document:id.split('~')[0],properties:{'Global Id':guid}}),deHighlightAllObjects:()=>{calls.push('clear');highlighted.clear();return new Promise(()=>{});},getViewportState:async()=>({highlightedObjects:[...highlighted]}),highlightObject:async id=>{calls.push(id);highlighted.add(id);}}};}
test('status click uses the same MMI definition and model scope as displayed counts',()=>{
  const a=object('one',{properties:{'P~MMI':100,'Other~MMI':200}}),b=object('two'),c=object('one',{type:'IFCPROXY',properties:{'Other~MMI':100}});
  const data={models:[{buildingId:'b',documentId:'one',layer:'RIB'},{buildingId:'b',documentId:'two',layer:'RIE'}],objects:[a,b,c]};
  const subset=filteredObjects(data,'b|RIB');assert.deepEqual(subset,[a,c]);assert.equal(subset.filter(o=>mmiStatus(o,'P~MMI')==='Mangler MMI').length,1);assert.equal(mmiStatus(a),'Motstridende MMI');assert.equal(mmiStatus(a,'P~MMI'),'100');assert.equal(subset.filter(o=>proxyType(o)==='proxy').length,1);
});
test('selection resolves actual viewer IDs and document ownership, replacing previous selection',async()=>{
  const host=viewer(),selection=new ViewerSelection(host.api);const result=await selection.select([object('two')],'123');assert.equal(result.selected,1);assert.equal(result.missing,0);assert.deepEqual([...host.highlighted],[`two~${guid}`]);assert.equal(host.calls[0],'clear');
});
test('a source object missing in published 3D does not select an unrelated file or clear the previous selection',async()=>{
  const host=viewer(),selection=new ViewerSelection(host.api);await assert.rejects(selection.select([object('absent')],'123'),/Ingen av objektene/);assert.deepEqual([...host.highlighted],['old']);
});
test('project changes are checked before modifying selection',async()=>{
  const host=viewer(),selection=new ViewerSelection(host.api);await assert.rejects(selection.select([object()],'other'),/Prosjektet er endret/);assert.deepEqual(host.calls,[]);
});
test('a newer click wins even when an earlier highlight finishes late',async()=>{
  const host=viewer(),selection=new ViewerSelection(host.api);let release,started;const waiting=new Promise(resolve=>{started=resolve;});const highlight=host.api.highlightObject;host.api.highlightObject=async id=>{if(id.startsWith('one~')){started();await new Promise(resolve=>{release=resolve;});}await highlight(id);};
  const first=selection.select([object('one')],'123');await waiting;const second=selection.select([object('two')],'123');release();assert.equal((await first).cancelled,true);await second;assert.deepEqual([...host.highlighted],[`two~${guid}`]);
});
test('clear selection handles hosts whose clear promise never resolves',async()=>{
  const host=viewer(),selection=new ViewerSelection(host.api);const result=await selection.select([],'123');assert.equal(result.selected,0);assert.equal(host.highlighted.size,0);
});
test('broad search results are filtered by IFC GlobalId before looking up file ownership',async()=>{
  const host=viewer(),lookedUp=[];host.api.findObjects=async()=>['0000000000000000000099',`two~${guid}`];const info=host.api.getObjectInfo;host.api.getObjectInfo=async id=>{lookedUp.push(id);return info(id);};
  await new ViewerSelection(host.api).select([object('two')],'123');assert.ok(!lookedUp.includes('0000000000000000000099'));assert.deepEqual([...host.highlighted],[`two~${guid}`]);
});
