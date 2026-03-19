"use strict";(()=>{var e={};e.id=869,e.ids=[869],e.modules={20399:e=>{e.exports=require("next/dist/compiled/next-server/app-page.runtime.prod.js")},30517:e=>{e.exports=require("next/dist/compiled/next-server/app-route.runtime.prod.js")},92048:e=>{e.exports=require("fs")},32615:e=>{e.exports=require("http")},35240:e=>{e.exports=require("https")},55315:e=>{e.exports=require("path")},68621:e=>{e.exports=require("punycode")},76162:e=>{e.exports=require("stream")},17360:e=>{e.exports=require("url")},21764:e=>{e.exports=require("util")},6162:e=>{e.exports=require("worker_threads")},71568:e=>{e.exports=require("zlib")},87561:e=>{e.exports=require("node:fs")},84492:e=>{e.exports=require("node:stream")},72477:e=>{e.exports=require("node:stream/web")},84733:(e,t,r)=>{r.r(t),r.d(t,{originalPathname:()=>m,patchFetch:()=>x,requestAsyncStorage:()=>d,routeModule:()=>p,serverHooks:()=>h,staticGenerationAsyncStorage:()=>g});var a={};r.r(a),r.d(a,{GET:()=>c});var s=r(49303),i=r(88716),n=r(60670),o=r(87070),l=r(43707),u=r(66273);async function c(e){let t=e.nextUrl.searchParams.get("ticker")?.toUpperCase();if(!t)return o.NextResponse.json({error:"Missing ticker"},{status:400});let r=u.F_[t];if(!r)return o.NextResponse.json({error:"Unknown ticker"},{status:404});try{let e=await (0,l.MI)(r);return o.NextResponse.json(e,{headers:{"Cache-Control":"s-maxage=600, stale-while-revalidate"}})}catch(e){return o.NextResponse.json({error:"Failed to generate signal"},{status:500})}}let p=new s.AppRouteRouteModule({definition:{kind:i.x.APP_ROUTE,page:"/api/ai-signal/route",pathname:"/api/ai-signal",filename:"route",bundlePath:"app/api/ai-signal/route"},resolvedPagePath:"/home/user/openclaw/apps/tradevision-ai/app/api/ai-signal/route.ts",nextConfigOutput:"",userland:a}),{requestAsyncStorage:d,staticGenerationAsyncStorage:g,serverHooks:h}=p,m="/api/ai-signal/route";function x(){return(0,n.patchFetch)({serverHooks:h,staticGenerationAsyncStorage:g})}},43707:(e,t,r)=>{r.d(t,{MI:()=>o,d3:()=>u});var a=r(34588),s=r(46643),i=r(66273);let n=new a.ZP({apiKey:process.env.ANTHROPIC_API_KEY??""});async function o(e,t=[]){let r=`signal:${e.ticker}`,a=s.F.get(r);if(a)return a.data;if(!function(){let e=process.env.ANTHROPIC_API_KEY??"";return!!(e&&"your_anthropic_api_key_here"!==e)}()){let t=i.Hh.find(t=>t.ticker===e.ticker);if(t)return s.F.set(r,t,s.O.AI_SIGNAL),t;let a=l(e);return s.F.set(r,a,s.O.AI_SIGNAL),a}let o=t.length>0?`
Recent news:
${t.slice(0,3).map((e,t)=>`${t+1}. ${e}`).join("\n")}`:"",u=`You are a quantitative analyst. Analyze this stock and provide a trading signal.

Stock: ${e.ticker} (${e.name})
Current Price: $${e.price}
Change Today: ${e.changePercent>0?"+":""}${e.changePercent.toFixed(2)}%
P/E Ratio: ${e.peRatio??"N/A"}
EPS: ${e.eps?`$${e.eps}`:"N/A"}
52-Week Range: $${e.week52Low} - $${e.week52High}
Volume vs Avg: ${e.volume.toLocaleString()} vs ${e.avgVolume.toLocaleString()}
Market Cap: $${(e.marketCap/1e9).toFixed(1)}B
Beta: ${e.beta??"N/A"}
${o}

Respond ONLY with valid JSON in this exact format:
{
  "signal": "strong_buy" | "buy" | "hold" | "sell" | "strong_sell",
  "confidence": <number 0-100>,
  "risk_level": "low" | "medium" | "high",
  "reasoning": ["<point 1>", "<point 2>", "<point 3>", "<point 4>"],
  "target_price": <number or null>,
  "stop_loss": <number or null>
}`;try{let t=await n.messages.create({model:"claude-sonnet-4-6",max_tokens:512,messages:[{role:"user",content:u}]}),a="text"===t.content[0].type?t.content[0].text:"",i=JSON.parse(a),o={ticker:e.ticker,signal:i.signal,confidence:Math.min(100,Math.max(0,i.confidence)),riskLevel:i.risk_level,reasoning:i.reasoning.slice(0,5),targetPrice:i.target_price,stopLoss:i.stop_loss,generatedAt:Date.now(),modelVersion:"claude-sonnet-4-6"};return s.F.set(r,o,s.O.AI_SIGNAL),o}catch{let t=l(e);return s.F.set(r,t,s.O.AI_SIGNAL),t}}function l(e){let t=e.changePercent,r="hold",a=50;return t>3?(r="strong_buy",a=75):t>1?(r="buy",a=62):t<-3?(r="strong_sell",a=73):t<-1?(r="sell",a=60):(r="hold",a=55),{ticker:e.ticker,signal:r,confidence:a,riskLevel:Math.abs(t)>3?"high":Math.abs(t)>1?"medium":"low",reasoning:[`Price ${t>=0?"up":"down"} ${Math.abs(t).toFixed(2)}% on the session with ${e.volume>e.avgVolume?"above":"below"}-average volume`,`Trading ${((e.price-e.week52Low)/(e.week52High-e.week52Low)*100).toFixed(0)}% of the way through its 52-week range`,e.peRatio?`P/E of ${e.peRatio.toFixed(1)} is ${e.peRatio>30?"elevated":"reasonable"} relative to sector peers`:"Valuation metrics unavailable — exercise caution","AI-generated signal based on price action and available fundamentals"],targetPrice:null,stopLoss:parseFloat((.92*e.price).toFixed(2)),generatedAt:Date.now(),modelVersion:"mock"}}function u(e,t){let r=`You are TradeVision AI, an expert financial analyst and investment advisor assistant. You provide thoughtful, data-driven market analysis and investment insights.

${t?`Current market context:
${t}
`:""}
Guidelines:
- Be concise but insightful — 2-4 paragraphs max unless more detail is requested
- Format numbers clearly (e.g., "$150.23", "+2.4%", "$2.1T market cap")
- Always include a disclaimer that your analysis is not financial advice
- Use markdown formatting for tables and lists when helpful
- Be balanced — acknowledge both risks and opportunities`;return n.messages.stream({model:"claude-sonnet-4-6",max_tokens:1024,system:r,messages:e})}},46643:(e,t,r)=>{r.d(t,{F:()=>s,O:()=>i});class a{constructor(e=500){this.store=new Map,this.maxSize=e}set(e,t,r){if(this.store.size>=this.maxSize){let e=Array.from(this.store.entries()).sort((e,t)=>e[1].createdAt-t[1].createdAt)[0];e&&this.store.delete(e[0])}this.store.set(e,{data:t,expiresAt:Date.now()+r,createdAt:Date.now()})}get(e){let t=this.store.get(e);return t?Date.now()>t.expiresAt?(this.store.delete(e),null):{data:t.data,age:Date.now()-t.createdAt}:null}has(e){let t=this.store.get(e);return!!t&&(!(Date.now()>t.expiresAt)||(this.store.delete(e),!1))}invalidate(e){this.store.delete(e)}clear(){this.store.clear()}size(){return this.store.size}}let s=new a(500),i={QUOTE:3e4,CANDLES:6e4,PROFILE:36e5,NEWS:3e5,AI_SIGNAL:6e5,SEARCH:6e5,MARKET_DATA:3e4}}};var t=require("../../../webpack-runtime.js");t.C(e);var r=e=>t(t.s=e),a=t.X(0,[276,972,588,273],()=>r(84733));module.exports=a})();