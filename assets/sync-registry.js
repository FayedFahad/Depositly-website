/* Shared, dependency-free registry protocol. Keep the Android copy byte-identical. */
(function(root){
 'use strict';
 const clone=value=>JSON.parse(JSON.stringify(value));
 const escape=value=>String(value).replace(/~/g,'~0').replace(/\//g,'~1');
 const unescape=value=>value.replace(/~1/g,'/').replace(/~0/g,'~');
 const canonical=value=>Array.isArray(value)?'['+value.map(canonical).join(',')+']':value&&typeof value==='object'?'{'+Object.keys(value).sort().map(key=>JSON.stringify(key)+':'+canonical(value[key])).join(',')+'}':JSON.stringify(value);
 const equal=(a,b)=>canonical(a)===canonical(b);
 // Related terms must move together so concurrent edits cannot form an invalid schedule.
 const groups=[['type','cycle','cycleUnit','start','first','maturity','autoRenew','renewalStop','tenureCount','tenureUnit'],['ownership','ownerName']];
 const compare=(a,b)=>a[0]-b[0]||a[1]-b[1]||(a[2]<b[2]?-1:a[2]>b[2]?1:0);
 const empty=()=>({version:1,entries:Object.create(null)});
 function validate(doc){
  if(!doc||doc.version!==1||!doc.entries||typeof doc.entries!=='object'||Array.isArray(doc.entries)||Object.keys(doc.entries).length>500000)throw Error('Unsupported registry data.');
  for(const [key,r] of Object.entries(doc.entries)){
   const path=key.split('/');
   if(!(['a','r'].includes(path[0])&&[2,3].includes(path.length)||['p','n'].includes(path[0])&&path.length===2)||path.slice(1).some(part=>!part||part.length>2048))throw Error('Invalid registry field.');
   if(!r||!Array.isArray(r.s)||r.s.length!==3||!Number.isSafeInteger(r.s[0])||r.s[0]<0||!Number.isSafeInteger(r.s[1])||r.s[1]<0||typeof r.s[2]!=='string'||!r.s[2]||r.s[2].length>128||r.d!==undefined&&r.d!==true||!r.d&&!Object.hasOwn(r,'v'))throw Error('Invalid registry revision.');
  }
  return doc;
 }
 function flatten(backup){
  const data=backup.data,flat=Object.create(null);
  if(!data||!Array.isArray(data.assets)||!data.paid||Array.isArray(data.paid))throw Error('Invalid registry snapshot.');
  for(const [key,value] of Object.entries(data))if(!['assets','paid','exportedAt'].includes(key))flat['p/'+escape(key)]=value;
  for(const [key,value] of Object.entries(backup.notificationSettings||{enabled:false,time:'09:00'}))flat['n/'+escape(key)]=value;
  for(const [section,items] of [['a',data.assets.map(asset=>[asset.id,asset])],['r',Object.entries(data.paid)]]){
   for(const [id,item] of items){const key=section+'/'+escape(id);flat[key]=true;for(const [field,value] of Object.entries(item))flat[key+'/'+escape(field)]=value;}
  }
  return flat;
 }
 function create(backup,actor='legacy',time=0){
  const doc=empty();
  for(const [key,value] of Object.entries(flatten(backup)))doc.entries[key]={s:[Math.max(0,time)||0,0,actor],v:clone(value)};
  for(const asset of backup.data.assets)for(const group of groups)for(const field of group){const key='a/'+escape(asset.id)+'/'+field;if(!doc.entries[key])doc.entries[key]={s:[Math.max(0,time)||0,0,actor],d:true};}
  return validate(doc);
 }
 function fromBackup(backup,file={}){return backup.sync?clone(validate(backup.sync)):create(backup,('legacy:'+String(file.id||'unknown')).slice(0,128),Math.max(0,Date.parse(file.createdTime)||0));}
 function change(doc,before,after,actor,time=Date.now()){
  validate(doc);const result=clone(doc),old=flatten(before),next=flatten(after);
  let latest=[0,0,''];for(const value of Object.values(doc.entries))if(compare(value.s,latest)>0)latest=value.s;
  const stamp=[Math.max(Math.trunc(time),latest[0]),time>latest[0]?0:latest[1]+1,actor];
  const keys=new Set([...Object.keys(old),...Object.keys(next)]),forced=new Set();
  for(const base of [...keys].filter(key=>key.startsWith('a/')&&key.split('/').length===2))for(const group of groups){
   if(group.some(field=>!equal(old[base+'/'+field],next[base+'/'+field])))for(const field of group){keys.add(base+'/'+field);forced.add(base+'/'+field);}
  }
  for(const key of keys){
   if(!forced.has(key)&&Object.hasOwn(old,key)===Object.hasOwn(next,key)&&equal(old[key],next[key]))continue;
   if(Object.hasOwn(next,key))result.entries[key]={s:stamp,v:clone(next[key])};
   else result.entries[key]=key.split('/').length===2&&/^[ar]\//.test(key)?{s:stamp,v:false}:{s:stamp,d:true};
  }
  return validate(result);
 }
 function merge(...documents){
  const result=empty();
  for(const doc of documents){if(!doc)continue;validate(doc);for(const [key,value] of Object.entries(doc.entries)){
   const current=result.entries[key],order=current?compare(value.s,current.s):1;
   if(order>0||order===0&&canonical(value)>canonical(current))result.entries[key]=clone(value);
  }}
  return result;
 }
 function backup(doc){
  validate(doc);const data=Object.create(null),notifications=Object.create(null),assets=Object.create(null),paid=Object.create(null),alive=Object.create(null);
  for(const [key,r] of Object.entries(doc.entries)){
   if(r.d)continue;const path=key.split('/').map(unescape),[section,id,field]=path;
   if(section==='p')data[id]=clone(r.v);else if(section==='n')notifications[id]=clone(r.v);
   else if(path.length===2)alive[key]=r.v===true;
   else {const target=section==='a'?assets:paid;if(!target[id])target[id]=Object.create(null);target[id][field]=clone(r.v);}
  }
  data.scope='all';data.assets=Object.keys(assets).sort().filter(id=>alive['a/'+escape(id)]).map(id=>assets[id]);
  const ids=new Set(data.assets.map(asset=>asset.id));
  data.paid=Object.fromEntries(Object.entries(paid).filter(([id])=>alive['r/'+escape(id)]&&ids.has(id.split(':')[0])));
  return {format:'depositly-google-drive',version:1,data,notificationSettings:{enabled:false,time:'09:00',...notifications},sync:clone(doc)};
 }
 const api=Object.freeze({create,fromBackup,change,merge,backup,validate,equal,canonical});
 root.DepositlySync=api;if(typeof module==='object'&&module.exports)module.exports=api;
})(typeof globalThis!=='undefined'?globalThis:this);
