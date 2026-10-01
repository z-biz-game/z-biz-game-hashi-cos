'use strict';
// 数桥 HASHI service worker —— 网络优先，断网退缓存。
//
// 为什么坚持 network-first：手工 VERSION + cache-first 会把 js/css 永久钉死在旧版，
// 出新 HTML 配旧 JS 的鬼状态比"离线打不开"糟得多。所以每个请求先走网络，命中就顺手
// 回填缓存；只有网络失败（离线/超时）才回落到上次成功抓取的资源。
//
// cache 名带版本号：改这套预缓存清单时把 CACHE 里的数字 +1，activate 会清掉旧桶。
const CACHE = 'hashi-pwa-v2';
const SHELL = [
  './',
  './index.html',
  './css/game.css',
  './manifest.webmanifest',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/apple-touch-icon.png',
  './icons/favicon-32.png',
];

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE)
      .then((c) => c.addAll(SHELL))
      .catch(() => {}) // 单个预缓存资源缺失不该让 install 失败
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  let url;
  try {
    url = new URL(req.url);
  } catch (err) {
    return;
  }
  if (url.origin !== self.location.origin) return; // 不接管跨域请求

  e.respondWith(
    fetch(req)
      .then((res) => {
        if (res && res.ok) {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(req, copy));
        }
        return res;
      })
      .catch(() =>
        caches.match(req).then((hit) => {
          if (hit) return hit;
          // 导航请求离线时回落到缓存里的 index.html，让已安装的应用还能打开
          if (req.mode === 'navigate') return caches.match('./index.html');
          return Response.error();
        })
      )
  );
});
