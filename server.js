const http = require('http');
const fs = require('fs');
const path = require('path');
const https = require('https');

const VERIFY_TOKEN = 'drmina2024';
const WA_TOKEN = 'EAAVX8PjEKMoBRza7ojJhgmJgSI1qqHTUPeXsYvmv32OpEDQQrTwFlUvcH11NHuubNaNSpjSj0ay5GW9GcB4hz5kZBgiA32nZCkrOOZB9f2BXPMIiuIeboKwoZBeUHNl8Th5FPy8iRHNFfagntfAUWOZALZAA4aTiWVozH9vmkrZBbURLqH7OCJtDjojFmn8Lj6vpRuKmcr1Q9NqYSOr4f2LEGjwGJtGsCXIyhlwQd2kNUCx1OOYAZB4yCsrbfEuAMrJEklwTl3LRbIZABAQ8lMwZDZD';
const PHONE_NUMBER_ID = '1218801781318747';
const GOOGLE_REVIEW_LINK = 'https://g.page/r/CUs38k2cmQ1UEBM/review';
const DR_MINA_PERSONAL = '971551008368';
const SHEET_WEBHOOK = 'https://script.google.com/macros/s/AKfycbymMR_sc62FrCdyXkD5j7q9tNCKqH-ot7ElKR0RWFTUwcWMU7032-WxHEygEaLAYIs/exec';

const awaitingComplaint = {};

const MSG_NEGATIVE = `Thank you for your honest feedback. 🙏\n\nI am truly sorry that your experience did not meet your expectations. This is not the standard of care I strive to provide.\n\n👉 *What specifically made you feel this way, and how can I improve?*\n\nI take every piece of feedback very seriously and personally. I value your trust and truly hope to have the chance to make it right. 💙\n\n— Dr. Mina`;

const MSG_POSITIVE = `Wonderful! Thank you so much! 🌟\n\nI am so happy to hear that you had a great experience! 😊 It truly means the world to me.\n\nIf you have a moment, I would really appreciate it if you could share your kind review — it helps other parents find the best pediatric dentist for their little ones. 🦷\n\n👉 ${GOOGLE_REVIEW_LINK}\n\nIt only takes 1 minute and makes a huge difference. Thank you! 🙏\n\n— Dr. Mina`;

async function sendMessage(to, message) {
  const body = JSON.stringify({
    messaging_product: 'whatsapp',
    to: to,
    type: 'text',
    text: { body: message }
  });

  const options = {
    hostname: 'graph.facebook.com',
    path: `/v19.0/${PHONE_NUMBER_ID}/messages`,
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${WA_TOKEN}`,
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(body)
    }
  };

  return new Promise((resolve, reject) => {
    const req = https.request(options, res => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => resolve(data));
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

async function logToSheet(phone, rating, feedback, type) {
  try {
    const now = new Date().toLocaleString('en-GB', { timeZone: 'Asia/Dubai' });
    const payload = JSON.stringify({
      date: now,
      phone: '+' + phone,
      rating: rating,
      type: type,
      feedback: feedback || ''
    });

    const urlObj = new URL(SHEET_WEBHOOK);
    const options = {
      hostname: urlObj.hostname,
      path: urlObj.pathname + urlObj.search,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(payload)
      }
    };

    return new Promise((resolve) => {
      const req = https.request(options, res => {
        let data = '';
        res.on('data', chunk => data += chunk);
        res.on('end', () => {
          console.log(`Sheet logged: ${type} | +${phone} | Rating: ${rating}`);
          resolve(data);
        });
      });
      req.on('error', (e) => {
        console.error('Sheet error:', e.message);
        resolve();
      });
      req.write(payload);
      req.end();
    });
  } catch(e) {
    console.error('Sheet log error:', e.message);
  }
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);

  if (req.method === 'GET' && url.pathname === '/privacy.html') {
    const filePath = path.join(__dirname, 'privacy.html');
    if (fs.existsSync(filePath)) {
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end(fs.readFileSync(filePath));
    } else {
      res.writeHead(404);
      res.end('Not found');
    }
    return;
  }

  if (req.method === 'GET') {
    const mode = url.searchParams.get('hub.mode');
    const token = url.searchParams.get('hub.verify_token');
    const challenge = url.searchParams.get('hub.challenge');
    if (mode === 'subscribe' && token === VERIFY_TOKEN) {
      res.writeHead(200);
      res.end(challenge);
    } else {
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end('<h1>Dr Mina Review Bot is running!</h1>');
    }
    return;
  }

  if (req.method === 'POST') {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', async () => {
      try {
        const data = JSON.parse(body);
        const entry = data.entry?.[0];
        const changes = entry?.changes?.[0];
        const message = changes?.value?.messages?.[0];

        if (message && message.type === 'text') {
          const from = message.from;
          const text = message.text.body.trim();
          const rating = parseInt(text);

          console.log(`Message from ${from}: ${text}`);

          if (awaitingComplaint[from]) {
            // Forward to Dr. Mina
            const forwardMsg = `🔔 *Patient Feedback Alert*\n\nFrom: +${from}\nRating: ⭐ ${awaitingComplaint[from]}/5\n\nTheir feedback:\n"${text}"\n\n— Dr. Mina Review Bot`;
            await sendMessage(DR_MINA_PERSONAL, forwardMsg);
            // Log to Google Sheet
            await logToSheet(from, awaitingComplaint[from], text, 'NEGATIVE');
            // Thank the patient
            await sendMessage(from, `Thank you for sharing this with me. I truly appreciate your honesty and will personally work on improving this. I hope to see you again soon. 💙\n\n— Dr. Mina`);
            delete awaitingComplaint[from];

          } else if (!isNaN(rating) && rating >= 1 && rating <= 5) {
            if (rating <= 3) {
              await sendMessage(from, MSG_NEGATIVE);
              awaitingComplaint[from] = rating;
              await logToSheet(from, rating, 'Awaiting feedback...', 'NEGATIVE');
            } else {
              await sendMessage(from, MSG_POSITIVE);
              await logToSheet(from, rating, '', 'POSITIVE');
            }
          }
        }
      } catch (e) {
        console.error('Error:', e);
      }
      res.writeHead(200);
      res.end('OK');
    });
    return;
  }

  res.writeHead(200);
  res.end('OK');
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Dr Mina Review Bot running on port ${PORT}`);
});
