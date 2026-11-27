export function flatten(value, prefix='', output={}) {
  for(const [key,item] of Object.entries(value||{})) {
    const path=prefix?`${prefix}~${key}`:key;
    if(item && typeof item==='object' && !Array.isArray(item)) flatten(item,path,output);
    else output[path]=item;
  }
  return output;
}
export const values=value=>(Array.isArray(value)?value.flat(Infinity):[value]).filter(v=>v!==null&&v!==undefined&&String(v).trim()!=='').map(v=>String(v).trim());
const leaf=key=>key.split(/[~:.\/]/).at(-1).replace(/[ _-]/g,'').toLowerCase();
export const isMmi=key=>['mmi','mmistatus','mmiverdi','modelmaturityindex','modellmodenhetsindeks'].includes(leaf(key));
export function normalizeMmi(value) {
  const match=value.match(/^(?:MMI\s*[-:]?\s*)?(\d{3})(?:\s*[-–:]\s*.*)?$/i);
  return match?match[1]:value;
}
const disciplines={ARK:'Arkitektur',RIB:'Bygg',RIE:'Elektro',RIV:'VVS',RIVA:'Vann og avløp',RIG:'Geoteknikk',LARK:'Landskap',RIM:'Miljø',RIBr:'Brann',MEK:'Mekanisk',MEC:'Mekanisk',RIMEK:'Mekanisk'};
export function discipline(file) {
  const explicit=file.attributes?.discipline||file.document?.attributes?.discipline;
  if(explicit)return {name:values(explicit).join(', '),names:values(explicit),source:'Modellmetadata'};
  const tokens=`${file.layer||''} ${file.name||''}`.toUpperCase().split(/[^A-ZÆØÅ0-9]+/);
  const found=Object.keys(disciplines).filter(code=>tokens.includes(code.toUpperCase()));
  const names=[...new Set(found.map(code=>['MEC','RIMEK'].includes(code)?'MEK · Mekanisk':`${code} · ${disciplines[code]}`))];
  return {name:names.length?names.join(', '):'Ukjent fag',names,source:names.length>1?'Ulike fagkoder i lag/filnavn':names.length?'Tolket fra lag/filnavn':'Ingen gjenkjennelig fagkode'};
}
export function objectRecord(row,buildingId) {
  const p=flatten(row.properties||row.attributes?.properties||row.attributes||row);
  const id=row.guid||row.id||values(p.GUID||p['Global Id'])[0];
  if(!id)throw new Error('Et objekt mangler identifikator. Kan ikke garantere korrekte antall.');
  const field=names=>Object.entries(p).find(([k])=>names.includes(leaf(k)))?.[1];
  const type=values(row.typeName||field(['ifctype','ifcentity','entity','kind','@kind','type']))[0]||'';
  return {id:String(id),buildingId:String(buildingId),properties:p,type,documentId:String(row.document??values(field(['@documentid','documentid']))[0]??''),layer:values(field(['@layer','layer','modellag']))[0]||''};
}
export function mmiStatus(o,selectedField='') {
  const matches=Object.entries(o.properties).filter(([key])=>isMmi(key));
  const raw=selectedField?values(o.properties[selectedField]):matches.flatMap(([,v])=>values(v));
  const distinct=[...new Set(raw.map(normalizeMmi))];
  return distinct.length===0?'Mangler MMI':distinct.length>1?'Motstridende MMI':distinct[0];
}
export const proxyType=o=>o.type.replace(/^Ifc/i,'').replace(/[ _-]/g,'').toLowerCase();
export function filteredObjects(data,layer='') {
  const models=data.models.filter(m=>!layer||`${m.buildingId}|${m.layer}`===layer);
  return data.objects.filter(o=>!layer||models.some(m=>m.buildingId===o.buildingId&&((o.documentId&&o.documentId===m.documentId)||(!o.documentId&&o.layer===m.layer))));
}
export function summarize(objects,selectedField='') {
  const counts=new Map(),fields=new Set();let proxy=0,buildingElementProxy=0,unknownType=0;
  for(const o of objects) {
    const type=proxyType(o);
    if(type==='proxy')proxy++;
    if(type==='buildingelementproxy')buildingElementProxy++;
    if(!type)unknownType++;
    const matches=Object.entries(o.properties).filter(([key])=>isMmi(key));matches.forEach(([key])=>fields.add(key));
    const status=mmiStatus(o,selectedField);
    counts.set(status,(counts.get(status)||0)+1);
  }
  return {total:objects.length,proxy,buildingElementProxy,unknownType,fields:[...fields].sort(),counts:[...counts].sort(([a],[b])=>a.localeCompare(b,'nb',{numeric:true}))};
}
