const http = require('http');
const fs = require('fs');
const path = require('path');
const https = require('https');

const VERIFY_TOKEN = 'drmina2024';

// Keep the real token and phone ID only in Render Environment Variables
const WA_TOKEN = process.env.WA_TOKEN;
const PHONE_NUMBER_ID = process.env.PHONE_NUMBER_ID;

const GOOGLE_REVIEW_LINK =
  'https://g.page/r/CUs38k2cmQ1UEBM/review';

const DR_MINA_PERSONAL = '971551008368';

const SHEET_WEBHOOK =
  'https://script.google.com/macros/s/AKfycbymMR_sc62FrCdyXkD5j7q9tNCKqH-ot7ElKR0RWFTUwcWMU7032-WxHEygEaLAYIs/exec';

const COMPLAINTS_FILE = path.join(__dirname, 'complaints.json');

function getDubaiTime() {
  return new Date().toLocaleString('en-GB', {
    timeZone: 'Asia/Dubai'
  });
}

function loadComplaints() {
  try {
    if (fs.existsSync(COMPLAINTS_FILE)) {
      return JSON.parse(
        fs.readFileSync(COMPLAINTS_FILE, 'utf8')
      );
    }
  } catch (error) {
    console.error(
      'Could not load complaints:',
      error.message
    );
  }

  return {};
}

function saveComplaints(data) {
  try {
    fs.writeFileSync(
      COMPLAINTS_FILE,
      JSON.stringify(data, null, 2)
    );
  } catch (error) {
    console.error(
      'Could not save complaints:',
      error.message
    );
  }
}

let awaitingComplaint = loadComplaints();

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

const MSG_COMPLAINT_THANK_YOU =
  `Thank you for sharing this with me. ` +
  `I truly appreciate your honesty and will personally work on improving this. ` +
  `I hope to see you again soon. 💙\n\n` +
  `— Dr. Mina`;

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
    path: `/v19.0/${PHONE_NUMBER_ID}/messages`,
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

      response.on(
        'data',
        chunk => (responseData += chunk)
      );

      response.on('end', () => {
        console.log(
          'WhatsApp Status Code:',
          response.statusCode
        );

        console.log(
          'WhatsApp Response:',
          responseData
        );

        if (
          response.statusCode >= 200 &&
          response.statusCode < 300
        ) {
          resolve(responseData);
        } else {
          reject(
            new Error(
              `WhatsApp API rejected the message: ${responseData}`
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

async function forwardPatientMessage(
  patientNumber,
  patientMessage
) {
  // Prevent a loop when Dr. Mina messages the bot directly
  if (patientNumber === DR_MINA_PERSONAL) {
    return;
  }

  const notification =
    `📥 *New Patient Message*\n\n` +
    `Date: ${getDubaiTime()}\n` +
    `Patient: +${patientNumber}\n\n` +
    `Patient wrote:\n` +
    `"${patientMessage}"\n\n` +
    `— Dr. Mina Bot`;

  await sendMessage(
    DR_MINA_PERSONAL,
    notification
  );

  console.log(
    `Forwarded patient message from ${patientNumber}`
  );
}

async function sendBotReplyAndCopy(
  patientNumber,
  replyMessage,
  description
) {
  // Send the real reply to the patient
  await sendMessage(
    patientNumber,
    replyMessage
  );

  // Do not forward a message back to the same personal number
  if (patientNumber === DR_MINA_PERSONAL) {
    return;
  }

  const copy =
    `🤖 *Automatic Bot Reply*\n\n` +
    `Date: ${getDubaiTime()}\n` +
    `Patient: +${patientNumber}\n` +
    `Action: ${description}\n\n` +
    `Bot sent:\n` +
    `${replyMessage}\n\n` +
    `— Dr. Mina Bot`;

  await sendMessage(
    DR_MINA_PERSONAL,
    copy
  );

  console.log(
    `Forwarded bot reply for ${patientNumber}`
  );
}

async function logToSheet(
  phone,
  rating,
  feedback,
  type
) {
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
      path:
        urlObject.pathname +
        urlObject.search,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length':
          Buffer.byteLength(payload)
      }
    };

    return new Promise(resolve => {
      const request = https.request(
        options,
        response => {
          let responseData = '';

          response.on(
            'data',
            chunk =>
              (responseData += chunk)
          );

          response.on('end', () => {
            console.log(
              `Sheet logged: ${type} | +${phone} | Rating: ${rating}`
            );

            resolve(responseData);
          });
        }
      );

      request.on('error', error => {
        console.error(
          'Google Sheet error:',
          error.message
        );

        resolve();
      });

      request.write(payload);
      request.end();
    });
  } catch (error) {
    console.error(
      'Google Sheet logging error:',
      error.message
    );
  }
}

const server = http.createServer(
  async (request, response) => {
    const url = new URL(
      request.url,
      `http://${request.headers.host}`
    );

    // Privacy-policy page
    if (
      request.method === 'GET' &&
      url.pathname === '/privacy.html'
    ) {
      const filePath = path.join(
        __dirname,
        'privacy.html'
      );

      if (fs.existsSync(filePath)) {
        response.writeHead(200, {
          'Content-Type': 'text/html'
        });

        response.end(
          fs.readFileSync(filePath)
        );
      } else {
        response.writeHead(404);
        response.end('Not found');
      }

      return;
    }

    // Meta webhook verification
    if (request.method === 'GET') {
      const mode =
        url.searchParams.get('hub.mode');

      const token =
        url.searchParams.get(
          'hub.verify_token'
        );

      const challenge =
        url.searchParams.get(
          'hub.challenge'
        );

      if (
        mode === 'subscribe' &&
        token === VERIFY_TOKEN
      ) {
        console.log(
          'Webhook verified successfully.'
        );

        response.writeHead(200);
        response.end(challenge);
      } else {
        response.writeHead(200, {
          'Content-Type': 'text/html'
        });

        response.end(
          '<h1>Dr Mina Review Bot is running!</h1>'
        );
      }

      return;
    }

    // Receive incoming WhatsApp webhook events
    if (request.method === 'POST') {
      let body = '';

      request.on(
        'data',
        chunk => (body += chunk)
      );

      request.on('end', async () => {
        try {
          const data = JSON.parse(body);

          const message =
            data.entry?.[0]
              ?.changes?.[0]
              ?.value?.messages?.[0];

          // Ignore delivery/read status notifications
          if (
            message &&
            message.type === 'text'
          ) {
            const from = message.from;

            const text =
              message.text.body.trim();

            const rating =
              Number(text);

            console.log(
              `Message from ${from}: ${text}`
            );

            // Forward every incoming patient message
            await forwardPatientMessage(
              from,
              text
            );

            awaitingComplaint =
              loadComplaints();

            // Patient is replying with complaint details
            if (awaitingComplaint[from]) {
              const originalRating =
                awaitingComplaint[from];

              await logToSheet(
                from,
                originalRating,
                text,
                'NEGATIVE FEEDBACK'
              );

              await sendBotReplyAndCopy(
                from,
                MSG_COMPLAINT_THANK_YOU,
                `Final response after written feedback for rating ${originalRating}/5`
              );

              delete awaitingComplaint[from];

              saveComplaints(
                awaitingComplaint
              );

              console.log(
                `Completed complaint workflow for ${from}`
              );
            }

            // Rating from 1 to 5
            else if (
              Number.isInteger(rating) &&
              rating >= 1 &&
              rating <= 5
            ) {
              // Negative rating
              if (rating <= 3) {
                await sendBotReplyAndCopy(
                  from,
                  MSG_NEGATIVE,
                  `Negative rating received: ${rating}/5`
                );

                awaitingComplaint[from] =
                  rating;

                saveComplaints(
                  awaitingComplaint
                );

                await logToSheet(
                  from,
                  rating,
                  'Awaiting written feedback...',
                  'NEGATIVE'
                );

                console.log(
                  `Negative rating ${rating} from ${from}; awaiting explanation`
                );
              }

              // Positive rating
              else {
                await sendBotReplyAndCopy(
                  from,
                  MSG_POSITIVE,
                  `Positive rating received: ${rating}/5. Google review link sent.`
                );

                await logToSheet(
                  from,
                  rating,
                  '',
                  'POSITIVE'
                );

                console.log(
                  `Positive rating ${rating} from ${from}`
                );
              }
            }

            // Any message that is not a rating
            else {
              console.log(
                `General patient message forwarded from ${from}`
              );
            }
          }
        } catch (error) {
          console.error(
            'Webhook processing error:',
            error.message
          );
        }

        // Always acknowledge Meta webhook quickly
        response.writeHead(200);
        response.end('OK');
      });

      return;
    }

    response.writeHead(200);
    response.end('OK');
  }
);

const PORT =
  process.env.PORT || 3000;

server.listen(PORT, () => {
  console.log(
    `Dr Mina Review Bot running on port ${PORT}`
  );
});
