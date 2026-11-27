export function withTimeout(promise,ms=25000) {
  let timer;return Promise.race([promise,new Promise((_,reject)=>{timer=setTimeout(()=>reject(new Error('StreamBIM svarte ikke innen tidsfristen. Prøv på nytt.')),ms);})]).finally(()=>clearTimeout(timer));
}
export const relationId=(row,name)=>row?.relationships?.[name]?.data?.id;
export function displayLayer(layer,visibility) {
  if(Object.hasOwn(visibility,layer))return layer;
  // Converter settings are encoded on source layer names (e.g. +4). Only
  // normalize when the host explicitly supplies the matching display layer.
  const plain=layer.split('~').map(part=>part.replace(/\+\d+$/,'')).join('~');
  return Object.hasOwn(visibility,plain)?plain:layer;
}
export function sourceFilesForObject(files,info) {
  const documentId=info?.document??info?.properties?.['@Document Id'];
  return documentId!==null&&documentId!==undefined?files.filter(file=>String(file.documentId)===String(documentId)):files;
}

export function buildTree(files,visibility={}) {
  const roots=[];
  function branch(path) {
    let children=roots,node;
    for(const [i,name] of path.entries()) {
      node=children.find(n=>n.kind==='layer' && n.name===name);
      if(!node){node={kind:'layer',name,path:path.slice(0,i+1).join('~'),children:[]};children.push(node);}
      children=node.children;
    }
    return children;
  }
  for(const path of Object.keys(visibility))branch(path.split('~').filter(Boolean));
  for(const file of files)branch((file.layer||'Uten lag').split('~').filter(Boolean)).push({...file,kind:'file'});
  return roots;
}

export class StreamBimSource {
  constructor(sdk){this.sdk=sdk;this.api=sdk.API;this.projectId=null;this.buildingId=null;}
  async initialize(){
    this.projectId=String(await withTimeout(this.api.getProjectId()));
    if(!this.projectId || this.projectId==='undefined')throw new Error('Kunne ikke lese aktivt prosjekt.');
    this.base=`/project-${encodeURIComponent(this.projectId)}/api/v1`;
    // getBuildingId is not exposed by all deployed widget API versions.
    if(typeof this.api.getBuildingId==='function')this.buildingId=String(await withTimeout(this.api.getBuildingId()));
    if(!this.buildingId) {
      const buildings=await this.list(`${this.base}/v2/buildings`);
      if(buildings.rows.length!==1)return {buildings:buildings.rows,needsBuilding:true};
      this.buildingId=String(buildings.rows[0].id);
    }
    return {needsBuilding:false};
  }
  async raw(url,accept='application/vnd.api+json') {
    const value=await withTimeout(this.api.makeApiRequest({url,method:'GET',accept}),accept==='text/plain'?120000:25000);
    return value;
  }
  async json(url){const raw=await this.raw(url);const result=typeof raw==='string'?JSON.parse(raw):raw;if(result?.errors)throw new Error(result.errors.map(e=>e.detail||e.title).join('; '));return result;}
  async list(path) {
    const rows=[],included=[],seen=new Set();let skip=0;
    while(true) {
      const url=`${path}${path.includes('?')?'&':'?'}page[limit]=250&page[skip]=${skip}`;
      const page=await this.json(url);if(!Array.isArray(page.data))throw new Error('Uventet svar fra StreamBIM: listen mangler data.');
      let added=0;for(const row of page.data){const key=`${row.type}:${row.id}`;if(!seen.has(key)){seen.add(key);rows.push(row);added++;}}
      included.push(...(page.included||[]));
      if(page.data.length===0 || (page.links && Object.hasOwn(page.links,'next') && !page.links.next) || (!page.links?.next && page.data.length<250))break;
      if(!added)throw new Error('StreamBIM returnerte samme side flere ganger. Listen er ikke komplett.');
      skip+=page.data.length;
      if(skip>100000)throw new Error('For mange filer til å hente i én operasjon.');
    }
    return {rows,included};
  }
  async catalogue() {
    const [result,visibility,building]=await Promise.all([
      this.list(`${this.base}/v2/ifc-files?filter[building]=${encodeURIComponent(this.buildingId)}`),
      withTimeout(this.api.getLayers()),
      this.json(`${this.base}/v2/buildings/${encodeURIComponent(this.buildingId)}`)
    ]);
    // Resolve linked documents lazily with bounded parallelism, preserving non-IFC model sources.
    const documents=new Map(result.included.filter(r=>r.type==='documents').map(r=>[String(r.id),r]));
    const files=result.rows.map(row=>{
      const attributes=row.attributes||{};
      const documentId=String(relationId(row,'document')||String(row.id).split('-').slice(1).join('-'));
      if(!documentId)throw new Error(`Modellfil ${row.id} mangler dokumentreferanse.`);
      return {id:String(row.id),documentId,layer:displayLayer(attributes['active-layer']||attributes.layer||'',visibility),attributes,raw:row,document:documents.get(documentId)};
    });
    let cursor=0;
    await Promise.all(Array.from({length:Math.min(4,files.length)},async()=>{
      while(cursor<files.length){const file=files[cursor++];
        try{if(!file.document)file.document=(await this.json(`${this.base}/v2/documents/${encodeURIComponent(file.documentId)}`)).data;
          file.name=file.document?.attributes?.filename||file.attributes.filename||`Dokument ${file.documentId}`;
        }catch(error){file.name=file.attributes.filename||`Dokument ${file.documentId}`;file.error=error.message;}
      }
    }));
    const layers={...visibility};for(const layer of building.data?.attributes?.['model-layers']||[])layers[displayLayer(layer,visibility)]??=false;
    return {files,tree:buildTree(files,layers),visibility,building};
  }
  async original(file) {
    const value=await this.raw(`${this.base}/documents/${encodeURIComponent(file.documentId)}/downloadlink`,'text/plain');
    let link=value;try{link=JSON.parse(value);}catch{}
    if(typeof link!=='string'||!link.trim())throw new Error('StreamBIM returnerte ingen lesbar nedlastingslenke.');
    link=link.trim();
    if(/^https:\/\//i.test(link)) {
      const url=new URL(link);
      const host=new URL(document.referrer||location.href).origin;
      if(url.origin===host)return await this.raw(`${url.pathname}${url.search}`,'text/plain');
      const response=await fetch(url,{credentials:'omit',signal:AbortSignal.timeout(120000)});
      if(!response.ok)throw new Error(`Originalfilen kunne ikke hentes (${response.status}).`);
      const length=Number(response.headers.get('content-length'));if(length>200*1024*1024)throw new Error('Filen er større enn grensen på 200 MB for nettleserlesing.');
      return await response.text();
    }
    if(link.startsWith('//'))throw new Error('Uventet nedlastingslenke.');
    const path=link.startsWith('/pgw/')||link.startsWith('/project-')?link:`${this.base}/${link.replace(/^\//,'')}`;
    return await this.raw(path,'text/plain');
  }
  async object(guid){return await withTimeout(this.api.getObjectInfo(guid));}
  selectPickedObject({guid,shiftKey=false}={}) {
    const version=this.selectionVersion=(this.selectionVersion||0)+1;
    // Serialize viewer changes: a slow reply from an earlier click must never
    // leave that object selected after the user's latest click.
    this.selectionQueue=(this.selectionQueue||Promise.resolve()).catch(()=>{}).then(async()=>{
      if(version!==this.selectionVersion)return;
      // The host clears native selection synchronously but never resolves the
      // deHighlightAllObjects promise. A following viewport read is the reply
      // barrier; do not use setViewportState here because its sync restores the
      // controller's old selection over the renderer selection.
      if(!shiftKey||!guid) {
        Promise.resolve(this.api.deHighlightAllObjects()).catch(()=>{});
        const viewport=await withTimeout(this.api.getViewportState());
        if(version!==this.selectionVersion)return;
        if(viewport?.highlightedObjects?.length)throw new Error('StreamBIM fjernet ikke den forrige markeringen.');
      }
      if(version!==this.selectionVersion)return;
      if(guid)await withTimeout(this.api.highlightObject(guid));
    });
    return this.selectionQueue;
  }
}
