// Local browser QA only: synthetic Google sessions, real cookie/session handlers.
// Not part of the production build or deployment archive. No Google requests.
import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import {randomBytes} from 'node:crypto';
import {createApiHandler} from '../../server/api.mjs';
import {encryptCookie,serializeCookie,cookieNames,SESSION_SECONDS} from '../../server/auth-session.mjs';
import {emptyState,createCloudBackup} from '../../assets/data-engine.js';
const origin='http://localhost:4186',secret=randomBytes(48).toString('base64url');
const profiles={A:{sub:'synthetic-A',name:'Avery Demo',email:'avery@example.test'},B:{sub:'synthetic-B',name:'Robin Demo',email:'robin@example.test'}};
const backup=account=>createCloudBackup({...emptyState(),assets:[{id:'fixture-'+account,name:account==='A'?'Avery’s private deposit':'Robin’s private deposit',type:'FDR',principal:10000000,rate:10,tds:10,cycle:1,start:'2026-01-01',first:'2026-02-01',maturity:'2028-01-01',ownership:'self',bankId:'brac-bank-plc'}]},{enabled:false,time:'09:00'});
const handler=createApiHandler({env:{APP_ORIGIN:origin,GOOGLE_CLIENT_SECRET:'synthetic-only-not-a-real-secret',SESSION_SECRET:secret},fetchImpl:async(url,options={})=>{
 let account=String(options.headers?.Authorization||options.headers?.authorization||'').endsWith('-B')?'B':'A';
 if(String(url).includes('oauth2.googleapis.com/token')){account=String(options.body).includes('-B')?'B':'A';return Response.json({access_token:'synthetic-'+account,expires_in:3600});}
 return Response.json(String(url).includes('alt=media')?backup(account):{files:[{id:'file-'+account,name:'depositly-backup.json',createdTime:'2026-10-22T08:00:00Z'}]});
}});
const server=createServer(async(req,res)=>{
 const url=new URL(req.url,origin);
 if(url.pathname==='/__test-login'){
  const account=url.searchParams.get('account')==='B'?'B':'A',now=Date.now(),binding=randomBytes(32).toString('base64url'),names=cookieNames(false);
  const session={version:1,user:profiles[account],binding,csrfToken:randomBytes(32).toString('base64url'),accessToken:'synthetic-'+account,refreshToken:'synthetic-refresh-'+account,accessExpiresAt:now-1000,createdAt:now,expiresAt:now+SESSION_SECONDS*1000};
  res.setHeader('Set-Cookie',[serializeCookie(names.binding,encryptCookie({nonce:binding,expiresAt:session.expiresAt},'binding',secret),{secure:false}),serializeCookie(names.session,encryptCookie(session,'session',secret),{secure:false})]);
  res.writeHead(302,{Location:'/#backup'});res.end();return;
 }
 if(url.pathname.startsWith('/api/'))return handler(req,res);
 const pathname=url.pathname==='/'?'/index.html':url.pathname;
 if(!['/index.html','/config.js'].includes(pathname)&&!pathname.startsWith('/assets/')){res.writeHead(404);res.end();return;}
 try{const content=await readFile(new URL('../../'+pathname.slice(1),import.meta.url));res.writeHead(200,{'Content-Type':pathname.endsWith('.css')?'text/css':pathname.endsWith('.js')?'application/javascript':pathname.endsWith('.png')?'image/png':'text/html','Cache-Control':'no-store'});res.end(content);}catch{res.writeHead(404);res.end();}
});
server.listen(4186,'127.0.0.1',()=>console.log('Synthetic account browser QA: '+origin+'/__test-login?account=A'));
