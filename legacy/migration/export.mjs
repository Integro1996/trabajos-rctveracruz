import mysql from 'mysql2/promise';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {resolve,sep} from 'node:path';
import {createHash} from 'node:crypto';
const names=['articles','article_assets','article_blocks','authors','keywords','document_versions','callbacks','article_sessions','recovery_credentials','admin_users','admin_sessions','admin_document_grants','admin_audit_log','recovery_attempts'].map(n=>'trabajos_'+n);
const destination=resolve(process.env.EXPORT_PATH||'');
const storage=resolve(process.env.SOURCE_STORAGE_PATH||'');
if(!process.env.EXPORT_PATH||!process.env.SOURCE_STORAGE_PATH)throw new Error('Faltan EXPORT_PATH / SOURCE_STORAGE_PATH');
await mkdir(destination,{mode:0o700});
const db=await mysql.createConnection({host:process.env.SOURCE_DB_HOST,port:Number(process.env.SOURCE_DB_PORT||3306),user:process.env.SOURCE_DB_USER,password:process.env.SOURCE_DB_PASSWORD,database:process.env.SOURCE_DB_NAME,timezone:'Z',supportBigNumbers:true,bigNumberStrings:true});
try{
  await db.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ');
  await db.query('START TRANSACTION WITH CONSISTENT SNAPSHOT');
  const tables={};
  for(const name of names){const [rows]=await db.query('SELECT * FROM `'+name+'`');tables[name]=rows;}
  const keys=new Set();
  for(const rows of Object.values(tables))for(const row of rows)for(const column of ['document_storage_path','storage_path'])if(row[column])keys.add(row[column]);
  const objects=[];
  for(const key of keys){
    if(!key.startsWith('articles/')||key.includes('..')||key.includes('\\'))throw new Error('Ruta no válida');
    const source=resolve(storage,key);if(!source.startsWith(storage+sep))throw new Error('Ruta fuera del storage');
    const buffer=await readFile(source),sha256=createHash('sha256').update(buffer).digest('hex');
    const filename='objects/'+sha256;await mkdir(resolve(destination,'objects'),{recursive:true,mode:0o700});
    await writeFile(resolve(destination,filename),buffer,{mode:0o600});objects.push({key,filename,sha256});
  }
  await writeFile(resolve(destination,'manifest.json'),JSON.stringify({format:1,tables,objects},null,2),{mode:0o600});
  await db.commit();console.log(JSON.stringify({tables:names.length,objects:objects.length,exported:true}));
}finally{await db.end()}
