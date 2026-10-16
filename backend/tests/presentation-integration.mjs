import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
const base=process.env.LAB_API_URL||'http://127.0.0.1:3200';
const cookies=new Map();
async function request(path,method='GET',body){
  const response=await fetch(base+path,{method,headers:{'content-type':'application/json',cookie:[...cookies].map(([k,v])=>k+'='+v).join('; '),'x-trabajos-csrf':cookies.get('trabajos_csrf')||''},body:body===undefined?undefined:JSON.stringify(body)});
  for(const cookie of response.headers.getSetCookie()){const pair=cookie.split(';')[0],i=pair.indexOf('=');cookies.set(pair.slice(0,i),pair.slice(i+1))}
  return {status:response.status,data:response.status===204?null:await response.json()};
}
const created=await request('/api/lab/articles','POST',{});
assert.equal(created.status,201);
const id=created.data.article.id,path='/api/lab/articles/'+id;
try{
  const content={title:'Prueba de paginación completa',mesa:'AG',keywords:['Prueba'],introduction:'Introducción breve.',
    blocks:[
      {id:randomUUID(),type:'text',text:'Evaluar el ensayo.',heading:'Objetivos'},
      {id:randomUUID(),type:'text',text:'Método breve.',heading:'Materiales y métodos'},
      {id:randomUUID(),type:'text',text:'Resultado breve.',heading:'Resultados y discusión'},
      {id:randomUUID(),type:'text',text:'Contenido breve.',heading:'Conclusiones'},
      {id:randomUUID(),type:'text',text:'Referencia breve.',heading:'Referencias bibliográficas'},
    ],
    authors:Array.from({length:30},(_,i)=>({firstName:('Nombre '.repeat(16)).trim(),lastName:('Apellido '.repeat(17)).trim(),institution:`Institución ${i} `+'Departamento científico '.repeat(9),email:`autor${i}@example.test`,orcid:'',isCorresponding:i===0}))};
  assert.equal((await request(path,'PATCH',content)).status,200);
  const generated=await request(path+'/generate','POST',{});
  assert.equal(generated.status,200,JSON.stringify(generated.data));
  assert(generated.data.pageCount>3,`La paginación debe incluir autores e instituciones: ${generated.data.pageCount}`);
  assert(generated.data.bodyWordCount<35,'La metadata no debe inflar el conteo narrativo');
  const reduced=await request(path,'PATCH',{...content,authors:[{...content.authors[0],firstName:'Ana',lastName:'Pérez',institution:'Instituto de prueba'}]});
  assert.equal(reduced.status,200);
  assert.equal(reduced.data.documentKey,generated.data.documentKey);
  assert.equal(reduced.data.pageCount,null);
  const finalized=await request(path+'/finalize','POST',{});
  assert.equal(finalized.status,422,JSON.stringify(finalized.data));
  assert(finalized.data.details.some(message=>message.includes('mínimo requerido es 3')));
  console.log(JSON.stringify({ok:true,pagesWithMetadata:generated.data.pageCount,pagesAfterMetadataChange:1,bodyPreserved:true}));
}finally{await request(path,'DELETE')}
