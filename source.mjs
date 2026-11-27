import {StreamBimSource,withTimeout} from './streambim.mjs';
import {readIfcObjects} from './ifc-status.mjs';
const errorText=error=>error?.message||error?.detail||error?.code||JSON.stringify(error)||'Ukjent feil';
export class StatusSource extends StreamBimSource {
  async parse(text,file) {
    if(typeof Worker==='undefined')return readIfcObjects(text,file);
    const worker=new Worker(new URL('./status-worker.mjs',import.meta.url),{type:'module'});
    try{return await withTimeout(new Promise((resolve,reject)=>{worker.onmessage=({data})=>data.error?reject(new Error(data.error)):resolve(data.objects);worker.onerror=()=>reject(new Error('IFC-leseren stoppet.'));worker.postMessage({text,file:{documentId:file.documentId,buildingId:file.buildingId,layer:file.layer}});}),120000);}
    finally{worker.terminate();}
  }
  async project(progress=()=>{}) {
    this.projectId=String(await withTimeout(this.api.getProjectId()));
    if(!this.projectId||['undefined','null'].includes(this.projectId))throw new Error('Kunne ikke lese aktivt prosjekt.');
    this.base=`/project-${encodeURIComponent(this.projectId)}/api/v1`;
    const {rows:buildings}=await this.list(`${this.base}/v2/buildings`);
    const models=[],objects=[],failures=[];
    for(const building of buildings) {
      this.buildingId=String(building.id);
      progress(`Leser modellag i ${building.attributes?.name||building.id} …`);
      let files;
      try{files=(await this.catalogue()).files;}catch(error){failures.push({name:building.attributes?.name||building.id,error:errorText(error)});continue;}
      for(const file of files) {
        file.buildingId=String(building.id);models.push(file);
        if(!/\.ifc$/i.test(file.name)){file.analysis='Ikke IFC';continue;}
        progress(`Leser IFC-original: ${file.name} …`);
        try {
          if(Number(file.document?.attributes?.filesize)>200*1024*1024)throw new Error('Filen er større enn 200 MB.');
          const text=await this.original(file);
          if(typeof text!=='string'||text.length>200*1024*1024)throw new Error('Filen er for stor eller har et uventet format.');
          const rows=await this.parse(text,file);for(const row of rows)objects.push(row);file.analysis=`${rows.length.toLocaleString('nb-NO')} ${rows.length===1?'objekt':'objekter'}`;
        }catch(error){file.analysis='Kunne ikke leses';failures.push({name:file.name,error:errorText(error)});}
      }
    }
    const projectId=String(await withTimeout(this.api.getProjectId()));
    if(projectId!==this.projectId)throw new Error('Prosjektet ble endret under innhentingen. Oppdater for å lese det nye prosjektet.');
    return {models,objects,failures,projectId:this.projectId,buildings:buildings.length};
  }
}
