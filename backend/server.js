const express = require("express");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const bcrypt = require("bcryptjs");
const QRCode = require("qrcode");
const multer = require("multer");
const XLSX = require("xlsx");
const nodemailer = require("nodemailer");

loadEnvFile(path.join(__dirname, ".env"));

const app = express();
const PORT = process.env.PORT || 3000;
const STORE_PATH = path.join(__dirname, "data", "store.json");
const FRONTEND_DIR = path.join(__dirname, "..", "frontend");
const UPLOAD_DIR = path.join(__dirname, "uploads");

app.use(express.json());
app.use(express.static(FRONTEND_DIR));

/* ── Multer — Excel upload ── */
const upload = multer({
  dest: UPLOAD_DIR,
  fileFilter: (req, file, cb) => {
    const ok = /\.(xlsx|xls)$/i.test(file.originalname);
    cb(ok ? null : new Error("Only .xlsx / .xls files are allowed"), ok);
  },
  limits: { fileSize: 5 * 1024 * 1024 },
});

/* ── Env loader ── */
function loadEnvFile(filePath) {
  if (!fs.existsSync(filePath)) return;
  fs.readFileSync(filePath, "utf8").split(/\r?\n/).forEach((line) => {
    const t = line.trim();
    if (!t || t.startsWith("#")) return;
    const i = t.indexOf("=");
    if (i === -1) return;
    const k = t.slice(0, i).trim();
    const v = t.slice(i + 1).trim().replace(/^"(.*)"$/, "$1");
    if (!process.env[k]) process.env[k] = v;
  });
}

/* ── Store helpers ── */
function createToken() { return crypto.randomBytes(16).toString("hex"); }

function getBaseUrl(req) {
  return process.env.APP_BASE_URL || `${req.protocol}://${req.get("host")}`;
}

function createParentApprovalLink(req, type, token) {
  return `${getBaseUrl(req)}/parent-approval.html?type=${type}&token=${token}`;
}

function withApprovalDefaults(item, type) {
  const tok = item.approvalToken || createToken();
  return {
    ...item,
    parentApproval: item.parentApproval || "Pending",
    adminApproval: item.adminApproval || "Pending",
    parentVerification: item.parentVerification || "Pending",
    approvalToken: tok,
    approvalLink: item.approvalLink || `/parent-approval.html?type=${type}&token=${tok}`,
  };
}

function readStore() {
  const raw = fs.readFileSync(STORE_PATH, "utf8").replace(/^\uFEFF/, "");
  const store = JSON.parse(raw);
  store.holidays = store.holidays || [];
  store.gatePasses = (store.gatePasses || []).map((i) => withApprovalDefaults(i, "gatepass"));
  store.leaveRequests = (store.leaveRequests || []).map((i) => withApprovalDefaults(i, "leave"));
  return store;
}

function writeStore(store) {
  fs.writeFileSync(STORE_PATH, JSON.stringify(store, null, 2), { encoding: "utf8" });
}

function nextId(prefix, collection) {
  const max = collection.reduce((acc, item) => {
    const m = String(item.id || "").match(/(\d+)$/);
    return m ? Math.max(acc, Number(m[1])) : acc;
  }, 0);
  return `${prefix}${String(max + 1).padStart(3, "0")}`;
}

function sanitizeUser(user) {
  const { password, ...safe } = user;
  return safe;
}

function finalStatus(parentApproval, adminApproval) {
  if (parentApproval === "Rejected" || adminApproval === "Rejected") return "Rejected";
  if (parentApproval === "Approved" && adminApproval === "Approved") return "Approved";
  return "Pending";
}

function findStudent(store, body) {
  return store.students.find(
    (s) => s.name === body.studentName || s.roomNumber === body.roomNumber || s.userId === body.userId
  );
}

/* ── Input Validation ── */
function validateString(val, name, maxLen = 1000) {
  if (val === undefined || val === null || String(val).trim() === "") {
    throw new Error(`${name} is required`);
  }
  if (String(val).length > maxLen) {
    throw new Error(`${name} must be ${maxLen} characters or fewer`);
  }
  return String(val).trim();
}

function validateDate(val, name) {
  if (!val || isNaN(Date.parse(val))) throw new Error(`${name} must be a valid date`);
  return val;
}

function validateEnum(val, name, allowed) {
  if (!allowed.includes(val)) throw new Error(`${name} must be one of: ${allowed.join(", ")}`);
  return val;
}

/* ── Auth Middleware ── */
function requireAuth(req, res, next) {
  const userId = req.headers["x-user-id"];
  if (!userId) return res.status(401).json({ message: "Authentication required" });
  const store = readStore();
  const user = [...store.students, ...store.admins].find((e) => e.userId === userId);
  if (!user) return res.status(401).json({ message: "Invalid session" });
  req.currentUser = sanitizeUser(user);
  next();
}

function requireAdmin(req, res, next) {
  requireAuth(req, res, () => {
    if (req.currentUser.role !== "admin") {
      return res.status(403).json({ message: "Admin access required" });
    }
    next();
  });
}

/* ══════════════════════════════════════════════════════════════
   MAILER
══════════════════════════════════════════════════════════════ */
const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST,
  port: Number(process.env.SMTP_PORT) || 587,
  secure: process.env.SMTP_SECURE === "true",
  auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
});

/**
 * Send parent approval email (non-blocking — logs errors but never crashes the request).
 * @param {string} toEmail   - Parent email address
 * @param {string} type      - "gatepass" | "leave"
 * @param {object} item      - The gate pass or leave record
 * @param {string} link      - Full approval URL
 */
async function sendParentApprovalEmail(toEmail, type, item, link) {
  if (!process.env.SMTP_HOST || !process.env.SMTP_USER || !toEmail) return;
  const isGP = type === "gatepass";
  const subject = isGP
    ? `[Hostel] Gate Pass Approval Required — ${item.studentName}`
    : `[Hostel] Leave Request Approval Required — ${item.studentName}`;

  const body = isGP
    ? `Your child ${item.studentName} (Room ${item.roomNumber}) has requested a gate pass.\n\nOut Time : ${item.outTime}\nReturn   : ${item.returnTime}\nReason   : ${item.reason}\n\nPlease click the link below to approve or reject:\n${link}`
    : `Your child ${item.studentName} (Room ${item.roomNumber}) has applied for leave.\n\nFrom   : ${item.fromDate}\nTo     : ${item.toDate}\nReason : ${item.reason}\n\nPlease click the link below to approve or reject:\n${link}`;

  try {
    await transporter.sendMail({
      from: process.env.SMTP_USER,
      to: toEmail,
      subject,
      text: body,
    });
    console.log(`[Mailer] Approval email sent to ${toEmail} for ${item.id}`);
  } catch (err) {
    console.error(`[Mailer] Failed to send approval email for ${item.id}:`, err.message);
  }
}

/* ══════════════════════════════════════════════════════════════
   MODULAR CALL SERVICE
══════════════════════════════════════════════════════════════ */
const callService = {
  async initiateCall(toPhone, gatePass) {
    if (
      process.env.TWILIO_ACCOUNT_SID &&
      process.env.TWILIO_AUTH_TOKEN &&
      process.env.TWILIO_PHONE_NUMBER
    ) {
      // ── PRODUCTION: Real Twilio call ──────────────────────────
      // const twilio = require("twilio");
      // const client = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);
      // const twimlUrl = `${process.env.APP_BASE_URL}/api/twiml/gatepass/${gatePass.id}`;
      // const call = await client.calls.create({
      //   url: twimlUrl,
      //   to: toPhone,
      //   from: process.env.TWILIO_PHONE_NUMBER,
      // });
      // return { callSid: call.sid, mode: "twilio" };
    }
    return { callSid: `SIM-${Date.now()}`, mode: "simulation" };
  },

  twiml(gatePassId, baseUrl) {
    return `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Gather numDigits="1" action="${baseUrl}/api/twiml/gatepass/${gatePassId}/dtmf" method="POST">
    <Say voice="alice">
      Hello. This is an automated message from Nevermore Hostel.
      Your child has requested permission to leave the hostel premises.
      Press 1 to approve the gate pass.
      Press 2 to reject the gate pass.
    </Say>
  </Gather>
  <Say>We did not receive your input. Goodbye.</Say>
</Response>`;
  },
};

/* ══════════════════════════════════════════════════════════════
   ROUTES
══════════════════════════════════════════════════════════════ */

/* ── Auth ── */
app.post("/api/login", (req, res) => {
  const { userId, password, selectedBlock } = req.body;
  if (!userId || !password) return res.status(400).json({ message: "User ID and password are required" });

  const store = readStore();
  const user = [...store.students, ...store.admins].find((e) => e.userId === userId);
  if (!user) return res.status(401).json({ message: "Invalid credentials" });

  // Support both bcrypt hashes and legacy plaintext (migration safety net)
  const passwordMatch = user.password.startsWith("$2")
    ? bcrypt.compareSync(password, user.password)
    : user.password === password;

  if (!passwordMatch) return res.status(401).json({ message: "Invalid credentials" });

  if (user.role === "student" && selectedBlock && user.block && user.block !== selectedBlock) {
    return res.status(401).json({ message: `You are not registered in block ${selectedBlock}` });
  }
  return res.json({ message: "Login successful", role: user.role, user: sanitizeUser(user) });
});

app.get("/api/me/:userId", requireAuth, (req, res) => {
  if (req.currentUser.userId !== req.params.userId && req.currentUser.role !== "admin") {
    return res.status(403).json({ message: "Access denied" });
  }
  const store = readStore();
  const user = [...store.students, ...store.admins].find((e) => e.userId === req.params.userId);
  if (!user) return res.status(404).json({ message: "User not found" });
  return res.json(sanitizeUser(user));
});

/* ── Mess Menu ── */
app.get("/api/mess-menu", requireAuth, (req, res) => {
  const store = readStore();
  res.json({ menu: store.messMenu, lastUpdated: store.messMenuLastUpdated ?? null });
});

app.put("/api/mess-menu/:day", requireAdmin, (req, res) => {
  const store = readStore();
  const item = store.messMenu.find((m) => m.day.toLowerCase() === req.params.day.toLowerCase());
  if (!item) return res.status(404).json({ message: "Menu entry not found" });
  try {
    item.breakfast = validateString(req.body.breakfast, "Breakfast", 255);
    item.lunch     = validateString(req.body.lunch,     "Lunch",     255);
    item.dinner    = validateString(req.body.dinner,    "Dinner",    255);
  } catch (e) { return res.status(400).json({ message: e.message }); }
  writeStore(store);
  res.json({ message: "Mess menu updated", item });
});

/* ── Auto-password generator ── */
function generatePassword() {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  return Array.from(crypto.randomBytes(8)).map((b) => chars[b % chars.length]).join("");
}

/* ── Excel Users Upload ── */
const VALID_BLOCKS = ["GH1", "GH2", "BH1", "BH2"];

app.post("/api/users/upload", requireAdmin, upload.single("usersFile"), (req, res) => {
  if (!req.file) return res.status(400).json({ message: "No file uploaded" });

  const summary = {
    students: { created: 0, updated: 0, skipped: 0, skippedRows: [] },
    admins:   { created: 0, updated: 0, skipped: 0 },
  };

  try {
    const wb = XLSX.readFile(req.file.path);
    const ws = wb.Sheets[wb.SheetNames[0]];
    const rows = XLSX.utils.sheet_to_json(ws, { defval: "" });

    const store = readStore();
    let processable = 0;

    for (const row of rows) {
      const keys = Object.keys(row);
      const get = (name) => {
        const k = keys.find((k) => k.toLowerCase().trim() === name.toLowerCase());
        return k ? String(row[k]).trim() : "";
      };
      const has = (name) => keys.some((k) => k.toLowerCase().trim() === name.toLowerCase());

      const userId      = get("userId");
      const role        = get("role").toLowerCase();
      const name        = get("name");
      const rawPassword = get("password") || generatePassword();
      const roomNumber  = get("roomNumber");
      const block       = get("block");
      const parentPhone = get("parentPhone");
      const parentEmail = get("parentEmail");

      if (!userId) continue;
      if (role !== "student" && role !== "admin") continue;
      processable++;

      // Hash the password before storing
      const hashedPassword = bcrypt.hashSync(rawPassword, 10);

      if (role === "student") {
        if (has("block") && block !== "" && !VALID_BLOCKS.includes(block)) {
          summary.students.skipped++;
          summary.students.skippedRows.push({ userId, reason: "Invalid block value." });
          continue;
        }
        const idx = store.students.findIndex((s) => s.userId === userId);
        const updates = { name, password: hashedPassword, roomNumber, parentPhone };
        if (has("block") && block !== "") updates.block = block;
        if (has("parentEmail") && parentEmail !== "") updates.parentEmail = parentEmail;
        if (idx === -1) {
          store.students.push({ userId, role: "student", ...updates });
          summary.students.created++;
        } else {
          Object.assign(store.students[idx], updates);
          summary.students.updated++;
        }
      } else {
        const idx = store.admins.findIndex((a) => a.userId === userId);
        if (idx === -1) {
          store.admins.push({ userId, password: hashedPassword, role: "admin", name });
          summary.admins.created++;
        } else {
          Object.assign(store.admins[idx], { name, password: hashedPassword });
          summary.admins.updated++;
        }
      }
    }

    if (processable === 0) {
      return res.status(400).json({ message: "No valid rows found in the uploaded file" });
    }

    writeStore(store);
    res.json({ message: "Upload complete.", summary });
  } catch (err) {
    res.status(500).json({ message: "Failed to parse Excel file: " + err.message });
  } finally {
    if (req.file && fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);
  }
});

/* ── Excel Mess Menu Upload ── */
app.post("/api/mess-menu/upload", requireAdmin, upload.single("menuFile"), (req, res) => {
  if (!req.file) return res.status(400).json({ message: "No file uploaded" });

  try {
    const wb = XLSX.readFile(req.file.path);
    const ws = wb.Sheets[wb.SheetNames[0]];
    const rows = XLSX.utils.sheet_to_json(ws, { defval: "" });

    const VALID_DAYS = ["Monday","Tuesday","Wednesday","Thursday","Friday","Saturday","Sunday"];
    const parsed = [];

    for (const row of rows) {
      const keys = Object.keys(row);
      const get = (name) => {
        const k = keys.find((k) => k.toLowerCase().trim() === name.toLowerCase());
        return k ? String(row[k]).trim() : "";
      };
      const day       = get("day");
      const breakfast = get("breakfast");
      const lunch     = get("lunch");
      const dinner    = get("dinner");
      if (!day || !VALID_DAYS.includes(day)) continue;
      if (!breakfast && !lunch && !dinner) continue;
      parsed.push({ day, breakfast, lunch, dinner });
    }

    if (parsed.length === 0) {
      fs.unlinkSync(req.file.path);
      return res.status(400).json({ message: "No valid rows found. Columns must be: day, breakfast, lunch, dinner" });
    }

    const store = readStore();
    store.messMenu = parsed;
    store.messMenuLastUpdated = new Date().toISOString();
    writeStore(store);
    fs.unlinkSync(req.file.path);

    res.json({
      message: `Mess menu updated from Excel — ${parsed.length} day(s) imported.`,
      daysImported: parsed.length,
      lastUpdated: store.messMenuLastUpdated,
      menu: store.messMenu,
    });
  } catch (err) {
    if (req.file && fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);
    res.status(500).json({ message: "Failed to parse Excel file: " + err.message });
  }
});

/* ── Complaints ── */
app.get("/api/complaints", requireAuth, (req, res) => res.json(readStore().complaints));

app.post("/api/complaints", requireAuth, (req, res) => {
  const store = readStore();
  let roomNumber, complaintType, issueDescription, priority;
  try {
    roomNumber        = validateString(req.body.roomNumber,        "Room number", 20);
    complaintType     = validateEnum(req.body.complaintType, "Complaint type", ["Electrical","Water","Furniture","Other"]);
    issueDescription  = validateString(req.body.issueDescription,  "Issue description", 1000);
    priority          = Math.min(5, Math.max(1, Number(req.body.priority) || 3));
  } catch (e) { return res.status(400).json({ message: e.message }); }

  const complaint = {
    id: nextId("CMP", store.complaints),
    studentName: req.body.studentName ? String(req.body.studentName).trim().slice(0, 120) : "",
    roomNumber,
    complaintType,
    issueDescription,
    priority,
    status: "Pending",
    resolved: false,
    assuranceDate: null,
    escalated: false,
    createdAt: new Date().toISOString(),
  };
  store.complaints.unshift(complaint);
  writeStore(store);
  res.status(201).json({ message: "Complaint successfully submitted.", complaint });
});

app.patch("/api/complaints/:id", requireAdmin, (req, res) => {
  const store = readStore();
  const item = store.complaints.find((c) => c.id === req.params.id);
  if (!item) return res.status(404).json({ message: "Complaint not found" });
  if (req.body.status !== undefined) item.status = req.body.status;
  if (req.body.assuranceDate !== undefined) item.assuranceDate = req.body.assuranceDate;
  if (item.status === "Resolved") item.resolved = true;
  writeStore(store);
  res.json({ message: "Complaint updated", complaint: item });
});

/* ── Gate Pass ── */
app.get("/api/gatepass", requireAuth, (req, res) => {
  const store = readStore();
  res.json(store.gatePasses.map((i) => ({
    ...i,
    approvalLink: createParentApprovalLink(req, "gatepass", i.approvalToken),
  })));
});

app.post("/api/gatepass", requireAuth, async (req, res) => {
  const store = readStore();
  let studentName, roomNumber, outTime, returnTime, reason;
  try {
    studentName = validateString(req.body.studentName, "Student name", 120);
    roomNumber  = validateString(req.body.roomNumber,  "Room number",  20);
    outTime     = validateDate(req.body.outTime,    "Out time");
    returnTime  = validateDate(req.body.returnTime, "Return time");
    reason      = validateString(req.body.reason,   "Reason",        500);
  } catch (e) { return res.status(400).json({ message: e.message }); }

  if (new Date(returnTime) <= new Date(outTime)) {
    return res.status(400).json({ message: "Return time must be after out time" });
  }

  const student = findStudent(store, req.body);
  const approvalToken = createToken();
  const approvalLink  = createParentApprovalLink(req, "gatepass", approvalToken);
  const gatePass = {
    id: nextId("GP", store.gatePasses),
    studentName,
    roomNumber,
    outTime,
    returnTime,
    reason,
    parentPhone: req.body.parentPhone ? String(req.body.parentPhone).trim() : (student?.parentPhone || ""),
    status: "Pending",
    parentApproval: "Pending",
    parentVerification: "Pending",
    adminApproval: "Pending",
    approvalToken,
    approvalLink,
    qrCode: "",
    createdAt: new Date().toISOString(),
  };
  store.gatePasses.unshift(gatePass);
  writeStore(store);

  // Send parent approval email (non-blocking)
  const parentEmail = student?.parentEmail || "";
  sendParentApprovalEmail(parentEmail, "gatepass", gatePass, approvalLink);

  res.status(201).json({ message: "Gate pass submitted. Parent approval email sent if configured.", gatePass });
});

/* ── IVR: GET gate pass for call screen ── */
app.get("/api/gatepass/:id/ivr", requireAdmin, (req, res) => {
  const store = readStore();
  const gp = store.gatePasses.find((i) => i.id === req.params.id);
  if (!gp) return res.status(404).json({ message: "Gate pass not found" });
  if (!gp.parentPhone) {
    const student = store.students.find(
      (s) => s.name === gp.studentName || s.roomNumber === gp.roomNumber
    );
    if (student?.parentPhone) gp.parentPhone = student.parentPhone;
  }
  res.json(gp);
});

/* ── IVR: Initiate simulated/real call ── */
app.post("/api/gatepass/:id/call", requireAdmin, async (req, res) => {
  const store = readStore();
  const gp = store.gatePasses.find((i) => i.id === req.params.id);
  if (!gp) return res.status(404).json({ message: "Gate pass not found" });
  if (!gp.parentPhone) {
    const student = store.students.find(
      (s) => s.name === gp.studentName || s.roomNumber === gp.roomNumber
    );
    if (student?.parentPhone) gp.parentPhone = student.parentPhone;
  }
  if (!gp.parentPhone) {
    return res.status(400).json({ message: "No parent phone number found for this student." });
  }
  try {
    const result = await callService.initiateCall(gp.parentPhone, gp);
    gp.callSid = result.callSid;
    gp.callMode = result.mode;
    gp.parentVerification = "Call Initiated";
    writeStore(store);
    res.json({ message: `Parent call initiated (${result.mode}).`, callSid: result.callSid, mode: result.mode, gatePass: gp });
  } catch (err) {
    res.status(500).json({ message: "Call failed: " + err.message });
  }
});

/* ── IVR: Parent presses keypad ── */
async function processIvrKey(gp, key, store) {
  gp.parentApproval = key === "1" ? "Approved" : "Rejected";
  gp.parentVerification = key === "1" ? "Accepted" : "Rejected";
  gp.status = finalStatus(gp.parentApproval, gp.adminApproval);

  if (gp.status === "Approved") {
    gp.qrCode = await QRCode.toDataURL(JSON.stringify({
      id: gp.id, studentName: gp.studentName, roomNumber: gp.roomNumber,
      outTime: gp.outTime, returnTime: gp.returnTime, status: gp.status,
    }));
  } else {
    gp.qrCode = "";
  }
  writeStore(store);
}

// Simulated IVR keypress from the in-browser call screen
app.post("/api/gatepass/:id/ivr", requireAdmin, async (req, res) => {
  const store = readStore();
  const gp = store.gatePasses.find((i) => i.id === req.params.id);
  if (!gp) return res.status(404).json({ message: "Gate pass not found" });
  const key = req.body.key;
  if (key !== "1" && key !== "2") return res.status(400).json({ message: "Press 1 to approve or 2 to reject." });
  await processIvrKey(gp, key, store);
  res.json({ message: key === "1" ? "Parent verified. Gate pass approved." : "Parent rejected the gate pass.", gatePass: gp });
});

// Twilio DTMF webhook
app.post("/api/twiml/gatepass/:id/dtmf", async (req, res) => {
  const store = readStore();
  const gp = store.gatePasses.find((i) => i.id === req.params.id);
  const digit = req.body.Digits;
  res.set("Content-Type", "text/xml");
  if (!gp) {
    return res.send(`<?xml version="1.0"?><Response><Say>Gate pass not found. Goodbye.</Say></Response>`);
  }
  if (digit === "1" || digit === "2") {
    await processIvrKey(gp, digit, store);
    const msg = digit === "1"
      ? "Thank you. The gate pass has been approved."
      : "The gate pass has been rejected. Goodbye.";
    return res.send(`<?xml version="1.0"?><Response><Say voice="alice">${msg}</Say></Response>`);
  }
  return res.send(`<?xml version="1.0"?><Response><Say>Invalid input. Goodbye.</Say></Response>`);
});

// Twilio TwiML endpoint
app.get("/api/twiml/gatepass/:id", (req, res) => {
  res.set("Content-Type", "text/xml");
  res.send(callService.twiml(req.params.id, getBaseUrl(req)));
});

/* ── Admin: update gate pass status ── */
app.patch("/api/gatepass/:id/status", requireAdmin, async (req, res) => {
  const store = readStore();
  const gp = store.gatePasses.find((i) => i.id === req.params.id);
  if (!gp) return res.status(404).json({ message: "Gate pass not found" });
  gp.adminApproval = req.body.status === "Approved" ? "Approved" : "Rejected";
  gp.status = finalStatus(gp.parentApproval, gp.adminApproval);
  if (gp.status === "Approved") {
    gp.qrCode = await QRCode.toDataURL(JSON.stringify({
      id: gp.id, studentName: gp.studentName, roomNumber: gp.roomNumber,
      outTime: gp.outTime, returnTime: gp.returnTime, status: gp.status,
    }));
  } else {
    gp.qrCode = "";
  }
  writeStore(store);
  res.json({ message: "Gate pass updated", gatePass: gp });
});

/* ── Leave ── */
app.get("/api/leave", requireAuth, (req, res) => {
  const store = readStore();
  res.json(store.leaveRequests.map((i) => ({
    ...i,
    approvalLink: createParentApprovalLink(req, "leave", i.approvalToken),
  })));
});

app.post("/api/leave", requireAuth, async (req, res) => {
  const store = readStore();
  let studentName, roomNumber, fromDate, toDate, reason;
  try {
    studentName = validateString(req.body.studentName, "Student name", 120);
    roomNumber  = validateString(req.body.roomNumber,  "Room number",  20);
    fromDate    = validateDate(req.body.fromDate, "From date");
    toDate      = validateDate(req.body.toDate,   "To date");
    reason      = validateString(req.body.reason, "Reason", 500);
  } catch (e) { return res.status(400).json({ message: e.message }); }

  if (new Date(toDate) < new Date(fromDate)) {
    return res.status(400).json({ message: "To date must be on or after from date" });
  }

  const student = findStudent(store, req.body);
  const approvalToken = createToken();
  const approvalLink  = createParentApprovalLink(req, "leave", approvalToken);
  const leave = {
    id: nextId("LV", store.leaveRequests),
    studentName,
    roomNumber,
    fromDate,
    toDate,
    reason,
    parentPhone: student?.parentPhone || "",
    status: "Pending",
    parentApproval: "Pending",
    adminApproval: "Pending",
    approvalToken,
    approvalLink,
    createdAt: new Date().toISOString(),
  };
  store.leaveRequests.unshift(leave);
  writeStore(store);

  // Send parent approval email (non-blocking)
  const parentEmail = student?.parentEmail || "";
  sendParentApprovalEmail(parentEmail, "leave", leave, approvalLink);

  res.status(201).json({ message: "Leave request submitted. Parent approval email sent if configured.", leave });
});

app.patch("/api/leave/:id", requireAdmin, (req, res) => {
  const store = readStore();
  const leave = store.leaveRequests.find((i) => i.id === req.params.id);
  if (!leave) return res.status(404).json({ message: "Leave request not found" });
  leave.adminApproval = req.body.status === "Approved" ? "Approved" : "Rejected";
  leave.status = finalStatus(leave.parentApproval, leave.adminApproval);
  writeStore(store);
  res.json({ message: "Leave request updated", leave });
});

/* ── Room Swap ── */
app.get("/api/room-swap", requireAuth, (req, res) => res.json(readStore().roomSwaps));

app.post("/api/room-swap", requireAuth, (req, res) => {
  const store = readStore();
  let currentRoomNumber, requestedRoomNumber, reason;
  try {
    currentRoomNumber   = validateString(req.body.currentRoomNumber,   "Current room number",   20);
    requestedRoomNumber = validateString(req.body.requestedRoomNumber, "Requested room number", 20);
    reason              = validateString(req.body.reason,              "Reason",                500);
  } catch (e) { return res.status(400).json({ message: e.message }); }

  const student = findStudent(store, req.body);
  const roomSwap = {
    id: nextId("RS", store.roomSwaps),
    studentName: student?.name || req.body.studentName || "",
    userId: student?.userId || "",
    currentRoomNumber,
    requestedRoomNumber,
    reason,
    status: "Pending",
    createdAt: new Date().toISOString(),
  };
  store.roomSwaps.unshift(roomSwap);
  writeStore(store);
  res.status(201).json({ message: "Room swap request submitted", roomSwap });
});

app.patch("/api/room-swap/:id", requireAdmin, (req, res) => {
  const store = readStore();
  const item = store.roomSwaps.find((i) => i.id === req.params.id);
  if (!item) return res.status(404).json({ message: "Room swap not found" });
  item.status = req.body.status || item.status;
  writeStore(store);
  res.json({ message: "Room swap updated", roomSwap: item });
});

/* ── Feedback ── */
app.get("/api/feedback", requireAuth, (req, res) => res.json(readStore().feedback));

app.post("/api/feedback", requireAuth, (req, res) => {
  const store = readStore();
  const rating = Number(req.body.rating);
  if (!rating || rating < 1 || rating > 5) {
    return res.status(400).json({ message: "Rating must be between 1 and 5" });
  }
  const comment = req.body.comment ? String(req.body.comment).trim().slice(0, 1000) : "";
  const feedback = {
    id: nextId("FDB", store.feedback),
    rating,
    comment,
    createdAt: new Date().toISOString(),
  };
  store.feedback.unshift(feedback);
  writeStore(store);
  res.status(201).json({ message: "Feedback submitted", feedback });
});

/* ── Holidays ── */
app.get("/api/holidays", requireAuth, (req, res) => {
  const holidays = [...readStore().holidays].sort((a, b) => a.holidayDate.localeCompare(b.holidayDate));
  res.json(holidays);
});

app.post("/api/holidays", requireAdmin, (req, res) => {
  const store = readStore();
  let holidayName, holidayDate, description;
  try {
    holidayName  = validateString(req.body.holidayName,  "Holiday name",  150);
    holidayDate  = validateDate(req.body.holidayDate,    "Holiday date");
    description  = validateString(req.body.description,  "Description",   255);
  } catch (e) { return res.status(400).json({ message: e.message }); }

  const holiday = {
    id: nextId("HOL", store.holidays),
    holidayName,
    holidayDate,
    description,
  };
  store.holidays.unshift(holiday);
  writeStore(store);
  res.status(201).json({ message: "Holiday added", holiday });
});

app.put("/api/holidays/:id", requireAdmin, (req, res) => {
  const store = readStore();
  const holiday = store.holidays.find((i) => i.id === req.params.id);
  if (!holiday) return res.status(404).json({ message: "Holiday not found" });
  try {
    if (req.body.holidayName) holiday.holidayName = validateString(req.body.holidayName, "Holiday name", 150);
    if (req.body.holidayDate) holiday.holidayDate = validateDate(req.body.holidayDate, "Holiday date");
    if (req.body.description) holiday.description = validateString(req.body.description, "Description", 255);
  } catch (e) { return res.status(400).json({ message: e.message }); }
  writeStore(store);
  res.json({ message: "Holiday updated", holiday });
});

app.delete("/api/holidays/:id", requireAdmin, (req, res) => {
  const store = readStore();
  const idx = store.holidays.findIndex((i) => i.id === req.params.id);
  if (idx === -1) return res.status(404).json({ message: "Holiday not found" });
  const [holiday] = store.holidays.splice(idx, 1);
  writeStore(store);
  res.json({ message: "Holiday deleted", holiday });
});

/* ── Parent Approval (link-based — no auth required, token is the secret) ── */
app.get("/api/parent-approval/:type/:token", (req, res) => {
  const store = readStore();
  const col = req.params.type === "gatepass" ? store.gatePasses
    : req.params.type === "leave" ? store.leaveRequests
    : null;
  if (!col) return res.status(404).json({ message: "Invalid type" });
  const item = col.find((i) => i.approvalToken === req.params.token);
  if (!item) return res.status(404).json({ message: "Approval request not found" });
  res.json({
    type: req.params.type,
    request: { ...item, approvalLink: createParentApprovalLink(req, req.params.type, item.approvalToken) },
  });
});

app.post("/api/parent-approval/:type/:token", async (req, res) => {
  const store = readStore();
  const col = req.params.type === "gatepass" ? store.gatePasses
    : req.params.type === "leave" ? store.leaveRequests
    : null;
  if (!col) return res.status(404).json({ message: "Invalid type" });
  const item = col.find((i) => i.approvalToken === req.params.token);
  if (!item) return res.status(404).json({ message: "Approval request not found" });

  if (item.parentApproval !== "Pending") {
    return res.status(400).json({ message: "Parent response already recorded" });
  }

  item.parentApproval = req.body.action === "approve" ? "Approved" : "Rejected";
  item.status = finalStatus(item.parentApproval, item.adminApproval);

  if (req.params.type === "gatepass" && item.status === "Approved") {
    item.qrCode = await QRCode.toDataURL(JSON.stringify({
      id: item.id, studentName: item.studentName, roomNumber: item.roomNumber,
      outTime: item.outTime, returnTime: item.returnTime, status: item.status,
    }));
  }
  writeStore(store);
  res.json({
    message: req.body.action === "approve" ? "Parent approval recorded." : "Parent rejection recorded.",
    request: item,
  });
});

/* ── Admin Stats & Overview ── */
app.get("/api/admin/stats", requireAdmin, (req, res) => {
  const store = readStore();
  const resolved = store.complaints.filter((i) => i.status === "Resolved").length;
  const avgRating = store.feedback.length
    ? (store.feedback.reduce((s, i) => s + Number(i.rating || 0), 0) / store.feedback.length).toFixed(1)
    : "0.0";
  res.json({
    totalStudents: store.students.length,
    totalComplaints: store.complaints.length,
    resolvedComplaints: resolved,
    complaintStatus: {
      pending:    store.complaints.filter((i) => i.status === "Pending").length,
      inProgress: store.complaints.filter((i) => i.status === "In Progress").length,
      resolved,
    },
    leaveRequests: store.leaveRequests.length,
    leaveByMonth: store.leaveRequests.reduce((acc, i) => {
      const k = new Date(i.fromDate).toLocaleString("en-US", { month: "short" });
      acc[k] = (acc[k] || 0) + 1;
      return acc;
    }, {}),
    feedbackRatings: store.feedback.reduce((acc, i) => {
      const k = String(i.rating);
      acc[k] = (acc[k] || 0) + 1;
      return acc;
    }, {}),
    foodRatings: avgRating,
    pendingGatePass: store.gatePasses.filter((i) => i.status === "Pending").length,
  });
});

app.get("/api/admin/overview", requireAdmin, (req, res) => {
  const store = readStore();
  res.json({
    complaints:    store.complaints,
    gatePasses:    store.gatePasses.map((i) => ({ ...i, approvalLink: createParentApprovalLink(req, "gatepass", i.approvalToken) })),
    leaveRequests: store.leaveRequests.map((i) => ({ ...i, approvalLink: createParentApprovalLink(req, "leave", i.approvalToken) })),
    roomSwaps:     store.roomSwaps,
    feedback:      store.feedback,
    messMenu:      store.messMenu,
    holidays:      store.holidays,
  });
});

app.get("/api/users", requireAdmin, (req, res) => {
  const store = readStore();
  res.json(store.students.map((s) => sanitizeUser(s)));
});

/* ══════════════════════════════════════════════════════════════
   EXPORT ROUTES
══════════════════════════════════════════════════════════════ */
function buildXlsx(sheetsMap) {
  const wb = XLSX.utils.book_new();
  for (const [name, rows] of Object.entries(sheetsMap)) {
    const ws = XLSX.utils.json_to_sheet(rows.length ? rows : [{}]);
    XLSX.utils.book_append_sheet(wb, ws, name.slice(0, 31));
  }
  return XLSX.write(wb, { type: "buffer", bookType: "xlsx" });
}

function sendXlsx(res, filename, sheetsMap) {
  const buf = buildXlsx(sheetsMap);
  res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
  res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
  res.send(buf);
}

app.get("/api/export/users", requireAdmin, (req, res) => {
  const store = readStore();
  const rows = store.students.map((s) => ({
    "User ID": s.userId, "Name": s.name, "Role": s.role,
    "Room Number": s.roomNumber || "", "Block": s.block || "",
    "Parent Phone": s.parentPhone || "", "Parent Email": s.parentEmail || "",
  }));
  sendXlsx(res, "users.xlsx", { "Students": rows });
});

app.get("/api/export/complaints", requireAdmin, (req, res) => {
  const store = readStore();
  const rows = store.complaints.map((c) => ({
    "ID": c.id, "Student Name": c.studentName || "", "Room": c.roomNumber,
    "Type": c.complaintType, "Description": c.issueDescription,
    "Priority": c.priority || "", "Status": c.status,
    "Assurance Date": c.assuranceDate || "", "Escalated": c.escalated ? "Yes" : "No",
    "Created At": c.createdAt,
  }));
  sendXlsx(res, "complaints.xlsx", { "Complaints": rows });
});

app.get("/api/export/gatepass", requireAdmin, (req, res) => {
  const store = readStore();
  const rows = store.gatePasses.map((g) => ({
    "ID": g.id, "Student Name": g.studentName, "Room": g.roomNumber,
    "Out Time": g.outTime, "Return Time": g.returnTime, "Reason": g.reason,
    "Parent Phone": g.parentPhone || "", "Parent Approval": g.parentApproval,
    "Admin Approval": g.adminApproval, "Status": g.status, "Created At": g.createdAt,
  }));
  sendXlsx(res, "gatepass.xlsx", { "Gate Passes": rows });
});

app.get("/api/export/leave", requireAdmin, (req, res) => {
  const store = readStore();
  const rows = store.leaveRequests.map((l) => ({
    "ID": l.id, "Student Name": l.studentName, "Room": l.roomNumber,
    "From": l.fromDate, "To": l.toDate, "Reason": l.reason,
    "Parent Phone": l.parentPhone || "", "Parent Approval": l.parentApproval,
    "Admin Approval": l.adminApproval, "Status": l.status, "Created At": l.createdAt,
  }));
  sendXlsx(res, "leave-requests.xlsx", { "Leave Requests": rows });
});

app.get("/api/export/full-report", requireAdmin, (req, res) => {
  const store = readStore();
  const students = store.students.map((s) => ({
    "User ID": s.userId, "Name": s.name, "Room": s.roomNumber || "",
    "Block": s.block || "", "Parent Phone": s.parentPhone || "", "Parent Email": s.parentEmail || "",
  }));
  const complaints = store.complaints.map((c) => ({
    "ID": c.id, "Student": c.studentName || "", "Room": c.roomNumber,
    "Type": c.complaintType, "Priority": c.priority || "", "Status": c.status,
    "Assurance Date": c.assuranceDate || "", "Created": c.createdAt,
  }));
  const gatePasses = store.gatePasses.map((g) => ({
    "ID": g.id, "Student": g.studentName, "Room": g.roomNumber,
    "Out": g.outTime, "Return": g.returnTime, "Status": g.status, "Created": g.createdAt,
  }));
  const leaves = store.leaveRequests.map((l) => ({
    "ID": l.id, "Student": l.studentName, "Room": l.roomNumber,
    "From": l.fromDate, "To": l.toDate, "Reason": l.reason,
    "Parent": l.parentApproval, "Admin": l.adminApproval, "Status": l.status,
  }));
  const roomSwaps = store.roomSwaps.map((r) => ({
    "ID": r.id, "Student": r.studentName || "", "From Room": r.currentRoomNumber,
    "To Room": r.requestedRoomNumber, "Reason": r.reason, "Status": r.status,
  }));
  const feedback = store.feedback.map((f) => ({
    "ID": f.id, "Rating": f.rating, "Comment": f.comment, "Date": f.createdAt,
  }));
  sendXlsx(res, "full-report.xlsx", {
    "Students": students, "Complaints": complaints, "Gate Passes": gatePasses,
    "Leave Requests": leaves, "Room Swaps": roomSwaps, "Feedback": feedback,
  });
});

app.get("/", (req, res) => res.sendFile(path.join(FRONTEND_DIR, "index.html")));

/* ══════════════════════════════════════════════════════════════
   SERVER START
══════════════════════════════════════════════════════════════ */
app.listen(PORT, () => console.log(`Smart Hostel server running on http://localhost:${PORT}`));

/* ── Escalation cron job (hourly) ── */
const cron = require("node-cron");
cron.schedule("0 * * * *", async () => {
  const escalationEmail = process.env.ESCALATION_EMAIL;
  if (!escalationEmail || !process.env.SMTP_HOST) return;
  const store = readStore();
  const now = new Date();
  let changed = false;
  for (const c of store.complaints) {
    if (c.status !== "Resolved" && c.assuranceDate && new Date(c.assuranceDate) < now && !c.escalated) {
      try {
        await transporter.sendMail({
          from: process.env.SMTP_USER,
          to: escalationEmail,
          subject: `[Escalation] Complaint ${c.id} overdue`,
          text: `Complaint ID: ${c.id}\nType: ${c.complaintType}\nRoom: ${c.roomNumber}\nDescription: ${c.issueDescription}\nAssurance Date (missed): ${c.assuranceDate}`,
        });
        c.escalated = true;
        changed = true;
      } catch (err) {
        console.error("[Escalation] Failed for", c.id, err.message);
      }
    }
  }
  if (changed) writeStore(store);
});
