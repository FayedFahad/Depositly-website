// Greenstone-inspired edge light, with pointer feedback on actionable cards only.
export function createCardMotion() {
 const reduced=window.matchMedia?.('(prefers-reduced-motion: reduce)');
 if(!reduced)return {mount(){}};
 const fine=window.matchMedia('(hover: hover) and (pointer: fine)');
 let observer,root,active,frame=0,point;
 function reset(){
  cancelAnimationFrame(frame);frame=0;point=null;
  if(active){for(const name of ['--rx','--ry','--spot-x','--spot-y'])active.style.removeProperty(name);active=null;}
 }
 function sync(){
  document.body.classList.toggle('motion-paused',document.hidden||reduced.matches);
  if(document.hidden||reduced.matches||!fine.matches)reset();
 }
 function move(event){
  if(document.hidden||reduced.matches||!fine.matches||event.pointerType==='touch')return;
  const card=event.target.closest('.holding-card');
  if(!card){reset();return;}
  if(card!==active){reset();active=card;}
  point={x:event.clientX,y:event.clientY};
  if(frame)return;
  frame=requestAnimationFrame(()=>{
   frame=0;if(!active||!point)return;
   const box=active.getBoundingClientRect();
   const x=Math.max(0,Math.min(1,(point.x-box.left)/box.width));
   const y=Math.max(0,Math.min(1,(point.y-box.top)/box.height));
   active.style.setProperty('--rx',`${(.5-y)*4}deg`);
   active.style.setProperty('--ry',`${(x-.5)*4}deg`);
   active.style.setProperty('--spot-x',`${x*100}%`);
   active.style.setProperty('--spot-y',`${y*100}%`);
  });
 }
 function leave(event){if(active&&!active.contains(event.relatedTarget))reset();}
 reduced.addEventListener('change',sync);fine.addEventListener('change',sync);
 document.addEventListener('visibilitychange',sync);
 return {mount(nextRoot){
  reset();observer?.disconnect();
  if(root!==nextRoot){
   root?.removeEventListener('pointermove',move);root?.removeEventListener('pointerout',leave);
   root=nextRoot;root.addEventListener('pointermove',move,{passive:true});root.addEventListener('pointerout',leave);
  }
  const cards=[...root.querySelectorAll('.card')];
  observer=typeof IntersectionObserver==='function'?new IntersectionObserver(entries=>{
   for(const entry of entries)entry.target.classList.toggle('motion-visible',entry.isIntersecting);
  }):null;
  cards.forEach((card,index)=>{
   let edge=card.querySelector(':scope > .live-border');
   if(!edge){edge=document.createElement('span');edge.className='live-border';edge.setAttribute('aria-hidden','true');card.prepend(edge);}
   edge.style.setProperty('--beam-delay',`${-(index%7)*.85}s`);
   // Without visibility observation, keep the static edge rather than run unseen loops.
   observer?.observe(card);
  });
  sync();
 }};
}
