import {StatusSource} from './source.mjs';
import {summarize,discipline,objectRecord} from './statistics.mjs';
import {connectEmbedded} from './embedded-connection.mjs';
import {withTimeout} from './streambim.mjs';
const $=id=>document.getElementById(id),number=n=>n.toLocaleString('nb-NO');
let data=null,source=null,busy=false,epoch=0,demo=false;
const node=(tag,text)=>{const e=document.createElement(tag);if(text!==undefined)e.textContent=text;return e;};
function notice(text,error=false){$('notice').textContent=text;$('notice').classList.toggle('error',error);}
function render(){
  if(!data)return;
  const layer=$('layer').value,models=data.models.filter(m=>!layer||`${m.buildingId}|${m.layer}`===layer);
  const objects=data.objects.filter(o=>!layer||models.some(m=>m.buildingId===o.buildingId&&((o.documentId&&o.documentId===m.documentId)||(!o.documentId&&o.layer===m.layer))));
  const s=summarize(objects,$('field').value),missing=s.counts.find(([k])=>k==='Mangler MMI')?.[1]||0,conflict=s.counts.find(([k])=>k==='Motstridende MMI')?.[1]||0;
  $('total').textContent=number(s.total);$('with-mmi').textContent=number(s.total-missing-conflict);$('proxy').textContent=number(s.proxy+s.buildingElementProxy);
  $('mmi-share').textContent=s.total?`${((s.total-missing-conflict)/s.total*100).toLocaleString('nb-NO',{maximumFractionDigits:1})} % av objektene`:'Ingen objekter i utvalget';
  $('coverage').textContent=data.failures.length?'Ufullstendig datagrunnlag':`${data.buildings} modellområder i prosjektet`;
  const known=new Set(models.flatMap(m=>discipline(m).names));
  $('disciplines').textContent=number(known.size);$('model-count').textContent=`${models.length} modellfiler · ${models.filter(m=>discipline(m).name==='Ukjent fag').length} uten kjent fag`;
  $('bars').replaceChildren();for(const [status,count] of s.counts){const row=node('div');row.className=`bar-row ${['Mangler MMI','Motstridende MMI'].includes(status)?'issue':''}`;const label=node('div');label.className='bar-label';label.append(node('span',/^\d{3}$/.test(status)?`MMI ${status}`:status),node('strong',number(count)));const track=node('div');track.className='track';const fill=node('div');fill.className='fill';fill.style.width=`${count/(s.total||1)*100}%`;track.append(fill);row.append(label,track);$('bars').append(row);}
  if(!s.total)$('bars').append(node('p','Ingen objekter tilgjengelig for dette utvalget.'));
  $('mmi-fields').textContent=`Funne MMI-felt: ${s.fields.join(', ')||'ingen'}. ${layer?'Objekter uten kobling til dette modellaget inngår ikke i utvalget.':''}`;
  $('proxy-detail').replaceChildren();for(const [label,count] of [['IfcProxy',s.proxy],['IfcBuildingElementProxy',s.buildingElementProxy],['Uten lesbar IFC-klasse',s.unknownType]]){const row=node('div');row.className='metric';row.append(node('span',label),node('strong',number(count)));$('proxy-detail').append(row);}
  $('models').replaceChildren();for(const model of models){const d=discipline(model),tr=node('tr');for(const text of [model.name,model.layer||'Uten modellag',d.name,d.source,model.analysis||'Eksempel'])tr.append(node('td',text));$('models').append(tr);}
  $('dashboard').hidden=false;
}
function install(result){data=result;$('layer').replaceChildren(new Option('Alle modellag',''));const layers=new Map(result.models.map(m=>[`${m.buildingId}|${m.layer}`,`${m.layer||'Uten modellag'} · ${m.buildingId}`]));for(const [value,label] of layers)$('layer').append(new Option(label,value));$('field').replaceChildren(new Option('Automatisk · alle MMI-felt',''));for(const key of summarize(result.objects).fields)$('field').append(new Option(key,key));$('updated').textContent=`${demo?'EKSEMPELDATA · ':''}Oppdatert ${new Date().toLocaleTimeString('nb-NO',{hour:'2-digit',minute:'2-digit',timeZone:'Europe/Oslo'})}`;render();}
async function refresh(){
  if(busy||!source)return;busy=true;const token=++epoch;$('refresh').disabled=true;$('demo').disabled=true;$('dashboard').hidden=true;data=null;
  try{const result=await source.project(text=>{if(token===epoch)notice(text);});if(token!==epoch)return;install(result);$('connect').hidden=true;notice(result.failures.length?`Ufullstendig oversikt: ${result.failures.map(f=>`${f.name}: ${f.error}`).join('\n')}`:`Prosjekt ${result.projectId} · IFC-originalene i alle tilgjengelige modellområder er lest. Revisjonen kan avvike fra publisert 3D.`,!!result.failures.length);}
  catch(error){if(token===epoch)notice(`Kunne ikke hente modellstatus: ${error.message||error.detail||error.code}`,true);}
  finally{busy=false;$('refresh').disabled=false;$('demo').disabled=false;}
}
async function connected(){demo=false;source=new StatusSource(window.StreamBIM);await refresh();}
$('layer').onchange=render;$('field').onchange=render;$('refresh').onclick=()=>source?refresh():connectPanel();
async function connectPanel(){try{notice('Kobler til StreamBIM …');$('connect').hidden=true;await withTimeout(connectEmbedded({sdk:window.StreamBIM,legacy:window.Penpal,parentWindow:window.parent,referrer:document.referrer,callbacks:{}}));await connected();}catch(error){notice(`Tilkobling mislyktes: ${error.message||error.code}`,true);$('refresh').disabled=false;}}
$('connect-form').onsubmit=async event=>{event.preventDefault();try{const url=new URL($('url').value);if(url.protocol!=='https:'||!/(^|\.)streambim\.com$/.test(url.hostname))throw new Error('Bruk en HTTPS-lenke til StreamBIM.');const query=new URLSearchParams(url.hash.split('?')[1]||url.search.slice(1));if(!query.get('projectId'))throw new Error('Lenken mangler prosjekt-ID.');query.set('embedded','true');url.hash=`/viewer?${query}`;const viewer=window.open(url.href,'statkraft-status-viewer','popup,width=1200,height=850');if(!viewer)throw new Error('Tillat åpning av prosjektvinduet.');notice('Kobler til prosjektvinduet …');await withTimeout(window.StreamBIM.connectToWindow(viewer,url.href,{}),60000);await connected();}catch(error){notice(error.message||error.code,true);}};
$('demo').onclick=()=>{++epoch;demo=true;source=null;$('refresh').disabled=true;const models=[{buildingId:'demo',documentId:'1',name:'Kraftstasjon_RIB.ifc',layer:'Kraftstasjon~RIB'},{buildingId:'demo',documentId:'2',name:'Tekniske_anlegg_RIV.ifc',layer:'Kraftstasjon~RIV'},{buildingId:'demo',documentId:'3',name:'Elektro_RIE.ifc',layer:'Kraftstasjon~RIE'}];const objects=Array.from({length:1250},(_,i)=>objectRecord({guid:`demo-${i}`,document:String(i%3+1),properties:{'IFC Type':i%17===0?'IfcBuildingElementProxy':i%43===0?'IfcProxy':'IfcWall','Prosjekt~MMI':i%11===0?null:[200,300,350,400][i%4]}},'demo'));install({models,objects,failures:[],buildings:1});notice('EKSEMPELDATA · Tallene er fiktive og viser hvordan widgeten vil se ut.');};
if(window.parent!==window)await connectPanel();
let checking=false;
setInterval(async()=>{if(!source||busy||checking)return;checking=true;try{const id=String(await withTimeout(source.api.getProjectId(),5000));if(id!==source.projectId)await refresh();}catch{}finally{checking=false;}},15000);
