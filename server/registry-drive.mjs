import {randomUUID} from 'node:crypto';
import '../assets/sync-registry.js';
const Sync=globalThis.DepositlySync;
const ID=/^[A-Za-z0-9_-]{1,256}$/;
const FIELDS='id,name,createdTime,size,appProperties';
export const registryQuery="(name = 'depositly-backup.json' or appProperties has { key='depositlyKind' and value='registry' }) and trashed = false";
const relevant=file=>file?.name==='depositly-backup.json'||file?.appProperties?.depositlyKind==='registry';
const compare=(a='',b='')=>a===b?0:a<b?-1:1;

/** Immutable versions form a DAG. Concurrent heads are merged, never discarded. */
export function createRegistryDrive({request,validateBackup,now=Date.now}){
 function check(file){if(!file||!ID.test(file.id)||!relevant(file)||Number(file.size||0)>20_000_000)throw Error('Invalid registry file.');return file;}
 async function list({pageToken,limit=1000}={}){
  const query=new URLSearchParams({spaces:'appDataFolder',q:registryQuery,pageSize:String(limit),orderBy:'createdTime desc',fields:`nextPageToken,files(${FIELDS})`,...(pageToken?{pageToken}:{})});
  const result=await request('/drive/v3/files?'+query);
  if(!Array.isArray(result.files))throw Error('Invalid Drive version list.');
  return {files:result.files.map(check),nextPageToken:result.nextPageToken||null};
 }
 async function content(file){const backup=await request(`/drive/v3/files/${encodeURIComponent(file.id)}?alt=media`);validateBackup(backup);if(backup.sync)Sync.validate(backup.sync);return {file,backup};}
 async function read(known=''){
  const files=[];let pageToken;
  do{const page=await list({pageToken});files.push(...page.files);pageToken=page.nextPageToken;if(files.length>100000)throw Error('Too many backup versions.');}while(pageToken);
  const parents=new Set(files.flatMap(file=>Object.entries(file.appProperties||{}).filter(([key])=>/^p\d+$/.test(key)).map(([,id])=>id)));
  const legacy=files.filter(file=>file.name==='depositly-backup.json').sort((a,b)=>compare(b.createdTime,a.createdTime)||compare(b.id,a.id))[0];
  const heads=files.filter(file=>!parents.has(file.id)&&(file.name!=='depositly-backup.json'||file.id===legacy?.id)).sort((a,b)=>compare(a.id,b.id));
  if(heads.length>128)throw Error('Too many simultaneous registry versions.');
  const key=heads.map(file=>file.id).join(',');
  if(known===key)return {unchanged:true,heads:heads.map(file=>file.id),file:heads.at(-1)||null};
  let doc=null;
  for(const file of heads){const version=await content(file);doc=Sync.merge(doc,Sync.fromBackup(version.backup,file));}
  const backup=doc?Sync.backup(doc):null;if(backup)validateBackup(backup);
  return {backup,heads:heads.map(file=>file.id),file:[...heads].sort((a,b)=>compare(b.createdTime,a.createdTime)||compare(b.id,a.id))[0]||null};
 }
 async function save(backup,parents=[]){
  Sync.validate(backup?.sync);backup=Sync.backup(backup.sync);validateBackup(backup);
  if(!Array.isArray(parents)||parents.length>128||parents.some(id=>!ID.test(id)))throw Error('Invalid registry parents.');
  const date=new Date(now()).toISOString(),metadata={name:`Depositly-${date.replace(/[:.]/g,'-')}-${randomUUID().slice(0,8)}.json`,mimeType:'application/json',parents:['appDataFolder'],appProperties:{depositlyKind:'registry',source:'website'}};
  parents.filter(id=>id.length<120).slice(0,24).forEach((id,index)=>metadata.appProperties['p'+index]=id);
  const boundary='depositly_'+randomUUID();
  const body=`--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(metadata)}\r\n--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(backup)}\r\n--${boundary}--\r\n`;
  const file=await request('/upload/drive/v3/files?uploadType=multipart&fields='+FIELDS,{method:'POST',type:'multipart/related; boundary='+boundary,body});
  if(!ID.test(file?.id))throw Error('Drive did not confirm the new version.');
  return {file:{...metadata,...file},backup};
 }
 async function version(id){
  if(!ID.test(id))throw Error('Invalid backup version.');
  const file=check(await request(`/drive/v3/files/${encodeURIComponent(id)}?fields=${FIELDS}`));return content(file);
 }
 return {read,save,version,history:pageToken=>list({pageToken,limit:50})};
}
