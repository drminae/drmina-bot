const http = require('http');
const fs = require('fs');
const path = require('path');
const https = require('https');

/* =========================================================
   SETTINGS
========================================================= */

const VERIFY_TOKEN = 'drmina2024';

// The actual EA... token and phone-number ID remain in:
// Render → Environment Variables
const WA_TOKEN = process.env.WA_TOKEN;
const PHONE_NUMBER_ID = process.env.PHONE_NUMBER_ID;

// You can change the API version later from Render if required.
const WA_API_VERSION = process.env.WA_API_VERSION || 'v25.0';

const GOOGLE_REVIEW_LINK =
  'https://g.page/r/CUs38k2cmQ1UEBM/review';

// Dr Mina’s personal WhatsApp number
const DR_MINA_PERSONAL = '971551008368';

// Google Sheets Apps Script webhook
const SHEET_WEBHOOK =
  'https://script.google.com/macros/s/AKfycbymMR_sc62FrCdyXkD5j7q9tNCKqH-ot7ElKR0RWFTUwcWMU7032-WxHEygEaLAYIs/exec';

const COMPLAINTS_FILE = path.join(__dirname, 'complaints.json');

/* =========================================================
   PATIENT MESSAGES
========================================================= */

const MSG_NEGATIVE =
  `Thank you for your honest feedback. 🙏\n\n` +
  `I am truly sorry that your experience did not meet your expectations. ` +
  `This is not the standard of care I strive to provide.\n\n` +
  `👉 *What specifically made you feel this way, and how can I improve?*\n\n` +
  `I take every piece of feedback very seriously and personally. ` +
  `I value your trust and truly hope to have the chance to make it right. 💙\n\n` +
  `— Dr. Mina`;

const MSG_POSITIVE =
  `Wonderful! Thank you so much! 🌟\n\n` +
  `I am so happy to hear that you had a great experience! 😊 ` +
  `It truly means the world to me.\n\n` +
  `If you have a moment, I would really appreciate it if you could share your kind review — ` +
  `it helps other parents find the best pediatric dentist for their little ones. 🦷\n\n` +
  `👉 ${GOOGLE_REVIEW_LINK}\n\n` +
  `It only takes 1 minute and makes a huge difference. Thank you! 🙏\n\n` +
  `— Dr. Mina`;

const MSG_FEEDBACK_THANK_YOU =
  `Thank you for sharing this with me. 🙏\n\n` +
  `I truly appreciate your honesty and will personally work on improving this. ` +
  `I hope to have the opportunity to provide you with a better experience in the future. 💙\n\n` +
  `— Dr. Mina`;

/* =========================================================
   HELPER FUNCTIONS
========================================================= */

function getDubaiTime() {
  return new Date().toLocaleString('en-GB', {
    timeZone: 'Asia/Dubai'
  });
}

function loadComplaints() {
  try {
    if (fs.existsSync(COMPLAINTS_FILE)) {
      const content = fs.readFileSync(COMPLAINTS_FILE, 'utf8');
      return JSON.parse(content);
    }
  } catch (error) {
    console.error('Could not load pending feedback:', error.message);
  }

  return {};
}

function saveComplaints(data) {
  try {
    fs.writeFileSync(
      COMPLAINTS_FILE,
      JSON.stringify(data, null, 2),
      'utf8'
    );
  } catch (error) {
    console.error('Could not save pending feedback:', error.message);
  }
}

let awaitingComplaint = loadComplaints();

/* =========================================================
   SEND WHATSAPP MESSAGE
========================================================= */

async function sendMessage(to, message) {
  if (!WA_TOKEN) {
    throw new Error(
      'WA_TOKEN is missing from Render Environment Variables.'
    );
  }

  if (!PHONE_NUMBER_ID) {
    throw new Error(
      'PHONE_NUMBER_ID is missing from Render Environment Variables.'
    );
  }

  const body = JSON.stringify({
    messaging_product: 'whatsapp',
    recipient_type: 'individual',
    to,
    type: 'text',
    text: {
      preview_url: true,
      body: message
    }
  });

  const options = {
    hostname: 'graph.facebook.com',
    path: `/${WA_API_VERSION}/${PHONE_NUMBER_ID}/messages`,
    method: 'POST',
    headers: {
      Authorization: `Bearer ${WA_TOKEN}`,
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(body)
    }
  };

  return new Promise((resolve, reject) => {
    const request = https.request(options, response => {
      let responseData = '';

      response.on('data', chunk => {
        responseData += chunk;
      });

      response.on('end', () => {
        console.log('WhatsApp status:', response.statusCode);
        console.log('WhatsApp response:', responseData);

        if (
          response.statusCode >= 200 &&
          response.statusCode < 300
        ) {
          resolve(responseData);
        } else {
          reject(
            new Error(
              `WhatsApp rejected the message: ${responseData}`
            )
          );
        }
      });
    });

    request.on('error', reject);
    request.write(body);
    request.end();
  });
}

/* =========================================================
   SEND COPY TO DR MINA
========================================================= */

async function forwardIncomingMessage(patientNumber, patientMessage) {
  // Prevent copies being sent back when Dr Mina messages the number.
  if (patientNumber === DR_MINA_PERSONAL) {
    return;
  }

  const notification =
    `📥 *Patient Message Received*\n\n` +
    `📅 ${getDubaiTime()}\n\n` +
    `👤 Patient\n` +
    `+${patientNumber}\n\n` +
    `💬 Message\n` +
    `"${patientMessage}"`;

  await sendMessage(DR_MINA_PERSONAL, notification);

  console.log(
    `Patient message copied from ${patientNumber} to Dr Mina`
  );
}

async function sendPatientReplyWithCopy(
  patientNumber,
  replyMessage,
  actionDescription
) {
  // Send the actual reply to the patient.
  await sendMessage(patientNumber, replyMessage);

  // Avoid sending a duplicate copy back to Dr Mina
  // when she is personally testing from her own number.
  if (patientNumber === DR_MINA_PERSONAL) {
    return;
  }

  const notification =
    `📤 *Reply Sent to Patient*\n\n` +
    `📅 ${getDubaiTime()}\n\n` +
    `👤 Patient\n` +
    `+${patientNumber}\n\n` +
    `✅ Action\n` +
    `${actionDescription}\n\n` +
    `💬 Reply sent\n` +
    `${replyMessage}`;

  await sendMessage(DR_MINA_PERSONAL, notification);

  console.log(
    `Outgoing reply copied for patient ${patientNumber}`
  );
}

/* =========================================================
   GOOGLE SHEETS
========================================================= */

async function logToSheet(phone, rating, feedback, type) {
  try {
    const payload = JSON.stringify({
      date: getDubaiTime(),
      phone: `+${phone}`,
      rating,
      type,
      feedback: feedback || ''
    });

    const urlObject = new URL(SHEET_WEBHOOK);

    const options = {
      hostname: urlObject.hostname,
      path: urlObject.pathname + urlObject.search,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(payload)
      }
    };

    return new Promise(resolve => {
      const request = https.request(options, response => {
        let responseData = '';

        response.on('data', chunk => {
          responseData += chunk;
        });

        response.on('end', () => {
          console.log(
            `Google Sheet updated: ${type} | +${phone} | Rating: ${rating}`
          );

          resolve(responseData);
        });
      });

      request.on('error', error => {
        console.error(
          'Google Sheets connection error:',
          error.message
        );

        resolve();
      });

      request.write(payload);
      request.end();
    });
  } catch (error) {
    console.error(
      'Google Sheets logging error:',
      error.message
    );
  }
}

/* =========================================================
   WEB SERVER
========================================================= */

const server = http.createServer(async (request, response) => {
  const url = new URL(
    request.url,
    `http://${request.headers.host}`
  );

  /* Privacy policy */

  if (
    request.method === 'GET' &&
    url.pathname === '/privacy.html'
  ) {
    const filePath = path.join(__dirname, 'privacy.html');

    if (fs.existsSync(filePath)) {
      response.writeHead(200, {
        'Content-Type': 'text/html'
      });

      response.end(fs.readFileSync(filePath));
    } else {
      response.writeHead(404);
      response.end('Not found');
    }

    return;
  }

  /* Meta webhook verification */

  if (request.method === 'GET') {
    const mode = url.searchParams.get('hub.mode');
    const token = url.searchParams.get('hub.verify_token');
    const challenge = url.searchParams.get('hub.challenge');

    if (
      mode === 'subscribe' &&
      token === VERIFY_TOKEN
    ) {
      console.log('Webhook verified successfully.');

      response.writeHead(200);
      response.end(challenge);
    } else {
      response.writeHead(200, {
        'Content-Type': 'text/html'
      });

      response.end(
        '<h1>Dr Mina Review Assistant is running!</h1>'
      );
    }

    return;
  }

  /* Receive WhatsApp messages */

  if (request.method === 'POST') {
    let body = '';

    request.on('data', chunk => {
      body += chunk;
    });

    request.on('end', async () => {
      try {
        const data = JSON.parse(body);

        const message =
          data.entry?.[0]
            ?.changes?.[0]
            ?.value?.messages?.[0];

        // Delivery and read receipts do not contain a message.
        if (message && message.type === 'text') {
          const from = message.from;
          const text = message.text.body.trim();
          const rating = Number(text);

          console.log(`Message from ${from}: ${text}`);

          // Send Dr Mina a copy of every patient message.
          await forwardIncomingMessage(from, text);

          awaitingComplaint = loadComplaints();

          /* Patient is sending written feedback after rating 1–3 */

          if (awaitingComplaint[from]) {
            const originalRating = awaitingComplaint[from];

            await logToSheet(
              from,
              originalRating,
              text,
              'NEGATIVE FEEDBACK'
            );

            await sendPatientReplyWithCopy(
              from,
              MSG_FEEDBACK_THANK_YOU,
              `Written feedback received following a rating of ${originalRating}/5. Final acknowledgement sent.`
            );

            delete awaitingComplaint[from];
            saveComplaints(awaitingComplaint);

            console.log(
              `Feedback process completed for ${from}`
            );
          }

          /* Patient has sent a rating from 1 to 5 */

          else if (
            Number.isInteger(rating) &&
            rating >= 1 &&
            rating <= 5
          ) {
            /* Rating 1–3 */

            if (rating <= 3) {
              await sendPatientReplyWithCopy(
                from,
                MSG_NEGATIVE,
                `Negative rating received: ${rating}/5. The patient was asked to explain the experience.`
              );

              awaitingComplaint[from] = rating;
              saveComplaints(awaitingComplaint);

              await logToSheet(
                from,
                rating,
                'Awaiting written feedback...',
                'NEGATIVE'
              );

              console.log(
                `Rating ${rating}/5 received from ${from}; awaiting written feedback`
              );
            }

            /* Rating 4–5 */

            else {
              await sendPatientReplyWithCopy(
                from,
                MSG_POSITIVE,
                `Positive rating received: ${rating}/5. The Google review link was sent.`
              );

              await logToSheet(
                from,
                rating,
                '',
                'POSITIVE'
              );

              console.log(
                `Positive rating ${rating}/5 received from ${from}`
              );
            }
          }

          /* Any message other than a rating */

          else {
            console.log(
              `General message received and copied from ${from}`
            );
          }
        }
      } catch (error) {
        console.error(
          'Message-processing error:',
          error.message
        );
      }

      // Meta expects a quick successful response.
      response.writeHead(200);
      response.end('OK');
    });

    return;
  }

  response.writeHead(200);
  response.end('OK');
});

/* =========================================================
   START SERVER
========================================================= */

const PORT = process.env.PORT || 3000;

server.listen(PORT, () => {
  console.log(
    `Dr Mina Review Assistant running on port ${PORT}`
  );
});
