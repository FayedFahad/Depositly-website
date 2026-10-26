const ForecastCharts=(()=>{
 const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 function render({points=[],gross,tax,net,formatMoney,emptyMessage}){
  if(emptyMessage)return '<div class="forecast-charts"><section class="forecast-chart forecast-chart-empty"><h3>Charts</h3><p>'+esc(emptyMessage)+'</p></section></div>';
  const valid=[gross,tax,net].every(n=>Number.isSafeInteger(n)&&n>=0)&&points.length>1&&points.every(p=>Number.isFinite(p.days)&&p.days>=0&&Number.isSafeInteger(p.net)&&p.net>=0);
  if(!valid)return '<div class="forecast-charts"><section class="forecast-chart forecast-chart-empty" role="status"><h3>Charts unavailable</h3><p>The current balance could not be calculated.</p></section></div>';
  const last=points[points.length-1],max=Math.max(1,...points.map(p=>p.net)),left=12,right=348,top=16,bottom=176,span=Math.max(1,last.days);
  const coords=points.map(p=>[left+p.days/span*(right-left),bottom-p.net/max*(bottom-top)]);
  const line=coords.map(([x,y],i)=>(i?'L':'M')+x.toFixed(2)+' '+y.toFixed(2)).join(' ');
  const area=line+' L'+right+' '+bottom+' L'+left+' '+bottom+' Z';
  const fmt=n=>esc(formatMoney(n)),grid=[0,.5,1].map(n=>'<line x1="'+left+'" y1="'+(top+n*(bottom-top))+'" x2="'+right+'" y2="'+(top+n*(bottom-top))+'" class="forecast-gridline"/>').join('');
  const ticks=[0,Math.round(last.days/2),last.days].map((day,i)=>'<text x="'+[left,(left+right)/2,right][i]+'" y="204" text-anchor="'+['start','middle','end'][i]+'">'+day+' days</text>').join('');
  const table='<details class="forecast-values"><summary>View chart values</summary><table><thead><tr><th scope="col">Days</th><th scope="col">Net interest</th></tr></thead><tbody>'+points.map(p=>'<tr><th scope="row">'+p.days+'</th><td>'+fmt(p.net)+'</td></tr>').join('')+'</tbody></table></details>';
  const bars=[['Gross interest',gross,'gross'],['TDS',tax,'tax'],['Net interest',net,'net']];
  return '<div class="forecast-charts"><section class="forecast-chart"><div class="forecast-chart-heading"><h3>Net interest over time</h3><b>'+fmt(last.net)+'</b></div><figure><svg class="forecast-line-chart" viewBox="0 0 360 220" role="img" aria-label="'+esc('Projected net interest after '+last.days+' days: '+formatMoney(last.net))+'">'+grid+'<path class="forecast-area" d="'+area+'"/><path class="forecast-line" d="'+line+'"/>'+coords.map(([x,y],i)=>'<circle class="forecast-point" cx="'+x.toFixed(2)+'" cy="'+y.toFixed(2)+'" r="3"><title>'+esc(points[i].days+' days: '+formatMoney(points[i].net))+'</title></circle>').join('')+ticks+'</svg></figure>'+table+'</section><section class="forecast-chart"><div class="forecast-chart-heading"><h3>Interest &amp; tax</h3><span>'+last.days+' days</span></div><div class="forecast-bars" role="list" aria-label="Interest and tax breakdown">'+bars.map(([label,value,kind])=>'<div class="forecast-bar-row" role="listitem"><div><span>'+label+'</span><b>'+fmt(value)+'</b></div><div class="forecast-bar-track"><span class="forecast-bar-fill forecast-bar-'+kind+'" style="width:'+(gross?value/gross*100:0).toFixed(4)+'%"></span></div></div>').join('')+'</div></section></div>';
 }
 return {render};
})();
export const renderForecastCharts=ForecastCharts.render;
