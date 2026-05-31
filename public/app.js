let divisions = ["ONB", "TEU", "AIR", "GIU", "DCI", "CSI"];
let strikes = ["1", "2", "3"];

let rosterData = { roster: [] };
let sessionUser = null;
let selectedEntryId = null;
let selectedApplicationId = null;
let users = [];
let applications = [];
let activeCategoryFilter = "";

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
  return [...buckets.entries()].filter(([, entries]) => entries.length);
}

function filteredRoster() {
  const query = normalize($("#searchInput").value);
  const activity = $("#activityFilter").value;
  const rank = $("#rankFilter").value;
  return rosterData.roster.filter((entry) => {
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
        <td colspan="8">
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
          return `<tr>
        <td>${escapeHtml(entry.callsign || "-")}</td>
        <td>${escapeHtml(entry.name || "Vacant")}</td>
        <td class="${statusClass(entry.activity)}">${escapeHtml(entry.activity || "Vacant")}</td>
        <td>${escapeHtml(entry.rank || "-")}</td>
        <td><span class="pill-row">${isVacant ? "" : renderPills(divisionPills)}</span></td>
        <td><span class="pill-row">${renderPills(strikePills.map((strike) => `Strike ${strike}`))}</span></td>
        <td>${escapeHtml(entry.promotionDate || "-")}</td>
        <td>${isVacant ? "" : escapeHtml(formatTig(entry.tig))}</td>
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
  const rows = filteredRoster();
  $("#entryList").innerHTML = rows
    .map(
      (entry) => `<button class="mini-item ${entry.id === selectedEntryId ? "active" : ""}" data-entry-id="${entry.id}">
        <strong>${escapeHtml(entry.callsign || "-")}</strong>
        <span>${escapeHtml(entry.name || "Vacant")}<br><small>${escapeHtml(entry.rank || "-")}</small></span>
        <small>${escapeHtml(entry.activity || "Vacant")}</small>
      </button>`
    )
    .join("");
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

function fillChecks() {
  $("#divisionChecks").innerHTML = divisions
    .map((division) => `<label class="checkbox"><input type="checkbox" name="division_${division}"> ${division}</label>`)
    .join("");
  $("#strikeChecks").innerHTML = strikes
    .map((strike) => `<label class="checkbox"><input type="checkbox" name="strike_${strike}"> Strike ${strike}</label>`)
    .join("");
}

function entryToForm(entry) {
  const form = $("#entryForm");
  const fields = form.elements;
  fields.id.value = entry?.id || "";
  fields.callsign.value = entry?.callsign || "";
  fields.name.value = entry?.name || "";
  fields.activity.value = entry?.activity || "";
  fields.rank.value = entry?.rank || "";
  fields.promotionDate.value = entry?.promotionDate || "";
  fields.tig.value = entry?.tig || "";
  fields.notes.value = entry?.notes || "";
  fields.vacant.checked = Boolean(entry?.vacant);
  divisions.forEach((division) => {
    fields[`division_${division}`].checked = Boolean(entry?.divisions?.[division]);
  });
  strikes.forEach((strike) => {
    fields[`strike_${strike}`].checked = Boolean(entry?.strikes?.[strike]);
  });
  $("#entryFormTitle").textContent = entry ? `Edit ${entry.callsign || entry.name || "entry"}` : "New roster entry";
  $("#deleteEntryButton").disabled = !entry;
}

function populateVacantCallsigns() {
  const vacant = rosterData.roster.filter((e) => e.vacant || e.activity === "Vacant");
  $("#vacantCallsignPicker").innerHTML = [
    `<option value="">— or fill callsign &amp; rank manually below —</option>`,
    ...vacant.map((e) => `<option value="${escapeHtml(e.id)}">${escapeHtml(e.callsign)} — ${escapeHtml(e.rank || "Unknown")}</option>`)
  ].join("");
}

function applicationToAcceptForm(application) {
  const form = $("#acceptApplicationForm");
  const fields = form.elements;
  selectedApplicationId = application?.id || null;
  fields.applicationId.value = application?.id || "";
  fields.vacantEntryId.value = "";
  fields.name.value = application?.name || "";
  fields.callsign.value = "";
  fields.rank.value = "Cadet";
  fields.promotionDate.value = new Date().toLocaleDateString("en-US");
  populateVacantCallsigns();
  $("#vacantCallsignPicker").value = "";
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
    tig: fields.tig.value,
    notes: fields.notes.value,
    vacant: fields.vacant.checked,
    divisions: Object.fromEntries(divisions.map((division) => [division, fields[`division_${division}`].checked])),
    strikes: Object.fromEntries(strikes.map((strike) => [strike, fields[`strike_${strike}`].checked]))
  };
}

function setDashboardState() {
  const signedIn = Boolean(sessionUser);
  $("#authPanel").classList.toggle("hidden", signedIn);
  $("#dashboardPanel").classList.toggle("hidden", !signedIn);
  if (!signedIn) return;

  $("#signedInAs").textContent = `${sessionUser.name} (${sessionUser.role})`;
  $("#userAdmin").classList.toggle("hidden", !sessionUser.canManageUsers);
  $(".applications-admin").classList.toggle("hidden", !sessionUser.canEditRoster);
  $("#editNotice").textContent = sessionUser.canEditRoster
    ? "Changes save to data/roster.json immediately."
    : "Your account can view the dashboard but cannot edit roster entries.";
  $$("#entryForm input, #entryForm textarea, #entryForm button").forEach((control) => {
    if (control.id === "newEntryButton") control.disabled = !sessionUser.canEditRoster;
    else control.disabled = !sessionUser.canEditRoster;
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

function wireEvents() {
  $$(".apply-tab").forEach((button) => {
    button.addEventListener("click", () => switchApplyTab(button.dataset.tab));
  });

  $$(".nav-button").forEach((button) => {
    button.addEventListener("click", () => {
      $$(".nav-button").forEach((item) => item.classList.remove("active"));
      button.classList.add("active");
      $("#publicView").classList.toggle("hidden", button.dataset.view !== "public");
      $("#applyView").classList.toggle("hidden", button.dataset.view !== "apply");
      $("#dashboardView").classList.toggle("hidden", button.dataset.view !== "dashboard");
    });
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
      $("#roleplayCount").textContent = "";
      $("#characterCount").textContent = "";
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

  $("#loginForm").addEventListener("submit", async (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    const fields = form.elements;
    try {
      const data = await api("/api/login", {
        method: "POST",
        body: JSON.stringify({ email: fields.email.value, password: fields.password.value })
      });
      sessionUser = data.user;
      setDashboardState();
      if (sessionUser.canEditRoster) await loadApplications();
      if (sessionUser.canManageUsers) await loadUsers();
      toast("Signed in.");
    } catch (error) {
      toast(error.message);
    }
  });

  $("#logoutButton").addEventListener("click", async () => {
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

  $("#vacantCallsignPicker").addEventListener("change", (e) => {
    const entry = rosterData.roster.find((r) => r.id === e.target.value);
    const f = $("#acceptApplicationForm").elements;
    if (entry) {
      f.callsign.value = entry.callsign;
      f.rank.value = entry.rank || "Cadet";
      f.vacantEntryId.value = entry.id;
    } else {
      f.vacantEntryId.value = "";
    }
  });

  ["callsign", "rank"].forEach((name) => {
    $("#acceptApplicationForm").elements[name].addEventListener("input", () => {
      $("#acceptApplicationForm").elements.vacantEntryId.value = "";
      $("#vacantCallsignPicker").value = "";
    });
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
      const result = await api(`/api/applications/${encodeURIComponent(id)}/accept`, {
        method: "POST",
        body: JSON.stringify({
          callsign: fields.callsign.value,
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
      canManageUsers: fields.canManageUsers.checked
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
