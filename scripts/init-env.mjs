import {existsSync,writeFileSync} from 'node:fs';
import {randomBytes} from 'node:crypto';
if(existsSync('.env')){console.error('.env ya existe; se conserva sin modificar.');process.exit(1)}
const secret=()=>randomBytes(32).toString('hex');
const values={PUBLIC_APP_URL:'http://localhost:3200',ONLYOFFICE_PUBLIC_URL:'http://localhost:8081',COOKIE_SECURE:'false',DB_PASSWORD:secret(),STORAGE_ACCESS_KEY:'trabajos'+randomBytes(8).toString('hex'),STORAGE_SECRET_KEY:secret(),ONLYOFFICE_JWT_SECRET:secret(),DOCUMENT_TOKEN_SECRET:secret(),RECOVERY_PEPPER:secret(),ADMIN_EMAIL:'admin@rctveracruz.org',ADMIN_PASSWORD:secret()};
writeFileSync('.env',Object.entries(values).map(([k,v])=>k+'='+v).join('\n')+'\n',{mode:0o600,flag:'wx'});
console.log('.env creado. La contraseña administrativa está en ADMIN_PASSWORD; no se imprime.');
