import pg from 'pg';
import { readFile } from 'node:fs/promises';
import { config } from './config.js';
export const pool = new pg.Pool({host:config.database.host,port:config.database.port,user:config.database.user,password:config.database.password,database:config.database.name,max:10,connectionTimeoutMillis:10000,...(config.database.ssl?{ssl:{rejectUnauthorized:true}}:{})});
export async function inTransaction(work) {
 const client=await pool.connect();
 try {await client.query('BEGIN');const result=await work(client);await client.query('COMMIT');return result;}
 catch(error){await client.query('ROLLBACK');throw error;}finally{client.release();}
}
export async function initializeDatabase() {
 const schema=await readFile(new URL('../database/001-initial.sql',import.meta.url),'utf8');
 await inTransaction(async client=>{await client.query("SELECT pg_advisory_xact_lock(84732011)");await client.query(schema);});
}
export async function databaseHealthy(){await pool.query('SELECT 1');return true;}
