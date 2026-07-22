const http = require('http');
const fs = require('fs');
const path = require('path');
const https = require('https');
const crypto = require('crypto');
const { createClient } = require('@supabase/supabase-js');

/* =========================================================
   SETTINGS
========================================================= */

const VERIFY_TOKEN = 'drmina2024';

const WA_TOKEN = process.env.WA_TOKEN;
const PHONE_NUMBER_ID = process.env.PHONE_NUMBER_ID;
const WA_API_VERSION = process.env.WA_API_VERSION || 'v25.0';

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SECRET_KEY = process.env.SUPABASE_SECRET_KEY;

const INBOX_USERNAME = process.env.INBOX_USERNAME;
const INBOX_PASSWORD = process.env.INBOX_PASSWORD;
const SESSION_SECRET =
  process.env.SESSION_SECRET ||
  INBOX_PASSWORD ||
  'change-this-in-render';

const GOOGLE_REVIEW_LINK =
  'https://g.page/r/CUs38k2cmQ1UEBM/review';

const DR_MINA_PERSONAL = '971551008368';

const SHEET_WEBHOOK =
  'https://script.google.com/macros/s/AKfycbymMR_sc62FrCdyXkD5j7q9tNCKqH-ot7ElKR0RWFTUwcWMU7032-WxHEygEaLAYIs/exec';

const COMPLAINTS_FILE = path.join(__dirname, 'complaints.json');
const INBOX_FILE = path.join(__dirname, 'inbox.html');

const supabase =
  SUPABASE_URL && SUPABASE_SECRET_KEY
    ? createClient(SUPABASE_URL, SUPABASE_SECRET_KEY)
    : null;

/* =========================================================
   PATIENT MESSAGES
========================================================= */

const MSG_NEGATIVE =
  `Thank you for your honest feedback. \u{1F64F}\n\n` +
  `I am truly sorry that your experience did not meet your expectations. ` +
  `This is not the standard of care I strive to provide.\n\n` +
  `\u{1F449} *What specifically made you feel this way, and how can I improve?*\n\n` +
  `I take every piece of feedback very seriously and personally. ` +
  `I value your trust and truly hope to have the chance to make it right. \u{1F499}\n\n` +
  `\u2014 Dr. Mina`;

const MSG_POSITIVE =
  `Wonderful! Thank you so much! \u{1F31F}\n\n` +
  `I am so happy to hear that you had a great experience! \u{1F60A} ` +
  `It truly means the world to me.\n\n` +
  `If you have a moment, I would really appreciate it if you could share your kind review \u2014 ` +
  `it helps other parents find the best pediatric dentist for their little ones. \u{1F9B7}\n\n` +
  `\u{1F449} ${GOOGLE_REVIEW_LINK}\n\n` +
  `It only takes 1 minute and makes a huge difference. Thank you! \u{1F64F}\n\n` +
  `\u2014 Dr. Mina`;

const MSG_FEEDBACK_THANK_YOU =
  `Thank you for sharing this with me. \u{1F64F}\n\n` +
  `I truly appreciate your honesty and will personally work on improving this. ` +
  `I hope to have the opportunity to provide you with a better experience in the future. \u{1F499}\n\n` +
  `\u2014 Dr. Mina`;

/* =========================================================
   GENERAL HELPERS
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

function sendJson(response, statusCode, data) {
  response.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store'
  });
  response.end(JSON.stringify(data));
}

function readRequestBody(request) {
  return new Promise((resolve, reject) => {
    let body = '';

    request.on('data', chunk => {
      body += chunk;

      if (body.length > 1_000_000) {
        reject(new Error('Request body is too large.'));
        request.destroy();
      }
    });

    request.on('end', () => resolve(body));
    request.on('error', reject);
  });
}

function parseCookies(request) {
  const result = {};
  const rawCookie = request.headers.cookie || '';

  rawCookie.split(';').forEach(part => {
    const separator = part.indexOf('=');

    if (separator === -1) {
      return;
    }

    const key = part.slice(0, separator).trim();
    const value = part.slice(separator + 1).trim();

    if (key) {
      result[key] = decodeURIComponent(value);
    }
  });

  return result;
}

function safeEqual(valueA, valueB) {
  const bufferA = Buffer.from(String(valueA || ''));
  const bufferB = Buffer.from(String(valueB || ''));

  if (bufferA.length !== bufferB.length) {
    return false;
  }

  return crypto.timingSafeEqual(bufferA, bufferB);
}

function signSession(payload) {
  const encodedPayload = Buffer.from(
    JSON.stringify(payload),
    'utf8'
  ).toString('base64url');

  const signature = crypto
    .createHmac('sha256', SESSION_SECRET)
    .update(encodedPayload)
    .digest('base64url');

  return `${encodedPayload}.${signature}`;
}

function verifySession(token) {
  try {
    const [encodedPayload, signature] = String(token || '').split('.');

    if (!encodedPayload || !signature) {
      return null;
    }

    const expectedSignature = crypto
      .createHmac('sha256', SESSION_SECRET)
      .update(encodedPayload)
      .digest('base64url');

    if (!safeEqual(signature, expectedSignature)) {
      return null;
    }

    const payload = JSON.parse(
      Buffer.from(encodedPayload, 'base64url').toString('utf8')
    );

    if (!payload.exp || Date.now() > payload.exp) {
      return null;
    }

    return payload;
  } catch (error) {
    return null;
  }
}

function isAuthenticated(request) {
  const cookies = parseCookies(request);
  return Boolean(verifySession(cookies.drmina_session));
}

function requireAuthentication(request, response, apiRoute = false) {
  if (isAuthenticated(request)) {
    return true;
  }

  if (apiRoute) {
    sendJson(response, 401, {
      success: false,
      error: 'Please log in again.'
    });
  } else {
    response.writeHead(302, {
      Location: '/login'
    });
    response.end();
  }

  return false;
}

function normalizePhone(phone) {
  return String(phone || '').replace(/\D/g, '');
}

function escapeHtml(text) {
  return String(text || '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

let awaitingComplaint = loadComplaints();

/* =========================================================
   LOGIN PAGE
========================================================= */

function renderLoginPage(message = '') {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Dr Mina Inbox Login</title>
  <style>
    * { box-sizing: border-box; }
    body {
      margin: 0;
      min-height: 100vh;
      display: grid;
      place-items: center;
      padding: 24px;
      font-family: Arial, Helvetica, sans-serif;
      background:
        radial-gradient(circle at top left, #dff8f1, transparent 42%),
        linear-gradient(145deg, #f4fbf9, #edf4ff);
      color: #17324d;
    }
    .card {
      width: min(430px, 100%);
      background: rgba(255, 255, 255, 0.96);
      border: 1px solid #dce9e5;
      border-radius: 24px;
      padding: 34px;
      box-shadow: 0 24px 60px rgba(22, 61, 87, 0.14);
    }
    .logo {
      width: 64px;
      height: 64px;
      border-radius: 20px;
      display: grid;
      place-items: center;
      margin-bottom: 22px;
      font-size: 30px;
      background: #e5f8f2;
    }
    h1 { margin: 0 0 8px; font-size: 28px; }
    p { margin: 0 0 26px; color: #607287; line-height: 1.5; }
    label {
      display: block;
      margin: 15px 0 7px;
      font-size: 14px;
      font-weight: 700;
    }
    input {
      width: 100%;
      padding: 14px 15px;
      border: 1px solid #cddbd7;
      border-radius: 13px;
      font-size: 16px;
      outline: none;
    }
    input:focus {
      border-color: #1f9d7a;
      box-shadow: 0 0 0 4px rgba(31, 157, 122, 0.12);
    }
    button {
      width: 100%;
      margin-top: 22px;
      padding: 14px 18px;
      border: 0;
      border-radius: 13px;
      background: #178a6a;
      color: #fff;
      font-weight: 800;
      font-size: 16px;
      cursor: pointer;
    }
    button:hover { background: #117457; }
    .error {
      padding: 11px 13px;
      border-radius: 11px;
      margin-bottom: 14px;
      color: #9d2631;
      background: #fff0f1;
      border: 1px solid #ffd3d7;
      font-size: 14px;
    }
    .footer {
      margin-top: 18px;
      font-size: 12px;
      text-align: center;
      color: #8291a1;
    }
  </style>
</head>
<body>
  <form class="card" method="POST" action="/login">
    <div class="logo">\u{1F9B7}</div>
    <h1>Dr Mina Inbox</h1>
    <p>Secure access to your WhatsApp patient conversations.</p>
    ${message ? `<div class="error">${escapeHtml(message)}</div>` : ''}
    <label for="username">Username</label>
    <input id="username" name="username" autocomplete="username" required autofocus>
    <label for="password">Password</label>
    <input id="password" name="password" type="password" autocomplete="current-password" required>
    <button type="submit">Log in</button>
    <div class="footer">Private clinic system</div>
  </form>
</body>
</html>`;
}

/* =========================================================
   SUPABASE DATABASE
========================================================= */

async function saveMessageToSupabase({
  phone,
  direction,
  message,
  rating = null,
  status = null,
  googleReviewSent = false,
  complaint = null,
  replied = false,
  replyMessage = null,
  whatsappMessageId = null,
  isRead = direction === 'outgoing'
}) {
  if (!supabase) {
    console.error(
      'Supabase is not connected. Check SUPABASE_URL and SUPABASE_SECRET_KEY.'
    );
    return;
  }

  try {
    const cleanPhone = normalizePhone(phone);

    // Carry the saved patient name forward to every new message so it remains
    // available even when older messages eventually fall outside the inbox limit.
    let patientName = null;
    const { data: existingNames, error: nameLookupError } = await supabase
      .from('messages')
      .select('patient_name')
      .eq('phone', `+${cleanPhone}`)
      .not('patient_name', 'is', null)
      .neq('patient_name', '')
      .order('created_timestamp', { ascending: false })
      .limit(1);

    if (nameLookupError) {
      console.error('Patient name lookup error:', nameLookupError.message);
    } else {
      patientName = existingNames?.[0]?.patient_name || null;
    }

    const { error } = await supabase
      .from('messages')
      .insert({
        phone: `+${cleanPhone}`,
        patient_name: patientName,
        direction,
        message,
        rating,
        status,
        google_review_sent: googleReviewSent,
        complaint,
        replied,
        reply_message: replyMessage,
        whatsapp_message_id: whatsappMessageId,
        is_read: isRead,
        created_timestamp: new Date().toISOString()
      });

    if (error) {
      console.error('Supabase save error:', error.message);
      return;
    }

    console.log(
      `Supabase saved: ${direction} | +${cleanPhone} | ${status || 'message'}`
    );
  } catch (error) {
    console.error('Supabase connection error:', error.message);
  }
}

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

  const cleanPhone = normalizePhone(to);

  if (!cleanPhone) {
    throw new Error('The WhatsApp phone number is invalid.');
  }

  const body = JSON.stringify({
    messaging_product: 'whatsapp',
    recipient_type: 'individual',
    to: cleanPhone,
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
    const outgoingRequest = https.request(options, apiResponse => {
      let responseData = '';

      apiResponse.on('data', chunk => {
        responseData += chunk;
      });

      apiResponse.on('end', () => {
        console.log('WhatsApp status:', apiResponse.statusCode);
        console.log('WhatsApp response:', responseData);

        if (
          apiResponse.statusCode >= 200 &&
          apiResponse.statusCode < 300
        ) {
          let whatsappMessageId = null;

          try {
            const parsed = JSON.parse(responseData);
            whatsappMessageId = parsed.messages?.[0]?.id || null;
          } catch (error) {
            console.error(
              'Could not read WhatsApp message ID:',
              error.message
            );
          }

          resolve({
            responseData,
            whatsappMessageId
          });
        } else {
          reject(
            new Error(
              `WhatsApp rejected the message: ${responseData}`
            )
          );
        }
      });
    });

    outgoingRequest.on('error', reject);
    outgoingRequest.write(body);
    outgoingRequest.end();
  });
}

/* =========================================================
   SEND COPY TO DR MINA
========================================================= */

async function forwardIncomingMessage(patientNumber, patientMessage) {
  if (patientNumber === DR_MINA_PERSONAL) {
    return;
  }

  const notification =
    `\u{1F4E5} *Patient Message Received*\n\n` +
    `\u{1F4C5} ${getDubaiTime()}\n\n` +
    `\u{1F464} Patient\n` +
    `+${patientNumber}\n\n` +
    `\u{1F4AC} Message\n` +
    `"${patientMessage}"`;

  await sendMessage(DR_MINA_PERSONAL, notification);

  console.log(
    `Patient message copied from ${patientNumber} to Dr Mina`
  );
}

async function sendPatientReplyWithCopy(
  patientNumber,
  replyMessage,
  actionDescription,
  databaseOptions = {}
) {
  const result = await sendMessage(patientNumber, replyMessage);

  await saveMessageToSupabase({
    phone: patientNumber,
    direction: 'outgoing',
    message: replyMessage,
    rating: databaseOptions.rating ?? null,
    status: databaseOptions.status || 'sent',
    googleReviewSent:
      databaseOptions.googleReviewSent || false,
    complaint: databaseOptions.complaint || null,
    replied: true,
    replyMessage,
    whatsappMessageId: result.whatsappMessageId
  });

  if (patientNumber === DR_MINA_PERSONAL) {
    return result;
  }

  const notification =
    `\u{1F4E4} *Reply Sent to Patient*\n\n` +
    `\u{1F4C5} ${getDubaiTime()}\n\n` +
    `\u{1F464} Patient\n` +
    `+${patientNumber}\n\n` +
    `\u2705 Action\n` +
    `${actionDescription}\n\n` +
    `\u{1F4AC} Reply sent\n` +
    `${replyMessage}`;

  await sendMessage(DR_MINA_PERSONAL, notification);

  console.log(
    `Outgoing reply copied for patient ${patientNumber}`
  );

  return result;
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
      const sheetRequest = https.request(options, sheetResponse => {
        let responseData = '';

        sheetResponse.on('data', chunk => {
          responseData += chunk;
        });

        sheetResponse.on('end', () => {
          console.log(
            `Google Sheet updated: ${type} | +${phone} | Rating: ${rating}`
          );

          resolve(responseData);
        });
      });

      sheetRequest.on('error', error => {
        console.error(
          'Google Sheets connection error:',
          error.message
        );

        resolve();
      });

      sheetRequest.write(payload);
      sheetRequest.end();
    });
  } catch (error) {
    console.error(
      'Google Sheets logging error:',
      error.message
    );
  }
}

/* =========================================================
   INBOX API
========================================================= */

async function getInboxMessages(response, url) {
  if (!supabase) {
    sendJson(response, 503, {
      success: false,
      error: 'Supabase is not connected.'
    });
    return;
  }

  const phone = normalizePhone(url.searchParams.get('phone'));
  const limitRequested = Number(url.searchParams.get('limit') || 1000);
  const limit = Math.min(Math.max(limitRequested, 1), 2000);

  let query = supabase
    .from('messages')
    .select(
      'phone,patient_name,direction,message,rating,status,google_review_sent,complaint,replied,reply_message,whatsapp_message_id,is_read,created_timestamp'
    )
    .order('created_timestamp', { ascending: true })
    .limit(limit);

  if (phone) {
    query = query.eq('phone', `+${phone}`);
  }

  const { data, error } = await query;

  if (error) {
    console.error('Inbox fetch error:', error.message);
    sendJson(response, 500, {
      success: false,
      error: error.message
    });
    return;
  }

  sendJson(response, 200, {
    success: true,
    messages: data || []
  });
}

async function handleInboxReply(request, response) {
  try {
    const rawBody = await readRequestBody(request);
    const data = JSON.parse(rawBody || '{}');

    const phone = normalizePhone(data.phone);
    const message = String(data.message || '').trim();

    if (!phone) {
      sendJson(response, 400, {
        success: false,
        error: 'Please select a patient first.'
      });
      return;
    }

    if (!message) {
      sendJson(response, 400, {
        success: false,
        error: 'The reply cannot be empty.'
      });
      return;
    }

    if (message.length > 4096) {
      sendJson(response, 400, {
        success: false,
        error: 'The reply is too long.'
      });
      return;
    }

    const result = await sendPatientReplyWithCopy(
      phone,
      message,
      'Manual reply sent from Dr Mina Inbox.',
      {
        status: 'manual_inbox_reply'
      }
    );

    sendJson(response, 200, {
      success: true,
      whatsappMessageId: result?.whatsappMessageId || null
    });
  } catch (error) {
    console.error('Inbox reply error:', error.message);

    sendJson(response, 500, {
      success: false,
      error: error.message
    });
  }
}

/* =========================================================
   PATIENT NAME
========================================================= */

async function updatePatientName(request, response) {
  try {
    if (!supabase) {
      sendJson(response, 503, {
        success: false,
        error: 'Supabase is not connected.'
      });
      return;
    }

    const rawBody = await readRequestBody(request);
    const data = JSON.parse(rawBody || '{}');
    const phone = normalizePhone(data.phone);
    const patientName = String(data.patientName || '').trim();

    if (!phone) {
      sendJson(response, 400, {
        success: false,
        error: 'Invalid phone number.'
      });
      return;
    }

    if (!patientName) {
      sendJson(response, 400, {
        success: false,
        error: 'Please enter the patient name.'
      });
      return;
    }

    if (patientName.length > 100) {
      sendJson(response, 400, {
        success: false,
        error: 'The patient name must be 100 characters or fewer.'
      });
      return;
    }

    const { data: updatedRows, error } = await supabase
      .from('messages')
      .update({ patient_name: patientName })
      .eq('phone', `+${phone}`)
      .select('phone');

    if (error) throw error;

    if (!updatedRows?.length) {
      sendJson(response, 404, {
        success: false,
        error: 'No conversation was found for this phone number.'
      });
      return;
    }

    sendJson(response, 200, {
      success: true,
      patientName,
      updatedMessages: updatedRows.length
    });
  } catch (error) {
    console.error('Patient name update error:', error.message);
    sendJson(response, 500, {
      success: false,
      error: error.message
    });
  }
}

/* =========================================================
   READ / UNREAD AND DELIVERY STATUS
========================================================= */

async function markConversationRead(request, response) {
  try {
    const rawBody = await readRequestBody(request);
    const data = JSON.parse(rawBody || '{}');
    const phone = normalizePhone(data.phone);
    const isRead = data.isRead !== false;

    if (!phone) {
      sendJson(response, 400, { success: false, error: 'Invalid phone number.' });
      return;
    }

    let query = supabase
      .from('messages')
      .update({ is_read: isRead })
      .eq('phone', `+${phone}`)
      .eq('direction', 'incoming');

    if (!isRead) {
      const { data: latest, error: latestError } = await supabase
        .from('messages')
        .select('whatsapp_message_id,created_timestamp')
        .eq('phone', `+${phone}`)
        .eq('direction', 'incoming')
        .order('created_timestamp', { ascending: false })
        .limit(1);

      if (latestError) throw latestError;
      const latestMessage = latest?.[0];
      if (!latestMessage) {
        sendJson(response, 200, { success: true });
        return;
      }

      query = supabase
        .from('messages')
        .update({ is_read: false })
        .eq('phone', `+${phone}`)
        .eq('direction', 'incoming')
        .eq('created_timestamp', latestMessage.created_timestamp);
    }

    const { error } = await query;
    if (error) throw error;
    sendJson(response, 200, { success: true });
  } catch (error) {
    console.error('Read/unread update error:', error.message);
    sendJson(response, 500, { success: false, error: error.message });
  }
}

async function updateWhatsAppStatuses(statuses) {
  if (!supabase || !Array.isArray(statuses)) return;

  for (const item of statuses) {
    const id = item?.id;
    const status = item?.status;
    if (!id || !status) continue;

    const { error } = await supabase
      .from('messages')
      .update({ status })
      .eq('whatsapp_message_id', id);

    if (error) {
      console.error('WhatsApp status update error:', error.message);
    } else {
      console.log(`WhatsApp message ${id} updated to ${status}`);
    }
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

  /* Health check */

  if (request.method === 'GET' && url.pathname === '/health') {
    sendJson(response, 200, {
      success: true,
      service: 'Dr Mina Review Assistant'
    });
    return;
  }

  /* Login page */

  if (request.method === 'GET' && url.pathname === '/login') {
    if (isAuthenticated(request)) {
      response.writeHead(302, { Location: '/inbox' });
      response.end();
      return;
    }

    response.writeHead(200, {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'no-store'
    });
    response.end(renderLoginPage());
    return;
  }

  /* Login submission */

  if (request.method === 'POST' && url.pathname === '/login') {
    try {
      const rawBody = await readRequestBody(request);
      const form = new URLSearchParams(rawBody);
      const username = form.get('username') || '';
      const password = form.get('password') || '';

      const loginIsValid =
        INBOX_USERNAME &&
        INBOX_PASSWORD &&
        safeEqual(username, INBOX_USERNAME) &&
        safeEqual(password, INBOX_PASSWORD);

      if (!loginIsValid) {
        response.writeHead(401, {
          'Content-Type': 'text/html; charset=utf-8',
          'Cache-Control': 'no-store'
        });
        response.end(
          renderLoginPage('Incorrect username or password.')
        );
        return;
      }

      const token = signSession({
        username,
        exp: Date.now() + 24 * 60 * 60 * 1000
      });

      response.writeHead(302, {
        Location: '/inbox',
        'Set-Cookie':
          `drmina_session=${encodeURIComponent(token)}; ` +
          'HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=86400',
        'Cache-Control': 'no-store'
      });
      response.end();
    } catch (error) {
      response.writeHead(400, {
        'Content-Type': 'text/html; charset=utf-8'
      });
      response.end(renderLoginPage('Unable to log in.'));
    }

    return;
  }

  /* Logout */

  if (request.method === 'POST' && url.pathname === '/logout') {
    response.writeHead(302, {
      Location: '/login',
      'Set-Cookie':
        'drmina_session=; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=0'
    });
    response.end();
    return;
  }

  /* Inbox page */

  if (request.method === 'GET' && url.pathname === '/inbox') {
    if (!requireAuthentication(request, response)) {
      return;
    }

    if (!fs.existsSync(INBOX_FILE)) {
      response.writeHead(500, {
        'Content-Type': 'text/plain; charset=utf-8'
      });
      response.end('inbox.html was not found.');
      return;
    }

    response.writeHead(200, {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'no-store'
    });
    response.end(fs.readFileSync(INBOX_FILE));
    return;
  }

  /* Inbox message API */

  if (
    request.method === 'GET' &&
    url.pathname === '/api/inbox/messages'
  ) {
    if (!requireAuthentication(request, response, true)) {
      return;
    }

    await getInboxMessages(response, url);
    return;
  }

  /* Save or edit patient name */

  if (
    request.method === 'POST' &&
    url.pathname === '/api/inbox/patient-name'
  ) {
    if (!requireAuthentication(request, response, true)) {
      return;
    }

    await updatePatientName(request, response);
    return;
  }

  /* Mark conversation read or unread */

  if (
    request.method === 'POST' &&
    url.pathname === '/api/inbox/read'
  ) {
    if (!requireAuthentication(request, response, true)) {
      return;
    }

    await markConversationRead(request, response);
    return;
  }

  /* Inbox reply API */

  if (
    request.method === 'POST' &&
    url.pathname === '/api/inbox/reply'
  ) {
    if (!requireAuthentication(request, response, true)) {
      return;
    }

    await handleInboxReply(request, response);
    return;
  }

  /* Privacy page */

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

  /* Meta webhook verification or home page */

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
        'Content-Type': 'text/html; charset=utf-8'
      });

      response.end(
        '<h1>Dr Mina Review Assistant is running!</h1>' +
        '<p><a href="/inbox">Open secure inbox</a></p>'
      );
    }

    return;
  }

  /* Receive WhatsApp webhook messages only */

  if (request.method === 'POST' && url.pathname === '/') {
    try {
      const body = await readRequestBody(request);
      const data = JSON.parse(body);

      const webhookValue =
        data.entry?.[0]
          ?.changes?.[0]
          ?.value;

      const statuses = webhookValue?.statuses || [];
      if (statuses.length) {
        await updateWhatsAppStatuses(statuses);
      }

      const message = webhookValue?.messages?.[0];

      if (message && message.type === 'text') {
        const from = message.from;
        const text = message.text.body.trim();
        const rating = Number(text);

        console.log(`Message from ${from}: ${text}`);

        await saveMessageToSupabase({
          phone: from,
          direction: 'incoming',
          message: text,
          rating:
            Number.isInteger(rating) &&
            rating >= 1 &&
            rating <= 5
              ? rating
              : null,
          status: 'received',
          replied: false,
          whatsappMessageId: message.id || null
        });

        await forwardIncomingMessage(from, text);

        awaitingComplaint = loadComplaints();

        /* Written feedback after rating 1â€“3 */

        if (awaitingComplaint[from]) {
          const originalRating = awaitingComplaint[from];

          await saveMessageToSupabase({
            phone: from,
            direction: 'incoming',
            message: text,
            rating: originalRating,
            status: 'negative_feedback',
            complaint: text,
            replied: false,
            whatsappMessageId: message.id || null
          });

          await logToSheet(
            from,
            originalRating,
            text,
            'NEGATIVE FEEDBACK'
          );

          await sendPatientReplyWithCopy(
            from,
            MSG_FEEDBACK_THANK_YOU,
            `Written feedback received following a rating of ${originalRating}/5. Final acknowledgement sent.`,
            {
              rating: originalRating,
              status: 'feedback_acknowledged',
              complaint: text
            }
          );

          delete awaitingComplaint[from];
          saveComplaints(awaitingComplaint);

          console.log(
            `Feedback process completed for ${from}`
          );
        }

        /* Rating from 1 to 5 */

        else if (
          Number.isInteger(rating) &&
          rating >= 1 &&
          rating <= 5
        ) {
          if (rating <= 3) {
            await sendPatientReplyWithCopy(
              from,
              MSG_NEGATIVE,
              `Negative rating received: ${rating}/5. The patient was asked to explain the experience.`,
              {
                rating,
                status: 'awaiting_feedback'
              }
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
          } else {
            await sendPatientReplyWithCopy(
              from,
              MSG_POSITIVE,
              `Positive rating received: ${rating}/5. The Google review link was sent.`,
              {
                rating,
                status: 'google_review_sent',
                googleReviewSent: true
              }
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

        /* Any other message */

        else {
          console.log(
            `General message received and copied from ${from}`
          );
        }
      }

      response.writeHead(200);
      response.end('OK');
    } catch (error) {
      console.error(
        'Message-processing error:',
        error.message
      );

      response.writeHead(200);
      response.end('OK');
    }

    return;
  }

  response.writeHead(404, {
    'Content-Type': 'text/plain; charset=utf-8'
  });
  response.end('Not found');
});

/* =========================================================
   START SERVER
========================================================= */

const PORT = process.env.PORT || 3000;

server.listen(PORT, () => {
  console.log(
    `Dr Mina Review Assistant running on port ${PORT}`
  );

  if (supabase) {
    console.log('Supabase database connected.');
  } else {
    console.error('Supabase database is not connected.');
  }

  if (!INBOX_USERNAME || !INBOX_PASSWORD) {
    console.error(
      'Inbox login is not configured. Add INBOX_USERNAME and INBOX_PASSWORD in Render.'
    );
  }
});
