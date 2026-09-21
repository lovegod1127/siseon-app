/**
 * 알림 시험 발송 — 내 기기로 지금 바로 한 통 보내기
 * 사용법:  /api/test-push?key=CRON_SECRET값&token=내FCM토큰
 * (토큰은 앱 알림 탭에서 알람을 켠 뒤 Firestore users 문서에서 확인할 수 있습니다)
 */
const crypto = require('crypto');
const PROJECT = 'photo-and-bible';
const SITE = process.env.SITE_URL || 'https://sajinmalsseum-full.vercel.app';

async function getAccessToken(sa) {
  const now = Math.floor(Date.now() / 1000);
  const b64 = o => Buffer.from(JSON.stringify(o)).toString('base64url');
  const unsigned = b64({ alg: 'RS256', typ: 'JWT' }) + '.' + b64({
    iss: sa.client_email,
    scope: 'https://www.googleapis.com/auth/firebase.messaging',
    aud: 'https://oauth2.googleapis.com/token', iat: now, exp: now + 3600
  });
  const sig = crypto.createSign('RSA-SHA256').update(unsigned).sign(sa.private_key).toString('base64url');
  const j = await (await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: unsigned + '.' + sig })
  })).json();
  if (!j.access_token) throw new Error('토큰 발급 실패');
  return j.access_token;
}

module.exports = async (req, res) => {
  try {
    if (!process.env.CRON_SECRET || (req.query.key || '') !== process.env.CRON_SECRET)
      return res.status(401).json({ error: '인증 실패' });
    const target = req.query.token;
    if (!target) return res.status(400).json({ error: 'token 파라미터가 필요합니다' });
    const sa = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
    const token = await getAccessToken(sa);
    const msg = {
      message: {
        token: target,
        data: { title: '시선 · 시험 알림', body: '알림이 정상적으로 도착했습니다 🌿', url: SITE + '/' },
        webpush: {
          notification: { title: '시선 · 시험 알림', body: '알림이 정상적으로 도착했습니다 🌿',
                          icon: SITE + '/icon-192.png', tag: 'test' },
          fcm_options: { link: SITE + '/' }
        }
      }
    };
    const r = await fetch(`https://fcm.googleapis.com/v1/projects/${PROJECT}/messages:send`, {
      method: 'POST', headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
      body: JSON.stringify(msg)
    });
    res.status(r.ok ? 200 : 500).json({ ok: r.ok, detail: await r.text() });
  } catch (e) { res.status(500).json({ error: String(e).slice(0, 300) }); }
};
