/* Service Worker锛氳鍒烽绔欒兘绂荤嚎鎵撳紑銆佽兘瑁呭埌鎵嬫満涓诲睆
   绛栫暐锛?     路 椤甸潰瀵艰埅锛氱綉缁滀紭鍏堬紝鏂綉鍥炶惤棣栭〉锛?     路 闈欐€佽祫婧愶紙js/css/鍥炬爣锛夛細stale-while-revalidate 鈥斺€?鍏堢敤缂撳瓨绔嬪埢鍑洪〉闈紝
       鍚屾椂鍦ㄥ悗鍙版媺鏈€鏂扮殑鍐欏洖缂撳瓨锛堜笅涓€娆℃墦寮€灏辨槸鏂扮殑锛夛紱
     路 鐭ヨ瘑搴?js / AI閰嶇疆.js锛堝彲鑳藉嚑 MB锛夛細缃戠粶浼樺厛锛屾垚鍔熷啓缂撳瓨锛屾柇缃戞椂鍚冪紦瀛?鈥斺€?       杩欐牱绗竴娆″姞杞戒笉浼氱櫧绛夛紝绂荤嚎涔熻兘鐢ㄨ祫鏂欙紱鐭ヨ瘑搴?js 鍚屾椂鍦ㄥ畨瑁呮椂棰勭紦瀛樹竴浠斤紝
       鎵€浠ヨ鍒版墜鏈轰富灞忎箣鍚庢柇缃戞墦寮€锛岃祫鏂欏簱鐓ф牱鑳芥悳銆?   鏀逛簡 app.js / style.css 绛夊唴瀹瑰悗锛屾妸 VERSION 鍔犱竴鍗冲彲璁╂棫缂撳瓨澶辨晥銆?*/
const VERSION = 'shuati-v68-web235';  // web227: 棰樼洰鍙充笂瑙掓柊澧炴壒娉?鐧芥澘/閲嶅仛/瀵煎嚭锛屾壒娉ㄨ窡鐫€棰樿蛋銆佺┖鐧芥澘瀛樻湰鏈烘墜绋垮巻鍙诧紝鍙鍑?HTML/PDF锛泈eb226: 绛旈鏉″乏渚ф柊澧炪€岄噸鍋氶搴?/ 浠呴敊棰樸€嶏紝閿欓鍙璁㈡锛坒ixed锛夛紝绱閿欐浠嶄繚鐣欙紱web224: 鍒犳帀姝ｅ湪鑰冪殑閭ｄ唤濂楀嵎浼氬悓鏃剁粨鏉熻€冭瘯锛屼笉鍐嶅弽澶嶆彁绀猴紱web223: 妯℃嫙鑰冭瘯绂诲紑涓嶅啀寮圭‘璁ゆ銆佸€掕鏃剁湡鐨勬殏鍋滃苟鍙画锛泈eb222: 浜戝悓姝ュ悎骞舵寜鏃堕棿鎴冲彇鏂帮紙鏃т簯绔笉鍐嶅啿鎺夊垰鍋氱殑澶嶄範鎺掓湡锛夛紱web221: 鏂囦欢澶瑰纰戯紙鍒犱簡涓嶅啀澶嶆椿锛夈€丼RS 涓嶅啀鍙嶅閲嶅叆锛泈eb220: 銆岎煋?鐪嬭祫鏂欍€嶆寜閽尓鍒般€屸嫰 鏇村銆嶆梺杈广€佸皬绔犱笉鍐嶄涪锛泈eb219 鍙湅璧勬枡锛泈eb218 澶у瓧妯″紡
// web217: SRS 璁よ瘑/妯＄硦/蹇樿涓夋。鍚勮嚜绠楅棿闅?+ 鏇村鎶藉眽灞呬腑涓旈€熷埛涔熸湁 + win95寮€濮嬫寜閽笉鍐嶅帇绉戠洰鏍?+ 瑙ｆ瀽灏卞湴绮樿创琛ㄦ牸 + 棰樺簱鍒犻櫎璐︽湰
const CORE = [
  /* 鍙缂撳瓨銆岃兘鎵撳紑椤甸潰銆嶇殑鏈€灏忎竴缁勶細瑁呭埌涓诲睆鍚庢柇缃戜篃鑳借繘绔欍€?     鍏跺畠 js/css/瀛椾綋绗竴娆＄敤鍒版椂鐢变笅闈㈢殑 stale-while-revalidate 鑷姩杩涚紦瀛橈紝
     涓嶅啀姣忔鍗囩増鏈兘鎶婃暣濂楋紙绾?2 MB锛夐噸涓嬩竴閬?鈥斺€?閭ｆ槸鎵嬫満涓婃祦閲忔帀寰楀揩鐨勭湡鍑躲€?*/
  './',
    './style.css',
  './app.js'
];

const SITE_CACHE = 'shuati-site-' + VERSION;   /* 绔欑偣璧勬簮锛氬崌鐗堟湰鏃舵竻绌?*/
const DATA_CACHE = 'shuati-data-v1';           /* 璧勬枡 / 閰嶇疆锛氳法鐗堟湰淇濈暀 */

/* 鏉′欢閲嶉獙锛氬甫 no-cache 璁╂祻瑙堝櫒鐢?If-None-Match 闂湇鍔″櫒锛屾病鍙樺氨鏄?304锛堝嚑涔庝笉鑰楁祦閲忥級 */
/* 闈欐€佽祫婧愭寜 pathname 瀛樺彇锛歩ndex.html 閲?js/css 閮藉甫 ?v=鎴筹紝甯﹀弬灏辩敤涓嶄笂缂撳瓨 */
const STATIC_RE = /\.(js|css|mjs|png|jpg|jpeg|gif|webp|svg|ico|woff2?|ttf)$/i;
function cacheKey(req) {
  try {
    const u = new URL(req.url);
    if (u.origin !== location.origin) return req;
    if (STATIC_RE.test(u.pathname)) return new Request(u.origin + u.pathname);
  } catch (e) {}
  return req;
}

function revalidate(req) {
  let r;
  try { r = new Request(req.url, { cache: 'no-cache', credentials: 'same-origin' }); }
  catch (e) { r = req; }
  return fetch(r).then(res => {
    if (res && res.status === 200 && res.type === 'basic') {
      const copy = res.clone();
      caches.open(SITE_CACHE).then(c => c.put(cacheKey(req), copy)).catch(() => {});
    }
    return res;
  }).catch(() => null);
}

self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(SITE_CACHE)
      .then(c => Promise.all(CORE.map(u => c.add(u).catch(() => null))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(ks => Promise.all(ks.filter(k => k !== SITE_CACHE && k !== DATA_CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  let url;
  try { url = new URL(req.url); } catch (err) { return; }
  if (url.origin !== location.origin) return;

  /* PDF 涓€寰嬩笉绠★紙鐩存帴鏀剧粰鏈嶅姟鍣級锛?     鈶?绔欑偣鐩綍閲岀殑 pdf\ 鏄湰鏈哄嚑鍗?MB 鐨勭簿缂栫増锛屼笉璇ヨ繘 SW 缂撳瓨锛?     鈶?瀵艰埅鍒?PDF 濡傛灉琚?SW 鎺ョ锛屼竴鏃﹀彇涓嶅埌灏变細鍥炶惤鎴愮紦瀛樼殑 index.html 鈥斺€?        鐢ㄦ埛鐪嬪埌鐨勬槸銆屽埛棰樼珯棣栭〉銆嶈€屼笉鏄?PDF锛?026-10-16 韪╁埌鐨勫潙锛夛紱
     鈶?Chrome 鐨?PDF 闃呰鍣ㄩ渶瑕?Range 璇锋眰鍘熺敓澶勭悊锛岀粫寮€ SW 鏈€绋炽€?*/
  let isPdf = false;
  try { isPdf = /\.pdf$/i.test(decodeURIComponent(url.pathname)); } catch (err) {}
  if (isPdf) return;

  /* 绔欏唴缃戦〉闃呰鍣紙pdfjs\锛屾墜鏈虹湅鍘熼〉鐢ㄧ殑锛夛細瀹冩槸涓?*鏅€氱綉椤?*锛屽彧鏄父甯镐互 iframe 鐨勫舰寮忚鎵撳紑銆?     鈶?瀹冪殑瀵艰埅璇锋眰涓嶈兘璧颁笅闈㈤偅鏉°€屽彇涓嶅埌灏卞洖钀?index.html銆嶁€斺€斾笉鐒堕槄璇诲櫒妗嗛噷浼氳烦鍑烘暣涓埛棰樼珯棣栭〉锛堣窡 PDF 閭ｆ潯绾㈢嚎鍚屼竴绫诲潙锛夛紱
     鈶?瀹冪殑闈欐€佽祫婧愶紙viewer.mjs / pdf.worker.mjs 閭?4 MB锛夎蛋鏅€氶潤鎬佽祫婧愮殑缂撳瓨绛栫暐灏卞浜嗐€?/
  let isViewer = false;
  try { isViewer = /\/pdfjs\//.test(decodeURIComponent(url.pathname)); } catch (err) {}

  /* 椤甸潰瀵艰埅锛氱綉缁滀紭鍏堬紝鏂綉鍥炶惤棣栭〉锛堥槄璇诲櫒闄ゅ锛?*/
  if (req.mode === 'navigate' && !isViewer) {
    e.respondWith(
      fetch(req).catch(() => caches.match('./index.html').then(r => r || caches.match('./')))
    );
    return;
  }

  /* 璧勬枡 / 閰嶇疆锛堝彲鑳藉嚑 MB锛夛細缃戠粶浼樺厛锛堟湰鍦版湇鍔″櫒涓婂緢蹇級锛屾垚鍔熷氨鏇存柊缂撳瓨锛屾柇缃戝洖钀界紦瀛?*/
  let dataFile = false;
  try { dataFile = /\/(鐭ヨ瘑搴搢AI閰嶇疆)\.js$/.test(decodeURIComponent(url.pathname)); } catch (err) {}

  if (dataFile) {
    e.respondWith((async () => {
      const dc = await caches.open(DATA_CACHE);
      const hit = await dc.match(cacheKey(req));
      /* 鍏堥棶鏈嶅姟鍣ㄥ彉娌″彉锛?04 灏辩户缁敤缂撳瓨锛堝嚑涔庝笉鑰楁祦閲忥級锛?00 鎵嶆暣浠介噸涓?*/
      let fresh = null;
      try {
        const r = await fetch(new Request(req.url, { cache: 'no-cache', credentials: 'same-origin' }));
        if (r && r.status === 200 && r.type === 'basic') fresh = r;
      } catch (err) {}
      if (fresh) { dc.put(cacheKey(req), fresh.clone()).catch(() => {}); return fresh; }
      if (hit) return hit;
      return fetch(req);
    })());
    return;
  }

  /* 鍏跺畠闈欐€佽祫婧愶細缂撳瓨浼樺厛锛涘悗鍙板彧鍋氭潯浠堕噸楠岋紙娌″彉 304锛屽嚑涔庝笉鑰楁祦閲忥級 */
  e.respondWith((async () => {
    const hit = await caches.match(cacheKey(req));
    const netP = revalidate(req);
    if (hit) {
      e.waitUntil(netP.then(() => null).catch(() => null));
      return hit;
    }
    const res = await netP;
    if (res) return res;
    if (isViewer) return new Response('绂荤嚎锛岃€屼笖闃呰鍣ㄨ繕娌＄紦瀛樿繃', { status: 503, headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
    return (await caches.match('./index.html')) || Response.error();
  })());
});
