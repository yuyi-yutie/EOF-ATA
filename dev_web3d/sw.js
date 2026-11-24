'use strict';

/* 最小 Service Worker：不缓存资源，只提供 PWA 安装所需的 fetch 处理。
   HTTPS / localhost 下才注册；局域网 HTTP 会跳过。 */

self.addEventListener('install', function () {
  self.skipWaiting();
});

self.addEventListener('activate', function (e) {
  e.waitUntil(self.clients.claim());
});

self.addEventListener('fetch', function () {
  /* 交回浏览器默认网络请求，不缓存，避免更新后拿到旧文件 */
});
