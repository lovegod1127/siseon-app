/* 백그라운드(앱이 닫혀 있을 때) 알림 처리 */
importScripts('https://www.gstatic.com/firebasejs/10.12.2/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/10.12.2/firebase-messaging-compat.js');

firebase.initializeApp({
  apiKey: "AIzaSyCuYS1eHvykRe5UKgBM_J1Xq2YxSEf7mdM",
  authDomain: "photo-and-bible.firebaseapp.com",
  projectId: "photo-and-bible",
  storageBucket: "photo-and-bible.firebasestorage.app",
  messagingSenderId: "51933715720",
  appId: "1:51933715720:web:017d6a7b10eef69b3320bd"
});

const messaging = firebase.messaging();

messaging.onBackgroundMessage(payload => {
  const d = payload.data || {};
  const title = d.title || '오늘의 말씀';
  self.registration.showNotification(title, {
    body: d.body || '',
    icon: '/icon-192.png',
    badge: '/icon-192.png',
    image: d.image || undefined,
    tag: 'daily-verse',
    renotify: true,
    data: { url: d.url || '/' }
  });
});

self.addEventListener('notificationclick', e => {
  e.notification.close();
  const url = (e.notification.data && e.notification.data.url) || '/';
  e.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(list => {
      for (const c of list) { if ('focus' in c) return c.focus(); }
      return clients.openWindow(url);
    })
  );
});
