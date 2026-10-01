const CACHE='eventproof-scanner-v1';
const STATIC=['/scanner.html','/css/app.css','/js/scanner.js'];
self.addEventListener('install',event=>{event.waitUntil(caches.open(CACHE).then(c=>Promise.all(STATIC.map(u=>c.add(u).catch(()=>null)))).then(()=>self.skipWaiting()))});
self.addEventListener('activate',event=>{event.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(k=>k!==CACHE&&k.startsWith('eventproof-scanner-')).map(k=>caches.delete(k)))).then(()=>self.clients.claim()))});
self.addEventListener('fetch',event=>{const req=event.request;if(req.method!=='GET')return;const url=new URL(req.url);if(url.origin!==location.origin||url.pathname.startsWith('/api/'))return;const isScanner=STATIC.includes(url.pathname);if(!isScanner)return;event.respondWith(fetch(req).then(res=>{if(res.ok&&!res.redirected){const copy=res.clone();caches.open(CACHE).then(c=>c.put(req,copy))}return res}).catch(()=>caches.match(req).then(r=>r||caches.match(url.pathname))))});
