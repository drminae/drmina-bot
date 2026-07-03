const http = require('http');

const VERIFY_TOKEN = 'drmina2024';
const WA_TOKEN = 'EAAVX8PjEKMoBR6zgFoPt8AZCMesSqXlwkVfN4EDUbywGDhhfEI0HWa3pgHEeuBYXRhjQHEUfyN9FMziZCdFB55U1ubuAaRxlnxZCPABCZCMlv5vnqKyTvrTXyej7l0IDPGZAtUrUZBTi7maf2va7poZAoSdttSCzW8ZBTuz6im57oVOSLiSoyX6tDvT07zMYGtBl3o7HELNkQ1VwX3ChrZB93Deatv8nmq48smN2nHTrb2wYrbzClZCO2N2o8dJMIlv8im6SMGb7PLKwj0RdE4YAZDZD';
const PHONE_NUMBER_ID = '1218801781318747';
const GOOGLE_REVIEW_LINK = 'https://g.page/r/CUs38k2cmQ1UEBM/review';

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
    const req = http.request({ ...options, hostname: 'graph.facebook.com' }, res => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => resolve(data));
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);

  // META WEBHOOK VERIFICATION
  if (req.method === 'GET') {
    const mode = url.searchParams.get('hub.mode');
    const token = url.searchParams.get('hub.verify_token');
    const challenge = url.searchParams.get('hub.challenge');

    if (mode === 'subscribe' && token === VERIFY_TOKEN) {
      console.log('Webhook verified!');
      res.writeHead(200);
      res.end(challenge);
    } else {
      res.writeHead(403);
      res.end('Forbidden');
    }
    return;
  }

  // RECEIVE WHATSAPP MESSAGES
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

          if (!isNaN(rating) && rating >= 1 && rating <= 5) {
            if (rating <= 3) {
              await sendMessage(from, MSG_NEGATIVE);
              console.log(`Sent negative response to ${from}`);
            } else {
              await sendMessage(from, MSG_POSITIVE);
              console.log(`Sent positive response to ${from}`);
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
  res.end('Dr Mina Review Bot is running!');
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Dr Mina Review Bot running on port ${PORT}`);
});
