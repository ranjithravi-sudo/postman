const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const https = require('https');
const XLSX = require('xlsx');
const axios = require('axios');

// Allow UAT/internal HTTPS endpoints with self-signed or internal CA certs
const httpsAgent = new https.Agent({ rejectUnauthorized: false });

const app = express();
const PORT = process.env.PORT || 3000;
const EXCEL_PATH = path.join(__dirname, 'postman api.xlsx');
const BEARER_TOKEN_FILE = path.join(__dirname, 'bearer-token.txt');

app.use(cors());

/**
 * Read Bearer token from bearer-token.txt (first line, trimmed). Returns null if file missing or empty.
 */
function getBearerTokenFromFile() {
  try {
    const content = fs.readFileSync(BEARER_TOKEN_FILE, 'utf8');
    const firstLine = content.split(/\r?\n/)[0];
    const trimmed = firstLine ? firstLine.trim() : '';
    return trimmed || null;
  } catch {
    return null;
  }
}
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

/**
 * Read postman api.xlsx and return list of { name, url }.
 * Uses header detection for name/URL columns, extracts hyperlink targets when present, and normalizes URLs.
 */
function loadCustomers() {
  if (!fs.existsSync(EXCEL_PATH)) {
    return { error: 'Excel file not found. Place "postman api.xlsx" in the project root.' };
  }
  const workbook = XLSX.readFile(EXCEL_PATH);
  const sheetName = workbook.SheetNames[0];
  const sheet = workbook.Sheets[sheetName];
  const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' });

  if (!rows.length) {
    return { error: 'Excel file is empty.' };
  }

  const customers = [];
  const header = rows[0].map((c) => String(c || '').toLowerCase());
  const nameCol = header.findIndex((h) => /name|customer|cu/.test(h));
  const urlCol = header.findIndex((h) => /url|mock|link|postman|api|endpoint|admin\/mock/.test(h));
  const firstNameCol = nameCol >= 0 ? nameCol : 0;
  const firstUrlCol = urlCol >= 0 ? urlCol : 1;

  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];
    const name = String((row[firstNameCol] ?? row[0] ?? '')).trim();
    const excelRow1Based = i + 1;
    let url = getHyperlinkTarget(sheet, excelRow1Based, firstUrlCol);
    if (url == null || !url) {
      url = String((row[firstUrlCol] ?? row[1] ?? '')).trim();
    }
    if (!url || (!url.startsWith('http://') && !url.startsWith('https://'))) {
      const urlInRow = row.find((cell) => {
        const s = String(cell ?? '').trim();
        return s.startsWith('http://') || s.startsWith('https://');
      });
      if (urlInRow) url = String(urlInRow).trim();
      else {
        const anyHostInRow = row.find((cell) => {
          const s = String(cell ?? '').trim();
          return /\.(ai|com|io|org)\b|\/admin\/mock|interface\.ai/i.test(s) && !/\s/.test(s);
        });
        if (anyHostInRow) url = String(anyHostInRow).trim();
      }
    }
    url = normalizeUrl(url);
    if (name && url) {
      customers.push({ name, url });
    }
  }

  if (customers.length > 0) {
    console.log('First customer loaded:', { name: customers[0].name, url: customers[0].url });
  }
  return { customers };
}

const HOLIDAY_MESSAGE_PATTERNS = [
  /will be closed on/i,
  /closed on\s+\w+\s+\d+/i,
  /observance of/i,
  /closed in observance/i,
  /closed.*re\s*open|we will re\s*open/i,
  /branches and contact center will be closed/i,
  /federal holiday/i,
  /closed for the holiday|offices are currently closed for the holiday|currently closed for the holiday/i,
  /our offices are currently closed for the holiday/i,
];

/**
 * First OUTPUT line that matches a holiday pattern, cleaned for display.
 */
function extractHolidayMessageText(responseData) {
  if (!responseData || !Array.isArray(responseData.body)) return '';
  const outputLines = responseData.body.filter(
    (line) => typeof line === 'string' && line.startsWith('OUTPUT:')
  );
  for (const line of outputLines) {
    if (HOLIDAY_MESSAGE_PATTERNS.some((p) => p.test(line))) {
      let text = line.replace(/^OUTPUT:\s*/i, '').trim();
      text = text.replace(/<phoneme\b[^>]*>[^<]*<\/phoneme>/gi, '');
      text = text.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
      if (text.length > 500) text = `${text.slice(0, 497)}…`;
      return text;
    }
  }
  return '';
}

/**
 * Check if response indicates a holiday/closed message was played.
 * Only inspects OUTPUT lines from the bot (not INPUT echo), so the date in the request
 * (e.g. "INPUT: <RUN> date 2026-02-17...") does not cause a false positive.
 */
function hasHolidayMessage(responseData, selectedDate) {
  let textToSearch = '';
  if (responseData && Array.isArray(responseData.body)) {
    textToSearch = responseData.body
      .filter((line) => typeof line === 'string' && line.startsWith('OUTPUT:'))
      .join('\n');
  }
  if (!textToSearch) {
    textToSearch = JSON.stringify(responseData);
  }
  return HOLIDAY_MESSAGE_PATTERNS.some((p) => p.test(textToSearch));
}

/**
 * Check if response indicates the call was actually transferred to an agent.
 * Only count as transferred when we see explicit transfer evidence (TRANSFER>, "transfer your call", etc.).
 * Do not rely on "customer_support_voice" alone, since the bot may then say "Please provide the reason for calling" without actually transferring.
 */
function hasTransferToAgent(responseData) {
  const jsonStr = JSON.stringify(responseData);
  const hasExplicitTransfer = /TRANSFER\s*>|transfer your call|transfer you to|Please hold.*transfer/i.test(jsonStr);
  const hasClosedMessage = /office is currently closed|call us back during our business hours|call back during our business hours|please call us back|closed\.\s*Please/i.test(jsonStr);
  return hasExplicitTransfer && !hasClosedMessage;
}

/**
 * Check if a string is a valid HTTP(S) URL.
 */
function isValidUrl(s) {
  if (!s || typeof s !== 'string') return false;
  const trimmed = s.trim();
  return trimmed.startsWith('http://') || trimmed.startsWith('https://');
}

/**
 * Normalize URL: ensure it has a protocol when it looks like a hostname.
 */
function normalizeUrl(value) {
  if (!value || typeof value !== 'string') return '';
  const trimmed = value.trim();
  if (trimmed.startsWith('http://') || trimmed.startsWith('https://')) return trimmed;
  if (/\.(ai|com|io|org)\b|\/admin\/mock|interface\.ai/i.test(trimmed) && !/\s/.test(trimmed)) {
    return 'https://' + trimmed.replace(/^https?:\/\//i, '');
  }
  return trimmed;
}

/**
 * Convert 0-based column index to Excel column letter (0=A, 1=B, ..., 26=AA).
 */
function colToLetter(c) {
  let s = '';
  while (c >= 0) {
    s = String.fromCharCode(65 + (c % 26)) + s;
    c = Math.floor(c / 26) - 1;
  }
  return s;
}

/**
 * Get hyperlink target from sheet cell, or null if none.
 */
function getHyperlinkTarget(sheet, rowIndex1Based, colIndex0Based) {
  const cellRef = colToLetter(colIndex0Based) + rowIndex1Based;
  const cell = sheet[cellRef];
  if (!cell || !cell.l) return null;
  const target = cell.l.Target || cell.l.Hyperlink;
  return typeof target === 'string' ? target.trim() : null;
}

/**
 * Normalize time to HH:mm:ss (e.g. "11:10" -> "11:10:00", "11:10:00" -> "11:10:00").
 */
function normalizeTime(timeStr) {
  if (!timeStr || typeof timeStr !== 'string') return '11:10:00';
  const trimmed = timeStr.trim();
  const parts = trimmed.split(/[:.]/);
  const h = parts[0] || '11';
  const m = parts[1] || '10';
  const s = parts[2] || '00';
  return `${h.padStart(2, '0')}:${m.padStart(2, '0')}:${s.padStart(2, '0')}`;
}

/**
 * Run single CU: POST to mock URL and parse result.
 */
async function runOneCu(name, url, dateStr, bearerToken, timeStr) {
  const timePart = normalizeTime(timeStr);
  const dateTime = `${dateStr}T${timePart}`;
  const body = {
    type: 'twilio',
    actions: [`<RUN> date ${dateTime}`, 'representative', 'representative'],
  };

  const normalized = normalizeUrl(url);
  if (!isValidUrl(normalized)) {
    return {
      customerName: name,
      success: false,
      holidayMessageFound: false,
      holidayMessageText: '',
      transferredToAgent: false,
      message: 'Missing or invalid URL in Excel for this customer. Check the URL column.',
      statusCode: null,
    };
  }

  const headers = { 'Content-Type': 'application/json' };
  if (bearerToken && bearerToken.trim()) {
    headers['Authorization'] = `Bearer ${bearerToken.trim()}`;
  }

  try {
    const res = await axios.post(normalized, body, {
      timeout: 30000,
      headers,
      validateStatus: () => true,
      httpsAgent,
    });

    const data = res.data || {};
    const holidayFound = hasHolidayMessage(data, dateStr);
    const transferred = hasTransferToAgent(data);
    const success = holidayFound && !transferred;

    let message = '';
    if (!holidayFound) message = 'Holiday message not found in response.';
    else if (transferred) message = 'Call was transferred to agent (holiday-only expected).';
    else message = 'OK: Holiday message played, no transfer to agent.';

    return {
      customerName: name,
      success,
      holidayMessageFound: holidayFound,
      holidayMessageText: extractHolidayMessageText(data),
      transferredToAgent: transferred,
      message,
      statusCode: res.status,
    };
  } catch (err) {
    const msg = err.response
      ? `HTTP ${err.response.status}: ${err.response.statusText || err.message}`
      : err.message || 'Request failed';
    return {
      customerName: name,
      success: false,
      holidayMessageFound: false,
      holidayMessageText: '',
      transferredToAgent: false,
      message: msg,
      statusCode: err.response?.status,
    };
  }
}

// GET /api/customers — list CUs for UI (name only; URL kept server-side)
app.get('/api/customers', (req, res) => {
  const result = loadCustomers();
  if (result.error) {
    return res.status(400).json({ error: result.error });
  }
  res.json({ customers: result.customers.map((c) => ({ name: c.name })) });
});

// POST /api/run — run verification for selected CUs, date, and time
app.post('/api/run', async (req, res) => {
  const { date: dateStr, time: timeStr, customerNames, bearerToken: uiToken } = req.body || {};
  if (!dateStr || !Array.isArray(customerNames) || !customerNames.length) {
    return res.status(400).json({ error: 'Request must include date (YYYY-MM-DD) and customerNames array.' });
  }

  const bearerToken = (typeof uiToken === 'string' && uiToken.trim()) ? uiToken.trim() : getBearerTokenFromFile();

  const result = loadCustomers();
  if (result.error) {
    return res.status(400).json({ error: result.error });
  }

  const byName = new Map(result.customers.map((c) => [c.name, c.url]));
  const namesToRun = customerNames.filter((n) => byName.has(n));
  if (namesToRun.length === 0) {
    return res.status(400).json({ error: 'No valid customer names selected.' });
  }

  const CONCURRENCY = 15;
  const results = [];
  for (let i = 0; i < namesToRun.length; i += CONCURRENCY) {
    const batch = namesToRun.slice(i, i + CONCURRENCY);
    const batchResults = await Promise.all(
      batch.map((name) => runOneCu(name, byName.get(name), dateStr, bearerToken, timeStr))
    );
    results.push(...batchResults);
  }

  res.json({ results });
});

// SPA fallback
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => {
  console.log(`Holiday Verification Platform running at http://localhost:${PORT}`);
});
