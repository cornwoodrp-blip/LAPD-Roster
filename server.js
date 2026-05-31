import crypto from "node:crypto";
import fs from "node:fs/promises";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const publicDir = path.join(__dirname, "public");
const seedDir = path.join(__dirname, "data");
const dataDir = process.env.DATA_DIR || seedDir;
const rosterPath = path.join(dataDir, "roster.json");
const usersPath = path.join(dataDir, "users.json");
const applicationsPath = path.join(dataDir, "applications.json");
const port = Number(process.env.PORT || 3000);
const sessions = new Map();

const mimeTypes = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml"
};

async function readJson(filePath) {
  return JSON.parse(await fs.readFile(filePath, "utf8"));
}

async function writeJson(filePath, payload) {
  await fs.writeFile(filePath, `${JSON.stringify(payload, null, 2)}\n`);
}

function send(res, status, payload, headers = {}) {
  const body = typeof payload === "string" ? payload : JSON.stringify(payload);
  res.writeHead(status, {
    "content-type": typeof payload === "string" ? "text/plain; charset=utf-8" : "application/json; charset=utf-8",
    ...headers
  });
  res.end(body);
}

function cookieValue(req, name) {
  const cookie = req.headers.cookie || "";
  return cookie
    .split(";")
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${name}=`))
    ?.split("=")[1];
}

async function bodyJson(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  if (!chunks.length) return {};
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

async function currentUser(req) {
  const token = cookieValue(req, "pd_session");
  const session = token ? sessions.get(token) : null;
  if (!session) return null;
  const { users } = await readJson(usersPath);
  return users.find((user) => user.id === session.userId) || null;
}

function publicUser(user) {
  if (!user) return null;
  const { password, ...safe } = user;
  return safe;
}

function requireUser(user, res) {
  if (!user) {
    send(res, 401, { error: "Sign in required." });
    return false;
  }
  return true;
}

function requireEdit(user, res) {
  if (!requireUser(user, res)) return false;
  if (!user.canEditRoster) {
    send(res, 403, { error: "You do not have roster edit permission." });
    return false;
  }
  return true;
}

function requireManageUsers(user, res) {
  if (!requireUser(user, res)) return false;
  if (!user.canManageUsers) {
    send(res, 403, { error: "Admin user management permission required." });
    return false;
  }
  return true;
}

function sanitizeRosterEntry(input, existing = {}) {
  const divisions = input.divisions || {};
  const strikes = input.strikes || {};
  const divisionKeys = Object.keys({ ...(existing.divisions || {}), ...divisions });
  const strikeKeys = Object.keys({ ...(existing.strikes || {}), ...strikes });
  return {
    id: existing.id || crypto.randomUUID(),
    callsign: String(input.callsign || "").trim(),
    name: String(input.name || "").trim(),
    activity: String(input.activity || "").trim(),
    rank: String(input.rank || "").trim(),
    divisions: Object.fromEntries(divisionKeys.map((key) => [key, Boolean(divisions[key])])),
    strikes: Object.fromEntries(strikeKeys.map((key) => [key, Boolean(strikes[key])])),
    notes: String(input.notes || "").trim(),
    promotionDate: String(input.promotionDate || "").trim(),
    tig: String(input.tig || "").trim(),
    vacant: Boolean(input.vacant)
  };
}

function sanitizeUser(input, existing = {}) {
  const email = String(input.email || existing.email || "").trim().toLowerCase();
  return {
    id: existing.id || crypto.randomUUID(),
    name: String(input.name || existing.name || "").trim(),
    email,
    password: String(input.password || existing.password || "changeme"),
    role: String(input.role || existing.role || "viewer").trim(),
    canEditRoster: Boolean(input.canEditRoster),
    canManageUsers: Boolean(input.canManageUsers)
  };
}

function sanitizeApplication(input, existing = {}) {
  return {
    id: existing.id || crypto.randomUUID(),
    name: String(input.name || existing.name || "").trim(),
    discord: String(input.discord || existing.discord || "").trim(),
    age: String(input.age || existing.age || "").trim(),
    factionCharacter: String(input.factionCharacter || existing.factionCharacter || "").trim(),
    roleplayPhilosophy: String(input.roleplayPhilosophy || existing.roleplayPhilosophy || "").trim(),
    characterDescription: String(input.characterDescription || existing.characterDescription || "").trim(),
    leoExperience: String(input.leoExperience || existing.leoExperience || "").trim(),
    bannedHistory: String(input.bannedHistory || existing.bannedHistory || "").trim(),
    clips: String(input.clips || existing.clips || "").trim(),
    status: String(input.status || existing.status || "pending").trim(),
    submittedAt: existing.submittedAt || new Date().toISOString(),
    reviewedAt: input.reviewedAt || existing.reviewedAt || "",
    reviewedBy: input.reviewedBy || existing.reviewedBy || "",
    rosterEntryId: input.rosterEntryId || existing.rosterEntryId || ""
  };
}

async function serveStatic(req, res) {
  const requestPath = new URL(req.url, `http://${req.headers.host}`).pathname;
  const cleanPath = requestPath === "/" ? "/index.html" : requestPath;
  const filePath = path.normalize(path.join(publicDir, cleanPath));
  if (!filePath.startsWith(publicDir)) {
    send(res, 403, "Forbidden");
    return;
  }

  try {
    const file = await fs.readFile(filePath);
    const ext = path.extname(filePath);
    res.writeHead(200, { "content-type": mimeTypes[ext] || "application/octet-stream" });
    res.end(file);
  } catch {
    const fallback = await fs.readFile(path.join(publicDir, "index.html"));
    res.writeHead(200, { "content-type": mimeTypes[".html"] });
    res.end(fallback);
  }
}

async function handleApi(req, res) {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const user = await currentUser(req);

  if (req.method === "GET" && url.pathname === "/api/roster") {
    const roster = await readJson(rosterPath);
    send(res, 200, roster);
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/session") {
    send(res, 200, { user: publicUser(user) });
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/applications") {
    const payload = await bodyJson(req);
    const next = sanitizeApplication(payload);
    if (!next.name || !next.discord || !next.roleplayPhilosophy || !next.characterDescription || !next.bannedHistory) {
      send(res, 400, { error: "Name, Discord, and all required essay fields are required." });
      return;
    }

    const data = await readJson(applicationsPath);
    data.applications.unshift(next);
    await writeJson(applicationsPath, data);
    send(res, 201, { application: next });
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/login") {
    const credentials = await bodyJson(req);
    const { users } = await readJson(usersPath);
    const matched = users.find(
      (candidate) =>
        candidate.email.toLowerCase() === String(credentials.email || "").trim().toLowerCase() &&
        candidate.password === String(credentials.password || "")
    );
    if (!matched) {
      send(res, 401, { error: "Invalid email or password." });
      return;
    }
    const token = crypto.randomBytes(32).toString("hex");
    sessions.set(token, { userId: matched.id, createdAt: Date.now() });
    send(res, 200, { user: publicUser(matched) }, {
      "set-cookie": `pd_session=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=28800`
    });
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/logout") {
    const token = cookieValue(req, "pd_session");
    if (token) sessions.delete(token);
    send(res, 200, { ok: true }, {
      "set-cookie": "pd_session=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0"
    });
    return;
  }

  if (req.method === "PUT" && url.pathname.startsWith("/api/roster/")) {
    if (!requireEdit(user, res)) return;
    const id = decodeURIComponent(url.pathname.split("/").pop());
    const payload = await bodyJson(req);
    const data = await readJson(rosterPath);
    const index = data.roster.findIndex((entry) => entry.id === id);
    if (index === -1) {
      send(res, 404, { error: "Roster entry not found." });
      return;
    }
    data.roster[index] = sanitizeRosterEntry(payload, data.roster[index]);
    data.updatedAt = new Date().toISOString();
    data.updatedBy = user.email;
    await writeJson(rosterPath, data);
    send(res, 200, data.roster[index]);
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/roster") {
    if (!requireEdit(user, res)) return;
    const payload = await bodyJson(req);
    const data = await readJson(rosterPath);
    const entry = sanitizeRosterEntry(payload);
    data.roster.push(entry);
    data.updatedAt = new Date().toISOString();
    data.updatedBy = user.email;
    await writeJson(rosterPath, data);
    send(res, 201, entry);
    return;
  }

  if (req.method === "DELETE" && url.pathname.startsWith("/api/roster/")) {
    if (!requireEdit(user, res)) return;
    const id = decodeURIComponent(url.pathname.split("/").pop());
    const data = await readJson(rosterPath);
    data.roster = data.roster.filter((entry) => entry.id !== id);
    data.updatedAt = new Date().toISOString();
    data.updatedBy = user.email;
    await writeJson(rosterPath, data);
    send(res, 200, { ok: true });
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/applications/status") {
    const id = url.searchParams.get("id");
    const discord = url.searchParams.get("discord");
    const data = await readJson(applicationsPath);
    const application = id
      ? data.applications.find((a) => a.id === id)
      : discord
        ? data.applications.find((a) => a.discord.toLowerCase() === discord.trim().toLowerCase())
        : null;
    if (!application) {
      send(res, 404, { error: "No application found." });
      return;
    }
    send(res, 200, {
      name: application.name,
      discord: application.discord,
      status: application.status,
      submittedAt: application.submittedAt,
      reviewedAt: application.reviewedAt || ""
    });
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/applications") {
    if (!requireEdit(user, res)) return;
    const applications = await readJson(applicationsPath);
    send(res, 200, applications);
    return;
  }

  if (req.method === "POST" && url.pathname.match(/^\/api\/applications\/[^/]+\/reject$/)) {
    if (!requireEdit(user, res)) return;
    const id = decodeURIComponent(url.pathname.split("/")[3]);
    const data = await readJson(applicationsPath);
    const index = data.applications.findIndex((application) => application.id === id);
    if (index === -1) {
      send(res, 404, { error: "Application not found." });
      return;
    }
    data.applications[index] = sanitizeApplication({
      ...data.applications[index],
      status: "rejected",
      reviewedAt: new Date().toISOString(),
      reviewedBy: user.email
    }, data.applications[index]);
    await writeJson(applicationsPath, data);
    send(res, 200, { application: data.applications[index] });
    return;
  }

  if (req.method === "POST" && url.pathname.match(/^\/api\/applications\/[^/]+\/accept$/)) {
    if (!requireEdit(user, res)) return;
    const id = decodeURIComponent(url.pathname.split("/")[3]);
    const payload = await bodyJson(req);
    const applications = await readJson(applicationsPath);
    const index = applications.applications.findIndex((application) => application.id === id);
    if (index === -1) {
      send(res, 404, { error: "Application not found." });
      return;
    }
    if (applications.applications[index].status === "accepted") {
      send(res, 409, { error: "Application has already been accepted." });
      return;
    }

    const roster = await readJson(rosterPath);
    const application = applications.applications[index];
    const notes = [
      application.discord ? `discord: ${application.discord}` : "",
      application.leoExperience ? `leo exp: ${application.leoExperience}` : ""
    ].filter(Boolean).join(" | ");

    let entry;
    const vacantIndex = payload.vacantEntryId
      ? roster.roster.findIndex((e) => e.id === payload.vacantEntryId)
      : -1;

    if (vacantIndex !== -1) {
      entry = sanitizeRosterEntry({
        ...roster.roster[vacantIndex],
        name: application.name,
        callsign: payload.callsign || roster.roster[vacantIndex].callsign,
        activity: "Active",
        rank: payload.rank || roster.roster[vacantIndex].rank,
        notes,
        promotionDate: payload.promotionDate || new Date().toLocaleDateString("en-US"),
        tig: "",
        vacant: false
      }, roster.roster[vacantIndex]);
      roster.roster[vacantIndex] = entry;
    } else {
      entry = sanitizeRosterEntry({
        callsign: payload.callsign,
        name: application.name,
        activity: "Active",
        rank: payload.rank || "Cadet",
        divisions: {},
        strikes: {},
        notes,
        promotionDate: payload.promotionDate || new Date().toLocaleDateString("en-US"),
        tig: "",
        vacant: false
      });
      roster.roster.push(entry);
    }
    roster.updatedAt = new Date().toISOString();
    roster.updatedBy = user.email;
    await writeJson(rosterPath, roster);

    applications.applications[index] = sanitizeApplication({
      ...application,
      status: "accepted",
      reviewedAt: new Date().toISOString(),
      reviewedBy: user.email,
      rosterEntryId: entry.id
    }, application);
    await writeJson(applicationsPath, applications);
    send(res, 201, { application: applications.applications[index], rosterEntry: entry });
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/users") {
    if (!requireManageUsers(user, res)) return;
    const { users } = await readJson(usersPath);
    send(res, 200, { users: users.map(publicUser) });
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/users") {
    if (!requireManageUsers(user, res)) return;
    const payload = await bodyJson(req);
    const data = await readJson(usersPath);
    const next = sanitizeUser(payload);
    if (!next.email || !next.name) {
      send(res, 400, { error: "Name and email are required." });
      return;
    }
    if (data.users.some((candidate) => candidate.email === next.email)) {
      send(res, 409, { error: "A user with that email already exists." });
      return;
    }
    data.users.push(next);
    await writeJson(usersPath, data);
    send(res, 201, publicUser(next));
    return;
  }

  if (req.method === "PUT" && url.pathname.startsWith("/api/users/")) {
    if (!requireManageUsers(user, res)) return;
    const id = decodeURIComponent(url.pathname.split("/").pop());
    const payload = await bodyJson(req);
    const data = await readJson(usersPath);
    const index = data.users.findIndex((candidate) => candidate.id === id);
    if (index === -1) {
      send(res, 404, { error: "User not found." });
      return;
    }
    data.users[index] = sanitizeUser(payload, data.users[index]);
    await writeJson(usersPath, data);
    send(res, 200, publicUser(data.users[index]));
    return;
  }

  send(res, 404, { error: "Route not found." });
}

async function initDataDir() {
  await fs.mkdir(dataDir, { recursive: true });
  for (const file of ["roster.json", "users.json", "applications.json"]) {
    const dest = path.join(dataDir, file);
    const seed = path.join(seedDir, file);
    try {
      await fs.access(dest);
    } catch {
      await fs.copyFile(seed, dest);
    }
  }
}

const server = http.createServer(async (req, res) => {
  try {
    if (req.url.startsWith("/api/")) {
      await handleApi(req, res);
      return;
    }
    await serveStatic(req, res);
  } catch (error) {
    console.error(error);
    send(res, 500, { error: "Server error." });
  }
});

initDataDir().then(() => {
  server.listen(port, () => {
    console.log(`PD roster running at http://localhost:${port}`);
  });
});
