"use strict";(()=>{var e={};e.id=744,e.ids=[744],e.modules={20399:e=>{e.exports=require("next/dist/compiled/next-server/app-page.runtime.prod.js")},30517:e=>{e.exports=require("next/dist/compiled/next-server/app-route.runtime.prod.js")},92048:e=>{e.exports=require("fs")},32615:e=>{e.exports=require("http")},35240:e=>{e.exports=require("https")},55315:e=>{e.exports=require("path")},68621:e=>{e.exports=require("punycode")},76162:e=>{e.exports=require("stream")},17360:e=>{e.exports=require("url")},21764:e=>{e.exports=require("util")},6162:e=>{e.exports=require("worker_threads")},71568:e=>{e.exports=require("zlib")},87561:e=>{e.exports=require("node:fs")},84492:e=>{e.exports=require("node:stream")},72477:e=>{e.exports=require("node:stream/web")},17506:(e,t,r)=>{r.r(t),r.d(t,{originalPathname:()=>x,patchFetch:()=>v,requestAsyncStorage:()=>h,routeModule:()=>p,serverHooks:()=>g,staticGenerationAsyncStorage:()=>m});var a={};r.r(a),r.d(a,{POST:()=>d,maxDuration:()=>u,runtime:()=>c});var n=r(49303),s=r(88716),o=r(60670),i=r(87070),l=r(43707);let c="nodejs",u=60;async function d(e){try{let{messages:t,stockContext:r}=await e.json();if(!t?.length)return i.NextResponse.json({error:"No messages provided"},{status:400});let a=process.env.ANTHROPIC_API_KEY??"";if(!a||"your_anthropic_api_key_here"===a)return new Response(`data: {"delta":"I'm TradeVision AI, but the ANTHROPIC_API_KEY is not configured. Please add it to your .env.local file to enable AI-powered analysis. In the meantime, I can tell you that configuring your API key will unlock real-time market analysis, buy/sell signal generation, and this chat interface!"}
data: [DONE]

`,{headers:{"Content-Type":"text/event-stream","Cache-Control":"no-cache",Connection:"keep-alive"}});let n=(0,l.d3)(t,r),s=new ReadableStream({async start(e){let t=new TextEncoder;try{for await(let r of n)if("content_block_delta"===r.type&&"text_delta"===r.delta.type){let a=JSON.stringify({delta:r.delta.text});e.enqueue(t.encode(`data: ${a}

`))}e.enqueue(t.encode("data: [DONE]\n\n"))}catch(a){let r=a instanceof Error?a.message:"Unknown error";e.enqueue(t.encode(`data: ${JSON.stringify({delta:`Error: ${r}`})}

`))}finally{e.close()}}});return new Response(s,{headers:{"Content-Type":"text/event-stream","Cache-Control":"no-cache",Connection:"keep-alive"}})}catch(e){return console.error("Chat route error:",e),i.NextResponse.json({error:"Internal server error"},{status:500})}}let p=new n.AppRouteRouteModule({definition:{kind:s.x.APP_ROUTE,page:"/api/chat/route",pathname:"/api/chat",filename:"route",bundlePath:"app/api/chat/route"},resolvedPagePath:"/home/user/openclaw/apps/tradevision-ai/app/api/chat/route.ts",nextConfigOutput:"",userland:a}),{requestAsyncStorage:h,staticGenerationAsyncStorage:m,serverHooks:g}=p,x="/api/chat/route";function v(){return(0,o.patchFetch)({serverHooks:g,staticGenerationAsyncStorage:m})}},43707:(e,t,r)=>{r.d(t,{MI:()=>i,d3:()=>c});var a=r(34588),n=r(46643),s=r(66273);let o=new a.ZP({apiKey:process.env.ANTHROPIC_API_KEY??""});async function i(e,t=[]){let r=`signal:${e.ticker}`,a=n.F.get(r);if(a)return a.data;if(!function(){let e=process.env.ANTHROPIC_API_KEY??"";return!!(e&&"your_anthropic_api_key_here"!==e)}()){let t=s.Hh.find(t=>t.ticker===e.ticker);if(t)return n.F.set(r,t,n.O.AI_SIGNAL),t;let a=l(e);return n.F.set(r,a,n.O.AI_SIGNAL),a}let i=t.length>0?`
Recent news:
${t.slice(0,3).map((e,t)=>`${t+1}. ${e}`).join("\n")}`:"",c=`You are a quantitative analyst. Analyze this stock and provide a trading signal.

Stock: ${e.ticker} (${e.name})
Current Price: $${e.price}
Change Today: ${e.changePercent>0?"+":""}${e.changePercent.toFixed(2)}%
P/E Ratio: ${e.peRatio??"N/A"}
EPS: ${e.eps?`$${e.eps}`:"N/A"}
52-Week Range: $${e.week52Low} - $${e.week52High}
Volume vs Avg: ${e.volume.toLocaleString()} vs ${e.avgVolume.toLocaleString()}
Market Cap: $${(e.marketCap/1e9).toFixed(1)}B
Beta: ${e.beta??"N/A"}
${i}

Respond ONLY with valid JSON in this exact format:
{
  "signal": "strong_buy" | "buy" | "hold" | "sell" | "strong_sell",
  "confidence": <number 0-100>,
  "risk_level": "low" | "medium" | "high",
  "reasoning": ["<point 1>", "<point 2>", "<point 3>", "<point 4>"],
  "target_price": <number or null>,
  "stop_loss": <number or null>
}`;try{let t=await o.messages.create({model:"claude-sonnet-4-6",max_tokens:512,messages:[{role:"user",content:c}]}),a="text"===t.content[0].type?t.content[0].text:"",s=JSON.parse(a),i={ticker:e.ticker,signal:s.signal,confidence:Math.min(100,Math.max(0,s.confidence)),riskLevel:s.risk_level,reasoning:s.reasoning.slice(0,5),targetPrice:s.target_price,stopLoss:s.stop_loss,generatedAt:Date.now(),modelVersion:"claude-sonnet-4-6"};return n.F.set(r,i,n.O.AI_SIGNAL),i}catch{let t=l(e);return n.F.set(r,t,n.O.AI_SIGNAL),t}}function l(e){let t=e.changePercent,r="hold",a=50;return t>3?(r="strong_buy",a=75):t>1?(r="buy",a=62):t<-3?(r="strong_sell",a=73):t<-1?(r="sell",a=60):(r="hold",a=55),{ticker:e.ticker,signal:r,confidence:a,riskLevel:Math.abs(t)>3?"high":Math.abs(t)>1?"medium":"low",reasoning:[`Price ${t>=0?"up":"down"} ${Math.abs(t).toFixed(2)}% on the session with ${e.volume>e.avgVolume?"above":"below"}-average volume`,`Trading ${((e.price-e.week52Low)/(e.week52High-e.week52Low)*100).toFixed(0)}% of the way through its 52-week range`,e.peRatio?`P/E of ${e.peRatio.toFixed(1)} is ${e.peRatio>30?"elevated":"reasonable"} relative to sector peers`:"Valuation metrics unavailable — exercise caution","AI-generated signal based on price action and available fundamentals"],targetPrice:null,stopLoss:parseFloat((.92*e.price).toFixed(2)),generatedAt:Date.now(),modelVersion:"mock"}}function c(e,t){let r=`You are TradeVision AI, an expert financial analyst and investment advisor assistant. You provide thoughtful, data-driven market analysis and investment insights.

${t?`Current market context:
${t}
`:""}
Guidelines:
- Be concise but insightful — 2-4 paragraphs max unless more detail is requested
- Format numbers clearly (e.g., "$150.23", "+2.4%", "$2.1T market cap")
- Always include a disclaimer that your analysis is not financial advice
- Use markdown formatting for tables and lists when helpful
- Be balanced — acknowledge both risks and opportunities`;return o.messages.stream({model:"claude-sonnet-4-6",max_tokens:1024,system:r,messages:e})}},46643:(e,t,r)=>{r.d(t,{F:()=>n,O:()=>s});class a{constructor(e=500){this.store=new Map,this.maxSize=e}set(e,t,r){if(this.store.size>=this.maxSize){let e=Array.from(this.store.entries()).sort((e,t)=>e[1].createdAt-t[1].createdAt)[0];e&&this.store.delete(e[0])}this.store.set(e,{data:t,expiresAt:Date.now()+r,createdAt:Date.now()})}get(e){let t=this.store.get(e);return t?Date.now()>t.expiresAt?(this.store.delete(e),null):{data:t.data,age:Date.now()-t.createdAt}:null}has(e){let t=this.store.get(e);return!!t&&(!(Date.now()>t.expiresAt)||(this.store.delete(e),!1))}invalidate(e){this.store.delete(e)}clear(){this.store.clear()}size(){return this.store.size}}let n=new a(500),s={QUOTE:3e4,CANDLES:6e4,PROFILE:36e5,NEWS:3e5,AI_SIGNAL:6e5,SEARCH:6e5,MARKET_DATA:3e4}}};var t=require("../../../webpack-runtime.js");t.C(e);var r=e=>t(t.s=e),a=t.X(0,[276,972,588,273],()=>r(17506));module.exports=a})();