const preferenceKey='depositly.appearance.v1';

export function storedAppearance(){
 try{return localStorage.getItem(preferenceKey);}catch{return null;}
}

export function applyAppearance(dark){
 document.body.classList.toggle('dark',!!dark);
 document.querySelector('meta[name="theme-color"]')?.setAttribute('content',dark?'#070b12':'#f8fafc');
 try{localStorage.setItem(preferenceKey,dark?'dark':'light');}catch{}
}

// Policy pages share only the display preference, without opening account records.
if(document.body?.dataset?.themeScope==='policy'){
 const saved=storedAppearance();
 applyAppearance(saved?saved==='dark':window.matchMedia('(prefers-color-scheme: dark)').matches);
}
