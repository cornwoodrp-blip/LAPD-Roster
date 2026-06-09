let divisions = ["ONB", "TEU", "AIR", "GIU", "DCI", "CSI"];
let strikes = ["1", "2", "3"];

let rosterData = { roster: [] };
let sessionUser = null;
let selectedEntryId = null;
let selectedApplicationId = null;
let users = [];
let applications = [];
let onboardingCards = [];
let pendingTerminationId = null;
let pendingAcademyCardId = null;
let pendingClearForPatrolId = null;
let activeCategoryFilter = "";
let entryListQuery = "";

const onboardingStages = [
  "Application Pending",
  "Application Accepted",
  "Academy Scheduled",
  "Academy Passed",
  "Ride Alongs Completed",
  "Cleared For Patrol"
];

const rankCategories = [
  {
    name: "High Command",
    ranks: ["Commissioner", "Commisioner", "Chief", "Chief Of Police", "Assistant Chief", "Deputy Chief", "Commander"]
  },
  {
    name: "Command",
    ranks: ["Captain", "Lieutenant"]
  },
  {
    name: "Supervisor",
    ranks: ["Master Sergeant", "Staff Sergeant", "DCI Staff Sergeant", "Staff Sergeant DCI", "Sergeant"]
  },
  {
    name: "Supervisor In Training",
    ranks: ["Corporal"]
  },
  {
    name: "Patrol Officer",
    ranks: ["Senior Officer", "Sr. Officer", "Officer III", "Officer II", "Officer I"]
  },
  {
    name: "Probationary Officer",
    ranks: ["Probationary Officer"]
  },
  {
    name: "Officer In Training",
    ranks: ["Recruit", "Cadet"]
  }
];

const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => Array.from(document.querySelectorAll(selector));

function toast(message) {
  const element = $("#toast");
  element.textContent = message;
  element.classList.add("show");
  setTimeout(() => element.classList.remove("show"), 2200);
}

async function api(path, options = {}) {
  const response = await fetch(path, {
    headers: { "content-type": "application/json", ...(options.headers || {}) },
    ...options
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || "Request failed.");
  return data;
}

function normalize(value) {
  return String(value || "").toLowerCase();
}

function activeDivisions(entry) {
  return divisions.filter((division) => entry.divisions?.[division]);
}

function activeStrikes(entry) {
  return strikes.filter((strike) => entry.strikes?.[strike]);
}

function statusClass(activity) {
  return `status-${normalize(activity).replace(/\s+/g, "-") || "vacant"}`;
}

function cleanRank(rank) {
  return String(rank || "").replace(/\s+/g, " ").trim();
}

function categoryForRank(rank) {
  const cleaned = cleanRank(rank);
  return rankCategories.find((category) => category.ranks.some((item) => cleanRank(item) === cleaned))?.name || "Other";
}

function groupedRoster(rows) {
  const buckets = new Map([...rankCategories.map((category) => [category.name, []]), ["Other", []]]);
  rows.forEach((entry) => {
    buckets.get(categoryForRank(entry.rank)).push(entry);
  });
  for (const entries of buckets.values()) {
    entries.sort((a, b) => {
      const na = parseInt(a.callsign, 10);
      const nb = parseInt(b.callsign, 10);
      if (!isNaN(na) && !isNaN(nb)) return na - nb;
      return String(a.callsign || "").localeCompare(String(b.callsign || ""));
    });
  }
  return [...buckets.entries()].filter(([, entries]) => entries.length);
}

function deduplicatedRoster() {
  const seen = new Map();
  for (const entry of rosterData.roster) {
    const cs = String(entry.callsign || "").trim();
    if (!cs) { seen.set(entry.id, entry); continue; }
    if (!seen.has(cs)) { seen.set(cs, entry); continue; }
    const prev = seen.get(cs);
    const prevVacant = prev.vacant || prev.activity === "Vacant" || !prev.name;
    const thisVacant = entry.vacant || entry.activity === "Vacant" || !entry.name;
    if (prevVacant && !thisVacant) seen.set(cs, entry); // prefer active
  }
  return [...seen.values()];
}

function filteredRoster() {
  const query = normalize($("#searchInput").value);
  const activity = $("#activityFilter").value;
  const rank = $("#rankFilter").value;
  const hideVacant = $("#hideVacantToggle")?.checked ?? true;
  return deduplicatedRoster().filter((entry) => {
    const isVacant = entry.vacant || entry.activity === "Vacant" || !entry.name;
    if (hideVacant && isVacant) return false;
    const haystack = normalize([
      entry.callsign,
      entry.name,
      entry.activity,
      entry.rank,
      categoryForRank(entry.rank),
      entry.notes,
      activeDivisions(entry).join(" ")
    ].join(" "));
    return (
      (!query || haystack.includes(query)) &&
      (!activity || entry.activity === activity) &&
      (!rank || entry.rank === rank) &&
      (!activeCategoryFilter || (categoryForRank(entry.rank) === activeCategoryFilter && entry.activity !== "Vacant" && !entry.vacant))
    );
  });
}

function renderSummary() {
  const entries = rosterData.roster;
  $("#departmentLabel").textContent = rosterData.department || "Police Department";
  $("#applicationHeading").textContent = `Apply to the ${rosterData.department || "department"}`;
  document.title = `${rosterData.department || "PD"} Roster`;
  $("#totalSlots").textContent = entries.length;
  $("#activeCount").textContent = entries.filter((entry) => entry.activity === "Active").length;
  $("#vacantCount").textContent = entries.filter((entry) => entry.activity === "Vacant" || entry.vacant).length;
  $("#inactiveCount").textContent = entries.filter((entry) => ["LOA", "Inactive", "Semi-Active"].includes(entry.activity)).length;
}

function renderFilters() {
  const currentActivity = $("#activityFilter").value;
  const currentRank = $("#rankFilter").value;
  const activities = [...new Set(rosterData.roster.map((entry) => entry.activity).filter(Boolean))].sort();
  const ranks = [...new Set(rosterData.roster.map((entry) => entry.rank).filter(Boolean))].sort();

  $("#activityFilter").innerHTML = `<option value="">All activity</option>${activities
    .map((item) => `<option value="${escapeHtml(item)}">${escapeHtml(item)}</option>`)
    .join("")}`;
  $("#rankFilter").innerHTML = `<option value="">All ranks</option>${ranks
    .map((item) => `<option value="${escapeHtml(item)}">${escapeHtml(item)}</option>`)
    .join("")}`;
  $("#activityFilter").value = currentActivity;
  $("#rankFilter").value = currentRank;
}

function renderRosterTable() {
  const rows = filteredRoster();
  $("#rosterBody").innerHTML = groupedRoster(rows)
    .map(([category, entries]) => {
      const filled = entries.filter((entry) => entry.activity !== "Vacant" && !entry.vacant).length;
      const categoryRow = `<tr class="category-row">
        <td colspan="9">
          <div>
            <strong>${escapeHtml(category)}</strong>
            <span>${entries.length} slots / ${filled} filled</span>
          </div>
        </td>
      </tr>`;
      const entryRows = entries
        .map((entry) => {
          const isVacant = entry.vacant || entry.activity === "Vacant";
          const divisionPills = isVacant ? [] : activeDivisions(entry);
          const strikePills = activeStrikes(entry);
          const tigDays = isVacant ? null : tigFromPromotionDate(entry.promotionDate);
          const tigDisplay = tigDays !== null ? formatTig(String(tigDays)) : "";
          return `<tr>
        <td>${escapeHtml(entry.callsign || "-")}</td>
        <td>${escapeHtml(entry.name || "Vacant")}${entry.clearedForPatrol ? `<span class="cleared-badge" title="Cleared for patrol">✓</span>` : ""}</td>
        <td>${isVacant ? "" : escapeHtml(entry.notes || "-")}</td>
        <td class="${statusClass(entry.activity)}">${escapeHtml(entry.activity || "Vacant")}</td>
        <td>${escapeHtml(entry.rank || "-")}</td>
        <td><span class="pill-row">${isVacant ? "" : renderPills(divisionPills)}</span></td>
        <td><span class="pill-row">${renderPills(strikePills.map((strike) => `Strike ${strike}`))}</span></td>
        <td>${escapeHtml(formatDate(entry.promotionDate))}</td>
        <td>${escapeHtml(tigDisplay)}</td>
      </tr>`;
        })
        .join("");
      return `${categoryRow}${entryRows}`;
    })
    .join("");
}

function renderPills(items) {
  if (!items.length) return `<span class="pill empty">None</span>`;
  return items.map((item) => `<span class="pill">${escapeHtml(item)}</span>`).join("");
}

function renderEntryList() {
  let rows = rosterData.roster.filter((entry) => !entry.vacant && entry.activity !== "Vacant");
  if (entryListQuery) {
    const q = normalize(entryListQuery);
    rows = rows.filter((entry) =>
      normalize([entry.callsign, entry.name, entry.rank, entry.activity].join(" ")).includes(q)
    );
  }
  $("#entryList").innerHTML = rows.length
    ? rows
        .map(
          (entry) => `<button class="mini-item ${entry.id === selectedEntryId ? "active" : ""}" data-entry-id="${entry.id}">
        <strong>${escapeHtml(entry.callsign || "-")}</strong>
        <span>${escapeHtml(entry.name || "-")}<br><small>${escapeHtml(entry.rank || "-")}</small></span>
        <small>${escapeHtml(entry.activity || "-")}</small>
      </button>`
        )
        .join("")
    : `<div class="empty-state">No active entries match.</div>`;
}

function renderCategoryOverview() {
  const entries = rosterData.roster;
  $("#categoryOverview").innerHTML = groupedRoster(entries)
    .map(([category, rows]) => {
      const filled = rows.filter((entry) => entry.activity !== "Vacant" && !entry.vacant).length;
      return `<button class="category-card" type="button" data-category-filter="${escapeHtml(category)}">
        <span>${escapeHtml(category)}</span>
        <strong>${filled}</strong>
        <small>${rows.length} slots</small>
      </button>`;
    })
    .join("");
}

function renderAll() {
  fillChecks();
  fillEntrySelects();
  renderSummary();
  renderCategoryOverview();
  renderFilters();
  renderRosterTable();
  renderEntryList();
}

function renderApplications() {
  const sorted = [...applications].sort((a, b) => {
    const order = { pending: 0, accepted: 1, rejected: 2 };
    return (order[a.status] ?? 9) - (order[b.status] ?? 9) || String(b.submittedAt).localeCompare(String(a.submittedAt));
  });
  $("#applicationList").innerHTML = sorted.length
    ? sorted
        .map(
          (application) => `<button class="mini-item application-item ${application.id === selectedApplicationId ? "active" : ""}" data-application-id="${application.id}">
            <span><strong>${escapeHtml(application.name)}</strong><br><small>${escapeHtml(application.discord)}</small></span>
            <small>${escapeHtml(formatDate(application.submittedAt))}</small>
            <small class="${statusClass(application.status)}">${escapeHtml(application.status)}</small>
          </button>`
        )
        .join("")
    : `<div class="empty-state">No applications yet.</div>`;
}

function toDateInputValue(dateStr) {
  if (!dateStr || dateStr === "-" || dateStr === "N/A") return "";
  if (/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) return dateStr;
  const m = dateStr.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (m) return `${m[3]}-${m[1].padStart(2, "0")}-${m[2].padStart(2, "0")}`;
  return "";
}

function tigFromPromotionDate(promotionDate) {
  const iso = toDateInputValue(promotionDate);
  if (!iso) return null;
  const then = new Date(iso + "T00:00:00");
  if (isNaN(then.getTime())) return null;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return Math.max(0, Math.floor((today - then) / 86400000));
}

function formatTig(value) {
  const days = parseInt(value, 10);
  if (isNaN(days) || value === "") return value || "-";
  if (days === 0) return "0D";
  const years = Math.floor(days / 365);
  const months = Math.floor((days % 365) / 30);
  const d = days % 30;
  const parts = [];
  if (years) parts.push(`${years}Y`);
  if (months) parts.push(`${months}M`);
  if (d) parts.push(`${d}D`);
  return parts.join(" ") || "0D";
}

function formatDate(value) {
  if (!value) return "-";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleDateString();
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

const activityOptions = ["Active", "LOA", "M-LOA", "Semi-Active", "Inactive", "Vacant"];

function fillChecks() {
  $("#divisionChecks").innerHTML = divisions
    .map((division) => `<label class="checkbox"><input type="checkbox" name="division_${division}"> ${division}</label>`)
    .join("");
  $("#strikeChecks").innerHTML = strikes
    .map((strike) => `<label class="checkbox"><input type="checkbox" name="strike_${strike}"> Strike ${strike}</label>`)
    .join("");
}

function fillEntrySelects() {
  // Activity dropdown
  $("#activityPicker").innerHTML = activityOptions
    .map((a) => `<option value="${escapeHtml(a)}">${escapeHtml(a)}</option>`)
    .join("");

  // Rank dropdown (grouped by category)
  $("#rankPicker").innerHTML = rankCategories
    .map(
      (cat) => `<optgroup label="${escapeHtml(cat.name)}">${cat.ranks
        .map((r) => `<option value="${escapeHtml(r)}">${escapeHtml(r)}</option>`)
        .join("")}</optgroup>`
    )
    .join("");

  // Callsign dropdown (all from roster)
  const callsigns = [...new Set(rosterData.roster.map((e) => e.callsign).filter(Boolean))].sort();
  $("#callsignPicker").innerHTML = [
    `<option value="">— New callsign —</option>`,
    ...callsigns.map((c) => `<option value="${escapeHtml(c)}">${escapeHtml(c)}</option>`)
  ].join("");
}

function entryToForm(entry) {
  const form = $("#entryForm");
  const fields = form.elements;
  fields.id.value = entry?.id || "";

  // Callsign — ensure the option exists (handles new entries not yet in dropdown)
  const callsignVal = entry?.callsign || "";
  const callsignPicker = $("#callsignPicker");
  if (callsignVal && !callsignPicker.querySelector(`option[value="${callsignVal.replace(/"/g, '\\"')}"]`)) {
    const opt = document.createElement("option");
    opt.value = callsignVal;
    opt.textContent = callsignVal;
    callsignPicker.prepend(opt);
  }
  fields.callsign.value = callsignVal;

  fields.name.value = entry?.name || "";
  fields.rank.value = entry?.rank || "";
  fields.activity.value = entry?.activity || "";
  fields.promotionDate.value = toDateInputValue(entry?.promotionDate || "");
  fields.notes.value = entry?.notes || "";
  fields.employeeNotes.value = entry?.employeeNotes || "";
  fields.vacant.checked = Boolean(entry?.vacant);
  fields.clearedForPatrol.checked = Boolean(entry?.clearedForPatrol);
  divisions.forEach((division) => {
    fields[`division_${division}`].checked = Boolean(entry?.divisions?.[division]);
  });
  strikes.forEach((strike) => {
    fields[`strike_${strike}`].checked = Boolean(entry?.strikes?.[strike]);
  });
  $("#entryFormTitle").textContent = entry ? `Edit ${entry.callsign || entry.name || "entry"}` : "New roster entry";
  $("#deleteEntryButton").disabled = !entry;
}

function populateAcceptRankDropdown() {
  const allRanks = rankCategories.flatMap((cat) => cat.ranks);
  $("#acceptRankPicker").innerHTML = [
    `<option value="">— Select rank —</option>`,
    ...rankCategories.map(
      (cat) => `<optgroup label="${escapeHtml(cat.name)}">${cat.ranks
        .map((r) => `<option value="${escapeHtml(r)}">${escapeHtml(r)}</option>`)
        .join("")}</optgroup>`
    )
  ].join("");
}

function populateAcceptCallsigns(rank) {
  const picker = $("#acceptCallsignPicker");
  if (!rank) {
    picker.innerHTML = `<option value="">— Select rank first —</option>`;
    picker.disabled = true;
    return;
  }
  const vacant = rosterData.roster.filter(
    (e) => (e.vacant || e.activity === "Vacant") && cleanRank(e.rank) === cleanRank(rank)
  );
  if (vacant.length) {
    picker.innerHTML = [
      `<option value="">— Select callsign —</option>`,
      ...vacant.map(
        (e) => `<option value="${escapeHtml(e.callsign)}" data-entry-id="${escapeHtml(e.id)}">${escapeHtml(e.callsign)}</option>`
      )
    ].join("");
  } else {
    picker.innerHTML = `<option value="">No vacant slots for this rank</option>`;
  }
  picker.disabled = false;
}

function applicationToAcceptForm(application) {
  const form = $("#acceptApplicationForm");
  const fields = form.elements;
  selectedApplicationId = application?.id || null;
  fields.applicationId.value = application?.id || "";
  fields.vacantEntryId.value = "";
  fields.name.value = application?.name || "";
  fields.promotionDate.value = new Date().toISOString().split("T")[0];
  populateAcceptRankDropdown();
  $("#acceptRankPicker").value = "";
  populateAcceptCallsigns("");
  $("#acceptFormTitle").textContent = application ? `Accept ${application.name}` : "Accept applicant";
  $("#applicationDetail").textContent = application
    ? [
        application.age ? `Age: ${application.age}` : "",
        application.factionCharacter ? `Faction char: ${application.factionCharacter}` : "",
        application.leoExperience ? `LEO exp: ${application.leoExperience}` : "",
        application.bannedHistory ? `Ban history: ${application.bannedHistory}` : "",
        application.clips ? `Clips: ${application.clips}` : "",
        application.roleplayPhilosophy ? `RP philosophy: ${application.roleplayPhilosophy}` : "",
        application.characterDescription ? `Character: ${application.characterDescription}` : "",
        application.status !== "pending" ? `Status: ${application.status}` : ""
      ].filter(Boolean).join("\n\n")
    : "Select a pending application to review it.";
  $$("#acceptApplicationForm input, #acceptApplicationForm select, #acceptApplicationForm button").forEach((control) => {
    if (control.name === "name") return;
    if (control.id === "acceptCallsignPicker") return; // managed by rank selection
    control.disabled = !application || application.status !== "pending" || !sessionUser?.canEditRoster;
  });
  renderApplications();
}

function formToEntry() {
  const form = $("#entryForm");
  const fields = form.elements;
  return {
    id: fields.id.value,
    callsign: fields.callsign.value,
    name: fields.name.value,
    activity: fields.activity.value,
    rank: fields.rank.value,
    promotionDate: fields.promotionDate.value,
    notes: fields.notes.value,
    employeeNotes: fields.employeeNotes.value,
    vacant: fields.vacant.checked,
    clearedForPatrol: fields.clearedForPatrol.checked,
    divisions: Object.fromEntries(divisions.map((division) => [division, fields[`division_${division}`].checked])),
    strikes: Object.fromEntries(strikes.map((strike) => [strike, fields[`strike_${strike}`].checked]))
  };
}

function setDashboardState() {
  const signedIn = Boolean(sessionUser);
  const canSeeOnboarding = sessionUser?.canOnboard || sessionUser?.role === "admin";

  // Topbar auth area
  $("#signInBtn").classList.toggle("hidden", signedIn);
  $("#userPill").classList.toggle("hidden", !signedIn);
  if (signedIn) {
    $("#userPillName").textContent = sessionUser.name;
  }

  // Nav buttons — only show when signed in
  $("#dashboardNavBtn").classList.toggle("hidden", !signedIn);
  $("#onboardingNavBtn").classList.toggle("hidden", !canSeeOnboarding);

  // If signed out and currently on a protected view, redirect to public roster
  if (!signedIn) {
    const activeView = document.querySelector(".view:not(.hidden)");
    if (activeView?.id === "dashboardView" || activeView?.id === "onboardingView") {
      showView("public");
    }
    return;
  }

  $("#signedInAs").textContent = `${sessionUser.name} (${sessionUser.role})`;
  $("#userAdmin").classList.toggle("hidden", !sessionUser.canManageUsers);
  $(".applications-admin").classList.toggle("hidden", !sessionUser.canEditRoster);
  $("#editNotice").textContent = sessionUser.canEditRoster
    ? "Changes save to data/roster.json immediately."
    : "Your account can view the dashboard but cannot edit roster entries.";
  $$("#entryForm input, #entryForm textarea, #entryForm select, #entryForm button").forEach((control) => {
    control.disabled = !sessionUser.canEditRoster;
  });
}

async function loadRoster() {
  rosterData = await api("/api/roster");
  divisions = rosterData.divisions?.length
    ? rosterData.divisions
    : [...new Set(rosterData.roster.flatMap((entry) => Object.keys(entry.divisions || {})))];
  strikes = rosterData.strikes?.length
    ? rosterData.strikes
    : [...new Set(rosterData.roster.flatMap((entry) => Object.keys(entry.strikes || {})))];
  renderAll();
}

async function loadSession() {
  const data = await api("/api/session");
  sessionUser = data.user;
  setDashboardState();
  if (sessionUser?.canEditRoster) await loadApplications();
  if (sessionUser?.canManageUsers) await loadUsers();
  if (sessionUser?.canOnboard || sessionUser?.role === "admin") await loadOnboarding();
}

async function loadApplications() {
  const data = await api("/api/applications");
  applications = data.applications;
  renderApplications();
  const selected = applications.find((application) => application.id === selectedApplicationId);
  applicationToAcceptForm(selected || applications.find((application) => application.status === "pending") || null);
}

async function loadUsers() {
  const data = await api("/api/users");
  users = data.users;
  renderUsers();
}

function renderUsers() {
  $("#userList").innerHTML = users
    .map(
      (user) => `<button class="mini-item" data-user-id="${user.id}">
        <span><strong>${escapeHtml(user.name)}</strong><br><small>${escapeHtml(user.email)}</small></span>
        <small>${escapeHtml(user.role)}</small>
        <small>${user.canEditRoster ? "Roster edit" : "Read only"}${user.canManageUsers ? " + users" : ""}</small>
      </button>`
    )
    .join("");
}

async function loadOnboarding() {
  const data = await api("/api/onboarding");
  onboardingCards = data.cards;
  renderKanban();
}

function renderKanban() {
  $("#kanbanBoard").innerHTML = onboardingStages
    .map((stage) => {
      const cards = onboardingCards.filter((c) => c.stage === stage);
      const isLast = stage === "Cleared For Patrol";
      return `<div class="kanban-col${isLast ? " kanban-col-final" : ""}">
        <div class="kanban-col-head">
          <span>${escapeHtml(stage)}</span>
          <span class="kanban-count">${cards.length}</span>
        </div>
        <div class="kanban-cards" data-stage="${escapeHtml(stage)}">
          ${cards
            .map(
              (card) => `<div class="kanban-card" draggable="true" data-card-id="${escapeHtml(card.id)}">
              <strong>${escapeHtml(card.name)}</strong>
              <small class="card-discord">${escapeHtml(card.discord)}</small>
              ${card.callsign || card.rank ? `<div class="card-meta">
                ${card.callsign ? `<span class="pill">${escapeHtml(card.callsign)}</span>` : ""}
                ${card.rank ? `<span class="pill">${escapeHtml(card.rank)}</span>` : ""}
              </div>` : ""}
              ${card.acceptedBy ? `<small class="card-accepted">👤 ${escapeHtml(card.acceptedBy)}</small>` : ""}
            </div>`
            )
            .join("")}
        </div>
      </div>`;
    })
    .join("");

  // Drag events on cards
  $$(".kanban-card").forEach((card) => {
    card.addEventListener("dragstart", (e) => {
      e.dataTransfer.setData("text/plain", card.dataset.cardId);
      card.classList.add("dragging");
      $("#terminateZone").classList.remove("hidden");
    });
    card.addEventListener("dragend", () => {
      card.classList.remove("dragging");
      $("#terminateZone").classList.add("hidden");
      $("#terminateZone").classList.remove("drag-over");
    });
  });

  // Terminate drop zone
  const terminateZone = $("#terminateZone");
  terminateZone.addEventListener("dragover", (e) => {
    e.preventDefault();
    terminateZone.classList.add("drag-over");
  });
  terminateZone.addEventListener("dragleave", () => terminateZone.classList.remove("drag-over"));
  terminateZone.addEventListener("drop", (e) => {
    e.preventDefault();
    terminateZone.classList.remove("drag-over");
    terminateZone.classList.add("hidden");
    const cardId = e.dataTransfer.getData("text/plain");
    const card = onboardingCards.find((c) => c.id === cardId);
    if (!card) return;
    pendingTerminationId = cardId;
    $("#terminateName").textContent = card.name;
    $("#terminateModal").classList.remove("hidden");
  });

  // Drop zones
  $$(".kanban-cards").forEach((zone) => {
    zone.addEventListener("dragover", (e) => {
      e.preventDefault();
      zone.classList.add("drag-over");
    });
    zone.addEventListener("dragleave", () => zone.classList.remove("drag-over"));
    zone.addEventListener("drop", async (e) => {
      e.preventDefault();
      zone.classList.remove("drag-over");
      const cardId = e.dataTransfer.getData("text/plain");
      const targetStage = zone.dataset.stage;
      const card = onboardingCards.find((c) => c.id === cardId);
      if (!card || card.stage === targetStage) return;

      if (targetStage === "Academy Passed") {
        pendingAcademyCardId = cardId;
        populateAcademyRankDropdown();
        $("#academyPassedModal").classList.remove("hidden");
        return;
      }

      if (targetStage === "Cleared For Patrol") {
        pendingClearForPatrolId = cardId;
        $("#clearForPatrolName").textContent = card.name || "this recruit";
        $("#clearForPatrolModal").classList.remove("hidden");
        return;
      }

      await moveOnboardingCard(cardId, targetStage);
    });
  });
}

async function moveOnboardingCard(cardId, stage, extra = {}) {
  try {
    await api(`/api/onboarding/${encodeURIComponent(cardId)}`, {
      method: "PUT",
      body: JSON.stringify({ stage, ...extra })
    });
    // Always reload both so roster badges (clearedForPatrol, rank, etc.) stay in sync
    await Promise.all([loadOnboarding(), loadRoster()]);
    toast(`Moved to "${stage}"`);
  } catch (err) {
    toast(err.message);
  }
}

function populateAcademyRankDropdown() {
  $("#academyRankPicker").innerHTML = rankCategories
    .map(
      (cat) => `<optgroup label="${escapeHtml(cat.name)}">${cat.ranks
        .map((r) => `<option value="${escapeHtml(r)}">${escapeHtml(r)}</option>`)
        .join("")}</optgroup>`
    )
    .join("");
  $("#academyRankPicker").value = "Probationary Officer";
  populateAcademyCallsigns("Probationary Officer");
}

function populateAcademyCallsigns(rank) {
  const picker = $("#academyCallsignPicker");
  const vacant = rosterData.roster.filter(
    (e) => (e.vacant || e.activity === "Vacant") && cleanRank(e.rank) === cleanRank(rank)
  );
  picker.innerHTML = vacant.length
    ? [
        `<option value="">— Select callsign —</option>`,
        ...vacant.map((e) => `<option value="${escapeHtml(e.callsign)}">${escapeHtml(e.callsign)}</option>`)
      ].join("")
    : `<option value="">No vacant slots for this rank</option>`;
}

function userToForm(user = {}) {
  const form = $("#userForm");
  const fields = form.elements;
  fields.id.value = user.id || "";
  fields.name.value = user.name || "";
  fields.email.value = user.email || "";
  fields.password.value = "";
  fields.role.value = user.role || "viewer";
  fields.canEditRoster.checked = Boolean(user.canEditRoster);
  fields.canManageUsers.checked = Boolean(user.canManageUsers);
  fields.canOnboard.checked = Boolean(user.canOnboard);
}

function switchApplyTab(tab) {
  $$(".apply-tab").forEach((b) => b.classList.toggle("active", b.dataset.tab === tab));
  $("#applyTabContent").classList.toggle("hidden", tab !== "apply");
  $("#statusTabContent").classList.toggle("hidden", tab !== "status");
}

const statusMessages = {
  pending: "Your application is under review by command staff. We'll be in touch via Discord.",
  accepted: "Your application has been accepted! Please check your Discord for next steps.",
  rejected: "Your application was not accepted at this time. You're welcome to reapply in the future."
};

const statusColors = { pending: "var(--gold)", accepted: "var(--green)", rejected: "var(--red)" };

function showApplicationStatus(application) {
  $("#statusName").textContent = application.name;
  $("#statusBadge").textContent = application.status.charAt(0).toUpperCase() + application.status.slice(1);
  $("#statusBadge").style.color = statusColors[application.status] || "";
  $("#statusMessage").textContent = statusMessages[application.status] || "";
  $("#statusDate").textContent = `Submitted ${formatDate(application.submittedAt)}` +
    (application.reviewedAt ? `  ·  Reviewed ${formatDate(application.reviewedAt)}` : "");
  $("#applicationStatusPanel").classList.remove("hidden");
  $("#noApplicationMessage").classList.add("hidden");
  switchApplyTab("status");
}

async function checkSavedApplicationStatus() {
  const id = localStorage.getItem("pd_application_id");
  if (!id) return;
  try {
    const application = await api(`/api/applications/status?id=${encodeURIComponent(id)}`);
    showApplicationStatus(application);
  } catch {
    localStorage.removeItem("pd_application_id");
  }
}

function showView(view) {
  $$(".nav-button").forEach((btn) => {
    btn.classList.toggle("active", btn.dataset.view === view);
  });
  $("#publicView").classList.toggle("hidden", view !== "public");
  $("#applyView").classList.toggle("hidden", view !== "apply");
  $("#dashboardView").classList.toggle("hidden", view !== "dashboard");
  $("#onboardingView").classList.toggle("hidden", view !== "onboarding");
  if (view === "onboarding" && (sessionUser?.canOnboard || sessionUser?.role === "admin")) loadOnboarding();
}

function wireEvents() {
  $$(".apply-tab").forEach((button) => {
    button.addEventListener("click", () => switchApplyTab(button.dataset.tab));
  });

  $$(".nav-button").forEach((button) => {
    button.addEventListener("click", () => showView(button.dataset.view));
  });

  $("#refreshOnboardingBtn").addEventListener("click", () => loadOnboarding());

  $("#academyRankPicker").addEventListener("change", () => {
    populateAcademyCallsigns($("#academyRankPicker").value);
  });

  $("#academyConfirmBtn").addEventListener("click", async () => {
    if (!pendingAcademyCardId) return;
    const callsign = $("#academyCallsignPicker").value;
    if (!callsign) { toast("Please select a callsign."); return; }
    const rank = $("#academyRankPicker").value;
    const id = pendingAcademyCardId;
    pendingAcademyCardId = null;
    $("#academyPassedModal").classList.add("hidden");
    await moveOnboardingCard(id, "Academy Passed", { callsign, rank });
  });

  $("#academyCancelBtn").addEventListener("click", () => {
    pendingAcademyCardId = null;
    $("#academyPassedModal").classList.add("hidden");
  });

  $("#academyPassedModal").addEventListener("click", (e) => {
    if (e.target === $("#academyPassedModal")) {
      pendingAcademyCardId = null;
      $("#academyPassedModal").classList.add("hidden");
    }
  });

  $("#terminateConfirmBtn").addEventListener("click", async () => {
    if (!pendingTerminationId) return;
    const id = pendingTerminationId;
    pendingTerminationId = null;
    $("#terminateModal").classList.add("hidden");
    try {
      await api(`/api/onboarding/${encodeURIComponent(id)}`, { method: "DELETE" });
      await loadRoster();
      await loadOnboarding();
      if (sessionUser?.canEditRoster) await loadApplications();
      toast("Employee terminated and removed from roster.");
    } catch (err) {
      toast(err.message);
    }
  });

  $("#terminateCancelBtn").addEventListener("click", () => {
    pendingTerminationId = null;
    $("#terminateModal").classList.add("hidden");
  });

  $("#terminateModal").addEventListener("click", (e) => {
    if (e.target === $("#terminateModal")) {
      pendingTerminationId = null;
      $("#terminateModal").classList.add("hidden");
    }
  });

  $("#clearForPatrolConfirmBtn").addEventListener("click", async () => {
    if (!pendingClearForPatrolId) return;
    const id = pendingClearForPatrolId;
    pendingClearForPatrolId = null;
    $("#clearForPatrolModal").classList.add("hidden");
    await moveOnboardingCard(id, "Cleared For Patrol");
  });

  $("#clearForPatrolCancelBtn").addEventListener("click", () => {
    pendingClearForPatrolId = null;
    $("#clearForPatrolModal").classList.add("hidden");
  });

  $("#clearForPatrolModal").addEventListener("click", (e) => {
    if (e.target === $("#clearForPatrolModal")) {
      pendingClearForPatrolId = null;
      $("#clearForPatrolModal").classList.add("hidden");
    }
  });

  $("#applyAgainButton").addEventListener("click", () => {
    localStorage.removeItem("pd_application_id");
    $("#applicationStatusPanel").classList.add("hidden");
    $("#noApplicationMessage").classList.remove("hidden");
    switchApplyTab("apply");
  });

  $("#discordLookupButton").addEventListener("click", async () => {
    const discord = $("#discordLookupInput").value.trim();
    if (!discord) return;
    try {
      const application = await api(`/api/applications/status?discord=${encodeURIComponent(discord)}`);
      localStorage.setItem("pd_application_id", application.id || "");
      showApplicationStatus(application);
      $("#discordLookupResult").textContent = "";
    } catch {
      $("#discordLookupResult").textContent = "No application found for that Discord username.";
    }
  });

  $("#discordLookupInput").addEventListener("keydown", (e) => {
    if (e.key === "Enter") $("#discordLookupButton").click();
  });

  $("#applicationForm").addEventListener("submit", async (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    const fields = form.elements;
    try {
      const next = await api("/api/applications", {
        method: "POST",
        body: JSON.stringify({
          name: fields.name.value,
          discord: fields.discord.value,
          age: fields.age.value,
          factionCharacter: fields.factionCharacter.value,
          roleplayPhilosophy: fields.roleplayPhilosophy.value,
          characterDescription: fields.characterDescription.value,
          leoExperience: fields.leoExperience.value,
          bannedHistory: fields.bannedHistory.value,
          clips: fields.clips.value
        })
      });
      localStorage.setItem("pd_application_id", next.application.id);
      form.reset();
      updateSubmitState();
      showApplicationStatus(next.application);
      if (sessionUser?.canEditRoster) await loadApplications();
      toast("Application submitted.");
    } catch (error) {
      $("#applicationNotice").textContent = error.message;
      toast(error.message);
    }
  });

  function updateSubmitState() {
    const f = $("#applicationForm").elements;
    const allFilled =
      f.name.value.trim() &&
      f.discord.value.trim() &&
      f.age.value.trim() &&
      f.factionCharacter.value &&
      f.bannedHistory.value.trim() &&
      f.roleplayPhilosophy.value.trim() &&
      f.characterDescription.value.trim();
    $("#applicationForm [type=submit]").disabled = !allFilled;
  }

  const appFormFields = ["name", "discord", "age", "factionCharacter", "roleplayPhilosophy", "characterDescription", "bannedHistory"];
  appFormFields.forEach((name) => {
    $("#applicationForm").elements[name].addEventListener("input", updateSubmitState);
    $("#applicationForm").elements[name].addEventListener("change", updateSubmitState);
  });
  updateSubmitState();

  ["searchInput", "activityFilter", "rankFilter"].forEach((id) => {
    $(`#${id}`).addEventListener("input", () => {
      activeCategoryFilter = "";
      $$(".category-card").forEach((card) => card.classList.remove("active"));
      renderRosterTable();
      renderEntryList();
    });
  });

  $("#hideVacantToggle").addEventListener("change", () => {
    activeCategoryFilter = "";
    $$(".category-card").forEach((card) => card.classList.remove("active"));
    renderRosterTable();
  });

  $("#categoryOverview").addEventListener("click", (event) => {
    const button = event.target.closest("[data-category-filter]");
    if (!button) return;
    activeCategoryFilter = button.dataset.categoryFilter;
    $$(".category-card").forEach((card) => card.classList.toggle("active", card === button));
    $("#rankFilter").value = "";
    $("#activityFilter").value = "";
    $("#searchInput").value = "";
    renderRosterTable();
    renderEntryList();
  });

  // Sign-in modal open/close
  $("#signInBtn").addEventListener("click", () => {
    $("#signInPanel").classList.remove("hidden");
    $("#registerPanel").classList.add("hidden");
    $("#signInModal").classList.remove("hidden");
    $("#loginForm").querySelector("[name='email']").focus();
  });
  $("#signInModal").addEventListener("click", (e) => {
    if (e.target === $("#signInModal")) $("#signInModal").classList.add("hidden");
  });

  // Toggle between sign-in and register panels
  $("#showRegisterBtn").addEventListener("click", () => {
    $("#signInPanel").classList.add("hidden");
    $("#registerPanel").classList.remove("hidden");
    $("#registerForm").querySelector("[name='name']").focus();
  });
  $("#showSignInBtn").addEventListener("click", () => {
    $("#registerPanel").classList.add("hidden");
    $("#signInPanel").classList.remove("hidden");
    $("#loginForm").querySelector("[name='email']").focus();
  });

  async function handleAuthSuccess(user) {
    sessionUser = user;
    $("#signInModal").classList.add("hidden");
    $("#loginForm").reset();
    $("#registerForm").reset();
    setDashboardState();
    if (sessionUser.canEditRoster) await loadApplications();
    if (sessionUser.canManageUsers) await loadUsers();
    if (sessionUser.canOnboard || sessionUser.role === "admin") await loadOnboarding();
    showView("dashboard");
    toast(`Welcome, ${sessionUser.name}.`);
  }

  $("#loginForm").addEventListener("submit", async (event) => {
    event.preventDefault();
    const fields = event.currentTarget.elements;
    const errEl = $("#loginError");
    errEl.classList.add("hidden");
    try {
      const data = await api("/api/login", {
        method: "POST",
        body: JSON.stringify({ email: fields.email.value, password: fields.password.value })
      });
      await handleAuthSuccess(data.user);
    } catch (error) {
      errEl.textContent = error.message;
      errEl.classList.remove("hidden");
    }
  });

  $("#registerForm").addEventListener("submit", async (event) => {
    event.preventDefault();
    const fields = event.currentTarget.elements;
    const errEl = $("#registerError");
    errEl.classList.add("hidden");
    try {
      const data = await api("/api/register", {
        method: "POST",
        body: JSON.stringify({ name: fields.name.value, email: fields.email.value, password: fields.password.value })
      });
      await handleAuthSuccess(data.user);
    } catch (error) {
      errEl.textContent = error.message;
      errEl.classList.remove("hidden");
    }
  });

  $("#signOutBtn").addEventListener("click", async () => {
    await api("/api/logout", { method: "POST" });
    sessionUser = null;
    setDashboardState();
    toast("Signed out.");
  });

  $("#entryList").addEventListener("click", (event) => {
    const button = event.target.closest("[data-entry-id]");
    if (!button) return;
    selectedEntryId = button.dataset.entryId;
    entryToForm(rosterData.roster.find((entry) => entry.id === selectedEntryId));
    renderEntryList();
  });

  $("#newEntryButton").addEventListener("click", () => {
    selectedEntryId = null;
    entryToForm(null);
    renderEntryList();
  });

  $("#entryForm").addEventListener("submit", async (event) => {
    event.preventDefault();
    if (!sessionUser?.canEditRoster) return toast("No edit permission.");
    const entry = formToEntry();
    try {
      const saved = entry.id
        ? await api(`/api/roster/${encodeURIComponent(entry.id)}`, { method: "PUT", body: JSON.stringify(entry) })
        : await api("/api/roster", { method: "POST", body: JSON.stringify(entry) });
      await loadRoster();
      selectedEntryId = saved.id;
      entryToForm(saved);
      toast("Roster entry saved.");
    } catch (error) {
      toast(error.message);
    }
  });

  $("#deleteEntryButton").addEventListener("click", async () => {
    if (!selectedEntryId || !sessionUser?.canEditRoster) return;
    await api(`/api/roster/${encodeURIComponent(selectedEntryId)}`, { method: "DELETE" });
    selectedEntryId = null;
    entryToForm(null);
    await loadRoster();
    toast("Roster entry deleted.");
  });

  $("#refreshApplicationsButton").addEventListener("click", () => loadApplications());

  $("#acceptRankPicker").addEventListener("change", () => {
    const rank = $("#acceptRankPicker").value;
    populateAcceptCallsigns(rank);
    $("#acceptApplicationForm").elements.vacantEntryId.value = "";
  });

  $("#acceptCallsignPicker").addEventListener("change", () => {
    const select = $("#acceptCallsignPicker");
    const selectedOption = select.options[select.selectedIndex];
    const entryId = selectedOption?.dataset.entryId || "";
    $("#acceptApplicationForm").elements.vacantEntryId.value = entryId;
  });

  $("#entrySearch").addEventListener("input", (e) => {
    entryListQuery = e.target.value;
    renderEntryList();
  });

  $("#applicationList").addEventListener("click", (event) => {
    const button = event.target.closest("[data-application-id]");
    if (!button) return;
    const application = applications.find((item) => item.id === button.dataset.applicationId);
    applicationToAcceptForm(application);
  });

  $("#acceptApplicationForm").addEventListener("submit", async (event) => {
    event.preventDefault();
    if (!sessionUser?.canEditRoster) return toast("No edit permission.");
    const form = event.currentTarget;
    const fields = form.elements;
    const id = fields.applicationId.value;
    if (!id) return toast("Select an application first.");
    try {
      const callsignSelect = $("#acceptCallsignPicker");
      const callsign = callsignSelect.value;
      const result = await api(`/api/applications/${encodeURIComponent(id)}/accept`, {
        method: "POST",
        body: JSON.stringify({
          callsign,
          rank: fields.rank.value || "Cadet",
          promotionDate: fields.promotionDate.value,
          vacantEntryId: fields.vacantEntryId.value
        })
      });
      selectedEntryId = result.rosterEntry.id;
      await loadRoster();
      await loadApplications();
      entryToForm(result.rosterEntry);
      toast("Application accepted and cadet added.");
    } catch (error) {
      toast(error.message);
    }
  });

  $("#rejectApplicationButton").addEventListener("click", async () => {
    const id = $("#acceptApplicationForm").elements.applicationId.value;
    if (!id || !sessionUser?.canEditRoster) return;
    try {
      await api(`/api/applications/${encodeURIComponent(id)}/reject`, { method: "POST" });
      selectedApplicationId = null;
      await loadApplications();
      toast("Application rejected.");
    } catch (error) {
      toast(error.message);
    }
  });

  $("#userList").addEventListener("click", (event) => {
    const button = event.target.closest("[data-user-id]");
    if (!button) return;
    userToForm(users.find((user) => user.id === button.dataset.userId));
  });

  $("#newUserButton").addEventListener("click", () => userToForm());

  $("#userForm").addEventListener("submit", async (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    const fields = form.elements;
    const payload = {
      id: fields.id.value,
      name: fields.name.value,
      email: fields.email.value,
      password: fields.password.value,
      role: fields.role.value,
      canEditRoster: fields.canEditRoster.checked,
      canManageUsers: fields.canManageUsers.checked,
      canOnboard: fields.canOnboard.checked
    };
    try {
      if (payload.id) {
        await api(`/api/users/${encodeURIComponent(payload.id)}`, { method: "PUT", body: JSON.stringify(payload) });
      } else {
        await api("/api/users", { method: "POST", body: JSON.stringify(payload) });
      }
      await loadUsers();
      userToForm();
      toast("User permissions saved.");
    } catch (error) {
      toast(error.message);
    }
  });
}

wireEvents();
await loadRoster();
entryToForm(null);
await loadSession();
await checkSavedApplicationStatus();

