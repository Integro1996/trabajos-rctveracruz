import {readFile} from 'node:fs/promises';
import {resolve,sep} from 'node:path';
import {createHash} from 'node:crypto';
import {initializeDatabase,pool,inTransaction} from '../src/db.js';
import {initializeStorage,putAsset,putDocx} from '../src/storage.js';
const names=['articles','article_assets','article_blocks','authors','keywords','document_versions','callbacks','article_sessions','recovery_credentials','admin_users','admin_sessions','admin_document_grants','admin_audit_log','recovery_attempts'].map(n=>'trabajos_'+n);
const root=resolve(process.argv[2]||'');
if(!process.argv[2])throw new Error('Indica el directorio exportado.');
try{
  const manifest=JSON.parse(await readFile(resolve(root,'manifest.json'),'utf8'));
  if(manifest.format!==1||!Array.isArray(manifest.objects)||names.some(n=>!Array.isArray(manifest.tables[n]))||Object.keys(manifest.tables).some(n=>!names.includes(n)))throw new Error('Formato o tablas no válidas');
  await initializeDatabase();await initializeStorage();
  await inTransaction(async client=>{
    await client.query('SELECT pg_advisory_xact_lock(84732011)');
    for(const name of names){const {rows}=await client.query(`SELECT COUNT(*) AS count FROM ${name}`);if(Number(rows[0].count))throw new Error('La base destino debe estar vacía: '+name);}
    for(const object of manifest.objects){
      const path=resolve(root,object.filename);if(!path.startsWith(root+sep))throw new Error('Ruta de objeto no válida');
      const buffer=await readFile(path);if(createHash('sha256').update(buffer).digest('hex')!==object.sha256)throw new Error('Checksum incorrecto');
      if(object.key.endsWith('.docx'))await putDocx(object.key,buffer);else await putAsset(object.key,buffer,object.key.endsWith('.png')?'image/png':'image/jpeg');
    }
    for(const name of names){
      const {rows:columns}=await client.query("SELECT column_name,data_type FROM information_schema.columns WHERE table_schema='public' AND table_name=$1",[name]);
      const allowed=new Map(columns.map(c=>[c.column_name,c.data_type]));
      for(const row of manifest.tables[name]||[]){
        const keys=Object.keys(row);if(keys.some(k=>!allowed.has(k)))throw new Error('Columna desconocida en '+name);
        const values=keys.map(k=>row[k]===null?null:allowed.get(k)==='boolean'?Boolean(Number(row[k])):allowed.get(k)==='jsonb'&&typeof row[k]!=='string'?JSON.stringify(row[k]):row[k]);
        await client.query(`INSERT INTO ${name} (${keys.map(k=>'"'+k+'"').join(',')}) VALUES (${keys.map((_,i)=>'$'+(i+1)).join(',')})`,values);
      }
      const {rows:sequences}=await client.query('SELECT pg_get_serial_sequence($1, $2) AS name',[name,'id']);
      if(sequences[0].name)await client.query(`SELECT setval($1, GREATEST(COALESCE(MAX(id),0),1), COUNT(*)>0) FROM ${name}`,[sequences[0].name]);
    }
  });
  console.log(JSON.stringify({imported:true,tables:names.length,objects:manifest.objects.length}));
}finally{await pool.end()}
