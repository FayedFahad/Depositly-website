import test from 'node:test';
import assert from 'node:assert/strict';
import {createCardMotion} from '../assets/card-motion.js';

function scene(context){
 const originals=new Map();
 const replace=(key,value)=>{originals.set(key,Object.getOwnPropertyDescriptor(globalThis,key));Object.defineProperty(globalThis,key,{configurable:true,writable:true,value});};
 context.after(()=>{for(const [key,value] of originals)value?Object.defineProperty(globalThis,key,value):delete globalThis[key];});
 const classes=()=>{const values=new Set();return {toggle:(name,on)=>on?values.add(name):values.delete(name),contains:name=>values.has(name)};};
 const styles=()=>{const values=new Map();return {setProperty:(key,value)=>values.set(key,value),removeProperty:key=>values.delete(key),getPropertyValue:key=>values.get(key)||''};};
 const media=matches=>({matches,addEventListener(type,callback){this.change=callback;}});
 const reduced=media(false),fine=media(true),listeners=new Map(),frames=new Map(),observers=[];
 const document={hidden:false,body:{classList:classes()},addEventListener:(key,callback)=>listeners.set(key,callback),createElement:()=>({style:styles(),setAttribute(){}})};
 const card={style:styles(),classList:classes(),children:[],prepend(edge){this.children.unshift(edge);},querySelector(){return this.children.find(edge=>edge.className==='live-border');},getBoundingClientRect:()=>({left:0,top:0,width:200,height:200}),contains:node=>node===card};
 const rootListeners=new Map(),root={querySelectorAll:()=>[card],addEventListener:(key,callback)=>rootListeners.set(key,callback),removeEventListener:key=>rootListeners.delete(key)};
 replace('window',{matchMedia:query=>query.includes('reduced')?reduced:fine});replace('document',document);
 replace('requestAnimationFrame',callback=>{const id=frames.size+1;frames.set(id,callback);return id;});
 replace('cancelAnimationFrame',id=>frames.delete(id));
 replace('IntersectionObserver',class {constructor(callback){this.update=callback;observers.push(this);}observe(){}disconnect(){this.disconnected=true;}});
 const move=(x=180,y=20,pointerType='mouse')=>rootListeners.get('pointermove')({target:{closest:()=>card},clientX:x,clientY:y,pointerType});
 const flush=()=>{const pending=[...frames.values()];frames.clear();pending.forEach(callback=>callback());};
 return {document,reduced,fine,listeners,frames,observers,card,root,rootListeners,move,flush};
}

test('edge motion follows visibility and reduced-motion changes while pointer effects stop immediately',context=>{
 const ui=scene(context),motion=createCardMotion();motion.mount(ui.root);
 ui.observers[0].update([{target:ui.card,isIntersecting:true}]);
 assert(ui.card.classList.contains('motion-visible'));
 ui.move();ui.flush();assert.notEqual(ui.card.style.getPropertyValue('--rx'),'');
 ui.document.hidden=true;ui.listeners.get('visibilitychange')();
 assert(ui.document.body.classList.contains('motion-paused'));
 assert.equal(ui.card.style.getPropertyValue('--rx'),'');
 ui.document.hidden=false;ui.listeners.get('visibilitychange')();
 assert(!ui.document.body.classList.contains('motion-paused'));
 ui.reduced.matches=true;ui.reduced.change();ui.move();
 assert(ui.document.body.classList.contains('motion-paused'));
 assert.equal(ui.frames.size,0,'reduced motion must not schedule pointer animation');
 ui.observers[0].update([{target:ui.card,isIntersecting:false}]);
 assert(!ui.card.classList.contains('motion-visible'));
});

test('touch and coarse pointers stay still; rerender cancels queued work and releases previous observers',context=>{
 const ui=scene(context),motion=createCardMotion();motion.mount(ui.root);
 ui.move(180,20,'touch');assert.equal(ui.frames.size,0);
 ui.fine.matches=false;ui.move();assert.equal(ui.frames.size,0);
 ui.fine.matches=true;ui.move();ui.move(120,100);
 assert.equal(ui.frames.size,1,'pointer updates must share one animation frame');
 motion.mount(ui.root);
 assert.equal(ui.frames.size,0);
 assert.equal(ui.observers[0].disconnected,true);
 assert.equal(ui.card.children.length,1,'refreshing search results must not duplicate card edges');
 assert.equal(ui.rootListeners.size,2,'rerenders must not add duplicate pointer listeners');
});
