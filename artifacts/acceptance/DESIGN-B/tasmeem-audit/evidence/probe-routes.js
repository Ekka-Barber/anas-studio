(async()=>{
for (let y=0;y<document.documentElement.scrollHeight;y+=600){scrollTo(0,y);await new Promise(r=>setTimeout(r,50));}
await new Promise(r=>setTimeout(r,400)); scrollTo(0,0);
const W=innerWidth; const res={route:location.pathname,w:W};
const sel=(el)=>{const p=[];for(let n=el,i=0;n&&n.nodeType===1&&i<3;n=n.parentElement,i++){let s=n.tagName.toLowerCase();const c=[...n.classList][0];if(c)s+='.'+c.replace(/^[a-z-]+-module__\w+__/,'');p.unshift(s)}return p.join('>')};
const wraps=[];
for(const el of document.querySelectorAll('a[href],button,summary')){const cs=getComputedStyle(el);if(cs.display==='inline'||el.closest('[hidden],dialog:not([open])'))continue;const r=el.getBoundingClientRect();if(!r.width)continue;
 if(el.querySelector('h1,h2,h3,p,img,video,picture,ul,ol'))continue;
 const tops=[];const w=document.createTreeWalker(el,NodeFilter.SHOW_TEXT);let n;while(n=w.nextNode()){if(!n.nodeValue.trim())continue;const rg=document.createRange();rg.selectNodeContents(n);for(const q of rg.getClientRects())if(q.width>2)tops.push(q.top)}
 tops.sort((a,b)=>a-b);let lines=0,last=-1e9;for(const t of tops){if(t-last>8)lines++;last=t}
 if(lines>1)wraps.push({t:el.innerText.replace(/\s+/g,' ').slice(0,50),lines,w:Math.round(r.width),s:sel(el)});}
res.wraps=wraps;
const over=[];for(const el of document.body.querySelectorAll('*')){const r=el.getBoundingClientRect();if(!r.width||!r.height||el.closest('dialog:not([open]),[hidden]'))continue;if(!(r.right>W+1||r.left<-1))continue;let contained=false;for(let a=el.parentElement;a&&a!==document.body;a=a.parentElement){const o=getComputedStyle(a).overflowX;if(o!=='visible'){contained=true;break}}if(!contained)over.push({s:sel(el),l:Math.round(r.left),r:Math.round(r.right)})}
res.overflow=over.slice(0,8);res.overflowN=over.length;
let indic=0,latin=0;const tw=document.createTreeWalker(document.body,NodeFilter.SHOW_TEXT);let t;while(t=tw.nextNode()){const v=t.nodeValue;if(/[\u0660-\u0669\u06F0-\u06F9]/.test(v))indic++;if(/[0-9]/.test(v))latin++}
res.digits={latin,indic};
const faux=[];const ital=[];const track=[];for(const el of document.body.querySelectorAll('*')){if(!el.childNodes.length)continue;const own=[...el.childNodes].filter(c=>c.nodeType===3).map(c=>c.nodeValue).join('').trim();if(!own)continue;const cs=getComputedStyle(el);if(/Serif Display/.test(cs.fontFamily)&&+cs.fontWeight>=600)faux.push(sel(el)+' w'+cs.fontWeight);if(/Sans/.test(cs.fontFamily)&&+cs.fontWeight>=800)faux.push(sel(el)+' w'+cs.fontWeight);if(cs.fontStyle!=='normal'&&/[\u0600-\u06FF]/.test(own))ital.push(sel(el));if(cs.letterSpacing!=='normal'&&parseFloat(cs.letterSpacing)!==0&&/[\u0600-\u06FF]/.test(own))track.push(sel(el))}
res.faux=[...new Set(faux)].slice(0,6);res.italic=ital.slice(0,5);res.track=track.slice(0,5);
const small=[];for(const el of document.querySelectorAll('a[href],button,input,select,textarea,summary')){const r=el.getBoundingClientRect();if(!r.width||el.closest('[hidden],dialog:not([open])'))continue;const cs=getComputedStyle(el);if(cs.visibility==='hidden')continue;const inline=el.tagName==='A'&&cs.display==='inline';if((r.width<44||r.height<44)&&!/INPUT|SELECT|TEXTAREA/.test(el.tagName))small.push({t:(el.getAttribute('aria-label')||el.innerText).replace(/\s+/g,' ').slice(0,30),w:Math.round(r.width),h:Math.round(r.height),inline,s:sel(el)})}
res.small=small.slice(0,10);
const hs=[...document.querySelectorAll('h1,h2,h3,h4,h5,h6')].filter(h=>h.getBoundingClientRect().height>0).map(h=>h.tagName[1]+':'+h.innerText.replace(/\s+/g,' ').slice(0,24));res.headings=hs;
res.lang=document.documentElement.lang+'/'+document.documentElement.dir;res.title=document.title;
return JSON.stringify(res);
})()
