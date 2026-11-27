import {readIfcObjects} from './ifc-status.mjs';
self.onmessage=({data})=>{try{self.postMessage({objects:readIfcObjects(data.text,data.file)});}catch(error){self.postMessage({error:error.message});}};
