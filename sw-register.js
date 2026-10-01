'use strict';
// PWA 注册：file:// 下没有 origin，ES module 与 serviceWorker 都不可用，
// 那不是玩家的错，注册要静默跳过且不抛未捕获异常。
if ('serviceWorker' in navigator && location.protocol.indexOf('http') === 0) {
  window.addEventListener('load', function () {
    navigator.serviceWorker.register('sw.js').catch(function () {});
  });
}
