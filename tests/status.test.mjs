import test from 'node:test';
import assert from 'node:assert/strict';
import {objectRecord,summarize,discipline} from '../statistics.mjs';
import {StatusSource} from '../source.mjs';
import {readIfcObjects} from '../ifc-status.mjs';
const object=(id,p)=>objectRecord({guid:id,properties:p},'building');
test('counts each object once, resolves equivalent MMI and separates conflicts and missing values',()=>{
  const result=summarize([object('a',{'Pset~MMI':300,'Other~MMI':'MMI 300'}),object('b',{'MMI':[300,400]}),object('c',{'MMI':null}),object('d',{'MMI':'350 - Detaljert'})]);
  assert.equal(result.total,4);assert.deepEqual(Object.fromEntries(result.counts),{'300':1,'350':1,'Mangler MMI':1,'Motstridende MMI':1});
});
test('reads nested properties, configured MMI field and exact proxy entities',()=>{
  const objects=[object('a',{'Pset':{MMI:200},'IFC Type':'IfcBuildingElementProxy'}),object('b',{'MMI':400,'IFC Type':'IfcProxy'}),object('c',{'IFC Type':'IfcBuildingElementProxyType'}),object('d',{})];
  const result=summarize(objects,'Pset~MMI');assert.equal(result.proxy,1);assert.equal(result.buildingElementProxy,1);assert.equal(result.unknownType,1);assert.equal(Object.fromEntries(result.counts)['Mangler MMI'],3);
});
test('discipline inference requires full code tokens and preserves unknown models',()=>{
  assert.match(discipline({name:'A_RIB_model.ifc'}).name,/RIB/);assert.equal(discipline({name:'TRIBUNE.ifc'}).name,'Ukjent fag');assert.equal(discipline({attributes:{discipline:'Mekanisk'}}).source,'Modellmetadata');
});
test('all project building areas are read and inaccessible areas remain explicit',async()=>{
  const source=new StatusSource({API:{getProjectId:async()=>999}});source.list=async()=>({rows:[{id:'a'},{id:'b'}]});source.catalogue=async()=>({files:[{name:'model.ifc',documentId:'42'}]});source.original=async()=>{if(source.buildingId==='b')throw new Error('Ingen tilgang');return 'IFC';};source.parse=async()=>[object('x',{MMI:300})];
  const result=await source.project();assert.equal(result.buildings,2);assert.equal(result.models.length,2);assert.equal(result.objects.length,1);assert.equal(result.failures.length,1);assert.equal(result.projectId,'999');
});
const fixture=body=>`ISO-10303-21;HEADER;FILE_SCHEMA(('IFC4'));ENDSEC;DATA;${body}ENDSEC;END-ISO-10303-21;`;
const file={documentId:'42',buildingId:'b',layer:'RIB'};
test('IFC products get instance and inherited MMI, duplicate GUIDs remain separate instances',()=>{
  const rows=readIfcObjects(fixture(`
    #1=IFCWALL('0000000000000000000001',$,'Wall',$,$,#90,$,$);
    #2=IFCBUILDINGELEMENTPROXY('0000000000000000000001',$,'Proxy',$,$,$,$,$);
    #3=IFCPROXY('0000000000000000000003',$,'Proxy',$,$,$,$,$);
    #4=IFCBUILDINGSTOREY('0000000000000000000004',$,'Storey',$,$,#90,$,$);
    #10=IFCPROPERTYSINGLEVALUE('MMI',$,IFCLABEL('300'),$);
    #11=IFCPROPERTYSET('0000000000000000000011',$,'Status',$,(#10));
    #12=IFCRELDEFINESBYPROPERTIES('0000000000000000000012',$,$,$,(#1,#2),#11);
    #20=IFCPROPERTYSINGLEVALUE('MMI',$,IFCINTEGER(200),$);
    #21=IFCPROPERTYSET('0000000000000000000021',$,'Status',$,(#20));
    #22=IFCWALLTYPE('0000000000000000000022',$,'Type',$,$,(#21),$,$,$,$);
    #23=IFCRELDEFINESBYTYPE('0000000000000000000023',$,$,$,(#1,#3),#22);
  `),file);
  assert.equal(rows.length,3);assert.equal(new Set(rows.map(o=>o.id)).size,3);
  const result=summarize(rows);assert.deepEqual(Object.fromEntries(result.counts),{'200':1,'300':2});assert.equal(result.proxy,1);assert.equal(result.buildingElementProxy,1);
});
test('invalid and incomplete IFC files do not yield counts',()=>{
  assert.throws(()=>readIfcObjects('not IFC',file),/STEP/);assert.throws(()=>readIfcObjects(fixture('').replace('END-ISO-10303-21;',''),file),/avslutning/);
});
test('mechanical aliases describe one discipline and conflicting discipline cues stay visible',()=>{
  assert.deepEqual(discipline({name:'A_RIMEK.ifc',layer:'MEK'}).names,['MEK · Mekanisk']);assert.equal(discipline({name:'A_MEC.ifc',layer:'RIE'}).names.length,2);
});
