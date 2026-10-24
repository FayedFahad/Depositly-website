import test from 'node:test';
import assert from 'node:assert/strict';
import {createInteractionMotion} from '../assets/interaction-motion.js';

function setup(context){
 const originals=new Map(),listeners=new Map(),rootListeners=new Map(),animations=[];
 const replace=(key,value)=>{originals.set(key,Object.getOwnPropertyDescriptor(globalThis,key));Object.defineProperty(globalThis,key,{configurable:true,writable:true,value});};
 context.after(()=>{for(const [key,value] of originals)value?Object.defineProperty(globalThis,key,value):delete globalThis[key];});
 const reduced={matches:false,addEventListener(type,callback){this.change=callback;}};
 function element(){return {style:{},children:[],getBoundingClientRect(){return {left:parseFloat(this.style.left)||0,top:parseFloat(this.style.top)||0,width:parseFloat(this.style.width)||0,height:parseFloat(this.style.height)||0};},setAttribute(){},append(node){node.parent=this;this.children.push(node);},prepend(node){node.parent=this;this.children.unshift(node);},remove(){if(this.parent)this.parent.children=this.parent.children.filter(child=>child!==this);},animate(frames,options){const animation={frames,options,cancel(){this.cancelled=true;this.oncancel?.();}};animations.push(animation);return animation;}};}
 let selectedX=4;
 const group={...element(),classList:{add(){}},getAttribute:()=>'Deposit ownership',getBoundingClientRect:()=>({left:0,top:0}),querySelector:selector=>selector==='button.selected'?button:group.children.find(node=>node.className==='segment-marker')};
 const button={...element(),disabled:false,matches:()=>false,closest:selector=>selector==='button'?button:group,getBoundingClientRect:()=>({left:selectedX,top:4,width:60,height:36})};
 const document={hidden:false,createElement:element,addEventListener:(key,callback)=>listeners.set(key,callback)};
 const root={querySelectorAll:()=>[group],addEventListener:(key,callback)=>rootListeners.set(key,callback)};
 replace('window',{matchMedia:()=>reduced});replace('document',document);
 const click=()=>rootListeners.get('click')({target:button,detail:1});
 const down=()=>rootListeners.get('pointerdown')({target:button,button:0,clientX:20,clientY:20});
 return {root,button,group,reduced,document,listeners,animations,click,down,selectNext:()=>{selectedX=72;}};
}

test('filter selection moves from its previous position and interrupted feedback is cancelled',context=>{
 const ui=setup(context),motion=createInteractionMotion();motion.mount(ui.root);
 ui.click();ui.selectNext();motion.mount(ui.root);
 const slide=ui.animations.at(-1);
 assert.match(slide.frames[0].transform,/translate\(-68px,0px\)/);
 assert.equal(ui.group.children.length,1);
 motion.mount(ui.root);
 assert.equal(slide.cancelled,true);
 assert.equal(ui.group.children.length,1,'repeated renders retain a single selection marker');
});

test('tap feedback cleans up, stops in hidden tabs, and respects reduced motion',context=>{
 const ui=setup(context),motion=createInteractionMotion();motion.mount(ui.root);
 ui.down();assert.equal(ui.button.children.length,1);
 ui.animations.at(-1).onfinish();assert.equal(ui.button.children.length,0);
 ui.down();ui.document.hidden=true;ui.listeners.get('visibilitychange')();
 assert.equal(ui.button.children.length,0);
 ui.document.hidden=false;ui.reduced.matches=true;ui.reduced.change();
 const count=ui.animations.length;ui.down();ui.click();ui.selectNext();motion.mount(ui.root);
 assert.equal(ui.animations.length,count,'reduced motion keeps feedback static');
 assert.equal(ui.button.children.length,0);
});
