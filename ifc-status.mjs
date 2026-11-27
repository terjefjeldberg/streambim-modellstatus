import {records,parseArguments} from './ifc.mjs';
export function readIfcObjects(text,file) {
  if(!/^\s*\uFEFF?ISO-10303-21\s*;/i.test(text))throw new Error('Filen er ikke en STEP-serialisert IFC-fil.');
  const entities=new Map(),objects=[],sets=new Map(),instance=new Map(),types=new Map();let data=false,ended=false,schema=false;
  const keep=/^IFC(PROPERTYSINGLEVALUE|PROPERTYENUMERATEDVALUE|PROPERTYLISTVALUE|COMPLEXPROPERTY|PROPERTYSET|RELDEFINESBYPROPERTIES|RELDEFINESBYTYPE)$/;
  for(const record of records(text)) {
    if(record==='DATA'){data=true;continue;}if(record==='ENDSEC'){data=false;continue;}if(record==='END-ISO-10303-21'){ended=true;continue;}
    if(!data){if(/^FILE_SCHEMA\s*\(/.test(record)&&/IFC/i.test(record))schema=true;continue;}
    const match=record.match(/^#(\d+)\s*=\s*(IFC[A-Z0-9_]+)\s*(\([\s\S]*\))$/i);if(!match)throw new Error('Ugyldig IFC-entitet.');
    const id=Number(match[1]),type=match[2].toUpperCase(),root=/^\(\s*'[0-3][0-9A-Za-z_$]{21}'\s*,/.test(match[3]);
    if(!keep.test(type)&&!root)continue;
    entities.set(id,{type,args:parseArguments(match[3])});
  }
  if(!ended||!schema)throw new Error('IFC-filen mangler skjema eller avslutning.');
  const unwrap=value=>Array.isArray(value)?value.map(unwrap):value?.type?unwrap(value.value):value;
  function property(ref,prefix,output,seen=new Set()) {
    if(!ref?.ref||seen.has(ref.ref))return;const e=entities.get(ref.ref);if(!e)return;
    const path=`${prefix}~${e.args[0]}`;
    if(e.type==='IFCCOMPLEXPROPERTY'){for(const child of e.args[3]||[])property(child,path,output,new Set(seen).add(ref.ref));}
    else if(['IFCPROPERTYSINGLEVALUE','IFCPROPERTYENUMERATEDVALUE','IFCPROPERTYLISTVALUE'].includes(e.type))output[path]=unwrap(e.args[2]);
  }
  for(const [id,e] of entities)if(e.type==='IFCPROPERTYSET'){const result={};for(const ref of e.args[4]||[])property(ref,String(e.args[2]||'Egenskaper'),result);sets.set(id,result);}
  const add=(map,id,refs)=>{const list=map.get(id)||[];list.push(...refs);map.set(id,list);};
  for(const e of entities.values()) {
    if(e.type==='IFCRELDEFINESBYPROPERTIES') {
      const setRefs=Array.isArray(e.args[5])?e.args[5]:e.args[5]?.type?e.args[5].value:[e.args[5]];
      for(const object of e.args[4]||[])add(instance,object.ref,setRefs||[]);
    }
    if(e.type==='IFCRELDEFINESBYTYPE')for(const object of e.args[4]||[])add(types,object.ref,[e.args[5]]);
  }
  for(const [id,e] of entities) {
    // Count placed/represented product instances, including unplaced proxies.
    // Spatial containers and relationships are not physical model objects.
    if(e.type.startsWith('IFCREL')||/TYPE$/.test(e.type)||/^IFC(PROJECT|SITE|BUILDING|BUILDINGSTOREY|SPACE|SPATIALZONE|FACILITY|FACILITYPART.*|BRIDGE.*|ROAD.*|RAILWAY.*|MARINEFACILITY.*)$/.test(e.type))continue;
    if(!/^[0-3][0-9A-Za-z_$]{21}$/.test(e.args[0]||''))continue;
    if(!e.args[5]?.ref&&!e.args[6]?.ref&&!['IFCPROXY','IFCBUILDINGELEMENTPROXY'].includes(e.type))continue;
    const properties={};
    const merge=ref=>{for(const [key,value] of Object.entries(sets.get(ref?.ref)||{})){if(Object.hasOwn(properties,key))properties[key]=[properties[key],value].flat(Infinity);else properties[key]=value;}};
    for(const type of types.get(id)||[])for(const ref of entities.get(type?.ref)?.args[5]||[])merge(ref);
    const instanceProperties={};for(const ref of instance.get(id)||[])for(const [key,value] of Object.entries(sets.get(ref?.ref)||{})){if(Object.hasOwn(instanceProperties,key))instanceProperties[key]=[instanceProperties[key],value].flat(Infinity);else instanceProperties[key]=value;}
    Object.assign(properties,instanceProperties);
    objects.push({id:`${file.documentId}:#${id}`,buildingId:file.buildingId,documentId:file.documentId,layer:file.layer,type:e.type,properties});
  }
  return objects;
}
