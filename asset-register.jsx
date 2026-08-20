import { useState, useEffect, useMemo, useRef, useCallback } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import * as XLSX from "xlsx";
import {
  Plus, Search, ArrowLeftRight, Wrench, Archive, Pencil, Trash2, ChevronLeft,
  Download, Upload, X, RotateCcw, CircleDot, AlertCircle, AlertTriangle,
  ChevronRight, Package, ClipboardList, CalendarClock, CalendarCheck, BarChart3, Repeat, Coins, QrCode, ShoppingCart, Receipt, Paperclip, Settings, Building2, Tag, MapPin, Map, Layers
  , Users, LogOut, ShieldCheck
} from "lucide-react";
import UserManagement from "./src/UserManagement.jsx";
import {
  completeMaintenance, createAsset, createCategory, createCompany, createMaintenanceSchedule,
  createProject, createRepair, createRepairPart, deleteAsset, deleteCategory, deleteCompany,
  deleteMaintenanceSchedule, deleteProject, deleteRepairPart, getReceiptUrl, loadOperationalData,
  reinstateAsset, removeReceipt as removeStoredReceipt, retireAsset, saveReceipt, transferAsset,
  updateAsset, updateCategory, updateCompany, updateMaintenanceSchedule, updateProject,
  updateReceiptMetadata, updateRepair, updateRepairPart, upsertProjects,
} from "./src/data/assetManagementService.js";
import { discoverLegacyBrowserData, importLegacySnapshot, parseLegacyBackup } from "./src/data/legacyBrowserImport.js";

/* --------------------------------------------------------------------
   Palette. Repair stages run red → gold → amber → teal → blue, so an
   asset visibly warms back toward "in service" as work advances.
--------------------------------------------------------------------- */
const C = {
  paper: "#E7EAF0", surface: "#FFFFFF", ink: "#141C26", mute: "#69747F",
  rule: "#CCD4DE", ruleSoft: "#E2E7EE", soft: "#FAFBFC",
  active: "#1F5E8C", retired: "#7A8695", due: "#96690F", overdue: "#A6392B", ok: "#2E7D6B",
};
const MONO = 'ui-monospace, SFMono-Regular, Menlo, "Roboto Mono", monospace';
const SANS = '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';

const STAGES = {
  broken: { label: "For repair", avail: "For repair", color: "#A6392B", tint: "#FAEEEC" },
  parts: { label: "Parts purchase", avail: "Awaiting parts", color: "#96690F", tint: "#FBF4E4" },
  ongoing: { label: "Ongoing repair", avail: "Ongoing repair", color: "#AF6318", tint: "#FBF3E9" },
  testing: { label: "Done — for testing", avail: "Under testing", color: "#2E7D6B", tint: "#E9F4F1" },
};
const STAGE_ORDER = ["broken", "parts", "ongoing", "testing"];

const today = () => new Date().toISOString().slice(0, 10);
const num = (v) => { const n = parseFloat(v); return isNaN(n) ? 0 : n; };
const money = (v) => num(v) ? num(v).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : "—";
const money0 = (v) => num(v).toLocaleString(undefined, { maximumFractionDigits: 0 });
const fmt = (d) => {
  if (!d) return "—";
  const dt = new Date(d.length === 10 ? d + "T00:00:00" : d);
  return isNaN(dt) ? d : dt.toLocaleDateString(undefined, { day: "2-digit", month: "short", year: "numeric" });
};
const daysSince = (d) => d ? Math.max(0, Math.round((Date.now() - new Date(d + "T00:00:00")) / 864e5)) : 0;
const daysUntil = (d) => d ? Math.round((new Date(d + "T00:00:00") - new Date(today() + "T00:00:00")) / 864e5) : 9999;
const addInterval = (dateStr, every, unit) => {
  const d = new Date((dateStr || today()) + "T00:00:00");
  const n = Math.max(1, parseInt(every) || 1);
  if (unit === "days") d.setDate(d.getDate() + n);
  else if (unit === "weeks") d.setDate(d.getDate() + n * 7);
  else if (unit === "months") d.setMonth(d.getMonth() + n);
  else d.setFullYear(d.getFullYear() + n);
  return d.toISOString().slice(0, 10);
};
const everyLabel = (p) => `every ${num(p.every) > 1 ? p.every + " " : ""}${num(p.every) > 1 ? p.unit : p.unit.replace(/s$/, "")}`;

const kb = (n) => n > 999_999 ? `${(n / 1_048_576).toFixed(1)} MB` : `${Math.round(n / 1024)} KB`;

const PART_STATES = ["Needed", "Ordered", "Purchased"];

/* CSV quoting alone does not stop spreadsheet formula execution. Text values
   whose first non-whitespace character is a formula marker are prefixed with
   an apostrophe at the very start of the cell so Excel and similar tools keep
   them as text. Actual numbers and Date objects retain their normal value. */
const serializeCsvCell = (value) => {
  const text = value == null ? "" : value instanceof Date ? value.toISOString() : String(value);
  const safe = typeof value === "string" && /^\s*[=+\-@]/.test(text) ? `'${text}` : text;
  return `"${safe.replace(/"/g, '""')}"`;
};

const createCsvContent = (head, rows) => [head, ...rows]
  .map((row) => row.map(serializeCsvCell).join(","))
  .join("\r\n");

/* Leaflet accepts DOM nodes for DivIcon and tooltip content. All database and
   imported values are assigned through textContent, never interpreted as HTML. */
const createMapMarkerContent = (doc, tone, diameter) => {
  const marker = doc.createElement("span");
  marker.className = "qm-pin";
  marker.style.setProperty("--tone", tone);
  marker.style.setProperty("--d", `${diameter}px`);
  marker.append(doc.createElement("i"));
  return marker;
};

const createMapTooltipContent = (doc, site, statusSummary, mutedColor) => {
  const root = doc.createElement("div");
  const heading = doc.createElement("strong");
  heading.textContent = `${site.pid} · ${site.n} asset${site.n === 1 ? "" : "s"}`;
  const label = doc.createElement("span");
  label.style.color = mutedColor;
  label.textContent = String(site.label ?? "");
  const status = doc.createElement("span");
  status.textContent = statusSummary;
  root.append(heading, doc.createElement("br"), label, doc.createElement("br"), status);
  return root;
};

/* Which identifiers a category carries. Matched on the wording rather than an exact
   name, so renaming "Service Vehicles" to "Service Vehicle Class A" — or any other
   variation in spacing, case, or plural — keeps the right fields attached. */
const catKind = (cat) => {
  const c = String(cat || "").toLowerCase();
  if (/motor\s*-?\s*cycle|motorbike/.test(c)) return "motorcycle";
  if (/truck|vehicle|van|pickup/.test(c)) return "vehicle";
  if (/heavy/.test(c)) return "heavy";
  return "other";
};

const VEHICLE_FIELD_DEFS = {
  engine: { label: "Engine number" },
  plate: { label: "Plate number", placeholder: "ABC 1234" },
  mvFile: { label: "MV file number" },
  conduction: { label: "Conduction sticker" },
};
const VEHICLE_ONLY = Object.keys(VEHICLE_FIELD_DEFS);
const vehicleKeys = (cat) => {
  const k = catKind(cat);
  return k === "vehicle" ? ["engine", "plate", "mvFile", "conduction"]
    : k === "motorcycle" ? ["engine", "plate", "mvFile"]
    : [];
};
const serialLabel = (cat) => catKind(cat) === "other" ? "Serial number" : "Serial / chassis number";
const identifierSummary = (cat) => [serialLabel(cat), ...vehicleKeys(cat).map((k) => VEHICLE_FIELD_DEFS[k].label.toLowerCase())].join(", ");
const vehicleFields = (cat, a = {}) => vehicleKeys(cat).map((k) => ({ key: k, mono: true, value: a[k], ...VEHICLE_FIELD_DEFS[k] }));
const clearedVehicle = (cat) => Object.fromEntries(VEHICLE_ONLY.filter((k) => !vehicleKeys(cat).includes(k)).map((k) => [k, ""]));

const CATEGORY_ACTIONS = {
  addCategory: {
    title: "Add category", submit: "Add category",
    note: "Categories group assets for filtering and reporting. They appear on the registration form.",
    fields: (c) => [
      { key: "name", label: "Category name", required: true, full: true, value: c?.name, placeholder: "Air conditioning" },
      { key: "notes", label: "Notes", type: "textarea", full: true, value: c?.notes },
    ],
    validate: (v, x, self) => {
      const n = normKey(v.name);
      return x.categoryNames.some((o) => normKey(o) === n && normKey(o) !== normKey(self?.name || ""))
        ? `A category called "${String(v.name).trim()}" is already on the list.` : null;
    },
  },
};
CATEGORY_ACTIONS.editCategory = {
  ...CATEGORY_ACTIONS.addCategory,
  title: "Edit category", submit: "Save changes",
  note: "Renaming a category updates every asset filed under it.",
};

const NO_PROJECT = "X";
/* "10.3567, 123.9137" — accepts comma, semicolon, or whitespace between the pair. */
const parseCoords = (text) => {
  const m = String(text || "").match(/(-?\d{1,3}(?:\.\d+)?)\s*[,;\s]\s*(-?\d{1,3}(?:\.\d+)?)/);
  if (!m) return null;
  const lat = parseFloat(m[1]), lng = parseFloat(m[2]);
  if (!isFinite(lat) || !isFinite(lng)) return null;
  return Math.abs(lat) <= 90 && Math.abs(lng) <= 180 ? [lat, lng] : null;
};

const PROJECT_ACTIONS = {
  addProject: {
    title: "Add project/location", submit: "Add project/location",
    note: "An ID and the address it stands for. Transfers pick the ID and the address follows.",
    fields: (p) => [
      { key: "pid", label: "Project ID", required: true, mono: true, value: p?.pid, placeholder: "PRJ-014" },
      { key: "location", label: "Address", required: true, full: true, value: p?.location, placeholder: "Brgy. Talamban, Cebu City" },
      { key: "geocode", label: "Geocode", mono: true, full: true, value: p?.geocode, placeholder: "10.3567, 123.9137",
        hint: "Latitude, longitude. Needed to place the project on the Asset Map." },
    ],
    validate: (v, x, self) => {
      const n = normKey(v.pid);
      if (n === normKey(NO_PROJECT)) return `"${NO_PROJECT}" is reserved for anything not on this list.`;
      return x.projectIds.some((o) => normKey(o) === n && normKey(o) !== normKey(self?.pid || ""))
        ? `${String(v.pid).trim()} is already on the list.` : null;
    },
  },
  importProjects: {
    title: "Import project/locations from Excel", submit: "Import file",
    note: "Three columns: Project ID, Address, Geocode. A header row is detected and skipped. Existing IDs are updated rather than duplicated.",
    fields: () => [
      { key: "file", label: "Excel or CSV file", type: "file", accept: ".xlsx,.xls,.csv", required: true, full: true,
        hint: "Geocode is latitude, longitude in one cell — for example 10.3567, 123.9137. Rows without it still import, they just won't plot." },
    ],
  },
};
PROJECT_ACTIONS.editProject = { ...PROJECT_ACTIONS.addProject, title: "Edit project/location", submit: "Save changes", note: "Renaming an ID updates every asset recorded against it." };

/* Reads the first sheet as Project ID / Location / Geocode. Column order is assumed,
   but a header row is detected and skipped so the file can carry titles. */
const readProjectFile = async (file) => {
  const buf = await file.arrayBuffer();
  let wb;
  try { wb = XLSX.read(buf, { type: "array" }); }
  catch { throw new Error("The spreadsheet could not be read. Confirm it is a valid XLSX, XLS, or CSV file."); }
  const sheet = wb.Sheets[wb.SheetNames[0]];
  if (!sheet) throw new Error("That file has no readable sheet.");
  const grid = XLSX.utils.sheet_to_json(sheet, { header: 1, blankrows: false, defval: "" });
  const rows = [];
  const skipped = [];
  grid.forEach((r, i) => {
    const pid = String(r[0] ?? "").trim();
    const location = String(r[1] ?? "").trim();
    const geocode = String(r[2] ?? "").trim();
    if (!pid) return;
    if (i === 0 && /^(project\s*id|id|project)$/i.test(pid)) return;   // header row
    if (!location) { skipped.push(pid); return; }
    rows.push({ pid, location, geocode });
  });
  if (!rows.length) throw new Error("No usable rows found. Expected Project ID in the first column and Address in the second.");
  return { rows, skipped };
};

const companyFields = (c, x) => [
  { key: "name", label: "Company name", required: true, full: true, value: c?.name, placeholder: "Visayas Trading Corp." },
  { key: "code", label: "Short code", mono: true, value: c?.code, placeholder: "VTC" },
  { key: "contact", label: "Contact person", value: c?.contact, list: x.people },
  { key: "address", label: "Address", full: true, value: c?.address },
  { key: "notes", label: "Notes", type: "textarea", full: true, value: c?.notes },
];
const checkCompany = (v, x, self) => {
  const n = normKey(v.name);
  const clash = x.companyNames.some((o) => normKey(o) === n && normKey(o) !== normKey(self?.name || ""));
  return clash ? `A company called "${String(v.name).trim()}" is already on the list.` : null;
};

const COMPANY_ACTIONS = {
  addCompany: {
    title: "Add company", submit: "Add company",
    note: "Assets are registered under a company. Add each owning entity here and it becomes available on the registration form.",
    fields: companyFields, validate: checkCompany,
  },
  editCompany: {
    title: "Edit company", submit: "Save changes",
    note: "Renaming a company updates every asset registered under it.",
    fields: companyFields, validate: checkCompany,
  },
};

const partFields = (p, x) => [
  { key: "ticket", label: "Repair ticket", required: true, type: "select", options: x.openTickets, value: p?.ticket || "" },
  { key: "name", label: "Part", required: true, placeholder: "Battery, 54Wh", full: true },
  { key: "amount", label: "Estimated total amount", type: "number" },
  { key: "supplier", label: "Preferred supplier", list: x.providers },
  { key: "date", label: "Date requested", type: "date", value: today() },
];

const PART_ACTIONS = {
  addPart: {
    title: "Add part", submit: "Add part",
    note: "Parts belong to a repair ticket, so pick the ticket this is for.",
    fields: partFields,
  },
  needPart: {
    title: "Parts needed", submit: "Add part and await purchase",
    note: "The part is logged for buying on the Parts tab, and this ticket moves to Parts purchase. Add the rest from there or from the ticket.",
    fields: partFields,
  },
  order: {
    title: "Mark as ordered", submit: "Mark ordered",
    note: "Use this once the order is placed but the part hasn't arrived or been paid for.",
    fields: (p, x) => [
      { key: "supplier", label: "Supplier", required: true, list: x.providers, value: p.supplier },
      { key: "qty", label: "Quantity", type: "number", value: p.qty || "1" },
      { key: "unit", label: "Quoted unit price", type: "number", value: p.unit },
      { key: "date", label: "Date ordered", type: "date", value: today() },
      { key: "ref", label: "PO / order reference", value: p.ref, mono: true },
    ],
  },
  receipt: {
    title: "Attach receipt", submit: "Save receipt",
    note: "For receipts that turn up after the repair was closed. The purchase amount stays as recorded.",
    fields: (p) => [
      { key: "ref", label: "Receipt / OR number", value: p.ref, mono: true },
      { key: "date", label: "Date on receipt", type: "date", value: p.date },
      { key: "file", label: "Receipt file", type: "file", full: true, required: !p.receipt, hint: p.receipt ? `Currently holding "${p.receipt.name}". Choosing a new file replaces it.` : "Photo or PDF of the official receipt." },
    ],
  },
  purchase: {
    title: "Record purchase", submit: "Save purchase",
    note: "Enter what was actually paid and attach the receipt. Images are compressed before saving.",
    fields: (p, x) => [
      { key: "qty", label: "Quantity", type: "number", required: true, value: p.qty || "1" },
      { key: "unit", label: "Unit price paid", type: "number", required: true, value: p.unit },
      { key: "supplier", label: "Supplier", required: true, list: x.providers, value: p.supplier },
      { key: "date", label: "Date purchased", type: "date", required: true, value: p.state === "Purchased" ? p.date : today() },
      { key: "ref", label: "Receipt / OR number", value: p.ref, mono: true },
      { key: "file", label: "Receipt file", type: "file", full: true, hint: p.receipt ? `Currently holding "${p.receipt.name}". Choosing a new file replaces it.` : "Photo or PDF of the official receipt." },
    ],
  },
};

const STATUS_FILTERS = [
  ["all", "All statuses", C.ink],
  ["active", "Active", C.active],
  ["out", "Broken or in repair", STAGES.broken.color],
  ["retired", "Retired", C.retired],
];
const STAGE_SHORT = { broken: "for repair", parts: "awaiting parts", ongoing: "ongoing repair", testing: "under testing" };

/* repair steps live on their own view, not in the general trail */
const REPAIR_KINDS = ["fault", "parts", "repair", "testing"];
const isRepairEntry = (h) => REPAIR_KINDS.includes(h.kind) || !!h.ticket || /ticket\s+RPR-/i.test(h.sub || "");
/* Transfers are shown in full on the Transfers view, so they don't repeat in the general trail. */
const isMoveEntry = (h) => h.kind === "transfer";

/* the custody chain: every entry that actually moved the asset or changed hands */
const movedAnything = (m) => !m ? false
  : m.toLoc !== m.fromLoc || m.toPer !== m.fromPer || (m.project !== undefined && m.project !== m.fromProject);

const movements = (a) => {
  const raw = (a?.history || []).filter((h) => {
    if (h.move) return movedAnything(h.move);
    return h.kind === "transfer" || h.kind === "register";   // records made before movements were structured
  });
  const sorted = [...raw].sort((x, y) => String(x.date).localeCompare(String(y.date)) || x.ts - y.ts);
  return sorted.map((m, i) => {
    const next = sorted[i + 1];
    const days = next
      ? Math.max(0, Math.round((new Date(next.date + "T00:00:00") - new Date(m.date + "T00:00:00")) / 864e5))
      : daysSince(m.date);
    return { ...m, days, current: !next };
  });
};

/* identifiers that must point at exactly one asset */
const UNIQUE_FIELDS = [
  { key: "tag", label: "Asset number" },
  { key: "code", label: "Asset code" },
  { key: "body", label: "Body number" },
  { key: "serial", label: "Serial number" },
  { key: "engine", label: "Engine number" },
  { key: "plate", label: "Plate number" },
  { key: "mvFile", label: "MV file number" },
  { key: "conduction", label: "Conduction sticker" },
];
const normKey = (v) => String(v ?? "").trim().toLowerCase();
const checkUnique = (v, x, self) => {
  const clashes = UNIQUE_FIELDS.map(({ key, label }) => {
    const val = normKey(v[key]);
    if (!val || !x.unique?.[key]) return null;
    const owner = x.unique[key][val];
    return owner && owner !== self?.tag ? `${label} "${String(v[key]).trim()}" is already on ${owner}.` : null;
  }).filter(Boolean);
  return clashes.length ? clashes.join("\n") : null;
};

const partsTotal = (r) => (r?.parts || []).reduce((s, p) => s + num(p.unit) * (num(p.qty) || 1), 0);
const repairTotal = (r) => partsTotal(r) + num(r?.labor) + num(r?.other);
const planSpend = (p) => (p?.done || []).reduce((s, d) => s + num(d.cost), 0);

/* due status for a schedule */
const dueOf = (p) => {
  const d = daysUntil(p.nextDue);
  if (d < 0) return { key: "overdue", label: `${Math.abs(d)}d overdue`, color: C.overdue, tint: "#FAEEEC", rank: 0 };
  if (d === 0) return { key: "today", label: "Due today", color: C.overdue, tint: "#FAEEEC", rank: 1 };
  if (d <= 7) return { key: "week", label: `In ${d}d`, color: "#AF6318", tint: "#FBF3E9", rank: 2 };
  if (d <= 30) return { key: "month", label: `In ${d}d`, color: C.active, tint: "#EAF1F6", rank: 3 };
  return { key: "later", label: fmt(p.nextDue), color: C.mute, tint: C.soft, rank: 4 };
};

const availOf = (a, job) => {
  if (a.status === "retired") return { key: "retired", label: "Retired", color: C.retired, tint: "#F1F3F6" };
  if (job) return { key: job.stage, label: STAGES[job.stage].avail, color: STAGES[job.stage].color, tint: STAGES[job.stage].tint };
  return { key: "active", label: "Active", color: C.active, tint: "#EAF1F6" };
};

/* ------------------------------ actions ------------------------------ */

const ASSET_ACTIONS = {
  register: {
    title: "Register asset", submit: "Register asset",
    fields: (a, x, v = {}) => {
      const pid = String(v.project || "");
      const proj = x.projects.find((pr) => pr.pid === pid);
      return [
      { key: "tag", label: "Asset number", required: true, value: x.nextTag, mono: true },
      { key: "code", label: "Asset code (QR sticker)", mono: true, placeholder: "Scan or type the sticker code", hint: "The code printed on the QR sticker stuck to this asset" },
      { key: "company", label: "Company", type: "select", options: x.companyNames, required: x.companyNames.length > 0, hint: x.companyNames.length ? null : "Add companies under Settings first" },
      { key: "name", label: "What is it", required: true, placeholder: "Dell Latitude 5440" },
      { key: "category", label: "Category", type: "select", options: x.categoryNames },
      { key: "serial", label: serialLabel(v.category), mono: true },
      ...vehicleFields(v.category),
      { key: "body", label: "Body number", mono: true, placeholder: "BN-14" },
      { key: "project", label: "Project/Location", type: "select",
        options: [NO_PROJECT, ...x.projects.map((pr) => pr.pid)],
        hint: x.projects.length ? "The address is filled in from the list." : `No project/locations set up yet — use ${NO_PROJECT} or add them under Settings.` },
      { key: "location", label: "Address", required: true, placeholder: "Main office — 2F", list: x.locations,
        derivedOn: pid, derived: proj ? proj.location : "",
        readOnly: !!proj,
        hint: proj ? `Looked up from ${proj.pid}. Choose ${NO_PROJECT} if the asset is somewhere that isn't on the list.` : null },
      { key: "custodian", label: "Responsible person", required: true, list: x.people },
      { key: "acquired", label: "Date acquired", type: "date", value: today() },
      { key: "cost", label: "Acquisition cost", type: "number" },
      { key: "notes", label: "Notes", type: "textarea", full: true },
      ];
    },
    validate: checkUnique,
  },
  edit: {
    title: "Edit details", submit: "Save changes",
    fields: (a, x, v = {}) => {
      const cat = v.category ?? a.category ?? "";
      return [
      { key: "tag", label: "Asset number", required: true, value: a.tag, mono: true },
      { key: "code", label: "Asset code (QR sticker)", mono: true, value: a.code, hint: "Change this only if the sticker was replaced" },
      { key: "company", label: "Company", type: "select", options: x.companyNames, value: a.company, required: x.companyNames.length > 0 },
      { key: "name", label: "What is it", required: true, value: a.name },
      { key: "category", label: "Category", type: "select", options: x.categoryNames, value: a.category },
      { key: "serial", label: serialLabel(cat), value: a.serial, mono: true },
      ...vehicleFields(cat, a),
      { key: "body", label: "Body number", value: a.body, mono: true },
      { key: "acquired", label: "Date acquired", type: "date", value: a.acquired },
      { key: "cost", label: "Acquisition cost", type: "number", value: a.cost },
      { key: "notes", label: "Notes", type: "textarea", value: a.notes, full: true },
      ];
    },
    validate: checkUnique,
  },
  transfer: {
    title: "Transfer asset", submit: "Record transfer",
    note: "Move the asset to a new location, a new responsible person, or both.",
    fields: (a, x, v = {}) => {
      const pid = String(v.project || "");
      const proj = x.projects.find((pr) => pr.pid === pid);
      return [
        { key: "project", label: "Project/Location", required: true, type: "select",
          options: [NO_PROJECT, ...x.projects.map((pr) => pr.pid)],
          value: a.project || "",
          hint: x.projects.length ? "The address is filled in from the list." : `No project/locations set up yet — use ${NO_PROJECT} or add them under Settings.` },
        { key: "location", label: "Address", required: true, value: a.location, list: x.locations,
          derivedOn: pid, derived: proj ? proj.location : "",
          readOnly: !!proj,
          hint: proj ? `Looked up from ${proj.pid}. Choose ${NO_PROJECT} if the asset is going somewhere that isn't on the list.`
            : `Not a project site — type the address.` },
        { key: "custodian", label: "New responsible person", required: true, value: a.custodian, list: x.people },
        { key: "date", label: "Effective date", type: "date", value: today() },
        { key: "reason", label: "Reason / reference", placeholder: "Reassignment, memo no.", full: true },
      ];
    },
  },
  retire: {
    title: "Retire asset", submit: "Retire asset",
    note: "The record and its full trail are kept. You can bring the asset back later.",
    fields: () => [
      { key: "reason", label: "Reason", required: true, type: "select", options: ["End of life", "Beyond repair", "Sold", "Donated", "Lost", "Stolen"] },
      { key: "date", label: "Date retired", type: "date", value: today() },
      { key: "detail", label: "Disposal details", type: "textarea", full: true },
    ],
  },
  reinstate: {
    title: "Bring back into service", submit: "Return to service",
    fields: (a, x) => [
      { key: "location", label: "Address", required: true, value: a.location, list: x.locations },
      { key: "custodian", label: "Responsible person", required: true, value: a.custodian, list: x.people },
      { key: "date", label: "Effective date", type: "date", value: today() },
      { key: "reason", label: "Reason", full: true },
    ],
  },
};

const REPAIR_ACTIONS = {
  open: {
    title: "Report fault", submit: "Open repair ticket",
    note: "This marks the asset broken and opens a ticket on the repair board.",
    fields: (a, x) => [
      { key: "fault", label: "Reported fault", required: true, placeholder: "Battery not charging", full: true },
      { key: "reportedBy", label: "Reported by", list: x.people, value: a?.custodian },
      { key: "provider", label: "Service provider / shop", list: x.providers },
      { key: "location", label: "Hold address", value: a?.location, list: x.locations, hint: "Where it sits while out of service" },
      { key: "date", label: "Date reported", type: "date", value: today() },
      { key: "due", label: "Target completion", type: "date" },
    ],
  },
  start: {
    title: "Start repair", submit: "Start repair",
    fields: (a, x) => [
      { key: "technician", label: "Technician", list: x.people, required: true },
      { key: "date", label: "Date started", type: "date", value: today() },
      { key: "note", label: "Note", full: true },
    ],
  },
  testing: {
    title: "Repair done — send to testing", submit: "Send to testing",
    note: "Parts are costed from the parts list. Add labour and any other charge here.",
    fields: (a, x) => [
      { key: "work", label: "Work done", required: true, type: "textarea", full: true, placeholder: "Battery and charging board replaced" },
      { key: "labor", label: "Labour cost", type: "number", value: x.job?.labor },
      { key: "other", label: "Other charges", type: "number", value: x.job?.other, hint: "Transport, diagnostics, service fee" },
      { key: "date", label: "Date completed", type: "date", value: today() },
    ],
  },
  costs: {
    title: "Repair costs", submit: "Save costs",
    note: "Parts are totalled from the parts list. These two lines complete the cost of repair.",
    fields: (a, x) => [
      { key: "labor", label: "Labour cost", type: "number", value: x.job?.labor },
      { key: "other", label: "Other charges", type: "number", value: x.job?.other, hint: "Transport, diagnostics, service fee" },
    ],
  },
  fail: {
    title: "Testing failed", submit: "Send back to repair",
    fields: () => [
      { key: "note", label: "What failed", required: true, type: "textarea", full: true },
      { key: "date", label: "Date", type: "date", value: today() },
    ],
  },
  close: {
    title: "Passed testing — return to service", submit: "Return to service",
    fields: (a, x) => [
      { key: "result", label: "Test result", type: "textarea", full: true, placeholder: "Holds charge for 6 hours, no faults" },
      { key: "location", label: "Returned to", required: true, value: a?.location, list: x.locations },
      { key: "custodian", label: "Released to", required: true, value: a?.custodian, list: x.people },
      { key: "date", label: "Date released", type: "date", value: today() },
    ],
  },
  scrap: {
    title: "Beyond repair", submit: "Close ticket and retire asset",
    note: "Closes the ticket and retires the asset. Costs already logged are kept in reports.",
    fields: () => [
      { key: "reason", label: "Why it can't be repaired", required: true, type: "textarea", full: true },
      { key: "date", label: "Date", type: "date", value: today() },
    ],
  },
  addPart: {
    title: "Add part", submit: "Add part",
    fields: (a, x) => [
      { key: "name", label: "Part", required: true, placeholder: "Battery, 54Wh" },
      { key: "qty", label: "Quantity", type: "number", value: "1" },
      { key: "unit", label: "Unit cost", type: "number" },
      { key: "supplier", label: "Supplier", list: x.providers },
      { key: "state", label: "Status", type: "select", options: ["Needed", "Ordered", "Purchased"], value: "Needed" },
      { key: "date", label: "Date", type: "date", value: today() },
    ],
  },
};

const PLAN_ACTIONS = {
  addPlan: {
    title: "Add maintenance schedule", submit: "Save schedule",
    note: "Recurring work like registration renewal, servicing, or calibration. It reappears automatically each cycle.",
    fields: (s, x) => [
      { key: "assetTag", label: "Asset", required: true, type: "select", options: x.assetTags, value: s?.assetTag || "" },
      { key: "name", label: "What maintenance", required: true, placeholder: "Vehicle registration renewal", list: x.planNames, full: true },
      { key: "every", label: "Repeat every", type: "number", value: "1", required: true },
      { key: "unit", label: "Period", type: "select", options: ["days", "weeks", "months", "years"], value: "years" },
      { key: "nextDue", label: "First / next due", type: "date", required: true, value: today() },
      { key: "provider", label: "Provider or office", list: x.providers },
      { key: "estCost", label: "Estimated cost", type: "number" },
      { key: "notes", label: "Notes", type: "textarea", full: true },
    ],
  },
  editPlan: {
    title: "Edit schedule", submit: "Save changes",
    fields: (s, x) => [
      { key: "name", label: "What maintenance", required: true, value: s.name, full: true },
      { key: "every", label: "Repeat every", type: "number", value: s.every, required: true },
      { key: "unit", label: "Period", type: "select", options: ["days", "weeks", "months", "years"], value: s.unit },
      { key: "nextDue", label: "Next due", type: "date", required: true, value: s.nextDue },
      { key: "provider", label: "Provider or office", list: x.providers, value: s.provider },
      { key: "estCost", label: "Estimated cost", type: "number", value: s.estCost },
      { key: "notes", label: "Notes", type: "textarea", value: s.notes, full: true },
    ],
  },
  logPlan: {
    title: "Record maintenance done", submit: "Record and reschedule",
    note: "The cost goes into the asset's running total, and the next due date is set from the cycle.",
    fields: (s, x) => [
      { key: "date", label: "Date completed", type: "date", required: true, value: today() },
      { key: "cost", label: "Cost", type: "number", value: s.estCost },
      { key: "provider", label: "Done by / provider", list: x.providers, value: s.provider },
      { key: "ref", label: "Reference / receipt no.", mono: true },
      { key: "notes", label: "What was done", type: "textarea", full: true },
      { key: "nextDue", label: "Next due", type: "date", required: true, value: addInterval(today(), s.every, s.unit), hint: "Set from the repeat cycle — change it if the office gives a different date" },
    ],
  },
};

const TRAIL = { register: C.ink, transfer: C.active, fault: STAGES.broken.color, parts: STAGES.parts.color, repair: STAGES.ongoing.color, testing: STAGES.testing.color, restore: C.active, retire: C.retired, edit: C.mute, maintenance: C.ok };
const PART_COLOR = { Needed: "#A6392B", Ordered: "#96690F", Purchased: "#2E7D6B" };

/* ------------------------------ atoms ------------------------------ */

const Label = ({ children }) => (
  <div style={{ fontFamily: MONO, fontSize: 10, letterSpacing: "0.14em", color: C.mute }} className="uppercase mb-1">{children}</div>
);
const Dot = ({ color, size = 7 }) => (
  <span style={{ width: size, height: size, background: color, borderRadius: 999 }} className="inline-block shrink-0" />
);
const Chip = ({ color, tint, children, big }) => (
  <span className="inline-flex items-center gap-2" style={{
    background: tint, color, border: `1px solid ${color}33`, borderRadius: 2,
    padding: big ? "5px 10px" : "3px 8px", fontFamily: MONO, fontSize: big ? 11 : 10,
    letterSpacing: "0.12em", textTransform: "uppercase", fontWeight: 600, whiteSpace: "nowrap",
  }}><Dot color={color} size={big ? 7 : 6} />{children}</span>
);

function Btn({ children, onClick, icon: Icon, kind = "ghost", small, disabled }) {
  const s = {
    solid: { background: C.ink, color: "#fff", border: `1px solid ${C.ink}` },
    ghost: { background: C.surface, color: C.ink, border: `1px solid ${C.rule}` },
    danger: { background: C.surface, color: "#A03024", border: `1px solid ${C.rule}` },
  }[kind];
  return (
    <button onClick={disabled ? undefined : onClick} disabled={disabled} className="inline-flex items-center gap-2 transition-opacity hover:opacity-75 disabled:opacity-40 disabled:hover:opacity-40"
      style={{ ...s, borderRadius: 2, fontFamily: SANS, fontSize: small ? 12.5 : 14, padding: small ? "5px 9px" : "8px 12px", cursor: disabled ? "not-allowed" : "pointer", whiteSpace: "nowrap" }}>
      {Icon && <Icon size={small ? 13 : 14} strokeWidth={2} />}{children}
    </button>
  );
}

const inputStyle = { width: "100%", padding: "8px 10px", border: `1px solid ${C.rule}`, borderRadius: 2, background: C.surface, color: C.ink, fontSize: 14, fontFamily: SANS, outline: "none" };

function Field({ f, value, onChange, bad }) {
  const base = { ...inputStyle, fontFamily: f.mono ? MONO : SANS, border: `1px solid ${bad ? STAGES.broken.color : C.rule}`, background: bad ? STAGES.broken.tint : C.surface };
  return (
    <div className={f.full ? "col-span-2" : "col-span-2 sm:col-span-1"}>
      <Label>{f.label}{f.required && <span style={{ color: STAGES.broken.color }}> *</span>}</Label>
      {f.type === "textarea" ? (
        <textarea rows={f.rows || 2} style={base} value={value} placeholder={f.placeholder} onChange={(e) => onChange(e.target.value)} />
      ) : f.type === "select" ? (
        <select style={base} value={value} onChange={(e) => onChange(e.target.value)}>
          <option value="">—</option>{f.options.map((o) => <option key={o} value={o}>{o}</option>)}
        </select>
      ) : f.type === "file" ? (
        <div>
          <input type="file" accept={f.accept || "image/*,application/pdf"}
            onChange={(e) => onChange(e.target.files?.[0] || "")}
            style={{ ...base, padding: "7px 8px", fontSize: 12.5 }} />
          {value && value.name && (
            <div className="flex items-center gap-1.5 mt-1" style={{ fontSize: 12, color: C.ok }}>
              <Paperclip size={12} />{value.name} · {kb(value.size)}
            </div>
          )}
        </div>
      ) : (<>
        <input type={f.type || "text"} style={{ ...base, ...(f.readOnly ? { background: C.soft, color: C.mute, cursor: "not-allowed" } : {}) }}
          value={value} list={f.readOnly || !f.list ? undefined : `dl-${f.key}`} readOnly={f.readOnly}
          placeholder={f.placeholder} onChange={(e) => onChange(e.target.value)} />
        {f.list && <datalist id={`dl-${f.key}`}>{f.list.map((o) => <option key={o} value={o} />)}</datalist>}
      </>)}
      {f.hint && <div className="mt-1" style={{ fontSize: 11, color: C.mute }}>{f.hint}</div>}
    </div>
  );
}

function Dialog({ def, subject, header, ctx, onCancel, onSubmit, busy = false }) {
  /* Initial pass seeds the values; every render after that rebuilds the field list
     from what's been typed, so a field can appear once its trigger is chosen. */
  const seed = useMemo(() => def.fields(subject || {}, ctx, {}), [def, subject, ctx]);
  const [vals, setVals] = useState(() => Object.fromEntries(seed.map((f) => [f.key, f.value ?? ""])));
  const [err, setErr] = useState("");
  const fields = def.fields(subject || {}, ctx, vals);

  /* A field may declare `derived` plus the `derivedOn` trigger it follows. Apply
     derived changes inside the originating input update rather than a render effect,
     avoiding a second cascading render and keeping the trigger/value pair atomic. */
  const derivedRef = useRef(null);
  if (derivedRef.current === null) {
    derivedRef.current = Object.fromEntries(fields.filter((f) => "derivedOn" in f).map((f) => [f.key, f.derivedOn]));
  }
  const changeField = (key, value) => {
    setVals((current) => {
      const next = { ...current, [key]: value };
      def.fields(subject || {}, ctx, next).forEach((f) => {
        if (!("derivedOn" in f) || derivedRef.current[f.key] === f.derivedOn) return;
        derivedRef.current[f.key] = f.derivedOn;
        if (f.derived !== undefined) next[f.key] = f.derived;
      });
      return next;
    });
    setErr("");
  };
  const dupe = def.validate ? def.validate(vals, ctx, subject || {}) : null;
  const clashKeys = dupe ? UNIQUE_FIELDS.filter(({ label }) => dupe.includes(label)).map((u) => u.key) : [];
  const go = () => {
    if (dupe) return setErr("");
    const miss = fields.filter((f) => f.required && !String(vals[f.key] || "").trim());
    if (miss.length) return setErr(`Fill in ${miss.map((m) => m.label.toLowerCase()).join(", ")}.`);
    onSubmit(Object.fromEntries(fields.map((f) => [f.key, vals[f.key] ?? ""])));
  };
  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center sm:p-6" style={{ background: "rgba(20,28,38,0.45)" }} onClick={busy ? undefined : onCancel}>
      <div onClick={(e) => e.stopPropagation()} className="w-full overflow-y-auto"
        style={{ maxWidth: 620, maxHeight: "92vh", background: C.surface, borderRadius: 2, border: `1px solid ${C.rule}` }}>
        <div className="flex items-start justify-between px-5 py-4" style={{ borderBottom: `1px solid ${C.ruleSoft}` }}>
          <div>
            <div style={{ fontSize: 17, fontWeight: 600 }}>{def.title}</div>
            {header && <div className="mt-0.5 uppercase" style={{ fontFamily: MONO, fontSize: 11, color: C.mute, letterSpacing: "0.08em" }}>{header}</div>}
          </div>
          <button onClick={onCancel} disabled={busy} style={{ color: C.mute }} className="p-1 hover:opacity-60 disabled:opacity-40"><X size={18} /></button>
        </div>
        {def.note && <div className="px-5 pt-4" style={{ fontSize: 13, color: C.mute, lineHeight: 1.5 }}>{def.note}</div>}
        <div className="grid grid-cols-2 gap-x-4 gap-y-3 p-5">
          {fields.map((f) => <Field key={f.key} f={f} bad={clashKeys.includes(f.key)} value={vals[f.key] ?? ""} onChange={(v) => changeField(f.key, v)} />)}
        </div>
        {(dupe || err) && (
          <div className="mx-5 mb-3 flex items-start gap-2 px-3 py-2" style={{ background: STAGES.broken.tint, color: STAGES.broken.color, fontSize: 13, whiteSpace: "pre-line", lineHeight: 1.45 }}>
            <AlertCircle size={14} style={{ marginTop: 2, flexShrink: 0 }} />
            <span>{dupe || err}{dupe ? "\nEach of these belongs to one asset only. Change it, or open the existing record instead." : ""}</span>
          </div>
        )}
        <div className="flex justify-end gap-2 px-5 py-4" style={{ borderTop: `1px solid ${C.ruleSoft}`, background: C.soft }}>
          <Btn onClick={onCancel} disabled={busy}>Cancel</Btn><Btn kind="solid" onClick={go} disabled={!!dupe || busy}>{busy ? "Saving…" : def.submit}</Btn>
        </div>
      </div>
    </div>
  );
}

const Trail = ({ entries }) => (
  <div className="mt-3">
    {[...entries].reverse().map((h, i, arr) => (
      <div key={h.ts + "" + i} className="flex gap-3">
        <div style={{ width: 74, flexShrink: 0, fontFamily: MONO, fontSize: 11, color: C.mute, paddingTop: 1 }}>{fmt(h.date)}</div>
        <div className="flex flex-col items-center" style={{ width: 12 }}>
          <CircleDot size={11} style={{ color: TRAIL[h.kind] || C.mute, flexShrink: 0 }} />
          {i < arr.length - 1 && <div style={{ width: 1, flex: 1, background: C.rule, minHeight: 18 }} />}
        </div>
        <div className="pb-4 min-w-0 flex-1">
          <div style={{ fontSize: 13.5 }}>{h.text}</div>
          {h.sub && <div style={{ fontSize: 12.5, color: C.mute, marginTop: 1 }}>{h.sub}</div>}
        </div>
      </div>
    ))}
  </div>
);

/* ------------------------------- app ------------------------------- */

export default function AssetRegister({ currentUser, access, onSignOut }) {
  const [assets, setAssets] = useState([]);
  const [repairs, setRepairs] = useState([]);
  const [plans, setPlans] = useState([]);
  const [companies, setCompanies] = useState([]);
  const [categories, setCategories] = useState([]);
  const [projects, setProjects] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [loadErr, setLoadErr] = useState("");
  const [saveErr, setSaveErr] = useState("");
  const [tab, setTab] = useState("assets");
  const [sel, setSel] = useState(null);
  const [job, setJob] = useState(null);
  const [q, setQ] = useState("");
  const [filter, setFilter] = useState("all");
  const [cat, setCat] = useState("");
  const [loc, setLoc] = useState("");
  const [comp, setComp] = useState("");
  const [showClosed, setShowClosed] = useState(false);
  const [dlg, setDlg] = useState(null);
  const [confirm, setConfirm] = useState(null);
  const [viewer, setViewer] = useState(null);
  const [notice, setNotice] = useState("");
  const [legacyBrowserData, setLegacyBrowserData] = useState(null);
  const fileRef = useRef(null);

  const permissionSet = useMemo(() => new Set(access?.permissions || []), [access]);
  const can = (permission) => permissionSet.has(permission);
  const isSuperAdmin = access?.is_super_admin === true;
  const allowedCompanyIds = useMemo(() => new Set(access?.company_ids || []), [access]);
  const allowedCompanyNames = useMemo(() => new Set((access?.company_names || []).map(normKey)), [access]);
  const allowedGroupIds = useMemo(() => new Set(access?.asset_group_ids || []), [access]);
  const allowedGroupNames = useMemo(() => new Set((access?.asset_group_names || []).map(normKey)), [access]);

  const scopeAllowsAsset = useCallback((asset) => {
    if (isSuperAdmin) return true;
    const companyAllowed = access?.all_companies
      || allowedCompanyIds.has(asset.companyId || asset.company_id)
      || allowedCompanyNames.has(normKey(asset.company));
    const groupAllowed = access?.all_asset_groups
      || allowedGroupIds.has(asset.categoryId || asset.category_id)
      || allowedGroupNames.has(normKey(asset.category));
    return Boolean(companyAllowed && groupAllowed);
  }, [isSuperAdmin, access, allowedCompanyIds, allowedCompanyNames, allowedGroupIds, allowedGroupNames]);

  const allowedAssets = useMemo(
    () => assets.filter(scopeAllowsAsset),
    [assets, scopeAllowsAsset],
  );
  const allowedAssetIds = useMemo(() => new Set(allowedAssets.map((asset) => asset.id)), [allowedAssets]);
  const allowedRepairs = useMemo(() => repairs.filter((repair) => allowedAssetIds.has(repair.assetId)), [repairs, allowedAssetIds]);
  const allowedPlans = useMemo(() => plans.filter((plan) => allowedAssetIds.has(plan.assetId)), [plans, allowedAssetIds]);
  const allowedCompanies = useMemo(() => companies.filter((company) => isSuperAdmin || access?.all_companies
    || allowedCompanyIds.has(company.id) || allowedCompanyNames.has(normKey(company.name))),
  [companies, isSuperAdmin, access, allowedCompanyIds, allowedCompanyNames]);
  const allowedCategories = useMemo(() => categories.filter((category) => isSuperAdmin || access?.all_asset_groups
    || allowedGroupIds.has(category.id) || allowedGroupNames.has(normKey(category.name))),
  [categories, isSuperAdmin, access, allowedGroupIds, allowedGroupNames]);

  const reloadOperationalData = useCallback(async () => {
    setRefreshing(true);
    setLoadErr("");
    try {
      const data = await loadOperationalData();
      setAssets(data.assets); setRepairs(data.repairs); setPlans(data.plans);
      setCompanies(data.companies); setCategories(data.categories); setProjects(data.projects);
      return data;
    } catch (error) {
      setLoadErr(error.message || "The Supabase register could not be loaded.");
      throw error;
    } finally {
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    let active = true;
    loadOperationalData()
      .then((data) => {
        if (!active) return;
        setAssets(data.assets); setRepairs(data.repairs); setPlans(data.plans);
        setCompanies(data.companies); setCategories(data.categories); setProjects(data.projects);
      })
      .catch((error) => {
        if (active) setLoadErr(error.message || "The Supabase register could not be loaded.");
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => { active = false; };
  }, []);

  useEffect(() => {
    if (!isSuperAdmin) return;
    discoverLegacyBrowserData().then((found) => {
      setLegacyBrowserData(found);
      if (found?.snapshot) {
        const counts = found.counts;
        setNotice(`Legacy ${found.source} data found (${counts.assets} assets, ${counts.repairs} repairs, ${counts.maintenance} schedules, ${counts.receipts} receipts). It has not been imported or deleted.`);
      }
    }).catch(() => {});
  }, [isSuperAdmin]);

  const runServerMutation = async (operation, successMessage = "") => {
    setSaving(true); setSaveErr("");
    try {
      const result = await operation();
      await reloadOperationalData();
      if (successMessage) setNotice(successMessage);
      return result;
    } catch (error) {
      setSaveErr(error.message || "Supabase rejected the change. Your input was not recorded as saved.");
      await reloadOperationalData().catch(() => {});
      throw error;
    } finally {
      setSaving(false);
    }
  };

  const openJob = useCallback(
    (assetId) => allowedRepairs.find((r) => r.assetId === assetId && !r.closed) || null,
    [allowedRepairs],
  );
  const assetOf = (x) => allowedAssets.find((a) => a.id === x?.assetId);
  const current = allowedAssets.find((a) => a.id === sel) || null;
  const currentJob = job ? allowedRepairs.find((r) => r.id === job) : null;
  const openTickets = allowedRepairs.filter((r) => !r.closed);
  const pendingParts = allowedRepairs.flatMap((r) => r.closed ? [] : (r.parts || [])).filter((p) => p.state !== "Purchased").length;
  const plansOf = (id) => allowedPlans.filter((p) => p.assetId === id);
  const duePlans = allowedPlans.filter((p) => daysUntil(p.nextDue) <= 30);

  const ctx = useMemo(() => {
    const uniq = (k) => [...new Set(allowedAssets.map((x) => x[k]).filter(Boolean))].sort();
    const n = assets.map((a) => parseInt(String(a.tag).replace(/\D/g, ""), 10)).filter((x) => !isNaN(x));
    return {
      locations: uniq("location"), people: uniq("custodian"),
      companyNames: allowedCompanies.map((c) => c.name).sort(),
      categoryNames: allowedCategories.map((c) => c.name).sort((a, b) => a.localeCompare(b)),
      projects: [...projects].sort((a, b) => String(a.pid).localeCompare(String(b.pid))),
      projectIds: projects.map((pr) => pr.pid),
      providers: [...new Set([...allowedRepairs.flatMap((r) => [r.provider, ...(r.parts || []).map((p) => p.supplier)]), ...allowedPlans.map((p) => p.provider), ...allowedPlans.flatMap((p) => (p.done || []).map((d) => d.provider))].filter(Boolean))].sort(),
      planNames: [...new Set([...allowedPlans.map((p) => p.name), "Annual servicing", "Vehicle registration renewal", "Insurance renewal", "Preventive maintenance", "Calibration", "Cleaning and tune-up"])].sort(),
      assetTags: allowedAssets.filter((a) => a.status !== "retired").map((a) => `${a.tag} — ${a.name}`),
      openTickets: allowedRepairs.filter((r) => !r.closed).map((r) => {
        const a = allowedAssets.find((x) => x.id === r.assetId);
        return `${r.ticket} · ${a?.tag || "?"} · ${r.fault}`;
      }),
      unique: Object.fromEntries(UNIQUE_FIELDS.map(({ key }) => [
        key, Object.fromEntries(allowedAssets.filter((a) => normKey(a[key])).map((a) => [normKey(a[key]), a.tag])),
      ])),
      nextTag: `AST-${(n.length ? Math.max(...n) + 1 : 1).toString().padStart(4, "0")}`,
      job: currentJob,
    };
  }, [assets, allowedAssets, allowedRepairs, allowedPlans, allowedCompanies, allowedCategories, projects, currentJob]);

  /* search + dropdowns narrow the pool; the status chips then split whatever is left */
  const scoped = useMemo(() => {
    const t = q.trim().toLowerCase();
    return allowedAssets
      .filter((a) => (!cat || a.category === cat) && (!loc || a.location === loc) && (!comp || a.company === comp))
      .filter((a) => !t || [a.tag, a.code, a.name, a.serial, a.engine, a.plate, a.mvFile, a.conduction, a.body, a.location, a.custodian, a.category, a.company].some((v) => String(v || "").toLowerCase().includes(t)));
  }, [allowedAssets, q, cat, loc, comp]);

  const bucketOf = useCallback((a) => {
    const k = availOf(a, openJob(a.id)).key;
    return k === "retired" ? "retired" : k === "active" ? "active" : "out";
  }, [openJob]);

  /* headline figures for the whole register — these ignore the filters below them */
  const totals = useMemo(() => {
    const t = { all: allowedAssets.length, active: 0, out: 0, retired: 0 };
    allowedAssets.forEach((a) => { t[bucketOf(a)]++; });
    return t;
  }, [allowedAssets, bucketOf]);

  /* how the out-of-service assets split across repair stages */
  const stageMix = useMemo(() => {
    const m = { broken: 0, parts: 0, ongoing: 0, testing: 0 };
    allowedAssets.forEach((a) => { const j = openJob(a.id); if (j && a.status !== "retired") m[j.stage]++; });
    return m;
  }, [allowedAssets, openJob]);

  const counts = useMemo(() => {
    const c = { all: scoped.length, active: 0, out: 0, retired: 0 };
    scoped.forEach((a) => { c[bucketOf(a)]++; });
    return c;
  }, [scoped, bucketOf]);

  const shown = useMemo(() => scoped
    .filter((a) => filter === "all" || bucketOf(a) === filter)
    .sort((a, b) => String(a.tag).localeCompare(String(b.tag))), [scoped, filter, bucketOf]);

  /* A scanner types the sticker code in one burst; an exact match opens it. */
  const handleAssetQuery = (value) => {
    setQ(value);
    const t = value.trim().toLowerCase();
    if (!t) return;
    const hit = allowedAssets.find((a) => a.code && String(a.code).trim().toLowerCase() === t);
    if (hit) { setSel(hit.id); setTab("assets"); }
  };

  /* ---------- writers ---------- */
  const requirePermission = (permission, label) => {
    if (can(permission)) return true;
    setSaveErr(`Your role does not allow ${label || permission}.`);
    setDlg(null);
    return false;
  };
  const companyIdFor = (name) => companies.find((item) => normKey(item.name) === normKey(name))?.id || null;
  const categoryIdFor = (name) => categories.find((item) => normKey(item.name) === normKey(name))?.id || null;
  const projectIdFor = (code) => projects.find((item) => normKey(item.pid) === normKey(code))?.id || null;

  const runAsset = async (name, vals) => {
    const permission = name === "register" ? "asset.create" : name === "transfer" ? "asset.transfer" : ["retire", "reinstate"].includes(name) ? "asset.retire" : "asset.update";
    if (!requirePermission(permission, ASSET_ACTIONS[name].title.toLowerCase())) return;
    try {
      const scoped = {
        ...vals,
        ...(["register", "edit"].includes(name) ? clearedVehicle(vals.category) : {}),
        companyId: companyIdFor(vals.company),
        categoryId: categoryIdFor(vals.category),
        projectId: ["register", "transfer"].includes(name) ? projectIdFor(vals.project) : name === "edit" ? current.projectId : null,
      };
      let result;
      if (name === "register") result = await runServerMutation(() => createAsset(scoped), "Asset registered in Supabase.");
      else if (name === "edit") await runServerMutation(() => updateAsset(current.id, { ...current, ...scoped }), "Asset updated.");
      else if (name === "transfer") await runServerMutation(() => transferAsset(current, scoped), "Transfer recorded.");
      else if (name === "retire") await runServerMutation(() => retireAsset(current.id, vals), "Asset retired with its history preserved.");
      else await runServerMutation(() => reinstateAsset(current.id, { ...vals, projectId: current.projectId }), "Asset returned to service.");
      if (result?.id) setSel(result.id);
      setDlg(null);
    } catch { /* keep the form open with its unsaved values */ }
  };

  const runRepair = async (name, vals) => {
    const permission = name === "open" ? "repair.create" : name === "costs" ? "repair.cost" : ["close", "scrap"].includes(name) ? "repair.close" : name === "addPart" ? "parts.manage" : "repair.process";
    if (!requirePermission(permission, REPAIR_ACTIONS[name].title.toLowerCase())) return;
    if (name === "scrap" && !requirePermission("asset.retire", "retiring an asset beyond repair")) return;
    const aId = dlg.assetId, jId = dlg.jobId;
    try {
      if (name === "open") {
        const created = await runServerMutation(() => createRepair(aId, vals), "Repair ticket opened.");
        setJob(created.id);
      } else if (name === "start") await runServerMutation(() => updateRepair(jId, { stage: "ongoing", technician_name: vals.technician, started_on: vals.date, work_done: vals.note || null }), "Repair started.");
      else if (name === "testing") await runServerMutation(() => updateRepair(jId, { stage: "testing", work_done: vals.work, repair_completed_on: vals.date, ...(can("repair.cost") ? { labor_cost: num(vals.labor), other_cost: num(vals.other) } : {}) }), "Repair sent to testing.");
      else if (name === "costs") await runServerMutation(() => updateRepair(jId, { labor_cost: num(vals.labor), other_cost: num(vals.other) }), "Repair costs updated.");
      else if (name === "fail") await runServerMutation(() => updateRepair(jId, { stage: "ongoing", test_result: `Testing failed — ${vals.note}` }), "Ticket returned to repair.");
      else if (name === "close") { await runServerMutation(() => updateRepair(jId, { stage: "closed", outcome: "returned_to_service", closed_on: vals.date, test_result: vals.result || null, return_address: vals.location, returned_to_name: vals.custodian }), "Repair closed and asset returned."); setJob(null); }
      else if (name === "scrap") { await runServerMutation(() => updateRepair(jId, { stage: "closed", outcome: "retired", closed_on: vals.date, closure_reason: vals.reason }), "Repair closed and asset retired."); setJob(null); }
      else if (name === "addPart") await runServerMutation(() => createRepairPart(jId, vals), "Repair part added.");
      setDlg(null);
    } catch { /* preserve the dialog input */ }
  };

  const runPlan = async (name, vals) => {
    if (!requirePermission("maintenance.manage", "changing maintenance schedules")) return;
    try {
      if (name === "addPlan") {
        const tag = String(vals.assetTag).split(" — ")[0];
        const asset = assets.find((item) => item.tag === tag);
        if (!asset) throw new Error("The selected asset is no longer available.");
        await runServerMutation(() => createMaintenanceSchedule(asset.id, vals), "Maintenance schedule created.");
      } else if (name === "editPlan") await runServerMutation(() => updateMaintenanceSchedule(dlg.planId, vals), "Maintenance schedule updated.");
      else await runServerMutation(() => completeMaintenance(dlg.planId, vals), "Maintenance completion recorded and rescheduled.");
      setDlg(null);
    } catch { /* preserve the dialog input */ }
  };

  const runCompany = async (name, vals) => {
    if (!requirePermission("companies.manage", "changing companies")) return;
    try { await runServerMutation(() => name === "addCompany" ? createCompany(vals) : updateCompany(dlg.companyId, vals), name === "addCompany" ? "Company created." : "Company updated."); setDlg(null); }
    catch { /* preserve input */ }
  };

  const runCategory = async (name, vals) => {
    if (!requirePermission("asset_groups.manage", "changing asset groups")) return;
    try { await runServerMutation(() => name === "addCategory" ? createCategory(vals) : updateCategory(dlg.categoryId, vals), name === "addCategory" ? "Asset group created." : "Asset group updated."); setDlg(null); }
    catch { /* preserve input */ }
  };

  const runProject = async (name, vals) => {
    if (!requirePermission("projects.manage", "changing project locations")) return;
    if (name === "importProjects") {
      setDlg(null);
      try {
        const { rows, skipped } = await readProjectFile(vals.file);
        const { added, updated } = await runServerMutation(() => upsertProjects(rows, projects));
        const noGeo = rows.filter((r) => !parseCoords(r.geocode)).length;
        setNotice([
          `${added} project${added === 1 ? "" : "s"} added, ${updated} updated.`,
          noGeo ? `${noGeo} without a usable geocode — they won't appear on the map until one is set.` : "",
          skipped.length ? `${skipped.length} row${skipped.length === 1 ? "" : "s"} skipped for a missing address: ${skipped.slice(0, 5).join(", ")}${skipped.length > 5 ? "…" : ""}` : "",
        ].filter(Boolean).join(" "));
      } catch (e) {
        setSaveErr(e.message || "That file could not be read.");
      }
      return;
    } else {
      try { await runServerMutation(() => name === "addProject" ? createProject(vals) : updateProject(dlg.projectId, vals), name === "addProject" ? "Project/location created." : "Project/location updated."); setDlg(null); }
      catch { /* preserve input */ }
    }
  };

  const runPart = async (name, vals) => {
    const permission = ["order", "purchase", "receipt"].includes(name) ? "purchasing.manage" : "parts.manage";
    if (!requirePermission(permission, "changing repair parts")) return;
    try {
      if (name === "addPart" || name === "needPart") {
        const tk = String(vals.ticket).split(" · ")[0];
        const j = repairs.find((r) => r.ticket === tk);
        if (!j) throw new Error("The selected repair ticket is no longer available.");
        await runServerMutation(async () => { await createRepairPart(j.id, { ...vals, qty: 1, estimated: vals.amount, state: "Needed" }); if (name === "needPart") await updateRepair(j.id, { stage: "parts" }); }, "Repair part request recorded.");
      } else {
        const j = repairs.find((r) => r.id === dlg.jobId);
        const was = (j?.parts || []).find((p) => p.id === dlg.partId) || {};
        await runServerMutation(async () => {
          if (name !== "receipt") await updateRepairPart(was.id, { ...was, ...vals, state: name === "order" ? "Ordered" : "Purchased" });
          if (vals.file) await saveReceipt(was.id, vals.file, vals, was.receipt);
          else if (name === "receipt" && was.receipt) await updateReceiptMetadata(was.receipt.id, vals);
        }, name === "order" ? "Part marked ordered." : name === "receipt" ? "Receipt updated." : "Purchase recorded.");
      }
      setDlg(null);
    } catch (e) {
      setSaveErr(e.message || "That receipt could not be saved.");
    }
  };

  const removeReceipt = async (jobId, partId, meta) => {
    if (!requirePermission("purchasing.manage", "removing purchase receipts")) return;
    try { await runServerMutation(() => removeStoredReceipt(meta), "Receipt removed."); setViewer(null); }
    catch { /* viewer remains open */ }
  };

  const dropPart = async (jId, pId, part) => {
    if (!requirePermission("parts.manage", "removing repair parts")) return;
    try { await runServerMutation(async () => { if (part?.receipt) await removeStoredReceipt(part.receipt); await deleteRepairPart(pId); }, "Repair part removed."); }
    catch { /* server state is reloaded by the mutation wrapper */ }
  };

  /* ---------- files ---------- */
  const dl = (blob, name) => { const u = URL.createObjectURL(blob); const a = document.createElement("a"); a.href = u; a.download = name; a.click(); URL.revokeObjectURL(u); };
  const downloadImportReport = (report, source) => dl(new Blob([JSON.stringify({ source, completedAt: new Date().toISOString(), ...report }, null, 2)], { type: "application/json" }), `legacy-import-report-${today()}.json`);
  const csv = (head, rows, name) => dl(new Blob([createCsvContent(head, rows)], { type: "text/csv;charset=utf-8" }), name);
  const exportCsv = () => {
    if (!requirePermission("reports.export", "exporting data")) return;
    if (tab === "repairs") csv(["ticket", "asset", "name", "fault", "stage", "provider", "technician", "reported", "parts", "labour", "other", "total"],
      allowedRepairs.map((r) => { const a = assetOf(r) || {}; return [r.ticket, a.tag, a.name, r.fault, r.closed ? "Closed" : STAGES[r.stage].label, r.provider, r.technician, r.date, partsTotal(r), num(r.labor), num(r.other), repairTotal(r)]; }), `repairs-${today()}.csv`);
    else if (tab === "parts") csv(["ticket", "asset", "part", "status", "qty", "unit_price", "line_total", "supplier", "reference", "date", "receipt"],
      allowedRepairs.flatMap((r) => (r.parts || []).map((p) => { const a = assetOf(r) || {};
        return [r.ticket, a.tag, p.name, p.state, num(p.qty) || 1, num(p.unit), num(p.unit) * (num(p.qty) || 1), p.supplier, p.ref, p.date, p.receipt ? p.receipt.name : "none"]; })),
      `parts-${today()}.csv`);
    else if (tab === "maintenance") csv(["asset", "name", "schedule", "every", "next_due", "status", "last_done", "provider", "times_done", "total_spent"],
      allowedPlans.map((p) => { const a = allowedAssets.find((x) => x.id === p.assetId) || {}; return [a.tag, a.name, p.name, everyLabel(p), p.nextDue, dueOf(p).label, p.lastDone || "", p.provider, (p.done || []).length, planSpend(p)]; }), `maintenance-${today()}.csv`);
    else csv(["tag", "asset_code", "company", "project_location", "name", "category", "serial_or_chassis", "engine_no", "plate_no", "mv_file_no", "conduction_sticker", "body_no", "address", "custodian", "acquired", "cost", "availability", "notes"],
      allowedAssets.map((a) => [a.tag, a.code, a.company, a.project || NO_PROJECT, a.name, a.category, a.serial, a.engine, a.plate, a.mvFile, a.conduction, a.body, a.location, a.custodian, a.acquired, a.cost, availOf(a, openJob(a.id)).label, a.notes]), `assets-${today()}.csv`);
  };
  const exportJson = async () => {
    if (!isSuperAdmin) return setSaveErr("Only a Super Admin can export the complete authorized register.");
    dl(new Blob([JSON.stringify({ source: "supabase", exportedAt: new Date().toISOString(), assets, repairs, plans, companies, categories, projects, receiptFiles: "Stored privately in Supabase Storage; export contains metadata only." }, null, 2)], { type: "application/json" }), `supabase-register-backup-${today()}.json`);
  };
  const importJson = (e) => {
    if (!isSuperAdmin) return setSaveErr("Only a Super Admin can import legacy browser data.");
    const f = e.target.files?.[0]; if (!f) return;
    const rd = new FileReader();
    rd.onload = async () => {
      try {
        const report = await runServerMutation(() => importLegacySnapshot(parseLegacyBackup(rd.result)));
        const imported = Object.values(report.stats).reduce((total, item) => total + item.imported, 0);
        downloadImportReport(report, f.name);
        setNotice(`Legacy import finished: ${imported} records imported, ${report.rejected.length} rejected. Browser data was not deleted.`);
      } catch (error) { setSaveErr(error.message || "That file isn't a valid legacy register backup."); }
    };
    rd.readAsText(f); e.target.value = "";
  };

  const importDiscoveredBrowserData = async () => {
    if (!legacyBrowserData?.snapshot || !isSuperAdmin) return;
    try {
      const report = await runServerMutation(() => importLegacySnapshot(legacyBrowserData.snapshot));
      const imported = Object.values(report.stats).reduce((total, item) => total + item.imported, 0);
      downloadImportReport(report, legacyBrowserData.source);
      setNotice(`Browser import finished: ${imported} records imported, ${report.rejected.length} rejected. The original ${legacyBrowserData.source} data remains untouched.`);
      setLegacyBrowserData(null);
    } catch { /* the banner contains the server error */ }
  };

  if (loading) return <div className="min-h-screen flex items-center justify-center" style={{ background: C.paper, fontFamily: MONO, fontSize: 12, letterSpacing: "0.15em", color: C.mute }}>LOADING FROM SUPABASE…</div>;

  const av = current ? availOf(current, openJob(current.id)) : null;
  const curJobOfAsset = current ? openJob(current.id) : null;
  const partOf = (d) => {
    const j = repairs.find((r) => r.id === d.jobId);
    return (j?.parts || []).find((p) => p.id === d.partId) || {};
  };
  const dlgDef = dlg && (dlg.kind === "asset" ? ASSET_ACTIONS[dlg.name] : dlg.kind === "repair" ? REPAIR_ACTIONS[dlg.name] : dlg.kind === "part" ? PART_ACTIONS[dlg.name] : dlg.kind === "company" ? COMPANY_ACTIONS[dlg.name] : dlg.kind === "category" ? CATEGORY_ACTIONS[dlg.name] : dlg.kind === "project" ? PROJECT_ACTIONS[dlg.name] : PLAN_ACTIONS[dlg.name]);
  const dlgSubject = dlg && (dlg.kind === "project"
    ? (dlg.projectId ? projects.find((x) => x.id === dlg.projectId) : {})
    : dlg.kind === "category"
    ? (dlg.categoryId ? categories.find((c) => c.id === dlg.categoryId) : {})
    : dlg.kind === "company"
    ? (dlg.companyId ? companies.find((c) => c.id === dlg.companyId) : {})
    : dlg.kind === "part"
    ? (["addPart", "needPart"].includes(dlg.name) ? { ticket: (() => {
        const j = repairs.find((r) => r.id === dlg.jobId);
        if (!j) return "";
        const a = assets.find((x) => x.id === j.assetId);
        return `${j.ticket} · ${a?.tag || "?"} · ${j.fault}`;
      })() } : partOf(dlg))
    : dlg.kind === "plan"
    ? (dlg.planId ? plans.find((p) => p.id === dlg.planId) : { assetTag: current ? `${current.tag} — ${current.name}` : "" })
    : dlg.kind === "asset" ? (dlg.name === "register" ? null : current) : assets.find((a) => a.id === dlg.assetId));
  const dlgHeader = dlg && (() => {
    if (dlg.kind === "company" || dlg.kind === "category" || dlg.kind === "project") return null;
    if (dlg.kind === "part") {
      const j = repairs.find((r) => r.id === dlg.jobId);
      const a = j && assets.find((x) => x.id === j.assetId);
      return j ? `${j.ticket} · ${a?.tag || ""} · ${partOf(dlg).name || ""}` : null;
    }
    const a = dlg.kind === "plan" && dlg.planId ? assets.find((x) => x.id === plans.find((p) => p.id === dlg.planId)?.assetId)
      : dlg.kind === "repair" ? assets.find((x) => x.id === dlg.assetId) : (dlg.name === "register" ? null : current);
    return a ? `${a.tag} · ${a.name}` : null;
  })();
  const tabs = [
    ["assets", "Assets", ClipboardList, allowedAssets.length, C.ink, can("asset.view")],
    ["repairs", "Repairs", Wrench, openTickets.length, STAGES.ongoing.color, can("repair.view")],
    ["parts", "Parts", ShoppingCart, pendingParts, PART_COLOR.Ordered, can("parts.view")],
    ["maintenance", "Maintenance", CalendarClock, duePlans.length, C.due, can("maintenance.view")],
    ["map", "Asset Map", Map, null, C.ink, can("map.view")],
    ["reports", "Reports", BarChart3, null, C.ink, can("reports.view") || can("reports.purchasing")],
    ["settings", "Settings", Settings, null, C.ink, isSuperAdmin],
    ["users", "User Management", Users, null, C.active, can("users.manage") && isSuperAdmin],
  ].filter((entry) => entry[5]);

  return (
    <div className="min-h-screen" style={{ background: C.paper, fontFamily: SANS, color: C.ink }}>
      <div style={{ background: C.surface, borderBottom: `1px solid ${C.rule}` }}>
        <div className="mx-auto px-5 pt-4 flex flex-wrap items-center justify-between gap-3" style={{ maxWidth: 1240 }}>
          <h1 className="uppercase" style={{ fontFamily: MONO, fontSize: 15, letterSpacing: "0.22em", fontWeight: 700 }}>Asset register</h1>
          <div className="flex flex-wrap items-center justify-end gap-2">
            <div className="flex items-center gap-2 mr-2" style={{ fontSize: 12.5, color: C.mute }}>
              <ShieldCheck size={15} style={{ color: C.active }} />
              <span>{access?.full_name || currentUser?.email} · {access?.role_name}</span>
              <button onClick={onSignOut} title="Sign out" className="p-1 hover:opacity-60"><LogOut size={15} /></button>
            </div>
            <Btn icon={RotateCcw} onClick={() => reloadOperationalData().catch(() => {})} disabled={refreshing || saving}>{refreshing ? "Refreshing…" : "Refresh"}</Btn>
            {can("reports.export") && <Btn icon={Download} onClick={exportCsv}>CSV</Btn>}
            {isSuperAdmin && <Btn icon={Download} onClick={exportJson}>Backup</Btn>}
            {isSuperAdmin && <Btn icon={Upload} onClick={() => fileRef.current?.click()} disabled={saving}>Import legacy file</Btn>}
            {isSuperAdmin && legacyBrowserData?.snapshot && <Btn icon={Upload} onClick={importDiscoveredBrowserData} disabled={saving}>Import {legacyBrowserData.source} data</Btn>}
            <input ref={fileRef} type="file" accept="application/json" className="hidden" onChange={importJson} />
            {can("asset.create") && <Btn kind="solid" icon={Plus} onClick={() => setDlg({ kind: "asset", name: "register" })} disabled={saving}>Register asset</Btn>}
          </div>
        </div>
        <div className="mx-auto px-5 flex gap-5 mt-3 overflow-x-auto" style={{ maxWidth: 1240 }}>
          {tabs.map(([k, label, Icon, n, col]) => (
            <button key={k} onClick={() => { setTab(k); setJob(null); }} className="flex items-center gap-2 pb-3 shrink-0"
              style={{ borderBottom: `2px solid ${tab === k ? C.ink : "transparent"}`, color: tab === k ? C.ink : C.mute, fontSize: 14, fontWeight: tab === k ? 600 : 400 }}>
              <Icon size={15} />{label}
              {n !== null && <span style={{ fontFamily: MONO, fontSize: 11, background: tab === k ? C.ink : (n > 0 && k !== "assets" ? col : C.ruleSoft), color: tab === k || (n > 0 && k !== "assets") ? "#fff" : C.mute, padding: "1px 6px", borderRadius: 2 }}>{n}</span>}
            </button>
          ))}
        </div>
      </div>

      {loadErr && <div className="px-5 py-2 text-center" style={{ background: STAGES.broken.tint, color: STAGES.broken.color, fontSize: 13 }}>{loadErr} <button className="underline ml-2" onClick={() => reloadOperationalData().catch(() => {})}>Retry</button></div>}
      {saveErr && <div className="px-5 py-2 text-center" style={{ background: STAGES.broken.tint, color: STAGES.broken.color, fontSize: 13 }}>{saveErr}</div>}
      {(saving || refreshing) && <div className="px-5 py-1.5 text-center" style={{ background: C.soft, color: C.mute, fontFamily: MONO, fontSize: 11, letterSpacing: "0.08em" }}>{saving ? "SAVING TO SUPABASE…" : "REFRESHING FROM SUPABASE…"}</div>}
      {legacyBrowserData?.error && <div className="px-5 py-2 text-center" style={{ background: "#FBF4E4", color: C.due, fontSize: 13 }}>Legacy {legacyBrowserData.source} data was found but could not be parsed: {legacyBrowserData.error}. Nothing was deleted.</div>}
      {notice && (
        <div className="flex items-center justify-center gap-3 px-5 py-2" style={{ background: "#E9F4F1", color: C.ok, fontSize: 13 }}>
          {notice}
          <button onClick={() => setNotice("")} style={{ color: C.ok }} className="hover:opacity-60"><X size={14} /></button>
        </div>
      )}

      <div className="mx-auto px-5 py-5" style={{ maxWidth: 1240 }}>
        {tab === "assets" && (<>
          <div className="grid grid-cols-3 gap-3 mb-4">
            {[["Total assets", totals.all, C.ink, "all"],
              ["Active", totals.active, C.active, "active"],
              ["Broken", totals.out, STAGES.broken.color, "out"]].map(([l, v, col, k]) => (
              <button key={l} onClick={() => setFilter(k)} className="text-left px-4 py-3"
                style={{ background: C.surface, border: `1px solid ${filter === k ? col : C.rule}`, borderTop: `2px solid ${col}` }}>
                <Label>{l}</Label>
                <div style={{ fontFamily: MONO, fontSize: 26, fontWeight: 700, color: col, lineHeight: 1.15 }}>{v}</div>
                {k === "out" && totals.out > 0 && (
                  <div style={{ fontSize: 11.5, color: C.mute, lineHeight: 1.35 }}>
                    {STAGE_ORDER.filter((st) => stageMix[st] > 0).map((st) => `${stageMix[st]} ${STAGE_SHORT[st]}`).join(" · ")}
                  </div>
                )}
                {k === "all" && totals.retired > 0 && (
                  <div style={{ fontSize: 11.5, color: C.mute }}>{totals.retired} retired</div>
                )}
              </button>
            ))}
          </div>
          <div className="flex flex-wrap items-center gap-2 mb-4">
            <div className="relative flex-1" style={{ minWidth: 240 }}>
              <Search size={15} style={{ color: C.mute, position: "absolute", left: 10, top: 10 }} />
              <input value={q} onChange={(e) => handleAssetQuery(e.target.value)} placeholder="Scan a QR code, or search tag, name, serial, body no., location, person"
                style={{ ...inputStyle, paddingLeft: 32 }} />
            </div>
            {allowedCompanies.length > 0 && (
              <select value={comp} onChange={(e) => setComp(e.target.value)}
                style={{ ...inputStyle, width: "auto", minWidth: 160, color: comp ? C.ink : C.mute }}>
                <option value="">All companies</option>
                {ctx.companyNames.map((o) => <option key={o} value={o}>{o}</option>)}
              </select>
            )}
            <select value={cat} onChange={(e) => setCat(e.target.value)}
              style={{ ...inputStyle, width: "auto", minWidth: 160, color: cat ? C.ink : C.mute }}>
              <option value="">All categories</option>
              {ctx.categoryNames.map((o) => <option key={o} value={o}>{o}</option>)}
            </select>
            <select value={loc} onChange={(e) => setLoc(e.target.value)}
              style={{ ...inputStyle, width: "auto", minWidth: 160, color: loc ? C.ink : C.mute }}>
              <option value="">All addresses</option>
              {ctx.locations.map((o) => <option key={o} value={o}>{o}</option>)}
            </select>
            <select value={filter} onChange={(e) => setFilter(e.target.value)}
              style={{ ...inputStyle, width: "auto", minWidth: 160, fontWeight: filter === "all" ? 400 : 600, color: STATUS_FILTERS.find((s) => s[0] === filter)?.[2] || C.mute }}>
              {STATUS_FILTERS.map(([k, l]) => <option key={k} value={k} style={{ color: C.ink, fontWeight: 400 }}>{l} ({counts[k]})</option>)}
            </select>
            {(q || cat || loc || comp || filter !== "all") && (
              <button onClick={() => { setQ(""); setCat(""); setLoc(""); setComp(""); setFilter("all"); }}
                className="flex items-center gap-1.5 px-2 py-2" style={{ fontSize: 12.5, color: C.mute }}>
                <X size={13} />Clear
                <span style={{ fontFamily: MONO, fontSize: 11 }}>({shown.length}/{allowedAssets.length})</span>
              </button>
            )}
          </div>

          <div className="flex gap-5 items-start">
            <div className={`${current ? "hidden md:block" : "block"} w-full md:w-auto shrink-0`}>
              <div className="overflow-hidden md:w-80 lg:w-96" style={{ background: C.surface, border: `1px solid ${C.rule}`, borderRadius: 2 }}>
                {shown.length === 0 ? (
                  <div className="px-5 py-12 text-center">
                    <div style={{ fontSize: 14, marginBottom: 4 }}>{allowedAssets.length === 0 ? "No assets are available in your assigned scope." : "No assets match these filters."}</div>
                    <div style={{ fontSize: 13, color: C.mute }}>{allowedAssets.length === 0 ? "Ask a Super Admin to review your company and asset-group assignments." : "Widen a dropdown or clear the filters to see more."}</div>
                  </div>
                ) : shown.map((a) => {
                  const s = availOf(a, openJob(a.id));
                  const dueHere = plansOf(a.id).filter((p) => daysUntil(p.nextDue) <= 30).sort((x, y) => dueOf(x).rank - dueOf(y).rank)[0];
                  return (
                    <button key={a.id} onClick={() => setSel(a.id)} className="w-full text-left px-4 py-3 flex gap-3 items-start"
                      style={{ borderBottom: `1px solid ${C.ruleSoft}`, background: sel === a.id ? "#F1F5F9" : "transparent", borderLeft: `3px solid ${sel === a.id ? s.color : "transparent"}` }}>
                      <div className="pt-1"><Dot color={s.color} /></div>
                      <div className="min-w-0 flex-1">
                        <div className="uppercase flex items-center gap-2" style={{ fontFamily: MONO, fontSize: 11, letterSpacing: "0.1em", color: s.color }}>
                          {a.tag}<span style={{ opacity: 0.75, letterSpacing: "0.06em" }}>{s.label}</span>
                        </div>
                        <div className="truncate" style={{ fontSize: 14, fontWeight: 500 }}>{a.name}</div>
                        <div className="truncate" style={{ fontSize: 12, color: C.mute }}>{a.location} · {a.custodian}</div>
                      </div>
                      {dueHere && <CalendarClock size={14} style={{ color: dueOf(dueHere).color, marginTop: 4, flexShrink: 0 }} />}
                    </button>
                  );
                })}
              </div>
            </div>

            <div className={`${current ? "block" : "hidden md:block"} flex-1 min-w-0`}>
              {!current ? (
                <div className="flex items-center justify-center px-6 text-center" style={{ height: 320, border: `1px dashed ${C.rule}`, borderRadius: 2, color: C.mute, fontSize: 14 }}>
                  Select an asset to see its availability, schedules, and custody trail.
                </div>
              ) : (
                <div className="overflow-hidden" style={{ background: C.surface, border: `1px solid ${C.rule}`, borderRadius: 2 }}>
                  <div className="px-5 pt-5 pb-4">
                    <button onClick={() => setSel(null)} className="md:hidden flex items-center gap-1 mb-3" style={{ fontSize: 13, color: C.mute }}><ChevronLeft size={15} />All assets</button>
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div>
                        <div style={{ fontFamily: MONO, fontSize: 26, fontWeight: 700, letterSpacing: "0.06em", lineHeight: 1.1 }}>{current.tag}</div>
                        <div style={{ fontSize: 17, marginTop: 2 }}>{current.name}</div>
                        {current.code && (
                          <div className="inline-flex items-center gap-2 mt-2 px-2 py-1" style={{ border: `1px solid ${C.rule}`, borderRadius: 2, background: C.soft }}>
                            <QrCode size={13} style={{ color: C.mute }} />
                            <span style={{ fontFamily: MONO, fontSize: 12, letterSpacing: "0.08em" }}>{current.code}</span>
                          </div>
                        )}
                      </div>
                      <div className="text-right"><Label>Availability</Label><Chip color={av.color} tint={av.tint} big>{av.label}</Chip></div>
                    </div>

                    {curJobOfAsset && (
                      <button onClick={() => { setTab("repairs"); setJob(curJobOfAsset.id); }} className="mt-4 w-full text-left px-3 py-3 flex items-center gap-3"
                        style={{ background: STAGES[curJobOfAsset.stage].tint, borderLeft: `3px solid ${STAGES[curJobOfAsset.stage].color}` }}>
                        <Wrench size={15} style={{ color: STAGES[curJobOfAsset.stage].color, flexShrink: 0 }} />
                        <div className="min-w-0 flex-1">
                          <div style={{ fontSize: 13.5, fontWeight: 600 }}>{curJobOfAsset.fault}</div>
                          <div style={{ fontSize: 12.5, color: C.mute }}>{curJobOfAsset.ticket} · {STAGES[curJobOfAsset.stage].label} · day {daysSince(curJobOfAsset.date)} · {money(repairTotal(curJobOfAsset))}</div>
                        </div>
                        <ChevronRight size={16} style={{ color: C.mute }} />
                      </button>
                    )}
                  </div>

                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-y-4 gap-x-4 px-5 py-4" style={{ borderTop: `1px solid ${C.ruleSoft}`, borderBottom: `1px solid ${C.ruleSoft}`, background: C.soft }}>
                    {[["Company", current.company], ["Project/Location", current.project || NO_PROJECT], ["Address", current.location], ["Responsible person", current.custodian], ["Category", current.category],
                      [serialLabel(current.category), current.serial, true],
                      ...vehicleKeys(current.category).map((k) => [VEHICLE_FIELD_DEFS[k].label, current[k], true]),
                      ["Body number", current.body, true], ["Asset code", current.code, true], ["Acquired", fmt(current.acquired)], ["Acquisition cost", money(current.cost)]].map(([l, v, mono]) => (
                      <div key={l}><Label>{l}</Label><div style={{ fontSize: 14, fontFamily: mono ? MONO : SANS, wordBreak: "break-word" }}>{v || "—"}</div></div>
                    ))}
                    {current.notes && <div className="col-span-2 sm:col-span-3"><Label>Notes</Label><div style={{ fontSize: 14, lineHeight: 1.5 }}>{current.notes}</div></div>}
                  </div>

                  {/* schedules on the asset */}
                  <div className="px-5 py-4" style={{ borderBottom: `1px solid ${C.ruleSoft}` }}>
                    <div className="flex items-center justify-between mb-2">
                      <Label>Maintenance schedules</Label>
                      {can("maintenance.manage") && <Btn small icon={Plus} onClick={() => setDlg({ kind: "plan", name: "addPlan" })}>Add schedule</Btn>}
                    </div>
                    {plansOf(current.id).length === 0 ? (
                      <div className="px-3 py-5 text-center" style={{ border: `1px dashed ${C.rule}`, fontSize: 13, color: C.mute }}>
                        No recurring maintenance set. Add one for servicing, registration, or calibration.
                      </div>
                    ) : (
                      <div style={{ border: `1px solid ${C.ruleSoft}` }}>
                        {plansOf(current.id).map((p) => { const d = dueOf(p);
                          return (
                            <div key={p.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2" style={{ borderBottom: `1px solid ${C.ruleSoft}` }}>
                              <Repeat size={13} style={{ color: C.mute }} />
                              <div className="flex-1" style={{ minWidth: 150 }}>
                                <div style={{ fontSize: 13.5 }}>{p.name}</div>
                                <div style={{ fontSize: 12, color: C.mute }}>{everyLabel(p)} · next {fmt(p.nextDue)}{p.lastDone ? ` · last ${fmt(p.lastDone)}` : ""}</div>
                              </div>
                              <Chip color={d.color} tint={d.tint}>{d.label}</Chip>
                              {can("maintenance.manage") && <Btn small icon={CalendarCheck} onClick={() => setDlg({ kind: "plan", name: "logPlan", planId: p.id })}>Log done</Btn>}
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>

                  <div className="flex flex-wrap gap-2 px-5 py-4">
                    {current.status === "active" && <>
                      {can("asset.transfer") && <Btn icon={ArrowLeftRight} onClick={() => setDlg({ kind: "asset", name: "transfer" })}>Transfer</Btn>}
                      {can("repair.create") && <Btn icon={AlertTriangle} onClick={() => setDlg({ kind: "repair", name: "open", assetId: current.id })}>Report fault</Btn>}
                      {can("asset.retire") && <Btn icon={Archive} onClick={() => setDlg({ kind: "asset", name: "retire" })}>Retire</Btn>}
                    </>}
                    {current.status === "repair" && <Btn kind="solid" icon={Wrench} onClick={() => { setTab("repairs"); setJob(curJobOfAsset?.id); }}>Open repair ticket</Btn>}
                    {current.status === "retired" && can("asset.retire") && <Btn icon={RotateCcw} onClick={() => setDlg({ kind: "asset", name: "reinstate" })}>Bring back into service</Btn>}
                    {can("asset.update") && <Btn icon={Pencil} onClick={() => setDlg({ kind: "asset", name: "edit" })}>Edit</Btn>}
                    {can("asset.delete") && <Btn kind="danger" icon={Trash2} onClick={() => setConfirm({
                      title: `Delete ${current.tag}?`,
                      body: "This erases the record, its custody trail, repair tickets, and schedules for good. To keep the history instead, retire the asset.",
                      confirm: "Delete permanently",
                      run: async () => {
                        try {
                          const receipts = repairs.filter((repair) => repair.assetId === sel).flatMap((repair) => repair.parts || []).map((part) => part.receipt).filter(Boolean);
                          await runServerMutation(async () => { for (const receipt of receipts) await removeStoredReceipt(receipt); await deleteAsset(sel); }, "Asset permanently deleted.");
                          setSel(null);
                        } catch { /* the server state has been reloaded */ }
                      },
                    })}>Delete</Btn>}
                  </div>

                  <HistoryPanel asset={current} csv={csv} repairs={allowedRepairs.filter((r) => r.assetId === current.id)}
                    onOpenTicket={(id) => { setTab("repairs"); setJob(id); }} />
                </div>
              )}
            </div>
          </div>
        </>)}

        {tab === "repairs" && (currentJob
          ? <RepairDetail job={currentJob} asset={assetOf(currentJob)} history={allowedRepairs.filter((r) => r.assetId === currentJob.assetId)} onBack={() => setJob(null)}
              onAct={(name) => setDlg({ kind: "repair", name, assetId: currentJob.assetId, jobId: currentJob.id })}
              onPartAct={(name, jobId, partId) => setDlg({ kind: "part", name, jobId, partId })}
              onView={setViewer} onDropPart={dropPart}
              can={can}
              onOpenAsset={() => { setTab("assets"); setSel(currentJob.assetId); }} />
          : <RepairBoard repairs={allowedRepairs} assets={allowedAssets} onOpen={setJob} showClosed={showClosed} setShowClosed={setShowClosed} />)}

        {tab === "parts" && (
          <PartsTab repairs={allowedRepairs} assets={allowedAssets}
            onAct={(name, jobId, partId) => setDlg({ kind: "part", name, jobId, partId })}
            onView={setViewer} onDrop={dropPart}
            can={can}
            onAdd={() => setDlg({ kind: "part", name: "addPart" })} />
        )}

        {tab === "maintenance" && (
          <MaintenanceTab plans={allowedPlans} assets={allowedAssets}
            onAdd={() => setDlg({ kind: "plan", name: "addPlan" })}
            onLog={(id) => setDlg({ kind: "plan", name: "logPlan", planId: id })}
            onEdit={(id) => setDlg({ kind: "plan", name: "editPlan", planId: id })}
            onDelete={(p) => setConfirm({ title: `Delete "${p.name}"?`, body: "The schedule and its completed-maintenance records go with it. Costs already recorded will drop out of reports.", confirm: "Delete schedule", run: () => runServerMutation(() => deleteMaintenanceSchedule(p.id), "Maintenance schedule deleted.").catch(() => {}) })}
            canManage={can("maintenance.manage")}
            onOpenAsset={(id) => { setTab("assets"); setSel(id); }} />
        )}

        {tab === "map" && (
          <AssetMap assets={allowedAssets} projects={projects} companies={allowedCompanies} categoryNames={ctx.categoryNames}
            openJob={openJob} onOpenAsset={(id) => { setTab("assets"); setSel(id); }} />
        )}

        {tab === "settings" && isSuperAdmin && (
          <SettingsTab companies={companies} categories={categories} projects={ctx.projects} assets={assets}
            on={(action, id, item, n) => {
              if (action === "addCompany") return setDlg({ kind: "company", name: "addCompany" });
              if (action === "editCompany") return setDlg({ kind: "company", name: "editCompany", companyId: id });
              if (action === "addCategory") return setDlg({ kind: "category", name: "addCategory" });
              if (action === "editCategory") return setDlg({ kind: "category", name: "editCategory", categoryId: id });
              if (action === "addProject") return setDlg({ kind: "project", name: "addProject" });
              if (action === "importProjects") return setDlg({ kind: "project", name: "importProjects" });
              if (action === "editProject") return setDlg({ kind: "project", name: "editProject", projectId: id });
              if (action === "deleteProject") {
                return setConfirm(n > 0
                  ? { title: `${item.pid} is in use`, body: `${n} asset${n > 1 ? "s are" : " is"} recorded against it. Transfer them elsewhere first.`, blocked: true }
                  : { title: `Delete ${item.pid}?`, body: "No assets are on it, so nothing else is affected.", confirm: "Delete",
                      run: () => runServerMutation(() => deleteProject(id), "Project/location deleted.").catch(() => {}) });
              }
              const isCo = action === "deleteCompany";
              const word = isCo ? "company" : "category";
              setConfirm(n > 0
                ? { title: `${item.name} is in use`, body: `${n} asset${n > 1 ? "s are" : " is"} filed under this ${word}. Move them across first, or rename this one instead of deleting it.`, blocked: true }
                : { title: `Delete ${item.name}?`, body: `No assets use this ${word}, so nothing else is affected.`, confirm: `Delete ${word}`,
                    run: () => runServerMutation(() => isCo ? deleteCompany(id) : deleteCategory(id), `${isCo ? "Company" : "Asset group"} deleted.`).catch(() => {}) });
            }} />
        )}

        {tab === "reports" && <ReportsTab assets={allowedAssets} repairs={allowedRepairs} plans={allowedPlans} ctx={ctx} csv={csv} openJob={openJob} purchasingOnly={!can("reports.view")} />}

        {tab === "users" && isSuperAdmin && can("users.manage") && <UserManagement />}
      </div>

      {dlg && <Dialog def={dlgDef} subject={dlgSubject} header={dlgHeader} ctx={ctx} busy={saving} onCancel={() => setDlg(null)}
        onSubmit={(vals) => dlg.kind === "asset" ? runAsset(dlg.name, vals) : dlg.kind === "repair" ? runRepair(dlg.name, vals) : dlg.kind === "part" ? runPart(dlg.name, vals) : dlg.kind === "company" ? runCompany(dlg.name, vals) : dlg.kind === "category" ? runCategory(dlg.name, vals) : dlg.kind === "project" ? runProject(dlg.name, vals) : runPlan(dlg.name, vals)} />}

      {viewer && <ReceiptViewer meta={viewer.meta || viewer} onClose={() => setViewer(null)}
        canRemove={can("purchasing.manage")}
        onRemove={() => removeReceipt(viewer.jobId, viewer.partId, viewer.meta || viewer)} />}

      {confirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-6" style={{ background: "rgba(20,28,38,0.45)" }} onClick={() => setConfirm(null)}>
          <div onClick={(e) => e.stopPropagation()} className="p-5" style={{ maxWidth: 420, background: C.surface, borderRadius: 2 }}>
            <div style={{ fontSize: 16, fontWeight: 600 }}>{confirm.title}</div>
            <div style={{ fontSize: 13.5, color: C.mute, marginTop: 6, lineHeight: 1.5 }}>{confirm.body}</div>
            <div className="flex justify-end gap-2 mt-5">
              {confirm.blocked ? <Btn kind="solid" onClick={() => setConfirm(null)}>Close</Btn> : (<>
                <Btn onClick={() => setConfirm(null)}>Keep it</Btn>
                <Btn kind="danger" onClick={() => { confirm.run(); setConfirm(null); }}>{confirm.confirm}</Btn>
              </>)}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

const PART_GRID = "minmax(180px,1fr) 116px 120px 116px 202px";

/* One part, rendered the same way inside a ticket and on the Parts tab. */
function PartRow({ part: p, job, asset, onAct, onView, onDrop, showTicket, locked, can = () => false }) {
  const line = num(p.unit) * (num(p.qty) || 1);
  const col = PART_COLOR[p.state] || C.mute;

  const receiptCell = p.receipt ? (
    <button onClick={() => onView({ meta: p.receipt, jobId: job.id, partId: p.id })} className="flex items-center gap-1.5 px-2 py-1"
      style={{ border: `1px solid ${C.rule}`, borderRadius: 2, fontSize: 12, color: C.ok }}>
      <Receipt size={13} />Receipt
    </button>
  ) : p.state === "Purchased" ? (
    <span className="flex items-center gap-1.5" style={{ fontSize: 12, color: C.overdue }}><AlertCircle size={13} />None</span>
  ) : <span style={{ fontSize: 12, color: C.mute }}>—</span>;

  const actions = locked ? (
    p.state === "Purchased" && can("purchasing.manage")
      ? <Btn small kind={p.receipt ? "ghost" : "solid"} icon={Receipt} onClick={() => onAct("receipt", job.id, p.id)}>{p.receipt ? "Replace receipt" : "Attach receipt"}</Btn>
      : <span style={{ fontSize: 12, color: C.mute }}>Closed</span>
  ) : (
    <div className="flex items-center gap-2">
      {p.state === "Needed" && can("purchasing.manage") && <Btn small icon={ShoppingCart} onClick={() => onAct("order", job.id, p.id)}>Mark ordered</Btn>}
      {p.state === "Ordered" && can("purchasing.manage") && <Btn small kind="solid" icon={Receipt} onClick={() => onAct("purchase", job.id, p.id)}>Record purchase</Btn>}
      {p.state === "Purchased" && can("purchasing.manage") && <Btn small icon={Pencil} onClick={() => onAct("purchase", job.id, p.id)}>Edit</Btn>}
      {onDrop && can("parts.manage") && <Btn small kind="danger" icon={Trash2} onClick={() => onDrop(job.id, p.id, p)}>{""}</Btn>}
      {!can("purchasing.manage") && !can("parts.manage") && <span style={{ fontSize: 12, color: C.mute }}>View only</span>}
    </div>
  );

  if (showTicket) {
    return (
      <div style={{
        display: "grid", gridTemplateColumns: PART_GRID, alignItems: "center", columnGap: 12,
        padding: "10px 12px", borderBottom: `1px solid ${C.ruleSoft}`, borderLeft: `3px solid ${col}`,
      }}>
        <div className="min-w-0">
          <div className="truncate" style={{ fontSize: 13.5 }}>{p.name}</div>
          <div className="truncate" style={{ fontSize: 12, color: C.mute }}>
            {[asset ? `${job.ticket} · ${asset.tag}` : null, p.supplier, p.ref, fmt(p.date)].filter(Boolean).join(" · ")}
          </div>
        </div>
        <div style={{ fontFamily: MONO, fontSize: 14.5, fontWeight: 700, textAlign: "right" }}>{money(line)}</div>
        <div><Chip color={col} tint={p.state === "Purchased" ? "#E9F4F1" : p.state === "Ordered" ? "#FBF4E4" : "#FAEEEC"}>{p.state}</Chip></div>
        <div>{receiptCell}</div>
        <div>{actions}</div>
      </div>
    );
  }

  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-2 px-3 py-2.5" style={{ borderBottom: `1px solid ${C.ruleSoft}`, borderLeft: `3px solid ${col}` }}>
      <div className="flex-1" style={{ minWidth: 150 }}>
        <div style={{ fontSize: 13.5 }}>{p.name}</div>
        <div style={{ fontSize: 12, color: C.mute }}>{[p.supplier, p.ref, fmt(p.date)].filter(Boolean).join(" · ")}</div>
      </div>
      <div style={{ fontFamily: MONO, fontSize: 12.5, textAlign: "right", minWidth: 120 }}>
        <div>{num(p.qty) || 1} × {money(p.unit)}</div>
        <div style={{ fontSize: 13.5, fontWeight: 700 }}>{money(line)}</div>
      </div>
      <Chip color={col} tint={p.state === "Purchased" ? "#E9F4F1" : p.state === "Ordered" ? "#FBF4E4" : "#FAEEEC"}>{p.state}</Chip>
      {p.receipt ? receiptCell : p.state === "Purchased" ? <span className="flex items-center gap-1.5" style={{ fontSize: 12, color: C.overdue }}><AlertCircle size={13} />No receipt</span> : null}
      {actions}
    </div>
  );
}

function ReceiptViewer({ meta, onClose, onRemove, canRemove }) {
  const [src, setSrc] = useState(null);
  const [err, setErr] = useState("");
  useEffect(() => {
    let live = true;
    getReceiptUrl(meta).then((url) => { if (live) setSrc(url); })
      .catch((error) => live && setErr(error.message || "This receipt could not be opened from Supabase Storage."));
    return () => { live = false; };
  }, [meta]);

  const download = () => {
    if (!src) return;
    const a = document.createElement("a"); a.href = src; a.download = meta.name || "receipt"; a.click();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: "rgba(20,28,38,0.6)" }} onClick={onClose}>
      <div onClick={(e) => e.stopPropagation()} className="flex flex-col" style={{ maxWidth: 720, width: "100%", maxHeight: "92vh", background: C.surface, borderRadius: 2 }}>
        <div className="flex items-center justify-between px-4 py-3" style={{ borderBottom: `1px solid ${C.ruleSoft}` }}>
          <div className="min-w-0">
            <div className="truncate" style={{ fontSize: 14, fontWeight: 600 }}>{meta.name}</div>
            <div style={{ fontFamily: MONO, fontSize: 11, color: C.mute }}>{kb(meta.size)} · filed {fmt(meta.at)}</div>
          </div>
          <button onClick={onClose} style={{ color: C.mute }} className="p-1 hover:opacity-60"><X size={18} /></button>
        </div>
        <div className="flex-1 overflow-auto p-4" style={{ background: C.paper, minHeight: 200 }}>
          {err ? <div className="text-center py-10" style={{ fontSize: 13, color: C.overdue }}>{err}</div>
            : !src ? <div className="text-center py-10" style={{ fontFamily: MONO, fontSize: 11, letterSpacing: "0.15em", color: C.mute }}>LOADING…</div>
            : meta.type?.startsWith("image/") ? <img src={src} alt={meta.name} style={{ maxWidth: "100%", display: "block", margin: "0 auto" }} />
            : <iframe title={meta.name} src={src} style={{ width: "100%", height: "60vh", border: "none", background: "#fff" }} />}
        </div>
        <div className="flex justify-between gap-2 px-4 py-3" style={{ borderTop: `1px solid ${C.ruleSoft}` }}>
          {canRemove ? <Btn kind="danger" icon={Trash2} onClick={onRemove}>Remove receipt</Btn> : <span />}
          <Btn icon={Download} onClick={download} disabled={!src}>Download</Btn>
        </div>
      </div>
    </div>
  );
}

/* ------------------------------ asset map ------------------------------ */

function AssetMap({ assets, projects, companies, categoryNames, openJob, onOpenAsset }) {
  const [q, setQ] = useState("");
  const [comp, setComp] = useState("");
  const [cat, setCat] = useState("");
  const [sel, setSel] = useState(null);
  const [mapState, setMapState] = useState("ready");
  const box = useRef(null);
  const mapRef = useRef(null);
  const layerRef = useRef(null);

  const t = q.trim().toLowerCase();
  const rows = useMemo(() => assets.filter((a) => {
    if (comp && a.company !== comp) return false;
    if (cat && a.category !== cat) return false;
    if (!t) return true;
    return [a.tag, a.code, a.name, a.serial, a.plate, a.location, a.custodian, a.project].some((v) => String(v || "").toLowerCase().includes(t));
  }), [assets, comp, cat, t]);

  /* grouped by project — X collects everything not assigned to one */
  const sites = useMemo(() => {
    const m = {};
    rows.forEach((a) => {
      const pid = a.project || NO_PROJECT;
      m[pid] = m[pid] || { pid, assets: [] };
      m[pid].assets.push(a);
    });
    return Object.values(m).map((s2) => {
      const pr = projects.find((x) => x.pid === s2.pid);
      const locs = [...new Set(s2.assets.map((a) => a.location).filter(Boolean))];
      const mix = { active: 0, out: 0, retired: 0 };
      s2.assets.forEach((a) => {
        const k = availOf(a, openJob(a.id)).key;
        mix[k === "retired" ? "retired" : k === "active" ? "active" : "out"]++;
      });
      /* worst condition present decides the colour — a site with anything down reads as down */
      const tone = mix.out ? STAGES.broken.color : mix.active ? C.active : C.retired;
      return {
        ...s2,
        n: s2.assets.length,
        label: pr?.location || (s2.pid === NO_PROJECT ? "Not a project site" : "No longer on the list"),
        locations: locs,
        mix, tone,
        coords: pr && parseCoords(pr.geocode),
      };
    }).sort((a, b) => b.n - a.n);
  }, [rows, projects, openJob]);

  const mapped = useMemo(() => sites.filter((s2) => s2.coords), [sites]);
  const maxN = Math.max(1, ...sites.map((s2) => s2.n));

  useEffect(() => () => {
    layerRef.current?.remove();
    mapRef.current?.remove();
    layerRef.current = null;
    mapRef.current = null;
  }, []);

  useEffect(() => {
    if (mapState !== "ready") return;
    if (!mapped.length) {
      layerRef.current?.remove();
      mapRef.current?.remove();
      layerRef.current = null;
      mapRef.current = null;
      return;
    }
    if (!box.current) return;
    try {
      if (!mapRef.current) {
        mapRef.current = L.map(box.current, { scrollWheelZoom: false });
        L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
          attribution: "© OpenStreetMap", maxZoom: 18,
        }).addTo(mapRef.current);
      }
      if (layerRef.current) layerRef.current.remove();
      layerRef.current = L.layerGroup().addTo(mapRef.current);
      mapped.forEach((s2) => {
        const r = 5 + (s2.n / maxN) * 9;
        const parts = [
          s2.mix.active ? `${s2.mix.active} active` : "",
          s2.mix.out ? `${s2.mix.out} broken or in repair` : "",
          s2.mix.retired ? `${s2.mix.retired} retired` : "",
        ].filter(Boolean).join(" · ");
        const d = Math.round(r * 2);
        L.marker(s2.coords, {
          icon: L.divIcon({
            className: "",
            iconSize: [d, d],
            iconAnchor: [d / 2, d / 2],
            html: createMapMarkerContent(document, s2.tone, d),
          }),
        })
          .addTo(layerRef.current)
          .bindTooltip(
            createMapTooltipContent(document, s2, parts, C.mute),
            { direction: "top", offset: [0, -4] })
          .on("click", () => setSel(s2.pid));
      });
      mapRef.current.fitBounds(mapped.map((s2) => s2.coords), { padding: [40, 40], maxZoom: 13 });
    } catch {
      layerRef.current?.remove();
      mapRef.current?.remove();
      layerRef.current = null;
      mapRef.current = null;
      window.setTimeout(() => setMapState("failed"), 0);
    }
  }, [mapState, mapped, maxN]);

  const site = sites.find((s2) => s2.pid === sel);
  const selStyle = { ...inputStyle, width: "auto", minWidth: 158 };

  return (<>
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-4">
      {[["Assets shown", rows.length, C.ink], ["Project/Locations", sites.length, C.active],
        ["On the list", rows.filter((a) => a.project && a.project !== NO_PROJECT).length, C.ok],
        ["Off the list (X)", rows.filter((a) => !a.project || a.project === NO_PROJECT).length, C.mute]].map(([l, v, col]) => (
        <div key={l} className="px-4 py-3" style={{ background: C.surface, border: `1px solid ${C.rule}`, borderTop: `2px solid ${col}` }}>
          <Label>{l}</Label><div style={{ fontFamily: MONO, fontSize: 22, fontWeight: 700, color: col }}>{v}</div>
        </div>
      ))}
    </div>

    <div className="flex flex-wrap items-center gap-2 mb-4">
      <div className="relative flex-1" style={{ minWidth: 230 }}>
        <Search size={15} style={{ color: C.mute, position: "absolute", left: 10, top: 10 }} />
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search asset, tag, plate, project, person" style={{ ...inputStyle, paddingLeft: 32 }} />
      </div>
      <select value={comp} onChange={(e) => setComp(e.target.value)} style={{ ...selStyle, color: comp ? C.ink : C.mute }}>
        <option value="">All companies</option>
        {companies.map((c) => <option key={c.id} value={c.name}>{c.name}</option>)}
      </select>
      <select value={cat} onChange={(e) => setCat(e.target.value)} style={{ ...selStyle, color: cat ? C.ink : C.mute }}>
        <option value="">All categories</option>
        {categoryNames.map((o) => <option key={o} value={o}>{o}</option>)}
      </select>
      {(q || comp || cat) && (
        <button onClick={() => { setQ(""); setComp(""); setCat(""); }} className="flex items-center gap-1.5 px-2 py-2" style={{ fontSize: 12.5, color: C.mute }}>
          <X size={13} />Clear
        </button>
      )}
    </div>

    <div className="flex flex-col lg:flex-row gap-4 items-start">
      <div className="w-full lg:flex-1">
        {mapState === "failed" || !mapped.length ? (
          <div className="px-4 py-4" style={{ background: C.surface, border: `1px solid ${C.rule}` }}>
            <div className="flex items-start gap-2 mb-3" style={{ fontSize: 13, color: C.mute, lineHeight: 1.5 }}>
              <Layers size={15} style={{ marginTop: 2, flexShrink: 0 }} />
              <span>
                {mapState === "failed"
                  ? "The map tiles couldn't be reached from here, so project/locations are shown by size instead."
                  : "No project has coordinates yet. Add \"lat, lng\" to a project's location in Settings to place it on the map — for example \"Brgy. Talamban, Cebu City (10.3567, 123.9137)\"."}
              </span>
            </div>
            {sites.map((s2) => (
              <button key={s2.pid} onClick={() => setSel(s2.pid)} className="w-full text-left flex items-center gap-3 py-1.5">
                <div className="truncate" style={{ width: 92, fontFamily: MONO, fontSize: 12.5, fontWeight: 700 }}>{s2.pid}</div>
                <div className="flex-1" style={{ background: C.ruleSoft, height: 16, position: "relative" }}>
                  <div style={{ position: "absolute", inset: 0, width: `${(s2.n / maxN) * 100}%`, background: sel === s2.pid ? C.ink : s2.tone }} />
                </div>
                <div style={{ fontFamily: MONO, fontSize: 12.5, width: 34, textAlign: "right" }}>{s2.n}</div>
              </button>
            ))}
            {sites.length === 0 && <div className="py-8 text-center" style={{ fontSize: 13, color: C.mute }}>No assets match these filters.</div>}
          </div>
        ) : (
          <>
            <style>{`
              .qm-pin{display:block;width:var(--d);height:var(--d);position:relative}
              .qm-pin i{position:absolute;inset:0;border-radius:50%;background:var(--tone);
                border:2px solid var(--tone);opacity:.85;box-shadow:0 0 0 0 var(--tone);
                animation:qmPulse 2.4s cubic-bezier(.24,.72,.4,1) infinite}
              @keyframes qmPulse{
                0%{box-shadow:0 0 0 0 color-mix(in srgb, var(--tone) 55%, transparent)}
                70%{box-shadow:0 0 0 14px color-mix(in srgb, var(--tone) 0%, transparent)}
                100%{box-shadow:0 0 0 0 color-mix(in srgb, var(--tone) 0%, transparent)}
              }
              @media (prefers-reduced-motion: reduce){.qm-pin i{animation:none}}
            `}</style>
            <div ref={box} style={{ height: 460, width: "100%", background: C.surface, border: `1px solid ${C.rule}`, borderBottom: "none" }} />
            <div className="flex flex-wrap items-center gap-x-5 gap-y-1 px-4 py-2" style={{ background: C.surface, border: `1px solid ${C.rule}`, fontSize: 12, color: C.mute }}>
              <span>Circle colour shows the worst status on site; size shows how many assets.</span>
              {[["All active", C.active], ["Something broken or in repair", STAGES.broken.color], ["All retired", C.retired]].map(([l, col]) => (
                <span key={l} className="flex items-center gap-1.5"><Dot color={col} size={8} />{l}</span>
              ))}
            </div>
          </>
        )}
      </div>

      <div className="w-full lg:w-80 shrink-0" style={{ background: C.surface, border: `1px solid ${C.rule}` }}>
        <div className="px-4 py-3" style={{ borderBottom: `1px solid ${C.ruleSoft}`, background: C.soft }}>
          <Label>{site ? `${site.pid} · ${site.n} asset${site.n === 1 ? "" : "s"}` : `Project/Locations · ${sites.length}`}</Label>
          {site && <div style={{ fontSize: 13.5 }}>{site.label}</div>}
        </div>
        <div style={{ maxHeight: 420, overflowY: "auto" }}>
          {!site ? (
            sites.length === 0
              ? <div className="px-4 py-8 text-center" style={{ fontSize: 13, color: C.mute }}>Nothing to show.</div>
              : sites.map((s2) => (
                <button key={s2.pid} onClick={() => setSel(s2.pid)} className="w-full text-left px-4 py-2.5 flex items-center gap-3" style={{ borderBottom: `1px solid ${C.ruleSoft}` }}>
                  <MapPin size={14} style={{ color: s2.coords ? s2.tone : C.mute, flexShrink: 0 }} />
                  <div className="min-w-0 flex-1">
                    <div style={{ fontFamily: MONO, fontSize: 12.5, fontWeight: 700 }}>{s2.pid}</div>
                    <div className="truncate" style={{ fontSize: 12, color: C.mute }}>{s2.label}</div>
                  </div>
                  <span style={{ fontFamily: MONO, fontSize: 13, fontWeight: 700, color: s2.mix.out ? STAGES.broken.color : C.ink }}>{s2.n}</span>
                </button>
              ))
          ) : (<>
            <button onClick={() => setSel(null)} className="flex items-center gap-1 px-4 py-2" style={{ fontSize: 12.5, color: C.mute }}>
              <ChevronLeft size={14} />All project/locations
            </button>
            {site.assets.map((a) => {
              const st = availOf(a, openJob(a.id));
              return (
                <button key={a.id} onClick={() => onOpenAsset(a.id)} className="w-full text-left px-4 py-2.5 flex items-start gap-3" style={{ borderBottom: `1px solid ${C.ruleSoft}` }}>
                  <Dot color={st.color} />
                  <div className="min-w-0 flex-1">
                    <div className="uppercase" style={{ fontFamily: MONO, fontSize: 10.5, letterSpacing: "0.1em", color: st.color }}>{a.tag} · {a.project || NO_PROJECT}</div>
                    <div className="truncate" style={{ fontSize: 13.5 }}>{a.name}</div>
                    <div className="truncate" style={{ fontSize: 12, color: C.mute }}>{a.custodian}</div>
                  </div>
                </button>
              );
            })}
          </>)}
        </div>
      </div>
    </div>
  </>);
}

/* ------------------------------ settings ------------------------------ */

/* One managed list — companies, categories, and anything else added later. */
function Registry({ icon: Icon, title, blurb, addLabel, items, countOf, metaOf, badgeOf, onAdd, onEdit, onDelete, empty, unassigned, unassignedText }) {
  return (
    <div className="mb-8">
      <div className="flex flex-wrap items-start justify-between gap-3 mb-3">
        <div style={{ maxWidth: 560 }}>
          <div style={{ fontSize: 15, fontWeight: 600 }}>{title}</div>
          <div style={{ fontSize: 13, color: C.mute, lineHeight: 1.5, marginTop: 2 }}>{blurb}</div>
        </div>
        <Btn kind="solid" icon={Plus} onClick={onAdd}>{addLabel}</Btn>
      </div>

      {unassigned > 0 && items.length > 0 && (
        <div className="flex items-center gap-2 px-4 py-3 mb-3" style={{ background: "#FBF4E4", borderLeft: `3px solid ${C.due}`, fontSize: 13.5, color: C.due }}>
          <AlertCircle size={15} />{unassignedText(unassigned)}
        </div>
      )}

      <div style={{ background: C.surface, border: `1px solid ${C.rule}` }}>
        {items.length === 0 ? (
          <div className="px-5 py-10 text-center">
            <div style={{ fontSize: 14, marginBottom: 4 }}>{empty[0]}</div>
            <div style={{ fontSize: 13, color: C.mute }}>{empty[1]}</div>
          </div>
        ) : items.map((it) => {
          const n = countOf(it);
          return (
            <div key={it.id} className="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3" style={{ borderBottom: `1px solid ${C.ruleSoft}` }}>
              <Icon size={16} style={{ color: C.mute, flexShrink: 0 }} />
              <div className="flex-1" style={{ minWidth: 190 }}>
                <div className="flex items-baseline gap-2">
                  <span style={{ fontSize: 14, fontWeight: 500 }}>{it.name}</span>
                  {badgeOf?.(it) && <span className="uppercase" style={{ fontFamily: MONO, fontSize: 11, letterSpacing: "0.1em", color: C.mute }}>{badgeOf(it)}</span>}
                </div>
                <div style={{ fontSize: 12.5, color: C.mute }}>{metaOf(it)}</div>
              </div>
              <div style={{ fontFamily: MONO, fontSize: 14, width: 74, textAlign: "right" }}>
                {n}
                <div className="uppercase" style={{ fontSize: 9.5, letterSpacing: "0.12em", color: C.mute }}>assets</div>
              </div>
              <div className="flex gap-2">
                <Btn small icon={Pencil} onClick={() => onEdit(it.id)}>{""}</Btn>
                <Btn small kind="danger" icon={Trash2} onClick={() => onDelete(it, n)}>{""}</Btn>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function SettingsTab({ companies, categories, projects, assets, on }) {
  return (<>
    <Registry
      icon={Building2} title="Companies" addLabel="Add company"
      blurb="The owning entity an asset is registered under. Companies added here appear on the registration form and as a filter across the register and reports."
      items={companies}
      countOf={(c) => assets.filter((a) => a.company === c.name).length}
      badgeOf={(c) => c.code}
      metaOf={(c) => [c.address, c.contact].filter(Boolean).join(" · ") || "No address or contact recorded"}
      onAdd={() => on("addCompany")} onEdit={(id) => on("editCompany", id)}
      onDelete={(c, n) => on("deleteCompany", c.id, c, n)}
      empty={["No companies set up.", "Add one and it becomes selectable when you register an asset."]}
      unassigned={assets.filter((a) => !a.company).length}
      unassignedText={(n) => `${n} asset${n > 1 ? "s are" : " is"} not assigned to a company yet. Edit each one to set it.`}
    />

    <Registry
      icon={Tag} title="Asset categories" addLabel="Add category"
      blurb="How assets are grouped for filtering and reporting. Renaming one updates every asset filed under it."
      items={categories}
      countOf={(c) => assets.filter((a) => a.category === c.name).length}
      metaOf={(c) => `Records: ${identifierSummary(c.name)}${c.notes ? ` · ${c.notes}` : ""}`}
      onAdd={() => on("addCategory")} onEdit={(id) => on("editCategory", id)}
      onDelete={(c, n) => on("deleteCategory", c.id, c, n)}
      empty={["No categories set up.", "Add one and it becomes selectable when you register an asset."]}
      unassigned={assets.filter((a) => !a.category).length}
      unassignedText={(n) => `${n} asset${n > 1 ? "s have" : " has"} no category set.`}
    />

    <div className="mb-8">
      <div className="flex flex-wrap items-start justify-between gap-3 mb-3">
        <div style={{ maxWidth: 560 }}>
          <div style={{ fontSize: 15, fontWeight: 600 }}>Project/Location</div>
          <div style={{ fontSize: 13, color: C.mute, lineHeight: 1.5, marginTop: 2 }}>
            Project ID, its address, and a geocode for the map. On transfer you pick the ID and the address is looked up; anything off this list is recorded as <strong>{NO_PROJECT}</strong> with the address typed in.
          </div>
        </div>
        <div className="flex gap-2">
          <Btn icon={Upload} onClick={() => on("importProjects")}>Import Excel</Btn>
          <Btn kind="solid" icon={Plus} onClick={() => on("addProject")}>Add project/location</Btn>
        </div>
      </div>

      <div style={{ background: C.surface, border: `1px solid ${C.rule}` }}>
        {projects.length === 0 ? (
          <div className="px-5 py-10 text-center">
            <div style={{ fontSize: 14, marginBottom: 4 }}>No project/locations set up.</div>
            <div style={{ fontSize: 13, color: C.mute }}>Import your list, or add them one at a time.</div>
          </div>
        ) : projects.map((pr) => {
          const n = assets.filter((a) => (a.project || NO_PROJECT) === pr.pid).length;
          return (
            <div key={pr.id} className="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3" style={{ borderBottom: `1px solid ${C.ruleSoft}` }}>
              <MapPin size={16} style={{ color: C.mute, flexShrink: 0 }} />
              <div style={{ fontFamily: MONO, fontSize: 13, fontWeight: 700, minWidth: 96 }}>{pr.pid}</div>
              <div className="flex-1" style={{ minWidth: 190 }}>
                <div style={{ fontSize: 13.5 }}>{pr.location}</div>
                <div style={{ fontFamily: MONO, fontSize: 11, color: parseCoords(pr.geocode) ? C.mute : C.due }}>
                  {parseCoords(pr.geocode) ? pr.geocode : "No geocode — not on the map"}
                </div>
              </div>
              <div style={{ fontFamily: MONO, fontSize: 14, width: 74, textAlign: "right" }}>
                {n}<div className="uppercase" style={{ fontSize: 9.5, letterSpacing: "0.12em", color: C.mute }}>assets</div>
              </div>
              <div className="flex gap-2">
                <Btn small icon={Pencil} onClick={() => on("editProject", pr.id)}>{""}</Btn>
                <Btn small kind="danger" icon={Trash2} onClick={() => on("deleteProject", pr.id, pr, n)}>{""}</Btn>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  </>);
}

/* ------------------------------ parts ------------------------------ */

function PartsTab({ repairs, assets, onAct, onView, onDrop, onAdd, can }) {
  const [state, setState] = useState("");
  const [q, setQ] = useState("");

  const all = repairs.flatMap((r) => (r.parts || []).map((p) => ({ p, job: r, asset: assets.find((a) => a.id === r.assetId) || {} })));
  const t = q.trim().toLowerCase();
  const rows = all
    .filter((x) => !state || x.p.state === state)
    .filter((x) => !t || [x.p.name, x.p.supplier, x.p.ref, x.asset.tag, x.asset.name, x.job.ticket].some((v) => String(v || "").toLowerCase().includes(t)))
    .sort((a, b) => (PART_STATES.indexOf(a.p.state) - PART_STATES.indexOf(b.p.state)) || String(b.p.date).localeCompare(String(a.p.date)));

  const count = (s) => all.filter((x) => x.p.state === s).length;
  const spent = all.filter((x) => x.p.state === "Purchased").reduce((s, x) => s + num(x.p.unit) * (num(x.p.qty) || 1), 0);
  const committed = all.filter((x) => x.p.state === "Ordered").reduce((s, x) => s + num(x.p.unit) * (num(x.p.qty) || 1), 0);
  const missing = all.filter((x) => x.p.state === "Purchased" && !x.p.receipt);

  return (<>
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-4">
      {[["To buy", count("Needed"), PART_COLOR.Needed], ["Ordered", count("Ordered"), PART_COLOR.Ordered],
        ["On order, value", money0(committed), PART_COLOR.Ordered], ["Purchased, spent", money0(spent), PART_COLOR.Purchased]].map(([l, v, col]) => (
        <div key={l} className="px-4 py-3" style={{ background: C.surface, border: `1px solid ${C.rule}`, borderTop: `2px solid ${col}` }}>
          <Label>{l}</Label><div style={{ fontFamily: MONO, fontSize: 22, fontWeight: 700, color: col }}>{v}</div>
        </div>
      ))}
    </div>

    {missing.length > 0 && (
      <div className="flex items-center gap-2 px-4 py-3 mb-4" style={{ background: STAGES.broken.tint, borderLeft: `3px solid ${C.overdue}`, fontSize: 13.5, color: C.overdue }}>
        <AlertCircle size={15} />
        {missing.length} purchased part{missing.length > 1 ? "s have" : " has"} no receipt on file.
      </div>
    )}

    <div className="flex flex-wrap items-center gap-2 mb-4">
      <div className="relative flex-1" style={{ minWidth: 240 }}>
        <Search size={15} style={{ color: C.mute, position: "absolute", left: 10, top: 10 }} />
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search part, supplier, receipt no., asset, ticket" style={{ ...inputStyle, paddingLeft: 32 }} />
      </div>
      <select value={state} onChange={(e) => setState(e.target.value)} style={{ ...inputStyle, width: "auto", minWidth: 165, color: state ? PART_COLOR[state] : C.mute, fontWeight: state ? 600 : 400 }}>
        <option value="" style={{ color: C.ink, fontWeight: 400 }}>All parts ({all.length})</option>
        {PART_STATES.map((s) => <option key={s} value={s} style={{ color: C.ink, fontWeight: 400 }}>{s} ({count(s)})</option>)}
      </select>
      {can("parts.manage") && <Btn kind="solid" icon={Plus} onClick={onAdd}>Add part</Btn>}
    </div>

    <div className="overflow-x-auto" style={{ background: C.surface, border: `1px solid ${C.rule}` }}>
      <div style={{ minWidth: 856 }}>
        {rows.length === 0 ? (
          <div className="px-5 py-12 text-center">
            <div style={{ fontSize: 14, marginBottom: 4 }}>{all.length === 0 ? "No parts logged yet." : "No parts match this view."}</div>
            <div style={{ fontSize: 13, color: C.mute }}>
              {all.length === 0 ? "Parts appear here as soon as they're added to a repair ticket." : "Clear the search or pick a different status."}
            </div>
          </div>
        ) : (<>
          <div style={{
            display: "grid", gridTemplateColumns: PART_GRID, columnGap: 12,
            padding: "9px 12px 9px 15px", background: C.soft, borderBottom: `1px solid ${C.rule}`,
          }}>
            {[["Part", "left"], ["Amount", "right"], ["Status", "left"], ["Receipt", "left"], ["Action", "left"]].map(([h, al]) => (
              <div key={h} className="uppercase" style={{ fontFamily: MONO, fontSize: 9.5, letterSpacing: "0.12em", color: C.mute, textAlign: al }}>{h}</div>
            ))}
          </div>
          {rows.map(({ p, job, asset }) => (
            <PartRow key={p.id} part={p} job={job} asset={asset} showTicket
              onAct={onAct} onView={onView} onDrop={onDrop} locked={job.closed} can={can} />
          ))}
        </>)}
      </div>
    </div>
  </>);
}

/* --------------------------- history panel --------------------------- */

function HistoryPanel({ asset, repairs, csv, onOpenTicket }) {
  const [view, setView] = useState("trail");
  const chain = movements(asset);
  const shown = [...chain].reverse();
  const held = chain.find((m) => m.current);
  const general = (asset.history || []).filter((h) => !isRepairEntry(h) && !isMoveEntry(h));
  const tickets = [...repairs].sort((a, b) => String(b.date).localeCompare(String(a.date)));
  const outDays = tickets.reduce((s, t) => s + (t.closed && t.closedOn
    ? Math.max(0, Math.round((new Date(t.closedOn + "T00:00:00") - new Date(t.date + "T00:00:00")) / 864e5))
    : daysSince(t.date)), 0);

  const exportMoves = () => csv(
    ["date", "from_project_location", "to_project_location", "from_address", "to_address", "from_person", "to_person", "reason", "days_held"],
    chain.map((m) => [m.date, m.move?.fromProject || "", m.move?.project || "", m.move?.fromLoc || "", m.move?.toLoc || "", m.move?.fromPer || "", m.move?.toPer || "", m.move?.why || m.text, m.days]),
    `transfers-${asset.tag}-${today()}.csv`);

  const Arrow = ({ from, to }) => {
    if (!from) return <span style={{ fontSize: 13 }}>{to || "—"}</span>;
    if (from === to) return <span style={{ fontSize: 13, color: C.mute }}>{to} <span style={{ fontSize: 11 }}>(unchanged)</span></span>;
    return (
      <span style={{ fontSize: 13 }}>
        <span style={{ color: C.mute, textDecoration: "line-through" }}>{from}</span>
        <span style={{ color: C.active, margin: "0 5px" }}>→</span>
        <span style={{ fontWeight: 500 }}>{to}</span>
      </span>
    );
  };

  return (
    <div className="px-5 py-4" style={{ borderTop: `1px solid ${C.ruleSoft}` }}>
      <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
        <div className="flex" style={{ border: `1px solid ${C.rule}`, borderRadius: 2 }}>
          {[["trail", "General trail", general.length], ["moves", "Transfers", chain.length], ["repairs", "Repairs", tickets.length]].map(([k, l, n]) => (
            <button key={k} onClick={() => setView(k)} className="flex items-center gap-2 px-3 py-1.5"
              style={{ background: view === k ? C.ink : "transparent", color: view === k ? "#fff" : C.mute, fontSize: 13 }}>
              {l}<span style={{ fontFamily: MONO, fontSize: 10.5, opacity: 0.7 }}>{n}</span>
            </button>
          ))}
        </div>
        {view === "moves" && chain.length > 0 && <Btn small icon={Download} onClick={exportMoves}>Export transfers</Btn>}
      </div>

      {view === "trail" && (
        general.length === 0
          ? <div className="px-3 py-6 text-center" style={{ border: `1px dashed ${C.rule}`, fontSize: 13, color: C.mute }}>Nothing here yet.</div>
          : <><Trail entries={general} />
              {tickets.length > 0 && (
                <div style={{ fontSize: 12.5, color: C.mute, marginTop: -8 }}>
                  Repair steps are kept separately — {tickets.length} ticket{tickets.length > 1 ? "s" : ""} under Repairs.
                </div>
              )}
            </>
      )}

      {view === "repairs" && (
        tickets.length === 0 ? (
          <div className="px-3 py-6 text-center" style={{ border: `1px dashed ${C.rule}`, fontSize: 13, color: C.mute }}>
            No repairs on record for this asset.
          </div>
        ) : (<>
          <div className="flex flex-wrap gap-x-8 gap-y-2 px-3 py-3 mb-3" style={{ background: C.soft, border: `1px solid ${C.ruleSoft}` }}>
            {[["Tickets", tickets.length], ["Days out of service", outDays], ["Total repair cost", money(tickets.reduce((s, t) => s + repairTotal(t), 0))]].map(([l, v]) => (
              <div key={l}><Label>{l}</Label><div style={{ fontFamily: MONO, fontSize: 15 }}>{v}</div></div>
            ))}
          </div>
          <div style={{ border: `1px solid ${C.ruleSoft}` }}>
            {tickets.map((t) => {
              const st = t.closed ? { label: `Closed ${fmt(t.closedOn)}`, color: C.retired, tint: "#F1F3F6" } : { label: STAGES[t.stage].label, color: STAGES[t.stage].color, tint: STAGES[t.stage].tint };
              return (
                <button key={t.id} onClick={() => onOpenTicket(t.id)} className="w-full text-left flex flex-wrap items-center gap-x-4 gap-y-1 px-3 py-3"
                  style={{ borderBottom: `1px solid ${C.ruleSoft}`, borderLeft: `3px solid ${st.color}` }}>
                  <div style={{ width: 78 }}>
                    <div style={{ fontFamily: MONO, fontSize: 11, letterSpacing: "0.1em", color: C.mute }}>{t.ticket}</div>
                    <div style={{ fontFamily: MONO, fontSize: 11, color: C.mute }}>{fmt(t.date)}</div>
                  </div>
                  <div className="flex-1" style={{ minWidth: 160 }}>
                    <div style={{ fontSize: 13.5 }}>{t.fault}</div>
                    <div style={{ fontSize: 12.5, color: C.mute }}>
                      {[t.provider, t.technician && `by ${t.technician}`, (t.parts || []).length ? `${t.parts.length} part${t.parts.length > 1 ? "s" : ""}` : ""].filter(Boolean).join(" · ") || "No provider recorded"}
                    </div>
                  </div>
                  <Chip color={st.color} tint={st.tint}>{st.label}</Chip>
                  <div style={{ fontFamily: MONO, fontSize: 13, width: 90, textAlign: "right" }}>{money(repairTotal(t))}</div>
                  <ChevronRight size={15} style={{ color: C.mute }} />
                </button>
              );
            })}
          </div>
        </>)
      )}

      {view === "moves" && (
        chain.length === 0 ? (
          <div className="px-3 py-6 text-center" style={{ border: `1px dashed ${C.rule}`, fontSize: 13, color: C.mute }}>
            No movements recorded yet. Transfers, repair despatches, and releases all appear here.
          </div>
        ) : (<>
          {held && (
            <div className="px-3 py-3 mb-3" style={{ background: "#EAF1F6", borderLeft: `3px solid ${C.active}` }}>
              <Label>Held since {fmt(held.date)}</Label>
              <div style={{ fontSize: 14 }}>{asset.custodian} · {asset.location}</div>
              <div style={{ fontSize: 12.5, color: C.mute, marginTop: 1 }}>
                {held.days} day{held.days === 1 ? "" : "s"} in this placement · {chain.length - 1} movement{chain.length - 1 === 1 ? "" : "s"} before this
              </div>
            </div>
          )}
          <div className="overflow-x-auto" style={{ border: `1px solid ${C.ruleSoft}` }}>
            <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 620 }}>
              <thead>
                <tr style={{ background: C.soft }}>
                  {["Date", "Project/Location", "Address", "Responsible person", "Reason", "Held"].map((h, i) => (
                    <th key={h} className="uppercase" style={{ fontFamily: MONO, fontSize: 9.5, letterSpacing: "0.12em", color: C.mute, textAlign: i === 5 ? "right" : "left", padding: "8px 10px", borderBottom: `1px solid ${C.rule}`, whiteSpace: "nowrap" }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {shown.map((m, i) => (
                  <tr key={m.ts + "" + i} style={{ borderBottom: `1px solid ${C.ruleSoft}`, background: m.current ? "#F6F9FB" : "transparent" }}>
                    <td style={{ padding: "9px 10px", verticalAlign: "top", whiteSpace: "nowrap" }}>
                      <div style={{ fontFamily: MONO, fontSize: 11.5 }}>{fmt(m.date)}</div>
                      {m.current && <div className="uppercase" style={{ fontFamily: MONO, fontSize: 9, letterSpacing: "0.12em", color: C.active, marginTop: 2 }}>Current</div>}
                    </td>
                    <td style={{ padding: "9px 10px", verticalAlign: "top", fontFamily: MONO, fontSize: 12 }}>
                      {!m.move?.project ? "—"
                        : m.move.fromProject && m.move.fromProject !== m.move.project
                        ? (<><span style={{ color: C.mute, textDecoration: "line-through" }}>{m.move.fromProject}</span>
                            <span style={{ color: C.active, margin: "0 4px" }}>→</span>{m.move.project}</>)
                        : m.move.project}
                    </td>
                    <td style={{ padding: "9px 10px", verticalAlign: "top" }}>
                      {m.move ? <Arrow from={m.move.fromLoc} to={m.move.toLoc} /> : <span style={{ fontSize: 13, color: C.mute }}>—</span>}
                    </td>
                    <td style={{ padding: "9px 10px", verticalAlign: "top" }}>
                      {m.move ? <Arrow from={m.move.fromPer} to={m.move.toPer} /> : <span style={{ fontSize: 13, color: C.mute }}>—</span>}
                    </td>
                    <td style={{ padding: "9px 10px", verticalAlign: "top", fontSize: 12.5, color: C.mute }}>{m.move?.why || m.text}</td>
                    <td style={{ padding: "9px 10px", verticalAlign: "top", fontFamily: MONO, fontSize: 12, textAlign: "right", whiteSpace: "nowrap" }}>{m.days}d</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>)
      )}
    </div>
  );
}

/* --------------------------- repair board --------------------------- */

function RepairBoard({ repairs, assets, onOpen, showClosed, setShowClosed }) {
  const [q, setQ] = useState("");
  const [cat, setCat] = useState("");
  const aOf = (r) => assets.find((a) => a.id === r.assetId) || {};

  const t = q.trim().toLowerCase();
  const cats = [...new Set(repairs.map((r) => aOf(r).category).filter(Boolean))].sort();
  const match = (r) => {
    const a = aOf(r);
    if (cat && a.category !== cat) return false;
    if (!t) return true;
    return [r.ticket, r.fault, r.provider, r.technician, a.tag, a.name, a.code, a.company, a.custodian]
      .some((v) => String(v || "").toLowerCase().includes(t));
  };
  const allOpen = repairs.filter((r) => !r.closed);
  const open = allOpen.filter(match);
  const closed = repairs.filter((r) => r.closed).filter(match);
  const narrowed = !!(t || cat);

  return (<>
    <div className="flex flex-wrap items-center gap-2 mb-3">
      <div className="relative flex-1" style={{ minWidth: 240 }}>
        <Search size={15} style={{ color: C.mute, position: "absolute", left: 10, top: 10 }} />
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search ticket, fault, asset, provider, technician" style={{ ...inputStyle, paddingLeft: 32 }} />
      </div>
      <select value={cat} onChange={(e) => setCat(e.target.value)} style={{ ...inputStyle, width: "auto", minWidth: 170, color: cat ? C.ink : C.mute }}>
        <option value="">All categories</option>
        {cats.map((o) => <option key={o} value={o}>{o}</option>)}
      </select>
      {narrowed && (
        <button onClick={() => { setQ(""); setCat(""); }} className="flex items-center gap-1.5 px-2 py-2" style={{ fontSize: 12.5, color: C.mute }}>
          <X size={13} />Clear
        </button>
      )}
    </div>
    <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
      <div style={{ fontSize: 13.5, color: C.mute }}>
        {allOpen.length === 0 ? "No open repair tickets."
          : narrowed ? `${open.length} of ${allOpen.length} open tickets match · ${money(open.reduce((s, r) => s + repairTotal(r), 0))} committed`
          : `${allOpen.length} open ticket${allOpen.length > 1 ? "s" : ""} · ${money(allOpen.reduce((s, r) => s + repairTotal(r), 0))} committed so far`}
      </div>
      <Btn onClick={() => setShowClosed(!showClosed)}>{showClosed ? "Hide closed tickets" : `Show closed (${repairs.length - allOpen.length})`}</Btn>
    </div>
    <div className="flex gap-4 overflow-x-auto pb-2">
      {STAGE_ORDER.map((s) => {
        const list = open.filter((r) => r.stage === s);
        return (
          <div key={s} className="shrink-0" style={{ width: 268 }}>
            <div className="flex items-center justify-between px-3 py-2" style={{ background: STAGES[s].tint, borderTop: `2px solid ${STAGES[s].color}` }}>
              <span className="uppercase" style={{ fontFamily: MONO, fontSize: 10.5, letterSpacing: "0.13em", color: STAGES[s].color, fontWeight: 700 }}>{STAGES[s].label}</span>
              <span style={{ fontFamily: MONO, fontSize: 11, color: STAGES[s].color }}>{list.length}</span>
            </div>
            <div className="mt-2 flex flex-col gap-2">
              {list.length === 0 && <div className="px-3 py-6 text-center" style={{ border: `1px dashed ${C.rule}`, fontSize: 12.5, color: C.mute }}>{narrowed ? "No match" : "Nothing here"}</div>}
              {list.map((r) => { const a = aOf(r); const parts = r.parts || []; const got = parts.filter((p) => p.state === "Purchased").length;
                return (
                  <button key={r.id} onClick={() => onOpen(r.id)} className="text-left px-3 py-3" style={{ background: C.surface, border: `1px solid ${C.rule}`, borderRadius: 2 }}>
                    <div className="flex items-center justify-between" style={{ fontFamily: MONO, fontSize: 10.5, letterSpacing: "0.1em", color: C.mute }}>
                      <span>{r.ticket}</span><span>DAY {daysSince(r.date)}</span>
                    </div>
                    <div className="mt-1 uppercase" style={{ fontFamily: MONO, fontSize: 11.5, fontWeight: 700, letterSpacing: "0.06em" }}>{a.tag}</div>
                    <div className="truncate" style={{ fontSize: 13.5 }}>{a.name}</div>
                    <div className="mt-1" style={{ fontSize: 12.5, color: C.mute, lineHeight: 1.4 }}>{r.fault}</div>
                    {(parts.length > 0 || repairTotal(r) > 0) && (
                      <div className="flex items-center gap-3 mt-2 pt-2" style={{ borderTop: `1px solid ${C.ruleSoft}`, fontSize: 11.5, color: C.mute, fontFamily: MONO }}>
                        {parts.length > 0 && <span className="flex items-center gap-1"><Package size={11} />{got}/{parts.length}</span>}
                        <span>{money(repairTotal(r))}</span>
                      </div>
                    )}
                  </button>
                );
              })}
            </div>
          </div>
        );
      })}
    </div>
    {showClosed && (
      <div className="mt-6">
        <Label>Closed tickets</Label>
        <div className="mt-2" style={{ background: C.surface, border: `1px solid ${C.rule}` }}>
          {closed.length === 0 && <div className="px-4 py-6 text-center" style={{ fontSize: 13, color: C.mute }}>{narrowed ? "No closed tickets match." : "No closed tickets yet."}</div>}
          {closed.map((r) => { const a = aOf(r);
            return (
              <button key={r.id} onClick={() => onOpen(r.id)} className="w-full text-left px-4 py-3 flex flex-wrap items-center gap-x-4 gap-y-1" style={{ borderBottom: `1px solid ${C.ruleSoft}` }}>
                <span style={{ fontFamily: MONO, fontSize: 11, color: C.mute }}>{r.ticket}</span>
                <span className="uppercase" style={{ fontFamily: MONO, fontSize: 11.5, fontWeight: 700 }}>{a.tag}</span>
                <span style={{ fontSize: 13.5, flex: 1, minWidth: 120 }}>{r.fault}</span>
                <span style={{ fontSize: 12.5, color: C.mute }}>closed {fmt(r.closedOn)}</span>
                <span style={{ fontFamily: MONO, fontSize: 12 }}>{money(repairTotal(r))}</span>
              </button>
            );
          })}
        </div>
      </div>
    )}
  </>);
}

/* --------------------------- repair detail --------------------------- */

function RepairDetail({ job, asset, history = [], onBack, onAct, onPartAct, onView, onDropPart, onOpenAsset, can }) {
  const a = asset || {};
  const parts = job.parts || [];
  const pTotal = partsTotal(job);
  const lifetime = history.reduce((s, r) => s + repairTotal(r), 0);
  const ratio = num(a.cost) > 0 ? (lifetime / num(a.cost)) * 100 : 0;
  const ratioColor = ratio >= 100 ? C.overdue : ratio >= 50 ? STAGES.ongoing.color : C.ink;
  const stage = job.closed ? null : job.stage;
  const idx = STAGE_ORDER.indexOf(stage);

  return (
    <div style={{ background: C.surface, border: `1px solid ${C.rule}`, borderRadius: 2 }}>
      <div className="px-5 pt-4 pb-4">
        <button onClick={onBack} className="flex items-center gap-1 mb-3" style={{ fontSize: 13, color: C.mute }}><ChevronLeft size={15} />Repair board</button>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <div style={{ fontFamily: MONO, fontSize: 11, letterSpacing: "0.14em", color: C.mute }}>{job.ticket}</div>
            <button onClick={onOpenAsset} className="text-left">
              <div style={{ fontFamily: MONO, fontSize: 24, fontWeight: 700, letterSpacing: "0.06em", lineHeight: 1.15 }}>{a.tag}</div>
              <div style={{ fontSize: 16 }}>{a.name}</div>
            </button>
          </div>
          {stage ? <Chip color={STAGES[stage].color} tint={STAGES[stage].tint} big>{STAGES[stage].label}</Chip>
            : <Chip color={C.retired} tint="#F1F3F6" big>Closed {fmt(job.closedOn)}</Chip>}
        </div>
      </div>

      {stage && (
        <div className="flex px-5 pb-4 gap-1">
          {STAGE_ORDER.map((s, i) => (
            <div key={s} className="flex-1">
              <div style={{ height: 3, background: i <= idx ? STAGES[s].color : C.ruleSoft }} />
              <div className="mt-1.5 uppercase" style={{ fontFamily: MONO, fontSize: 9.5, letterSpacing: "0.1em", color: i <= idx ? STAGES[s].color : C.mute, fontWeight: i === idx ? 700 : 400 }}>{STAGES[s].label}</div>
            </div>
          ))}
        </div>
      )}

      <div className="px-5 py-4" style={{ background: STAGES.broken.tint, borderTop: `1px solid ${C.ruleSoft}`, borderBottom: `1px solid ${C.ruleSoft}` }}>
        <Label>Reported fault</Label><div style={{ fontSize: 14.5 }}>{job.fault}</div>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 px-5 py-4" style={{ background: C.soft, borderBottom: `1px solid ${C.ruleSoft}` }}>
        {[["Reported", fmt(job.date)], ["Reported by", job.reportedBy], ["Service provider", job.provider], ["Technician", job.technician],
          ["Target completion", job.due ? fmt(job.due) : "—"], ["Days open", job.closed ? "closed" : daysSince(job.date)]].map(([l, v]) => (
          <div key={l}><Label>{l}</Label><div style={{ fontSize: 13.5 }}>{v || "—"}</div></div>
        ))}
      </div>

      {/* cost of repair */}
      <div className="px-5 py-4" style={{ borderBottom: `1px solid ${C.ruleSoft}` }}>
        <div className="flex items-center justify-between mb-2">
          <Label>Cost of repair</Label>
          {!job.closed && can("repair.cost") && <Btn small icon={Coins} onClick={() => onAct("costs")}>Enter labour and charges</Btn>}
        </div>
        <div className="flex flex-wrap gap-x-8 gap-y-2" style={{ fontFamily: MONO }}>
          {[["Parts", pTotal], ["Labour", num(job.labor)], ["Other", num(job.other)]].map(([l, v]) => (
            <div key={l}><div style={{ fontSize: 10, letterSpacing: "0.14em", color: C.mute }} className="uppercase">{l}</div><div style={{ fontSize: 15 }}>{money(v)}</div></div>
          ))}
          <div style={{ borderLeft: `1px solid ${C.rule}`, paddingLeft: 20 }}>
            <div style={{ fontSize: 10, letterSpacing: "0.14em", color: C.ok }} className="uppercase">This ticket</div>
            <div style={{ fontSize: 19, fontWeight: 700 }}>{money(repairTotal(job))}</div>
          </div>
        </div>

        <div className="flex flex-wrap gap-x-8 gap-y-2 mt-3 pt-3" style={{ fontFamily: MONO, borderTop: `1px solid ${C.ruleSoft}` }}>
          <div>
            <div style={{ fontSize: 10, letterSpacing: "0.14em", color: C.mute }} className="uppercase">Asset value</div>
            <div style={{ fontSize: 15 }}>{money(a.cost)}</div>
          </div>
          <div>
            <div style={{ fontSize: 10, letterSpacing: "0.14em", color: C.mute }} className="uppercase">Repairs to date</div>
            <div style={{ fontSize: 15 }}>{money(lifetime)}</div>
            <div style={{ fontFamily: SANS, fontSize: 11.5, color: C.mute }}>across {history.length} ticket{history.length === 1 ? "" : "s"}</div>
          </div>
          {num(a.cost) > 0 && (
            <div>
              <div style={{ fontSize: 10, letterSpacing: "0.14em", color: C.mute }} className="uppercase">Share of value</div>
              <div style={{ fontSize: 15, color: ratioColor, fontWeight: ratio >= 50 ? 700 : 400 }}>{Math.round(ratio)}%</div>
              {ratio >= 100 && <div style={{ fontFamily: SANS, fontSize: 11.5, color: C.overdue }}>spent more than it cost</div>}
            </div>
          )}
        </div>
      </div>

      {/* parts */}
      <div className="px-5 py-4" style={{ borderBottom: `1px solid ${C.ruleSoft}` }}>
        <div className="flex items-center justify-between mb-2">
          <Label>Parts</Label>
          {!job.closed && can("parts.manage") && <Btn small icon={Plus} onClick={() => onPartAct("addPart", job.id, null)}>Add part</Btn>}
        </div>
        {parts.length === 0 ? (
          <div className="px-3 py-5 text-center" style={{ border: `1px dashed ${C.rule}`, fontSize: 13, color: C.mute }}>No parts logged. Add one when you order or buy something for this repair.</div>
        ) : (
          <div style={{ border: `1px solid ${C.ruleSoft}` }}>
            {parts.map((p) => (
              <PartRow key={p.id} part={p} job={job} onAct={onPartAct} onView={onView} onDrop={onDropPart} locked={job.closed} can={can} />
            ))}
            <div className="flex justify-between px-3 py-2" style={{ fontFamily: MONO, fontSize: 12.5, background: C.soft }}><span>PARTS TOTAL</span><span>{money(pTotal)}</span></div>
          </div>
        )}
      </div>

      {!job.closed && (
        <div className="flex flex-wrap gap-2 px-5 py-4">
          {stage === "broken" && <>
            {can("parts.manage") && <Btn kind="solid" icon={Package} onClick={() => onPartAct("needPart", job.id, null)}>Needs parts</Btn>}
            {can("repair.process") && <Btn icon={Wrench} onClick={() => onAct("start")}>Start repair</Btn>}
          </>}
          {stage === "parts" && can("repair.process") && <Btn kind="solid" icon={Wrench} onClick={() => onAct("start")}>Parts in — start repair</Btn>}
          {stage === "ongoing" && <>
            {can("repair.process") && <Btn kind="solid" onClick={() => onAct("testing")}>Repair done — send to testing</Btn>}
            {can("parts.manage") && <Btn icon={Package} onClick={() => onPartAct("needPart", job.id, null)}>Needs more parts</Btn>}
          </>}
          {stage === "testing" && <>
            {can("repair.close") && <Btn kind="solid" icon={RotateCcw} onClick={() => onAct("close")}>Passed — return to service</Btn>}
            {can("repair.process") && <Btn onClick={() => onAct("fail")}>Testing failed</Btn>}
          </>}
          {can("repair.close") && can("asset.retire") && <Btn kind="danger" icon={Archive} onClick={() => onAct("scrap")}>Beyond repair</Btn>}
        </div>
      )}

      <div className="px-5 py-4" style={{ borderTop: `1px solid ${C.ruleSoft}` }}>
        <Label>Repair log</Label><Trail entries={job.log || []} />
      </div>
    </div>
  );
}

/* --------------------------- maintenance --------------------------- */

function MaintenanceTab({ plans, assets, onAdd, onLog, onEdit, onDelete, onOpenAsset, canManage = false }) {
  const [scope, setScope] = useState("30");
  const [open, setOpen] = useState(null);
  const aOf = (p) => assets.find((a) => a.id === p.assetId) || {};
  const limit = scope === "all" ? 99999 : parseInt(scope);
  const list = plans.filter((p) => daysUntil(p.nextDue) <= limit)
    .sort((a, b) => String(a.nextDue).localeCompare(String(b.nextDue)));
  const bucket = (k) => plans.filter((p) => dueOf(p).key === k).length;
  const overdue = bucket("overdue") + bucket("today");
  const spent = plans.reduce((s, p) => s + planSpend(p), 0);

  return (<>
    <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
      <div className="flex flex-wrap gap-2">
        {[["30", "Next 30 days"], ["7", "Next 7 days"], ["0", "Overdue only"], ["all", "All schedules"]].map(([k, l]) => (
          <button key={k} onClick={() => setScope(k)} className="px-3 py-2 text-sm"
            style={{ borderRadius: 2, border: `1px solid ${scope === k ? C.ink : C.rule}`, background: scope === k ? C.ink : C.surface, color: scope === k ? "#fff" : C.ink }}>{l}</button>
        ))}
      </div>
      {canManage && <Btn kind="solid" icon={Plus} onClick={onAdd}>Add schedule</Btn>}
    </div>

    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4">
      {[["Overdue", overdue, C.overdue], ["Due this week", bucket("week"), "#AF6318"], ["Due this month", bucket("month"), C.active], ["Spent on maintenance", money0(spent), C.ok]].map(([l, v, col]) => (
        <div key={l} className="px-4 py-3" style={{ background: C.surface, border: `1px solid ${C.rule}`, borderTop: `2px solid ${col}` }}>
          <Label>{l}</Label>
          <div style={{ fontFamily: MONO, fontSize: 22, fontWeight: 700, color: col }}>{v}</div>
        </div>
      ))}
    </div>

    <div style={{ background: C.surface, border: `1px solid ${C.rule}` }}>
      {list.length === 0 ? (
        <div className="px-5 py-12 text-center">
          <div style={{ fontSize: 14, marginBottom: 4 }}>{plans.length === 0 ? "No maintenance schedules yet." : "Nothing falls in this window."}</div>
          <div style={{ fontSize: 13, color: C.mute }}>{plans.length === 0 ? "Add one for registration renewals, annual servicing, or calibration." : "Widen the window to see what's coming later."}</div>
        </div>
      ) : list.map((p) => {
        const a = aOf(p); const d = dueOf(p); const isOpen = open === p.id; const done = p.done || [];
        return (
          <div key={p.id} style={{ borderBottom: `1px solid ${C.ruleSoft}`, borderLeft: `3px solid ${d.color}` }}>
            <div className="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3">
              <button onClick={() => onOpenAsset(p.assetId)} className="text-left" style={{ minWidth: 118 }}>
                <div className="uppercase" style={{ fontFamily: MONO, fontSize: 11.5, fontWeight: 700, letterSpacing: "0.06em" }}>{a.tag}</div>
                <div className="truncate" style={{ fontSize: 12.5, color: C.mute, maxWidth: 170 }}>{a.name}</div>
              </button>
              <div className="flex-1" style={{ minWidth: 170 }}>
                <div style={{ fontSize: 14 }}>{p.name}</div>
                <div style={{ fontSize: 12.5, color: C.mute }}>{everyLabel(p)} · due {fmt(p.nextDue)}{p.provider ? ` · ${p.provider}` : ""}</div>
              </div>
              <Chip color={d.color} tint={d.tint}>{d.label}</Chip>
              <div style={{ fontFamily: MONO, fontSize: 12.5, width: 92, textAlign: "right" }}>
                {num(p.estCost) ? money(p.estCost) : "—"}
                <div style={{ fontSize: 9.5, letterSpacing: "0.12em", color: C.mute }} className="uppercase">est.</div>
              </div>
              {canManage && <div className="flex gap-2">
                <Btn small kind="solid" icon={CalendarCheck} onClick={() => onLog(p.id)}>Log done</Btn>
                <Btn small icon={Pencil} onClick={() => onEdit(p.id)}>{""}</Btn>
                <Btn small kind="danger" icon={Trash2} onClick={() => onDelete(p)}>{""}</Btn>
              </div>}
              <button onClick={() => setOpen(isOpen ? null : p.id)} style={{ fontSize: 12.5, color: C.mute }} className="flex items-center gap-1">
                {done.length} done · {money0(planSpend(p))}<ChevronRight size={13} style={{ transform: isOpen ? "rotate(90deg)" : "none" }} />
              </button>
            </div>
            {isOpen && (
              <div className="px-4 pb-4" style={{ background: C.soft }}>
                {p.notes && <div className="pt-3" style={{ fontSize: 13, color: C.mute }}>{p.notes}</div>}
                <div className="pt-3"><Label>Maintenance history</Label></div>
                {done.length === 0 ? <div style={{ fontSize: 13, color: C.mute }}>Nothing recorded yet.</div> : (
                  <div style={{ border: `1px solid ${C.ruleSoft}`, background: C.surface }}>
                    {[...done].reverse().map((d2) => (
                      <div key={d2.id} className="flex flex-wrap items-center gap-x-4 px-3 py-2" style={{ borderBottom: `1px solid ${C.ruleSoft}` }}>
                        <span style={{ fontFamily: MONO, fontSize: 11.5, color: C.mute, width: 92 }}>{fmt(d2.date)}</span>
                        <span className="flex-1" style={{ fontSize: 13, minWidth: 140 }}>{d2.notes || "Completed"}</span>
                        <span style={{ fontSize: 12.5, color: C.mute }}>{[d2.provider, d2.ref].filter(Boolean).join(" · ")}</span>
                        <span style={{ fontFamily: MONO, fontSize: 12.5 }}>{money(d2.cost)}</span>
                      </div>
                    ))}
                    <div className="flex justify-between px-3 py-2" style={{ fontFamily: MONO, fontSize: 12.5, background: C.soft }}>
                      <span>TOTAL SPENT</span><span>{money(planSpend(p))}</span>
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        );
      })}
    </div>
  </>);
}

/* ------------------------------ reports ------------------------------ */

function ReportsTab(props) {
  return props.purchasingOnly ? <PurchasingReports {...props} /> : <FullReports {...props} />;
}

function PurchasingReports({ assets, repairs, csv }) {
  const [state, setState] = useState("");
  const [q, setQ] = useState("");
  const all = repairs.flatMap((repair) => (repair.parts || []).map((part) => ({
    part,
    repair,
    asset: assets.find((asset) => asset.id === repair.assetId) || {},
    total: num(part.unit) * (num(part.qty) || 1),
  })));
  const needle = q.trim().toLowerCase();
  const rows = all.filter(({ part, repair, asset }) => (!state || part.state === state)
    && (!needle || [part.name, part.supplier, part.ref, repair.ticket, asset.tag, asset.name, asset.company]
      .some((value) => String(value || "").toLowerCase().includes(needle))));
  const purchased = rows.filter((row) => row.part.state === "Purchased").reduce((sum, row) => sum + row.total, 0);
  const ordered = rows.filter((row) => row.part.state === "Ordered").reduce((sum, row) => sum + row.total, 0);
  const exportRows = () => csv(
    ["ticket", "asset", "company", "part", "state", "quantity", "unit_price", "total", "supplier", "reference", "date", "receipt"],
    rows.map(({ part, repair, asset, total }) => [repair.ticket, asset.tag, asset.company, part.name, part.state, num(part.qty) || 1, num(part.unit), total, part.supplier, part.ref, part.date, part.receipt?.name || ""]),
    `purchasing-report-${today()}.csv`,
  );

  return (<>
    <div className="flex flex-wrap items-start justify-between gap-3 mb-4">
      <div><div style={{ fontSize: 18, fontWeight: 650 }}>Purchasing report</div><div style={{ color: C.mute, fontSize: 13 }}>Limited to parts and purchasing records inside your assigned company and asset-group scope.</div></div>
      <Btn icon={Download} onClick={exportRows}>Export purchasing report</Btn>
    </div>
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-4">
      {[["Part lines", rows.length, C.ink], ["Needed", rows.filter((row) => row.part.state === "Needed").length, PART_COLOR.Needed], ["Ordered value", money0(ordered), PART_COLOR.Ordered], ["Purchased value", money0(purchased), PART_COLOR.Purchased]].map(([label, value, color]) => (
        <div key={label} className="px-4 py-3" style={{ background: C.surface, border: `1px solid ${C.rule}`, borderTop: `2px solid ${color}` }}><Label>{label}</Label><div style={{ fontFamily: MONO, fontSize: 22, fontWeight: 700, color }}>{value}</div></div>
      ))}
    </div>
    <div className="flex flex-wrap gap-2 mb-4">
      <div className="relative flex-1" style={{ minWidth: 250 }}><Search size={15} style={{ color: C.mute, position: "absolute", left: 10, top: 10 }} /><input value={q} onChange={(event) => setQ(event.target.value)} placeholder="Search part, supplier, order, ticket, asset, company" style={{ ...inputStyle, paddingLeft: 32 }} /></div>
      <select value={state} onChange={(event) => setState(event.target.value)} style={{ ...inputStyle, width: "auto", minWidth: 160 }}><option value="">All states</option>{PART_STATES.map((value) => <option key={value}>{value}</option>)}</select>
    </div>
    <div className="overflow-x-auto" style={{ background: C.surface, border: `1px solid ${C.rule}` }}>
      <table style={{ width: "100%", minWidth: 920, borderCollapse: "collapse", fontSize: 12.5 }}>
        <thead><tr style={{ background: C.soft }}>{["Ticket", "Asset", "Company", "Part", "State", "Qty", "Unit price", "Total", "Supplier / order"].map((heading) => <th key={heading} className="text-left px-3 py-2" style={{ color: C.mute, borderBottom: `1px solid ${C.rule}` }}>{heading}</th>)}</tr></thead>
        <tbody>{rows.length === 0 ? <tr><td colSpan={9} className="p-10 text-center" style={{ color: C.mute }}>No purchasing records match this view.</td></tr> : rows.map(({ part, repair, asset, total }) => (
          <tr key={`${repair.id}-${part.id}`} style={{ borderBottom: `1px solid ${C.ruleSoft}` }}><td className="px-3 py-2" style={{ fontFamily: MONO }}>{repair.ticket}</td><td className="px-3 py-2">{asset.tag} · {asset.name}</td><td className="px-3 py-2">{asset.company || "—"}</td><td className="px-3 py-2">{part.name}</td><td className="px-3 py-2"><Chip color={PART_COLOR[part.state] || C.mute} tint={part.state === "Purchased" ? "#E9F4F1" : part.state === "Ordered" ? "#FBF4E4" : "#FAEEEC"}>{part.state}</Chip></td><td className="px-3 py-2">{num(part.qty) || 1}</td><td className="px-3 py-2" style={{ fontFamily: MONO }}>{money(part.unit)}</td><td className="px-3 py-2" style={{ fontFamily: MONO, fontWeight: 700 }}>{money(total)}</td><td className="px-3 py-2">{[part.supplier, part.ref].filter(Boolean).join(" · ") || "—"}</td></tr>
        ))}</tbody>
      </table>
    </div>
  </>);
}

function FullReports({ assets, repairs, plans, ctx, csv, openJob }) {
  const [f, setF] = useState({ company: "", category: "", location: "", custodian: "", status: "", from: "", to: "" });
  const [group, setGroup] = useState("category");
  const [sort, setSort] = useState("tag");
  const set = (k, v) => setF((s) => ({ ...s, [k]: v }));

  const repairCost = useCallback(
    (id) => repairs.filter((r) => r.assetId === id).reduce((s, r) => s + repairTotal(r), 0),
    [repairs],
  );
  const maintCost = useCallback(
    (id) => plans.filter((p) => p.assetId === id).reduce((s, p) => s + planSpend(p), 0),
    [plans],
  );

  const rows = useMemo(() => {
    return assets.filter((a) => {
      const st = availOf(a, openJob(a.id));
      const bucket = st.key === "retired" ? "retired" : st.key === "active" ? "active" : "out";
      if (f.company && a.company !== f.company) return false;
      if (f.category && a.category !== f.category) return false;
      if (f.location && a.location !== f.location) return false;
      if (f.custodian && a.custodian !== f.custodian) return false;
      if (f.status && bucket !== f.status) return false;
      if (f.from && String(a.acquired || "") < f.from) return false;
      if (f.to && String(a.acquired || "") > f.to) return false;
      return true;
    }).map((a) => ({ ...a, avail: availOf(a, openJob(a.id)), value: num(a.cost), rep: repairCost(a.id), mnt: maintCost(a.id) }))
      .map((r) => ({ ...r, upkeep: r.rep + r.mnt }))
      .sort((x, y) => sort === "value" ? y.value - x.value : sort === "upkeep" ? y.upkeep - x.upkeep : String(x.tag).localeCompare(String(y.tag)));
  }, [assets, f, sort, openJob, repairCost, maintCost]);


  const T = rows.reduce((s, r) => ({ value: s.value + r.value, rep: s.rep + r.rep, mnt: s.mnt + r.mnt }), { value: 0, rep: 0, mnt: 0 });
  const groups = useMemo(() => {
    const m = {};
    rows.forEach((r) => {
      const k = (group === "status" ? r.avail.label : r[group]) || "Unassigned";
      m[k] = m[k] || { k, n: 0, value: 0, up: 0 };
      m[k].n++; m[k].value += r.value; m[k].up += r.upkeep;
    });
    return Object.values(m).sort((a, b) => b.value - a.value);
  }, [rows, group]);
  const maxVal = Math.max(1, ...groups.map((g) => g.value));

  const sel = { ...inputStyle, padding: "7px 8px", fontSize: 13 };
  const exportRows = () => csv(["tag", "asset_code", "body_no", "company", "name", "category", "address", "custodian", "availability", "acquired", "asset_value", "repair_cost", "maintenance_cost", "total_upkeep"],
    rows.map((r) => [r.tag, r.code, r.body, r.company, r.name, r.category, r.location, r.custodian, r.avail.label, r.acquired, r.value, r.rep, r.mnt, r.upkeep]), `report-${today()}.csv`);

  return (<>
    <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-7 gap-3 mb-4 px-4 py-4" style={{ background: C.surface, border: `1px solid ${C.rule}` }}>
      {[["company", "Company", ctx.companyNames], ["category", "Category", ctx.categoryNames], ["location", "Address", ctx.locations], ["custodian", "Responsible person", ctx.people]].map(([k, l, opts]) => (
        <div key={k}><Label>{l}</Label>
          <select style={sel} value={f[k]} onChange={(e) => set(k, e.target.value)}>
            <option value="">All</option>{opts.map((o) => <option key={o} value={o}>{o}</option>)}
          </select></div>
      ))}
      <div><Label>Availability</Label>
        <select style={sel} value={f.status} onChange={(e) => set("status", e.target.value)}>
          <option value="">All</option><option value="active">Active</option><option value="out">Broken or in repair</option><option value="retired">Retired</option>
        </select></div>
      <div><Label>Acquired from</Label><input type="date" style={sel} value={f.from} onChange={(e) => set("from", e.target.value)} /></div>
      <div><Label>Acquired to</Label><input type="date" style={sel} value={f.to} onChange={(e) => set("to", e.target.value)} /></div>
    </div>

    <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-4">
      {[["Assets in query", String(rows.length), C.ink], ["Total asset value", money0(T.value), C.active],
        ["Total repair cost", money0(T.rep), STAGES.ongoing.color], ["Total maintenance cost", money0(T.mnt), C.ok]].map(([l, v, col]) => (
        <div key={l} className="px-4 py-3" style={{ background: C.surface, border: `1px solid ${C.rule}`, borderTop: `2px solid ${col}` }}>
          <Label>{l}</Label><div style={{ fontFamily: MONO, fontSize: 23, fontWeight: 700, color: col, lineHeight: 1.2 }}>{v}</div>
        </div>
      ))}
    </div>

    <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3" style={{ background: C.surface, border: `1px solid ${C.rule}`, borderBottom: "none" }}>
      <div style={{ fontSize: 13.5 }}>
        Upkeep to date <strong style={{ fontFamily: MONO }}>{money0(T.rep + T.mnt)}</strong>
        <span style={{ color: C.mute }}> — {T.value ? Math.round(((T.rep + T.mnt) / T.value) * 100) : 0}% of asset value</span>
      </div>
      <div className="flex items-center gap-2">
        <select style={{ ...sel, width: "auto" }} value={sort} onChange={(e) => setSort(e.target.value)}>
          <option value="tag">Sort by tag</option><option value="value">Highest value</option><option value="upkeep">Highest upkeep</option>
        </select>
        <Btn small icon={Download} onClick={exportRows}>Export this report</Btn>
      </div>
    </div>

    {/* grouped totals */}
    <div className="px-4 py-4" style={{ background: C.surface, border: `1px solid ${C.rule}`, borderBottom: "none" }}>
      <div className="flex items-center gap-3 mb-3">
        <Label>Totals by</Label>
        <select style={{ ...sel, width: "auto", marginTop: -4 }} value={group} onChange={(e) => setGroup(e.target.value)}>
          <option value="company">Company</option><option value="category">Category</option><option value="location">Address</option><option value="custodian">Responsible person</option><option value="status">Availability</option>
        </select>
      </div>
      {groups.length === 0 ? <div style={{ fontSize: 13, color: C.mute }}>Nothing matches this query.</div> : groups.map((g) => (
        <div key={g.k} className="flex items-center gap-3 py-1.5">
          <div className="truncate" style={{ width: 150, fontSize: 13 }}>{g.k}</div>
          <div style={{ fontFamily: MONO, fontSize: 11, color: C.mute, width: 26 }}>{g.n}</div>
          <div className="flex-1" style={{ background: C.ruleSoft, height: 14, position: "relative" }}>
            <div style={{ position: "absolute", inset: 0, width: `${(g.value / maxVal) * 100}%`, background: C.active }} />
          </div>
          <div style={{ fontFamily: MONO, fontSize: 12.5, width: 100, textAlign: "right" }}>{money0(g.value)}</div>
          <div style={{ fontFamily: MONO, fontSize: 12.5, width: 90, textAlign: "right", color: STAGES.ongoing.color }}>+{money0(g.up)}</div>
        </div>
      ))}
    </div>

    {/* detail table */}
    <div className="overflow-x-auto" style={{ background: C.surface, border: `1px solid ${C.rule}` }}>
      <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 1060 }}>
        <thead>
          <tr style={{ background: C.soft }}>
            {["Asset no.", "Asset code", "Asset", "Company", "Category", "Address", "Responsible", "Availability", "Value", "Repairs", "Maintenance", "Upkeep"].map((h, i) => (
              <th key={h} className="uppercase" style={{ fontFamily: MONO, fontSize: 9.5, letterSpacing: "0.12em", color: C.mute, textAlign: i > 7 ? "right" : "left", padding: "9px 10px", borderBottom: `1px solid ${C.rule}`, whiteSpace: "nowrap" }}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 && <tr><td colSpan={12} style={{ padding: "40px 10px", textAlign: "center", color: C.mute, fontSize: 13.5 }}>No assets match this query. Loosen a filter to widen it.</td></tr>}
          {rows.map((r) => (
            <tr key={r.id} style={{ borderBottom: `1px solid ${C.ruleSoft}` }}>
              <td style={{ padding: "8px 10px", fontFamily: MONO, fontSize: 12, fontWeight: 700 }}>{r.tag}</td>
              <td style={{ padding: "8px 10px", fontFamily: MONO, fontSize: 11.5, color: C.mute }}>{r.code || "—"}</td>
              <td style={{ padding: "8px 10px", fontSize: 13.5 }}>{r.name}</td>
              <td style={{ padding: "8px 10px", fontSize: 13, color: C.mute }}>{r.company || "—"}</td>
              <td style={{ padding: "8px 10px", fontSize: 13, color: C.mute }}>{r.category || "—"}</td>
              <td style={{ padding: "8px 10px", fontSize: 13, color: C.mute }}>{r.location}</td>
              <td style={{ padding: "8px 10px", fontSize: 13, color: C.mute }}>{r.custodian}</td>
              <td style={{ padding: "8px 10px" }}><Chip color={r.avail.color} tint={r.avail.tint}>{r.avail.label}</Chip></td>
              <td style={{ padding: "8px 10px", fontFamily: MONO, fontSize: 12.5, textAlign: "right" }}>{money(r.value)}</td>
              <td style={{ padding: "8px 10px", fontFamily: MONO, fontSize: 12.5, textAlign: "right", color: r.rep ? STAGES.ongoing.color : C.mute }}>{money(r.rep)}</td>
              <td style={{ padding: "8px 10px", fontFamily: MONO, fontSize: 12.5, textAlign: "right", color: r.mnt ? C.ok : C.mute }}>{money(r.mnt)}</td>
              <td style={{ padding: "8px 10px", fontFamily: MONO, fontSize: 12.5, textAlign: "right", fontWeight: 700 }}>{money(r.upkeep)}</td>
            </tr>
          ))}
        </tbody>
        {rows.length > 0 && (
          <tfoot>
            <tr style={{ background: C.soft }}>
              <td colSpan={8} className="uppercase" style={{ padding: "10px", fontFamily: MONO, fontSize: 10.5, letterSpacing: "0.14em" }}>Total · {rows.length} assets</td>
              {[T.value, T.rep, T.mnt, T.rep + T.mnt].map((v, i) => (
                <td key={i} style={{ padding: "10px", fontFamily: MONO, fontSize: 13, textAlign: "right", fontWeight: 700, borderTop: `1px solid ${C.rule}` }}>{money(v)}</td>
              ))}
            </tr>
          </tfoot>
        )}
      </table>
    </div>
  </>);
}
