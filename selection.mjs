import {withTimeout} from './streambim.mjs';
import {values} from './statistics.mjs';
const ifcGuid=value=>String(value||'').split('~').at(-1);
export class ViewerSelection {
  constructor(api){this.api=api;this.version=0;this.queue=Promise.resolve();this.cache=new Map();}
  invalidate(){this.version++;}
  async resolve(object) {
    const key=`${object.buildingId}:${object.documentId}:${object.globalId}`;
    if(this.cache.has(key))return this.cache.get(key);
    if(!/^[0-3][0-9A-Za-z_$]{21}$/.test(object.globalId||''))return [];
    const matches=info=>{
      const documentId=values(info?.document??info?.properties?.['@Document Id'])[0];
      const guid=ifcGuid(values(info?.properties?.['Global Id']??info?.guid)[0]||object.globalId);
      return String(documentId)===String(object.documentId)&&guid===object.globalId&&(!info?.building||String(info.building)===String(object.buildingId));
    };
    try {
      const info=await withTimeout(this.api.getObjectInfo(object.globalId),10000);
      if(matches(info)){const result=[object.globalId];this.cache.set(key,result);return result;}
    }catch{}
    let candidates=[];
    try {
      const result=await withTimeout(this.api.findObjects({key:'Global Id',value:object.globalId,limit:1000}),10000);
      if(Array.isArray(result))candidates=result.map(item=>typeof item==='string'?item:item?.guid).filter(id=>id&&ifcGuid(id)===object.globalId);
    }catch{}
    // Some deployed hosts ignore the search filter and return all GUIDs.
    // Verify GlobalId and file ownership before using any returned identifier.
    const resolved=[];
    for(const candidate of [...new Set(candidates)]) {
      try {
        const info=await withTimeout(this.api.getObjectInfo(candidate),10000);
        if(matches(info))resolved.push(candidate);
      }catch{}
    }
    if(resolved.length)this.cache.set(key,resolved);
    return resolved;
  }
  select(objects,projectId,progress=()=>{}) {
    const version=++this.version,current=()=>version===this.version;
    const task=async()=>{
      if(!current())return {cancelled:true};
      if(String(await withTimeout(this.api.getProjectId()))!==String(projectId))throw new Error('Prosjektet er endret. Oppdater widgeten før du markerer objekter.');
      const guids=new Set();let missing=0,index=0;
      // Resolve file ownership before changing the viewer, with bounded load.
      await Promise.all(Array.from({length:Math.min(4,objects.length)},async()=>{
        while(index<objects.length&&current()) {
          const object=objects[index++],found=await this.resolve(object);
          if(!found.length)missing++;for(const guid of found)guids.add(guid);
          if(current())progress(`Finner objekter i 3D · ${guids.size} funnet …`);
        }
      }));
      if(!current())return {cancelled:true};
      if(objects.length&&!guids.size)throw new Error('Ingen av objektene ble funnet i publisert 3D. Originalfilen kan ha en annen revisjon.');
      if(String(await withTimeout(this.api.getProjectId()))!==String(projectId))throw new Error('Prosjektet er endret. Oppdater widgeten.');
      Promise.resolve(this.api.deHighlightAllObjects()).catch(()=>{});
      const cleared=await withTimeout(this.api.getViewportState());
      if(!current())return {cancelled:true};
      if(cleared?.highlightedObjects?.length)throw new Error('StreamBIM fjernet ikke forrige markering. Prøv igjen.');
      const failed=[];
      for(const guid of guids) {
        if(!current())return {cancelled:true};
        try{await withTimeout(this.api.highlightObject(guid));}catch{failed.push(guid);}
      }
      if(!current())return {cancelled:true};
      const viewport=await withTimeout(this.api.getViewportState());
      if(!current())return {cancelled:true};
      const selected=new Set(viewport?.highlightedObjects||[]);
      const confirmed=[...guids].filter(guid=>selected.has(guid)).length;
      if(guids.size&&!confirmed)throw new Error('StreamBIM bekreftet ikke markeringen. Prøv igjen.');
      return {selected:confirmed,missing,failed:guids.size-confirmed,requested:objects.length};
    };
    const result=this.queue.catch(()=>{}).then(task);this.queue=result;return result;
  }
}
