import './sync-registry.js';
const Sync=globalThis.DepositlySync;

/** Durable local writes happen first. Each network result is fenced to its account scope. */
export function createAutoSync({cloud,get,set,onError=()=>{},actor=globalThis.crypto?.randomUUID?.()||'web-'+Math.random().toString(36).slice(2),timer=setTimeout,cancel=clearTimeout}){
 let running=null,pending,retry=1000;
 const current=key=>{const value=get();return value.ready&&value.key===key?value:null;};
 function schedule(delay=300){cancel(pending);pending=timer(()=>sync(),delay);}
 function sync(){
  if(running)return running;
  const initial=get();if(!initial.ready)return Promise.resolve();
  running=(async()=>{
   try{
    const remote=await cloud.registry((initial.heads||[]).slice().sort().join(','));
    let local=current(initial.key);if(!local)return;
    const remoteDoc=remote.backup?Sync.fromBackup(remote.backup,remote.file):null;
    let doc=local.doc;
    if(!doc){
     if(remoteDoc&&!local.dirty)doc=remoteDoc;
     else if(remoteDoc&&local.baseFile){
      const base=await cloud.version(local.baseFile);if(!current(initial.key))return;local=get();doc=Sync.change(Sync.fromBackup(base.backup,base.file),base.backup,local.backup,actor,Date.parse(local.updatedAt)||Date.now());
     }else if(remoteDoc&&local.dirty)doc=Sync.change(remoteDoc,remote.backup,local.backup,actor,Date.parse(local.updatedAt)||Date.now());
     else doc=Sync.create(local.backup,actor,Date.parse(local.updatedAt)||0);
    }
    doc=Sync.merge(doc,remoteDoc);
    const heads=remote.heads||[],needsUpload=remoteDoc?!Sync.equal(doc,remoteDoc)||heads.length>1:!!local.dirty||!remote.unchanged;
    set({doc,heads,backup:Sync.backup(doc),dirty:needsUpload,file:remote.file});
    if(needsUpload){
     const sent=doc,result=await cloud.saveVersion(Sync.backup(sent),heads);
     local=current(initial.key);if(!local)return;
     const stillDirty=!Sync.equal(local.doc,sent);
     set({doc:local.doc,heads:[result.file.id,...heads.slice(24)],backup:Sync.backup(local.doc),dirty:stillDirty,file:result.file});
     if(stillDirty)schedule();
    }
    retry=1000;onError(null);
   }catch(error){if(current(initial.key)){onError(error);schedule(retry);retry=Math.min(retry*2,60000);}}
   finally{running=null;if(get().ready&&get().key!==initial.key)schedule(0);}
  })();
  return running;
 }
 return {sync,schedule,actor};
}
