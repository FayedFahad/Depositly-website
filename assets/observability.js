import {inject, pageview} from '@vercel/analytics';
import {injectSpeedInsights} from '@vercel/speed-insights';

const sections=new Set(['dashboard','deposits','calendar','payments','backup','settings']);
const publicRoutes=new Set([...sections].map(section=>'/'+section).concat(['/privacy/','/terms/']));
const started=new WeakSet();

export function telemetryRoute(location){
 const path=location.pathname.replace(/\/index\.html$/,'/');
 if(path==='/'){const section=location.hash.slice(1);return '/'+(sections.has(section)?section:'dashboard');}
 if(/^\/(privacy|terms)\/?$/.test(path))return path.replace(/\/?$/,'/');
 if(sections.has(path.slice(1)))return path;
 return null;
}

/** Only public page names are measured; query strings and arbitrary fragments are excluded. */
export function cleanTelemetry(event,origin){
 try{
  if(!['pageview','vital'].includes(event?.type)||typeof event.url!=='string')return null;
  const url=new URL(event.url,origin);if(url.origin!==origin)return null;
  const route=event.type==='vital'&&publicRoutes.has(event.route)?event.route:telemetryRoute(url);if(!route)return null;
  return {...event,url:new URL(route,origin).href,...(event.type==='vital'?{route}: {})};
 }catch{return null;}
}

export function startObservability({win=globalThis.window,location=globalThis.location,analytics={inject,pageview},speed={injectSpeedInsights}}={}){
 if(!win||!location||location.protocol!=='https:'||/^(localhost|127\.0\.0\.1|\[::1\])$/.test(location.hostname)||!telemetryRoute(location)||started.has(win))return;
 started.add(win);
 const beforeSend=event=>cleanTelemetry(event,location.origin);
 analytics.inject({mode:'production',debug:false,disableAutoTrack:true,beforeSend});
 const insights=speed.injectSpeedInsights({debug:false,route:telemetryRoute(location),beforeSend});
 let previous;
 function trackPage(){
  const route=telemetryRoute(location);if(!route||route===previous)return;
  previous=route;analytics.pageview({path:route,route});insights?.setRoute(route);
 }
 trackPage();win.addEventListener('hashchange',trackPage);
}

if(typeof window!=='undefined')startObservability();
