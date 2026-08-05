/* ============================================================
   Smart Hostel Management System — script.js
   ============================================================ */

const page = document.body.dataset.page;

/* ── Utilities ── */
function getSession() {
  return JSON.parse(localStorage.getItem("smartHostelUser") || "null");
}

function setMessage(id, message, isError = false) {
  const node = document.getElementById(id);
  if (!node) return;
  node.textContent = message;
  node.style.color = isError ? "#fda4af" : "#6ee7b7";
}

function statusClass(status) {
  const s = String(status).toLowerCase();
  if (s.includes("approved") || s.includes("resolved") || s.includes("accepted")) return "status-approved";
  if (s.includes("reject")) return "status-rejected";
  if (s.includes("progress")) return "status-progress";
  return "status-pending";
}

function formatDate(value) {
  if (!value) return "-";
  return new Date(value).toLocaleDateString("en-US", { day: "numeric", month: "short", year: "numeric" });
}

async function api(url, options = {}) {
  const session = getSession();
  const headers = { "Content-Type": "application/json", ...options.headers };
  if (session?.userId) headers["x-user-id"] = session.userId;
  const res = await fetch(url, { ...options, headers });
  const data = await res.json();
  if (!res.ok) {
    if (res.status === 401) { window.location.href = "login.html"; return; }
    throw new Error(data.message || "Request failed");
  }
  return data;
}

function requireSession(role) {
  const session = getSession();
  if (!session || (role && session.role !== role)) {
    window.location.href = "login.html";
    return null;
  }
  return session;
}

function cardItem(title, lines, status, extra = "") {
  return `
    <article class="feed-item">
      <h3>${title}</h3>
      ${lines.map(l => `<p>${l}</p>`).join("")}
      <span class="badge ${statusClass(status)}">${status}</span>
      ${extra}
    </article>`;
}

function approvalLinkBlock(item) {
  if (!item.approvalLink) return "";
  return `<div class="link-card compact-link-card"><p>Parent Approval Link</p>
    <a href="${item.approvalLink}" target="_blank" rel="noreferrer">Open approval page</a></div>`;
}

/* ── Landing ── */
async function initLanding() {
  const btn = document.getElementById("moveInBtn");
  const door = document.getElementById("portalDoor");
  btn?.addEventListener("click", () => {
    door.classList.add("open");
    setTimeout(() => { window.location.href = "login.html"; }, 900);
  });
}

/* ── Login ── */
async function initLogin() {
  localStorage.removeItem("smartHostelUser");
  // Pre-fill selectedBlock from localStorage
  const block = localStorage.getItem("selectedBlock") || "";
  const blockInput = document.getElementById("selectedBlockInput");
  if (blockInput) blockInput.value = block;

  document.getElementById("loginForm")?.addEventListener("submit", async (e) => {
    e.preventDefault();
    const payload = Object.fromEntries(new FormData(e.target).entries());
    if (!payload.selectedBlock) payload.selectedBlock = localStorage.getItem("selectedBlock") || "";
    try {
      const result = await api("/api/login", {
        method: "POST",
        body: JSON.stringify(payload),
      });
      localStorage.setItem("smartHostelUser", JSON.stringify(result.user));
      window.location.href = result.role === "admin" ? "admin.html" : "dashboard.html";
    } catch (err) {
      setMessage("loginMessage", err.message, true);
    }
  });
}

/* ── Student header ── */
async function fillStudentHeader() {
  const session = requireSession("student");
  if (!session) return null;
  const user = await api(`/api/me/${session.userId}`);
  const g = document.getElementById("studentGreeting");
  const r = document.getElementById("studentRoom");
  if (g) g.textContent = `Welcome back, ${user.name}`;
  if (r) r.textContent = user.roomNumber;
  return user;
}

async function initStudentDashboard() { await fillStudentHeader(); }

/* ── Auto-fill helper ── */
function autoFill(user) {
  const fields = {
    studentName: user.name, cStudentName: user.name, lStudentName: user.name,
    roomNumber: user.roomNumber, cRoomNumber: user.roomNumber, lRoomNumber: user.roomNumber,
    rsCurrentRoom: user.roomNumber,
  };
  Object.entries(fields).forEach(([id, val]) => {
    const el = document.getElementById(id);
    if (el) { el.value = val; el.readOnly = true; el.style.opacity = "0.7"; el.style.cursor = "not-allowed"; }
  });
}

/* ── Mess Menu ── */
async function initMessMenu() {
  requireSession("student");
  const data = await api("/api/mess-menu");
  const menu = data.menu || data; // handle both shapes
  const icons = { Monday:"🌅", Tuesday:"🌤", Wednesday:"⛅", Thursday:"🌥", Friday:"🎉", Saturday:"🌟", Sunday:"☀️" };

  if (!menu.length) {
    document.getElementById("menuTableBody").innerHTML =
      '<tr><td colspan="4" style="text-align:center;color:var(--muted);padding:32px;">No menu available yet.</td></tr>';
    return;
  }

  document.getElementById("menuTableBody").innerHTML = menu.map(item => `
    <tr>
      <td>
        <span style="margin-right:8px;">${icons[item.day] || "🍽"}</span>
        <strong style="font-family:'Cinzel',serif;color:#c4b5fd;">${item.day}</strong>
      </td>
      <td>${item.breakfast || "—"}</td>
      <td>${item.lunch || "—"}</td>
      <td>${item.dinner || "—"}</td>
    </tr>`).join("");

  // Show last updated timestamp if element exists
  const tsEl = document.getElementById("menuLastUpdatedStudent");
  if (tsEl) {
    tsEl.textContent = data.lastUpdated
      ? "Last updated: " + new Date(data.lastUpdated).toLocaleString("en-IN", { dateStyle:"medium", timeStyle:"short" })
      : "Never updated via Excel";
  }
}

/* ── Complaints ── */
async function initComplaint() {
  const user = await fillStudentHeader();
  if (user) autoFill(user);

  async function load() {
    const list = await api("/api/complaints");
    const filtered = list.filter(i => !user || i.roomNumber === user.roomNumber || i.studentName === user.name);
    const priorityLabel = (p) => p ? ` · P${p}` : "";
    const priorityColor = (p) => p >= 4 ? "#fda4af" : p >= 3 ? "#fbbf24" : "#6ee7b7";
    document.getElementById("complaintList").innerHTML = filtered.map(i => `
      <article class="feed-item">
        <h3>${i.complaintType} Complaint</h3>
        <p>Room ${i.roomNumber}${i.studentName ? " · " + i.studentName : ""}${i.priority ? ` · <span style="color:${priorityColor(i.priority)}">Priority ${i.priority}</span>` : ""}</p>
        <p>${i.issueDescription}</p>
        ${i.assuranceDate ? `<p style="font-size:0.8rem;color:var(--muted);">📅 Assurance: ${formatDate(i.assuranceDate)}</p>` : ""}
        <span class="badge ${statusClass(i.status)}">${i.status}</span>
      </article>`).join("") || '<div class="empty-state"><div class="empty-icon">🛠</div><p>No complaints yet.</p></div>';
  }

  document.getElementById("complaintForm")?.addEventListener("submit", async (e) => {
    e.preventDefault();
    try {
      const r = await api("/api/complaints", { method: "POST", body: JSON.stringify(Object.fromEntries(new FormData(e.target).entries())) });
      setMessage("complaintMessage", r.message);
      e.target.reset();
      if (user) autoFill(user);
      load();
    } catch (err) { setMessage("complaintMessage", err.message, true); }
  });
  load();
}

/* ── Gate Pass (student) ── */
async function initGatePass() {
  const user = await fillStudentHeader();

  // Auto-fill student name and room from session
  if (user) {
    const nameInput = document.querySelector('[name="studentName"]');
    const roomInput = document.querySelector('[name="roomNumber"]');
    if (nameInput) { nameInput.value = user.name; nameInput.readOnly = true; }
    if (roomInput) { roomInput.value = user.roomNumber; roomInput.readOnly = true; }
  }

  async function load() {
    const list = await api("/api/gatepass");
    document.getElementById("gatepassList").innerHTML = list
      .filter(i => !user || i.studentName === user.name)
      .map(i => `
        <article class="feed-item">
          <div style="display:flex;justify-content:space-between;align-items:flex-start;flex-wrap:wrap;gap:8px;">
            <div>
              <h3 style="margin:0 0 4px;">${i.studentName}</h3>
              <p style="margin:0;font-size:0.8rem;color:var(--muted);">ID: ${i.id} · ${formatDate(i.createdAt)}</p>
            </div>
            <span class="badge ${statusClass(i.status)}">${i.status}</span>
          </div>
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin:10px 0;">
            <div style="background:rgba(255,255,255,0.03);border:1px solid var(--line);border-radius:10px;padding:10px;">
              <div style="font-size:0.7rem;text-transform:uppercase;letter-spacing:0.08em;color:var(--muted);margin-bottom:3px;">Out Time</div>
              <div style="font-size:0.88rem;font-weight:600;">${i.outTime ? new Date(i.outTime).toLocaleString([],{dateStyle:"short",timeStyle:"short"}) : "—"}</div>
            </div>
            <div style="background:rgba(255,255,255,0.03);border:1px solid var(--line);border-radius:10px;padding:10px;">
              <div style="font-size:0.7rem;text-transform:uppercase;letter-spacing:0.08em;color:var(--muted);margin-bottom:3px;">Return</div>
              <div style="font-size:0.88rem;font-weight:600;">${i.returnTime ? new Date(i.returnTime).toLocaleString([],{dateStyle:"short",timeStyle:"short"}) : "—"}</div>
            </div>
          </div>
          <p style="margin:0 0 8px;font-size:0.88rem;color:var(--muted);">📋 ${i.reason}</p>
          <div style="display:flex;flex-wrap:wrap;gap:6px;">
            <span class="badge ${statusClass(i.parentApproval||'Pending')}">Parent: ${i.parentApproval||"Pending"}</span>
            <span class="badge ${statusClass(i.adminApproval||'Pending')}">Admin: ${i.adminApproval||"Pending"}</span>
          </div>
          ${i.qrCode ? `<div class="qr-card" style="margin-top:12px;"><p>🎫 Your Digital Gate Pass</p><img src="${i.qrCode}" alt="Gate pass QR code"></div>` : ""}
        </article>`
      ).join("") || '<div class="empty-state"><div class="empty-icon">🚪</div><p>No gate pass requests yet.</p></div>';
  }

  document.getElementById("gatepassForm")?.addEventListener("submit", async (e) => {
    e.preventDefault();
    try {
      const r = await api("/api/gatepass", { method: "POST", body: JSON.stringify(Object.fromEntries(new FormData(e.target).entries())) });
      setMessage("gatepassMessage", r.message);
      e.target.reset();
      // Re-fill after reset
      if (user) {
        const nameInput = document.querySelector('[name="studentName"]');
        const roomInput = document.querySelector('[name="roomNumber"]');
        if (nameInput) nameInput.value = user.name;
        if (roomInput) roomInput.value = user.roomNumber;
      }
      load();
    } catch (err) { setMessage("gatepassMessage", err.message, true); }
  });

  load();
}

/* ── Leave (student) ── */
async function initLeave() {
  const user = await fillStudentHeader();
  if (user) autoFill(user);

  async function load() {
    const list = await api("/api/leave");
    document.getElementById("leaveTable").innerHTML = list
      .filter(i => !user || i.studentName === user.name)
      .map(i => `<tr>
        <td>${i.fromDate}</td><td>${i.toDate}</td><td>${i.reason}</td>
        <td><span class="badge ${statusClass(i.parentApproval || 'Pending')}">${i.parentApproval || "Pending"}</span></td>
        <td><span class="badge ${statusClass(i.status)}">${i.status}</span></td>
      </tr>`).join("");
  }
  document.getElementById("leaveForm")?.addEventListener("submit", async (e) => {
    e.preventDefault();
    try {
      const r = await api("/api/leave", { method: "POST", body: JSON.stringify(Object.fromEntries(new FormData(e.target).entries())) });
      setMessage("leaveMessage", r.message);
      e.target.reset();
      if (user) autoFill(user);
      load();
    } catch (err) { setMessage("leaveMessage", err.message, true); }
  });
  load();
}

/* ── Room Swap (student) ── */
async function initRoomSwap() {
  const user = await fillStudentHeader();
  if (user) autoFill(user);

  async function load() {
    const list = await api("/api/room-swap");
    document.getElementById("roomSwapList").innerHTML = list
      .filter(i => !user || i.currentRoomNumber === user.roomNumber)
      .map(i => cardItem(`${i.currentRoomNumber} → ${i.requestedRoomNumber}`, [i.reason], i.status))
      .join("") || '<div class="empty-state"><div class="empty-icon">🛏</div><p>No swap requests yet.</p></div>';
  }
  document.getElementById("roomSwapForm")?.addEventListener("submit", async (e) => {
    e.preventDefault();
    try {
      const r = await api("/api/room-swap", { method: "POST", body: JSON.stringify(Object.fromEntries(new FormData(e.target).entries())) });
      setMessage("roomSwapMessage", r.message);
      e.target.reset();
      if (user) autoFill(user);
      load();
    } catch (err) { setMessage("roomSwapMessage", err.message, true); }
  });
  load();
}

/* ── Feedback (student) ── */
async function initFeedback() {
  await fillStudentHeader();
  async function load() {
    const list = await api("/api/feedback");
    const s = r => "★".repeat(r) + "☆".repeat(5 - r);
    document.getElementById("feedbackList").innerHTML = list.slice(0, 6).map(i => `
      <article class="feed-item">
        <div style="color:#fbbf24;font-size:1.1rem;margin-bottom:6px;">${s(i.rating)}</div>
        <h3 style="font-size:0.95rem;">${i.rating}/5 Rating</h3>
        <p>${i.comment}</p>
        <p style="font-size:0.78rem;">${formatDate(i.createdAt)}</p>
      </article>`).join("") || '<div class="empty-state"><div class="empty-icon">💬</div><p>No feedback yet.</p></div>';
  }
  document.getElementById("feedbackForm")?.addEventListener("submit", async (e) => {
    e.preventDefault();
    const payload = Object.fromEntries(new FormData(e.target).entries());
    if (!payload.rating) { setMessage("feedbackMessage", "Please select a star rating.", true); return; }
    try {
      const r = await api("/api/feedback", { method: "POST", body: JSON.stringify(payload) });
      setMessage("feedbackMessage", r.message);
      e.target.reset();
      document.querySelectorAll(".star-btn").forEach(s => s.classList.remove("active"));
      const rl = document.getElementById("ratingLabel");
      const ri = document.getElementById("ratingInput");
      if (rl) rl.textContent = "Click a star to rate";
      if (ri) ri.value = "";
      load();
    } catch (err) { setMessage("feedbackMessage", err.message, true); }
  });
  load();
}

/* ── Holidays (student) ── */
async function initHolidays() {
  requireSession("student");
  const list = await api("/api/holidays");
  const icons = ["🎉","🏖","🎊","🌸","🎆","🏛","🎭","🌺","🎪","🎈"];
  document.getElementById("holidayGrid").innerHTML = list.map((item, i) => `
    <article class="feature-card" style="min-height:auto;">
      <div class="card-icon">${icons[i % icons.length]}</div>
      <h3>${item.holidayName}</h3>
      <span style="display:inline-flex;padding:4px 10px;border-radius:999px;font-size:0.75rem;background:var(--accent-soft);color:#c4b5fd;margin-bottom:4px;">${formatDate(item.holidayDate)}</span>
      <p>${item.description}</p>
    </article>`).join("") || '<div class="empty-state"><div class="empty-icon">📅</div><p>No holidays listed yet.</p></div>';
  document.getElementById("holidayTable").innerHTML = list.map(item => `
    <tr><td>${item.holidayName}</td><td>${formatDate(item.holidayDate)}</td><td>${item.description}</td></tr>`).join("");
}

/* ── Chart helper ── */
function renderChart(id, type, labels, data, colors) {
  if (!window.Chart) return;
  const canvas = document.getElementById(id);
  if (!canvas) return;
  new Chart(canvas, {
    type,
    data: { labels, datasets: [{ data, label: "Count", backgroundColor: colors, borderRadius: type === "bar" ? 10 : 0 }] },
    options: {
      responsive: true,
      plugins: { legend: { labels: { color: "#e5e7eb" } } },
      scales: type === "bar" ? {
        x: { ticks: { color: "#e5e7eb" }, grid: { color: "rgba(255,255,255,0.05)" } },
        y: { ticks: { color: "#e5e7eb", precision: 0 }, grid: { color: "rgba(255,255,255,0.05)" } },
      } : {},
    },
  });
}

/* ── Admin helpers ── */
async function getAdminOverview() {
  requireSession("admin");
  return Promise.all([api("/api/admin/stats"), api("/api/admin/overview")]);
}

function bindAdminActions(overview) {
  document.body.addEventListener("click", async (e) => {
    const btn = e.target.closest("button");
    if (!btn) return;
    try {
      if (btn.dataset.complaint) {
        await api(`/api/complaints/${btn.dataset.complaint}`, { method: "PATCH", body: JSON.stringify({ status: btn.dataset.status }) });
        window.location.reload();
      }
      if (btn.dataset.gatepass) {
        await api(`/api/gatepass/${btn.dataset.gatepass}/status`, { method: "PATCH", body: JSON.stringify({ status: btn.dataset.status }) });
        window.location.reload();
      }
      if (btn.dataset.leave) {
        await api(`/api/leave/${btn.dataset.leave}`, { method: "PATCH", body: JSON.stringify({ status: btn.dataset.status }) });
        window.location.reload();
      }
      if (btn.dataset.roomswap) {
        await api(`/api/room-swap/${btn.dataset.roomswap}`, { method: "PATCH", body: JSON.stringify({ status: btn.dataset.status }) });
        window.location.reload();
      }
      if (btn.dataset.holidayEdit) {
        const item = overview.holidays.find(h => h.id === btn.dataset.holidayEdit);
        const form = document.getElementById("holidayForm");
        if (item && form) {
          form.elements.namedItem("id").value = item.id;
          form.elements.namedItem("holidayName").value = item.holidayName;
          form.elements.namedItem("holidayDate").value = item.holidayDate;
          form.elements.namedItem("description").value = item.description;
        }
      }
      if (btn.dataset.holidayDelete) {
        await api(`/api/holidays/${btn.dataset.holidayDelete}`, { method: "DELETE" });
        window.location.reload();
      }
    } catch (err) { alert(err.message); }
  }, { once: true });
}

/* ── Modal helpers ── */
function openModal(title, headers, rows) {
  document.getElementById("modalTitle").textContent = title;
  document.getElementById("modalThead").innerHTML = `<tr>${headers.map(h => `<th>${h}</th>`).join("")}</tr>`;
  document.getElementById("modalTbody").innerHTML = rows.length
    ? rows.map(r => `<tr>${r.map(c => `<td>${c ?? "—"}</td>`).join("")}</tr>`).join("")
    : `<tr><td colspan="${headers.length}" style="text-align:center;color:var(--muted);padding:32px;">No data found.</td></tr>`;
  document.getElementById("detailModal").classList.remove("hidden");
  document.body.style.overflow = "hidden";
}

function closeModal() {
  document.getElementById("detailModal").classList.add("hidden");
  document.body.style.overflow = "";
}

/* ── Admin Dashboard ── */
async function initAdminDashboard() {
  const [stats, overview] = await getAdminOverview();

  const cardDefs = [
    {
      title: "Total Students", value: stats.totalStudents, icon: "👥", hint: "Click to view",
      async onClick() {
        const users = await api("/api/users");
        openModal("All Students",
          ["User ID", "Name", "Room", "Block", "Parent Phone"],
          users.map(u => [u.userId, u.name, u.roomNumber || "—", u.block || "—", u.parentPhone || "—"])
        );
      }
    },
    {
      title: "Total Complaints", value: stats.totalComplaints, icon: "🛠", hint: "Click to view",
      onClick() {
        openModal("All Complaints",
          ["ID", "Student", "Room", "Type", "Priority", "Status", "Assurance Date"],
          overview.complaints.map(c => [c.id, c.studentName || "—", c.roomNumber, c.complaintType, c.priority || "—",
            c.status, c.assuranceDate || "—"])
        );
      }
    },
    {
      title: "Resolved Complaints", value: stats.resolvedComplaints, icon: "✅", hint: "Click to view",
      onClick() {
        const resolved = overview.complaints.filter(c => c.status === "Resolved");
        openModal("Resolved Complaints",
          ["ID", "Student", "Room", "Type", "Priority"],
          resolved.map(c => [c.id, c.studentName || "—", c.roomNumber, c.complaintType, c.priority || "—"])
        );
      }
    },
    {
      title: "Leave Applications", value: stats.leaveRequests, icon: "🗓", hint: "Click to view",
      onClick() {
        openModal("Leave Requests",
          ["ID", "Student", "Room", "From", "To", "Reason", "Parent", "Status"],
          overview.leaveRequests.map(l => [l.id, l.studentName, l.roomNumber, l.fromDate, l.toDate,
            l.reason, l.parentApproval, l.status])
        );
      }
    },
    {
      title: "Pending Gate Pass", value: stats.pendingGatePass, icon: "🚪", hint: "Click to view",
      onClick() {
        openModal("Gate Pass Requests",
          ["ID", "Student", "Room", "Out Time", "Return", "Parent", "Admin", "Status"],
          overview.gatePasses.map(g => [g.id, g.studentName, g.roomNumber,
            g.outTime ? new Date(g.outTime).toLocaleString() : "—",
            g.returnTime ? new Date(g.returnTime).toLocaleString() : "—",
            g.parentApproval, g.adminApproval, g.status])
        );
      }
    },
  ];

  document.getElementById("statsGrid").innerHTML = cardDefs.map((c, idx) => `
    <article class="stat-card" id="statCard_${idx}" style="cursor:pointer;">
      <div class="stat-icon">${c.icon}</div>
      <p>${c.title}</p>
      <h3>${c.value}</h3>
      <div class="stat-hint">🔍 ${c.hint}</div>
    </article>`).join("");

  cardDefs.forEach((c, idx) => {
    document.getElementById(`statCard_${idx}`).addEventListener("click", c.onClick);
  });

  renderChart("complaintChart", "pie",
    ["Pending", "In Progress", "Resolved"],
    [stats.complaintStatus.pending, stats.complaintStatus.inProgress, stats.complaintStatus.resolved],
    ["#f59e0b", "#60a5fa", "#34d399"]);

  const leaveLabels = Object.keys(stats.leaveByMonth).length ? Object.keys(stats.leaveByMonth) : ["No Data"];
  const leaveValues = Object.keys(stats.leaveByMonth).length ? Object.values(stats.leaveByMonth) : [0];
  renderChart("leaveChart", "bar", leaveLabels, leaveValues, ["#7c3aed"]);

  const fbLabels = ["1","2","3","4","5"];
  renderChart("feedbackChart", "bar", fbLabels, fbLabels.map(l => stats.feedbackRatings[l] || 0),
    ["#fb7185","#f97316","#f59e0b","#60a5fa","#34d399"]);

  const rows = [
    ...overview.complaints.map(i => ({ type:"Complaint", ref:i.id, details:`${i.complaintType} · Room ${i.roomNumber}`, status:i.status, at:i.createdAt })),
    ...overview.gatePasses.map(i => ({ type:"Gate Pass", ref:i.id, details:`${i.studentName} · Parent: ${i.parentApproval}`, status:i.status, at:i.createdAt })),
    ...overview.leaveRequests.map(i => ({ type:"Leave", ref:i.id, details:`${i.studentName} · Parent: ${i.parentApproval}`, status:i.status, at:i.createdAt })),
    ...overview.roomSwaps.map(i => ({ type:"Room Swap", ref:i.id, details:`${i.currentRoomNumber} → ${i.requestedRoomNumber}`, status:i.status, at:i.createdAt })),
  ].sort((a,b) => new Date(b.at) - new Date(a.at)).slice(0, 10);

  document.getElementById("recentActivityTable").innerHTML = rows.map(i => `
    <tr>
      <td>${i.type}</td><td>${i.ref}</td><td>${i.details}</td>
      <td><span class="badge ${statusClass(i.status)}">${i.status}</span></td>
    </tr>`).join("");
}

/* ── Admin Mess ── */
async function initAdminMess() {
  const [, overview] = await getAdminOverview();
  const sel = document.getElementById("menuDaySelect");
  sel.innerHTML = overview.messMenu.map(i => `<option value="${i.day}">${i.day}</option>`).join("");

  // Table view on the right
  document.getElementById("adminMenuTableBody").innerHTML = overview.messMenu.map(i => `
    <tr>
      <td><strong style="font-family:'Cinzel',serif;color:#c4b5fd;">${i.day}</strong></td>
      <td>${i.breakfast}</td>
      <td>${i.lunch}</td>
      <td>${i.dinner}</td>
    </tr>`).join("");

  // Load last updated timestamp
  try {
    const menuData = await api("/api/mess-menu");
    const tsEl = document.getElementById("menuLastUpdated");
    if (tsEl) {
      tsEl.textContent = menuData.lastUpdated
        ? "Last updated: " + new Date(menuData.lastUpdated).toLocaleString("en-IN", { dateStyle:"medium", timeStyle:"short" })
        : "Never updated via Excel";
    }
  } catch (_) {}

  function syncForm(day) {
    const cur = overview.messMenu.find(i => i.day === day) || overview.messMenu[0];
    if (!cur) return;
    const form = document.getElementById("menuUpdateForm");
    form.breakfast.value = cur.breakfast;
    form.lunch.value = cur.lunch;
    form.dinner.value = cur.dinner;
  }
  sel.addEventListener("change", e => syncForm(e.target.value));
  syncForm(sel.value);

  document.getElementById("menuUpdateForm")?.addEventListener("submit", async (e) => {
    e.preventDefault();
    const payload = Object.fromEntries(new FormData(e.target).entries());
    try {
      const r = await api(`/api/mess-menu/${payload.day}`, { method: "PUT", body: JSON.stringify(payload) });
      setMessage("menuMessage", r.message);
      window.location.reload();
    } catch (err) { setMessage("menuMessage", err.message, true); }
  });
}

/* ── Admin Complaints ── */
async function initAdminComplaints() {
  const [, overview] = await getAdminOverview();
  document.getElementById("adminComplaintList").innerHTML = overview.complaints.length
    ? overview.complaints.map(i => {
        const isOverdue = i.assuranceDate && new Date(i.assuranceDate) < new Date() && i.status !== "Resolved";
        const pColor = i.priority >= 4 ? "#fda4af" : i.priority >= 3 ? "#fbbf24" : "#6ee7b7";
        return `
        <article class="feed-item">
          <div style="display:flex;justify-content:space-between;align-items:flex-start;flex-wrap:wrap;gap:8px;">
            <div>
              <h3 style="margin:0 0 4px;">${i.complaintType} Complaint ${isOverdue ? '<span class="badge status-rejected" style="margin-left:6px;font-size:0.7rem;">⚠ Overdue</span>' : ""}</h3>
              <p style="margin:0;font-size:0.8rem;color:var(--muted);">ID: ${i.id} · Room ${i.roomNumber}${i.studentName ? " · " + i.studentName : ""}${i.priority ? ` · <span style="color:${pColor}">P${i.priority}</span>` : ""}</p>
            </div>
            <span class="badge ${statusClass(i.status)}">${i.status}</span>
          </div>
          <p style="margin:10px 0 8px;font-size:0.88rem;color:var(--muted);">${i.issueDescription}</p>
          ${i.assuranceDate ? `<p style="font-size:0.8rem;color:${isOverdue ? "#fda4af" : "var(--muted)"};margin:0 0 10px;">📅 Assurance: ${formatDate(i.assuranceDate)}</p>` : ""}
          <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:10px;">
            <label style="font-size:0.8rem;color:var(--muted);">Set Assurance Date:</label>
            <input type="date" id="ad_${i.id}" value="${i.assuranceDate || ""}" style="padding:6px 10px;border-radius:10px;font-size:0.8rem;width:auto;">
            <button class="action-btn secondary-btn" style="padding:6px 12px;font-size:0.78rem;" onclick="setAssuranceDate('${i.id}')">📅 Set</button>
          </div>
          <div class="action-row">
            <button class="action-btn secondary-btn" data-complaint="${i.id}" data-status="In Progress">⏳ In Progress</button>
            <button class="action-btn" data-complaint="${i.id}" data-status="Resolved">✅ Resolve</button>
          </div>
        </article>`;
      }).join("")
    : '<div class="empty-state"><div class="empty-icon">🛠</div><p>No complaints yet.</p></div>';
  bindAdminActions(overview);
}

async function setAssuranceDate(id) {
  const el = document.getElementById(`ad_${id}`);
  if (!el || !el.value) { alert("Please select a date first."); return; }
  try {
    await api(`/api/complaints/${id}`, { method: "PATCH", body: JSON.stringify({ assuranceDate: el.value }) });
    window.location.reload();
  } catch (err) { alert(err.message); }
}

/* ── IVR Simulated Call Screen ── */
// Populate parent phone in the call screen
function ivrSetParentPhone(phone) {
  const el = document.getElementById("ivrParentPhone");
  if (el) el.textContent = phone || "—";
}
let _ivrTimer = null;
let _ivrSecs = 0;
let _ivrId = null;
let _ivrDone = false;

function _ivrFmt(s) {
  return `${String(Math.floor(s/60)).padStart(2,"0")}:${String(s%60).padStart(2,"0")}`;
}

function ivrOpen(gp) {
  _ivrId = gp.id;
  _ivrDone = false;

  document.getElementById("ivrStudentName").textContent = gp.studentName || "—";
  document.getElementById("ivrRoomNumber").textContent = gp.roomNumber || "—";
  document.getElementById("ivrStudentSub").textContent = `Gate Pass · Room ${gp.roomNumber}`;
  ivrSetParentPhone(gp.parentPhone);
  document.getElementById("ivrOutTime").textContent = gp.outTime
    ? new Date(gp.outTime).toLocaleTimeString([], { hour:"2-digit", minute:"2-digit" }) : "—";
  document.getElementById("ivrReturnTime").textContent = gp.returnTime
    ? new Date(gp.returnTime).toLocaleTimeString([], { hour:"2-digit", minute:"2-digit" }) : "—";

  document.getElementById("ivrKeypad").style.display = "grid";
  document.getElementById("ivrResult").classList.remove("visible");
  document.getElementById("ivrStatusText").textContent = "Call Connected";
  document.getElementById("ivrTimer").style.color = "#6ee7b7";
  document.getElementById("ivrKey1").disabled = false;
  document.getElementById("ivrKey2").disabled = false;
  document.getElementById("ivrOverlay").classList.remove("hidden");
  document.body.style.overflow = "hidden";

  _ivrSecs = 0;
  clearInterval(_ivrTimer);
  _ivrTimer = setInterval(() => {
    _ivrSecs++;
    const el = document.getElementById("ivrTimer");
    if (el) el.textContent = _ivrFmt(_ivrSecs);
  }, 1000);
}

function ivrClose() {
  clearInterval(_ivrTimer);
  document.getElementById("ivrOverlay").classList.add("hidden");
  document.body.style.overflow = "";
  if (_ivrDone) window.location.reload();
}

async function ivrPress(key) {
  if (!_ivrId || _ivrDone) return;

  // DTMF flash
  const flash = document.getElementById("ivrFlash");
  if (flash) { flash.classList.add("flash"); setTimeout(() => flash.classList.remove("flash"), 120); }

  document.getElementById("ivrKey1").disabled = true;
  document.getElementById("ivrKey2").disabled = true;
  document.getElementById("ivrStatusText").textContent = "Processing…";
  clearInterval(_ivrTimer);

  try {
    await api(`/api/gatepass/${_ivrId}/ivr`, { method: "POST", body: JSON.stringify({ key }) });
    _ivrDone = true;
    const approved = key === "1";
    document.getElementById("ivrKeypad").style.display = "none";
    document.getElementById("ivrResultIcon").textContent = approved ? "✅" : "❌";
    document.getElementById("ivrResultTitle").textContent = approved ? "Gate Pass Approved" : "Gate Pass Rejected";
    document.getElementById("ivrResultSub").textContent = approved
      ? "Parent verification accepted. QR code generated for the student."
      : "Parent rejected the request. Gate pass has been denied.";
    document.getElementById("ivrResult").classList.add("visible");
    document.getElementById("ivrStatusText").textContent = "Call Ended";
    document.getElementById("ivrTimer").style.color = approved ? "#6ee7b7" : "#fda4af";
    setTimeout(() => ivrClose(), 3000);
  } catch (err) {
    document.getElementById("ivrStatusText").textContent = "Error — try again";
    document.getElementById("ivrKey1").disabled = false;
    document.getElementById("ivrKey2").disabled = false;
    _ivrTimer = setInterval(() => {
      _ivrSecs++;
      const el = document.getElementById("ivrTimer");
      if (el) el.textContent = _ivrFmt(_ivrSecs);
    }, 1000);
  }
}

async function ivrLaunch(id) {
  try {
    // 1. Fetch gate pass details (also resolves parentPhone from student record)
    const gp = await api(`/api/gatepass/${id}/ivr`);

    // 2. Initiate the call (simulated or real Twilio)
    try {
      const callResult = await api(`/api/gatepass/${id}/call`, { method: "POST" });
      console.log(`[IVR] Call initiated — mode: ${callResult.mode}, SID: ${callResult.callSid}`);
      // Update parentPhone if resolved server-side
      if (callResult.gatePass?.parentPhone) gp.parentPhone = callResult.gatePass.parentPhone;
    } catch (callErr) {
      // Non-fatal — still open the screen so admin can manually record response
      console.warn("[IVR] Call initiation warning:", callErr.message);
    }

    // 3. Open the in-browser IVR screen
    ivrOpen(gp);
  } catch (err) {
    alert("Could not load gate pass: " + err.message);
  }
}

// Close on backdrop click
document.addEventListener("DOMContentLoaded", () => {
  document.getElementById("ivrOverlay")?.addEventListener("click", (e) => {
    if (e.target === document.getElementById("ivrOverlay")) ivrClose();
  });
});

/* ── Admin Gate Pass ── */
async function initAdminGatePass() {
  const [, overview] = await getAdminOverview();

  function stepClass(val, target) {
    if (!val || val === "Pending") return "";
    if (val === "Rejected") return "rejected";
    if (val === target || val === "Accepted" || val === "Approved" || val === "Call Initiated") return "done";
    return "active";
  }

  document.getElementById("adminGatePassList").innerHTML = overview.gatePasses.length
    ? overview.gatePasses.map(item => {
        const canCall = item.status !== "Approved" && item.status !== "Rejected";
        const pv = item.parentVerification || "Pending";
        const pvClass = pv === "Accepted" || pv === "Approved" ? "done"
          : pv === "Rejected" ? "rejected"
          : pv === "Call Initiated" ? "active" : "";

        return `
          <article class="feed-item">
            <div style="display:flex;justify-content:space-between;align-items:flex-start;flex-wrap:wrap;gap:8px;">
              <div>
                <h3 style="margin:0 0 4px;">${item.studentName}</h3>
                <p style="margin:0;font-size:0.8rem;color:var(--muted);">ID: ${item.id} · Submitted ${formatDate(item.createdAt)}</p>
              </div>
              <span class="badge ${statusClass(item.status)}">${item.status}</span>
            </div>

            <!-- Parent phone strip -->
            <div class="phone-strip">
              <span class="ph-icon">📱</span>
              <div>
                <div class="ph-label">Parent Phone</div>
                <div class="ph-num">${item.parentPhone || "Not on record"}</div>
              </div>
            </div>

            <!-- Status timeline -->
            <div class="status-timeline">
              <div class="status-step done">📝 Submitted</div>
              <div class="status-step ${pvClass}">📞 Parent IVR: ${pv}</div>
              <div class="status-step ${stepClass(item.adminApproval, 'Approved')}">🏛 Admin: ${item.adminApproval || "Pending"}</div>
              <div class="status-step ${stepClass(item.status, 'Approved')}">🎫 Final: ${item.status}</div>
            </div>

            <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin:10px 0;">
              <div style="background:rgba(255,255,255,0.03);border:1px solid var(--line);border-radius:10px;padding:10px;">
                <div style="font-size:0.7rem;text-transform:uppercase;letter-spacing:0.08em;color:var(--muted);margin-bottom:3px;">Room</div>
                <div style="font-size:0.9rem;font-weight:600;">${item.roomNumber}</div>
              </div>
              <div style="background:rgba(255,255,255,0.03);border:1px solid var(--line);border-radius:10px;padding:10px;">
                <div style="font-size:0.7rem;text-transform:uppercase;letter-spacing:0.08em;color:var(--muted);margin-bottom:3px;">Out Time</div>
                <div style="font-size:0.9rem;font-weight:600;">${item.outTime ? new Date(item.outTime).toLocaleString([],{dateStyle:"short",timeStyle:"short"}) : "—"}</div>
              </div>
              <div style="background:rgba(255,255,255,0.03);border:1px solid var(--line);border-radius:10px;padding:10px;">
                <div style="font-size:0.7rem;text-transform:uppercase;letter-spacing:0.08em;color:var(--muted);margin-bottom:3px;">Return</div>
                <div style="font-size:0.9rem;font-weight:600;">${item.returnTime ? new Date(item.returnTime).toLocaleString([],{dateStyle:"short",timeStyle:"short"}) : "—"}</div>
              </div>
              <div style="background:rgba(255,255,255,0.03);border:1px solid var(--line);border-radius:10px;padding:10px;">
                <div style="font-size:0.7rem;text-transform:uppercase;letter-spacing:0.08em;color:var(--muted);margin-bottom:3px;">Reason</div>
                <div style="font-size:0.9rem;font-weight:600;">${item.reason}</div>
              </div>
            </div>

            ${item.qrCode ? `
              <div class="qr-card" style="margin-bottom:12px;">
                <p>🎫 Digital Gate Pass — QR Code</p>
                <img src="${item.qrCode}" alt="Gate pass QR code for ${item.studentName}">
              </div>` : ""}

            <div class="action-row">
              <button class="ivr-trigger-btn" onclick="ivrLaunch('${item.id}')" ${!canCall ? "disabled title='Already finalised'" : "title='Initiate parent phone verification'"}>
                📞 Send Parent Verification
              </button>
              <button class="action-btn" data-gatepass="${item.id}" data-status="Approved">✅ Admin Approve</button>
              <button class="action-btn secondary-btn" data-gatepass="${item.id}" data-status="Rejected">❌ Reject</button>
            </div>

            <div style="margin-top:10px;">
              <a href="${item.approvalLink}" target="_blank" rel="noreferrer" style="font-size:0.82rem;color:#c4b5fd;">🔗 Parent approval link</a>
            </div>
          </article>`;
      }).join("")
    : '<div class="empty-state"><div class="empty-icon">🚪</div><p>No gate pass requests yet.</p></div>';

  bindAdminActions(overview);
}

/* ── Admin Leave ── */
async function initAdminLeave() {
  const [, overview] = await getAdminOverview();
  document.getElementById("adminLeaveList").innerHTML = overview.leaveRequests.length
    ? overview.leaveRequests.map(item => `
      <article class="feed-item">
        <div style="display:flex;justify-content:space-between;align-items:flex-start;flex-wrap:wrap;gap:8px;">
          <div>
            <h3 style="margin:0 0 4px;">${item.studentName}</h3>
            <p style="margin:0;font-size:0.8rem;color:var(--muted);">ID: ${item.id} · Room ${item.roomNumber}</p>
          </div>
          <span class="badge ${statusClass(item.status)}">${item.status}</span>
        </div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin:12px 0;">
          <div style="background:rgba(255,255,255,0.03);border:1px solid var(--line);border-radius:10px;padding:10px;">
            <div style="font-size:0.7rem;text-transform:uppercase;letter-spacing:0.08em;color:var(--muted);margin-bottom:3px;">From</div>
            <div style="font-size:0.9rem;font-weight:600;">${item.fromDate}</div>
          </div>
          <div style="background:rgba(255,255,255,0.03);border:1px solid var(--line);border-radius:10px;padding:10px;">
            <div style="font-size:0.7rem;text-transform:uppercase;letter-spacing:0.08em;color:var(--muted);margin-bottom:3px;">To</div>
            <div style="font-size:0.9rem;font-weight:600;">${item.toDate}</div>
          </div>
        </div>
        <p style="margin:0 0 10px;font-size:0.88rem;color:var(--muted);">📋 ${item.reason}</p>
        <div style="display:flex;flex-wrap:wrap;gap:6px;margin-bottom:12px;">
          <span class="badge ${statusClass(item.parentApproval||'Pending')}">Parent: ${item.parentApproval||"Pending"}</span>
          <span class="badge ${statusClass(item.adminApproval||'Pending')}">Admin: ${item.adminApproval||"Pending"}</span>
        </div>
        <div style="margin-bottom:12px;">
          <a href="${item.approvalLink}" target="_blank" rel="noreferrer" style="font-size:0.82rem;color:#c4b5fd;">🔗 Parent approval link</a>
        </div>
        <div class="action-row">
          <button class="action-btn" data-leave="${item.id}" data-status="Approved">✅ Approve</button>
          <button class="action-btn secondary-btn" data-leave="${item.id}" data-status="Rejected">❌ Reject</button>
        </div>
      </article>`).join("")
    : '<div class="empty-state"><div class="empty-icon">🗓</div><p>No leave requests yet.</p></div>';
  bindAdminActions(overview);
}

/* ── Admin Room Swap ── */
async function initAdminRoomSwap() {
  const [, overview] = await getAdminOverview();
  document.getElementById("adminRoomSwapList").innerHTML = overview.roomSwaps.length
    ? overview.roomSwaps.map(item => `
      <article class="feed-item">
        <div style="display:flex;justify-content:space-between;align-items:flex-start;flex-wrap:wrap;gap:8px;">
          <h3 style="margin:0;">${item.currentRoomNumber} → ${item.requestedRoomNumber}</h3>
          <span class="badge ${statusClass(item.status)}">${item.status}</span>
        </div>
        <p style="margin:10px 0;font-size:0.88rem;color:var(--muted);">📋 ${item.reason}</p>
        <div class="action-row">
          <button class="action-btn" data-roomswap="${item.id}" data-status="Approved">✅ Approve</button>
          <button class="action-btn secondary-btn" data-roomswap="${item.id}" data-status="Rejected">❌ Reject</button>
        </div>
      </article>`).join("")
    : '<div class="empty-state"><div class="empty-icon">🛏</div><p>No room swap requests yet.</p></div>';
  bindAdminActions(overview);
}

/* ── Admin Holidays ── */
async function initAdminHolidays() {
  const [, overview] = await getAdminOverview();
  document.getElementById("adminHolidayList").innerHTML = overview.holidays
    .sort((a,b) => a.holidayDate.localeCompare(b.holidayDate))
    .map(item => `
      <article class="feed-item">
        <div style="display:flex;justify-content:space-between;align-items:flex-start;flex-wrap:wrap;gap:8px;">
          <h3 style="margin:0;">${item.holidayName}</h3>
          <span style="display:inline-flex;padding:4px 10px;border-radius:999px;font-size:0.75rem;background:var(--accent-soft);color:#c4b5fd;">${formatDate(item.holidayDate)}</span>
        </div>
        <p style="margin:8px 0;font-size:0.88rem;color:var(--muted);">${item.description}</p>
        <div class="action-row">
          <button class="action-btn secondary-btn" data-holiday-edit="${item.id}">✏️ Edit</button>
          <button class="action-btn secondary-btn" data-holiday-delete="${item.id}">🗑 Delete</button>
        </div>
      </article>`).join("") || '<div class="empty-state"><div class="empty-icon">📅</div><p>No holidays yet.</p></div>';

  document.getElementById("holidayForm")?.addEventListener("submit", async (e) => {
    e.preventDefault();
    const payload = Object.fromEntries(new FormData(e.target).entries());
    const hid = payload.id;
    delete payload.id;
    try {
      const r = await api(hid ? `/api/holidays/${hid}` : "/api/holidays", {
        method: hid ? "PUT" : "POST",
        body: JSON.stringify(payload),
      });
      setMessage("holidayMessage", r.message);
      window.location.reload();
    } catch (err) { setMessage("holidayMessage", err.message, true); }
  });

  bindAdminActions(overview);
}

/* ── Admin Feedback ── */
async function initAdminFeedback() {
  const [, overview] = await getAdminOverview();
  const s = r => "★".repeat(r) + "☆".repeat(5 - r);
  document.getElementById("adminFeedbackList").innerHTML = overview.feedback.length
    ? overview.feedback.map(item => `
      <article class="feed-item">
        <div style="color:#fbbf24;font-size:1.2rem;margin-bottom:6px;">${s(item.rating)}</div>
        <h3>${item.rating}/5 Rating</h3>
        <p>${item.comment}</p>
        <p style="font-size:0.78rem;color:var(--muted);">${formatDate(item.createdAt)}</p>
      </article>`).join("")
    : '<div class="empty-state"><div class="empty-icon">⭐</div><p>No feedback submitted yet.</p></div>';
}

/* ── Parent Approval ── */
async function initParentApproval() {
  const params = new URLSearchParams(window.location.search);
  const type = params.get("type");
  const token = params.get("token");

  if (!type || !token) {
    setMessage("parentApprovalMessage", "Approval link is invalid.", true);
    document.getElementById("approvalBtns").style.display = "none";
    return;
  }

  try {
    const payload = await api(`/api/parent-approval/${type}/${token}`);
    const req = payload.request;
    document.getElementById("parentApprovalTitle").textContent =
      type === "gatepass" ? "Gate Pass Approval Request" : "Leave Approval Request";

    const isGP = type === "gatepass";
    document.getElementById("parentApprovalDetails").innerHTML = `
      <div class="detail-grid">
        <div class="detail-item"><div class="label">Student Name</div><div class="value">${req.studentName}</div></div>
        <div class="detail-item"><div class="label">Room Number</div><div class="value">${req.roomNumber}</div></div>
        ${isGP ? `
        <div class="detail-item"><div class="label">Out Time</div><div class="value">${new Date(req.outTime).toLocaleString()}</div></div>
        <div class="detail-item"><div class="label">Return Time</div><div class="value">${new Date(req.returnTime).toLocaleString()}</div></div>
        ` : `
        <div class="detail-item"><div class="label">From Date</div><div class="value">${req.fromDate}</div></div>
        <div class="detail-item"><div class="label">To Date</div><div class="value">${req.toDate}</div></div>
        `}
        <div class="detail-item" style="grid-column:1/-1;"><div class="label">Reason</div><div class="value">${req.reason}</div></div>
      </div>
      <div class="message-box" style="display:block;">
        ${isGP ? "Your child has requested a gate pass to leave the hostel premises." : "Your child has applied for hostel leave."}
        Please review the details above and approve or reject the request.
      </div>
      <div style="display:flex;gap:12px;margin-bottom:12px;flex-wrap:wrap;">
        <span class="badge ${statusClass(req.parentApproval||'Pending')}">Parent: ${req.parentApproval||"Pending"}</span>
        <span class="badge ${statusClass(req.adminApproval||'Pending')}">Admin: ${req.adminApproval||"Pending"}</span>
      </div>`;

    async function submit(action) {
      try {
        const r = await api(`/api/parent-approval/${type}/${token}`, { method: "POST", body: JSON.stringify({ action }) });
        setMessage("parentApprovalMessage", r.message);
        document.getElementById("approvalBtns").style.display = "none";
      } catch (err) { setMessage("parentApprovalMessage", err.message, true); }
    }

    document.getElementById("parentApproveBtn")?.addEventListener("click", () => submit("approve"));
    document.getElementById("parentRejectBtn")?.addEventListener("click", () => submit("reject"));
  } catch (err) {
    setMessage("parentApprovalMessage", err.message, true);
    document.getElementById("approvalBtns").style.display = "none";
  }
}

/* ── Page Router ── */
const initializers = {
  landing: initLanding,
  login: initLogin,
  "student-dashboard": initStudentDashboard,
  "mess-menu": initMessMenu,
  complaint: initComplaint,
  gatepass: initGatePass,
  leave: initLeave,
  roomswap: initRoomSwap,
  feedback: initFeedback,
  holidays: initHolidays,
  "admin-dashboard": initAdminDashboard,
  "admin-mess": initAdminMess,
  "admin-complaints": initAdminComplaints,
  "admin-gatepass": initAdminGatePass,
  "admin-leave": initAdminLeave,
  "admin-roomswap": initAdminRoomSwap,
  "admin-holidays": initAdminHolidays,
  "admin-feedback": initAdminFeedback,
  "parent-approval": initParentApproval,
};

if (initializers[page]) {
  initializers[page]().catch(err => console.error("[Hostel]", err));
}
