// A metadata reader for IFC STEP files. Geometry is counted, never tessellated.
export function decodeStep(value) {
  return value.replace(/\\X2\\([0-9a-f]+)\\X0\\/gi, (_, hex) => {
    let result = ''; for (let i=0;i<hex.length;i+=4) result += String.fromCharCode(parseInt(hex.slice(i,i+4),16)); return result;
  }).replace(/\\X4\\([0-9a-f]+)\\X0\\/gi, (_, hex) => {
    let result = ''; for (let i=0;i<hex.length;i+=8) result += String.fromCodePoint(parseInt(hex.slice(i,i+8),16)); return result;
  }).replace(/\\X\\([0-9a-f]{2})/gi, (_,hex)=>String.fromCharCode(parseInt(hex,16)))
    .replace(/\\S\\(.)/g, (_,char)=>String.fromCharCode(char.charCodeAt(0)+128)).replace(/\\\\/g,'\\');
}

export function* records(text) {
  let start=0, quote=false, comment=false, pieces=[];
  for(let i=0;i<text.length;i++) {
    if(comment) { if(text[i]==='*' && text[i+1]==='/') { comment=false; i++; start=i+1; } continue; }
    if(!quote && text[i]==='/' && text[i+1]==='*') { pieces.push(text.slice(start,i),' ');comment=true; i++; continue; }
    if(text[i]==="'") { if(quote && text[i+1]==="'") { i++; continue; } quote=!quote; }
    if(!quote && text[i]===';') { yield (pieces.join('')+text.slice(start,i)).trim(); pieces=[];start=i+1; }
  }
  if(quote || comment || text.slice(start).trim()) throw new Error('IFC-filen er avbrutt eller har ugyldig STEP-syntaks.');
}

export function parseArguments(source) {
  let i=0;
  const skip=()=>{while(/\s/.test(source[i]||'') && i<source.length)i++;};
  function value() {
    skip(); const c=source[i++];
    if(c==='(') { const a=[]; skip(); if(source[i]===')'){i++; return a;} while(i<source.length){a.push(value());skip();const sep=source[i++];if(sep===')')return a;if(sep!==',')throw new Error('Ugyldig STEP-liste.');}throw new Error('Avbrutt STEP-liste.'); }
    if(c==="'") {let s=''; while(i<source.length){if(source[i]==="'"){i++;if(source[i]==="'"){s+="'";i++;}else return decodeStep(s);}else s+=source[i++];}throw new Error('Avbrutt STEP-tekst.');}
    if(c==='#'){let s='';while(/\d/.test(source[i]||'') && i<source.length)s+=source[i++];return {ref:Number(s)};}
    if(c==='$')return null;
    if(c==='*')return {derived:true};
    let s=c||'';while(i<source.length && !/[(),\s]/.test(source[i]))s+=source[i++];skip();
    if(source[i]==='(')return {type:s,value:value()};
    if(/^\..*\.$/.test(s))return s.slice(1,-1);
    if(s && Number.isFinite(Number(s)))return Number(s);
    return s;
  }
  const result=value();skip();if(i!==source.length)throw new Error('Uventet innhold etter STEP-verdi.');return result;
}

const metadataTypes = /^(IFC(APPLICATION|PERSON|ORGANIZATION|PERSONANDORGANIZATION|OWNERHISTORY|ACTORROLE|POSTALADDRESS|TELECOMADDRESS|UNITASSIGNMENT|SIUNIT|CONVERSIONBASEDUNIT.*|MEASUREWITHUNIT|DERIVEDUNIT.*|DIMENSIONALEXPONENTS|CONTEXTDEPENDENTUNIT|MONETARYUNIT|GEOMETRICREPRESENTATIONCONTEXT|GEOMETRICREPRESENTATIONSUBCONTEXT|PROJECTEDCRS|GEOGRAPHICCRS|MAPCONVERSION.*|RIGIDOPERATION|CLASSIFICATION.*|DOCUMENTINFORMATION.*|DOCUMENTREFERENCE|LIBRARYINFORMATION|LIBRARYREFERENCE|COORDINATEREFERENCESYSTEM|CARTESIANPOINT|DIRECTION|AXIS2PLACEMENT3D|AXIS2PLACEMENT2D))$/;
const relationTypes = new Set(['IFCRELAGGREGATES','IFCRELNESTS','IFCRELCONTAINEDINSPATIALSTRUCTURE']);
const groups = {
  'Prosjekt og anlegg': /^(IFCPROJECT|IFCPROJECTLIBRARY|IFCSITE|IFCBUILDING|IFCBUILDINGSTOREY|IFCFACILITY|IFCFACILITYPART.*|IFCBRIDGE.*|IFCROAD.*|IFCRAILWAY.*|IFCMARINEFACILITY.*|IFCSPATIALZONE)$/,
  'Applikasjoner': /^IFCAPPLICATION$/,
  'Personer og organisasjoner': /^IFC(PERSON|ORGANIZATION|PERSONANDORGANIZATION|ACTORROLE|POSTALADDRESS|TELECOMADDRESS)$/,
  'Eierskap og endringshistorikk': /^IFCOWNERHISTORY$/,
  'Enheter': /^IFC(UNITASSIGNMENT|SIUNIT|CONVERSIONBASEDUNIT.*|MEASUREWITHUNIT|DERIVEDUNIT.*|DIMENSIONALEXPONENTS|CONTEXTDEPENDENTUNIT|MONETARYUNIT)$/,
  'Koordinater og georeferering': /^IFC(PROJECTEDCRS|GEOGRAPHICCRS|MAPCONVERSION.*|RIGIDOPERATION|COORDINATEREFERENCESYSTEM)$/,
  'Representasjonskontekster': /^IFCGEOMETRICREPRESENTATION(SUB)?CONTEXT$/,
  'Klassifikasjoner og dokumentreferanser': /^IFC(CLASSIFICATION.*|DOCUMENTINFORMATION.*|DOCUMENTREFERENCE|LIBRARYINFORMATION|LIBRARYREFERENCE)$/
};
const fieldNames={
  IFCAPPLICATION:['ApplicationDeveloper','Version','ApplicationFullName','ApplicationIdentifier'],
  IFCPERSON:['Identification','FamilyName','GivenName','MiddleNames','PrefixTitles','SuffixTitles','Roles','Addresses'],
  IFCORGANIZATION:['Identification','Name','Description','Roles','Addresses'],
  IFCPERSONANDORGANIZATION:['ThePerson','TheOrganization','Roles'],
  IFCOWNERHISTORY:['OwningUser','OwningApplication','State','ChangeAction','LastModifiedDate','LastModifyingUser','LastModifyingApplication','CreationDate'],
  IFCPROJECT:['GlobalId','OwnerHistory','Name','Description','ObjectType','LongName','Phase','RepresentationContexts','UnitsInContext'],
  IFCSITE:['GlobalId','OwnerHistory','Name','Description','ObjectType','ObjectPlacement','Representation','LongName','CompositionType','RefLatitude','RefLongitude','RefElevation','LandTitleNumber','SiteAddress'],
  IFCBUILDING:['GlobalId','OwnerHistory','Name','Description','ObjectType','ObjectPlacement','Representation','LongName','CompositionType','ElevationOfRefHeight','ElevationOfTerrain','BuildingAddress'],
  IFCBUILDINGSTOREY:['GlobalId','OwnerHistory','Name','Description','ObjectType','ObjectPlacement','Representation','LongName','CompositionType','Elevation'],
  IFCSIUNIT:['Dimensions','UnitType','Prefix','Name'], IFCUNITASSIGNMENT:['Units'],
  IFCPROJECTEDCRS:['Name','Description','GeodeticDatum','VerticalDatum','MapProjection','MapZone','MapUnit'],
  IFCMAPCONVERSION:['SourceCRS','TargetCRS','Eastings','Northings','OrthogonalHeight','XAxisAbscissa','XAxisOrdinate','Scale'],
  IFCGEOMETRICREPRESENTATIONCONTEXT:['ContextIdentifier','ContextType','CoordinateSpaceDimension','Precision','WorldCoordinateSystem','TrueNorth'],
  IFCGEOMETRICREPRESENTATIONSUBCONTEXT:['ContextIdentifier','ContextType','CoordinateSpaceDimension','Precision','WorldCoordinateSystem','TrueNorth','ParentContext','TargetScale','TargetView','UserDefinedTargetView'],
  IFCCARTESIANPOINT:['Coordinates'],IFCDIRECTION:['DirectionRatios'],IFCAXIS2PLACEMENT3D:['Location','Axis','RefDirection'],
  IFCCLASSIFICATION:['Source','Edition','EditionDate','Name','Description','Location','ReferenceTokens']
};

export function parseIfc(text) {
  if(!/^\s*\uFEFF?ISO-10303-21\s*;/i.test(text))throw new Error('Dette er ikke en IFC STEP-fil. IFCZIP og IFCXML må pakkes ut eller konverteres først.');
  const entities=new Map(), counts=Object.create(null), headers=Object.create(null), parents=new Map(), byGuid=new Map();
  let data=false, ended=false, total=0;
  for(const record of records(text)) {
    if(record==='DATA'){data=true;continue;} if(record==='ENDSEC'){data=false;continue;}
    if(record==='END-ISO-10303-21'){ended=true;continue;}
    if(!data){const m=record.match(/^([A-Z][A-Z0-9_]*)\s*(\([\s\S]*\))$/);if(m)headers[m[1]]=parseArguments(m[2]);continue;}
    const m=record.match(/^#(\d+)\s*=\s*(IFC[A-Z0-9_]+)\s*(\([\s\S]*\))$/i);if(!m)throw new Error('Ugyldig IFC-entitet i DATA-seksjonen.');
    const id=Number(m[1]),type=m[2].toUpperCase(); counts[type]=(counts[type]||0)+1;total++;
    // Keep roots and metadata only, so large tessellation records do not build object graphs.
    const isRoot=/^\(\s*'[0-3][0-9A-Za-z_$]{21}'\s*,/.test(m[3]);
    if(!isRoot && !metadataTypes.test(type) && !relationTypes.has(type))continue;
    const args=parseArguments(m[3]); entities.set(id,{id,type,args});
    if(isRoot && !type.startsWith('IFCREL')) { const list=byGuid.get(args[0])||[];list.push(id);byGuid.set(args[0],list); }
    if(relationTypes.has(type)) {
      const contained=type==='IFCRELCONTAINEDINSPATIALSTRUCTURE';
      const parent=args[contained?5:4]?.ref, children=args[contained?4:5];
      for(const child of children||[]) { if(!child?.ref || !parent)continue; const links=parents.get(child.ref)||[]; links.push({parent,relation:type});parents.set(child.ref,links); }
    }
  }
  if(!ended || !headers.FILE_SCHEMA?.[0]?.some(s=>/^IFC/i.test(s)))throw new Error('Filen mangler IFC-skjema eller avsluttende STEP-markør.');
  return {entities,counts,headers,parents,byGuid,total};
}

export function expandEntity(model,id,depth=0,seen=new Set()) {
  const e=model.entities.get(id);if(!e)return {STEP:`#${id}`,merknad:'Referanse utenfor metadatautvalget'};
  if(depth>5 || seen.has(id))return {STEP:`#${id}`,type:e.type};
  const next=new Set(seen).add(id);
  const expand=value=>Array.isArray(value)?value.map(expand):value?.ref?expandEntity(model,value.ref,depth+1,next):value;
  const result={STEP:`#${id}`,type:e.type};
  e.args.forEach((arg,i)=>{const key=fieldNames[e.type]?.[i]||`Attributt ${i+1}`;result[key]=expand(arg);if(e.type==='IFCOWNERHISTORY' && [4,7].includes(i) && typeof arg==='number')result[`${key} (UTC)`]=new Date(arg*1000).toISOString();});
  return result;
}

export function metadata(model) {
  return {header:model.headers,total:model.total,counts:model.counts,sections:Object.entries(groups).map(([title,pattern])=>({title,entities:[...model.entities.values()].filter(e=>pattern.test(e.type)).map(e=>expandEntity(model,e.id))})).filter(s=>s.entities.length)};
}

export function objectPaths(model,guid) {
  const ids=model.byGuid.get(guid)||[];const paths=[];
  function walk(id,path,seen) {
    if(seen.has(id)){paths.push({nodes:path,warning:'Syklus i IFC-hierarkiet'});return;}
    const e=model.entities.get(id);if(!e){paths.push({nodes:path,warning:`Mangler #${id}`});return;}
    const nodes=[{id,type:e.type,guid:e.args[0],name:e.args[2]||e.type},...path];
    const links=model.parents.get(id)||[];
    if(!links.length){paths.push({nodes,warning:e.type==='IFCPROJECT'?null:'Ingen videre overordnet relasjon er angitt i IFC-filen.'});return;}
    if(paths.length>=100)return;
    for(const link of links)walk(link.parent,nodes,new Set(seen).add(id));
  }
  for(const id of ids)walk(id,[],new Set());
  return {found:ids.length>0,paths,objects:ids.map(id=>expandEntity(model,id))};
}

export function ifcGuid(guid) { const parts=String(guid||'').split('~');const candidate=parts.at(-1);return /^[0-3][0-9A-Za-z_$]{21}$/.test(candidate)?candidate:null; }
