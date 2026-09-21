/**
 * 시선 — 아침 말씀 알림 발송
 * 10분마다 호출되면, 지금 시각(한국)이 알람 시간인 사용자에게 오늘의 카드를 보냅니다.
 *
 * 필요한 환경변수 (Vercel → Settings → Environment Variables)
 *   FIREBASE_SERVICE_ACCOUNT : 파이어베이스 서비스 계정 JSON 전체를 붙여넣기
 *   CRON_SECRET              : 아무 비밀 문자열 (호출 시 ?key=... 로 확인)
 */
const crypto = require('crypto');

const PROJECT = 'photo-and-bible';
const FS = `https://firestore.googleapis.com/v1/projects/${PROJECT}/databases/(default)/documents`;
const SITE = process.env.SITE_URL || 'https://sajinmalsseum-full.vercel.app';
const WINDOW_MIN = 15;            // 알람 시각 기준 허용 오차(분)

/* ---------- 구글 액세스 토큰 (서비스 계정 JWT) ---------- */
async function getAccessToken(sa) {
  const now = Math.floor(Date.now() / 1000);
  const header = { alg: 'RS256', typ: 'JWT' };
  const claim = {
    iss: sa.client_email,
    scope: 'https://www.googleapis.com/auth/firebase.messaging https://www.googleapis.com/auth/datastore',
    aud: 'https://oauth2.googleapis.com/token',
    iat: now,
    exp: now + 3600
  };
  const b64 = o => Buffer.from(JSON.stringify(o)).toString('base64url');
  const unsigned = `${b64(header)}.${b64(claim)}`;
  const sig = crypto.createSign('RSA-SHA256').update(unsigned).sign(sa.private_key).toString('base64url');
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion: `${unsigned}.${sig}`
    })
  });
  const j = await res.json();
  if (!j.access_token) throw new Error('토큰 발급 실패: ' + JSON.stringify(j).slice(0, 200));
  return j.access_token;
}

/* ---------- Firestore 값 변환 ---------- */
const val = v => {
  if (!v) return undefined;
  if ('stringValue' in v) return v.stringValue;
  if ('booleanValue' in v) return v.booleanValue;
  if ('integerValue' in v) return Number(v.integerValue);
  if ('timestampValue' in v) return v.timestampValue;
  return undefined;
};
const fields = d => {
  const o = {};
  for (const [k, v] of Object.entries(d.fields || {})) o[k] = val(v);
  o.__name = d.name;
  return o;
};

/* ---------- 한국 시간 ---------- */
function kstNow() {
  const d = new Date(Date.now() + 9 * 3600 * 1000);
  return {
    date: d.toISOString().slice(0, 10),
    minutes: d.getUTCHours() * 60 + d.getUTCMinutes()
  };
}

module.exports = async (req, res) => {
  try {
    if (!process.env.CRON_SECRET || (req.query.key || '') !== process.env.CRON_SECRET) {
      return res.status(401).json({ error: '인증 실패' });
    }
    const sa = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
    const token = await getAccessToken(sa);
    const H = { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' };
    const { date, minutes } = kstNow();

    /* 1. 오늘의 카드 */
    const cardRes = await fetch(`${FS}/cards/${date}`, { headers: H });
    if (cardRes.status === 404) return res.json({ ok: true, skipped: '오늘 카드 없음', date });
    const card = fields(await cardRes.json());

    /* 2. 알람 켠 사용자 */
    const q = {
      structuredQuery: {
        from: [{ collectionId: 'users' }],
        where: { fieldFilter: { field: { fieldPath: 'alarmOn' }, op: 'EQUAL', value: { booleanValue: true } } },
        limit: 2000
      }
    };
    const rows = await (await fetch(`${FS}:runQuery`, { method: 'POST', headers: H, body: JSON.stringify(q) })).json();
    const users = (rows || []).filter(r => r.document).map(r => fields(r.document));

    /* 3. 지금이 알람 시각인 사람만 (오늘 이미 보낸 사람 제외) */
    const targets = users.filter(u => {
      if (!u.fcmToken) return false;
      if (u.lastSentDate === date) return false;
      const m = /^(\d{2}):(\d{2})$/.exec(u.alarmTime || '06:30');
      if (!m) return false;
      const t = Number(m[1]) * 60 + Number(m[2]);
      const diff = minutes - t;
      return diff >= 0 && diff < WINDOW_MIN;
    });

    /* 4. 발송 */
    const body = (card.verseKr || '').slice(0, 90) + (card.refKr ? ` (${card.refKr})` : '');
    let sent = 0, failed = 0;
    for (const u of targets) {
      const msg = {
        message: {
          token: u.fcmToken,
          data: { title: '오늘의 말씀', body, image: card.imageUrl || '', url: SITE + '/' },
          webpush: {
            headers: { Urgency: 'high', TTL: '43200' },
            notification: {
              title: '오늘의 말씀',
              body,
              icon: SITE + '/icon-192.png',
              badge: SITE + '/icon-192.png',
              image: card.imageUrl || undefined,
              tag: 'daily-verse'
            },
            fcm_options: { link: SITE + '/' }
          }
        }
      };
      const r = await fetch(`https://fcm.googleapis.com/v1/projects/${PROJECT}/messages:send`, {
        method: 'POST', headers: H, body: JSON.stringify(msg)
      });
      if (r.ok) {
        sent++;
        const id = u.__name.split('/').pop();
        await fetch(`${FS}/users/${id}?updateMask.fieldPaths=lastSentDate`, {
          method: 'PATCH', headers: H,
          body: JSON.stringify({ fields: { lastSentDate: { stringValue: date } } })
        });
      } else {
        failed++;
        // 만료된 토큰은 지워 다음부터 시도하지 않음
        if (r.status === 404 || r.status === 400) {
          const id = u.__name.split('/').pop();
          await fetch(`${FS}/users/${id}?updateMask.fieldPaths=fcmToken`, {
            method: 'PATCH', headers: H, body: JSON.stringify({ fields: {} })
          });
        }
      }
    }
    res.json({ ok: true, date, kstMinutes: minutes, candidates: users.length, targets: targets.length, sent, failed });
  } catch (e) {
    res.status(500).json({ error: String(e).slice(0, 300) });
  }
};
