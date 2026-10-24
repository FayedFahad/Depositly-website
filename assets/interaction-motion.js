// Short, interruptible feedback for filters, taps and keyboard activation.
export function createInteractionMotion(){
 const reduced=window.matchMedia?.('(prefers-reduced-motion: reduce)');
 if(!reduced)return {mount(){}};
 const animations=new Set();
 let root,resizeObserver,pending;
 function stop(){for(const animation of animations)animation.cancel();animations.clear();}
 function play(node,frames,options,cleanup=()=>{}){
  if(reduced.matches||document.hidden||!node.animate){cleanup();return;}
  const animation=node.animate(frames,options);animations.add(animation);
  animation.onfinish=animation.oncancel=()=>{animations.delete(animation);cleanup();};
 }
 function press(button,x,y){
  if(button.disabled||button.matches('.switch')||reduced.matches||document.hidden)return;
  const box=button.getBoundingClientRect(),diameter=Math.hypot(box.width,box.height)*2;
  const wave=document.createElement('span'),ink=document.createElement('span');
  wave.className='press-wave';wave.setAttribute('aria-hidden','true');
  ink.style.width=ink.style.height=`${diameter}px`;
  ink.style.left=`${Math.max(0,Math.min(box.width,x-box.left))-diameter/2}px`;
  ink.style.top=`${Math.max(0,Math.min(box.height,y-box.top))-diameter/2}px`;
  wave.append(ink);button.append(wave);
  play(ink,[{transform:'scale(0)',opacity:.24},{transform:'scale(1)',opacity:0}],{duration:480,easing:'cubic-bezier(0.16,1,0.3,1)'},()=>wave.remove());
 }
 function down(event){const button=event.target.closest('button');if(button&&event.button===0)press(button,event.clientX,event.clientY);}
 function click(event){
  const button=event.target.closest('button');if(!button||button.disabled)return;
  if(event.detail===0){const box=button.getBoundingClientRect();press(button,box.left+box.width/2,box.top+box.height/2);}
  const group=button.closest('.segmented'),marker=group?.querySelector('.segment-marker');
  pending=null;
  if(marker){const box=marker.getBoundingClientRect(),parent=group.getBoundingClientRect();pending={key:group.getAttribute('aria-label'),x:box.left-parent.left,y:box.top-parent.top,width:box.width,height:box.height};}
 }
 function sync(){if(reduced.matches||document.hidden){pending=null;stop();}}
 reduced.addEventListener('change',sync);document.addEventListener('visibilitychange',sync);
 return {mount(nextRoot){
  stop();resizeObserver?.disconnect();
  if(root!==nextRoot){
   root?.removeEventListener('pointerdown',down);root?.removeEventListener('click',click);
   root=nextRoot;root.addEventListener('pointerdown',down,{passive:true});root.addEventListener('click',click);
  }
  const groups=[...root.querySelectorAll('.segmented[aria-label]')];
  function position(group){
   const selected=group.querySelector('button.selected'),marker=group.querySelector('.segment-marker');
   if(!selected||!marker)return;
   const box=selected.getBoundingClientRect(),parent=group.getBoundingClientRect();
   const rect={x:box.left-parent.left,y:box.top-parent.top,width:box.width,height:box.height};
   Object.assign(marker.style,{left:`${rect.x}px`,top:`${rect.y}px`,width:`${rect.width}px`,height:`${rect.height}px`});
   return rect;
  }
  for(const group of groups){
   if(!group.querySelector('button.selected'))continue;
   let marker=group.querySelector('.segment-marker');
   if(!marker){marker=document.createElement('span');marker.className='segment-marker';marker.setAttribute('aria-hidden','true');group.prepend(marker);}
   group.classList.add('has-marker');
   const rect=position(group);
   if(rect?.width&&rect.height&&pending?.key===group.getAttribute('aria-label')){
    play(marker,[{transform:`translate(${pending.x-rect.x}px,${pending.y-rect.y}px) scale(${pending.width/rect.width},${pending.height/rect.height})`},{transform:'none'}],{duration:260,easing:'cubic-bezier(0.16,1,0.3,1)'});
   }
  }
  pending=null;
  if(typeof ResizeObserver==='function'){
   resizeObserver=new ResizeObserver(()=>groups.forEach(position));
   for(const group of groups){resizeObserver.observe(group);const selected=group.querySelector('button.selected');if(selected)resizeObserver.observe(selected);}
  }
 }};
}
