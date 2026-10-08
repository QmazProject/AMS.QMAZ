import { useState, useEffect, useId, useMemo, useRef, useCallback } from "react";
import { createPortal } from "react-dom";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import * as XLSX from "xlsx";
import {
  Plus, Search, ArrowLeftRight, Wrench, Archive, Pencil, Trash2, ChevronLeft,
  Download, Upload, X, RotateCcw, CircleDot, AlertCircle, AlertTriangle,
  ChevronRight, ChevronDown, Package, ShoppingBasket, ClipboardList, CalendarClock, CalendarCheck, BarChart3, Coins, QrCode, ShoppingCart, Receipt, Paperclip, Settings, Building2, Tag, MapPin, Map as MapIcon, Layers,
  Users, CheckCircle2, Printer, Eye, FileText, Hash,
} from "lucide-react";
import UserManagement from "./src/UserManagement.jsx";
import { useDialogFocus, useEscapeKey } from "./src/lib/modal.js";
import { dropQuery, readQuery } from "./src/router.js";
import { appLink, qrDataUri } from "./src/lib/qr.js";
import { decodeFromCanvas, decodeFromFile, readScan } from "./src/lib/scan.js";
import { prepareUpload } from "./src/lib/imagePrep.js";
import { registerTrend, trendDays } from "./src/lib/trend.js";
import { downloadTransferForm, printTransferForm, transferFormHtml, transferFormItem } from "./src/lib/transferForm.js";
import { A4, downloadEroForm, eroEquipment, eroFormHtml, printEroForm, durationBetween as spanLabel } from "./src/lib/eroForm.js";
import {
  completeMaintenance, createAsset, createCategory, createCompany, createMaintenanceSchedule,
  createProject, createRepair, createRepairPart, deleteAsset, deleteCategory, deleteCompany,
  deleteCompanyLogo, deleteMaintenanceSchedule, deleteProject, deleteRepairPart, getReceiptUrl, loadOperationalData,
  reinstateAsset, removeReceipt as removeStoredReceipt, retireAsset, saveReceipt, transferAsset, transferAssets,
  updateAsset, updateCategory, updateCompany, updateMaintenanceSchedule, updateProject,
  createPerson, deletePerson, setCompanyHeaderBrand, updatePerson,
  getTransferAttachmentUrl, removeTransferAttachment, renameTransferAttachment, saveTransferAttachment,
  getMaintenanceAttachmentUrl, removeMaintenanceAttachment, renameMaintenanceAttachment, saveMaintenanceAttachment,
  getAssetAttachmentUrl, getAssetAttachmentUrls, removeAssetAttachment, saveAssetAttachment, updateAssetAttachment,
  createBrand, deleteBrand, updateBrand,
  deleteAssetPhoto, uploadAssetPhoto, saveAssetImage, setAssetImagePositions, removeAssetImage,
  updateReceiptMetadata, updateRepair, updateRepairPart, uploadCompanyLogo, upsertProjects,
  SEQUENCE_DEFAULT, formatSequenceNumber, saveNumberingSequence, sequenceProblem, unsupportedAssetNumbers,
  MAINTENANCE_RECORD_TYPES, REPAIR_PLACES, maintenanceRecordTypeLabel, emptyMaintenanceRecord, blankMaintenancePartLine,
  createMaintenanceRecord, updateMaintenanceRecord, deleteMaintenanceRecord,
} from "./src/data/assetManagementService.js";
import { discoverLegacyBrowserData, importLegacySnapshot, parseLegacyBackup } from "./src/data/legacyBrowserImport.js";
import { AssetImportError, ASSET_SHEET_NAME, buildTemplate, planAssetImport, readAssetSheet } from "./src/data/assetExcelImport.js";

/* --------------------------------------------------------------------
   Huemint dark scheme. Slate ground, pale text, sand for primary actions
   and selection, red only as stripes and fills. Every value comes from the
   token block in src/index.css, so this file states roles rather than
   colours and a re-skin never has to touch a component again.
--------------------------------------------------------------------- */
const C = {
  paper: "var(--ams-bg)", surface: "var(--ams-surface)", ink: "var(--ams-text)", mute: "var(--ams-mute)",
  rule: "var(--ams-line)", ruleSoft: "var(--ams-line-soft)", soft: "var(--ams-surface-2)",
  brand: "var(--ams-sand)", brandInk: "var(--ams-on-sand)", brandEdge: "var(--ams-sand-deep)",
  brandDeep: "var(--ams-sand-ink)", head: "var(--ams-head)", dim: "var(--ams-dim)",
  active: "var(--ams-ok)", retired: "var(--ams-idle)", due: "var(--ams-warn)",
  overdue: "var(--ams-alarm)", ok: "var(--ams-ok)",
};
const TINT = {
  brand: "var(--ams-sand-tint)", ok: "var(--ams-ok-tint)", warn: "var(--ams-warn-tint)",
  alarm: "var(--ams-alarm-tint)", info: "var(--ams-info-tint)", idle: "var(--ams-idle-tint)",
  test: "var(--ams-test-tint)",
};
const MONO = 'ui-monospace, SFMono-Regular, Menlo, "Roboto Mono", monospace';
const SANS = '"Poppins", -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
const DISPLAY = SANS;

const STAGES = {
  broken: { label: "For repair", avail: "For repair", color: C.overdue, tint: TINT.alarm },
  parts: { label: "Parts purchase", avail: "Awaiting parts", color: C.due, tint: TINT.warn },
  ongoing: { label: "Ongoing repair", avail: "Ongoing repair", color: "var(--ams-info)", tint: TINT.info },
  testing: { label: "Done — for testing", avail: "Under testing", color: "var(--ams-test)", tint: TINT.test },
};
const STAGE_ORDER = ["broken", "parts", "ongoing", "testing"];

const today = () => new Date().toISOString().slice(0, 10);
const num = (v) => { const n = parseFloat(v); return isNaN(n) ? 0 : n; };
const money = (v) => num(v) ? num(v).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : "—";
const money0 = (v) => num(v).toLocaleString(undefined, { maximumFractionDigits: 0 });
const count = (v) => num(v).toLocaleString(undefined, { maximumFractionDigits: 0 });
const metric = (v) => typeof v === "number" ? count(v) : v;
const cap = (t) => t ? t[0].toUpperCase() + t.slice(1) : t;
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

/* The one way anything leaves this workspace as a file.

   A click starts a download; the browser reads the blob afterwards, on its own
   schedule. Revoking the URL in the same tick - which this used to do - pulls
   the file out from under a download that has not read it yet, so the button
   appears to do nothing at all. Whether the race is won depends on the browser
   and on how large the file is, which is why it worked sometimes and not
   others. The anchor also goes into the document before it is clicked: Firefox
   will not action a click on a detached one. */
const saveBlob = (blob, name) => {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  link.rel = "noopener";
  link.style.display = "none";
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
};

const createCsvContent = (head, rows) => [head, ...rows]
  .map((row) => row.map(serializeCsvCell).join(","))
  .join("\r\n");

/* Excel reads a CSV in the machine's own codepage unless the file opens with a
   byte-order mark, which is how "Niño" arrives as "NiÃ±o". One character at the
   front settles it, and every other reader ignores it. */
const CSV_BOM = "\uFEFF";

/* The same table as a real workbook. Excel opens a .xlsx without asking any
   questions about delimiters or encodings, which a .csv cannot promise. */
const buildWorkbook = (head, rows, sheetName) => {
  const sheet = XLSX.utils.aoa_to_sheet([head, ...rows]);
  const book = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(book, sheet, sheetName.slice(0, 31));
  return new Blob([XLSX.write(book, { bookType: "xlsx", type: "array" })], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
};

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
/* Which categories carry a body number: heavy equipment, trucks, tools,
   machinery and equipment, every class of service vehicle, and motorcycles.
   Matched on the wording like catKind, so "Service Vehicle Class C" added
   later still qualifies. Anything else - IT, office, laboratory, surveying -
   has no body number, and the field stays off the form. */
const hasBodyNumber = (cat) => /heavy|truck|\btools?\b|machinery|service\s*vehicle|motor\s*-?\s*cycle|motorbike/i.test(String(cat || ""));
const bodyField = (cat, field) => (hasBodyNumber(cat) ? [field] : []);
const identifierSummary = (cat) => [serialLabel(cat), ...vehicleKeys(cat).map((k) => VEHICLE_FIELD_DEFS[k].label.toLowerCase())].join(", ");
const vehicleFields = (cat, a = {}) => vehicleKeys(cat).map((k) => ({ key: k, mono: true, value: a[k], ...VEHICLE_FIELD_DEFS[k] }));
/* what a category cannot carry is blanked on save, so a value typed before
   the category was changed does not ride along unseen */
const clearedVehicle = (cat) => ({
  ...Object.fromEntries(VEHICLE_ONLY.filter((k) => !vehicleKeys(cat).includes(k)).map((k) => [k, ""])),
  ...(hasBodyNumber(cat) ? {} : { body: "" }),
});

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

/* Whatever the asset already holds stays selectable, so one recorded before
   this list existed can still be saved without renaming its person. */
const peopleWith = (people, current) => {
  const name = String(current || "").trim();
  return name && !people.includes(name) ? [...people, name] : people;
};
/* Assets registered before a list existed, or under an entry since removed,
   keep what they were saved with — so the value on the asset is offered even
   when the registry no longer holds it, and editing something else cannot
   quietly blank it. */
const withCurrent = peopleWith;
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
  { key: "logo", label: "Company logo", type: "image", full: true, value: c?.logoUrl || "",
    blank: Building2, clearLabel: "Remove logo",
    hint: "PNG, JPG, WEBP or SVG, up to 2 MB. Shown beside the company name." },
];
const checkCompany = (v, x, self) => {
  const n = normKey(v.name);
  const clash = x.companyNames.some((o) => normKey(o) === n && normKey(o) !== normKey(self?.name || ""));
  return clash ? `A company called "${String(v.name).trim()}" is already on the list.` : null;
};

const personFields = (person, x) => [
  { key: "first", label: "First name", required: true, value: person?.first, placeholder: "Maria" },
  { key: "middle", label: "Middle name", value: person?.middle, placeholder: "Santos" },
  { key: "last", label: "Last name", required: true, value: person?.last, placeholder: "Delgado" },
  { key: "companyIds", label: "Branch / company", type: "checks", full: true,
    options: x.companies, value: person?.companyIds || [],
    empty: "No companies set up yet. Add them above and they will appear here.",
    hint: "Where this person works. Recorded for tracing later — it does not narrow the list shown when registering an asset." },
  { key: "notes", label: "Notes", type: "textarea", full: true, value: person?.notes },
];

/* Models are edited as a list on the brand rather than as records of their
   own: a model is only ever a name under a make, and typing them one per line
   is faster than a row at a time. */
const brandFields = (brand) => [
  { key: "name", label: "Brand/Manufacturer", required: true, full: true, value: brand?.name, placeholder: "Komatsu" },
  { key: "models", label: "Models", type: "textarea", rows: 5, full: true,
    value: (brand?.models || []).map((model) => model.name).join("\n"),
    placeholder: "PC200-8\nD65EX-16\nGD535-5",
    hint: "One per line. These are what the registration form offers once this brand is chosen." },
  { key: "notes", label: "Notes", type: "textarea", full: true, value: brand?.notes },
];

const BRAND_ACTIONS = {
  addBrand: {
    title: "Add brand", submit: "Add brand",
    note: "The makes an asset can carry, and the models each one sells. Registration picks from this list rather than accepting typed names, so one make cannot end up on the register three different ways.",
    fields: brandFields,
  },
  editBrand: {
    title: "Edit brand", submit: "Save changes",
    note: "Renaming a brand or editing its models changes what the asset forms offer. Assets already registered keep the make and model they were saved with.",
    fields: brandFields,
  },
};

const PERSON_ACTIONS = {
  addPerson: {
    title: "Add responsible person", submit: "Add person",
    note: "The people an asset can be signed out to. Registration and transfer choose from this list rather than accepting typed names, so one person cannot become three custodians.",
    fields: personFields,
  },
  editPerson: {
    title: "Edit responsible person", submit: "Save changes",
    note: "Correcting a name here updates the list the asset forms offer. Assets already recorded keep the name they were saved with.",
    fields: personFields,
  },
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

/* A repair rarely needs one part. Somebody at the counter has a list - seals, a
   bearing, gasket paper - and a new line inherits the supplier, status and date
   of the line above it, because those three are what a batch genuinely shares.
   The name and the price are what make each part different, so they start
   blank. The states themselves are already declared once at the top of this
   file and shared with the Parts tab, so they are not restated here. */
const blankPart = (from) => ({
  uid: `part-${crypto.randomUUID()}`,
  name: "", qty: "1", unit: "",
  supplier: from?.supplier || "", date: from?.date || today(),
});
/* What a line is estimated to cost in all: how many, times the estimated cost
   of one. It is worked out as the lines are typed and is what the ticket
   stores as the part's estimate. */
const partEstimate = (row) => num(row.qty) * num(row.unit);

/* One ticket, then as many parts as the job needs. The ticket stays a single
   field because a part belongs to exactly one repair, and asking for it once
   is the whole reason these are being added together. */
const partListFields = (p, x) => [
  { key: "ticket", label: "Repair ticket", required: true, type: "select",
    options: p?.ticketLocked ? [p.ticket] : x.openTickets, value: p?.ticket || "", readOnly: !!p?.ticketLocked },
  { key: "parts", label: "Parts", type: "parts", full: true, value: [blankPart()], suppliers: x.providers },
];

const PART_ACTIONS = {
  addPart: {
    title: "Add parts", submit: "Add parts",
    note: "Parts belong to a repair ticket, so pick the ticket this is for. Everything the job needs can go on at once — a new line starts with the supplier and date of the one above it.",
    fields: partListFields,
  },
  needPart: {
    title: "Parts needed", submit: "Add part and await purchase",
    note: "The parts are logged for buying on the Parts tab, and this ticket moves to Parts purchase. It takes the same details as Add parts, so list everything the job needs now.",
    fields: partListFields,
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

/* What an asset's own QR code carries: the code printed on its sticker, or its
   asset number when no sticker has been recorded. Scanning it opens the asset
   in the register — for whoever holds access to it. */
const assetScanKey = (a) => String(a?.code || a?.tag || "").trim();

/* AST-10 is not "before" AST-2, whatever a string comparison thinks. */
const assetSeq = (a) => {
  const digits = String(a?.tag || "").replace(/\D/g, "");
  return digits ? Number.parseInt(digits, 10) : 0;
};
const assetDeepLink = (a) => appLink({ asset: assetScanKey(a) });
const matchesScan = (a, wanted) => {
  const key = String(wanted || "").trim().toLowerCase();
  return !!key && (String(a.code || "").trim().toLowerCase() === key || String(a.tag || "").trim().toLowerCase() === key);
};

const PHOTO_TYPES = "image/jpeg,image/png,image/webp,image/gif,image/heic,image/heif";
const PHOTO_LIMIT = 10 * 1024 * 1024;

/* ------------------------- the asset's paperwork -------------------------
   The three documents nearly every machine arrives with, offered as a list so
   they are named the same way every time. "Other" is not one of them: it is
   the prompt for the user's own words, because a register accumulates
   certificates nobody wrote a dropdown for.
   ------------------------------------------------------------------------ */
const DOC_TYPES = ["Sales Invoice (SI)", "Certificate of Registration (CR)", "Deed of Sale (DOD)"];
const DOC_OTHER = "Other";
const DOC_ACCEPT = "application/pdf,image/jpeg,image/png,image/webp,image/heic,image/heif";
/* what may be kept with a historic maintenance record: a quotation arrives
   as a Word document as often as a scan, so those are allowed too */
const HISTORY_ACCEPT = "application/pdf,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document,image/jpeg,image/png,image/webp,image/heic,image/heif";
const DOC_LIMIT = 10 * 1024 * 1024;

/* One stored string becomes a dropdown choice plus, where it is not one of the
   listed kinds, the words that were typed instead. */
const docTypeParts = (stored) => (DOC_TYPES.includes(stored)
  ? { docType: stored, other: "" }
  : { docType: stored ? DOC_OTHER : "", other: stored || "" });
/* ...and back again: what actually gets stored against the document. */
const docTypeValue = (row) => String(row.docType === DOC_OTHER ? row.other || "" : row.docType || "").trim();
/* What the form starts with: the documents already filed against this asset,
   in the same shape a freshly picked file takes, so the list that edits them
   does not have to tell the two apart. */
const docEntries = (asset) => (asset.files || []).map((file) => ({
  uid: file.id, id: file.id, bucket: file.bucket, path: file.path,
  label: file.label, type: file.type, size: file.size, at: file.at,
  ...docTypeParts(file.docType),
}));
/* A spreadsheet can carry a serial number; it cannot carry a scan of a deed of
   sale. File-shaped fields are part of the form but never part of an import. */
const importable = (f) => !["image", "images", "file", "files", "parts"].includes(f.type);

/* The photographs already on this asset, in the shape a freshly picked file
   takes, so one list edits both. The order is the meaning: index 0 is the
   cover, which is why promoting an image is simply moving it to the front. */
const imageEntries = (asset) => {
  const held = (asset.images || []).map((image) => ({
    uid: image.id, id: image.id, path: image.path, url: image.url,
  }));
  if (held.length) return held;
  /* A register whose images migration has not run yet still has the one
     picture its asset row points at, and opening the edit form must not be
     what throws it away. It comes in carrying a path but no id, which is
     exactly what a picture that still needs a row looks like. */
  return asset.photoUrl ? [{ uid: "cover", path: asset.photoPath, url: asset.photoUrl }] : [];
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
  if (d < 0) return { key: "overdue", label: `${Math.abs(d)}d overdue`, color: C.overdue, tint: TINT.alarm, rank: 0 };
  if (d === 0) return { key: "today", label: "Due today", color: C.overdue, tint: TINT.alarm, rank: 1 };
  if (d <= 7) return { key: "week", label: `In ${d}d`, color: C.due, tint: TINT.warn, rank: 2 };
  if (d <= 30) return { key: "month", label: `In ${d}d`, color: C.active, tint: TINT.ok, rank: 3 };
  return { key: "later", label: fmt(p.nextDue), color: C.mute, tint: C.soft, rank: 4 };
};

const availOf = (a, job) => {
  if (a.status === "retired") return { key: "retired", label: "Retired", color: C.retired, tint: TINT.idle };
  if (job) return { key: job.stage, label: STAGES[job.stage].avail, color: STAGES[job.stage].color, tint: STAGES[job.stage].tint };
  return { key: "active", label: "Active", color: C.active, tint: TINT.ok };
};

/* ------------------------------ actions ------------------------------ */

/* What paperwork an asset carries, in one cell. A spreadsheet row is one
   asset, so several documents have to fold into a single value: the kinds it
   holds, and how many of each where a kind turns up more than once. Kept to
   plain ASCII because a CSV without a byte-order mark is read as the local
   codepage by Excel, and "x2" survives that where a multiplication sign does
   not. */
const docTypeSummary = (files) => {
  /* A real Map: the lucide icon of the same name is imported as MapIcon above,
     precisely so that this line means what it says. */
  const tally = new Map();
  (files || []).forEach((file) => tally.set(file.docType, (tally.get(file.docType) || 0) + 1));
  return [...tally].map(([kind, n]) => (n > 1 ? `${kind} x${n}` : kind)).join("; ");
};

/* Enough of an asset to know which machine is being ticked: what the register
   calls it, then whichever numbers are stencilled on it, then where it is
   standing now. A cart of four excavators is otherwise four identical lines. */
const cartLine = (asset) => [
  asset.code && `Code ${asset.code}`,
  asset.serial && `SN ${asset.serial}`,
  asset.body && `Body ${asset.body}`,
  asset.location && `now at ${asset.location}`,
].filter(Boolean).join(" · ");

/* The destination half of a movement: where it is going, who signs for it and
   when. One asset or a cartful, the questions are the same — only the values
   the form opens with differ, so the origin is passed in rather than assumed. */
const movementFields = (from, x, v = {}) => {
  const pid = String(v.project || "");
  const proj = x.projects.find((pr) => pr.pid === pid);
  return [
    { key: "project", label: "Project/Location", required: true, type: "select",
      options: x.projects.map((pr) => pr.pid),
      value: from.project || "",
      hint: x.projects.length ? "The address is filled in from the list. Leave it blank if the asset is somewhere that isn't on it." : "No project/locations set up yet — leave this blank, or add them under Settings." },
    { key: "location", label: "Address", required: true, value: from.location || "", list: x.locations,
      derivedOn: pid, derived: proj ? proj.location : "",
      readOnly: !!proj,
      hint: proj ? `Looked up from ${proj.pid}. Clear the project if the asset is going somewhere that isn't on the list.`
        : `Not a project site — type the address.` },
    { key: "custodian", label: "New responsible person", required: true, type: "select",
      options: peopleWith(x.people, from.custodian), value: from.custodian || "",
      hint: "Configured under Settings — Responsible persons." },
    { key: "date", label: "Effective date", type: "date", value: today() },
    { key: "reason", label: "Reason / reference", placeholder: "Reassignment, memo no.", full: true },
  ];
};

const ASSET_ACTIONS = {
  register: {
    title: "Register asset", submit: "Register asset",
    fields: (a, x, v = {}) => {
      const pid = String(v.project || "");
      const proj = x.projects.find((pr) => pr.pid === pid);
      return [
      { key: "tag", label: "Asset number", required: true, value: x.nextTag, mono: true,
        readOnly: x.tagIsIssued,
        hint: x.tagIsIssued
          ? "Issued by the system when you save. The numbering carries on across the whole register, whatever companies you can see."
          : null },
      { key: "code", label: "Asset code (QR sticker)", mono: true, placeholder: "Scan or type the sticker code", hint: "The code printed on the QR sticker stuck to this asset" },
      { key: "company", label: "Company", type: "select", options: x.companyNames, required: x.companyNames.length > 0, hint: x.companyNames.length ? null : "Add companies under Settings first" },
      { key: "name", label: "What is it", required: true, placeholder: "Dell Latitude 5440" },
      { key: "category", label: "Category", type: "select", options: x.categoryNames },
      /* what kind of machine it is, as opposed to which one — optional, because
         plenty of small equipment carries neither marking */
      { key: "brand", label: "Brand/Manufacturer", type: "select", options: x.brandNames,
        hint: x.brandNames.length ? "Configured under Settings — Brands and models." : "No brands set up yet. Add them under Settings first." },
      { key: "model", label: "Model", type: "select", options: x.modelsOf(v.brand),
        /* a model belongs to its make, so changing the make clears it */
        derivedOn: v.brand || "", derived: "",
        hint: !v.brand ? "Choose a brand first." : x.modelsOf(v.brand).length ? null : `No models are listed for ${v.brand}. Add them under Settings.` },
      { key: "serial", label: serialLabel(v.category), mono: true },
      ...vehicleFields(v.category),
      ...bodyField(v.category, { key: "body", label: "Body number", mono: true, placeholder: "BN-14" }),
      { key: "project", label: "Project/Location", type: "select",
        options: x.projects.map((pr) => pr.pid),
        hint: x.projects.length ? "The address is filled in from the list. Leave it blank if the asset is somewhere that isn't on it." : "No project/locations set up yet — leave this blank, or add them under Settings." },
      { key: "location", label: "Address", required: true, placeholder: "Main office — 2F", list: x.locations,
        derivedOn: pid, derived: proj ? proj.location : "",
        readOnly: !!proj,
        hint: proj ? `Looked up from ${proj.pid}. Clear the project if the asset is somewhere that isn't on the list.` : null },
      { key: "custodian", label: "Responsible person", required: true, type: "select", options: x.people,
        hint: x.people.length ? "Configured under Settings — Responsible persons." : "No one is configured yet. Add people under Settings first." },
      { key: "acquired", label: "Date acquired", type: "date", value: today() },
      { key: "cost", label: "Acquisition cost", type: "number" },
      { key: "photos", label: "Asset images", type: "images", full: true, value: [],
        accept: PHOTO_TYPES,
        empty: "No image yet. The first one added becomes the default, and you can change which that is.",
        hint: "JPG, PNG, WEBP, GIF or HEIC, up to 10 MB each. The one marked Default is what the register shows wherever it has room for a single picture — beside the asset in the list, and at the top of this panel." },
      { key: "files", label: "Documents", type: "files", full: true, value: [],
        accept: DOC_ACCEPT, onOpen: x.openFile,
        empty: "Nothing attached yet. The sales invoice, certificate of registration or deed of sale can go on now, or be added later from Edit details.",
        hint: "PDF, JPG or PNG, up to 10 MB each. Give each one a type so it can be found by what it is rather than by who filed it." },
      { key: "notes", label: "Notes", type: "textarea", full: true },
      ];
    },
    validate: checkUnique,
  },
  /* the form itself is AssetForm, shared with register */
  edit: { title: "Edit details", submit: "Save changes" },
  transfer: {
    title: "Transfer asset", submit: "Record transfer",
    /* The paperwork travels with the asset, so it can be run off while the
       transfer is being recorded rather than hunted for afterwards. */
    aside: {
      icon: Printer, label: "Print transfer form",
      run: (v, a, x) => printTransferForm({
        company: x.companies.find((company) => company.name === a.company) || { name: a.company || "" },
        asset: a,
        movement: {
          date: v.date || today(), fromLoc: a.location, toLoc: v.location,
          fromPer: a.custodian, toPer: v.custodian,
          /* the movement is not written yet, so the released-by box carries
             whoever is recording it — the account filling this form in */
          releasedBy: x.userName,
          fromProject: a.project, toProject: v.project, reference: v.reason || "",
          /* the number is assigned when the movement is recorded, so a sheet
             run off from this form leaves it blank to be filled from the
             Transfers tab, or reprinted from there once saved */
          number: "",
        },
      }),
    },
    note: "Move the asset to a new location, a new responsible person, or both.",
    fields: (a, x, v = {}) => movementFields(a, x, v),
  },
  /* The same questions as a single transfer, asked once for a cartful. The
     fields open blank rather than prefilled, because a cart has no one origin
     to default from — its assets are alike only in where they are going. */
  transferCart: {
    title: "Transfer the cart", submit: "Record transfers",
    aside: {
      icon: Printer, label: "Print transfer form",
      run: (v, a, x) => {
        const picked = new Set(v.picked || []);
        const held = (a.cart || []).filter((asset) => picked.has(asset.id));
        const date = v.date || today();
        printTransferForm({
          company: x.companies.find((company) => company.name === held[0]?.company) || { name: held[0]?.company || "" },
          asset: held[0] || {},
          movement: {
            date, releasedBy: x.userName, number: "",
            /* one sheet, one line per asset — which is what the ruled pad was
               always for, and what makes a cartful callable out on delivery */
            items: held.map((asset) => transferFormItem(asset, {
              date,
              fromLoc: asset.location, toLoc: v.location,
              fromPer: asset.custodian, toPer: v.custodian,
              fromProject: asset.project, toProject: v.project,
            })),
          },
        });
      },
    },
    note: "Tick the assets that are going, then say where. Every one ticked moves to the same address and responsible person on the same date, and is recorded as its own movement.",
    fields: (a, x, v = {}) => {
      const held = a.cart || [];
      return [
        { key: "picked", label: "Assets to move", type: "checks", full: true, required: true,
          options: held.map((asset) => ({ id: asset.id, name: `${asset.tag} · ${asset.name}`, hint: cartLine(asset) })),
          /* everything in the cart is going unless somebody says otherwise —
             the cart was built by choosing, so choosing again is the exception */
          value: held.map((asset) => asset.id),
          empty: "Nothing in the cart can be moved. Assets under repair are left out." },
        ...movementFields({}, x, v),
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
      { key: "custodian", label: "Responsible person", required: true, type: "select",
        options: peopleWith(x.people, a.custodian), value: a.custodian },
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
  /* Nothing opens this: the ticket's own "Add part" button and the Parts tab
     both dispatch { kind: "part" }, which lands in PART_ACTIONS. Left as it
     was rather than quietly built on. */
  addPart: {
    title: "Add part", submit: "Add part",
    fields: (a, x) => [
      { key: "name", label: "Part", required: true, placeholder: "Battery, 54Wh" },
      { key: "qty", label: "Quantity", type: "number", value: "1" },
      { key: "unit", label: "Unit cost", type: "number" },
      { key: "supplier", label: "Supplier", list: x.providers },
      { key: "state", label: "Status", type: "select", options: PART_STATES, value: "Needed" },
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
const PART_COLOR = { Needed: C.overdue, Ordered: C.due, Purchased: C.ok };

/* ------------------------------ atoms ------------------------------ */

const Label = ({ children }) => (
  <div className="ams-label">{children}</div>
);
const Dot = ({ color, size = 7 }) => (
  <span style={{ width: size, height: size, background: color, borderRadius: 999 }} className="inline-block shrink-0" />
);
const Chip = ({ color, tint, children, big }) => (
  <span className="inline-flex items-center gap-2" style={{
    background: tint, color, border: `1px solid ${color}22`, borderRadius: 20,
    padding: big ? "6px 11px" : "4px 9px", fontFamily: SANS, fontSize: big ? 11.5 : 11,
    letterSpacing: "0.045em", textTransform: "uppercase", fontWeight: 750, whiteSpace: "nowrap",
  }}><Dot color={color} size={big ? 7 : 6} />{children}</span>
);

const MetricTile = ({ label, value, tone = C.ink, hint }) => (
  <div className="ams-metric" style={{ "--tone": tone }}>
    <Label>{label}</Label>
    <div className="ams-metric-v">{metric(value)}</div>
    {hint && <div className="ams-metric-hint">{hint}</div>}
  </div>
);

/* A record number - asset, repair ticket, transfer - on a light plate with a
   red stripe down its left edge, so a number reads as a number wherever it
   turns up. */
const RecordTag = ({ children, big, style }) => (
  <span className="ams-tag" data-big={big ? "1" : undefined} style={style}>{children}</span>
);

/* An icon drawn from an image file in public/icon. A black silhouette is used
   as a mask over the control's own text colour, so it follows the button the
   way a line icon did; full-colour art (mask={false}) is shown as it is. */
function ImgIcon({ src, size = 16, mask = true, className, style }) {
  return mask
    ? <span aria-hidden="true" className={className} style={{ display: "inline-block", flex: "0 0 auto", width: size, height: size, background: "currentColor", WebkitMask: `url("${src}") center/contain no-repeat`, mask: `url("${src}") center/contain no-repeat`, ...style }} />
    : <img aria-hidden="true" alt="" src={src} width={size} height={size} className={className} style={{ display: "block", flex: "0 0 auto", objectFit: "contain", ...style }} />;
}

/* kind is "solid" (the sand primary action), "ghost" or "danger"; the look
   of each lives with the rest of the chrome in CHROME_CSS */
function Btn({ children, onClick, icon: Icon, img, kind = "ghost", small, disabled, iconClass }) {
  return (
    <button onClick={disabled ? undefined : onClick} disabled={disabled} className="ams-btn" data-kind={kind} data-small={small ? "1" : undefined}>
      {img ? <ImgIcon src={img} size={small ? 13 : 14} className={iconClass} /> : Icon && <Icon size={small ? 13 : 14} strokeWidth={2} className={iconClass} />}{children}
    </button>
  );
}

const inputStyle = { width: "100%", minHeight: 42, padding: "9px 11px", border: `1px solid ${C.rule}`, borderRadius: 10, background: C.surface, color: C.ink, fontSize: 14, fontFamily: SANS, outline: "none" };

/* =========================================================================
   The documents filed against one asset, edited as a list.

   A machine arrives with an invoice, usually a registration, sometimes a deed
   of sale, and they turn up one at a time rather than all at once - so the
   control is a growing list with a plus on the end, not a single slot.

   A row is either a file just picked, which carries a File and has not been
   uploaded yet, or one already filed, which carries an id and can be opened.
   Both are named and typed the same way, so the list never has to explain the
   difference; only the line above the inputs differs, because only one of them
   has anything to open.
   ========================================================================= */
/* =========================================================================
   The photographs of one asset, edited as an ordered list.

   One picture says which excavator this is; it does not show the dent on the
   offside door, and that is a second photograph taken on the same walkaround.
   So this is a list, and because the register has places where it can show
   exactly one picture, the list has a front. The one at the front is the
   default, and making another the default moves it there - there is no
   separate flag that could get out of step with the order.
   ========================================================================= */
/* =========================================================================
   The parts a repair needs, entered together.

   Typing them one dialog at a time is five round trips to record what was a
   single trip to the supplier, so this is a list with a plus on the end and
   one save at the finish. The running total sits beside the plus, because the
   question after "what does it need" is always "what will it cost".
   ========================================================================= */
/* A compact field that still says what it is. Smaller than the form's own
   Label, because inside a card it is a caption rather than a heading. */
const Micro = ({ label, span, children }) => (
  <div style={span ? { gridColumn: "span 2" } : undefined}>
    <span className="block uppercase" style={{ fontFamily: SANS, fontSize: 9, fontWeight: 800,
      letterSpacing: "0.07em", color: C.dim, marginBottom: 3 }}>{label}</span>
    {children}
  </div>
);

function PartLines({ f, value, onChange }) {
  /* never empty: the form seeds one line and the remove control hides itself
     at the last one, so there is always somewhere to type */
  const rows = Array.isArray(value) && value.length ? value : [];
  const box = { ...inputStyle, minHeight: 36, fontSize: 13, borderRadius: 8 };
  const set = (uid, patch) => onChange(rows.map((row) => (row.uid === uid ? { ...row, ...patch } : row)));
  const total = rows.reduce((sum, row) => sum + partEstimate(row), 0);

  return (
    <div className="grid gap-2">
      {rows.map((row, index) => (
        <div key={row.uid} style={{ border: `1px solid ${C.rule}`, borderRadius: 10, padding: "9px 10px", background: C.surface }}>
          <div className="flex items-center gap-2 mb-2">
            <span className="uppercase" style={{ fontFamily: MONO, fontSize: 10, letterSpacing: "0.08em", color: C.dim }}>Part {index + 1}</span>
            <span className="flex-1" />
            {rows.length > 1 && (
              <button type="button" onClick={() => onChange(rows.filter((one) => one.uid !== row.uid))}
                title={`Remove part ${index + 1}`} aria-label={`Remove part ${index + 1}`}
                className="p-1 hover:opacity-60" style={{ color: STAGES.broken.color }}><X size={14} /></button>
            )}
          </div>
          <Micro label="Description">
            <input style={box} value={row.name} placeholder="Battery, 54Wh" aria-label={`Part ${index + 1} description`}
              onChange={(e) => set(row.uid, { name: e.target.value })} />
          </Micro>
          {/* A filled-in figure beside a filled-in date says nothing about
              which is which, and a placeholder is gone the moment it is
              needed - so these carry their own small label. */}
          <div className="grid grid-cols-3 gap-2 mt-2">
            <Micro label="Qty">
              <input style={box} type="number" min="0" step="any" value={row.qty} aria-label={`Part ${index + 1} quantity`}
                onChange={(e) => set(row.uid, { qty: e.target.value })} />
            </Micro>
            <Micro label="Estimated unit cost">
              <input style={box} type="number" min="0" step="any" value={row.unit} aria-label={`Part ${index + 1} estimated unit cost`}
                onChange={(e) => set(row.uid, { unit: e.target.value })} />
            </Micro>
            <Micro label="Total amount">
              <div style={{ ...box, display: "flex", alignItems: "center", justifyContent: "flex-end", background: C.soft, fontFamily: MONO, cursor: "default" }}
                aria-label={`Part ${index + 1} total amount`}>{partEstimate(row) ? money(partEstimate(row)) : "—"}</div>
            </Micro>
          </div>
          <div className="grid grid-cols-2 gap-2 mt-2">
            <Micro label="Preferred supplier">
              <input style={box} value={row.supplier} list="dl-part-supplier" aria-label={`Part ${index + 1} preferred supplier`}
                onChange={(e) => set(row.uid, { supplier: e.target.value })} />
            </Micro>
            <Micro label="Date requested">
              <input style={box} type="date" value={row.date} aria-label={`Part ${index + 1} date requested`}
                onChange={(e) => set(row.uid, { date: e.target.value })} />
            </Micro>
          </div>
        </div>
      ))}
      <datalist id="dl-part-supplier">{(f.suppliers || []).map((one) => <option key={one} value={one} />)}</datalist>
      <div className="flex flex-wrap items-center gap-3">
        <button type="button" onClick={() => onChange([...rows, blankPart(rows[rows.length - 1])])}
          className="inline-flex items-center gap-1.5 hover:opacity-70"
          style={{ fontSize: 12.5, fontWeight: 700, color: C.ink, border: `1px dashed ${C.rule}`,
            borderRadius: 8, padding: "7px 11px", background: C.soft }}>
          <Plus size={13} strokeWidth={2.4} />Add another part
        </button>
        {total > 0 && (
          <span style={{ fontFamily: MONO, fontSize: 12, color: C.mute }}>
            {rows.length} {rows.length === 1 ? "part" : "parts"} · total {money(total)}
          </span>
        )}
      </div>
    </div>
  );
}

function AssetImageRows({ f, value, onChange }) {
  const rows = Array.isArray(value) ? value : [];
  const picker = useRef(null);
  const add = (chosen) => {
    const picked = Array.from(chosen || []);
    if (!picked.length) return;
    onChange([...rows, ...picked.map((file) => ({
      uid: `new-${crypto.randomUUID()}`, file,
      /* minted once and carried on the entry, rather than on every render */
      url: URL.createObjectURL(file),
    }))]);
  };
  const promote = (uid) => onChange([
    ...rows.filter((one) => one.uid === uid),
    ...rows.filter((one) => one.uid !== uid),
  ]);

  return (
    <div className="grid gap-2">
      {rows.length === 0 && <div style={{ fontSize: 12.5, color: C.mute }}>{f.empty}</div>}
      {rows.length > 0 && (
        <div className="grid grid-cols-3 sm:grid-cols-4 gap-2">
          {rows.map((row, index) => (
            <div key={row.uid} style={{ overflow: "hidden", borderRadius: 8, background: C.surface,
              border: `1px solid ${index === 0 ? C.brandEdge : C.rule}` }}>
              <span className="relative block" style={{ height: 84, background: C.soft }}>
                <img src={row.url} alt="" style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }} />
                <button type="button" onClick={() => onChange(rows.filter((one) => one.uid !== row.uid))}
                  title="Remove this image" aria-label="Remove this image"
                  className="absolute flex items-center justify-center hover:opacity-100"
                  style={{ top: 4, right: 4, width: 20, height: 20, borderRadius: 999, opacity: 0.94,
                    border: `1px solid ${C.rule}`, background: C.surface, color: STAGES.broken.color }}>
                  <X size={11} strokeWidth={2.6} />
                </button>
              </span>
              {index === 0 ? (
                <span className="block text-center uppercase" title="Shown wherever the register has room for one picture"
                  style={{ fontFamily: SANS, fontSize: 9, fontWeight: 800, letterSpacing: "0.07em",
                    color: C.brandInk, background: C.brand, padding: "4px 0" }}>Default</span>
              ) : (
                <button type="button" onClick={() => promote(row.uid)}
                  title="Show this one wherever the register has room for a single picture"
                  className="block w-full text-center hover:opacity-70"
                  style={{ fontFamily: SANS, fontSize: 10, fontWeight: 700, color: C.mute,
                    background: C.soft, padding: "4px 0", borderTop: `1px solid ${C.ruleSoft}` }}>
                  Make default
                </button>
              )}
            </div>
          ))}
        </div>
      )}
      <div>
        <input ref={picker} type="file" multiple accept={f.accept || PHOTO_TYPES} className="hidden"
          onChange={(e) => { add(e.target.files); e.target.value = ""; }} />
        <button type="button" onClick={() => picker.current?.click()}
          className="inline-flex items-center gap-1.5 hover:opacity-70"
          style={{ fontSize: 12.5, fontWeight: 700, color: C.ink, border: `1px dashed ${C.rule}`,
            borderRadius: 8, padding: "7px 11px", background: C.soft }}>
          <Plus size={13} strokeWidth={2.4} />{rows.length ? "Add another image" : "Add an image"}
        </button>
      </div>
    </div>
  );
}

function AttachmentRows({ f, value, onChange }) {
  const rows = Array.isArray(value) ? value : [];
  const picker = useRef(null);
  /* `plain` rows carry a name and nothing else - a file kept with a
     maintenance record is not sorted by kind the way the asset's own
     paperwork is; `readOnly` shows what is filed without offering to change it */
  const plain = !!f.plain, readOnly = !!f.readOnly;
  const box = { ...inputStyle, minHeight: 36, fontSize: 13, borderRadius: 8, ...(readOnly ? { background: C.soft, color: C.mute, cursor: "not-allowed" } : {}) };
  const set = (uid, patch) => onChange(rows.map((row) => (row.uid === uid ? { ...row, ...patch } : row)));
  const add = (chosen) => {
    const picked = Array.from(chosen || []);
    if (!picked.length) return;
    onChange([...rows, ...picked.map((file) => ({
      uid: `new-${crypto.randomUUID()}`, file,
      /* the scanner's name is a starting point, not the answer - which is why
         it lands in an editable box rather than being filed as it came */
      label: file.name, docType: "", other: "",
    }))]);
  };

  return (
    <div className="grid gap-2">
      {rows.length === 0 && <div style={{ fontSize: 12.5, color: C.mute }}>{f.empty}</div>}
      {rows.map((row) => {
        const named = row.docType === DOC_OTHER;
        return (
          <div key={row.uid} style={{ border: `1px solid ${C.rule}`, borderRadius: 10, padding: "9px 10px", background: C.surface }}>
            <div className="flex items-center gap-2">
              <Paperclip size={13} style={{ color: C.mute, flexShrink: 0 }} />
              <span className="truncate flex-1" style={{ fontFamily: MONO, fontSize: 11.5, color: C.mute }}>
                {row.file ? `${row.file.name} · ${kb(row.file.size)}` : `${kb(row.size)} · filed ${row.at}`}
              </span>
              {row.id && f.onOpen && (
                <button type="button" onClick={() => f.onOpen(row)}
                  title={`Open ${row.label}`} aria-label={`Open ${row.label}`}
                  className="flex items-center gap-1 hover:opacity-60" style={{ fontSize: 12, color: C.ink }}>
                  <Eye size={12} />View
                </button>
              )}
              {!readOnly && (
                <button type="button" onClick={() => onChange(rows.filter((one) => one.uid !== row.uid))}
                  title={`Remove ${row.label || "this document"}`} aria-label={`Remove ${row.label || "this document"}`}
                  className="p-1 hover:opacity-60" style={{ color: STAGES.broken.color }}>
                  <X size={14} />
                </button>
              )}
            </div>
            {plain ? (
              <input style={{ ...box, marginTop: 8 }} value={row.label || ""} aria-label="File name" readOnly={readOnly}
                placeholder="What to call this file"
                onChange={(e) => set(row.uid, { label: e.target.value })} />
            ) : (
              <div className="grid sm:grid-cols-2 gap-2 mt-2">
                <input style={box} value={row.label || ""} aria-label="Document name"
                  placeholder="What to call this document"
                  onChange={(e) => set(row.uid, { label: e.target.value })} />
                <select style={box} value={row.docType || ""} aria-label="Type of document"
                  onChange={(e) => set(row.uid, { docType: e.target.value })}>
                  <option value="">Type of document —</option>
                  {DOC_TYPES.map((kind) => <option key={kind} value={kind}>{kind}</option>)}
                  <option value={DOC_OTHER}>{DOC_OTHER}…</option>
                </select>
              </div>
            )}
            {!plain && named && (
              <input style={{ ...box, marginTop: 8 }} value={row.other || ""} aria-label="Name this kind of document"
                placeholder="Name this kind of document — Official Receipt, Insurance policy…"
                onChange={(e) => set(row.uid, { other: e.target.value })} />
            )}
          </div>
        );
      })}
      {!readOnly && (
        <div>
          <input ref={picker} type="file" multiple accept={f.accept || DOC_ACCEPT} className="hidden"
            onChange={(e) => { add(e.target.files); e.target.value = ""; }} />
          <button type="button" onClick={() => picker.current?.click()}
            className="inline-flex items-center gap-1.5 hover:opacity-70"
            style={{ fontSize: 12.5, fontWeight: 700, color: C.ink, border: `1px dashed ${C.rule}`, borderRadius: 8, padding: "7px 11px", background: C.soft }}>
            <Plus size={13} strokeWidth={2.4} />{plain ? (rows.length ? "Add another file" : "Add a file") : (rows.length ? "Add another document" : "Add a document")}
          </button>
        </div>
      )}
    </div>
  );
}

/* =========================================================================
   The paperwork filed against an asset, shown on the asset.

   A register accumulates documents faster than a panel has room for them, so
   this is one row that scrolls sideways rather than a grid that grows: an
   asset with twelve documents pushes the details no further down the panel
   than an asset with three.

   A document is recognised by what kind it is before it is recognised by what
   it is called - "the CR", not "the file named scan0043" - so the kind leads
   and the name follows it. A scan gets a thumbnail, because a photographed
   invoice is identified on sight the same way the machine is; the bucket is
   private, so those are signed for in one round trip when the panel opens. A
   PDF gets a glyph, its first page not being something a browser renders
   cheaply into a 100px box.
   ========================================================================= */
/* =========================================================================
   The machine, at the size the panel has always shown it.

   An asset with six photographs takes exactly as much room here as one with a
   single photograph: the block keeps its height and gains a pair of arrows, a
   count, and a mark on the one that represents the asset everywhere else. A
   walkaround therefore costs the panel nothing.
   ========================================================================= */
function AssetImages({ images, alt, onOpen }) {
  const [at, setAt] = useState(0);
  const many = images.length > 1;
  /* an image removed under a panel left open must not leave this past the end */
  const index = Math.min(at, images.length - 1);
  const step = (by) => setAt((now) => (Math.min(now, images.length - 1) + by + images.length) % images.length);

  const arrow = (by, Icon, label) => (
    <button type="button" onClick={() => step(by)} title={label} aria-label={label}
      className="absolute top-1/2 flex items-center justify-center hover:opacity-100"
      style={{ [by < 0 ? "left" : "right"]: 8, transform: "translateY(-50%)", width: 30, height: 30,
        borderRadius: 999, border: `1px solid ${C.rule}`, background: C.surface, color: C.ink, opacity: 0.9 }}>
      <Icon size={16} strokeWidth={2.2} />
    </button>
  );

  return (
    <div className="px-5 pb-4">
      <Label>Asset image{many ? `s · ${images.length}` : ""}</Label>
      <div className="relative">
        {/* the panel shows it at a size that says which machine this is; the
            gallery shows it at a size that says what state the machine is in */}
        <button type="button" onClick={() => onOpen(index)} className="block w-full"
          title="Open this image" aria-label="Open this image" style={{ cursor: "zoom-in" }}>
          <img src={images[index].url} alt={alt}
            style={{ display: "block", width: "100%", height: 240, objectFit: "contain",
              background: C.soft, border: `1px solid ${C.ruleSoft}`, borderRadius: 2 }} />
        </button>
        <span aria-hidden="true" className="absolute flex items-center gap-1"
          style={{ top: 8, right: 8, pointerEvents: "none", fontFamily: SANS, fontSize: 10, fontWeight: 700, color: C.ink,
            background: C.surface, border: `1px solid ${C.rule}`, borderRadius: 20, padding: "3px 8px", opacity: 0.92 }}>
          <Eye size={11} />View
        </span>
        {many && (
          <>
            {arrow(-1, ChevronLeft, "Previous image")}
            {arrow(1, ChevronRight, "Next image")}
            {/* which one this is, and whether it is the one the rest of the
                register uses to stand for the asset */}
            {index === 0 && (
              <span className="absolute uppercase" style={{ top: 8, left: 8, pointerEvents: "none", fontFamily: SANS, fontSize: 9,
                fontWeight: 800, letterSpacing: "0.07em", color: C.brandInk, background: C.brand,
                borderRadius: 20, padding: "3px 8px" }}>Default</span>
            )}
            <span className="absolute" style={{ bottom: 8, right: 8, pointerEvents: "none", fontFamily: MONO, fontSize: 10.5,
              color: C.ink, background: C.surface, border: `1px solid ${C.rule}`, borderRadius: 20,
              padding: "2px 8px", opacity: 0.92 }}>{index + 1} / {images.length}</span>
          </>
        )}
      </div>
    </div>
  );
}

function AssetDocuments({ files, onOpen }) {
  const [shots, setShots] = useState({});
  const strip = useRef(null);
  /* the ids are what actually changes here - the array itself is rebuilt on
     every render of the panel, and depending on it would re-sign endlessly */
  const key = files.map((one) => one.id).join(",");
  useEffect(() => {
    let live = true;
    const pictures = files.filter((one) => String(one.type || "").startsWith("image/"));
    /* nothing to sign: whatever is held from the asset looked at before is
       keyed by ids this panel no longer renders, so it cannot show through */
    if (!pictures.length) return undefined;
    getAssetAttachmentUrls(pictures)
      .then((found) => { if (live) setShots(found); })
      .catch(() => { /* a thumbnail that will not sign is a gap, not a failure */ });
    return () => { live = false; };
    /* eslint-disable-next-line react-hooks/exhaustive-deps */
  }, [key]);

  /* roughly two cards at a time, which keeps a place in the row rather than
     jumping to an edge the way a full-width page would */
  const slide = (by) => strip.current?.scrollBy({ left: by * 360, behavior: "smooth" });
  /* four cards no longer fit the widest the panel gets, so that is where the
     arrows start earning their place */
  const scrolls = files.length > 3;

  return (
    <div className="px-5 pb-4">
      <div className="flex items-end justify-between">
        <Label>Documents · {files.length}</Label>
        {scrolls && (
          <div className="flex gap-1" style={{ marginBottom: 6 }}>
            {[[-1, ChevronLeft, "Scroll documents left"], [1, ChevronRight, "Scroll documents right"]].map(([by, Icon, label]) => (
              <button key={label} type="button" onClick={() => slide(by)} title={label} aria-label={label}
                className="flex items-center justify-center hover:opacity-70"
                style={{ width: 24, height: 24, border: `1px solid ${C.rule}`, borderRadius: 6, background: C.surface, color: C.mute }}>
                <Icon size={13} strokeWidth={2.2} />
              </button>
            ))}
          </div>
        )}
      </div>
      <div ref={strip} className="ams-strip flex gap-3 overflow-x-auto" style={{ paddingBottom: 6, scrollSnapType: "x proximity" }}>
        {files.map((file, index) => (
          <button key={file.id} type="button" onClick={() => onOpen(index)}
            title={`Open ${file.label} — ${file.docType}`}
            aria-label={`Open ${file.label} — ${file.docType}`}
            className="text-left overflow-hidden hover:opacity-80"
            style={{ width: 168, flexShrink: 0, scrollSnapAlign: "start",
              border: `1px solid ${C.ruleSoft}`, borderRadius: 2, background: C.surface }}>
            <span style={{ display: "grid", placeItems: "center", height: 104, overflow: "hidden",
              background: C.soft, borderBottom: `1px solid ${C.ruleSoft}` }}>
              {shots[file.id]
                ? <img src={shots[file.id]} alt={file.label} style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                : <FileText size={22} style={{ color: C.dim }} />}
            </span>
            <span className="block px-2.5 py-2">
              {/* what kind of paper this is, which is the thing being looked for */}
              <span className="inline-block uppercase" style={{ fontFamily: SANS, fontSize: 9.5, fontWeight: 800,
                letterSpacing: "0.06em", lineHeight: 1.35, color: C.brandDeep, background: TINT.brand,
                borderRadius: 20, padding: "3px 7px" }}>{file.docType}</span>
              <span className="block truncate" style={{ fontSize: 13, marginTop: 5 }}>{file.label}</span>
              <span className="block" style={{ fontFamily: MONO, fontSize: 10.5, color: C.dim, marginTop: 2 }}>
                {kb(file.size)} · {fmt(file.at)}
              </span>
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}

/* =========================================================================
   Looking through a stack of things, one at a time.

   Two stacks use this: an asset's paperwork and an asset's photographs. They
   differ only in where the file comes from - a document lives in a private
   bucket and has to be signed for, a photograph is public and already carries
   its url - so `resolve` is optional and everything else is shared. Keeping
   one component means the fixed frame below is written once, which is the part
   that has to stay right: paging must never resize the dialog.
   ========================================================================= */
function MediaGallery({ items, at, onClose, resolve }) {
  const [index, setIndex] = useState(at);
  /* one piece of state, so nothing has to be reset synchronously as the
     selection moves - `done` is what separates "still signing" from "would
     not sign", which otherwise both look like an absent URL */
  const [signed, setSigned] = useState({ done: false, urls: {} });
  const panel = useRef(null);
  const titleId = useId();
  const item = items[index];

  useEscapeKey(true, onClose);
  useDialogFocus(panel);

  const key = items.map((one) => one.id).join(",");
  useEffect(() => {
    /* nothing to sign: these carry their own url and are ready on arrival */
    if (!resolve) return undefined;
    let live = true;
    resolve(items)
      .then((urls) => { if (live) setSigned({ done: true, urls }); })
      .catch(() => { if (live) setSigned({ done: true, urls: {} }); });
    return () => { live = false; };
    /* eslint-disable-next-line react-hooks/exhaustive-deps */
  }, [key, resolve]);

  const step = useCallback((by) => setIndex((now) => (now + by + items.length) % items.length), [items.length]);
  useEffect(() => {
    if (items.length < 2) return undefined;
    const onKey = (event) => {
      if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
      event.preventDefault();
      step(event.key === "ArrowLeft" ? -1 : 1);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [step, items.length]);

  const ready = resolve ? signed.done : true;
  const src = resolve ? signed.urls[item.id] : item.url;
  const download = () => {
    if (!src) return;
    const a = document.createElement("a");
    a.href = src; a.download = item.download || item.title || "file"; a.click();
  };

  const arrow = (by, Icon, label) => (
    <button type="button" onClick={() => step(by)} title={label} aria-label={label}
      className="absolute top-1/2 flex items-center justify-center hover:opacity-100"
      style={{ [by < 0 ? "left" : "right"]: 10, transform: "translateY(-50%)", width: 38, height: 38,
        borderRadius: 999, border: `1px solid ${C.rule}`, background: C.surface, color: C.ink, opacity: 0.9 }}>
      <Icon size={19} strokeWidth={2.2} />
    </button>
  );

  return (
    <div className="ams-scrim fixed inset-0 z-50 flex items-center justify-center p-4">
      <div ref={panel} tabIndex={-1} role="dialog" aria-modal="true" aria-labelledby={titleId}
        className="flex flex-col"
        /* A fixed frame, not one that wraps its contents: paging through a
           portrait scan, a landscape one and a PDF would otherwise jump the
           dialog to a different size on every press of the arrow, and the
           arrows themselves would move out from under the pointer. The
           document is scaled to fit the stage instead. */
        style={{ maxWidth: 860, width: "100%", height: "min(88vh, 820px)", background: C.surface, borderRadius: 2, outline: "none" }}>
        <div className="flex items-start justify-between gap-3 px-4 py-3" style={{ flexShrink: 0, borderBottom: `1px solid ${C.ruleSoft}` }}>
          <div className="min-w-0">
            {item.kind && (
              <span className="inline-block uppercase" style={{ fontFamily: SANS, fontSize: 9.5, fontWeight: 800,
                letterSpacing: "0.06em", color: C.brandDeep, background: TINT.brand, borderRadius: 20, padding: "3px 7px" }}>{item.kind}</span>
            )}
            <div id={titleId} className="truncate" style={{ fontSize: 14, fontWeight: 600, marginTop: item.kind ? 4 : 0 }}>{item.title}</div>
            <div style={{ fontFamily: MONO, fontSize: 11, color: C.mute }}>{item.meta}</div>
          </div>
          <button type="button" onClick={onClose} aria-label="Close" style={{ color: C.mute }} className="p-1 hover:opacity-60"><X size={18} /></button>
        </div>
        {/* minHeight 0 so this takes the height left over rather than the
            height its contents want - a flex child defaults to refusing to
            shrink below its content, which is the other half of the jump */}
        <div className="relative flex-1 p-4" style={{ background: C.paper, minHeight: 0 }}>
          <div className="w-full h-full flex items-center justify-center overflow-auto">
            {!ready
              ? <div style={{ fontFamily: MONO, fontSize: 11, letterSpacing: "0.15em", color: C.mute }}>LOADING…</div>
              : !src
                ? <div className="text-center" style={{ fontSize: 13, color: C.overdue }}>This file could not be opened from Supabase Storage.</div>
                : item.type?.startsWith("image/")
                  ? <img src={src} alt={item.title} style={{ maxWidth: "100%", maxHeight: "100%", objectFit: "contain", display: "block" }} />
                  : <iframe title={item.title} src={src} style={{ width: "100%", height: "100%", alignSelf: "stretch", border: "none", background: C.soft }} />}
          </div>
          {items.length > 1 && arrow(-1, ChevronLeft, "Previous")}
          {items.length > 1 && arrow(1, ChevronRight, "Next")}
        </div>
        <div className="flex items-center justify-between gap-2 px-4 py-3" style={{ flexShrink: 0, borderTop: `1px solid ${C.ruleSoft}` }}>
          <span style={{ fontFamily: MONO, fontSize: 11.5, color: C.mute }}>
            {index + 1} / {items.length}{items.length > 1 ? "  ·  ← →" : ""}
          </span>
          <Btn icon={Download} onClick={download} disabled={!src}>Download</Btn>
        </div>
      </div>
    </div>
  );
}

/* What each stack looks like once it is in the gallery's own terms. */
const documentItems = (files) => files.map((file) => ({
  id: file.id, kind: file.docType, title: file.label, type: file.type,
  meta: `${kb(file.size)} · filed ${fmt(file.at)}`,
  bucket: file.bucket, path: file.path, download: file.label,
}));
const imageItems = (images, asset) => images.map((image, index) => ({
  id: image.id, kind: index === 0 ? "Default" : "", type: "image/*", url: image.url,
  title: `${asset.tag} · ${asset.name}`,
  meta: `Image ${index + 1} of ${images.length}${image.at ? ` · added ${fmt(image.at)}` : ""}`,
  download: `${asset.tag}-image-${index + 1}`,
}));


function Field({ f, value, onChange, bad }) {
  const base = { ...inputStyle, fontFamily: f.mono ? MONO : SANS, border: `1px solid ${bad ? STAGES.broken.color : C.rule}`, background: bad ? STAGES.broken.tint : C.surface };
  return (
    <div className={f.full ? "col-span-2" : "col-span-2 sm:col-span-1"}>
      <Label>{f.label}{f.required && <span style={{ color: STAGES.broken.color }}> *</span>}</Label>
      {f.type === "textarea" ? (
        <textarea rows={f.rows || 2} style={base} value={value} placeholder={f.placeholder} onChange={(e) => onChange(e.target.value)} />
      ) : f.type === "select" ? (
        <select style={{ ...base, ...(f.readOnly ? { background: C.soft, color: C.mute, cursor: "not-allowed" } : {}) }}
          value={value} disabled={f.readOnly} onChange={(e) => onChange(e.target.value)}>
          <option value="">—</option>{f.options.map((o) => <option key={o} value={o}>{o}</option>)}
        </select>
      ) : f.type === "checks" ? (
        /* An option may carry a second line naming the thing more exactly —
           a code, a serial, where it is standing right now — and a list that
           does gets a column to itself so the two lines stay readable. */
        <div className={f.options.some((option) => option.hint) ? "grid gap-1.5" : "grid sm:grid-cols-2 gap-1.5"}>
          {f.options.length === 0
            ? <div style={{ fontSize: 12.5, color: C.mute }}>{f.empty}</div>
            : (
              <>
                {f.options.length > 1 && (
                  <div className="flex items-center gap-3" style={{ fontSize: 12, color: C.mute, marginBottom: 2 }}>
                    <span style={{ fontFamily: MONO }}>{(value || []).length}/{f.options.length} selected</span>
                    <button type="button" className="underline" onClick={() => onChange(f.options.map((option) => option.id))}>All</button>
                    <button type="button" className="underline" onClick={() => onChange([])}>None</button>
                  </div>
                )}
                {f.options.map((option) => {
                  const chosen = (value || []).includes(option.id);
                  return (
                    <label key={option.id} className="flex items-start gap-2"
                      style={{ fontSize: 13, padding: option.hint ? "6px 8px" : 0, borderRadius: 8,
                        background: option.hint ? (chosen ? C.soft : "transparent") : "transparent",
                        border: option.hint ? `1px solid ${chosen ? C.rule : "transparent"}` : "none" }}>
                      <input type="checkbox" checked={chosen} style={{ marginTop: option.hint ? 3 : 0 }}
                        onChange={() => onChange(chosen ? (value || []).filter((id) => id !== option.id) : [...(value || []), option.id])} />
                      <span className="min-w-0">
                        {option.name}
                        {option.hint && <span className="block truncate" style={{ fontFamily: MONO, fontSize: 11, color: C.mute }}>{option.hint}</span>}
                      </span>
                    </label>
                  );
                })}
              </>
            )}
        </div>
      ) : f.type === "color" ? (
        <div className="flex items-center gap-3">
          <input type="color" value={value || "#0b0d0f"} onChange={(e) => onChange(e.target.value)}
            aria-label={f.label}
            style={{ width: 56, height: 42, flexShrink: 0, padding: 3, border: `1px solid ${C.rule}`, borderRadius: 10, background: C.surface, cursor: "pointer" }} />
          <span style={{ fontFamily: MONO, fontSize: 13, color: value ? C.ink : C.mute }}>
            {value ? String(value).toUpperCase() : "Not set"}
          </span>
          {value && <button type="button" onClick={() => onChange("")}
            style={{ fontSize: 12, color: STAGES.broken.color, textDecoration: "underline", cursor: "pointer" }}>Clear</button>}
        </div>
      ) : f.type === "image" ? (
        /* value is the stored URL to begin with, a File once one is picked,
           and null once it is cleared - so the dialog can tell "unchanged"
           from "replaced" from "removed" without a second field */
        <div className="flex items-center gap-3">
          <span style={{ width: 54, height: 54, flexShrink: 0, display: "grid", placeItems: "center", overflow: "hidden",
            border: `1px solid ${C.rule}`, borderRadius: 10, background: C.soft }}>
            {value
              ? <img src={typeof value === "string" ? value : URL.createObjectURL(value)} alt=""
                  style={{ width: "100%", height: "100%", objectFit: "contain" }} />
              : <f.blank size={20} style={{ color: C.mute }} />}
          </span>
          <div className="flex-1" style={{ minWidth: 0 }}>
            <input type="file" accept={f.accept || "image/png,image/jpeg,image/webp,image/svg+xml"}
              onChange={(e) => onChange(e.target.files?.[0] || null)}
              style={{ ...base, padding: "7px 8px", fontSize: 12.5 }} />
            <div className="flex items-center gap-3 mt-1">
              {value && typeof value !== "string" && (
                <span style={{ fontSize: 12, color: C.ok }}>{value.name} · {kb(value.size)}</span>
              )}
              {value && <button type="button" onClick={() => onChange(null)}
                style={{ fontSize: 12, color: STAGES.broken.color, textDecoration: "underline", cursor: "pointer" }}>{f.clearLabel || "Remove logo"}</button>}
            </div>
          </div>
        </div>
      ) : f.type === "parts" ? (
        <PartLines f={f} value={value} onChange={onChange} />
      ) : f.type === "images" ? (
        <AssetImageRows f={f} value={value} onChange={onChange} />
      ) : f.type === "files" ? (
        <AttachmentRows f={f} value={value} onChange={onChange} />
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

/* Shown when someone leaves a form they have typed into. It sits inside the
   dialog it belongs to rather than as a second overlay, so there is never a
   question of which one Escape is talking to - while it is up, Escape means
   "keep editing". */
function DiscardPrompt({ onKeep, onDiscard }) {
  const titleId = useId();
  return (
    <div className="ams-scrim absolute inset-0 z-10 flex items-center justify-center p-5">
      <div role="alertdialog" aria-modal="true" aria-labelledby={titleId}
        className="p-5" style={{ maxWidth: 380, background: C.surface, border: `1px solid ${C.rule}`, borderRadius: 2 }}>
        <div id={titleId} style={{ fontSize: 15.5, fontWeight: 600 }}>You have unsaved changes</div>
        <div style={{ fontSize: 13.5, color: C.mute, marginTop: 6, lineHeight: 1.5 }}>
          Closing this form now discards what you have entered. Nothing has been saved yet.
        </div>
        <div className="flex justify-end gap-2 mt-5">
          <Btn onClick={onKeep}>Keep editing</Btn>
          <Btn kind="danger" onClick={onDiscard}>Discard changes</Btn>
        </div>
      </div>
    </div>
  );
}

/* =========================================================================
   Import assets from Excel.

   Three steps, and nothing is written until the third: choose a workbook, read
   the plan it produces, then commit only the rows the plan marks ready. The
   preview is the point of the feature - an administrator populating a register
   for the first time should see what a file is about to do before it does it.

   What an asset is, which fields are required and what counts as a clash all
   come from the Register Asset form through `def`; this dialog only arranges
   the steps around it.
   ========================================================================= */
function AssetImportDialog({ def, ctx, existing, onCancel, onImport, busy }) {
  const [plan, setPlan] = useState(null);
  const [problem, setProblem] = useState("");
  const [result, setResult] = useState(null);
  const [report, setReport] = useState(false);
  const [reading, setReading] = useState(false);
  const panel = useRef(null);
  const titleId = useId();
  useEscapeKey(!busy, () => onCancel());
  useDialogFocus(panel);

  const columns = def.fields({}, ctx, {}).filter(importable);

  const chooseFile = async (file) => {
    if (!file) return;
    setProblem(""); setPlan(null); setReading(true);
    try {
      const sheet = readAssetSheet(await file.arrayBuffer());
      setPlan({ ...planAssetImport({ ...sheet, fieldsFor: (a, x, v) => def.fields(a, x, v).filter(importable), ctx, validate: def.validate, existing }), file: file.name });
    } catch (error) {
      setProblem(error instanceof AssetImportError ? error.message : `That file could not be read. ${error.message}`);
    } finally {
      setReading(false);
    }
  };

  const commit = async () => {
    const outcome = await onImport(plan.ready);
    setResult({ ...outcome, plan });
  };

  const downloadTemplate = () => saveBlob(buildTemplate(columns), "asset-import-template.xlsx");

  const rowsOf = (list, tone) => (
    <div className="mt-2" style={{ maxHeight: 190, overflowY: "auto", border: `1px solid ${C.ruleSoft}`, borderRadius: 2 }}>
      {list.map((entry) => (
        <div key={`${entry.excelRow}-${entry.tag}`} className="flex gap-3 px-3 py-2" style={{ borderBottom: `1px solid ${C.ruleSoft}`, fontSize: 12.5 }}>
          <span style={{ fontFamily: MONO, color: C.mute, flexShrink: 0 }}>row {entry.excelRow}</span>
          <span style={{ fontFamily: MONO, flexShrink: 0 }}>{entry.tag || "—"}</span>
          <span className="flex-1" style={{ color: tone }}>{entry.reason || entry.name}</span>
        </div>
      ))}
    </div>
  );

  const counts = plan && [
    { key: "new", tone: C.ok, icon: CheckCircle2, text: `${plan.ready.length} new asset${plan.ready.length === 1 ? "" : "s"} will be added` },
    { key: "existing", tone: C.due, icon: AlertCircle, text: `${plan.skipped.length} already on the register, left untouched` },
    { key: "invalid", tone: STAGES.broken.color, icon: AlertTriangle, text: `${plan.invalid.length} row${plan.invalid.length === 1 ? "" : "s"} cannot be imported` },
  ];

  return (
    <div className="ams-scrim fixed inset-0 z-50 flex items-end sm:items-center justify-center sm:p-6">
      <div ref={panel} tabIndex={-1} role="dialog" aria-modal="true" aria-labelledby={titleId}
        className="w-full overflow-y-auto"
        style={{ maxWidth: 640, maxHeight: "92vh", background: C.surface, borderRadius: 2, border: `1px solid ${C.rule}`, outline: "none" }}>
        <div className="flex items-start justify-between px-5 py-4" style={{ borderBottom: `1px solid ${C.ruleSoft}` }}>
          <div id={titleId} style={{ fontSize: 17, fontWeight: 600 }}>
            {result ? "Asset import complete" : "Import assets from Excel"}
          </div>
          <button type="button" onClick={onCancel} disabled={busy} aria-label="Close" style={{ color: C.mute }} className="p-1 hover:opacity-60 disabled:opacity-40"><X size={18} /></button>
        </div>

        {!plan && !result && (
          <div className="px-5 py-4">
            <div style={{ fontSize: 13, color: C.mute, lineHeight: 1.55 }}>
              Upload a workbook containing a worksheet named <b style={{ color: C.ink }}>{ASSET_SHEET_NAME}</b>. Its
              headings should name fields from the Register asset form — column order does not matter and the file
              can be called anything. Existing asset numbers are skipped, never overwritten.
            </div>
            <div className="mt-3 p-3" style={{ background: C.soft, borderRadius: 2 }}>
              <Label>Columns it looks for</Label>
              <div style={{ fontSize: 12.5, color: C.mute, lineHeight: 1.6 }}>{columns.map((f) => f.label).join(" · ")}</div>
            </div>
            <div className="mt-3">
              <Btn small icon={Download} onClick={downloadTemplate}>Download asset import template</Btn>
            </div>
            <div className="mt-4">
              <Label>Excel file</Label>
              <input type="file" accept=".xlsx,.xls,.csv" disabled={reading}
                onChange={(e) => chooseFile(e.target.files?.[0])}
                style={{ ...inputStyle, padding: "7px 8px", fontSize: 12.5 }} />
            </div>
            {problem && (
              <div className="mt-3 flex items-start gap-2 px-3 py-2" style={{ background: STAGES.broken.tint, color: STAGES.broken.color, fontSize: 13, lineHeight: 1.45 }}>
                <AlertCircle size={14} style={{ marginTop: 2, flexShrink: 0 }} />{problem}
              </div>
            )}
          </div>
        )}

        {plan && !result && (
          <div className="px-5 py-4">
            <div style={{ fontSize: 13, color: C.mute }}>
              <b style={{ color: C.ink }}>{plan.file}</b> · {plan.total} row{plan.total === 1 ? "" : "s"} found on the {ASSET_SHEET_NAME} sheet
            </div>
            <div className="mt-3 flex flex-col gap-1.5">
              {counts.map(({ key, tone, icon: Icon, text }) => (
                <div key={key} className="flex items-center gap-2" style={{ fontSize: 13.5, color: tone }}>
                  <Icon size={15} style={{ flexShrink: 0 }} />{text}
                </div>
              ))}
            </div>
            {plan.unrecognized.length > 0 && (
              <div className="mt-3 p-3" style={{ background: TINT.warn, color: C.due, fontSize: 12.5, lineHeight: 1.5 }}>
                <b>Unrecognised columns:</b> {plan.unrecognized.join(", ")}. These are not Register asset fields and will not be imported.
              </div>
            )}
            {plan.skipped.length > 0 && <><div className="mt-4"><Label>Already on the register</Label></div>{rowsOf(plan.skipped, C.mute)}</>}
            {plan.invalid.length > 0 && <><div className="mt-4"><Label>Cannot be imported</Label></div>{rowsOf(plan.invalid, STAGES.broken.color)}</>}
          </div>
        )}

        {result && (
          <div className="px-5 py-4">
            <div className="flex flex-col gap-1.5" style={{ fontSize: 13.5 }}>
              <div className="flex items-center gap-2" style={{ color: C.ok }}><CheckCircle2 size={15} />{result.added} new asset{result.added === 1 ? "" : "s"} added</div>
              <div className="flex items-center gap-2" style={{ color: C.mute }}><AlertCircle size={15} />{result.plan.skipped.length} already on the register, skipped</div>
              <div className="flex items-center gap-2" style={{ color: STAGES.broken.color }}><AlertTriangle size={15} />{result.plan.invalid.length + result.failed.length} row{result.plan.invalid.length + result.failed.length === 1 ? "" : "s"} could not be imported</div>
            </div>
            <div className="mt-3">
              <Btn small onClick={() => setReport((was) => !was)}>{report ? "Hide import report" : "View import report"}</Btn>
            </div>
            {report && (
              <div className="mt-1">
                {result.plan.skipped.length > 0 && <><div className="mt-3"><Label>Skipped — already on the register</Label></div>{rowsOf(result.plan.skipped, C.mute)}</>}
                {result.plan.invalid.length > 0 && <><div className="mt-3"><Label>Rejected before importing</Label></div>{rowsOf(result.plan.invalid, STAGES.broken.color)}</>}
                {result.failed.length > 0 && <><div className="mt-3"><Label>Failed while saving</Label></div>{rowsOf(result.failed, STAGES.broken.color)}</>}
              </div>
            )}
          </div>
        )}

        <div className="flex justify-end gap-2 px-5 py-4" style={{ borderTop: `1px solid ${C.ruleSoft}`, background: C.soft }}>
          {result
            ? <Btn kind="solid" onClick={onCancel}>Done</Btn>
            : (<>
              <Btn onClick={onCancel} disabled={busy}>Cancel</Btn>
              {plan && <Btn kind="solid" onClick={commit} disabled={busy || plan.ready.length === 0}>
                {busy ? "Importing…" : `Import ${plan.ready.length} new asset${plan.ready.length === 1 ? "" : "s"}`}
              </Btn>}
            </>)}
        </div>
      </div>
    </div>
  );
}

/* A row of a list field, reduced to what an edit could have changed. Every own
   key is read rather than a fixed handful, so documents, images and parts are
   all covered and a list added later cannot quietly compare equal. A File is
   not serialisable and its presence is itself the change. Options in a
   tick-list are plain ids and compare as themselves. */
const rowKey = (row) => (row && typeof row === "object"
  ? Object.keys(row).sort().map((k) => `${k}=${row[k] instanceof File ? "file" : String(row[k] ?? "")}`).join("|")
  : String(row));
const sameRows = (now, before) => Array.isArray(before)
  && now.length === before.length
  && now.every((row, index) => rowKey(row) === rowKey(before[index]));

/* Photographs go up before the asset row is written, which is what the single
   photo always did and still the right order: the row carries the cover path,
   and a storage failure should stop before anything is saved. What comes back
   is the list as the form left it, every entry now holding a path. */
async function uploadImages(entries) {
  const settled = [];
  for (const row of (Array.isArray(entries) ? entries : [])) {
    if (!row.file) { settled.push(row); continue; }
    /* a walkaround on a phone is several megabytes a shot, and the register
       wants a recognisable machine rather than a printable one */
    const { file } = await prepareUpload(row.file);
    if (file.size > PHOTO_LIMIT) throw new Error(`${row.file.name} is ${kb(file.size)}. The limit is 10 MB per image.`);
    settled.push({ ...row, path: await uploadAssetPhoto(file) });
  }
  return settled;
}

/* Once the asset row is safely written: pictures taken out of the list are
   detached, new ones are recorded against the asset, and every one of them is
   stamped with where it ended up - the stamp being what makes the front of the
   list mean "default" the next time the register loads. */
async function settleImages(assetId, ordered, before = []) {
  const kept = new Set(ordered.filter((row) => row.id).map((row) => row.id));
  const trouble = [];
  for (const gone of before.filter((row) => !kept.has(row.id))) {
    try { await removeAssetImage(gone); } catch { trouble.push("an image that was taken off"); }
  }
  const ids = [];
  for (const [index, row] of ordered.entries()) {
    try {
      if (row.id) ids.push(row.id);
      else if (row.path) ids.push((await saveAssetImage(assetId, row.path, index)).id);
    } catch { trouble.push(row.file?.name || "an image"); }
  }
  try { await setAssetImagePositions(ids); } catch { trouble.push("the image order"); }
  return trouble;
}

/* The documents ride along with the form rather than living on a screen of
   their own, so they are settled once the asset row is safely written: rows
   taken out of the list are detached, rows already filed pick up corrected
   names and types, and newly picked files go up. Each is attempted on its own,
   because one scan that will not upload should not cost the other three, and
   whatever failed is named back to the caller rather than swallowed. */
async function settleFiles(assetId, entries, before = []) {
  const rows = Array.isArray(entries) ? entries : [];
  const kept = new Set(rows.filter((row) => row.id).map((row) => row.id));
  const trouble = [];
  for (const gone of before.filter((row) => !kept.has(row.id))) {
    try { await removeAssetAttachment(gone); }
    catch { trouble.push(gone.label || "a document"); }
  }
  for (const row of rows) {
    const kind = docTypeValue(row);
    const named = String(row.label || "").trim();
    try {
      if (row.file) {
        /* a phone photograph of an invoice is megabytes of detail nobody
           reads; a PDF is already the document and passes through untouched */
        const { file } = await prepareUpload(row.file);
        if (file.size > DOC_LIMIT) throw new Error("over the limit");
        await saveAssetAttachment(assetId, file, { label: named || row.file.name, docType: kind });
      } else if (row.id) {
        const was = before.find((one) => one.id === row.id);
        if (was && (was.label !== named || was.docType !== kind)) {
          await updateAssetAttachment(row.id, { label: named || was.label, docType: kind });
        }
      }
    } catch { trouble.push(named || row.file?.name || "a document"); }
  }
  return trouble;
}

/* The files kept with a historic maintenance record, settled the same way
   once the record row is safely written: rows taken out are removed, rows
   already filed pick up a corrected name, and newly picked files go up. Each
   on its own, and whatever failed is named back rather than swallowed. */
async function settleHistoryFiles(recordId, entries, before = []) {
  const rows = Array.isArray(entries) ? entries : [];
  const kept = new Set(rows.filter((row) => row.id).map((row) => row.id));
  const trouble = [];
  for (const gone of before.filter((row) => !kept.has(row.id))) {
    try { await removeMaintenanceAttachment(gone); }
    catch { trouble.push(gone.name || "a file"); }
  }
  for (const row of rows) {
    const named = String(row.label || "").trim();
    try {
      if (row.file) {
        const { file } = await prepareUpload(row.file);
        if (file.size > DOC_LIMIT) throw new Error("over the limit");
        await saveMaintenanceAttachment(recordId, file, { name: named || row.file.name });
      } else if (row.id) {
        const was = before.find((one) => one.id === row.id);
        if (was && named && was.name !== named) await renameMaintenanceAttachment(row.id, named);
      }
    } catch { trouble.push(named || row.file?.name || "a file"); }
  }
  return trouble;
}
/* what the history form shows for the files already kept with a record */
const historyFileEntries = (record) => (record?.files || []).map((file) => ({
  uid: file.id, id: file.id, bucket: file.bucket, path: file.path,
  label: file.name, type: file.type, size: file.size, at: file.at, by: file.by,
}));

function Dialog({ def, subject, header, ctx, onCancel, onSubmit, busy = false }) {
  /* Initial pass seeds the values; every render after that rebuilds the field list
     from what's been typed, so a field can appear once its trigger is chosen. */
  const seed = useMemo(() => def.fields(subject || {}, ctx, {}), [def, subject, ctx]);
  const [vals, setVals] = useState(() => Object.fromEntries(seed.map((f) => [f.key, f.value ?? ""])));
  const [err, setErr] = useState("");
  const [askDiscard, setAskDiscard] = useState(false);
  const panel = useRef(null);
  const titleId = useId();
  const [opened] = useState(() => Object.fromEntries(seed.map((f) => [f.key, f.value ?? ""])));
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
  /* A picked file is always a change; everything else compares as text, which
     is what the fields hold. A list field holds objects, and stringifying an
     array of those compares every row equal - so its rows are compared by the
     parts of them that can actually be edited. */
  const dirty = Object.keys(vals).some((key) => {
    const now = vals[key];
    if (now instanceof File) return true;
    if (Array.isArray(now)) return !sameRows(now, opened[key]);
    return String(now ?? "") !== String(opened[key] ?? "");
  });

  /* Escape is the intentional equivalent of Cancel, so it takes the same
     route: nothing typed closes straight away, anything typed asks first. */
  const requestClose = () => {
    if (busy) return;
    if (dirty) return setAskDiscard(true);
    onCancel();
  };
  useEscapeKey(!busy, requestClose);
  useEscapeKey(askDiscard, () => setAskDiscard(false));
  useDialogFocus(panel);

  const dupe = def.validate ? def.validate(vals, ctx, subject || {}) : null;
  const clashKeys = dupe ? UNIQUE_FIELDS.filter(({ label }) => dupe.includes(label)).map((u) => u.key) : [];
  const go = () => {
    if (dupe) return setErr("");
    const miss = fields.filter((f) => f.required && !String(vals[f.key] || "").trim());
    if (miss.length) return setErr(`Fill in ${miss.map((m) => m.label.toLowerCase()).join(", ")}.`);
    /* A document nobody typed a kind for is filed as nothing in particular,
       which is the one thing the type is there to prevent. */
    const attached = fields.flatMap((f) => (f.type === "files" ? (vals[f.key] || []) : []));
    const untyped = attached.find((row) => !docTypeValue(row));
    if (untyped) return setErr(`Choose a type for ${untyped.label || untyped.file?.name || "each document"}.`);
    /* A line nobody typed a name into is not a part, and saving it would put a
       blank row on the ticket that somebody has to go and delete. */
    const parts = fields.flatMap((f) => (f.type === "parts" ? (vals[f.key] || []) : []));
    if (parts.length && !parts.some((row) => String(row.name || "").trim())) return setErr("Name at least one part.");
    const unnamed = parts.findIndex((row) => !String(row.name || "").trim());
    if (unnamed !== -1 && parts.length > 1) return setErr(`Part ${unnamed + 1} has no name. Give it one, or remove the line.`);
    /* An oversized photograph is shrunk on the way up; an oversized PDF is the
       document itself, so it has to be said now rather than after the save. */
    const heavy = attached.find((row) => row.file && row.file.size > DOC_LIMIT && !String(row.file.type || "").startsWith("image/"));
    if (heavy) return setErr(`${heavy.file.name} is ${kb(heavy.file.size)}. The limit is 10 MB per document.`);
    onSubmit(Object.fromEntries(fields.map((f) => [f.key, vals[f.key] ?? ""])));
  };
  /* Two sizes, as in the reference build: 560px for an ordinary form, 860px
     for one carrying a list of parts, photographs or documents, whose rows
     need the room. */
  const width = fields.some((f) => ["parts", "images", "files"].includes(f.type)) ? 860 : 560;
  /* No dismiss on the backdrop: a dialog is left through the X or Cancel, so a
     stray tap beside it cannot throw away what was typed. */
  return (
    <div className="ams-scrim fixed inset-0 z-50 flex items-end sm:items-center justify-center sm:p-6">
      <div className="relative w-full" style={{ maxWidth: width }}>
      <div ref={panel} tabIndex={-1} role="dialog" aria-modal="true" aria-labelledby={titleId}
        className="w-full overflow-y-auto"
        style={{ maxWidth: width, maxHeight: "92vh", background: C.surface, borderRadius: 2, border: `1px solid ${C.rule}`, outline: "none" }}>
        <div className="flex items-start justify-between px-5 py-4" style={{ borderBottom: `1px solid ${C.ruleSoft}` }}>
          <div>
            <div id={titleId} style={{ fontSize: 17, fontWeight: 600 }}>{def.title}</div>
            {header && <div className="mt-0.5 uppercase" style={{ fontFamily: MONO, fontSize: 11, color: C.mute, letterSpacing: "0.08em" }}>{header}</div>}
          </div>
          <button type="button" onClick={requestClose} disabled={busy} aria-label="Close" style={{ color: C.mute }} className="p-1 hover:opacity-60 disabled:opacity-40"><X size={18} /></button>
        </div>
        {/* a note that has to count what the dialog is about is a function */}
        {def.note && <div className="px-5 pt-4" style={{ fontSize: 13, color: C.mute, lineHeight: 1.5 }}>{typeof def.note === "function" ? def.note(subject || {}, ctx) : def.note}</div>}
        <div className="grid grid-cols-2 gap-x-4 gap-y-3 p-5">
          {fields.map((f) => <Field key={f.key} f={f} bad={clashKeys.includes(f.key)} value={vals[f.key] ?? ""} onChange={(v) => changeField(f.key, v)} />)}
        </div>
        {(dupe || err) && (
          <div className="mx-5 mb-3 flex items-start gap-2 px-3 py-2" style={{ background: STAGES.broken.tint, color: STAGES.broken.color, fontSize: 13, whiteSpace: "pre-line", lineHeight: 1.45 }}>
            <AlertCircle size={14} style={{ marginTop: 2, flexShrink: 0 }} />
            <span>{dupe || err}{dupe && clashKeys.length > 0 ? "\nEach of these belongs to one asset only. Change it, or open the existing record instead." : ""}</span>
          </div>
        )}
        <div className="flex items-center justify-end gap-2 px-5 py-4" style={{ borderTop: `1px solid ${C.ruleSoft}`, background: C.soft }}>
          {/* a dialog may offer one action of its own — the transfer form's
              print, so the paperwork can be run off while the form is open */}
          {def.aside && (
            <Btn small icon={def.aside.icon} onClick={() => def.aside.run(vals, subject, ctx)} disabled={busy}>{def.aside.label}</Btn>
          )}
          <span className="flex-1" />
          <Btn onClick={requestClose} disabled={busy}>Cancel</Btn><Btn kind="solid" onClick={go} disabled={!!dupe || busy}>{busy ? "Saving…" : def.submit}</Btn>
        </div>

        {askDiscard && <DiscardPrompt onKeep={() => setAskDiscard(false)} onDiscard={onCancel} />}
      </div>
      </div>
    </div>
  );
}

/* =========================================================================
   The asset form: Register asset, and Edit for an asset already on the
   register. One form for both, in four sections - Asset, Identification,
   Assignment, Acquisition - laid out as in the reference build.

   Identification follows the category: the identifiers a category carries
   are shown, and the ones it does not are hidden and cleared the moment the
   category changes, so nothing typed under the old one rides along unseen.

   Required fields say so under themselves, but only once a save has been
   tried; a form that turns red before anyone has typed is shouting. A
   duplicate identifier is different - it is said as it is typed, because
   finding out after filling in everything else is worse.
   ========================================================================= */
const ID_SHORT = { engine: "engine", plate: "plate", mvFile: "MV file", conduction: "conduction" };
/* identifiers compare without case or spaces: "ABC 1234" and "abc1234" are
   the same plate */
const idKey = (v) => String(v ?? "").replace(/\s+/g, "").toLowerCase();
const listWords = (words) => (words.length < 2 ? words.join("") : `${words.slice(0, -1).join(", ")} and ${words[words.length - 1]}`);
const identifierLine = (cat) => {
  if (!cat) return "Select a category to show its identification fields.";
  const words = [catKind(cat) === "other" ? "Serial number" : "Serial/chassis", ...vehicleKeys(cat).map((k) => ID_SHORT[k])];
  return `${listWords(words)} for this category`;
};
const ASSET_FORM_LABELS = {
  tag: "Asset number", code: "Asset code", company: "Company", name: "Asset name", category: "Category",
  brand: "Brand/Manufacturer", model: "Model", body: "Body number", serial: "Serial number",
  engine: "Engine number", plate: "Plate number", mvFile: "MV file number", conduction: "Conduction sticker",
  acquired: "Date acquired", cost: "Acquisition cost", notes: "Notes", photos: "Images", files: "Documents",
};
const ASSET_TEXT_KEYS = ["tag", "code", "company", "name", "category", "brand", "model", "body", "serial", "engine", "plate", "mvFile", "conduction",
  "project", "location", "custodian", "acquired", "cost", "notes"];

function AssetForm({ mode, asset, ctx, busy = false, serverError = "", onCancel, onSubmit }) {
  const editing = mode === "edit";
  const titleId = useId();
  const panel = useRef(null);
  const [opened] = useState(() => {
    const a = asset || {};
    return editing ? {
      ...Object.fromEntries(ASSET_TEXT_KEYS.map((k) => [k, a[k] ?? ""])),
      project: a.project && a.project !== NO_PROJECT ? a.project : NO_PROJECT,
      photos: imageEntries(a), files: docEntries(a),
    } : {
      ...Object.fromEntries(ASSET_TEXT_KEYS.map((k) => [k, ""])),
      tag: ctx.nextTag, acquired: today(), photos: [], files: [],
    };
  });
  const [vals, setVals] = useState(opened);
  const [tried, setTried] = useState(false);
  const [askDiscard, setAskDiscard] = useState(false);

  const cat = vals.category;
  /* with no categories set up there is nothing to choose, so the plain serial
     number is offered rather than no identifiers at all */
  const catChosen = !!cat || ctx.categoryNames.length === 0;
  const idKeys = catChosen ? ["serial", ...vehicleKeys(cat)] : [];
  const bodyShown = hasBodyNumber(cat);
  const site = ctx.projects.find((pr) => pr.pid === vals.project);

  const set = (key, value) => setVals((now) => {
    const next = { ...now, [key]: value };
    if (key === "category") {
      /* fields the new category does not carry are hidden, and cleared */
      const keep = new Set([...(value || ctx.categoryNames.length === 0 ? ["serial", ...vehicleKeys(value)] : []), ...(hasBodyNumber(value) ? ["body"] : [])]);
      ["serial", ...VEHICLE_ONLY, "body"].forEach((k) => { if (!keep.has(k)) next[k] = ""; });
    }
    /* a model belongs to its make */
    if (key === "brand" && value !== now.brand) next.model = "";
    /* a site brings its own address; X is typed by hand */
    if (key === "project") {
      const pr = ctx.projects.find((one) => one.pid === value);
      next.location = pr ? pr.location : value === NO_PROJECT && now.project !== NO_PROJECT ? "" : value ? now.location : "";
    }
    return next;
  });

  /* what has to be filled in, as the reference marks it */
  /* in an edit the assignment is read-only, so it is shown rather than asked for */
  const required = [
    "tag", "name", ...(editing ? [] : ["project", "location", "custodian"]),
    ...(ctx.companyNames.length ? ["company"] : []),
    ...(ctx.categoryNames.length ? ["category"] : []),
  ];
  const missing = new Set(required.filter((k) => !String(vals[k] ?? "").trim()));

  /* identifiers already on another asset, checked as they are typed */
  const checked = ["tag", "code", ...(bodyShown ? ["body"] : []), ...idKeys];
  const clashes = Object.fromEntries(checked.map((k) => {
    const owner = ctx.idOwners?.[k]?.[idKey(vals[k])];
    return [k, idKey(vals[k]) && owner && owner.id !== asset?.id ? owner : null];
  }).filter(([, owner]) => owner));
  const clashed = Object.keys(clashes).length > 0;

  /* documents and photographs carry rules of their own, kept from the form
     this replaces */
  const fileProblem = (() => {
    const untyped = (vals.files || []).find((row) => !docTypeValue(row));
    if (untyped) return `Choose a type for ${untyped.label || untyped.file?.name || "each document"}.`;
    const heavy = (vals.files || []).find((row) => row.file && row.file.size > DOC_LIMIT && !String(row.file.type || "").startsWith("image/"));
    if (heavy) return `${heavy.file.name} is ${kb(heavy.file.size)}. The limit is 10 MB per document.`;
    return "";
  })();

  const changedKeys = Object.keys(ASSET_FORM_LABELS).filter((k) => {
    if (k === "photos" || k === "files") return !sameRows(vals[k] || [], opened[k] || []) || (vals[k] || []).some((row) => row.file instanceof File);
    return String(vals[k] ?? "").trim() !== String(opened[k] ?? "").trim();
  });
  const dirty = changedKeys.length > 0 || ["project", "location", "custodian"].some((k) => String(vals[k] ?? "") !== String(opened[k] ?? ""));

  const requestClose = () => {
    if (busy) return;
    if (dirty) return setAskDiscard(true);
    onCancel();
  };
  useEscapeKey(!busy, requestClose);
  useEscapeKey(askDiscard, () => setAskDiscard(false));
  useDialogFocus(panel);

  const save = () => {
    setTried(true);
    if (clashed || missing.size || fileProblem) return;
    /* an edit that changes nothing has nothing to save */
    if (editing && !changedKeys.length) return onCancel();
    const out = { ...vals };
    ["serial", ...VEHICLE_ONLY].forEach((k) => { if (!idKeys.includes(k)) out[k] = ""; });
    if (!bodyShown) out.body = "";
    onSubmit(out, { changed: changedKeys.map((k) => (k === "serial" ? serialLabel(cat) : ASSET_FORM_LABELS[k]).toLowerCase()) });
  };

  const message = clashed ? "An identifier is already on another asset. Change it to save."
    : tried && missing.size ? "Complete the highlighted fields."
      : tried && fileProblem ? fileProblem
        : serverError;

  const errorOf = (key) => clashes[key]
    ? `Already on ${clashes[key].tag} (${clashes[key].name})`
    : tried && missing.has(key) ? "Required" : "";

  /* one field: its label, the control, then whichever of error or hint applies */
  const field = (key, label, control, { hint, full, mark = required.includes(key) } = {}) => {
    const error = errorOf(key);
    return (
      <div key={key} className="ams-field" data-full={full ? "1" : undefined}>
        <label htmlFor={`${titleId}-${key}`}>{label}{mark && <span className="ams-req"> *</span>}</label>
        {control(error)}
        {error ? <div className="ams-field-error">{error}</div> : hint ? <div className="ams-field-hint">{hint}</div> : null}
      </div>
    );
  };
  const text = (key, { mono, placeholder, type = "text", locked, list } = {}) => (error) => (
    <>
      <input id={`${titleId}-${key}`} type={type} className="ams-input" value={vals[key] ?? ""}
        readOnly={locked} data-locked={locked ? "1" : undefined} aria-invalid={error ? "true" : undefined}
        placeholder={placeholder} list={list && !locked ? `${titleId}-${key}-list` : undefined}
        style={mono ? { fontFamily: MONO } : undefined}
        onChange={(e) => set(key, e.target.value)} />
      {list && !locked && <datalist id={`${titleId}-${key}-list`}>{list.map((o) => <option key={o} value={o} />)}</datalist>}
    </>
  );
  const choose = (key, options, { locked, placeholder = "Select…" } = {}) => (error) => (
    <select id={`${titleId}-${key}`} className="ams-input" value={vals[key] ?? ""} disabled={locked}
      data-locked={locked ? "1" : undefined} aria-invalid={error ? "true" : undefined}
      onChange={(e) => set(key, e.target.value)}>
      <option value="">{placeholder}</option>
      {options.map((o) => (typeof o === "string"
        ? <option key={o} value={o}>{o}</option>
        : <option key={o.value} value={o.value}>{o.label}</option>))}
    </select>
  );

  const tagLocked = !editing && ctx.tagIsIssued;
  const assignLocked = editing;

  return (
    <div className="ams-scrim fixed inset-0 z-50 flex items-end sm:items-center justify-center sm:p-6">
      <div className="relative w-full" style={{ maxWidth: 860 }}>
        <div ref={panel} tabIndex={-1} role="dialog" aria-modal="true" aria-labelledby={titleId} className="ams-modal">
          <div className="ams-modal-head">
            <div id={titleId} className="ams-modal-title">{editing ? `Edit ${asset?.tag || "asset"}` : "Register asset"}</div>
            <button type="button" className="ams-icon-btn" onClick={requestClose} disabled={busy} aria-label="Close"><X size={18} /></button>
          </div>

          <div className="ams-modal-body">
            <section className="ams-form-section">
              <div className="ams-form-section-title">Asset</div>
              <div className="ams-form-grid">
                {field("tag", "Asset number", text("tag", { mono: true, locked: tagLocked }), {
                  hint: editing ? null : tagLocked ? "Next number in sequence, issued by the system when you save" : "Next number in sequence; change it if needed" })}
                {field("code", "Asset code (QR sticker)", text("code", { mono: true, placeholder: "Scan or type the sticker code" }))}
                {field("company", "Company", choose("company", ctx.companyNames), {
                  hint: ctx.companyNames.length ? null : "Add companies under Settings first" })}
                {field("name", "Asset name", text("name", { placeholder: "e.g. Dell Latitude 5440" }))}
                {field("category", "Category", choose("category", ctx.categoryNames), { hint: "Sets the identification fields below" })}
                {bodyShown && field("body", "Body number", text("body", { mono: true, placeholder: "BN-14" }))}
              </div>
            </section>

            <section className="ams-form-section">
              <div className="ams-form-section-title">Identification</div>
              <div className="ams-form-section-note">{ctx.categoryNames.length === 0 ? "Serial number, until categories are set up under Settings" : identifierLine(cat)}</div>
              <div className="ams-form-grid">
                {field("brand", "Brand/Manufacturer", choose("brand", withCurrent(ctx.brandNames, opened.brand)), {
                  hint: ctx.brandNames.length ? null : "No brands set up yet. Add them under Settings first." })}
                {field("model", "Model", choose("model", withCurrent(ctx.modelsOf(vals.brand), vals.brand === opened.brand ? opened.model : ""), { locked: !vals.brand }), {
                  hint: !vals.brand ? "Choose a brand first." : null })}
                {idKeys.map((k) => (k === "serial"
                  ? field("serial", serialLabel(cat), text("serial", { mono: true }))
                  : field(k, VEHICLE_FIELD_DEFS[k].label, text(k, { mono: true, placeholder: VEHICLE_FIELD_DEFS[k].placeholder }))))}
              </div>
            </section>

            <section className="ams-form-section">
              <div className="ams-form-section-title">Assignment</div>
              {assignLocked && <div className="ams-form-section-note">Change these through Transfer so the chain of custody stays complete</div>}
              <div className="ams-form-grid">
                {field("project", "Project/Location", choose("project", [
                  { value: NO_PROJECT, label: "X (not on a project site)" },
                  ...ctx.projects.map((pr) => pr.pid),
                ], { locked: assignLocked }))}
                {field("location", "Address", text("location", { locked: assignLocked || vals.project !== NO_PROJECT, list: ctx.locations,
                  placeholder: vals.project === NO_PROJECT ? "Type the address" : "" }), {
                  hint: assignLocked ? null : site ? `Filled in from ${site.pid}` : vals.project === NO_PROJECT ? "Not a project site, so the address is typed" : "Choose a Project/Location first" })}
                {field("custodian", "Responsible person", choose("custodian", peopleWith(ctx.people, opened.custodian), { locked: assignLocked }), {
                  hint: assignLocked ? null : ctx.people.length ? "Custodian at the time of registration" : "No one is configured yet. Add people under Settings first." })}
              </div>
            </section>

            <section className="ams-form-section">
              <div className="ams-form-section-title">Acquisition</div>
              <div className="ams-form-grid">
                {field("acquired", "Date acquired", text("acquired", { type: "date" }), {
                  hint: editing ? null : "Also dates the first entry in the transfer history" })}
                {field("cost", "Acquisition cost (₱)", text("cost", { type: "number" }), { hint: "Used as the asset value in reports" })}
                {field("notes", "Notes", () => (
                  <textarea id={`${titleId}-notes`} className="ams-input" rows={3} value={vals.notes ?? ""} onChange={(e) => set("notes", e.target.value)} />
                ), { full: true })}
                <div className="ams-field" data-full="1">
                  <label>Asset images</label>
                  <AssetImageRows f={{ accept: PHOTO_TYPES, empty: editing ? "This asset has no images yet." : "No image yet. The first one added becomes the default, and you can change which that is." }}
                    value={vals.photos} onChange={(v) => set("photos", v)} />
                  <div className="ams-field-hint">JPG, PNG, WEBP, GIF or HEIC, up to 10 MB each.</div>
                </div>
                <div className="ams-field" data-full="1">
                  <label>Documents</label>
                  <AttachmentRows f={{ accept: DOC_ACCEPT, onOpen: ctx.openFile,
                    empty: editing ? "No documents are filed against this asset yet." : "Nothing attached yet. The sales invoice, certificate of registration or deed of sale can go on now, or be added later." }}
                    value={vals.files} onChange={(v) => set("files", v)} />
                  <div className="ams-field-hint">PDF, JPG or PNG, up to 10 MB each. Give each one a type.</div>
                </div>
              </div>
            </section>
          </div>

          <div className="ams-modal-foot">
            <div className="ams-form-msg" role={message ? "alert" : undefined}>{message}</div>
            <div className="ams-modal-actions">
              <Btn onClick={requestClose} disabled={busy}>Cancel</Btn>
              <Btn kind="solid" onClick={save} disabled={clashed || busy}>{busy ? "Saving…" : editing ? "Save changes" : "Register asset"}</Btn>
            </div>
          </div>

          {askDiscard && <DiscardPrompt onKeep={() => setAskDiscard(false)} onDiscard={onCancel} />}
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

/* -------------------------- application chrome ---------------------- */
/* The look follows the reference build's ui-base: the Huemint dark palette,
   Poppins, an 88px icon rail that becomes a bottom bar on a phone, record
   numbers on light plates, and dialogs that animate open. Only the look is
   shared - every workflow behind it is this register's own. */

const CHROME_CSS = `
.ams-shell{--rail:88px;min-height:100vh;background:var(--ams-bg);color:${C.ink};font-family:${SANS};font-size:13.5px;font-variant-numeric:tabular-nums}
.ams-main{min-width:0;min-height:100vh;margin-left:var(--rail);background:var(--ams-bg)}

/* ------------------------------------------------------------------------
   The rail: 88px, every module an icon over its label.

   The open module is marked twice, so it never rests on colour alone - a red
   bar down its left edge and its icon in sand. Red is a stripe here and
   nowhere a text colour. Counts ride on the icon's corner, the way a badge
   does, so the label underneath keeps the full width of the rail.
   ------------------------------------------------------------------------ */
.ams-sidebar{position:fixed;inset:0 auto 0 0;z-index:50;display:flex;width:var(--rail);flex-direction:column;overflow-x:hidden;overflow-y:auto;
  background:var(--ams-rail);border-right:1px solid var(--ams-line-soft);color:${C.ink};scrollbar-width:none}
.ams-sidebar::-webkit-scrollbar{display:none}
.ams-side-head{display:flex;flex-shrink:0;align-items:center;justify-content:center;min-height:64px;padding:10px 0;border-bottom:1px solid var(--ams-line-soft)}
/* The brand art is the full lockup, ams-brand.png: the hexagon badge, then
   "AMS" and "ASSET MANAGEMENT SYSTEM". The box in front of it is a window
   onto the badge alone - the art's first 240 of 1119 columns - which is all
   an 88px rail has room for. */
.ams-brand{--brand-h:40px;position:relative;flex:0 0 auto;width:calc(var(--brand-h) * 240 / 274);height:var(--brand-h);overflow:hidden}
.ams-brand-art{position:absolute;left:0;top:0;width:calc(var(--brand-h) * 1119 / 274);height:100%}
.ams-brand-art img{display:block;width:100%;height:100%}
/* Glass glaze, as on the sign-in page: a soft diagonal highlight slides across
   the badge, masked by the art's own alpha so it rides the mark rather than
   lighting a rectangle round it. */
.ams-brand-glaze{position:absolute;inset:0;overflow:hidden;pointer-events:none;mix-blend-mode:screen;
  -webkit-mask:url(/ams-brand.png) 0 0/100% 100% no-repeat;mask:url(/ams-brand.png) 0 0/100% 100% no-repeat}
.ams-brand-glaze:before{content:"";position:absolute;top:-40%;bottom:-40%;left:0;width:26%;
  background:linear-gradient(90deg,rgba(255,255,255,0) 0%,rgba(255,255,255,.3) 36%,rgba(255,255,255,.85) 50%,rgba(255,255,255,.3) 64%,rgba(255,255,255,0) 100%);
  filter:blur(3px);transform:translateX(-130%) skewX(-18deg);animation:ams-glaze 5.5s linear infinite}
@keyframes ams-glaze{0%{transform:translateX(-130%) skewX(-18deg)}34%,100%{transform:translateX(430%) skewX(-18deg)}}
.ams-nav{display:flex;flex-direction:column;gap:2px;padding:8px 0}
.ams-side-rule{flex-shrink:0;height:1px;margin:4px 20px;background:var(--ams-line)}
.ams-nav-item{position:relative;display:flex;width:100%;min-height:62px;flex-direction:column;align-items:center;justify-content:center;gap:6px;padding:8px 5px;
  border:0;background:transparent;color:var(--ams-mute);font-family:${SANS};font-size:10.5px;font-weight:500;line-height:1.2;text-align:center;cursor:pointer;
  transition:background 170ms ease,color 170ms ease}
.ams-nav-item:before{position:absolute;top:10px;bottom:10px;left:0;width:3px;border-radius:0 3px 3px 0;background:var(--ams-red);content:"";
  transform:scaleY(0);transition:transform 220ms cubic-bezier(.2,.8,.25,1)}
.ams-nav-item:hover{background:rgba(239,243,233,.05);color:var(--ams-text)}
.ams-nav-item[aria-current="page"]{background:rgba(215,189,137,.08);color:var(--ams-head);font-weight:600}
.ams-nav-item[aria-current="page"]:before{transform:scaleY(1)}
.ams-nav-icon{position:relative;display:grid;place-items:center}
.ams-nav-icon svg{transition:transform 170ms ease,color 170ms ease}
.ams-nav-item:hover .ams-nav-icon svg{transform:translateY(-1px)}
.ams-nav-item[aria-current="page"] .ams-nav-icon svg{color:var(--ams-sand)}
.ams-nav-label{display:block;max-width:100%;overflow-wrap:anywhere}
.ams-nav-count{position:absolute;top:-7px;left:calc(100% - 5px);display:inline-flex;min-width:18px;height:16px;align-items:center;justify-content:center;padding:0 5px;
  border:1px solid var(--ams-line);border-radius:999px;background:var(--ams-surface-2);color:var(--ams-text);font-family:${SANS};font-size:9.5px;font-weight:600;line-height:1;font-variant-numeric:tabular-nums}
.ams-nav-count[data-active="1"]{border-color:var(--ams-sand);background:var(--ams-sand);color:var(--ams-on-sand)}
.ams-nav-count[data-quiet="1"]:not([data-active]){color:${C.dim}}
.ams-side-spacer{min-height:12px;flex:1}

/* ------------------------------------------------------------------------
   The top bar: the open module's name and whether the last change reached
   the database, then the controls, then who is signed in.
   ------------------------------------------------------------------------ */
.ams-topbar{position:sticky;top:0;z-index:30;display:flex;min-height:60px;align-items:center;justify-content:space-between;gap:16px;padding:10px 26px;
  border-bottom:1px solid var(--ams-line-soft);background:var(--ams-bg)}
.ams-top-start{display:flex;min-width:0;align-items:center;gap:12px;overflow:hidden}
.ams-top-mark{display:none;--brand-h:30px}
.ams-page-title{overflow:hidden;margin:0;color:var(--ams-head);font-family:${SANS};font-size:18px;font-weight:600;line-height:1.2;letter-spacing:-.01em;text-overflow:ellipsis;white-space:nowrap}
.ams-save{display:inline-flex;flex-shrink:0;align-items:center;gap:7px;min-height:26px;padding:0 10px;border:1px solid var(--ams-line-soft);border-radius:999px;
  background:var(--ams-surface);color:var(--ams-mute);font-size:11.5px;font-weight:500;white-space:nowrap}
.ams-save-dot{width:7px;height:7px;flex-shrink:0;border-radius:50%;background:var(--ams-ok)}
.ams-save[data-state="busy"] .ams-save-dot{background:var(--ams-warn);animation:ams-blink 1s ease-in-out infinite}
.ams-save[data-state="error"]{border-color:var(--ams-alarm);color:var(--ams-alarm)}
.ams-save[data-state="error"] .ams-save-dot{background:var(--ams-alarm)}
@keyframes ams-blink{50%{opacity:.35}}
.ams-top-actions{display:flex;align-items:center;justify-content:flex-end;gap:9px}
/* The company whose mark the workspace wears, ahead of everything else in the
   bar - which puts it beside the filter on the register and beside the refresh
   control everywhere else, without either view knowing about it. */
.ams-top-brand{
  height:34px;width:auto;max-width:140px;flex-shrink:0;object-fit:contain;
  padding:4px 7px;border-radius:8px;background:#fff;border:1px solid var(--ams-line);
}
.ams-topbar .ams-top-select{
  min-width:0;max-width:190px;min-height:36px;padding:0 9px;border:1px solid var(--ams-line);border-radius:9px;
  background:var(--ams-surface);color:var(--ams-text);color-scheme:dark;font-family:${SANS};font-size:12.5px;font-weight:500;
  line-height:1;cursor:pointer;transition:border-color 180ms ease,color 180ms ease;
}
.ams-topbar .ams-top-select:hover{border-color:var(--ams-sand-deep)}
.ams-topbar .ams-top-select:focus-visible{outline:2px solid var(--ams-sand);outline-offset:2px}
.ams-topbar .ams-top-select[data-set="1"]{border-color:var(--ams-sand);color:var(--ams-head)}
.ams-ctl{display:inline-flex;min-height:36px;align-items:center;gap:7px;padding:0 12px;border:1px solid var(--ams-line);border-radius:9px;background:var(--ams-surface);color:var(--ams-text);
  font-family:${SANS};font-size:12.5px;font-weight:500;line-height:1;white-space:nowrap;cursor:pointer;
  transition:background 180ms ease,border-color 180ms ease,color 180ms ease,transform 180ms ease,box-shadow 180ms ease}
.ams-ctl:hover:not(:disabled){border-color:var(--ams-sand-deep);background:var(--ams-surface-2)}
.ams-ctl:disabled{opacity:.4;cursor:not-allowed}
.ams-ctl[data-open="1"]{border-color:var(--ams-sand)}
.ams-ctl[data-icon="1"]{padding:0 10px}
.ams-ctl[data-primary="1"]{border-color:var(--ams-sand);background:var(--ams-sand);color:var(--ams-on-sand);font-weight:600}
.ams-ctl[data-primary="1"]:hover:not(:disabled){border-color:var(--ams-sand-hi);background:var(--ams-sand-hi);transform:translateY(-1px);box-shadow:0 6px 16px rgba(0,0,0,.28)}
.ams-ctl[data-primary="1"]:active:not(:disabled){transform:none;box-shadow:none}
/* who is signed in, and the way out */
.ams-who{display:flex;min-width:0;align-items:center;gap:9px;margin-left:3px;padding-left:12px;border-left:1px solid var(--ams-line-soft)}
.ams-avatar{display:grid;width:32px;height:32px;flex-shrink:0;place-items:center;border-radius:50%;background:var(--ams-sand)}
/* every user gets the same default profile figure; the art is a black
   silhouette, so it masks the dark ink on the sand disc */
.ams-avatar-icon{display:block;width:19px;height:19px;background:var(--ams-on-sand);-webkit-mask:url("/icon/Default%20Prof.png") center/contain no-repeat;mask:url("/icon/Default%20Prof.png") center/contain no-repeat}
.ams-who-text{display:flex;min-width:0;flex-direction:column;line-height:1.25}
.ams-who-name{overflow:hidden;max-width:170px;color:var(--ams-head);font-size:12.5px;font-weight:600;text-overflow:ellipsis;white-space:nowrap}
.ams-who-role{display:flex;align-items:center;gap:5px;overflow:hidden;max-width:170px;color:var(--ams-dim);font-size:11px;text-overflow:ellipsis;white-space:nowrap}
.ams-access-icon{display:block;width:15px;height:15px;flex-shrink:0;object-fit:contain}
.ams-access-icon--normal{background:currentColor;-webkit-mask:url("/icon/Normal%20Access.png") center/contain no-repeat;mask:url("/icon/Normal%20Access.png") center/contain no-repeat}
.ams-signout{display:grid;width:34px;height:34px;flex-shrink:0;place-items:center;border:1px solid var(--ams-line);border-radius:9px;background:var(--ams-surface);color:var(--ams-mute);cursor:pointer;
  transition:background 170ms ease,border-color 170ms ease,color 170ms ease}
.ams-signout-icon{display:block;width:16px;height:16px;background:currentColor;-webkit-mask:url("/icon/logout.png") center/contain no-repeat;mask:url("/icon/logout.png") center/contain no-repeat}
.ams-signout:hover{border-color:var(--ams-red);background:var(--ams-red);color:#fff}
.ams-content{width:min(100%,1500px);margin:0 auto;padding:18px 26px 44px;font-family:${SANS};font-size:13.5px;line-height:1.5}
.ams-label{margin:0 0 6px;color:${C.dim};font-family:${SANS};font-size:10.5px;font-weight:600;letter-spacing:.08em;line-height:1.2;text-transform:uppercase}
.ams-section-title{color:var(--ams-head);font-family:${DISPLAY};font-size:15.5px;font-weight:600;letter-spacing:-.01em;line-height:1.3}
.ams-shell input,.ams-shell select,.ams-shell textarea{background:var(--ams-well);color:${C.ink};transition:border-color 180ms ease,box-shadow 180ms ease}
.ams-shell input:focus,.ams-shell select:focus,.ams-shell textarea:focus{border-color:var(--ams-sand)!important;box-shadow:0 0 0 3px rgba(215,189,137,.28)}
.ams-pop{z-index:60;padding:5px 0;border:1px solid var(--ams-line);border-radius:9px;background:var(--ams-surface-2);box-shadow:0 18px 55px rgba(0,0,0,.65);animation:ams-pop 140ms ease-out}
@keyframes ams-pop{from{opacity:0;transform:translateY(-4px)}to{opacity:1;transform:none}}
.ams-cart-tick{color:var(--ams-ok);animation:ams-tick-pop 340ms cubic-bezier(.22,1.35,.4,1)}
.ams-strip{scrollbar-width:thin;scrollbar-color:var(--ams-line) transparent}
.ams-strip::-webkit-scrollbar{height:8px}
.ams-strip::-webkit-scrollbar-track{background:transparent}
.ams-strip::-webkit-scrollbar-thumb{background:var(--ams-line);border-radius:20px}
@keyframes ams-tick-pop{0%{opacity:.15;transform:scale(.45)}60%{opacity:1;transform:scale(1.22)}100%{opacity:1;transform:scale(1)}}
.ams-item{display:flex;width:100%;align-items:flex-start;gap:10px;padding:9px 12px;border:0;background:transparent;color:${C.ink};font-family:${SANS};font-size:13.5px;text-align:left;cursor:pointer}
.ams-item:hover:not(:disabled){background:var(--ams-surface);color:var(--ams-head)}
.ams-item:disabled{opacity:.4;cursor:not-allowed}
.ams-shell button:focus-visible{outline:2px solid var(--ams-sand);outline-offset:2px}
.ams-spin{animation:ams-rot .9s linear infinite}
@keyframes ams-rot{to{transform:rotate(360deg)}}
/* KPI tiles: compact, and cut like the sign-in card - the top-left and
   bottom-right corners sheared off on the diagonal, the AMS mark's slant.
   One row carries the icon, the label over the figure, and the tag; the
   context, the bar and the legend run underneath in thin lines.

   A CSS border cannot follow a clip-path's diagonal, so the tile's own
   background is the 1px frame and ::before is the face laid 1px inside it,
   cut to the same shape, with the tile's colour strip down its left edge.
   Hover warms the frame toward the tile's colour; selected takes it fully. */
.ams-stat{--cut:15px;--frame:var(--ams-line);position:relative;display:grid;grid-template-columns:auto minmax(0,1fr) auto;
  grid-template-areas:"icon main tag" "c c c" "trend trend trend" "legend legend legend";align-items:center;column-gap:12px;
  width:100%;padding:13px 16px 12px 17px;text-align:left;border:0;background:var(--frame);cursor:pointer;isolation:isolate;
  clip-path:polygon(var(--cut) 0,100% 0,100% calc(100% - var(--cut)),calc(100% - var(--cut)) 100%,0 100%,0 var(--cut));
  transition:transform 180ms ease}
.ams-stat:before{--in:calc(var(--cut) - .5px);position:absolute;inset:1px;z-index:-2;content:"";
  clip-path:polygon(var(--in) 0,100% 0,100% calc(100% - var(--in)),calc(100% - var(--in)) 100%,0 100%,0 var(--in));
  background:linear-gradient(90deg,var(--c) 0 3px,transparent 3px),var(--ams-surface)}
.ams-stat>*{position:relative}
.ams-stat:hover{--frame:color-mix(in srgb,var(--c) 55%,var(--ams-line));transform:translateY(-2px)}
.ams-stat[aria-pressed="true"]{--frame:var(--c)}
.ams-stat-icon{grid-area:icon;display:grid;width:42px;height:42px;place-items:center;border-radius:10px;background:var(--tint);color:var(--c);transition:transform 180ms ease}
.ams-stat-main{grid-area:main;display:flex;min-width:0;flex-direction:column;gap:5px}
.ams-stat:hover .ams-stat-icon{transform:scale(1.05)}
/* The tile icons are image files. The silhouettes (Asset DB, Active, the
   Viewing eye) mask the tile's own colour, so each keeps its tone the way the
   line icons did; Repair is full-colour art and is shown as it is. */
.ams-stat-glyph{display:block;width:22px;height:22px;background:currentColor;-webkit-mask:var(--glyph) center/contain no-repeat;mask:var(--glyph) center/contain no-repeat}
.ams-stat-art{display:block;width:27px;height:27px;object-fit:contain}
.ams-stat-view{display:block;width:14px;height:14px;background:currentColor;-webkit-mask:url("/icon/Viewing.svg") center/contain no-repeat;mask:url("/icon/Viewing.svg") center/contain no-repeat}
.ams-stat-label{display:block;min-width:0;overflow:hidden;color:${C.dim};font-size:11.5px;font-weight:700;letter-spacing:.08em;line-height:1.2;text-overflow:ellipsis;text-transform:uppercase;white-space:nowrap}
.ams-stat-tag{grid-area:tag;align-self:start;display:inline-flex;align-items:center;gap:5px;min-height:24px;padding:0 9px;border-radius:4px;background:var(--tint);color:var(--c);font-family:${DISPLAY};font-size:11px;font-weight:700;font-variant-numeric:tabular-nums;white-space:nowrap}
.ams-stat-tag[data-state="1"]{font-size:10px;letter-spacing:.06em;text-transform:uppercase}
.ams-stat-v{display:block;margin:0;color:var(--ams-head);font-family:${DISPLAY};font-size:28px;font-weight:700;letter-spacing:-.05em;line-height:1;font-variant-numeric:tabular-nums}
.ams-stat-c{grid-area:c;display:flex;align-items:baseline;gap:10px;min-width:0;margin-top:10px;color:${C.mute};font-size:11px;line-height:1.35}
.ams-stat-ctx{min-width:0;flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.ams-stat-delta{flex:0 0 auto;font-weight:700;white-space:nowrap;color:${C.mute}}
.ams-stat-delta[data-mood="good"]{color:${C.ok}}
.ams-stat-delta[data-mood="bad"]{color:${STAGES.broken.color}}
/* the trend strip: 2px line in the tile's colour over a faint fill, today's
   point as an 8px dot ringed in the surface, a hairline and readout on hover */
.ams-trend{grid-area:trend;position:relative;height:40px;margin-top:8px;touch-action:pan-y;cursor:crosshair}
.ams-trend svg{position:absolute;inset:0;width:100%;height:100%;overflow:visible}
.ams-trend-line{fill:none;stroke:var(--c);stroke-width:2;stroke-linecap:round;stroke-linejoin:round;vector-effect:non-scaling-stroke}
.ams-trend-area{fill:var(--c);opacity:.1}
.ams-trend-dot{position:absolute;width:8px;height:8px;margin:-4px 0 0 -4px;border-radius:50%;background:var(--c);box-shadow:0 0 0 2px var(--ams-surface);pointer-events:none}
.ams-trend-cross{position:absolute;top:-2px;bottom:-2px;width:1px;margin-left:-.5px;background:${C.mute};opacity:.55;pointer-events:none}
.ams-trend-tip{position:absolute;bottom:calc(100% + 6px);z-index:2;transform:translateX(-50%);padding:4px 8px;border-radius:6px;background:#111418;color:#fff;font-size:11px;font-weight:600;line-height:1.3;white-space:nowrap;pointer-events:none;box-shadow:0 6px 16px rgba(0,0,0,.28)}
.ams-trend-tip[data-edge="start"]{transform:none}
.ams-trend-tip[data-edge="end"]{transform:translateX(-100%)}
.ams-trend-tip b{font-weight:800}
.ams-legend{grid-area:legend;display:flex;flex-wrap:wrap;gap:4px 13px;min-height:15px;margin-top:8px}
.ams-legend-item{display:inline-flex;align-items:center;gap:6px;color:${C.mute};font-size:10.5px;font-weight:600;line-height:1.35}
.ams-legend-dot{width:7px;height:7px;flex:0 0 auto;border-radius:2px;background:var(--d)}
.ams-legend-n{color:var(--ams-head);font-family:${DISPLAY};font-size:11px;font-weight:700;font-variant-numeric:tabular-nums}
.ams-metric{position:relative;min-height:116px;padding:16px 17px;border:1px solid var(--ams-line);border-radius:10px;background:var(--ams-surface);overflow:hidden}
.ams-metric:before{position:absolute;inset:0 auto 0 0;width:3px;background:var(--tone);content:""}
.ams-metric-v{margin-top:7px;color:var(--ams-head);font-family:${DISPLAY};font-size:26px;font-weight:700;letter-spacing:-.04em;line-height:1.08;font-variant-numeric:tabular-nums}
.ams-metric-hint{margin-top:7px;color:${C.mute};font-size:11.5px;line-height:1.35}
.ams-table-frame{overflow:hidden;border:1px solid var(--ams-line)!important;border-radius:10px;background:var(--ams-surface)}
.ams-table-frame.overflow-x-auto{overflow-x:auto}
.ams-table{width:100%;border-collapse:collapse;font-family:${SANS};font-size:13px;font-variant-numeric:tabular-nums}
.ams-table thead tr{background:var(--ams-surface-2)!important}
.ams-table th{padding:11px 12px!important;border-bottom:1px solid var(--ams-line)!important;color:${C.dim}!important;font-family:${SANS}!important;font-size:11px!important;font-weight:800!important;letter-spacing:.075em!important;line-height:1.25;text-transform:uppercase}
.ams-table td{padding:11px 12px!important;border-bottom:1px solid var(--ams-line-soft);line-height:1.4}
.ams-table tbody tr{transition:background 160ms ease}
.ams-table tbody tr:hover{background:var(--ams-surface-2)!important}
.ams-table tbody tr:last-child td{border-bottom:0}
.ams-data-head{padding:11px 13px!important;border-bottom:1px solid var(--ams-line)!important;background:var(--ams-surface-2)!important}
.ams-data-head>div{color:${C.dim}!important;font-family:${SANS}!important;font-size:11px!important;font-weight:800;letter-spacing:.075em!important}
.ams-list-row{transition:background 160ms ease,border-color 160ms ease}
.ams-list-row:hover{background:var(--ams-surface-2)!important}
/* ------------------------------------------------------------------------
   Buttons. Sand is the primary action and nothing else; the ghost button
   is a card-coloured control that warms toward sand on hover.
   ------------------------------------------------------------------------ */
.ams-btn{display:inline-flex;min-height:40px;align-items:center;gap:8px;padding:0 13px;border:1px solid var(--ams-line);border-radius:10px;background:var(--ams-surface);color:var(--ams-text);
  font-family:${SANS};font-size:13px;font-weight:500;white-space:nowrap;cursor:pointer;
  transition:background 160ms ease,border-color 160ms ease,color 160ms ease,transform 160ms ease,box-shadow 160ms ease}
.ams-btn[data-small="1"]{min-height:34px;padding:0 10px;font-size:12.5px}
.ams-btn:hover:not(:disabled){border-color:var(--ams-sand-deep);background:var(--ams-surface-2)}
.ams-btn[data-kind="solid"]{border-color:var(--ams-sand);background:var(--ams-sand);color:var(--ams-on-sand);font-weight:600}
.ams-btn[data-kind="solid"]:hover:not(:disabled){border-color:var(--ams-sand-hi);background:var(--ams-sand-hi);transform:translateY(-1px);box-shadow:0 6px 16px rgba(0,0,0,.28)}
.ams-btn[data-kind="solid"]:active:not(:disabled){transform:none;box-shadow:none}
.ams-btn[data-kind="danger"]{color:var(--ams-alarm)}
.ams-btn[data-kind="danger"]:hover:not(:disabled){border-color:var(--ams-alarm);background:var(--ams-alarm-tint)}
.ams-btn:disabled{opacity:.4;cursor:not-allowed}

/* ------------------------------------------------------------------------
   Dialogs open with a short animation: the backdrop fades in and the panel
   rises into place, so a click visibly produces the window it asked for.
   Every dialog in the product shares the one backdrop class, so they all
   move alike, and Escape still closes only the top-most one.
   ------------------------------------------------------------------------ */
.ams-scrim{background:rgba(22,26,25,.66);-webkit-backdrop-filter:blur(3px);backdrop-filter:blur(3px);animation:ams-fade 200ms ease-out both}
.ams-scrim>*{animation:ams-rise 280ms cubic-bezier(.2,.8,.25,1) both}
/* Rounded panels. One that does not scroll as a whole clips its own header
   and footer to the corners; one that does is already clipped by scrolling. */
.ams-scrim [role="dialog"],.ams-scrim [role="alertdialog"]{border-radius:14px!important;box-shadow:0 24px 70px rgba(0,0,0,.5)}
.ams-scrim [role="dialog"]:not(.overflow-y-auto):not(.overflow-auto){overflow:hidden}
@media (max-width:639px){.ams-scrim.items-end>*>[role="dialog"],.ams-scrim.items-end>[role="dialog"]{border-bottom-left-radius:0!important;border-bottom-right-radius:0!important}}
@keyframes ams-fade{from{opacity:0}to{opacity:1}}
@keyframes ams-rise{from{opacity:0;transform:translateY(16px) scale(.97)}to{opacity:1;transform:none}}
/* a record opened beside the list slides in from the right, as a drawer does */
.ams-slide-in{animation:ams-slide 300ms cubic-bezier(.2,.8,.25,1) both}
@keyframes ams-slide{from{opacity:0;transform:translateX(26px)}to{opacity:1;transform:none}}

/* Record numbers on a light plate with a red left stripe. */
.ams-tag{display:inline-flex;flex-shrink:0;max-width:100%;align-items:center;padding:0 7px;border-left:4px solid var(--ams-red);border-radius:3px;
  background:var(--ams-plate);color:var(--ams-on-plate);font-size:12px;font-weight:600;font-variant-numeric:tabular-nums;letter-spacing:.03em;line-height:21px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.ams-tag[data-big="1"]{padding:4px 12px 4px 10px;border-left-width:5px;border-radius:6px;font-size:22px;letter-spacing:.05em;line-height:1.2}

/* ------------------------------------------------------------------------
   The asset form (.ams-modal, .ams-form-*) and the asset record drawer
   (.ams-drawer, .ams-sticker, .ams-tabs, .ams-dl, .ams-log), after the
   reference build's ui-base.
   ------------------------------------------------------------------------ */
.ams-icon-btn{display:grid;width:32px;height:32px;flex-shrink:0;place-items:center;border:0;border-radius:8px;background:transparent;color:var(--ams-mute);cursor:pointer;transition:background 160ms ease,color 160ms ease}
.ams-icon-btn:hover:not(:disabled){background:var(--ams-surface-2);color:var(--ams-head)}
.ams-icon-btn:disabled{opacity:.4;cursor:not-allowed}

.ams-modal{display:flex;width:100%;max-height:92vh;flex-direction:column;border:1px solid var(--ams-line);border-radius:14px;background:var(--ams-surface);outline:none}
.ams-modal-head{display:flex;flex-shrink:0;align-items:center;justify-content:space-between;gap:12px;padding:16px 22px;border-bottom:1px solid var(--ams-line-soft)}
.ams-modal-title{color:var(--ams-head);font-size:17px;font-weight:600}
.ams-modal-body{flex:1;min-height:0;overflow-y:auto;overscroll-behavior:contain;padding:0 22px 22px}
.ams-modal-foot{display:flex;flex-shrink:0;flex-wrap:wrap;align-items:center;gap:10px;padding:14px 22px;border-top:1px solid var(--ams-line-soft);background:var(--ams-surface-2)}
/* each section opens with a sand heading under a thin rule */
.ams-form-section{margin-top:20px;padding-top:16px;border-top:1px solid var(--ams-line)}
.ams-form-section:first-child{margin-top:0;padding-top:18px;border-top:0}
.ams-form-section-title{color:var(--ams-sand);font-size:12px;font-weight:600;letter-spacing:.08em;text-transform:uppercase}
.ams-form-section-note{margin-top:3px;color:var(--ams-mute);font-size:12.5px;line-height:1.45}
.ams-form-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:14px 18px;margin-top:12px}
.ams-field{min-width:0}
.ams-field[data-full="1"]{grid-column:1/-1}
.ams-field>label{display:block;margin-bottom:6px;color:var(--ams-dim);font-size:11px;font-weight:600;letter-spacing:.06em;text-transform:uppercase}
.ams-req{color:var(--ams-alarm)}
.ams-input{display:block;width:100%;min-height:42px;padding:9px 11px;border:1px solid var(--ams-line);border-radius:10px;background:var(--ams-well);color:var(--ams-text);font-family:${SANS};font-size:13.5px;outline:none}
textarea.ams-input{resize:vertical;line-height:1.5}
/* read-only: a dashed outline and no fill, so it reads as given rather than asked */
.ams-input[data-locked="1"]{border-style:dashed;background:transparent;color:var(--ams-mute);cursor:not-allowed;opacity:1}
.ams-input[aria-invalid="true"]{border-color:var(--ams-alarm);background:var(--ams-alarm-tint)}
.ams-field-hint{margin-top:5px;color:var(--ams-mute);font-size:11.5px;line-height:1.4}
.ams-field-error{margin-top:5px;color:var(--ams-alarm);font-size:11.5px;font-weight:500;line-height:1.4}
.ams-form-msg{flex:1 1 200px;color:var(--ams-alarm);font-size:12.5px;font-weight:500;line-height:1.4}
.ams-form-msg:empty{display:none}
.ams-modal-actions{display:flex;gap:10px;margin-left:auto}

/* the drawer: a fixed header in the panel colour over a body in the page colour */
.ams-drawer-scrim{position:fixed;inset:0;z-index:50;background:rgba(22,26,25,.62);-webkit-backdrop-filter:blur(2px);backdrop-filter:blur(2px);animation:ams-fade 200ms ease-out both}
.ams-drawer{position:fixed;top:0;right:0;bottom:0;z-index:50;display:flex;width:min(900px,100vw);flex-direction:column;border-left:1px solid var(--ams-line);
  background:var(--ams-bg);box-shadow:-24px 0 60px rgba(0,0,0,.45);outline:none;animation:ams-drawer-in 320ms cubic-bezier(.2,.8,.25,1) both}
@keyframes ams-drawer-in{from{transform:translateX(100%)}to{transform:none}}
.ams-drawer-head{flex-shrink:0;padding:12px 24px 0;border-bottom:1px solid var(--ams-line);background:var(--ams-surface)}
.ams-drawer-top{display:flex;align-items:center;justify-content:space-between;color:var(--ams-dim);font-size:12px;font-weight:500}
.ams-sticker{display:flex;margin-top:8px;overflow:hidden;border-left:10px solid var(--ams-red);border-radius:10px;background:var(--ams-plate);color:var(--ams-on-plate);box-shadow:0 8px 22px rgba(0,0,0,.28)}
.ams-sticker-main{flex:1;min-width:0;padding:14px 18px 15px}
.ams-sticker-row{display:flex;flex-wrap:wrap;align-items:center;gap:8px 12px}
.ams-sticker-no{font-family:${MONO};font-size:26px;font-weight:700;letter-spacing:.1em;line-height:1.1}
.ams-sticker-status{display:inline-flex;align-items:center;padding:4px 10px;border-radius:999px;background:var(--c);color:#1b201f;font-size:10.5px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;white-space:nowrap}
.ams-sticker-name{margin-top:6px;font-size:16px;font-weight:600;line-height:1.3;overflow-wrap:anywhere}
.ams-sticker-meta{margin-top:2px;color:#5b6462;font-size:12.5px}
.ams-sticker-qr{display:flex;width:132px;flex-shrink:0;flex-direction:column;align-items:center;justify-content:center;gap:6px;padding:12px;border-left:1px dashed rgba(45,51,50,.4);
  color:#5b6462;font-size:11px;font-weight:600;text-align:center;overflow-wrap:anywhere}
.ams-sticker-qr img{display:block;border-radius:3px;background:#fff}
.ams-drawer-actions{display:flex;flex-wrap:wrap;align-items:center;gap:8px;margin-top:14px}
.ams-link-danger{display:inline-flex;align-items:center;gap:6px;margin-left:auto;padding:6px 2px;border:0;background:transparent;color:var(--ams-alarm);font-size:12.5px;font-weight:600;cursor:pointer}
.ams-link-danger:hover{text-decoration:underline}
.ams-tabs{display:flex;gap:2px;margin-top:12px;overflow-x:auto;scrollbar-width:none}
.ams-tabs::-webkit-scrollbar{display:none}
.ams-tab{position:relative;display:inline-flex;align-items:center;gap:7px;padding:10px 12px 12px;border:0;background:transparent;color:var(--ams-mute);font-size:13px;font-weight:500;white-space:nowrap;cursor:pointer;transition:color 160ms ease}
.ams-tab:hover{color:var(--ams-text)}
.ams-tab:after{position:absolute;right:10px;bottom:0;left:10px;height:3px;border-radius:3px 3px 0 0;background:var(--ams-sand);content:"";transform:scaleX(0);transition:transform 200ms ease}
.ams-tab[aria-selected="true"]{color:var(--ams-head);font-weight:600}
.ams-tab[aria-selected="true"]:after{transform:scaleX(1)}
.ams-tab-n{min-width:20px;padding:1px 6px;border-radius:999px;background:var(--ams-surface-2);color:var(--ams-mute);font-size:10.5px;font-weight:600;text-align:center}
.ams-tab[aria-selected="true"] .ams-tab-n{background:var(--ams-sand-tint);color:var(--ams-sand)}
.ams-drawer-body{flex:1;min-height:0;overflow-y:auto;overscroll-behavior:contain;padding:18px 24px 32px}
.ams-drawer-card{margin-bottom:14px;overflow:hidden;border:1px solid var(--ams-line-soft);border-radius:10px;background:var(--ams-surface)}
/* details: small headings over two columns, 1px lines between the facts */
.ams-dl-group+.ams-dl-group{margin-top:18px}
.ams-dl-head{margin-bottom:8px;color:var(--ams-sand-ink);font-size:11px;font-weight:600;letter-spacing:.08em;text-transform:uppercase}
.ams-dl{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:1px;overflow:hidden;border:1px solid var(--ams-line-soft);border-radius:10px;background:var(--ams-line-soft)}
.ams-dl-cell{min-width:0;padding:11px 16px 12px;background:var(--ams-surface)}
.ams-dl-cell[data-span="1"]{grid-column:1/-1}
.ams-dl-label{margin-bottom:4px;color:var(--ams-dim);font-size:10.5px;font-weight:600;letter-spacing:.07em;text-transform:uppercase}
.ams-dl-value{color:var(--ams-head);font-size:13.5px;overflow-wrap:anywhere}
.ams-dl-empty{color:var(--ams-dim);font-size:13px;font-style:italic}
/* history: the date in its own 104px column */
.ams-log{overflow:hidden;border:1px solid var(--ams-line-soft);border-radius:10px;background:var(--ams-surface)}
.ams-log-row{display:grid;grid-template-columns:104px minmax(0,1fr);gap:14px;padding:12px 16px;border-bottom:1px solid var(--ams-line-soft)}
.ams-log-row:last-child{border-bottom:0}
.ams-log-date{padding-top:1px;color:var(--ams-mute);font-family:${MONO};font-size:12px}
.ams-log-text{display:flex;align-items:center;gap:8px;color:var(--ams-head);font-size:13.5px}
.ams-log-sub{margin-top:2px;padding-left:15px;color:var(--ams-mute);font-size:12.5px}
.ams-log-by{margin-top:3px;padding-left:15px;color:var(--ams-dim);font-size:11.5px}
.ams-tab-bar{display:flex;flex-wrap:wrap;align-items:center;justify-content:space-between;gap:10px;margin-bottom:12px;color:var(--ams-mute);font-size:12.5px}
.ams-tab-empty{padding:36px 16px;border:1px dashed var(--ams-line);border-radius:10px;color:var(--ams-mute);font-size:13px;text-align:center}
.ams-from{margin-top:2px;color:var(--ams-dim);font-size:11.5px}
.ams-current{margin-top:2px;color:var(--ams-ok);font-size:10.5px;font-weight:600;letter-spacing:.06em;text-transform:uppercase}
.ams-row-link{cursor:pointer}
.ams-row-link:focus-visible{outline:2px solid var(--ams-sand);outline-offset:-2px}
.ams-table tfoot td{padding:11px 12px!important;border-top:1px solid var(--ams-line);background:var(--ams-surface-2)}
.ams-tfoot-label{color:var(--ams-mute);font-weight:600}
@media (max-width:640px){
  .ams-form-grid,.ams-dl{grid-template-columns:1fr}
  .ams-modal{max-height:94vh}
  .ams-modal-head,.ams-modal-foot{padding-inline:16px}
  .ams-modal-body{padding:0 16px 18px}
  .ams-drawer-head{padding:10px 14px 0}
  .ams-drawer-body{padding:14px 14px 28px}
  .ams-sticker-main{padding:12px 14px}
  .ams-sticker-no{font-size:21px}
  .ams-sticker-qr{width:96px;padding:10px 8px}
  .ams-log-row{grid-template-columns:86px minmax(0,1fr);gap:10px;padding:11px 12px}
}

/* The asset list as a table, after the reference build's .panel/.tbl/.chip. */
.ams-panel{min-width:0;overflow:hidden;border:1px solid var(--ams-line-soft);border-radius:10px;background:var(--ams-surface)}
.ams-tblwrap{overflow-x:auto}
/* wide enough that a narrow screen scrolls the table sideways rather than
   squeezing every column into a tall stack of wrapped words */
.ams-tbl{width:100%;min-width:960px;border-collapse:collapse;font-size:13px}
.ams-tbl th{padding:10px 12px;border-bottom:1px solid var(--ams-line-soft);background:var(--ams-well);color:var(--ams-dim);font-size:12px;font-weight:500;text-align:left;white-space:nowrap}
.ams-tbl td{padding:10px 12px;border-bottom:1px solid var(--ams-line-soft);color:var(--ams-text);vertical-align:top}
.ams-tbl tbody tr:last-child td{border-bottom:0}
.ams-tbl-click{cursor:pointer}
.ams-tbl-click:hover td{background:var(--ams-surface-2)}
.ams-tbl-click:focus-visible{outline:2px solid var(--ams-sand);outline-offset:-2px}
.ams-tbl-strong{font-weight:600}
.ams-tbl-sub{display:block;color:var(--ams-dim);font-size:12px}
.ams-chip{--c:#999;display:inline-flex;align-items:center;gap:6px;padding:2px 10px 2px 8px;border-radius:999px;
  background:color-mix(in srgb,var(--c) 20%,transparent);color:color-mix(in srgb,var(--c) 45%,#fff);font-size:12px;font-weight:500;line-height:18px;white-space:nowrap}
.ams-chip-dot{width:8px;height:8px;flex-shrink:0;border-radius:50%;background:var(--c)}
.ams-due{display:inline-flex;align-items:center;gap:5px;font-size:12px;font-weight:600;white-space:nowrap}
.ams-empty{display:flex;flex-direction:column;align-items:center;gap:12px;padding:48px 20px;text-align:center}
.ams-empty-title{color:var(--ams-head);font-size:14px;font-weight:500}
.ams-empty-sub{color:var(--ams-mute);font-size:13px}

/* Toasts: bottom right, a light plate with a sand edge, or red for errors. */
.ams-toasts{position:fixed;right:20px;bottom:20px;z-index:50;display:flex;width:min(400px,calc(100vw - 28px));flex-direction:column;gap:10px}
.ams-toast{display:flex;align-items:flex-start;gap:10px;padding:12px 10px 12px 14px;border-left:4px solid var(--ams-sand-deep);border-radius:10px;
  background:var(--ams-plate);color:var(--ams-on-plate);font-size:13px;font-weight:500;line-height:1.45;box-shadow:0 16px 44px rgba(0,0,0,.42);
  animation:ams-toast 280ms cubic-bezier(.2,.8,.25,1) both}
.ams-toast[data-tone="error"]{border-left-color:var(--ams-red-deep);background:var(--ams-red);color:#fff}
.ams-toast-x{display:grid;width:24px;height:24px;flex-shrink:0;place-items:center;margin:-2px 0 0 4px;border:0;border-radius:6px;background:transparent;color:inherit;opacity:.7;cursor:pointer}
.ams-toast-x:hover{opacity:1;background:rgba(0,0,0,.08)}
@keyframes ams-toast{from{opacity:0;transform:translateY(12px)}to{opacity:1;transform:none}}

/* The bar gives up words before it gives up controls. */
@media (max-width:1180px){.ams-who-text{display:none}}
@media (max-width:980px){.ams-save-text{display:none}.ams-save{padding:0 8px}}

/* ------------------------------------------------------------------------
   Under 820px the rail becomes a bar along the bottom of the screen. It
   scrolls sideways when the modules outnumber the width, and the red bar
   moves to the top edge of the open module.
   ------------------------------------------------------------------------ */
@media (max-width:819px){
  .ams-shell{--rail:0px}
  .ams-main{padding-bottom:calc(66px + env(safe-area-inset-bottom))}
  .ams-sidebar{inset:auto 0 0 0;width:auto;height:calc(66px + env(safe-area-inset-bottom));flex-direction:row;overflow-x:auto;overflow-y:hidden;
    padding-bottom:env(safe-area-inset-bottom);border-top:1px solid var(--ams-line-soft);border-right:0;box-shadow:0 -10px 30px rgba(0,0,0,.25)}
  .ams-side-head,.ams-side-spacer{display:none}
  .ams-nav{flex-direction:row;flex-shrink:0;gap:0;padding:0}
  .ams-side-rule{width:1px;height:auto;margin:14px 2px}
  .ams-nav-item{width:auto;min-width:74px;min-height:66px;padding:8px 6px}
  .ams-nav-item:before{top:0;right:14px;bottom:auto;left:14px;width:auto;height:3px;border-radius:0 0 3px 3px;transform:scaleX(0)}
  .ams-nav-item[aria-current="page"]:before{transform:scaleX(1)}
  .ams-nav-label{white-space:nowrap}
  .ams-top-mark{display:block}
  .ams-topbar{min-height:56px;padding:8px 14px}
  .ams-content{padding:16px 14px 30px}
  .ams-toasts{right:14px;bottom:calc(78px + env(safe-area-inset-bottom))}
}
/* A phone has room for the controls or the words, not both: the bottom bar
   already names the open module, so the title goes, the save state keeps its
   dot, and the account keeps only its way out. */
@media (max-width:580px){
  .ams-page-title,.ams-save-text,.ams-who-text,.ams-avatar{display:none}
  .ams-topbar{gap:10px}
  .ams-save{min-height:22px;padding:0 7px}
  .ams-who{margin-left:0;padding-left:7px}
  .ams-top-actions{min-width:0;gap:6px}
  .ams-topbar .ams-top-select{max-width:118px;font-size:12px}
  .ams-ctl{padding-inline:11px}
  .ams-stat{padding:12px 13px 11px 14px}
  .ams-metric{min-height:108px;padding:14px}
  .ams-stat-v{font-size:24px}
  .ams-metric-v{font-size:24px}
}
@media (prefers-reduced-motion:reduce){.ams-sidebar,.ams-main,.ams-pop,.ams-spin,.ams-cart-tick,.ams-ctl,.ams-btn,.ams-nav-item,.ams-nav-item:before,.ams-nav-icon svg,.ams-stat,.ams-stat-icon,.ams-trend-tip,.ams-brand,.ams-brand-glaze:before,.ams-signout,.ams-save-dot,.ams-scrim,.ams-scrim>*,.ams-slide-in,.ams-toast,.ams-drawer,.ams-drawer-scrim,.ams-tab:after,.ams-tab{animation:none;transition:none}}
`;


/* A menu anchored under its own trigger. Closes on outside click and on
   Escape, and on any click inside, so every item is a one-shot action. */
/* The menu is portaled to the document body rather than left where the
   trigger sits. Its old home, the top bar, is a backdrop-filter blur - a
   descendant with its own opaque background can still end up composited
   into that blur in some browsers, which is what read as a see-through
   menu. Outside the bar's DOM the menu paints on its own layer instead.

   The bar is a sticky header, so the trigger's screen position never
   changes under scroll and is only measured again on open and on resize. */
function Popover({ trigger, children, width = 250, align = "right" }) {
  const [open, setOpen] = useState(false);
  const [spot, setSpot] = useState(null);
  const anchor = useRef(null);
  const menu = useRef(null);

  const place = useCallback(() => {
    const box = anchor.current?.getBoundingClientRect();
    if (box) setSpot(box);
  }, []);

  useEffect(() => {
    if (!open) return undefined;
    place();
    const away = (e) => {
      if (anchor.current?.contains(e.target) || menu.current?.contains(e.target)) return;
      setOpen(false);
    };
    const key = (e) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", away);
    document.addEventListener("keydown", key);
    window.addEventListener("resize", place);
    return () => {
      document.removeEventListener("mousedown", away);
      document.removeEventListener("keydown", key);
      window.removeEventListener("resize", place);
    };
  }, [open, place]);

  return (
    <div ref={anchor} style={{ position: "relative" }}>
      {trigger(open, () => setOpen((v) => !v))}
      {open && spot && createPortal(
        <div ref={menu} className="ams-pop" role="menu" onClick={() => setOpen(false)}
          style={{
            position: "fixed", top: spot.bottom + 7, width,
            ...(align === "right" ? { right: window.innerWidth - spot.right } : { left: spot.left }),
          }}>
          {children}
        </div>,
        document.body,
      )}
    </div>
  );
}

const MenuItem = ({ icon: Icon, hint, tone, children, onClick, disabled }) => (
  <button type="button" role="menuitem" className="ams-item" onClick={onClick} disabled={disabled}
    style={tone ? { color: tone } : undefined}>
    {Icon && <Icon size={15} strokeWidth={2} style={{ color: tone || C.mute, flexShrink: 0, marginTop: 1 }} />}
    <span className="min-w-0">
      <span className="block truncate">{children}</span>
      {hint && <span className="block truncate" style={{ fontSize: 11.5, color: C.mute, marginTop: 1 }}>{hint}</span>}
    </span>
  </button>
);

/* Deleting is the one thing no delegated permission carries. A role may be
   trusted to register, move, repair and retire, and still not be trusted to
   erase — so destruction is answered by who you are, not by what your role was
   granted. It is asked for through `can` like any other permission, which
   means every control that already receives `can` is covered by it, and a
   delete button added later cannot quietly miss the gate. */
const DELETE_PERMISSION = "system.delete";

/* A KPI tile's 12-week trend: one line in the tile's colour over a soft
   fill, today's point marked. Hover (or a tap) drops a hairline on the
   nearest week and reads that week's figure; the whole strip is the target,
   so nobody has to aim at a 2px line. The figure is also on the tile and
   the change over the 12 weeks is written beside it, so the tooltip adds
   detail but never gates it. The SVG stretches to the tile and keeps its
   stroke at 2px; the dot, hairline and tooltip are HTML placed in the same
   percentages, so none of them stretch with it. */
const weekLabel = (date, last) => last ? "Today" : new Date(`${date}T00:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });

function TileTrend({ points, noun }) {
  const [at, setAt] = useState(null);
  const hold = useRef(0);
  useEffect(() => () => clearTimeout(hold.current), []);
  const n = points.length;
  const values = points.map((p) => p.value);
  const lo = Math.min(...values), hi = Math.max(...values);
  const x = (i) => (n > 1 ? (i / (n - 1)) * 100 : 50);
  const y = (v) => (hi === lo ? 50 : 86 - ((v - lo) / (hi - lo)) * 72);
  const line = points.map((p, i) => `${i ? "L" : "M"}${x(i).toFixed(2)} ${y(p.value).toFixed(2)}`).join(" ");
  const pick = (event) => {
    const box = event.currentTarget.getBoundingClientRect();
    const f = (event.clientX - box.left) / box.width;
    setAt(Math.max(0, Math.min(n - 1, Math.round(f * (n - 1)))));
    /* a finger lifts straight away, so a tapped readout stays a moment */
    clearTimeout(hold.current);
    if (event.pointerType === "touch") hold.current = setTimeout(() => setAt(null), 2600);
  };
  const shown = at ?? n - 1;
  return (
    <div className="ams-trend" aria-hidden="true" onPointerMove={pick} onPointerDown={pick}
      onPointerLeave={(event) => { if (event.pointerType !== "touch") setAt(null); }}>
      <svg viewBox="0 0 100 100" preserveAspectRatio="none">
        <path className="ams-trend-area" d={`${line} L100 100 L0 100 Z`} />
        <path className="ams-trend-line" d={line} />
      </svg>
      {at !== null && <span className="ams-trend-cross" style={{ left: `${x(at)}%` }} />}
      <span className="ams-trend-dot" style={{ left: `${x(shown)}%`, top: `${y(points[shown].value)}%` }} />
      {at !== null && (
        <span className="ams-trend-tip" data-edge={at === 0 ? "start" : at === n - 1 ? "end" : undefined} style={{ left: `${x(at)}%` }}>
          {weekLabel(points[at].date, at === n - 1)} · <b>{metric(points[at].value)}</b> {noun}
        </span>
      )}
    </div>
  );
}

const OPERATIONAL_TABS = new Set(["assets", "cart", "transfers", "repairs", "parts", "maintenance", "map", "reports"]);

function RegisterSidebar({ tabs, tab, onTab }) {
  const nav = useRef(null);
  const operational = tabs.filter(([key]) => OPERATIONAL_TABS.has(key));
  const administration = tabs.filter(([key]) => !OPERATIONAL_TABS.has(key));

  /* The rail runs top to bottom on a desk and left to right along the bottom
     of a phone, so both pairs of arrows step through it. */
  const onNavKey = (event) => {
    const step = { ArrowDown: 1, ArrowRight: 1, ArrowUp: -1, ArrowLeft: -1 }[event.key];
    const at = event.key === "Home" ? 0 : event.key === "End" ? tabs.length - 1 : null;
    if (step === undefined && at === null) return;
    event.preventDefault();
    const here = tabs.findIndex(([key]) => key === tab);
    const next = at !== null ? at : (here + step + tabs.length) % tabs.length;
    onTab(tabs[next][0]);
    nav.current?.querySelectorAll(".ams-nav-item")[next]?.focus();
  };

  const renderItem = ([key, label, Icon, count]) => {
    const selected = tab === key;
    return (
      <button key={key} type="button" id={`ams-nav-${key}`} className="ams-nav-item"
        aria-current={selected ? "page" : undefined} aria-controls="ams-panel" title={label}
        onClick={() => onTab(key)}>
        <span className="ams-nav-icon">
          <Icon size={20} strokeWidth={selected ? 2.1 : 1.8} />
          {count !== null && (
            <span className="ams-nav-count" data-active={selected ? "1" : undefined} data-quiet={count === 0 ? "1" : undefined}>
              {metric(count)}
            </span>
          )}
        </span>
        <span className="ams-nav-label">{label}</span>
      </button>
    );
  };

  return (
    <aside id="ams-sidebar" ref={nav} className="ams-sidebar" aria-label="Asset Management System navigation">
      <div className="ams-side-head">
        <div className="ams-brand">
          <span className="ams-brand-art">
            <img src="/ams-brand.png" alt="Asset Management System" width="1119" height="274" />
            <span className="ams-brand-glaze" aria-hidden="true" />
          </span>
        </div>
      </div>

      <nav className="ams-nav" aria-label="Operational sections" onKeyDown={onNavKey}>
        {operational.map(renderItem)}
      </nav>

      {administration.length > 0 && (
        <>
          <div className="ams-side-rule" aria-hidden="true" />
          <nav className="ams-nav" aria-label="Administration sections" onKeyDown={onNavKey}>
            {administration.map(renderItem)}
          </nav>
        </>
      )}
      <div className="ams-side-spacer" />
    </aside>
  );
}

function RegisterTopbar({ tabs, tab, onRefresh, refreshing, busy, dataActions, primary, companyNames, company, onCompany, brand, save, identity, onSignOut }) {
  const active = tabs.find(([key]) => key === tab);
  const access = `${identity.role}${identity.isSuperAdmin ? " · Full access" : ""}`;
  return (
    <header className="ams-topbar">
      <div className="ams-top-start">
        {/* on a phone the rail is a bar along the bottom, so the badge moves up here */}
        <div className="ams-brand ams-top-mark" aria-hidden="true">
          <span className="ams-brand-art"><img src="/ams-brand.png" alt="" width="1119" height="274" /></span>
        </div>
        <h1 className="ams-page-title">{active?.[1] || "Asset register"}</h1>
        <span className="ams-save" data-state={save.state} role="status" title={save.text}>
          <span className="ams-save-dot" aria-hidden="true" />
          <span className="ams-save-text">{save.text}</span>
        </span>
      </div>

      <div className="ams-top-actions">
        {brand?.logoUrl && (
          <img className="ams-top-brand" src={brand.logoUrl} alt={brand.name} title={brand.name} />
        )}

        {/* the company filter scopes the register, so it leads the bar - and it
            only appears on the view it actually filters */}
        {tab === "assets" && companyNames.length > 0 && (
          <select className="ams-top-select" value={company} data-set={company ? "1" : "0"}
            onChange={(event) => onCompany(event.target.value)} aria-label="Filter the register by company">
            <option value="">All companies</option>
            {companyNames.map((name) => <option key={name} value={name}>{name}</option>)}
          </select>
        )}

        <button type="button" className="ams-ctl" data-icon="1" onClick={onRefresh} disabled={refreshing || busy}
          title="Refresh from Supabase" aria-label="Refresh from Supabase">
          {/* Refresh.png is drawn at about 58% opacity, which all but vanishes on
              the dark bar, so this is a copy with the same shape at full strength */}
          <ImgIcon src="/icon/refresh-solid.png" size={15} className={refreshing ? "ams-spin" : undefined} />
        </button>

        {dataActions.length > 0 && (
          <Popover width={266} trigger={(isOpen, toggle) => (
            <button type="button" className="ams-ctl" data-open={isOpen ? "1" : "0"} onClick={toggle}
              aria-haspopup="menu" aria-expanded={isOpen} title="Export and import">
              <ImgIcon src="/icon/Data.png" size={16} mask={false} />
              <span className="hidden sm:inline">Data</span>
              <ChevronDown size={14} strokeWidth={2} style={{ color: C.mute }} />
            </button>
          )}>
            <div style={{ padding: "7px 12px 3px" }}><Label>Export &amp; import</Label></div>
            {dataActions.map((action) => (
              <MenuItem key={action.key} icon={action.icon} hint={action.hint} onClick={action.onClick} disabled={action.disabled}>{action.label}</MenuItem>
            ))}
          </Popover>
        )}

        {primary && (
          <button type="button" className="ams-ctl" data-primary="1" onClick={primary.onClick} disabled={primary.disabled}
            title={primary.label} aria-label={primary.label}>
            {primary.img ? <ImgIcon src={primary.img} size={15} /> : <primary.icon size={15} strokeWidth={2} />}<span className="hidden sm:inline">{primary.label}</span>
          </button>
        )}

        <div className="ams-who" title={`${identity.name} · ${access}`}>
          <div className="ams-avatar" aria-hidden="true"><span className="ams-avatar-icon" /></div>
          <div className="ams-who-text">
            <span className="ams-who-name">{identity.name}</span>
            <span className="ams-who-role">
              {identity.isSuperAdmin
                ? <img className="ams-access-icon" src="/icon/Supper%20Admin%20Access.png" alt="" width="15" height="15" />
                : <span className="ams-access-icon ams-access-icon--normal" aria-hidden="true" />}
              {access}
            </span>
          </div>
          <button type="button" className="ams-signout" onClick={onSignOut} title="Sign out" aria-label="Sign out">
            <span className="ams-signout-icon" aria-hidden="true" />
          </button>
        </div>
      </div>
    </header>
  );
}


/* ------------------------------- app ------------------------------- */

export default function AssetRegister({ currentUser, access, onSignOut }) {
  const [assets, setAssets] = useState([]);
  const [repairs, setRepairs] = useState([]);
  const [plans, setPlans] = useState([]);
  const [companies, setCompanies] = useState([]);
  const [categories, setCategories] = useState([]);
  const [projects, setProjects] = useState([]);
  const [people, setPeople] = useState([]);
  const [brands, setBrands] = useState([]);
  /* how the register writes the numbers it issues, and the next one of each */
  const [numbering, setNumbering] = useState(null);
  const [nextTransfer, setNextTransfer] = useState(null);
  /* The next asset number as the database would issue it. Empty until the
     asset number migration has been applied, and the register then falls back
     to working one out from the assets on screen. */
  const [issuedTag, setIssuedTag] = useState("");
  /* the movement a scanned form, or a click in the Transfers tab, is asking for */
  const [transferId, setTransferId] = useState(() => readQuery("transfer"));
  /* a sticker somebody scanned, when it turns out to be for an asset this
     account cannot reach */
  const [scanMiss, setScanMiss] = useState("");
  /* which workspace opened the reader, so its own button can close it */
  const [scanning, setScanning] = useState(null);
  /* the sheet being looked at, and the asset whose sheets are being listed */
  const [formView, setFormView] = useState(null);
  const [formsFor, setFormsFor] = useState(null);
  const scannedSticker = useRef(readQuery("asset") || "");
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [loadErr, setLoadErr] = useState("");
  const [saveErr, setSaveErr] = useState("");
  /* A form scanned off a desk arrives as ?transfer=<id> from the QR code on the
     printed sheet. It is known before the first render, so the tab and the open
     movement start from it rather than being set once the effects have run. */
  const [tab, setTab] = useState(() => (readQuery("transfer") ? "transfers" : "assets"));
  const [sel, setSel] = useState(null);
  const [job, setJob] = useState(null);
  const [q, setQ] = useState("");
  const [filter, setFilter] = useState("all");
  const [cat, setCat] = useState("");
  const [loc, setLoc] = useState("");
  const [comp, setComp] = useState("");
  const [showClosed, setShowClosed] = useState(false);
  /* The cart is a list somebody builds while walking a yard, before deciding
     where any of it goes, so it has to survive a reload the way the rail's
     width does. Ids only: the assets themselves are read back out of the
     register, so a cart can never disagree with it. */
  const [cart, setCart] = useState(() => {
    try { return JSON.parse(localStorage.getItem("ams.transferCart") || "[]").filter((id) => typeof id === "string"); }
    catch { return []; }
  });
  useEffect(() => {
    try { localStorage.setItem("ams.transferCart", JSON.stringify(cart)); }
    catch { /* private mode - the cart just does not survive the tab */ }
  }, [cart]);

  const [dlg, setDlg] = useState(null);
  const [confirm, setConfirm] = useState(null);
  /* the Add Maintenance modal: null when closed, otherwise the asset tag
     it is locked to (empty string when opened generically, so the asset
     field stays a normal dropdown instead of a fixed one) */
  const [maintenanceChoice, setMaintenanceChoice] = useState(null);
  /* historic maintenance: every record the user may see, newest first */
  const [maintenanceRecords, setMaintenanceRecords] = useState([]);
  /* the printed Equipment Repair Order for one historic record */
  const [eroView, setEroView] = useState(null);
  const [viewer, setViewer] = useState(null);
  /* the asset's paperwork, opened at the one that was clicked */
  const [gallery, setGallery] = useState(null);
  const [assetImport, setAssetImport] = useState(false);
  const [notice, setNotice] = useState("");
  const [legacyBrowserData, setLegacyBrowserData] = useState(null);
  const fileRef = useRef(null);

  const permissionSet = useMemo(() => new Set(access?.permissions || []), [access]);
  const isSuperAdmin = access?.is_super_admin === true;
  const can = (permission) => (permission === DELETE_PERMISSION ? isSuperAdmin : permissionSet.has(permission));
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

  /* An asset sticker scanned off a machine arrives as ?asset=<code>. It is
     resolved against the assets that actually came back, so an asset outside
     this account's companies simply is not there — which is the answer. */
  const openScannedAsset = useCallback((loaded) => {
    const wanted = scannedSticker.current;
    if (!wanted) return;
    scannedSticker.current = "";
    const found = (loaded || []).find((a) => matchesScan(a, wanted));
    if (found) { setTab("assets"); setSel(found.id); }
    else setScanMiss(wanted);
  }, []);

  const reloadOperationalData = useCallback(async () => {
    setRefreshing(true);
    setLoadErr("");
    try {
      const data = await loadOperationalData();
      setAssets(data.assets); setRepairs(data.repairs); setPlans(data.plans);
      setCompanies(data.companies); setCategories(data.categories); setProjects(data.projects); setPeople(data.people || []); setBrands(data.brands || []);
      setIssuedTag(data.nextTag || "");
      setNumbering(data.numbering || null); setNextTransfer(data.nextTransfer ?? null);
      setMaintenanceRecords(data.maintenanceRecords || []);
      openScannedAsset(data.assets);
      return data;
    } catch (error) {
      setLoadErr(error.message || "The Supabase register could not be loaded.");
      throw error;
    } finally {
      setRefreshing(false);
    }
  }, [openScannedAsset]);

  useEffect(() => {
    let active = true;
    loadOperationalData()
      .then((data) => {
        if (!active) return;
        setAssets(data.assets); setRepairs(data.repairs); setPlans(data.plans);
        setCompanies(data.companies); setCategories(data.categories); setProjects(data.projects); setPeople(data.people || []); setBrands(data.brands || []);
        setIssuedTag(data.nextTag || "");
        setNumbering(data.numbering || null); setNextTransfer(data.nextTransfer ?? null);
        setMaintenanceRecords(data.maintenanceRecords || []);
        openScannedAsset(data.assets);
      })
      .catch((error) => {
        if (active) setLoadErr(error.message || "The Supabase register could not be loaded.");
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => { active = false; };
  }, [openScannedAsset]);

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

  /* an asset that has left the register, or the user's scope, quietly leaves
     the cart with it rather than failing at the point of transfer */
  const cartAssets = useMemo(
    () => cart.map((id) => allowedAssets.find((asset) => asset.id === id)).filter(Boolean),
    [cart, allowedAssets],
  );
  /* An asset on a repair ticket is not the yard's to move — it is where the
     repair is. A retired one is not moving anywhere either. Neither gets the
     cart control, and neither can be ticked once the cart is opened. */
  const cartable = useCallback(
    (asset) => !!asset && asset.status !== "retired" && !openJob(asset.id),
    [openJob],
  );
  /* what the cart holds against what the cart can actually move */
  const movableCart = useMemo(() => cartAssets.filter(cartable), [cartAssets, cartable]);
  const inCart = useCallback((id) => cart.includes(id), [cart]);
  const toggleCart = useCallback(
    (id) => setCart((held) => (held.includes(id) ? held.filter((one) => one !== id) : [...held, id])),
    [],
  );
  const clearCart = useCallback(() => setCart([]), []);
  /* Ticking an asset into the cart is a decision about what the next transfer
     moves, so it is asked for rather than taken — a stray tap while reading
     down a long list should not quietly add a machine to the paperwork.
     Taking one back out needs no such ceremony: that is how a mistaken tick
     gets corrected, and asking twice would only stand in the way. */
  const askAddToCart = useCallback((asset) => {
    if (!asset) return;
    if (cart.includes(asset.id)) return toggleCart(asset.id);
    const held = cart.length;
    setConfirm({
      title: `Add ${asset.tag} to the transfer cart?`,
      body: `${asset.name} ${held ? `joins ${held} ${held === 1 ? "asset" : "assets"} already in the cart` : "starts the cart"}. Nothing moves yet — the cart holds what is going until the transfer is recorded.`,
      confirm: "Add to cart", cancel: "Cancel", kind: "solid",
      run: () => toggleCart(asset.id),
    });
  }, [cart, toggleCart]);

  /* every movement in the register, for the rail badge and the tab itself */
  const transferCount = useMemo(
    () => allowedAssets.reduce((total, asset) => total + (asset.history || []).filter((entry) => entry.kind === "transfer").length, 0),
    [allowedAssets],
  );

  const ctx = useMemo(() => {
    const uniq = (k) => [...new Set(allowedAssets.map((x) => x[k]).filter(Boolean))].sort();
    const n = assets.map((a) => parseInt(String(a.tag).replace(/\D/g, ""), 10)).filter((x) => !isNaN(x));
    return {
      locations: uniq("location"),
      /* the configured list, not a scrape of what has been typed before */
      people: people.filter((person) => person.active).map((person) => person.name).sort((a, b) => a.localeCompare(b)),
      companies: allowedCompanies.map((company) => ({ id: company.id, name: company.name, logoUrl: company.logoUrl })),
      companyNames: allowedCompanies.map((c) => c.name).sort(),
      categoryNames: allowedCategories.map((c) => c.name).sort((a, b) => a.localeCompare(b)),
      /* who is at the keyboard, for the paperwork that records who processed it */
      userName: access?.full_name || currentUser?.email || "",
      brandNames: brands.map((brand) => brand.name).sort((a, b) => a.localeCompare(b)),
      modelsOf: (brandName) => (brands.find((brand) => brand.name === brandName)?.models || [])
        .map((model) => model.name).sort((a, b) => a.localeCompare(b)),
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
      /* the same, keyed without case or spaces and naming the asset, for the
         asset form's as-you-type check */
      idOwners: Object.fromEntries(UNIQUE_FIELDS.map(({ key }) => [
        key, Object.fromEntries(allowedAssets.filter((a) => idKey(a[key])).map((a) => [idKey(a[key]), { id: a.id, tag: a.tag, name: a.name }])),
      ])),
      nextTag: issuedTag || `AST-${formatSequenceNumber(Math.max(n.length ? Math.max(...n) + 1 : 1, numbering?.asset?.start || 1), numbering?.asset)}`,
      tagIsIssued: !!issuedTag,
      job: currentJob,
      /* a filed document is opened through the same viewer as a receipt or a
         signed form, which already knows how to show a scan and a PDF */
      openFile: (row) => setViewer({ kind: "document", meta: { ...row, name: row.label } }),
      /* a file kept with a maintenance record opens the same way; when it was
         opened from the Add Maintenance modal, `returnTo` is where that modal
         was, so closing the file brings the modal back to the same place */
      openHistoryFile: (row, returnTo = null) => setViewer({ kind: "history", meta: { ...row, name: row.label || row.name }, returnTo }),
    };
  }, [assets, allowedAssets, allowedRepairs, allowedPlans, allowedCompanies, allowedCategories, projects, people, currentJob, issuedTag, numbering, brands, access, currentUser]);

  const transferView = useMemo(
    () => (transferId ? movementsOf(allowedAssets).find(({ entry }) => entry.id === transferId) || null : null),
    [transferId, allowedAssets],
  );

  /* Read once, then dropped from the address, so refreshing the page tomorrow
     does not reopen something somebody scanned today. */
  useEffect(() => { dropQuery("transfer"); dropQuery("asset"); }, []);


  /* Signing in has already been dealt with by the gate. If the movement is not
     on this user's register, that is said plainly rather than left as an empty
     panel — the paper is real, the access is what is missing. */
  const transferMissing = !!transferId && !loading && !transferView;

  /* A code read from a sticker or a photograph. Where it leads is decided by
     what it holds, not by which workspace was open when it was read: a transfer
     code opens the movement even from the asset list, and the other way round.
     Nothing is found when the record is outside this account's companies,
     which is answered plainly rather than silently. */
  const followScan = (text) => {
    const scan = readScan(text);
    setScanning(null);
    if (!scan) return setScanMiss(String(text || "").slice(0, 80) || "an empty code");
    if (scan.kind === "transfer") {
      const movement = movementsOf(allowedAssets).find(({ entry }) => entry.id === scan.value);
      if (!movement) return setScanMiss(`transfer ${scan.value}`);
      setTab("transfers");
      setTransferId(scan.value);
      return undefined;
    }
    const asset = allowedAssets.find((a) => matchesScan(a, scan.value));
    if (!asset) return setScanMiss(scan.value);
    setTab("assets");
    setSel(asset.id);
    return undefined;
  };

  const formActions = {
    view: (entry, asset) => setFormView(formDataOf(entry, asset, companies)),
    print: (entry, asset) => printTransferForm(formDataOf(entry, asset, companies)),
    download: (entry, asset) => downloadTransferForm(formDataOf(entry, asset, companies)),
  };

  /* Filing or detaching a form changes one row of one movement. Reloading the
     whole register for it — sixteen tables and the numbering call — is what
     made this feel slow, so the panel's own copy is corrected in place and the
     server is left alone. */
  const patchTransferFiles = useCallback((assetId, entryId, update) => setAssets((previous) => previous.map((asset) => (
    asset.id === assetId
      ? { ...asset, history: (asset.history || []).map((entry) => (entry.id === entryId ? { ...entry, files: update(entry.files || []) } : entry)) }
      : asset
  ))), []);

  /* Answers whether the form is filed, so the panel keeps a typed note on the
     screen when the upload failed rather than throwing it away. */
  const attachTransferForm = async (file, details) => {
    if (!requirePermission("asset.transfer", "filing a signed transfer form")) return false;
    if (file.size > 10 * 1024 * 1024) {
      setSaveErr(`That file is ${kb(file.size)}. The limit is 10 MB — photograph the sheet at a smaller size.`);
      return false;
    }
    const assetId = transferView?.asset?.id;
    if (!assetId) return false;
    setSaving(true); setSaveErr("");
    try {
      const filed = await saveTransferAttachment(transferId, file, details);
      patchTransferFiles(assetId, transferId, (files) => [...files, filed]);
      setNotice("Signed form filed against the transfer.");
      return true;
    } catch (error) {
      setSaveErr(error.message || "Supabase rejected the change. Your input was not recorded as saved.");
      return false;
    } finally {
      setSaving(false);
    }
  };

  const renameTransferForm = async (file, name) => {
    if (!requirePermission("asset.transfer", "renaming a filed transfer form")) return false;
    const assetId = transferView?.asset?.id;
    if (!assetId) return false;
    setSaving(true); setSaveErr("");
    try {
      const renamed = await renameTransferAttachment(file.id, name);
      patchTransferFiles(assetId, file.transferId || transferId, (kept) => kept.map((one) => (one.id === renamed.id ? renamed : one)));
      setNotice("Form renamed.");
      return true;
    } catch (error) {
      setSaveErr(error.message || "Supabase rejected the change. Your input was not recorded as saved.");
      return false;
    } finally {
      setSaving(false);
    }
  };

  const detachTransferForm = (file) => setConfirm({
    title: `Detach ${file.name}?`,
    body: "The file is removed from storage. The transfer itself is not affected, and the form can be filed again.",
    confirm: "Detach form",
    run: async () => {
      if (!requirePermission(DELETE_PERMISSION, "detaching a filed transfer form")) return;
      const assetId = transferView?.asset?.id;
      setSaving(true); setSaveErr("");
      try {
        await removeTransferAttachment(file);
        if (assetId) patchTransferFiles(assetId, file.transferId || transferId, (kept) => kept.filter((one) => one.id !== file.id));
        setNotice("Form detached.");
      } catch (error) {
        setSaveErr(error.message || "Supabase rejected the change. Your input was not recorded as saved.");
      } finally {
        setSaving(false);
      }
    },
  });

  /* search + dropdowns narrow the pool; the status chips then split whatever is left */
  const scoped = useMemo(() => {
    const t = q.trim().toLowerCase();
    return allowedAssets
      .filter((a) => (!cat || a.category === cat) && (!loc || a.location === loc) && (!comp || a.company === comp))
      .filter((a) => !t || [a.tag, a.code, a.name, a.brand, a.model, a.serial, a.engine, a.plate, a.mvFile, a.conduction, a.body, a.location, a.custodian, a.category, a.company].some((v) => String(v || "").toLowerCase().includes(t)));
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

  /* twelve weekly snapshots of the same three figures, the last one today */
  /* keyed on today's date, so a page left open rolls the window over at midnight */
  const todayKey = today();
  const trend = useMemo(() => registerTrend(allowedAssets, allowedRepairs, trendDays(12, new Date(`${todayKey}T12:00:00Z`))),
    [allowedAssets, allowedRepairs, todayKey]);

  /* The three buckets are exhaustive, so they compose the whole. Zero-length
     segments are dropped rather than drawn, or the 2px gaps would stack up as
     a stripe where there is no data. */
  const mix = [
    ["active", totals.active, C.active, "Active"],
    ["out", totals.out, STAGES.broken.color, "Broken or in repair"],
    ["retired", totals.retired, C.retired, "Retired"],
  ].filter(([, n]) => n > 0);
  const openStages = STAGE_ORDER.filter((st) => stageMix[st] > 0);

  const counts = useMemo(() => {
    const c = { all: scoped.length, active: 0, out: 0, retired: 0 };
    scoped.forEach((a) => { c[bucketOf(a)]++; });
    return c;
  }, [scoped, bucketOf]);

  /* In asset-number order, as in the reference build, so a newly saved asset
     takes its place in the sequence. The number is read as a number - sorting
     the tag as text put AST-10 before AST-2. */
  const shown = useMemo(() => scoped
    .filter((a) => filter === "all" || bucketOf(a) === filter)
    .sort((a, b) => assetSeq(a) - assetSeq(b) || String(a.tag).localeCompare(String(b.tag))),
  [scoped, filter, bucketOf]);

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

  const runAsset = async (name, vals, meta = {}) => {
    const permission = name === "register" ? "asset.create" : ["transfer", "transferCart"].includes(name) ? "asset.transfer" : ["retire", "reinstate"].includes(name) ? "asset.retire" : "asset.update";
    if (!requirePermission(permission, ASSET_ACTIONS[name].title.toLowerCase())) return;
    try {
      const scoped = {
        ...vals,
        /* the form only previewed the number; the database issues the real one
           on insert, so nothing is sent and two people cannot claim the same */
        ...(name === "register" && issuedTag ? { tag: "" } : {}),
        ...(["register", "edit"].includes(name) ? clearedVehicle(vals.category) : {}),
        companyId: companyIdFor(vals.company),
        categoryId: categoryIdFor(vals.category),
        projectId: ["register", "transfer", "transferCart"].includes(name) ? projectIdFor(vals.project) : name === "edit" ? current.projectId : null,
      };
      let result;
      let fileTrouble = [];
      if (name === "register") {
        const shots = await uploadImages(scoped.photos);
        /* the column still points at the cover, so the three places that draw a
           single thumbnail keep working without knowing about the list */
        const photoPath = shots[0]?.path || "";
        try {
          result = await runServerMutation(async () => {
            const created = await createAsset({ ...scoped, photoPath });
            /* filed inside the mutation, so the reload that follows already
               shows the pictures and the paperwork rather than needing a
               second refresh */
            fileTrouble = [
              ...await settleImages(created.id, shots, []),
              ...await settleFiles(created.id, scoped.files, []),
            ];
            return created;
          });
        } catch (error) {
          /* nothing was filed, so everything just uploaded is an orphan */
          for (const shot of shots) if (shot.path) await deleteAssetPhoto(shot.path).catch(() => {});
          throw error;
        }
        setNotice(result?.asset_number ? `${result.asset_number} registered` : "Asset registered");
      }
      else if (name === "edit") {
        const shots = await uploadImages(scoped.photos);
        const photoPath = shots[0]?.path || "";
        await runServerMutation(async () => {
          const saved = await updateAsset(current.id, { ...current, ...scoped, photoPath });
          /* the picture this replaces is deleted only if it was taken out of
             the list - reordering must not destroy what it demoted */
          fileTrouble = [
            ...await settleImages(current.id, shots, current.images || []),
            ...await settleFiles(current.id, scoped.files, current.files || []),
          ];
          return saved;
        }, meta.changed?.length ? `${scoped.tag || current.tag} saved: ${meta.changed.join(", ")} changed` : "Asset updated.");
      }
      else if (name === "transfer") await runServerMutation(() => transferAsset(current, scoped), "Transfer recorded.");
      else if (name === "transferCart") {
        const picked = new Set(vals.picked || []);
        const moving = movableCart.filter((asset) => picked.has(asset.id));
        /* the surrounding catch is there to keep a rejected form open, and it
           swallows what it catches, so this says its piece itself */
        if (!moving.length) { setSaveErr("Tick at least one asset to move."); return; }
        await runServerMutation(() => transferAssets(moving, scoped));
        /* only what moved leaves the cart; anything left unticked is still
           waiting to go somewhere, and throwing it away would be a surprise */
        setCart((held) => held.filter((id) => !picked.has(id)));
        setNotice(`${moving.length} ${moving.length === 1 ? "transfer" : "transfers"} recorded.`);
      }
      else if (name === "retire") await runServerMutation(() => retireAsset(current.id, vals), "Asset retired with its history preserved.");
      else await runServerMutation(() => reinstateAsset(current.id, { ...vals, projectId: current.projectId }), "Asset returned to service.");
      /* the asset row is saved either way, so a document that would not go up
         is said out loud rather than left to be noticed weeks later */
      if (fileTrouble.length) {
        setSaveErr(`The asset was saved, but ${fileTrouble.join(" and ")} could not be filed. Open Edit details to try again.`);
      }
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

  /* The Upcoming tab of the Add Maintenance modal, not the generic Dialog: it
     stays open and shows the error banner on failure instead of closing. */
  const runAddMaintenanceSchedule = async (vals) => {
    if (!requirePermission("maintenance.manage", "changing maintenance schedules")) return;
    try {
      const tag = String(vals.assetTag).split(" — ")[0];
      const asset = assets.find((item) => item.tag === tag);
      if (!asset) throw new Error("The selected asset is no longer available.");
      await runServerMutation(() => createMaintenanceSchedule(asset.id, vals), "Maintenance schedule created.");
      setMaintenanceChoice(null);
    } catch { /* preserve the input; the modal stays open with the error shown */ }
  };

  /* The Historic tab. Anyone who manages maintenance may write a record up;
     changing or deleting one is the super admin's alone, and the server holds
     the same line. Resolves true when saved so the form can step back to the
     list, false when it did not so nothing typed is lost. */
  const runSaveMaintenanceRecord = async (recordId, assetId, vals) => {
    if (!requirePermission("maintenance.manage", "recording maintenance history")) return false;
    if (recordId && !isSuperAdmin) { setSaveErr("Only a super admin can change a historic maintenance record."); return false; }
    try {
      /* the files ride along with the form and are settled once the row is
         safely written; one that will not go up costs neither the record nor
         the others, and is named back so it can be added again */
      const before = recordId ? maintenanceRecords.find((r) => r.id === recordId)?.files || [] : [];
      const trouble = await runServerMutation(
        async () => {
          const saved = recordId ? await updateMaintenanceRecord(recordId, vals) : await createMaintenanceRecord(assetId, vals);
          return settleHistoryFiles(recordId || saved.id, vals.files, before);
        },
        recordId ? "Maintenance record updated." : "Maintenance record saved.",
      );
      if (trouble.length) setSaveErr(`The record was saved, but ${trouble.length === 1 ? "one file" : `${trouble.length} files`} could not be filed: ${trouble.join(", ")}. Open the record and add ${trouble.length === 1 ? "it" : "them"} again.`);
      return true;
    } catch { return false; }
  };
  /* the sheet takes the modal's place rather than stacking on it */
  const openEroForm = (record) => {
    const asset = assets.find((a) => a.id === record.assetId);
    if (!asset) return;
    setMaintenanceChoice(null);
    setEroView({ company: companies.find((company) => company.name === asset.company) || { name: asset.company || "" }, asset, record });
  };
  const runDeleteMaintenanceRecord = (record) => {
    if (!isSuperAdmin) return;
    const asset = assets.find((a) => a.id === record.assetId);
    setConfirm({
      title: "Delete this maintenance record?",
      body: `${asset ? `${asset.tag} · ` : ""}${maintenanceRecordTypeLabel(record.type)} started ${fmt(record.startedOn)}${record.eroCode ? `, ERO code ${record.eroCode}` : ""}. The record and its parts lines are removed for good.`,
      confirm: "Delete record",
      run: () => runServerMutation(() => deleteMaintenanceRecord(record.id), "Maintenance record deleted.").catch(() => {}),
    });
  };

  /* Someone who can see every company has no company of their own, so they
     choose the mark on everyone's behalf; anyone narrower is simply shown the
     register they work in. */
  const seesEveryCompany = isSuperAdmin || access?.all_companies === true;
  const headerCompany = useMemo(() => {
    if (!seesEveryCompany && allowedCompanies.length === 1) return allowedCompanies[0];
    return allowedCompanies.find((company) => company.isHeaderBrand) || null;
  }, [seesEveryCompany, allowedCompanies]);

  /* The sheet holds no typed input, so Escape is exactly its Cancel. */
  useEscapeKey(!!confirm, () => setConfirm(null));

  const runHeaderBrand = async (companyId) => {
    if (!requirePermission("companies.manage", "changing the workspace brand")) return;
    try { await runServerMutation(() => setCompanyHeaderBrand(companyId), companyId ? "Workspace brand updated." : "Workspace brand cleared."); }
    catch { /* the notice carries the reason */ }
  };

  /* Inserts only what the preview marked ready, one row at a time so a single
     rejected asset cannot take the rest of the batch down with it. Each row is
     mapped exactly the way the Register asset form maps its own. */
  const runAssetImport = async (rows) => {
    if (!requirePermission("asset.create", "importing assets")) return { added: 0, failed: [] };
    const failed = [];
    let added = 0;
    setSaving(true);
    setSaveErr("");
    for (const entry of rows) {
      const values = { ...entry.values, ...clearedVehicle(entry.values.category) };
      try {
        await createAsset({
          ...values,
          companyId: companyIdFor(values.company),
          categoryId: categoryIdFor(values.category),
          projectId: projectIdFor(values.project),
        });
        added += 1;
      } catch (error) {
        failed.push({ ...entry, reason: error.message || "Supabase rejected this row." });
      }
    }
    setSaving(false);
    await reloadOperationalData().catch(() => {});
    if (added) setNotice(`${added} asset${added === 1 ? "" : "s"} imported from Excel.`);
    return { added, failed };
  };

  const runPerson = async (name, vals) => {
    if (!requirePermission("people.manage", "changing responsible persons")) return;
    try {
      await runServerMutation(() => name === "addPerson" ? createPerson(vals) : updatePerson(dlg.personId, vals),
        name === "addPerson" ? "Responsible person added." : "Responsible person updated.");
      setDlg(null);
    } catch { /* preserve input */ }
  };

  const runBrand = async (name, vals) => {
    if (!requirePermission("brands.manage", "changing brands and models")) return;
    try {
      await runServerMutation(() => name === "addBrand" ? createBrand(vals) : updateBrand(dlg.brandId, vals),
        name === "addBrand" ? "Brand added." : "Brand updated.");
      setDlg(null);
    } catch { /* preserve input */ }
  };

  const runCompany = async (name, vals) => {
    if (!requirePermission("companies.manage", "changing companies")) return;
    const current = dlg.companyId ? companies.find((c) => c.id === dlg.companyId) : null;
    try {
      await runServerMutation(async () => {
        /* The field hands back a File when a new mark was picked, null when it
           was cleared, and the untouched URL when neither happened. Upload
           first so a storage failure stops before the row is written, and only
           delete the file it replaces once the row is safely saved. */
        const picked = vals.logo && typeof vals.logo !== "string" ? vals.logo : null;
        if (picked && picked.size > 2 * 1024 * 1024) throw new Error(`That logo is ${kb(picked.size)}. The limit is 2 MB — use a smaller image.`);
        const cleared = vals.logo === null || vals.logo === "";
        const logoPath = picked ? await uploadCompanyLogo(picked) : cleared ? "" : (current?.logoPath || "");
        const payload = { ...vals, logoPath };
        const saved = name === "addCompany" ? await createCompany(payload) : await updateCompany(dlg.companyId, payload);
        if (current?.logoPath && current.logoPath !== logoPath) await deleteCompanyLogo(current.logoPath);
        return saved;
      }, name === "addCompany" ? "Company created." : "Company updated.");
      setDlg(null);
    }
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
        /* Add parts and Parts needed carry the same list; only the second
           also moves the ticket on to awaiting parts. */
        const rows = (vals.parts || []).filter((row) => String(row.name || "").trim());
        if (!rows.length) { setSaveErr("Name at least one part."); return; }
        /* Each line is attempted on its own, so one part the server rejects
           does not cost the four beside it that were fine. */
        const failed = [];
        await runServerMutation(async () => {
          for (const row of rows) {
            try {
              /* a list line carries a quantity and the cost of one; the ticket
                 keeps how many and what the lot is estimated at */
              await createRepairPart(j.id, { ...row, qty: num(row.qty) || 1, estimated: partEstimate(row) || "", state: "Needed" });
            }
            catch (error) { failed.push({ name: String(row.name).trim(), error }); }
          }
          /* nothing landed at all - let the wrapper say so, keep the form open
             with what was typed, and leave the ticket's stage alone */
          if (failed.length === rows.length) throw failed[0].error;
          if (name === "needPart") await updateRepair(j.id, { stage: "parts" });
        });
        const saved = rows.length - failed.length;
        if (failed.length) setSaveErr(`${saved} of ${rows.length} parts were recorded. ${failed.map((one) => one.name).join(", ")} could not be saved.`);
        else setNotice(`${saved} ${saved === 1 ? "part" : "parts"} recorded.`);
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
    if (!requirePermission(DELETE_PERMISSION, "removing purchase receipts")) return;
    try { await runServerMutation(() => removeStoredReceipt(meta), "Receipt removed."); setViewer(null); }
    catch { /* viewer remains open */ }
  };

  const dropPart = async (jId, pId, part) => {
    if (!requirePermission(DELETE_PERMISSION, "removing repair parts")) return;
    try { await runServerMutation(async () => { if (part?.receipt) await removeStoredReceipt(part.receipt); await deleteRepairPart(pId); }, "Repair part removed."); }
    catch { /* server state is reloaded by the mutation wrapper */ }
  };

  /* ---------- files ---------- */
  const downloadImportReport = (report, source) => saveBlob(new Blob([JSON.stringify({ source, completedAt: new Date().toISOString(), ...report }, null, 2)], { type: "application/json" }), `legacy-import-report-${today()}.json`);
  const csv = (head, rows, name) => saveBlob(new Blob([CSV_BOM + createCsvContent(head, rows)], { type: "text/csv;charset=utf-8" }), name);
  /* One description of what the current tab exports, so the CSV and the
     workbook can never disagree about the columns. Returns null on a tab that
     has nothing of its own to export. */
  const exportTable = () => {
    if (tab === "transfers") return { name: `transfers-${today()}`, sheet: "Transfers",
      head: ["date", "asset", "name", "from_address", "to_address", "from_custodian", "to_custodian", "from_project", "to_project", "reason"],
      rows: movementsOf(allowedAssets).map(({ entry, asset }) => [entry.date, asset.tag, asset.name,
        entry.move?.fromLoc || "", entry.move?.toLoc || "", entry.move?.fromPer || "", entry.move?.toPer || "",
        projectLabel(entry.move?.fromProject), projectLabel(entry.move?.project), entry.move?.why || ""]) };
    if (tab === "repairs") return { name: `repairs-${today()}`, sheet: "Repairs",
      head: ["ticket", "asset", "name", "fault", "stage", "provider", "technician", "reported", "parts", "labour", "other", "total"],
      rows: allowedRepairs.map((r) => { const a = assetOf(r) || {}; return [r.ticket, a.tag, a.name, r.fault, r.closed ? "Closed" : STAGES[r.stage].label, r.provider, r.technician, r.date, partsTotal(r), num(r.labor), num(r.other), repairTotal(r)]; }) };
    if (tab === "parts") return { name: `parts-${today()}`, sheet: "Parts",
      head: ["ticket", "asset", "part", "status", "qty", "unit_price", "line_total", "supplier", "reference", "date", "receipt"],
      rows: allowedRepairs.flatMap((r) => (r.parts || []).map((p) => { const a = assetOf(r) || {};
        return [r.ticket, a.tag, p.name, p.state, num(p.qty) || 1, num(p.unit), num(p.unit) * (num(p.qty) || 1), p.supplier, p.ref, p.date, p.receipt ? p.receipt.name : "none"]; })) };
    if (tab === "maintenance") return { name: `maintenance-${today()}`, sheet: "Maintenance",
      head: ["asset", "name", "schedule", "every", "next_due", "status", "last_done", "provider", "times_done", "total_spent"],
      rows: allowedPlans.map((p) => { const a = allowedAssets.find((x) => x.id === p.assetId) || {}; return [a.tag, a.name, p.name, everyLabel(p), p.nextDue, dueOf(p).label, p.lastDone || "", p.provider, (p.done || []).length, planSpend(p)]; }) };
    if (!["assets", "map"].includes(tab)) return null;
    /* `shown`, not every asset in scope: the menu entry promises "Assets in
       your current view", and until now it quietly ignored the search box and
       the status filter and exported the lot. */
    return { name: `assets-${today()}`, sheet: "Assets",
      head: ["tag", "asset_code", "company", "project_location", "name", "category", "brand", "model", "serial_or_chassis", "engine_no", "plate_no", "mv_file_no", "conduction_sticker", "body_no", "address", "custodian", "acquired", "cost", "availability", "asset_image", "attachments", "attachment_types", "notes"],
      rows: shown.map((a) => [a.tag, a.code, a.company, a.project || NO_PROJECT, a.name, a.category, a.brand, a.model, a.serial, a.engine, a.plate, a.mvFile, a.conduction, a.body, a.location, a.custodian, a.acquired, a.cost, availOf(a, openJob(a.id)).label,
        /* whether anyone can tell this machine apart on sight, and what
           paperwork says it is the company's - the two things the register
           holds that a column of numbers cannot show */
        a.photoUrl ? "Yes" : "No",
        (a.files || []).length ? "Yes" : "No",
        docTypeSummary(a.files),
        a.notes]) };
  };

  /* Every way out of here reports what happened. An export that quietly
     produced nothing - no file, no message - is indistinguishable from a dead
     button, so anything that goes wrong is said out loud instead. */
  const runExport = (kind) => {
    if (!requirePermission("reports.export", "exporting data")) return;
    try {
      const table = exportTable();
      if (!table) return setSaveErr("This tab has nothing of its own to export.");
      if (!table.rows.length) return setSaveErr("There is nothing in the current view to export. Clear the search or filters and try again.");
      if (kind === "xlsx") saveBlob(buildWorkbook(table.head, table.rows, table.sheet), `${table.name}.xlsx`);
      else csv(table.head, table.rows, `${table.name}.csv`);
      setNotice(`${table.rows.length} ${table.rows.length === 1 ? "row" : "rows"} exported as ${kind === "xlsx" ? "Excel" : "CSV"}.`);
    } catch (error) {
      setSaveErr(`The export could not be produced: ${error.message || error}`);
    }
  };
  const exportCsv = () => runExport("csv");
  const exportXlsx = () => runExport("xlsx");
  const exportJson = async () => {
    if (!isSuperAdmin) return setSaveErr("Only a Super Admin can export the complete authorized register.");
    saveBlob(new Blob([JSON.stringify({ source: "supabase", exportedAt: new Date().toISOString(), assets, repairs, plans, companies, categories, projects, receiptFiles: "Stored privately in Supabase Storage; export contains metadata only." }, null, 2)], { type: "application/json" }), `supabase-register-backup-${today()}.json`);
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

  const pickLegacyFile = useCallback(() => fileRef.current?.click(), []);

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

  const partOf = (d) => {
    const j = repairs.find((r) => r.id === d.jobId);
    return (j?.parts || []).find((p) => p.id === d.partId) || {};
  };
  const dlgDef = dlg && (dlg.kind === "asset" ? ASSET_ACTIONS[dlg.name] : dlg.kind === "repair" ? REPAIR_ACTIONS[dlg.name] : dlg.kind === "part" ? PART_ACTIONS[dlg.name] : dlg.kind === "person" ? PERSON_ACTIONS[dlg.name] : dlg.kind === "brand" ? BRAND_ACTIONS[dlg.name] : dlg.kind === "company" ? COMPANY_ACTIONS[dlg.name] : dlg.kind === "category" ? CATEGORY_ACTIONS[dlg.name] : dlg.kind === "project" ? PROJECT_ACTIONS[dlg.name] : PLAN_ACTIONS[dlg.name]);
  const dlgSubject = dlg && (dlg.kind === "project"
    ? (dlg.projectId ? projects.find((x) => x.id === dlg.projectId) : {})
    : dlg.kind === "category"
    ? (dlg.categoryId ? categories.find((c) => c.id === dlg.categoryId) : {})
    : dlg.kind === "person"
    ? (dlg.personId ? people.find((person) => person.id === dlg.personId) : {})
    : dlg.kind === "brand"
    ? (dlg.brandId ? brands.find((brand) => brand.id === dlg.brandId) : {})
    : dlg.kind === "company"
    ? (dlg.companyId ? companies.find((c) => c.id === dlg.companyId) : {})
    : dlg.kind === "part"
    ? (["addPart", "needPart"].includes(dlg.name) ? (() => {
        /* Opened from inside one ticket's own detail view, the part is
           obviously for that ticket, so the field is locked to it rather
           than left open to picking a different one. Opened from the Parts
           tab's own "Add part" - no ticket in context - it stays a normal,
           freely chosen dropdown. */
        if (!dlg.jobId) return { ticket: "" };
        const j = repairs.find((r) => r.id === dlg.jobId);
        if (!j) return { ticket: "" };
        const a = assets.find((x) => x.id === j.assetId);
        return { ticket: `${j.ticket} · ${a?.tag || "?"} · ${j.fault}`, ticketLocked: true };
      })() : partOf(dlg))
    : dlg.kind === "plan"
    ? (dlg.planId ? plans.find((p) => p.id === dlg.planId) : { assetTag: current ? `${current.tag} — ${current.name}` : "" })
    : dlg.kind === "asset" ? (dlg.name === "register" ? null : dlg.name === "transferCart" ? { cart: movableCart } : current) : assets.find((a) => a.id === dlg.assetId));
  const dlgHeader = dlg && (() => {
    if (["company", "category", "project", "brand"].includes(dlg.kind)) return null;
    if (dlg.kind === "part") {
      const j = repairs.find((r) => r.id === dlg.jobId);
      const a = j && assets.find((x) => x.id === j.assetId);
      return j ? `${j.ticket} · ${a?.tag || ""} · ${partOf(dlg).name || ""}` : null;
    }
    if (dlg.kind === "asset" && dlg.name === "transferCart") return `${movableCart.length} ${movableCart.length === 1 ? "asset" : "assets"} in the cart`;
    const a = dlg.kind === "plan" && dlg.planId ? assets.find((x) => x.id === plans.find((p) => p.id === dlg.planId)?.assetId)
      : dlg.kind === "repair" ? assets.find((x) => x.id === dlg.assetId) : (dlg.name === "register" ? null : current);
    return a ? `${a.tag} · ${a.name}` : null;
  })();
  const tabs = [
    ["assets", "Assets", ClipboardList, allowedAssets.length, C.ink, can("asset.view")],
    ["cart", "Transfer cart", ShoppingBasket, cartAssets.length, C.ink, can("asset.transfer")],
    ["transfers", "Transfers", ArrowLeftRight, transferCount, C.ink, can("asset.view")],
    ["repairs", "Repairs", Wrench, openTickets.length, STAGES.ongoing.color, can("repair.view")],
    ["parts", "Parts", ShoppingCart, pendingParts, PART_COLOR.Ordered, can("parts.view")],
    ["maintenance", "Maintenance", CalendarClock, duePlans.length, C.due, can("maintenance.view")],
    ["map", "Asset Map", MapIcon, null, C.ink, can("map.view")],
    ["reports", "Reports", BarChart3, null, C.ink, can("reports.view") || can("reports.purchasing")],
    ["settings", "Settings", Settings, null, C.ink, isSuperAdmin],
    ["users", "User Management", Users, null, C.active, can("users.manage") && isSuperAdmin],
  ].filter((entry) => entry[5]);

  /* Exports and imports are occasional and mutually exclusive in intent,
     so they belong in one menu rather than four buttons beside the one
     action most people opened this page to take. */
  /* exportCsv already follows the tab; this is the menu entry that describes
     what it will actually produce. Tabs that are not listed export nothing of
     their own - Reports has its own exports, and Settings and User Management
     have no view to export - so the entry stays out of their way. */
  const csvScope = {
    assets: { label: "Export assets CSV", hint: "Assets in your current view" },
    map: { label: "Export assets CSV", hint: "Assets in your current view" },
    transfers: { label: "Export transfers CSV", hint: "Every movement, oldest to newest" },
    repairs: { label: "Export repairs CSV", hint: "Repair tickets, costs and stages" },
    parts: { label: "Export parts CSV", hint: "Repair parts, suppliers and receipts" },
    maintenance: { label: "Export maintenance CSV", hint: "Schedules, next due dates and spend" },
  }[tab];

  const dataActions = [
    ...(can("reports.export") && csvScope
      ? [{ key: "csv", icon: Download, label: csvScope.label, hint: csvScope.hint, onClick: exportCsv },
         { key: "xlsx", icon: Layers, label: csvScope.label.replace("CSV", "Excel"), hint: `${csvScope.hint} — opens straight into Excel`, onClick: exportXlsx }] : []),
    /* Populating the register from a spreadsheet is an asset job, so it lives
       with the assets and stays clear of the JSON legacy restore below. */
    ...(tab === "assets" && can("asset.create")
      ? [{ key: "excel", icon: Layers, label: "Import assets from Excel", hint: "Add new assets from a workbook", onClick: () => setAssetImport(true), disabled: saving }] : []),
    ...(isSuperAdmin
      ? [{ key: "backup", icon: Archive, label: "Download backup", hint: "Whole register as JSON", onClick: exportJson },
        { key: "legacy", icon: Upload, label: "Import legacy file", hint: "A JSON backup from disk", onClick: pickLegacyFile, disabled: saving }] : []),
    ...(isSuperAdmin && legacyBrowserData?.snapshot
      ? [{ key: "found", icon: Layers, label: `Import ${legacyBrowserData.source} data`, hint: "Found on this device", onClick: importDiscoveredBrowserData, disabled: saving }] : []),
  ];
  const identity = {
    name: access?.full_name || currentUser?.email || "Signed in",
    email: currentUser?.email,
    role: access?.role_name || "Team member",
    isSuperAdmin,
  };
  /* Every change is written to Supabase as it is made, so the bar only has to
     say whether the last one is still on its way, failed, or arrived. */
  const saveState = saving ? { state: "busy", text: "Saving…" }
    : refreshing ? { state: "busy", text: "Refreshing…" }
      : saveErr ? { state: "error", text: "Not saved" }
        : { state: "ok", text: "Saved" };
  /* a record drawer belongs to the Assets page, so leaving the page closes it */
  const selectTab = (key) => { setTab(key); setJob(null); setSel(null); };
  /* what the buttons in the asset record ask for */
  const assetAction = (name, arg) => {
    if (!current) return;
    if (name === "transfer") setDlg({ kind: "asset", name: "transfer" });
    else if (name === "cart") askAddToCart(current);
    else if (name === "fault") setDlg({ kind: "repair", name: "open", assetId: current.id });
    else if (name === "retire") setDlg({ kind: "asset", name: "retire" });
    else if (name === "edit") setDlg({ kind: "asset", name: "edit" });
    else if (name === "reinstate") setDlg({ kind: "asset", name: "reinstate" });
    else if (name === "ticket") { setTab("repairs"); setJob(arg); }
    else if (name === "schedule") setMaintenanceChoice({ lockedAssetTag: `${current.tag} — ${current.name}` });
    else if (name === "logPlan") setDlg({ kind: "plan", name: "logPlan", planId: arg });
    else if (name === "forms") setFormsFor(current);
    else if (name === "images") {
      const shots = current.images?.length ? current.images : [{ id: "cover", url: current.photoUrl }];
      setGallery({ items: imageItems(shots, current), at: arg });
    }
    else if (name === "documents") setGallery({ items: documentItems(current.files), at: arg, resolve: getAssetAttachmentUrls });
    else if (name === "delete") setConfirm({
      title: `Delete ${current.tag}?`,
      body: "This erases the record, its custody trail, repair tickets, and schedules for good. To keep the history instead, retire the asset.",
      confirm: "Delete permanently",
      run: async () => {
        if (!requirePermission(DELETE_PERMISSION, "deleting an asset")) return;
        try {
          const receipts = repairs.filter((repair) => repair.assetId === sel).flatMap((repair) => repair.parts || []).map((part) => part.receipt).filter(Boolean);
          await runServerMutation(async () => { for (const receipt of receipts) await removeStoredReceipt(receipt); await deleteAsset(sel); }, "Asset permanently deleted.");
          setSel(null);
        } catch { /* the server state has been reloaded */ }
      },
    });
  };
  /* The register form belongs to the register: offering it from Settings or
     User Management only invited the question of what it would do there. Every
     other tab already carries its own add control - Add part, Add schedule,
     Add company - and repairs start from an asset by design. */
  const primaryAction = can("asset.create") && tab === "assets"
    ? { icon: Plus, img: "/icon/Add%20asset.png", label: "Register asset", disabled: saving, onClick: () => setDlg({ kind: "asset", name: "register" }) }
    : null;

  return (
    <div className="ams-shell" style={{ fontFamily: SANS }}>
      <style>{CHROME_CSS}</style>
      <RegisterSidebar tabs={tabs} tab={tab} onTab={selectTab} />

      <main className="ams-main">
        <RegisterTopbar
        tabs={tabs} tab={tab} save={saveState} identity={identity} onSignOut={onSignOut}
        companyNames={ctx.companyNames} company={comp} onCompany={setComp} brand={headerCompany}
        onRefresh={() => reloadOperationalData().catch(() => {})}
        refreshing={refreshing} busy={saving} dataActions={dataActions}
        primary={primaryAction}
        />
        <input ref={fileRef} type="file" accept="application/json" className="hidden" onChange={importJson} />

        {loadErr && <div className="px-5 py-2 text-center" style={{ background: STAGES.broken.tint, color: STAGES.broken.color, fontSize: 13 }}>{loadErr} <button className="underline ml-2" onClick={() => reloadOperationalData().catch(() => {})}>Retry</button></div>}
        {legacyBrowserData?.error && <div className="px-5 py-2 text-center" style={{ background: TINT.warn, color: C.due, fontSize: 13 }}>Legacy {legacyBrowserData.source} data was found but could not be parsed: {legacyBrowserData.error}. Nothing was deleted.</div>}
        <div id="ams-panel" role="region" aria-labelledby={`ams-nav-${tab}`} className="ams-content">
        {tab === "assets" && (<>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 mb-4">
            {[
              ["all", "Total assets", totals.all, { src: "/icon/Asset%20DB.png", mask: true }, C.brandDeep, TINT.brand,
                "Every asset on the register",
                mix.map(([mk, n, color, label]) => [mk, label, n, color])],
              ["active", "Active", totals.active, { src: "/icon/Active.png", mask: true }, C.ok, TINT.ok,
                "Available for daily operations",
                [["active", "Available", totals.active, C.ok],
                 ["rest", "Unavailable", totals.out + totals.retired, C.retired]]],
              ["out", "Broken", totals.out, { src: "/icon/Repair.png", mask: false }, STAGES.broken.color, TINT.alarm,
                openStages.length > 0 ? "Out of service and in the repair flow" : "Nothing is out of service",
                openStages.map((st) => [st, cap(STAGE_SHORT[st]), stageMix[st], STAGES[st].color])],
            ].map(([k, label, value, icon, tone, tint, context, legend]) => {
              const selected = filter === k;
              /* the change across the trend's 12 weeks. Whether up is good
                 depends on the tile: more active is good, more broken is bad,
                 and the register simply growing is neither. The arrow and the
                 words carry the direction, so it never rests on colour. */
              const points = trend.map((p) => ({ date: p.date, value: p[k] }));
              const change = points.length ? points[points.length - 1].value - points[0].value : 0;
              const upIsGood = { all: 0, active: 1, out: -1 }[k];
              const mood = change === 0 || upIsGood === 0 ? "flat" : (change > 0) === (upIsGood > 0) ? "good" : "bad";
              const changeText = change === 0 ? "No change in 12 wks" : `${change > 0 ? "▲" : "▼"} ${metric(Math.abs(change))} in 12 wks`;
              const noun = { all: "assets", active: "active", out: "out of service" }[k];
              return (
                <button key={k} type="button" className="ams-stat" aria-pressed={selected}
                  aria-label={`${label}: ${metric(value)}. ${context}. ${change === 0 ? "No change" : `${change > 0 ? "Up" : "Down"} ${metric(Math.abs(change))}`} over the last 12 weeks. ${selected ? "Current filter" : "Select to filter assets"}.`}
                  style={{ "--c": tone, "--tint": tint }} onClick={() => setFilter(k)}>
                  <span className="ams-stat-icon" aria-hidden="true">
                    {icon.mask
                      ? <span className="ams-stat-glyph" style={{ "--glyph": `url("${icon.src}")` }} />
                      : <img className="ams-stat-art" src={icon.src} alt="" />}
                  </span>
                  <span className="ams-stat-main">
                    <span className="ams-stat-label">{label}</span>
                    <span className="ams-stat-v">{metric(value)}</span>
                  </span>
                  {selected && <span className="ams-stat-tag" data-state="1"><span className="ams-stat-view" aria-hidden="true" />Viewing</span>}
                  <div className="ams-stat-c">
                    <span className="ams-stat-ctx">{context}</span>
                    <span className="ams-stat-delta" data-mood={mood} aria-hidden="true">{changeText}</span>
                  </div>
                  <TileTrend points={points} noun={noun} />
                  {/* always rendered, empty or not, so one card without a
                      legend cannot drop its trend out of line with the others */}
                  <div className="ams-legend" aria-hidden="true">
                    {legend.map(([lk, lLabel, n, color]) => (
                      <span key={lk} className="ams-legend-item">
                        <span className="ams-legend-dot" style={{ "--d": color }} />
                        {lLabel}<span className="ams-legend-n">{metric(n)}</span>
                      </span>
                    ))}
                  </div>
                </button>
              );
            })}
          </div>
          <div className="flex flex-wrap items-center gap-2 mb-3">
            <div className="relative flex-1" style={{ minWidth: 240 }}>
              <Search size={15} style={{ color: C.mute, position: "absolute", left: 11, top: 13 }} />
              <input value={q} onChange={(e) => handleAssetQuery(e.target.value)} placeholder="Scan a QR code, or search tag, name, serial, body no., location, person"
                style={{ ...inputStyle, paddingLeft: 32 }} />
            </div>
            <Btn icon={QrCode} onClick={() => setScanning("assets")}>Scan</Btn>
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

          {/* Every asset as a row under a header, as in the reference build; a
              row opens its record in the drawer, by click or by Enter. */}
          <div className="ams-panel">
            {allowedAssets.length === 0 ? (
              <div className="ams-empty">
                <div className="ams-empty-title">No assets registered yet</div>
                {can("asset.create")
                  ? <Btn kind="solid" icon={Plus} onClick={() => setDlg({ kind: "asset", name: "register" })}>Register asset</Btn>
                  : <div className="ams-empty-sub">Ask a Super Admin to review your company and asset-group assignments.</div>}
              </div>
            ) : shown.length === 0 ? (
              <div className="ams-empty">
                <div className="ams-empty-title">No assets match these filters</div>
                <Btn icon={X} onClick={() => { setQ(""); setCat(""); setLoc(""); setComp(""); setFilter("all"); }}>Clear filters</Btn>
              </div>
            ) : (
              <div className="ams-tblwrap">
                <table className="ams-tbl">
                  <thead><tr>
                    <th>Asset no.</th><th>Asset</th><th>Company</th><th>Project/Location</th>
                    <th>Responsible person</th><th>Availability</th>
                    <th><span className="sr-only">Maintenance due</span></th>
                  </tr></thead>
                  <tbody>
                    {shown.map((a) => {
                      const s = availOf(a, openJob(a.id));
                      const dueHere = plansOf(a.id).filter((p) => daysUntil(p.nextDue) <= 30).sort((x, y) => dueOf(x).rank - dueOf(y).rank)[0];
                      const left = dueHere ? daysUntil(dueHere.nextDue) : null;
                      return (
                        <tr key={a.id} className="ams-tbl-click" tabIndex={0} onClick={() => setSel(a.id)}
                          onKeyDown={(e) => { if (e.key === "Enter") setSel(a.id); }}>
                          <td><RecordTag>{a.tag}</RecordTag></td>
                          <td><span className="ams-tbl-strong">{a.name}</span><span className="ams-tbl-sub">{a.category || "No category"}</span></td>
                          <td>{a.company || <span className="ams-tbl-sub">Not recorded</span>}</td>
                          <td>{a.project || NO_PROJECT}<span className="ams-tbl-sub">{a.location}</span></td>
                          <td>{a.custodian}</td>
                          <td><span className="ams-chip" style={{ "--c": s.color }}><span className="ams-chip-dot" />{s.label}</span></td>
                          <td>
                            {dueHere && (
                              <span className="ams-due" style={{ color: dueOf(dueHere).color }} title={`${dueHere.name} due ${fmt(dueHere.nextDue)}`}>
                                <CalendarClock size={14} aria-hidden="true" />{left < 0 ? "Overdue" : left === 0 ? "Today" : `${left} d`}
                              </span>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
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
            onAdd={() => setMaintenanceChoice({ lockedAssetTag: "" })}
            onLog={(id) => setDlg({ kind: "plan", name: "logPlan", planId: id })}
            onEdit={(id) => setDlg({ kind: "plan", name: "editPlan", planId: id })}
            onDelete={(p) => setConfirm({ title: `Delete "${p.name}"?`, body: "The schedule and its completed-maintenance records go with it. Costs already recorded will drop out of reports.", confirm: "Delete schedule", run: () => runServerMutation(() => deleteMaintenanceSchedule(p.id), "Maintenance schedule deleted.").catch(() => {}) })}
            canManage={can("maintenance.manage")}
            canDelete={can(DELETE_PERMISSION)}
            onOpenAsset={(id) => { setTab("assets"); setSel(id); }} />
        )}

        {tab === "map" && (
          <AssetMap assets={allowedAssets} projects={projects} companies={allowedCompanies} categoryNames={ctx.categoryNames}
            openJob={openJob} onOpenAsset={(id) => { setTab("assets"); setSel(id); }} />
        )}

        {tab === "settings" && isSuperAdmin && (
          <SettingsTab companies={companies} categories={categories} projects={ctx.projects} people={people} brands={brands} assets={assets}
            canSetBrand={seesEveryCompany}
            numbering={numbering} nextTag={issuedTag} nextTransfer={nextTransfer}
            on={(action, id, item, n) => {
              if (action === "setBrand") return runHeaderBrand(id);
              if (action === "saveNumbering") {
                const isAsset = id === "asset";
                const show = (value) => `${isAsset ? "AST-" : "TR "}${formatSequenceNumber(value, { width: String(item.start).length })}`;
                return setConfirm({
                  title: `Change the ${isAsset ? "asset" : "transfer"} numbering sequence?`,
                  body: isAsset
                    ? `Asset numbers will be written like ${show(item.start)} and stop at ${show(item.end)}. Numbering carries on from where it is now, never lower than ${show(item.start)}. Every number the register issued itself (AST- followed by digits) is rewritten in the new style; numbers in any other shape, typed or imported, stay as they are.`
                    : `Transfer numbers will be written like ${show(item.start)} and stop at ${show(item.end)}. Numbering carries on from where it is now, never lower than ${show(item.start)}. Transfers already recorded keep their number and are shown in the new style.`,
                  confirm: "Save sequence",
                  /* Not through runServerMutation: a refusal here is written for
                     the admin - the tags in the way, the pair that would collide -
                     so it comes back in this same dialog rather than as the
                     generic banner. */
                  run: async () => {
                    setSaving(true); setSaveErr("");
                    try {
                      await saveNumberingSequence(id, item);
                      await reloadOperationalData();
                      setNotice("Numbering sequence saved.");
                    } catch (error) {
                      setConfirm({ title: "Numbering sequence not saved", body: error.message || "Supabase rejected the change. Nothing was renumbered.", blocked: true });
                    } finally {
                      setSaving(false);
                    }
                  },
                });
              }
              if (action === "clearBrand") return runHeaderBrand(null);
              if (action === "addCompany") return setDlg({ kind: "company", name: "addCompany" });
              if (action === "editCompany") return setDlg({ kind: "company", name: "editCompany", companyId: id });
              if (action === "addBrand") return setDlg({ kind: "brand", name: "addBrand" });
              if (action === "editBrand") return setDlg({ kind: "brand", name: "editBrand", brandId: id });
              if (action === "deleteBrand") {
                return setConfirm(n > 0
                  ? { title: `${item.name} is in use`, body: `${n} asset${n > 1 ? "s are" : " is"} registered as this make. Change them first, or rename this brand instead of deleting it.`, blocked: true }
                  : { title: `Delete ${item.name}?`, body: "Its models go with it. No assets carry this make, so nothing else is affected.", confirm: "Delete brand",
                      run: () => requirePermission(DELETE_PERMISSION, "deleting a brand")
                        && runServerMutation(() => deleteBrand(id), "Brand removed.").catch(() => {}) });
              }
              if (action === "addCategory") return setDlg({ kind: "category", name: "addCategory" });
              if (action === "editCategory") return setDlg({ kind: "category", name: "editCategory", categoryId: id });
              if (action === "addProject") return setDlg({ kind: "project", name: "addProject" });
              if (action === "importProjects") return setDlg({ kind: "project", name: "importProjects" });
              if (action === "editProject") return setDlg({ kind: "project", name: "editProject", projectId: id });
              if (action === "addPerson") return setDlg({ kind: "person", name: "addPerson" });
              if (action === "editPerson") return setDlg({ kind: "person", name: "editPerson", personId: id });
              if (action === "deletePerson") {
                return setConfirm(n > 0
                  ? { title: `${item.name} still holds assets`, body: `${n} asset${n > 1 ? "s are" : " is"} signed out to this person. Transfer them to someone else first.`, blocked: true }
                  : { title: `Remove ${item.name}?`, body: "No assets are signed out to them, so nothing else is affected.", confirm: "Remove person",
                      run: () => requirePermission(DELETE_PERMISSION, "deleting a responsible person")
                        && runServerMutation(() => deletePerson(id), "Responsible person removed.").catch(() => {}) });
              }
              if (action === "deleteProject") {
                return setConfirm(n > 0
                  ? { title: `${item.pid} is in use`, body: `${n} asset${n > 1 ? "s are" : " is"} recorded against it. Transfer them elsewhere first.`, blocked: true }
                  : { title: `Delete ${item.pid}?`, body: "No assets are on it, so nothing else is affected.", confirm: "Delete",
                      run: () => requirePermission(DELETE_PERMISSION, "deleting a project/location")
                        && runServerMutation(() => deleteProject(id), "Project/location deleted.").catch(() => {}) });
              }
              const isCo = action === "deleteCompany";
              const word = isCo ? "company" : "category";
              setConfirm(n > 0
                ? { title: `${item.name} is in use`, body: `${n} asset${n > 1 ? "s are" : " is"} filed under this ${word}. Move them across first, or rename this one instead of deleting it.`, blocked: true }
                : { title: `Delete ${item.name}?`, body: `No assets use this ${word}, so nothing else is affected.`, confirm: `Delete ${word}`,
                    run: () => requirePermission(DELETE_PERMISSION, `deleting a ${word}`)
                      && runServerMutation(() => isCo ? deleteCompany(id) : deleteCategory(id), `${isCo ? "Company" : "Asset group"} deleted.`).catch(() => {}) });
            }} />
        )}

        {/* the asset itself is reached from inside the movement, which is what
            a row opens */}
        {tab === "cart" && (
          <TransferCartTab
            assets={cartAssets}
            movable={movableCart}
            statusOf={(asset) => availOf(asset, openJob(asset.id))}
            onOpen={(id) => { setSel(id); setTab("assets"); }}
            onRemove={toggleCart}
            onClear={clearCart}
            onTransfer={() => setDlg({ kind: "asset", name: "transferCart" })}
            /* the same sheet the dialog prints, with the destination left
               ruled and empty: what a yard carries round to collect the
               machines before anyone has said where they are going */
            onPrint={() => printTransferForm({
              company: companies.find((company) => company.name === movableCart[0]?.company) || { name: movableCart[0]?.company || "" },
              asset: movableCart[0] || {},
              movement: {
                date: today(), releasedBy: ctx.userName, number: "",
                items: movableCart.map((asset) => transferFormItem(asset, { date: today() })),
              },
            })}
          />
        )}

        {tab === "transfers" && (
          <TransfersTab assets={allowedAssets}
            onOpenDetails={(id) => setTransferId(id)}
            onScan={() => setScanning("transfers")}
            onForm={formActions} />
        )}

        {tab === "reports" && <ReportsTab assets={allowedAssets} repairs={allowedRepairs} plans={allowedPlans} ctx={ctx} csv={csv} openJob={openJob} purchasingOnly={!can("reports.view")} />}

        {tab === "users" && isSuperAdmin && can("users.manage") && <UserManagement />}
        </div>
      </main>

      {tab === "assets" && current && (
        <AssetDrawer key={current.id} asset={current} job={openJob(current.id)}
          repairs={allowedRepairs.filter((r) => r.assetId === current.id)} plans={plansOf(current.id)}
          can={can} csv={csv} inCart={inCart(current.id)} cartable={cartable(current)}
          onClose={() => setSel(null)} onAction={assetAction} />
      )}

      {/* What the last action did, bottom right: a light plate for news, red
          for a change that did not go through. Each stays until it is closed
          or the next one replaces it. */}
      {(notice || saveErr) && (
        <div className="ams-toasts">
          {saveErr && (
            <div key={`e:${saveErr}`} className="ams-toast" data-tone="error" role="alert">
              <AlertCircle size={16} style={{ flexShrink: 0, marginTop: 1 }} />
              <span className="min-w-0 flex-1">{saveErr}</span>
              <button type="button" className="ams-toast-x" onClick={() => setSaveErr("")} aria-label="Dismiss"><X size={14} /></button>
            </div>
          )}
          {notice && (
            <div key={`n:${notice}`} className="ams-toast" role="status">
              <CheckCircle2 size={16} style={{ flexShrink: 0, marginTop: 1, color: C.ok }} />
              <span className="min-w-0 flex-1">{notice}</span>
              <button type="button" className="ams-toast-x" onClick={() => setNotice("")} aria-label="Dismiss"><X size={14} /></button>
            </div>
          )}
        </div>
      )}

      {dlg && dlg.kind === "asset" && ["register", "edit"].includes(dlg.name) && (
        <div className="ams-overlay"><AssetForm mode={dlg.name} asset={dlg.name === "edit" ? current : null} ctx={ctx} busy={saving}
          serverError={saveErr} onCancel={() => setDlg(null)} onSubmit={(vals, meta) => runAsset(dlg.name, vals, meta)} /></div>
      )}
      {dlg && !(dlg.kind === "asset" && ["register", "edit"].includes(dlg.name)) && <div className="ams-overlay"><Dialog def={dlgDef} subject={dlgSubject} header={dlgHeader} ctx={ctx} busy={saving} onCancel={() => setDlg(null)}
        onSubmit={(vals) => dlg.kind === "asset" ? runAsset(dlg.name, vals) : dlg.kind === "repair" ? runRepair(dlg.name, vals) : dlg.kind === "part" ? runPart(dlg.name, vals) : dlg.kind === "person" ? runPerson(dlg.name, vals) : dlg.kind === "brand" ? runBrand(dlg.name, vals) : dlg.kind === "company" ? runCompany(dlg.name, vals) : dlg.kind === "category" ? runCategory(dlg.name, vals) : dlg.kind === "project" ? runProject(dlg.name, vals) : runPlan(dlg.name, vals)} /></div>}

      {assetImport && (
        <div className="ams-overlay">
          <AssetImportDialog def={ASSET_ACTIONS.register} ctx={ctx} existing={allowedAssets} busy={saving}
            onCancel={() => setAssetImport(false)} onImport={runAssetImport} />
        </div>
      )}

      {transferView && (
        <div className="ams-overlay">
          <TransferDetails view={transferView} busy={saving} canAttach={can("asset.transfer")} canDetach={can(DELETE_PERMISSION)}
            onClose={() => setTransferId(null)}
            onOpenAsset={(id) => { setTransferId(null); setSel(id); setTab("assets"); }}
            onAttach={attachTransferForm}
            onOpenFile={(file) => setViewer({ meta: file, kind: "transfer" })}
            onRenameFile={renameTransferForm}
            onDetachFile={detachTransferForm}
            onForm={formActions} />
        </div>
      )}

      {scanning && (
        <div className="ams-overlay">
          <QrScanner title={scanning === "transfers" ? "Scan a transfer form" : "Scan an asset code"}
            onResult={followScan} onClose={() => setScanning(null)} />
        </div>
      )}

      {formsFor && (
        <div className="ams-overlay">
          <TransferFormsDialog asset={formsFor} movements={movementsOf([formsFor]).map(({ entry }) => entry)}
            onClose={() => setFormsFor(null)}
            onView={(entry) => formActions.view(entry, formsFor)}
            onPrint={(entry) => formActions.print(entry, formsFor)}
            onDownload={(entry) => formActions.download(entry, formsFor)}
            onOpenTransfer={(id) => { setFormsFor(null); setTab("transfers"); setTransferId(id); }} />
        </div>
      )}

      {formView && (
        <div className="ams-overlay">
          <TransferFormViewer data={formView} onClose={() => setFormView(null)} />
        </div>
      )}

      {eroView && (
        <div className="ams-overlay">
          <EroFormViewer data={eroView} onClose={() => setEroView(null)} />
        </div>
      )}

      {scanMiss && (
        <div className="ams-overlay ams-scrim fixed inset-0 z-50 flex items-center justify-center p-6">
          <div role="alertdialog" aria-modal="true" aria-labelledby="ams-sticker-title"
            className="p-5" style={{ maxWidth: 420, background: C.surface, borderRadius: 2 }}>
            <div id="ams-sticker-title" style={{ fontSize: 16, fontWeight: 600 }}>That asset is not on your register</div>
            <div style={{ fontSize: 13.5, color: C.mute, marginTop: 6, lineHeight: 1.5 }}>
              The code you scanned — <span style={{ fontFamily: MONO }}>{scanMiss}</span> — is either not registered, or belongs to a company you do not have access to.
            </div>
            <div className="flex justify-end mt-5"><Btn kind="solid" onClick={() => setScanMiss("")}>Close</Btn></div>
          </div>
        </div>
      )}

      {transferMissing && (
        <div className="ams-overlay ams-scrim fixed inset-0 z-50 flex items-center justify-center p-6">
          <div role="alertdialog" aria-modal="true" aria-labelledby="ams-scan-title"
            className="p-5" style={{ maxWidth: 420, background: C.surface, borderRadius: 2 }}>
            <div id="ams-scan-title" style={{ fontSize: 16, fontWeight: 600 }}>That transfer is not on your register</div>
            <div style={{ fontSize: 13.5, color: C.mute, marginTop: 6, lineHeight: 1.5 }}>
              The form you scanned records a movement for a company you do not have access to. Ask someone who covers that company to file the signed copy.
            </div>
            <div className="flex justify-end mt-5"><Btn kind="solid" onClick={() => setTransferId(null)}>Close</Btn></div>
          </div>
        </div>
      )}

      {gallery && <div className="ams-overlay">
        <MediaGallery items={gallery.items} at={gallery.at} resolve={gallery.resolve} onClose={() => setGallery(null)} />
      </div>}

      {viewer && <div className="ams-overlay"><ReceiptViewer meta={viewer.meta || viewer}
        onClose={() => { const back = viewer.returnTo; setViewer(null); if (back) setMaintenanceChoice(back); }}
        open={viewer.kind === "transfer" ? getTransferAttachmentUrl : viewer.kind === "document" ? getAssetAttachmentUrl : viewer.kind === "history" ? getMaintenanceAttachmentUrl : getReceiptUrl}
        removeLabel={viewer.kind === "transfer" ? "Detach form" : "Remove receipt"}
        /* a document opened from the edit form, or a file opened from the
           history form, is taken off in that form, where the removal is held
           with the rest of the changes until Save */
        canRemove={viewer.kind !== "document" && viewer.kind !== "history" && can(DELETE_PERMISSION)}
        onRemove={() => {
          if (viewer.kind === "document" || viewer.kind === "history") return setViewer(null);
          if (viewer.kind !== "transfer") return removeReceipt(viewer.jobId, viewer.partId, viewer.meta || viewer);
          const file = viewer.meta;
          setViewer(null);
          detachTransferForm(file);
        }} /></div>}

      {maintenanceChoice && (
        <div className="ams-overlay">
          <MaintenanceChoiceModal
            lockedAssetTag={maintenanceChoice.lockedAssetTag}
            initialAssetTag={maintenanceChoice.initialAssetTag}
            initialTab={maintenanceChoice.initialTab}
            ctx={ctx}
            assets={assets}
            records={maintenanceRecords}
            isSuperAdmin={isSuperAdmin}
            busy={saving}
            onClose={() => setMaintenanceChoice(null)}
            onSubmit={runAddMaintenanceSchedule}
            onSaveRecord={runSaveMaintenanceRecord}
            onDeleteRecord={runDeleteMaintenanceRecord}
            onOpenEroForm={openEroForm}
            onOpenFile={ctx.openHistoryFile}
          />
        </div>
      )}

      {confirm && (
        <div className="ams-overlay ams-scrim fixed inset-0 z-50 flex items-center justify-center p-6">
          <div role="alertdialog" aria-modal="true" aria-labelledby="ams-confirm-title"
            className="p-5" style={{ maxWidth: 420, background: C.surface, borderRadius: 2 }}>
            <div id="ams-confirm-title" style={{ fontSize: 16, fontWeight: 600 }}>{confirm.title}</div>
            <div style={{ fontSize: 13.5, color: C.mute, marginTop: 6, lineHeight: 1.5 }}>{confirm.body}</div>
            <div className="flex justify-end gap-2 mt-5">
              {confirm.blocked ? <Btn kind="solid" onClick={() => setConfirm(null)}>Close</Btn> : (<>
                <Btn onClick={() => setConfirm(null)}>{confirm.cancel || "Keep it"}</Btn>
                <Btn kind={confirm.kind || "danger"} onClick={() => { confirm.run(); setConfirm(null); }}>{confirm.confirm}</Btn>
              </>)}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

const TRANSFER_GRID = "76px 104px minmax(150px,1.05fr) minmax(175px,1.35fr) minmax(165px,1.25fr) 148px minmax(110px,1fr) 152px";
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
    <div className="flex flex-wrap items-center gap-2">
      {p.state === "Needed" && can("purchasing.manage") && <Btn small icon={ShoppingCart} onClick={() => onAct("order", job.id, p.id)}>Mark ordered</Btn>}
      {p.state === "Ordered" && can("purchasing.manage") && <Btn small kind="solid" icon={Receipt} onClick={() => onAct("purchase", job.id, p.id)}>Record purchase</Btn>}
      {p.state === "Purchased" && can("purchasing.manage") && <Btn small icon={Pencil} onClick={() => onAct("purchase", job.id, p.id)}>Edit</Btn>}
      {onDrop && can(DELETE_PERMISSION) && <Btn small kind="danger" icon={Trash2} onClick={() => onDrop(job.id, p.id, p)}>{""}</Btn>}
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
        <div><Chip color={col} tint={p.state === "Purchased" ? TINT.ok : p.state === "Ordered" ? TINT.warn : TINT.alarm}>{p.state}</Chip></div>
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
      <Chip color={col} tint={p.state === "Purchased" ? TINT.ok : p.state === "Ordered" ? TINT.warn : TINT.alarm}>{p.state}</Chip>
      {p.receipt ? receiptCell : p.state === "Purchased" ? <span className="flex items-center gap-1.5" style={{ fontSize: 12, color: C.overdue }}><AlertCircle size={13} />No receipt</span> : null}
      {actions}
    </div>
  );
}

function ReceiptViewer({ meta, onClose, onRemove, canRemove, removeLabel = "Remove receipt", open = getReceiptUrl }) {
  const panel = useRef(null);
  const titleId = useId();
  /* nothing is edited here, so Escape is the X */
  useEscapeKey(true, onClose);
  useDialogFocus(panel);
  const [src, setSrc] = useState(null);
  const [err, setErr] = useState("");
  useEffect(() => {
    let live = true;
    open(meta).then((url) => { if (live) setSrc(url); })
      .catch((error) => live && setErr(error.message || "This file could not be opened from Supabase Storage."));
    return () => { live = false; };
  }, [meta, open]);

  const download = () => {
    if (!src) return;
    const a = document.createElement("a"); a.href = src; a.download = meta.name || "receipt"; a.click();
  };

  return (
    <div className="ams-scrim fixed inset-0 z-50 flex items-center justify-center p-4">
      <div ref={panel} tabIndex={-1} role="dialog" aria-modal="true" aria-labelledby={titleId}
        className="flex flex-col" style={{ maxWidth: 720, width: "100%", maxHeight: "92vh", background: C.surface, borderRadius: 2, outline: "none" }}>
        <div className="flex items-center justify-between px-4 py-3" style={{ borderBottom: `1px solid ${C.ruleSoft}` }}>
          <div className="min-w-0">
            <div id={titleId} className="truncate" style={{ fontSize: 14, fontWeight: 600 }}>{meta.name}</div>
            <div style={{ fontFamily: MONO, fontSize: 11, color: C.mute }}>{kb(meta.size)} · filed {fmt(meta.at)}</div>
          </div>
          <button type="button" onClick={onClose} aria-label="Close" style={{ color: C.mute }} className="p-1 hover:opacity-60"><X size={18} /></button>
        </div>
        <div className="flex-1 overflow-auto p-4" style={{ background: C.paper, minHeight: 200 }}>
          {err ? <div className="text-center py-10" style={{ fontSize: 13, color: C.overdue }}>{err}</div>
            : !src ? <div className="text-center py-10" style={{ fontFamily: MONO, fontSize: 11, letterSpacing: "0.15em", color: C.mute }}>LOADING…</div>
            : meta.type?.startsWith("image/") ? <img src={src} alt={meta.name} style={{ maxWidth: "100%", display: "block", margin: "0 auto" }} />
            : meta.type && meta.type !== "application/pdf"
              /* a Word document has no in-page rendering; the browser would
                 either download it silently or show a blank frame */
              ? <div className="text-center py-10" style={{ fontSize: 13, color: C.mute, lineHeight: 1.6 }}>This kind of file cannot be shown here.<br />Download it to open it on your computer.</div>
            : <iframe title={meta.name} src={src} style={{ width: "100%", height: "60vh", border: "none", background: "var(--ams-surface-2)" }} />}
        </div>
        <div className="flex justify-between gap-2 px-4 py-3" style={{ borderTop: `1px solid ${C.ruleSoft}` }}>
          {canRemove ? <Btn kind="danger" icon={Trash2} onClick={onRemove}>{removeLabel}</Btn> : <span />}
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
        <MetricTile key={l} label={l} value={v} tone={col} />
      ))}
    </div>

    <div className="flex flex-wrap items-center gap-2 mb-4">
      <div className="relative flex-1" style={{ minWidth: 230 }}>
        <Search size={15} style={{ color: C.mute, position: "absolute", left: 11, top: 13 }} />
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
              /* Tiles darkened to sit on the slate ground: inverted, turned
                 back round the colour wheel so water stays blue, then
                 desaturated and dimmed. Controls and summaries are restyled
                 as the rest of the chrome. */
              /* isolate keeps Leaflet's own layer order (panes up to z-index
                 1000) inside the map, so markers and zoom buttons never draw
                 over the sticky top bar or the phone's bottom bar */
              .ams-map.leaflet-container{isolation:isolate;background:#232827;font-family:${SANS}}
              .ams-map .leaflet-tile-pane{filter:invert(1) hue-rotate(180deg) brightness(.86) contrast(.9) saturate(.35)}
              .ams-map .leaflet-bar{overflow:hidden;border:1px solid var(--ams-line)!important;border-radius:10px;box-shadow:0 8px 22px rgba(0,0,0,.35)}
              .ams-map .leaflet-bar a{width:32px;height:32px;line-height:30px;border-bottom:1px solid var(--ams-line);background:var(--ams-surface);color:var(--ams-text);transition:background 160ms ease,color 160ms ease}
              .ams-map .leaflet-bar a:last-child{border-bottom:0}
              .ams-map .leaflet-bar a:hover{background:var(--ams-surface-2);color:var(--ams-sand)}
              .ams-map .leaflet-bar a.leaflet-disabled{background:var(--ams-surface);color:var(--ams-dim)}
              .ams-map .leaflet-control-attribution{background:rgba(37,42,41,.82);color:var(--ams-dim)}
              .ams-map .leaflet-control-attribution a{color:var(--ams-sand-ink)}
              .ams-map .leaflet-tooltip{padding:8px 11px;border:1px solid var(--ams-line);border-radius:9px;background:var(--ams-surface-2);color:var(--ams-text);
                font-size:12px;line-height:1.5;box-shadow:0 12px 30px rgba(0,0,0,.45)}
              .ams-map .leaflet-tooltip strong{color:var(--ams-head);font-weight:600}
              .ams-map .leaflet-tooltip-top:before{border-top-color:var(--ams-line)}
              .qm-pin{display:block;width:var(--d);height:var(--d);position:relative}
              .qm-pin i{position:absolute;inset:0;border-radius:50%;background:var(--tone);
                border:2px solid rgba(239,243,233,.88);opacity:.92;box-shadow:0 0 0 0 var(--tone);
                animation:qmPulse 2.4s cubic-bezier(.24,.72,.4,1) infinite}
              @keyframes qmPulse{
                0%{box-shadow:0 0 0 0 color-mix(in srgb, var(--tone) 55%, transparent)}
                70%{box-shadow:0 0 0 14px color-mix(in srgb, var(--tone) 0%, transparent)}
                100%{box-shadow:0 0 0 0 color-mix(in srgb, var(--tone) 0%, transparent)}
              }
              @media (prefers-reduced-motion: reduce){.qm-pin i{animation:none}}
            `}</style>
            <div ref={box} className="ams-map" style={{ height: 460, width: "100%", background: C.surface, border: `1px solid ${C.rule}`, borderBottom: "none" }} />
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
                    <div className="flex items-center gap-2" style={{ minWidth: 0 }}><RecordTag>{a.tag}</RecordTag><span className="uppercase truncate" style={{ fontFamily: MONO, fontSize: 10.5, letterSpacing: "0.1em", color: C.mute }}>{a.project || NO_PROJECT}</span></div>
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
function Registry({ icon: Icon, title, blurb, addLabel, items, countOf, metaOf, badgeOf, logoOf, actionOf, onAdd, onEdit, onDelete, empty, unassigned, unassignedText }) {
  return (
    <div className="mb-8">
      <div className="flex flex-wrap items-start justify-between gap-3 mb-3">
        <div style={{ maxWidth: 560 }}>
          <div className="ams-section-title">{title}</div>
          <div style={{ fontSize: 13, color: C.mute, lineHeight: 1.5, marginTop: 2 }}>{blurb}</div>
        </div>
        <Btn kind="solid" icon={Plus} onClick={onAdd}>{addLabel}</Btn>
      </div>

      {unassigned > 0 && items.length > 0 && (
        <div className="flex items-center gap-2 px-4 py-3 mb-3" style={{ background: TINT.warn, borderLeft: `3px solid ${C.due}`, fontSize: 13.5, color: C.due }}>
          <AlertCircle size={15} />{unassignedText(unassigned)}
        </div>
      )}

      <div className="ams-table-frame" style={{ background: C.surface }}>
        {items.length === 0 ? (
          <div className="px-5 py-10 text-center">
            <div style={{ fontSize: 14, marginBottom: 4 }}>{empty[0]}</div>
            <div style={{ fontSize: 13, color: C.mute }}>{empty[1]}</div>
          </div>
        ) : items.map((it) => {
          const n = countOf(it);
          return (
            <div key={it.id} className="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3" style={{ borderBottom: `1px solid ${C.ruleSoft}` }}>
              {logoOf?.(it)
                ? <img src={logoOf(it)} alt="" style={{ width: 34, height: 34, flexShrink: 0, objectFit: "contain", borderRadius: 8, border: `1px solid ${C.ruleSoft}`, background: C.soft, padding: 3 }} />
                : <Icon size={16} style={{ color: C.mute, flexShrink: 0 }} />}
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
                {actionOf?.(it)}
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

function SettingsTab({ companies, categories, projects, people, brands, assets, on, canSetBrand, numbering, nextTag, nextTransfer }) {
  return (<>
    <Registry
      icon={Building2} title="Companies" addLabel="Add company"
      blurb="The owning entity an asset is registered under. Companies added here appear on the registration form and as a filter across the register and reports."
      items={companies}
      countOf={(c) => assets.filter((a) => a.company === c.name).length}
      badgeOf={(c) => c.code} logoOf={(c) => c.logoUrl}
      actionOf={!canSetBrand ? undefined : (c) => (
        <Btn small kind={c.isHeaderBrand ? "solid" : undefined} icon={c.isHeaderBrand ? CheckCircle2 : Building2}
          onClick={() => on(c.isHeaderBrand ? "clearBrand" : "setBrand", c.id)}
          title={c.isHeaderBrand ? "This logo brands the workspace. Click to remove it." : "Show this company's logo in the workspace header"}>
          {c.isHeaderBrand ? "Workspace brand" : "Use as brand"}
        </Btn>
      )}
      metaOf={(c) => [c.address, c.contact].filter(Boolean).join(" · ") || "No address or contact recorded"}
      onAdd={() => on("addCompany")} onEdit={(id) => on("editCompany", id)}
      onDelete={(c, n) => on("deleteCompany", c.id, c, n)}
      empty={["No companies set up.", "Add one and it becomes selectable when you register an asset."]}
      unassigned={assets.filter((a) => !a.company).length}
      unassignedText={(n) => `${n} asset${n > 1 ? "s are" : " is"} not assigned to a company yet. Edit each one to set it.`}
    />

    <Registry
      icon={Users} title="Responsible persons" addLabel="Add person"
      blurb="The people an asset can be signed out to. Registration and transfer choose from this list instead of accepting typed names, so the same person cannot end up on the register three different ways."
      items={people}
      countOf={(person) => assets.filter((asset) => asset.custodian === person.name).length}
      badgeOf={() => null}
      metaOf={(person) => {
        const branches = (person.companyIds || []).map((id) => companies.find((company) => company.id === id)?.name).filter(Boolean);
        return branches.length ? branches.join(" · ") : "No branch recorded";
      }}
      onAdd={() => on("addPerson")} onEdit={(id) => on("editPerson", id)}
      onDelete={(person, n) => on("deletePerson", person.id, person, n)}
      empty={["No responsible persons set up.", "Add the people who hold assets and they become selectable on the registration form."]}
    />

    <Registry
      icon={Package} title="Brands and models" addLabel="Add brand"
      blurb="The makes an asset can carry, and the models each one sells. Registration picks from this list instead of accepting typed names, so one make cannot end up on the register three different ways. Choosing a brand on the form offers that brand's models and nothing else."
      items={brands}
      countOf={(brand) => assets.filter((asset) => asset.brand === brand.name).length}
      metaOf={(brand) => {
        const models = (brand.models || []).map((model) => model.name);
        if (!models.length) return "No models listed — the Model box stays empty for this brand";
        return models.length > 4 ? `${models.slice(0, 4).join(" · ")} · +${models.length - 4} more` : models.join(" · ");
      }}
      onAdd={() => on("addBrand")} onEdit={(id) => on("editBrand", id)}
      onDelete={(brand, n) => on("deleteBrand", brand.id, brand, n)}
      empty={["No brands set up.", "Add a make and its models, and they become selectable when you register an asset."]}
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
          <div className="ams-section-title">Project/Location</div>
          <div style={{ fontSize: 13, color: C.mute, lineHeight: 1.5, marginTop: 2 }}>
            Project ID, its address, and a geocode for the map. On transfer you pick the ID and the address is looked up; anything off this list is recorded as <strong>{NO_PROJECT}</strong> with the address typed in.
          </div>
        </div>
        <div className="flex gap-2">
          <Btn icon={Upload} onClick={() => on("importProjects")}>Import Excel</Btn>
          <Btn kind="solid" icon={Plus} onClick={() => on("addProject")}>Add project/location</Btn>
        </div>
      </div>

      <div className="ams-table-frame" style={{ background: C.surface }}>
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

    <NumberingSequences numbering={numbering} nextTag={nextTag} nextTransfer={nextTransfer} assets={assets}
      onSave={(kind, value) => on("saveNumbering", kind, value)} />
  </>);
}

/* Where the register's own numbering starts and where it stops, for assets
   and for transfers. The zeros on the start are the padding: 000001 issues
   000001, 000002 and on; 1 issues 1, 2, 3. The rules live server-side in
   set_numbering_sequence; the checks here only keep an impossible value from
   making the trip. */
function NumberingSequences({ numbering, nextTag, nextTransfer, assets, onSave }) {
  const asset = numbering?.asset || SEQUENCE_DEFAULT;
  const transfer = numbering?.transfer || SEQUENCE_DEFAULT;
  /* Tags the change could not rewrite. The server refuses the save while any
     exist; saying so here saves the admin the trip. */
  const unsupported = unsupportedAssetNumbers(assets);
  const blocker = unsupported.count === 0 ? "" :
    `${unsupported.count} existing asset ${unsupported.count === 1 ? "tag does" : "tags do"} not use the supported AST numbering format. Examples: ${unsupported.examples.join(", ")}. Correct these asset tags first; the sequence cannot be changed until then.`;
  /* the number the database would issue next, read off the preview it gave */
  const nextAssetValue = Number.parseInt(String(nextTag || "").replace(/^AST-0*/i, ""), 10) || 1;
  const sequenceKey = (sequence) => `${sequence.start}-${sequence.end}-${sequence.width}`;
  return (
    <div className="mb-8">
      <div className="flex flex-wrap items-start justify-between gap-3 mb-3">
        <div style={{ maxWidth: 560 }}>
          <div className="ams-section-title">Numbering sequences</div>
          <div style={{ fontSize: 13, color: C.mute, lineHeight: 1.5, marginTop: 2 }}>
            Where the register's own numbering starts and where it stops. Type the start with the zeros you want to see: a start of <strong style={{ fontFamily: MONO }}>000001</strong> issues 000001, 000002 and on; a start of <strong style={{ fontFamily: MONO }}>1</strong> issues 1, 2, 3.
          </div>
        </div>
      </div>
      <div className="grid gap-4 md:grid-cols-2">
        <SequenceCard key={`asset-${sequenceKey(asset)}`} title="Asset numbering sequence" prefix="AST-" sequence={asset} nextValue={nextAssetValue} blocker={blocker}
          blurb="The number stamped on each asset when it is registered. Numbers the register issued itself are rewritten in the new style when this is saved; imported or hand-typed numbers are left alone."
          onSave={(value) => onSave("asset", value)} />
        <SequenceCard key={`transfer-${sequenceKey(transfer)}`} title="Transfer numbering sequence" prefix="TR " sequence={transfer} nextValue={nextTransfer || 1}
          blurb="The TR number on each transfer form. Transfers already recorded keep their number and are shown in the new style."
          onSave={(value) => onSave("transfer", value)} />
      </div>
    </div>
  );
}

function SequenceCard({ title, blurb, prefix, sequence, nextValue, blocker = "", onSave }) {
  const asTyped = (value) => formatSequenceNumber(value, sequence);
  const digits = (value) => String(value ?? "").replace(/\D/g, "").slice(0, 15);
  const [start, setStart] = useState(asTyped(sequence.start));
  const [end, setEnd] = useState(asTyped(sequence.end));
  const problem = sequenceProblem(start, end);
  const dirty = start !== asTyped(sequence.start) || end !== asTyped(sequence.end);
  /* what the next number would read under what is typed: the counter never
     moves back, so it is the later of where it stands and the new start */
  const preview = `${prefix}${formatSequenceNumber(Math.max(nextValue || 1, Number.parseInt(start || "1", 10) || 1), { width: start.length || 1 })}`;
  const box = { ...inputStyle, fontFamily: MONO, letterSpacing: "0.06em" };
  return (
    <div className="ams-table-frame" style={{ background: C.surface, padding: "16px 18px" }}>
      <div className="flex items-center gap-2">
        <Hash size={16} style={{ color: C.mute, flexShrink: 0 }} />
        <div style={{ fontSize: 14, fontWeight: 600 }}>{title}</div>
      </div>
      <div style={{ fontSize: 12.5, color: C.mute, marginTop: 4, lineHeight: 1.5 }}>{blurb}</div>
      {blocker && (
        <div role="alert" className="flex items-start gap-2 px-3 py-2.5 mt-3" style={{ background: TINT.warn, borderLeft: `3px solid ${C.due}`, fontSize: 12.5, color: C.due, lineHeight: 1.5 }}>
          <AlertCircle size={15} style={{ flexShrink: 0, marginTop: 2 }} />
          <span>{blocker}</span>
        </div>
      )}
      <div className="grid grid-cols-2 gap-3 mt-4">
        <div>
          <Label>Start numbering sequence</Label>
          <input style={box} inputMode="numeric" placeholder="000001" value={start} onChange={(e) => setStart(digits(e.target.value))} aria-label={`${title} start`} />
        </div>
        <div>
          <Label>Ending sequence</Label>
          <input style={box} inputMode="numeric" placeholder="999999" value={end} onChange={(e) => setEnd(digits(e.target.value))} aria-label={`${title} end`} />
        </div>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-3 mt-4">
        <div style={{ fontSize: 12.5, color: problem ? C.due : C.mute, lineHeight: 1.5 }}>
          {problem
            ? problem
            : <>Next number will read <span style={{ fontFamily: MONO, fontWeight: 700, color: C.ink }}>{preview}</span></>}
        </div>
        <Btn kind="solid" icon={CheckCircle2} disabled={!dirty || !!problem || !!blocker} onClick={() => onSave({ start, end })}>Save sequence</Btn>
      </div>
    </div>
  );
}

/* ------------------------------ parts ------------------------------ */

/* Every movement the register holds, in one place.
   Transfers are recorded against the asset they moved, so this reads them back
   out of the asset histories rather than keeping a second copy of them. */
const movementsOf = (assets) => assets
  .flatMap((asset) => (asset.history || []).filter((entry) => entry.kind === "transfer").map((entry) => ({ entry, asset })))
  .sort((a, b) => String(b.entry.date).localeCompare(String(a.entry.date)) || b.entry.ts - a.entry.ts);

/* the register stores "no project" as X; a list of movements reads better
   without it */
const projectLabel = (value) => (!value || value === NO_PROJECT ? "—" : value);

/* What the register calls a filed form. A phone hands over names like
   cf727768-1337-4703-b3dc-44f767a6e3fb.jpg, which says nothing to whoever
   opens the movement a year later, so the paperwork is named after the
   movement instead and the person filing it can say otherwise. */
const nameStem = (name) => String(name || "").replace(/\.[^.]+$/, "");
const nameExt = (name) => (String(name || "").match(/\.[^.]+$/) || [""])[0].toLowerCase();

const suggestedFormName = (entry, asset, files) => {
  const base = `${entry.number ? `TR ${entry.number}` : asset.tag || "Transfer"} signed form`;
  const taken = new Set((files || []).map((file) => nameStem(file.name).toLowerCase()));
  if (!taken.has(base.toLowerCase())) return base;
  /* a second photograph of the same sheet is a normal thing to file */
  for (let n = 2; n < 99; n += 1) {
    if (!taken.has(`${base} (${n})`.toLowerCase())) return `${base} (${n})`;
  }
  return base;
};

/* One place that turns a movement into the paperwork for it, so the viewer,
   the printer and the download all describe the same sheet. */
const formDataOf = (entry, asset, companies) => ({
  company: companies.find((company) => company.name === asset.company) || { name: asset.company || "" },
  asset,
  movement: {
    date: entry.date, fromLoc: entry.move?.fromLoc, toLoc: entry.move?.toLoc,
    fromPer: entry.move?.fromPer, toPer: entry.move?.toPer,
    fromProject: projectLabel(entry.move?.fromProject), toProject: projectLabel(entry.move?.project),
    reference: entry.move?.why || "", number: entry.number ?? "", releasedBy: entry.recordedBy || "",
    id: entry.id,
  },
});

/* The Equipment Repair Order for one historic record, on screen with print
   and download - the same viewer the transfer form has. */
function EroFormViewer({ data, onClose }) {
  const panel = useRef(null);
  const stage = useRef(null);
  const titleId = useId();
  useEscapeKey(true, onClose);
  useDialogFocus(panel);
  const [html] = useState(() => eroFormHtml(data));
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState("");
  const { asset, record } = data;

  /* The preview is the page itself: an A4 frame at its true 210 x 297mm,
     scaled down as one piece to whatever room the dialog has. Scaling the
     frame rather than reflowing it keeps every rule and column where it will
     be on paper. */
  const [scale, setScale] = useState(1);
  useEffect(() => {
    const fit = () => {
      const room = stage.current?.clientWidth;
      if (room) setScale(Math.min(1, room / A4.px.width));
    };
    fit();
    const observer = new ResizeObserver(fit);
    if (stage.current) observer.observe(stage.current);
    return () => observer.disconnect();
  }, []);

  const save = async () => {
    setSaving(true); setErr("");
    try { await downloadEroForm(data); }
    catch (error) { setErr(error?.message || "The PDF could not be made. Print to PDF instead."); }
    finally { setSaving(false); }
  };

  return (
    <div className="ams-scrim fixed inset-0 z-50 flex items-center justify-center p-4">
      <div ref={panel} tabIndex={-1} role="dialog" aria-modal="true" aria-labelledby={titleId}
        className="flex flex-col" style={{ maxWidth: 900, width: "100%", maxHeight: "94vh", background: C.surface, borderRadius: 2, outline: "none" }}>
        <div className="flex items-center justify-between gap-3 px-4 py-3" style={{ borderBottom: `1px solid ${C.ruleSoft}` }}>
          <div className="min-w-0">
            <div id={titleId} style={{ fontSize: 14, fontWeight: 600 }}>
              Equipment Repair Order
              {record.eroCode ? <span style={{ fontFamily: DISPLAY, color: C.overdue, marginLeft: 8 }}>{record.eroCode}</span> : null}
            </div>
            <div style={{ fontFamily: MONO, fontSize: 11, color: C.mute }}>
              {asset.tag} · {fmt(record.startedOn)} · A4 210 × 297 mm
            </div>
          </div>
          <button type="button" onClick={onClose} aria-label="Close" style={{ color: C.mute }} className="p-1 hover:opacity-60"><X size={18} /></button>
        </div>
        <div ref={stage} className="flex-1 overflow-auto p-4" style={{ background: C.paper }}>
          {/* the box the scaled page leaves behind, so the scroll area is the
              height of the sheet on screen and not of the frame before it */}
          <div style={{ width: A4.px.width * scale, height: A4.px.height * scale, margin: "0 auto" }}>
            <iframe title={`Equipment Repair Order for ${asset.tag}`} srcDoc={html} scrolling="no"
              style={{ display: "block", width: A4.px.width, height: A4.px.height, border: "none",
                background: "#fff", boxShadow: "0 2px 14px rgba(0,0,0,.28)",
                transform: `scale(${scale})`, transformOrigin: "top left" }} />
          </div>
        </div>
        {err && (
          <div className="mx-4 mb-3 flex items-start gap-2 px-3 py-2" style={{ background: STAGES.broken.tint, color: STAGES.broken.color, fontSize: 13, lineHeight: 1.45 }}>
            <AlertCircle size={14} style={{ marginTop: 2, flexShrink: 0 }} />
            <span>{err}</span>
          </div>
        )}
        <div className="flex justify-end gap-2 px-4 py-3" style={{ borderTop: `1px solid ${C.ruleSoft}` }}>
          <Btn icon={Download} onClick={save} disabled={saving}>{saving ? "Making PDF…" : "Download PDF"}</Btn>
          <Btn kind="solid" icon={Printer} onClick={() => printEroForm(data)} disabled={saving}>Print</Btn>
        </div>
      </div>
    </div>
  );
}

/* how many signed sheets are filed against a movement */
const filedCount = (entry) => (entry?.files || []).length;

/* Paperclip with a count on it, for a toolbar that has to say at a glance
   whether the signed copy ever came back. */
const AttachBadge = ({ count }) => (
  <span className="relative inline-flex">
    <Paperclip size={15} />
    <span style={{ position: "absolute", top: -7, right: -9, minWidth: 15, height: 15, padding: "0 3px",
      display: "grid", placeItems: "center", borderRadius: 999, fontSize: 9.5, fontWeight: 700, lineHeight: 1,
      background: count ? C.ok : C.dim, color: "#fff" }}>{count}</span>
  </span>
);

/* The sheet on screen, before it goes anywhere: the same document the printer
   and the download produce, rendered in a frame so what you see is what you
   get. */
function TransferFormViewer({ data, onClose }) {
  const panel = useRef(null);
  const titleId = useId();
  useEscapeKey(true, onClose);
  useDialogFocus(panel);
  const [html] = useState(() => transferFormHtml(data));
  const { asset, movement } = data;

  return (
    <div className="ams-scrim fixed inset-0 z-50 flex items-center justify-center p-4">
      <div ref={panel} tabIndex={-1} role="dialog" aria-modal="true" aria-labelledby={titleId}
        className="flex flex-col" style={{ maxWidth: 1000, width: "100%", maxHeight: "94vh", background: C.surface, borderRadius: 2, outline: "none" }}>
        <div className="flex items-center justify-between gap-3 px-4 py-3" style={{ borderBottom: `1px solid ${C.ruleSoft}` }}>
          <div className="min-w-0">
            <div id={titleId} style={{ fontSize: 14, fontWeight: 600 }}>
              Transfer form
              {movement.number ? <RecordTag style={{ marginLeft: 8, verticalAlign: "1px" }}>NO. {movement.number}</RecordTag> : null}
            </div>
            <div style={{ fontFamily: MONO, fontSize: 11, color: C.mute }}>{asset.tag} · {fmt(movement.date)}</div>
          </div>
          <button type="button" onClick={onClose} aria-label="Close" style={{ color: C.mute }} className="p-1 hover:opacity-60"><X size={18} /></button>
        </div>
        <div className="flex-1 overflow-auto p-4" style={{ background: C.paper }}>
          <iframe title={`Transfer form for ${asset.tag}`} srcDoc={html}
            style={{ display: "block", width: "100%", height: "62vh", border: `1px solid ${C.ruleSoft}`, background: "#fff" }} />
        </div>
        <div className="flex justify-end gap-2 px-4 py-3" style={{ borderTop: `1px solid ${C.ruleSoft}` }}>
          <Btn icon={Download} onClick={() => downloadTransferForm(data)}>Download</Btn>
          <Btn kind="solid" icon={Printer} onClick={() => printTransferForm(data)}>Print</Btn>
        </div>
      </div>
    </div>
  );
}

/* Every sheet an asset has ever produced, so the paperwork can be found from
   the asset rather than only from the movement. */
function TransferFormsDialog({ asset, movements, onClose, onView, onPrint, onDownload, onOpenTransfer }) {
  const panel = useRef(null);
  const titleId = useId();
  useEscapeKey(true, onClose);
  useDialogFocus(panel);

  return (
    <div className="ams-scrim fixed inset-0 z-50 flex items-end sm:items-center justify-center sm:p-6">
      <div ref={panel} tabIndex={-1} role="dialog" aria-modal="true" aria-labelledby={titleId}
        className="w-full flex flex-col" style={{ maxWidth: 620, maxHeight: "92vh", background: C.surface, borderRadius: 2, outline: "none" }}>
        <div className="flex items-start justify-between gap-3 px-5 py-4" style={{ borderBottom: `1px solid ${C.ruleSoft}` }}>
          <div className="min-w-0">
            <div id={titleId} style={{ fontSize: 16, fontWeight: 600 }}>Transfer forms</div>
            <div style={{ fontSize: 13, color: C.mute, marginTop: 2 }}>{asset.tag} · {asset.name}</div>
          </div>
          <button type="button" onClick={onClose} aria-label="Close" style={{ color: C.mute }} className="p-1 hover:opacity-60"><X size={18} /></button>
        </div>

        <div className="flex-1 overflow-auto px-5 py-4">
          {movements.length === 0 ? (
            <div className="px-4 py-8 text-center" style={{ background: C.paper, fontSize: 13.5, color: C.mute }}>
              This asset has never been transferred, so it has no transfer form yet.
            </div>
          ) : (
            <div className="grid gap-2">
              {movements.map((entry) => (
                <div key={entry.id} className="flex items-center gap-3 px-3 py-2" style={{ background: C.paper, border: `1px solid ${C.ruleSoft}` }}>
                  <button type="button" onClick={() => onOpenTransfer(entry.id)} className="text-left flex-1 min-w-0">
                    <div style={{ fontFamily: DISPLAY, fontSize: 13, fontWeight: 700, color: entry.number ? C.overdue : C.dim }}>
                      {entry.number ? `TR ${entry.number}` : "Unnumbered"}
                    </div>
                    <div style={{ fontSize: 12.5, color: C.mute }}>
                      {fmt(entry.date)} · {entry.move?.fromPer || "—"} → {entry.move?.toPer || "—"}
                    </div>
                  </button>
                  <span title={`${filedCount(entry)} signed form${filedCount(entry) === 1 ? "" : "s"} filed`}
                    style={{ color: filedCount(entry) ? C.ok : C.dim }}>
                    <AttachBadge count={filedCount(entry)} />
                  </span>
                  <Btn small icon={Eye} onClick={() => onView(entry)}>View</Btn>
                  <Btn small icon={Printer} onClick={() => onPrint(entry)}>Print</Btn>
                  <Btn small icon={Download} onClick={() => onDownload(entry)}>Save</Btn>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="flex justify-end px-5 py-3" style={{ borderTop: `1px solid ${C.ruleSoft}` }}>
          <Btn kind="solid" onClick={onClose}>Close</Btn>
        </div>
      </div>
    </div>
  );
}

/* --------------------------- the code reader ---------------------------

   A sticker on a machine, read either through the device's own camera or from
   a photograph of one. The camera needs a secure page — https, or localhost —
   so the picture route is always offered beside it rather than as a fallback
   nobody can find. */
function QrScanner({ title, onResult, onClose }) {
  const panel = useRef(null);
  const video = useRef(null);
  const canvas = useRef(null);
  const stream = useRef(null);
  const timer = useRef(0);
  const titleId = useId();
  const [live, setLive] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  useEscapeKey(true, onClose);
  useDialogFocus(panel);

  const stop = useCallback(() => {
    if (timer.current) { cancelAnimationFrame(timer.current); timer.current = 0; }
    if (stream.current) { stream.current.getTracks().forEach((track) => track.stop()); stream.current = null; }
    setLive(false);
  }, []);

  /* whatever happens, the camera light goes out when this closes */
  useEffect(() => stop, [stop]);

  const found = useCallback((text) => { stop(); onResult(text); }, [onResult, stop]);

  const start = async () => {
    setErr("");
    if (!navigator.mediaDevices?.getUserMedia) {
      setErr(window.isSecureContext === false
        ? "The camera needs a secure page. Open this workspace over https, or scan a picture of the code instead."
        : "This device offers no camera to this browser. Scan a picture of the code instead.");
      return;
    }
    try {
      /* the back camera on a phone; a laptop simply gives its only one */
      const media = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: "environment" } }, audio: false });
      stream.current = media;
      setLive(true);
      const element = video.current;
      element.srcObject = media;
      await element.play();
      const frame = canvas.current;
      const context = frame.getContext("2d", { willReadFrequently: true });
      const look = () => {
        if (!stream.current) return;
        if (element.readyState >= 2 && element.videoWidth) {
          frame.width = element.videoWidth;
          frame.height = element.videoHeight;
          context.drawImage(element, 0, 0, frame.width, frame.height);
          const text = decodeFromCanvas(frame, context);
          if (text) return found(text);
        }
        timer.current = requestAnimationFrame(look);
      };
      timer.current = requestAnimationFrame(look);
    } catch (error) {
      stop();
      setErr(error?.name === "NotAllowedError"
        ? "The camera was blocked. Allow camera access for this site, or scan a picture of the code instead."
        : error?.message || "The camera could not be opened. Scan a picture of the code instead.");
    }
  };

  const pick = async (event) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    setErr(""); setBusy(true);
    try {
      const text = await decodeFromFile(file);
      if (text) found(text);
      else setErr("No QR code was found in that picture. Try a closer, sharper shot of the code.");
    } catch {
      setErr("That file could not be read as an image.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="ams-scrim fixed inset-0 z-50 flex items-end sm:items-center justify-center sm:p-6">
      <div ref={panel} tabIndex={-1} role="dialog" aria-modal="true" aria-labelledby={titleId}
        className="w-full flex flex-col" style={{ maxWidth: 460, background: C.surface, borderRadius: 2, outline: "none" }}>
        <div className="flex items-start justify-between gap-3 px-5 py-4" style={{ borderBottom: `1px solid ${C.ruleSoft}` }}>
          <div>
            <div id={titleId} style={{ fontSize: 16, fontWeight: 600 }}>{title}</div>
            <div style={{ fontSize: 13, color: C.mute, marginTop: 2 }}>Point the camera at the code, or scan a picture of one.</div>
          </div>
          <button type="button" onClick={onClose} aria-label="Close" style={{ color: C.mute }} className="p-1 hover:opacity-60"><X size={18} /></button>
        </div>

        <div className="px-5 py-4">
          <div style={{ position: "relative", background: C.paper, border: `1px solid ${C.ruleSoft}`, aspectRatio: "4 / 3", overflow: "hidden" }}>
            <video ref={video} muted playsInline
              style={{ width: "100%", height: "100%", objectFit: "cover", display: live ? "block" : "none" }} />
            {!live && (
              <div className="absolute inset-0 grid place-items-center px-6 text-center" style={{ fontSize: 13, color: C.mute }}>
                <div><QrCode size={26} style={{ margin: "0 auto 8px" }} />The camera is off.</div>
              </div>
            )}
            <canvas ref={canvas} className="hidden" />
          </div>
          {err && <div className="mt-3 px-3 py-2" style={{ background: STAGES.broken.tint, color: STAGES.broken.color, fontSize: 12.5, lineHeight: 1.45 }}>{err}</div>}
        </div>

        <div className="flex flex-wrap items-center gap-2 px-5 py-3" style={{ borderTop: `1px solid ${C.ruleSoft}` }}>
          {live
            ? <Btn icon={X} onClick={stop}>Stop camera</Btn>
            : <Btn kind="solid" icon={QrCode} onClick={start}>Use camera</Btn>}
          {/* a file picker has to be a label, so it borrows the button's shape */}
          <label className="inline-flex items-center gap-2 transition-opacity hover:opacity-75"
            style={{ background: C.surface, color: C.ink, border: `1px solid ${C.rule}`, minHeight: 40, borderRadius: 10,
              fontFamily: SANS, fontSize: 13, fontWeight: 700, padding: "0 13px", whiteSpace: "nowrap",
              cursor: busy ? "wait" : "pointer", opacity: busy ? 0.6 : 1 }}>
            <input type="file" accept="image/*" className="hidden" onChange={pick} disabled={busy} />
            <Upload size={14} strokeWidth={2} />{busy ? "Reading…" : "Scan a picture"}
          </label>
        </div>
      </div>
    </div>
  );
}

/* one leg of a movement: what it was, and what it became */
const Fact = ({ label, from, to, mono }) => (
  <div>
    <Label>{label}</Label>
    <div style={{ fontSize: 13.5, fontFamily: mono ? MONO : SANS }}>
      <span style={{ color: C.mute }}>{from || "—"}</span>
      <span style={{ color: C.dim }}> → </span>
      <span>{to || "—"}</span>
    </div>
  </div>
);

/* ------------------------- one transfer, in full -------------------------

   Where a scanned form lands. The movement is already recorded; what is
   missing is the paper that was signed for it on delivery, so filing that is
   the one thing this panel can do that the register cannot do elsewhere. */
function TransferDetails({ view, canAttach, canDetach, busy, onClose, onForm, onOpenAsset, onAttach, onOpenFile, onRenameFile, onDetachFile }) {
  const panel = useRef(null);
  const titleId = useId();
  const nameId = useId();
  const noteId = useId();
  const fileRef = useRef(null);
  /* the chosen file waits here until it is filed, so the name and note beside
     it are plainly about that file rather than fields on their own */
  const [staged, setStaged] = useState(null);
  const [preparing, setPreparing] = useState(false);
  const [formName, setFormName] = useState("");
  const [note, setNote] = useState("");
  /* { id, stem } while one filed row is being renamed in place */
  const [renaming, setRenaming] = useState(null);
  useEscapeKey(true, onClose);
  useDialogFocus(panel);

  const { entry, asset } = view;
  const files = entry.files || [];

  const pick = async (event) => {
    const chosen = event.target.files?.[0];
    event.target.value = "";
    if (!chosen) return;
    setPreparing(true);
    /* shrinking a phone photograph here is what makes the upload quick; a file
       that cannot be shrunk simply comes back as it was */
    const prepared = await prepareUpload(chosen).catch(() => ({ file: chosen, original: chosen, shrunk: false }));
    setPreparing(false);
    setStaged(prepared);
    setFormName(suggestedFormName(entry, asset, files));
  };

  const discard = () => { setStaged(null); setFormName(""); setNote(""); };

  const fileIt = async () => {
    if (!staged) return;
    const stem = formName.trim() || nameStem(staged.original.name);
    /* the extension follows the file actually being sent, which a shrunk
       photograph has changed to .jpg */
    const filed = await onAttach(staged.file, { name: `${stem}${nameExt(staged.file.name)}`, note: note.trim() });
    /* only cleared once the server has it, so a failed upload keeps the typing */
    if (filed) discard();
  };

  const commitRename = async (file) => {
    const stem = (renaming?.stem || "").trim();
    if (!stem) return;
    if (stem === nameStem(file.name)) { setRenaming(null); return; }
    if (await onRenameFile(file, `${stem}${nameExt(file.name)}`)) setRenaming(null);
  };

  return (
    <div className="ams-scrim fixed inset-0 z-50 flex items-end sm:items-center justify-center sm:p-6">
      <div ref={panel} tabIndex={-1} role="dialog" aria-modal="true" aria-labelledby={titleId}
        className="w-full flex flex-col" style={{ maxWidth: 620, maxHeight: "92vh", background: C.surface, borderRadius: 2, outline: "none" }}>
        <div className="flex items-start justify-between gap-3 px-5 py-4" style={{ borderBottom: `1px solid ${C.ruleSoft}` }}>
          <div className="min-w-0">
            <div id={titleId} style={{ fontSize: 16, fontWeight: 600 }}>
              Transfer details
              {entry.number ? <RecordTag style={{ marginLeft: 8, verticalAlign: "2px" }}>TR {entry.number}</RecordTag> : null}
            </div>
            <div style={{ fontSize: 13, color: C.mute, marginTop: 2 }}>{fmt(entry.date)}</div>
          </div>
          <button type="button" onClick={onClose} aria-label="Close" style={{ color: C.mute }} className="p-1 hover:opacity-60"><X size={18} /></button>
        </div>

        <div className="flex-1 overflow-auto px-5 py-4">
          <div className="grid grid-cols-2 gap-4">
            <div className="col-span-2">
              <Label>Asset</Label>
              <button type="button" onClick={() => onOpenAsset(asset.id)} className="text-left">
                <RecordTag>{asset.tag}</RecordTag>
                <div style={{ fontSize: 14, marginTop: 3 }}>{asset.name}</div>
              </button>
            </div>
            <Fact label="Address" from={entry.move?.fromLoc} to={entry.move?.toLoc} />
            <Fact label="Responsible person" from={entry.move?.fromPer} to={entry.move?.toPer} />
            <Fact label="Project/Location" mono from={projectLabel(entry.move?.fromProject)} to={projectLabel(entry.move?.project)} />
            <div>
              <Label>Reason</Label>
              <div style={{ fontSize: 13.5 }}>{entry.move?.why || "—"}</div>
            </div>
          </div>

          <div className="mt-5 pt-4" style={{ borderTop: `1px solid ${C.ruleSoft}` }}>
            <div className="flex items-center gap-2">
              <Label>Signed transfer form</Label>
              <span style={{ color: files.length ? C.ok : C.dim, marginBottom: 6 }}>
                <AttachBadge count={files.length} />
              </span>
            </div>
            <div style={{ fontSize: 12.5, color: C.mute, marginBottom: 10 }}>
              The printed form is signed by hand on delivery. Photograph or scan the completed sheet and file it here, against this movement.
            </div>

            {files.length === 0 ? (
              <div className="px-4 py-6 text-center" style={{ background: C.paper, fontSize: 13, color: C.mute }}>
                Nothing filed against this transfer yet.
              </div>
            ) : (
              <div className="grid gap-2">
                {files.map((file) => (
                  <div key={file.id} className="flex items-center gap-3 px-3 py-2" style={{ background: C.paper, border: `1px solid ${C.ruleSoft}` }}>
                    <Paperclip size={14} style={{ color: C.mute, flexShrink: 0 }} />
                    {renaming?.id === file.id ? (
                      <>
                        <input value={renaming.stem} autoFocus disabled={busy}
                          onChange={(event) => setRenaming({ id: file.id, stem: event.target.value })}
                          onKeyDown={(event) => {
                            if (event.key === "Enter") commitRename(file);
                            /* the panel closes on Escape, which is not what a
                               half-typed name means */
                            if (event.key === "Escape") { event.stopPropagation(); setRenaming(null); }
                          }}
                          aria-label="Name for this filed form"
                          style={{ ...inputStyle, flex: 1, minWidth: 0 }} />
                        <span style={{ fontFamily: MONO, fontSize: 11, color: C.mute }}>{nameExt(file.name)}</span>
                        <Btn small onClick={() => commitRename(file)} disabled={busy}>Save</Btn>
                        <Btn small onClick={() => setRenaming(null)} disabled={busy}>Cancel</Btn>
                      </>
                    ) : (
                      <>
                        <button type="button" onClick={() => onOpenFile(file)} className="text-left flex-1 min-w-0">
                          <div className="truncate" style={{ fontSize: 13 }}>{file.name}</div>
                          <div style={{ fontFamily: MONO, fontSize: 11, color: C.mute }}>
                            {kb(file.size)} · filed {fmt(file.at)} by {file.by || "unknown"}{file.note ? ` · ${file.note}` : ""}
                          </div>
                        </button>
                        {canAttach && (
                          <button type="button" onClick={() => setRenaming({ id: file.id, stem: nameStem(file.name) })} disabled={busy}
                            title="Rename this form" aria-label={`Rename ${file.name}`}
                            className="p-1.5" style={{ color: C.mute, border: `1px solid ${C.rule}`, borderRadius: 6 }}>
                            <Pencil size={14} />
                          </button>
                        )}
                        {canDetach && (
                          <button type="button" onClick={() => onDetachFile(file)} disabled={busy}
                            title="Detach this form" aria-label={`Detach ${file.name}`}
                            className="p-1.5" style={{ color: C.mute, border: `1px solid ${C.rule}`, borderRadius: 6 }}>
                            <Trash2 size={14} />
                          </button>
                        )}
                      </>
                    )}
                  </div>
                ))}
              </div>
            )}

            {canAttach && (
              <div className="mt-3">
                <input ref={fileRef} type="file" accept="image/png,image/jpeg,image/webp,image/heic,image/heif,application/pdf"
                  className="hidden" onChange={pick} />
                {staged ? (
                  <div className="p-3" style={{ background: C.paper, border: `1px solid ${C.rule}` }}>
                    <div className="flex items-center gap-3">
                      <Paperclip size={14} style={{ color: C.mute, flexShrink: 0 }} />
                      {/* the picked file, named as it came, only so the right
                          one can be confirmed before it is filed */}
                      <div className="truncate min-w-0 flex-1" style={{ fontFamily: MONO, fontSize: 11, color: C.mute }}>
                        {staged.original.name} · {staged.shrunk
                          ? `${kb(staged.original.size)} → ${kb(staged.file.size)} · compressed for a faster upload`
                          : kb(staged.file.size)}
                      </div>
                      <button type="button" onClick={() => fileRef.current?.click()} disabled={busy}
                        className="underline" style={{ fontSize: 12, color: C.mute, flexShrink: 0 }}>Change</button>
                    </div>
                    <label htmlFor={nameId} style={{ display: "block", fontSize: 12.5, color: C.mute, margin: "12px 0 4px" }}>
                      File name — what this form is called in the register
                    </label>
                    <div className="flex items-center gap-2">
                      <input id={nameId} value={formName} autoFocus disabled={busy}
                        onChange={(event) => setFormName(event.target.value)}
                        placeholder={nameStem(staged.original.name)} style={{ ...inputStyle, flex: 1, minWidth: 0 }} />
                      <span style={{ fontFamily: MONO, fontSize: 12, color: C.mute }}>{nameExt(staged.file.name)}</span>
                    </div>
                    <label htmlFor={noteId} style={{ display: "block", fontSize: 12.5, color: C.mute, margin: "12px 0 4px" }}>
                      Note about this file (optional) — filed with it and shown in the list below
                    </label>
                    <input id={noteId} value={note} disabled={busy}
                      onChange={(event) => setNote(event.target.value)}
                      placeholder="e.g. signed copy returned by site" style={inputStyle} />
                    <div className="flex items-center gap-2" style={{ marginTop: 12 }}>
                      <Btn kind="solid" icon={Upload} onClick={fileIt} disabled={busy}>{busy ? "Filing…" : "File it"}</Btn>
                      <Btn small onClick={discard} disabled={busy}>Cancel</Btn>
                    </div>
                  </div>
                ) : (
                  <>
                    <Btn icon={Upload} onClick={() => fileRef.current?.click()} disabled={busy || preparing}>
                      {preparing ? "Preparing…" : "Choose signed form"}
                    </Btn>
                    <span style={{ fontSize: 12, color: C.mute, marginLeft: 10 }}>
                      Photo or PDF, up to 10 MB. You add the note on the next step.
                    </span>
                  </>
                )}
              </div>
            )}
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2 px-5 py-3" style={{ borderTop: `1px solid ${C.ruleSoft}` }}>
          <Btn small icon={Eye} onClick={() => onForm.view(entry, asset)}>View form</Btn>
          <Btn small icon={Printer} onClick={() => onForm.print(entry, asset)}>Print</Btn>
          <Btn small icon={Download} onClick={() => onForm.download(entry, asset)}>Download</Btn>
          <span className="flex-1" />
          <Btn kind="solid" onClick={onClose}>Close</Btn>
        </div>
      </div>
    </div>
  );
}

/* ---------------------------- the transfer cart ---------------------------

   Assets picked out of the register and held until somebody says where they
   are going. Nothing here is a record of anything: the cart holds the decision
   to move something, and the register stays the truth about what each asset
   is. The point of it is the single sheet at the end — a yard moving eight
   machines to one site signs for them once, on one form, rather than eight
   times on eight.                                                          */
function TransferCartTab({ assets, movable, statusOf, onOpen, onRemove, onClear, onTransfer, onPrint }) {
  /* the printed sheet carries one letterhead, so a cart drawn from two
     companies cannot be run off as one piece of paper truthfully */
  const companies = [...new Set(assets.map((asset) => asset.company).filter(Boolean))];
  /* an asset can go on a repair ticket after it was put in the cart, so being
     here is not proof it can still move */
  const movableIds = new Set(movable.map((asset) => asset.id));
  const stuck = assets.filter((asset) => !movableIds.has(asset.id));

  return (
    <div className="ams-table-frame overflow-hidden" style={{ background: C.surface }}>
      <div className="px-5 py-4 flex flex-wrap items-start justify-between gap-3" style={{ borderBottom: `1px solid ${C.ruleSoft}` }}>
        <div>
          <div className="flex items-center gap-2" style={{ fontSize: 16, fontWeight: 600 }}>
            <ShoppingCart size={17} style={{ color: C.mute }} />Transfer cart
            <span style={{ fontFamily: MONO, fontSize: 12, color: C.mute }}>{assets.length}</span>
          </div>
          <div style={{ fontSize: 13, color: C.mute, marginTop: 2 }}>
            Assets waiting to move. They all go to the same address and responsible person, and print on one form.
          </div>
        </div>
        {assets.length > 0 && (
          <div className="flex flex-wrap items-center gap-2">
            <Btn small icon={Printer} onClick={onPrint}>Print list</Btn>
            <Btn small icon={X} onClick={onClear}>Clear cart</Btn>
            <Btn kind="solid" icon={ArrowLeftRight} onClick={onTransfer} disabled={movable.length === 0}>Transfer from cart</Btn>
          </div>
        )}
      </div>

      {assets.length === 0 ? (
        <div className="px-5 py-14 text-center">
          <ShoppingCart size={26} style={{ color: C.dim, margin: "0 auto 10px" }} />
          <div style={{ fontSize: 14, marginBottom: 4 }}>The cart is empty.</div>
          <div style={{ fontSize: 13, color: C.mute, lineHeight: 1.5 }}>
            Add assets from the Assets tab — the <ShoppingCart size={13} style={{ display: "inline", verticalAlign: -2 }} /> beside a row,
            or the button on the asset itself. Assets on a repair ticket do not offer it, because they are not the yard's to move.
          </div>
        </div>
      ) : (
        <>
          {stuck.length > 0 && (
            <div className="flex items-start gap-2 px-5 py-3" style={{ background: STAGES.parts.tint, color: STAGES.parts.color, fontSize: 13, lineHeight: 1.45 }}>
              <AlertTriangle size={14} style={{ marginTop: 2, flexShrink: 0 }} />
              <span>
                {stuck.length === 1 ? "One asset here cannot move" : `${stuck.length} assets here cannot move`} — {stuck.map((asset) => asset.tag).join(", ")}
                {" "}went on a repair ticket after being added. They are left out of the transfer.
              </span>
            </div>
          )}
          {companies.length > 1 && (
            <div className="flex items-start gap-2 px-5 py-3" style={{ background: STAGES.broken.tint, color: STAGES.broken.color, fontSize: 13, lineHeight: 1.45 }}>
              <AlertTriangle size={14} style={{ marginTop: 2, flexShrink: 0 }} />
              <span>The cart holds assets from {companies.join(" and ")}. One printed form carries one company's letterhead, so file these as separate movements if the paperwork has to match.</span>
            </div>
          )}
          {assets.map((asset) => {
            const state = statusOf(asset);
            return (
              <div key={asset.id} className="ams-list-row flex items-stretch" style={{ borderBottom: `1px solid ${C.ruleSoft}` }}>
                <button type="button" onClick={() => onOpen(asset.id)} className="min-w-0 flex-1 text-left px-5 py-3 flex gap-3 items-center">
                  <Dot color={state.color} />
                  {asset.photoUrl ? (
                    <img src={asset.photoUrl} alt="" style={{ width: 38, height: 38, flexShrink: 0, objectFit: "cover", borderRadius: 2, border: `1px solid ${C.ruleSoft}`, background: C.soft }} />
                  ) : (
                    <span aria-hidden="true" style={{ width: 38, height: 38, flexShrink: 0, display: "grid", placeItems: "center", borderRadius: 2, border: `1px solid ${C.ruleSoft}`, background: C.soft }}>
                      <ImgIcon src="/icon/No%20Image.png" size={17} style={{ color: C.dim }} />
                    </span>
                  )}
                  <div className="min-w-0 flex-1">
                    <RecordTag>{asset.tag}</RecordTag>
                    <div className="truncate" style={{ fontSize: 14, fontWeight: 500 }}>{asset.name}</div>
                    <div className="truncate" style={{ fontFamily: MONO, fontSize: 11, color: C.mute }}>{cartLine(asset)}</div>
                    <div className="truncate" style={{ fontSize: 12, color: C.mute }}>Held by {asset.custodian || "—"}</div>
                  </div>
                  <Chip color={state.color} tint={state.tint}>{state.label}</Chip>
                </button>
                <button type="button" onClick={() => onRemove(asset.id)}
                  title={`Remove ${asset.tag} from the cart`} aria-label={`Remove ${asset.tag} from the cart`}
                  className="px-4 flex items-center hover:opacity-70" style={{ color: C.mute, borderLeft: `1px solid ${C.ruleSoft}` }}>
                  <X size={16} />
                </button>
              </div>
            );
          })}
        </>
      )}
    </div>
  );
}

function TransfersTab({ assets, onOpenDetails, onForm, onScan }) {
  const [q, setQ] = useState("");
  const all = useMemo(() => movementsOf(assets), [assets]);
  const t = q.trim().toLowerCase();
  const rows = all.filter(({ entry, asset }) => !t || [
    entry.number, `tr ${entry.number}`, asset.tag, asset.name, entry.move?.fromPer, entry.move?.toPer,
    entry.move?.fromLoc, entry.move?.toLoc, entry.move?.why, entry.move?.project,
  ].some((v) => String(v ?? "").toLowerCase().includes(t)));

  const movedAssets = new Set(all.map(({ asset }) => asset.id)).size;
  /* how much of the paperwork has come back: a transfer with nothing filed
     against it is one whose signed form is still on somebody's desk */
  const filed = all.filter(({ entry }) => (entry.files || []).length > 0).length;

  return (<>
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-4">
      <MetricTile label="Transfers recorded" value={all.length} tone={C.brandDeep} />
      <MetricTile label="Assets that have moved" value={movedAssets} tone={C.ok} />
      <MetricTile label="With attachment" value={filed} tone={C.ok} />
      <MetricTile label="Without attachment" value={all.length - filed} tone={C.due} />
    </div>

    <div className="flex flex-wrap items-center gap-2 mb-4">
      <div className="relative flex-1" style={{ minWidth: 240 }}>
        <Search size={15} style={{ color: C.mute, position: "absolute", left: 11, top: 13 }} />
        <input value={q} onChange={(e) => setQ(e.target.value)}
          placeholder="Search TR no., asset, person, address, project or reason" style={{ ...inputStyle, paddingLeft: 32 }} />
      </div>
      <Btn icon={QrCode} onClick={onScan}>Scan</Btn>
    </div>

    <div className="ams-table-frame overflow-x-auto" style={{ background: C.surface }}>
      <div style={{ minWidth: 1010 }}>
        {rows.length === 0 ? (
          <div className="px-5 py-12 text-center">
            <div style={{ fontSize: 14, marginBottom: 4 }}>{all.length === 0 ? "No transfers recorded yet." : "No transfers match this search."}</div>
            <div style={{ fontSize: 13, color: C.mute }}>
              {all.length === 0 ? "An asset appears here the first time it is handed to a new address or a new responsible person." : "Clear the search to see every movement."}
            </div>
          </div>
        ) : (<>
          <div className="ams-data-head grid gap-3 px-3" style={{ gridTemplateColumns: TRANSFER_GRID }}>
            <div>TR no.</div><div>Date</div><div>Asset</div><div>Address</div><div>Responsible person</div><div>Project/Location</div><div>Reason</div><div />
          </div>
          {rows.map(({ entry, asset }) => (
            /* the whole row opens the movement — the printer is the one thing
               on it that does something else, so it stops the tap from
               reaching the row */
            <div key={entry.id} role="button" tabIndex={0}
              onClick={() => onOpenDetails(entry.id)}
              onKeyDown={(event) => {
                if (event.key !== "Enter" && event.key !== " ") return;
                event.preventDefault();
                onOpenDetails(entry.id);
              }}
              aria-label={`Open transfer ${entry.number ? `TR ${entry.number}` : ""} for ${asset.tag} ${asset.name}`}
              className="ams-list-row grid gap-3 px-3 py-3 items-start text-left"
              style={{ gridTemplateColumns: TRANSFER_GRID, borderBottom: `1px solid ${C.ruleSoft}`, cursor: "pointer" }}>
              {/* the same number the printed form carries, so a sheet on a
                  desk can be found here without reading the dates */}
              <div>
                {entry.number ? <RecordTag>TR {entry.number}</RecordTag> : <span style={{ color: C.dim }}>—</span>}
              </div>
              <div style={{ fontFamily: MONO, fontSize: 12.5, color: C.mute }}>{fmt(entry.date)}</div>
              <div style={{ minWidth: 0 }}>
                <RecordTag>{asset.tag}</RecordTag>
                <div className="truncate" style={{ fontSize: 13.5, marginTop: 3 }}>{asset.name}</div>
              </div>
              <div style={{ fontSize: 13, minWidth: 0 }}>
                <span style={{ color: C.mute }}>{entry.move?.fromLoc || "—"}</span>
                <span style={{ color: C.dim }}> → </span>
                <span>{entry.move?.toLoc || "—"}</span>
              </div>
              <div style={{ fontSize: 13, minWidth: 0 }}>
                <span style={{ color: C.mute }}>{entry.move?.fromPer || "—"}</span>
                <span style={{ color: C.dim }}> → </span>
                <span>{entry.move?.toPer || "—"}</span>
              </div>
              <div style={{ fontFamily: MONO, fontSize: 12.5 }}>
                <span style={{ color: C.mute }}>{projectLabel(entry.move?.fromProject)}</span>
                <span style={{ color: C.dim }}> → </span>
                <span>{projectLabel(entry.move?.project)}</span>
              </div>
              <div className="truncate" style={{ fontSize: 13, color: C.mute }}>{entry.move?.why || "—"}</div>
              {/* the paperwork for this movement: what is filed against it,
                  and the sheet itself to look at, print or save */}
              <div className="flex items-center gap-1.5" style={{ justifySelf: "end" }}>
                {[
                  { label: `${filedCount(entry)} signed form${filedCount(entry) === 1 ? "" : "s"} filed`,
                    icon: <AttachBadge count={filedCount(entry)} />, run: () => onOpenDetails(entry.id) },
                  { label: "View the transfer form", icon: <Eye size={15} />, run: () => onForm.view(entry, asset) },
                  { label: "Print the transfer form", icon: <Printer size={15} />, run: () => onForm.print(entry, asset) },
                  { label: "Save the transfer form", icon: <Download size={15} />, run: () => onForm.download(entry, asset) },
                ].map(({ label, icon, run }) => (
                  <button key={label} type="button" title={`${label} · ${asset.tag}`} aria-label={`${label} for ${asset.tag}`}
                    onClick={(event) => { event.stopPropagation(); run(); }}
                    className="p-1.5" style={{ color: C.mute, border: `1px solid ${C.rule}`, borderRadius: 6 }}>
                    {icon}
                  </button>
                ))}
              </div>
            </div>
          ))}
        </>)}
      </div>
    </div>
  </>);
}

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
        <MetricTile key={l} label={l} value={v} tone={col} />
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
        <Search size={15} style={{ color: C.mute, position: "absolute", left: 11, top: 13 }} />
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search part, supplier, receipt no., asset, ticket" style={{ ...inputStyle, paddingLeft: 32 }} />
      </div>
      <select value={state} onChange={(e) => setState(e.target.value)} style={{ ...inputStyle, width: "auto", minWidth: 165, color: state ? PART_COLOR[state] : C.mute, fontWeight: state ? 600 : 400 }}>
        <option value="" style={{ color: C.ink, fontWeight: 400 }}>All parts ({all.length})</option>
        {PART_STATES.map((s) => <option key={s} value={s} style={{ color: C.ink, fontWeight: 400 }}>{s} ({count(s)})</option>)}
      </select>
      {can("parts.manage") && <Btn kind="solid" icon={Plus} onClick={onAdd}>Add part</Btn>}
    </div>

    <div className="ams-table-frame overflow-x-auto" style={{ background: C.surface }}>
      <div style={{ minWidth: 856 }}>
        {rows.length === 0 ? (
          <div className="px-5 py-12 text-center">
            <div style={{ fontSize: 14, marginBottom: 4 }}>{all.length === 0 ? "No parts logged yet." : "No parts match this view."}</div>
            <div style={{ fontSize: 13, color: C.mute }}>
              {all.length === 0 ? "Parts appear here as soon as they're added to a repair ticket." : "Clear the search or pick a different status."}
            </div>
          </div>
        ) : (<>
          <div className="ams-data-head" style={{
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

/* =========================================================================
   The asset record, as a drawer: 900px from the right over a dimmed page,
   full width on a phone. The header stays put - the sticker, what can be
   done with the asset now, and the tabs - and the body under it scrolls.

   It closes on the dimmed page, the × or Escape. Anything opened from it (a
   transfer, an edit, a schedule) is a dialog on top, so Escape closes that
   first and the drawer is still there underneath.
   ========================================================================= */
const peso = (v) => `₱${num(v).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/* A two-column list of facts under a small heading, with 1px lines between
   them. A half-width fact left alone at the end of a row - before a
   full-width one, or at the very end - takes the whole row, so the grid never
   ends in an empty cell. */
function DetailList({ title, items }) {
  const shown = items.filter(Boolean);
  /* walked once, carrying which column the next fact lands in */
  const cells = shown.reduce((out, item, index) => {
    const next = shown[index + 1];
    const span = !!item.full || (out.column === 0 && (!next || !!next.full));
    return { column: span ? 0 : (out.column + 1) % 2, list: [...out.list, { ...item, span }] };
  }, { column: 0, list: [] }).list;
  return (
    <section className="ams-dl-group">
      <div className="ams-dl-head">{title}</div>
      <div className="ams-dl">
        {cells.map((item) => {
          const empty = item.value === undefined || item.value === null || String(item.value).trim() === "";
          return (
            <div key={item.label} className="ams-dl-cell" data-span={item.span ? "1" : undefined}>
              <div className="ams-dl-label">{item.label}</div>
              {empty
                ? <div className="ams-dl-empty">Not recorded</div>
                : <div className="ams-dl-value" style={item.mono ? { fontFamily: MONO } : undefined}>{item.value}</div>}
            </div>
          );
        })}
      </div>
    </section>
  );
}

/* a value that changed shows the new one, with where it came from under it */
const Changed = ({ to, from, mono }) => (
  <>
    <div style={mono ? { fontFamily: MONO, fontSize: 12.5 } : undefined}>{to || "—"}</div>
    {from && from !== to && <div className="ams-from">from {from}</div>}
  </>
);

const EmptyTab = ({ children }) => <div className="ams-tab-empty">{children}</div>;

function AssetDrawer({ asset: a, job, repairs, plans, can, csv, inCart, cartable, onClose, onAction }) {
  const panel = useRef(null);
  const titleId = useId();
  const [tab, setTab] = useState("details");
  useEscapeKey(true, onClose);
  useDialogFocus(panel);
  /* the page behind does not scroll while the drawer is over it */
  useEffect(() => {
    const before = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = before; };
  }, []);

  const av = availOf(a, job);
  const retired = a.status === "retired";
  const chain = movements(a);
  const general = [...(a.history || [])].filter((h) => !isRepairEntry(h) && !isMoveEntry(h)).reverse();
  const tickets = [...repairs].sort((x, y) => String(y.date).localeCompare(String(x.date)));
  const repairSpend = tickets.reduce((s, t) => s + repairTotal(t), 0);
  const upkeepSpend = plans.reduce((s, p) => s + planSpend(p), 0);
  const completions = plans.reduce((s, p) => s + (p.done || []).length, 0);
  const value = num(a.cost);
  const share = value > 0 && (tickets.length || completions)
    ? `${(((repairSpend + upkeepSpend) / value) * 100).toFixed(1)}% of the acquisition cost` : "";

  const exportMoves = () => csv(
    ["date", "from_project_location", "to_project_location", "from_address", "to_address", "from_person", "to_person", "reason", "days_held"],
    chain.map((m) => [m.date, m.move?.fromProject || "", m.move?.project || "", m.move?.fromLoc || "", m.move?.toLoc || "", m.move?.fromPer || "", m.move?.toPer || "", m.move?.why || m.text, m.days]),
    `transfers-${a.tag}-${today()}.csv`);

  const projectText = (pid) => (!pid || pid === NO_PROJECT ? "X (not on a project site)" : pid);

  const tabs = [
    ["details", "Details", null],
    ["history", "History", general.length],
    ["transfers", "Transfers", chain.length],
    ["repairs", "Repairs", tickets.length],
    ["maintenance", "Maintenance", plans.length],
  ];

  return (
    <>
      <div className="ams-drawer-scrim" onClick={onClose} aria-hidden="true" />
      <aside ref={panel} tabIndex={-1} role="dialog" aria-modal="true" aria-labelledby={titleId} className="ams-drawer">
        <header className="ams-drawer-head">
          <div className="ams-drawer-top">
            <span>Asset record</span>
            <button type="button" className="ams-icon-btn" onClick={onClose} aria-label="Close asset record"><X size={18} /></button>
          </div>

          <div className="ams-sticker">
            <div className="ams-sticker-main">
              <div className="ams-sticker-row">
                <span id={titleId} className="ams-sticker-no">{a.tag}</span>
                <span className="ams-sticker-status" style={{ "--c": av.color }}>{av.label}</span>
              </div>
              <div className="ams-sticker-name">{a.name}</div>
              <div className="ams-sticker-meta">{[a.category, a.company].filter(Boolean).join(", ") || "No category or company recorded"}</div>
            </div>
            <div className="ams-sticker-qr">
              {a.code ? (
                <>
                  <img src={qrDataUri(assetDeepLink(a), 120)} width={60} height={60} alt={`QR code for ${a.code}`} />
                  <span style={{ fontFamily: MONO }}>{a.code}</span>
                </>
              ) : (
                <>
                  <QrCode size={30} strokeWidth={1.6} aria-hidden="true" />
                  <span>No QR code yet</span>
                </>
              )}
            </div>
          </div>

          <div className="ams-drawer-actions">
            {!retired && !job && <>
              {can("asset.transfer") && <Btn small icon={ArrowLeftRight} onClick={() => onAction("transfer")}>Transfer</Btn>}
              {can("asset.transfer") && cartable && (
                <Btn small icon={inCart ? CheckCircle2 : undefined} img={inCart ? undefined : "/icon/add-to-cart.png"}
                  iconClass={inCart ? "ams-cart-tick" : undefined} onClick={() => onAction("cart")}>
                  {inCart ? "Remove from cart" : "Add to cart"}
                </Btn>
              )}
              {can("repair.create") && <Btn small icon={AlertTriangle} onClick={() => onAction("fault")}>Report fault</Btn>}
              {can("asset.retire") && <Btn small icon={Archive} onClick={() => onAction("retire")}>Retire</Btn>}
              {can("asset.update") && <Btn small icon={Pencil} onClick={() => onAction("edit")}>Edit</Btn>}
            </>}
            {!retired && job && can("repair.view") && (
              <Btn small kind="solid" icon={Wrench} onClick={() => onAction("ticket", job.id)}>Open repair ticket {job.ticket}</Btn>
            )}
            {retired && can("asset.retire") && <Btn small icon={RotateCcw} onClick={() => onAction("reinstate")}>Bring back into service</Btn>}
            {!job && can(DELETE_PERMISSION) && (
              <button type="button" className="ams-link-danger" onClick={() => onAction("delete")}><Trash2 size={14} />Delete record</button>
            )}
          </div>

          <div className="ams-tabs" role="tablist" aria-label="Asset record">
            {tabs.map(([key, label, n]) => (
              <button key={key} type="button" role="tab" aria-selected={tab === key} className="ams-tab" onClick={() => setTab(key)}>
                {label}{n !== null && <span className="ams-tab-n">{n}</span>}
              </button>
            ))}
          </div>
        </header>

        <div className="ams-drawer-body" role="tabpanel">
          {tab === "details" && <>
            {(a.images?.length > 0 || a.photoUrl) && (
              <div className="ams-drawer-card">
                <AssetImages key={a.id}
                  images={a.images?.length ? a.images : [{ id: "cover", url: a.photoUrl }]}
                  alt={`Asset image — ${a.tag} ${a.name}`}
                  onOpen={(index) => onAction("images", index)} />
              </div>
            )}
            {a.files?.length > 0 && (
              <div className="ams-drawer-card"><AssetDocuments files={a.files} onOpen={(index) => onAction("documents", index)} /></div>
            )}
            <DetailList title="Identification" items={[
              { label: "Company", value: a.company },
              { label: "Category", value: a.category },
              { label: "Brand/Manufacturer", value: a.brand },
              { label: "Model", value: a.model },
              { label: "Asset code (QR sticker)", value: a.code, mono: true },
              (hasBodyNumber(a.category) || a.body) && { label: "Body number", value: a.body, mono: true },
              { label: serialLabel(a.category), value: a.serial, mono: true },
              ...vehicleKeys(a.category).map((k) => ({ label: VEHICLE_FIELD_DEFS[k].label, value: a[k], mono: true })),
            ]} />
            <DetailList title="Assignment" items={[
              { label: "Project/Location", value: projectText(a.project) },
              { label: "Responsible person", value: a.custodian },
              { label: "Address", value: a.location, full: true },
            ]} />
            <DetailList title="Value and upkeep" items={[
              { label: "Date acquired", value: a.acquired ? fmt(a.acquired) : "" },
              { label: "Acquisition cost", value: a.cost !== "" && a.cost !== null && a.cost !== undefined ? peso(a.cost) : "" },
              { label: "Repairs to date", value: tickets.length ? `${peso(repairSpend)} across ${plural(tickets.length, "ticket")}` : "" },
              { label: "Maintenance to date", value: completions ? `${peso(upkeepSpend)} across ${plural(completions, "completion")}` : "" },
              { label: "Upkeep as share of value", value: share },
              retired
                ? { label: "Retired on", value: a.retiredOn ? [fmt(a.retiredOn), a.retirementReason].filter(Boolean).join(" · ") : "" }
                : { label: "First placed", value: chain[0]?.date ? fmt(chain[0].date) : "" },
              { label: "Notes", value: a.notes, full: true },
            ]} />
          </>}

          {tab === "history" && (general.length === 0 ? <EmptyTab>No history recorded</EmptyTab> : (
            <div className="ams-log">
              {general.map((h, i) => (
                <div key={`${h.ts}-${i}`} className="ams-log-row">
                  <div className="ams-log-date">{fmt(h.date)}</div>
                  <div className="min-w-0">
                    <div className="ams-log-text"><Dot color={TRAIL[h.kind] || C.mute} size={7} />{h.text}</div>
                    {h.sub && <div className="ams-log-sub">{h.sub}</div>}
                    {h.recordedBy && <div className="ams-log-by">by {h.recordedBy}</div>}
                  </div>
                </div>
              ))}
            </div>
          ))}

          {tab === "transfers" && <>
            <div className="ams-tab-bar">
              <span>Chain of custody, newest first. Held counts the days the asset stayed in each placement.</span>
              <span className="flex flex-wrap gap-2">
                <Btn small icon={FileText} onClick={() => onAction("forms")}>Transfer forms</Btn>
                {chain.length > 0 && <Btn small icon={Download} onClick={exportMoves}>Export CSV</Btn>}
              </span>
            </div>
            {chain.length === 0 ? <EmptyTab>No movements recorded</EmptyTab> : (
              <div className="ams-table-frame overflow-x-auto">
                <table className="ams-table" style={{ minWidth: 840 }}>
                  <thead><tr>{["Date", "Movement", "Project/Location", "Address", "Responsible person", "Reason", "Held"].map((h) => <th key={h} style={{ textAlign: h === "Held" ? "right" : "left" }}>{h}</th>)}</tr></thead>
                  <tbody>
                    {[...chain].reverse().map((m, i) => {
                      const first = m.kind === "register";
                      return (
                        <tr key={`${m.ts}-${i}`} style={{ verticalAlign: "top" }}>
                          <td style={{ fontFamily: MONO, fontSize: 12, whiteSpace: "nowrap" }}>{fmt(m.date)}</td>
                          <td style={{ whiteSpace: "nowrap" }}>{first ? "Initial placement" : "Transfer"}</td>
                          <td>{m.move ? <Changed to={projectText(m.move.project)} from={first ? "" : m.move.fromProject && projectText(m.move.fromProject)} /> : "—"}</td>
                          <td>{m.move ? <Changed to={m.move.toLoc} from={first ? "" : m.move.fromLoc} /> : "—"}</td>
                          <td>{m.move ? <Changed to={m.move.toPer} from={first ? "" : m.move.fromPer} /> : "—"}</td>
                          <td>
                            <div>{m.move?.why || m.text}</div>
                            {m.recordedBy && <div className="ams-from">Recorded by {m.recordedBy}</div>}
                          </td>
                          <td style={{ textAlign: "right", whiteSpace: "nowrap" }}>
                            <div style={{ fontFamily: MONO, fontSize: 12.5 }}>{plural(m.days, "day")}</div>
                            {m.current && <div className="ams-current">current</div>}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </>}

          {tab === "repairs" && (tickets.length === 0 ? <EmptyTab>No repairs recorded</EmptyTab> : (
            <div className="ams-table-frame overflow-x-auto">
              <table className="ams-table" style={{ minWidth: 620 }}>
                <thead><tr>{["Ticket", "Fault", "Reported", "Status", "Total cost"].map((h) => <th key={h} style={{ textAlign: h === "Total cost" ? "right" : "left" }}>{h}</th>)}</tr></thead>
                <tbody>
                  {tickets.map((t) => {
                    const st = t.closed ? { label: "Closed", color: C.retired, tint: TINT.idle } : { label: STAGES[t.stage].avail, color: STAGES[t.stage].color, tint: STAGES[t.stage].tint };
                    return (
                      <tr key={t.id} className="ams-row-link" tabIndex={0} onClick={() => onAction("ticket", t.id)}
                        onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onAction("ticket", t.id); } }}>
                        <td><RecordTag>{t.ticket}</RecordTag></td>
                        <td>{t.fault}</td>
                        <td style={{ fontFamily: MONO, fontSize: 12, whiteSpace: "nowrap" }}>{fmt(t.date)}</td>
                        <td><Chip color={st.color} tint={st.tint}>{st.label}</Chip></td>
                        <td style={{ fontFamily: MONO, textAlign: "right", whiteSpace: "nowrap" }}>{peso(repairTotal(t))}</td>
                      </tr>
                    );
                  })}
                </tbody>
                <tfoot>
                  <tr><td colSpan={4} className="ams-tfoot-label">All repairs to date</td><td style={{ fontFamily: MONO, fontWeight: 700, textAlign: "right", whiteSpace: "nowrap" }}>{peso(repairSpend)}</td></tr>
                </tfoot>
              </table>
            </div>
          ))}

          {tab === "maintenance" && <>
            {can("maintenance.manage") && (
              <div className="ams-tab-bar" style={{ justifyContent: "flex-end" }}>
                <Btn small icon={Plus} onClick={() => onAction("schedule")}>Add schedule</Btn>
              </div>
            )}
            {plans.length === 0 ? <EmptyTab>No maintenance scheduled</EmptyTab> : (
              <div className="ams-table-frame overflow-x-auto">
                <table className="ams-table" style={{ minWidth: 700 }}>
                  <thead><tr>{["Maintenance", "Repeat", "Next due", "Provider or office", "Spent", ""].map((h, i) => <th key={i} style={{ textAlign: h === "Spent" ? "right" : "left" }}>{h}</th>)}</tr></thead>
                  <tbody>
                    {plans.map((p) => {
                      const d = daysUntil(p.nextDue);
                      const due = dueOf(p);
                      return (
                        <tr key={p.id} style={{ verticalAlign: "top" }}>
                          <td style={{ fontWeight: 500 }}>{p.name}</td>
                          <td style={{ whiteSpace: "nowrap" }}>{cap(everyLabel(p))}</td>
                          <td style={{ whiteSpace: "nowrap" }}>
                            <div style={{ fontFamily: MONO, fontSize: 12 }}>{fmt(p.nextDue)}</div>
                            <div style={{ fontSize: 11.5, fontWeight: 600, color: due.color }}>
                              {d < 0 ? `${plural(-d, "day")} overdue` : d === 0 ? "Due today" : `In ${plural(d, "day")}`}
                            </div>
                          </td>
                          <td>{p.provider || <span className="ams-dl-empty">Not recorded</span>}</td>
                          <td style={{ fontFamily: MONO, textAlign: "right", whiteSpace: "nowrap" }}>{peso(planSpend(p))}</td>
                          <td style={{ textAlign: "right" }}>
                            {can("maintenance.manage") && <Btn small icon={CalendarCheck} onClick={() => onAction("logPlan", p.id)}>Record completion</Btn>}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </>}
        </div>
      </aside>
    </>
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
        <Search size={15} style={{ color: C.mute, position: "absolute", left: 11, top: 13 }} />
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
                    <div className="flex items-center justify-between gap-2" style={{ fontFamily: MONO, fontSize: 10.5, letterSpacing: "0.1em", color: C.mute }}>
                      <RecordTag>{r.ticket}</RecordTag><span>DAY {daysSince(r.date)}</span>
                    </div>
                    <div className="mt-2 uppercase" style={{ fontFamily: MONO, fontSize: 11.5, fontWeight: 700, letterSpacing: "0.06em" }}>{a.tag}</div>
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
                <RecordTag>{r.ticket}</RecordTag>
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
    <div className="ams-slide-in" style={{ background: C.surface, border: `1px solid ${C.rule}`, borderRadius: 12, overflow: "hidden" }}>
      <div className="px-5 pt-4 pb-4">
        <button onClick={onBack} className="flex items-center gap-1 mb-3" style={{ fontSize: 13, color: C.mute }}><ChevronLeft size={15} />Repair board</button>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <RecordTag>{job.ticket}</RecordTag>
            <button onClick={onOpenAsset} className="text-left block mt-2">
              <RecordTag big>{a.tag}</RecordTag>
              <div style={{ fontSize: 16, fontWeight: 600, marginTop: 6, color: C.head }}>{a.name}</div>
            </button>
          </div>
          {stage ? <Chip color={STAGES[stage].color} tint={STAGES[stage].tint} big>{STAGES[stage].label}</Chip>
            : <Chip color={C.retired} tint={TINT.idle} big>Closed {fmt(job.closedOn)}</Chip>}
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

/* Add Maintenance opens on one modal, not a chooser that hands off to a
   second one. The asset is fixed by whichever "Add Maintenance" button was
   clicked (greyed out, unpickable) when that context exists, and floats free
   only from the tab-wide button where nothing was clicked yet. Upcoming is
   the recurring-schedule form; Historic is the record of work already done.
   Switching tabs swaps the panel below in place and keeps what was typed in
   the other - the modal itself never closes and reopens. A click beside it
   does nothing; Cancel, the X and Escape ask first when anything was typed. */
/* One size for the dialog, whichever tab is showing and whatever state
   the historic one is in - the list, a record under review, a blank form.
   The panel is fixed, its middle scrolls and its buttons stay put, so
   switching tabs never resizes anything under the reader. */
const MAINTENANCE_MODAL_W = 780;
const MAINTENANCE_MODAL_H = "min(860px, 92vh)";
/* a tab's panel: the scrolling middle and the footer that stays with it */
const tabPanel = (on) => ({ display: on ? "flex" : "none", flexDirection: "column", flex: 1, minHeight: 0 });
const tabBody = { flex: 1, minHeight: 0, overflowY: "auto" };
const tabFoot = { flexShrink: 0 };

/* The files kept with a historic record, from the paperclip on its row.
   Resting the pointer on the clip opens the list and moving away closes it;
   a tap does the same where there is nothing to hover with. Choosing a file
   opens it. The list is portaled to the body and fixed to the clip's spot,
   so the modal's scrolling list cannot clip it, and it stacks above the
   modal the way the top-bar menus do. */
function HistoryFilesPop({ files, onOpen }) {
  const [open, setOpen] = useState(false);
  const [spot, setSpot] = useState(null);
  const anchor = useRef(null);
  const menu = useRef(null);
  const leaving = useRef(null);
  const width = 320;

  const show = () => {
    clearTimeout(leaving.current);
    const box = anchor.current?.getBoundingClientRect();
    if (box) setSpot(box);
    setOpen(true);
  };
  /* the pointer crosses a small gap between the clip and the list; a short
     grace keeps the list from vanishing on the way */
  const hide = () => { clearTimeout(leaving.current); leaving.current = setTimeout(() => setOpen(false), 140); };
  useEffect(() => () => clearTimeout(leaving.current), []);
  useEffect(() => {
    if (!open) return undefined;
    const away = (e) => { if (!anchor.current?.contains(e.target) && !menu.current?.contains(e.target)) setOpen(false); };
    const key = (e) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", away);
    document.addEventListener("keydown", key);
    return () => { document.removeEventListener("mousedown", away); document.removeEventListener("keydown", key); };
  }, [open]);

  const count = files.length;
  const label = `${count} ${count === 1 ? "file" : "files"} kept with this record`;
  return (<>
    <button ref={anchor} type="button" onMouseEnter={show} onMouseLeave={hide} onFocus={show} onBlur={hide}
      onClick={() => (open ? setOpen(false) : show())}
      className="inline-flex items-center gap-1 align-middle hover:opacity-70"
      style={{ marginLeft: 8, fontFamily: MONO, fontSize: 11, padding: "1px 7px", borderRadius: 20,
        border: `1px solid ${open ? C.ink : C.rule}`, color: C.ink, background: C.surface, cursor: "pointer" }}
      aria-haspopup="menu" aria-expanded={open} aria-label={label} title={label}>
      <Paperclip size={11} />{count}
    </button>
    {open && spot && createPortal(
      <div ref={menu} className="ams-pop" role="menu" onMouseEnter={show} onMouseLeave={hide}
        style={{ position: "fixed", top: spot.bottom + 6, left: Math.max(8, Math.min(spot.left, window.innerWidth - width - 8)), width }}>
        <div className="px-3 pt-1.5 pb-1" style={{ fontFamily: SANS, fontSize: 10, fontWeight: 800, letterSpacing: "0.08em", textTransform: "uppercase", color: C.mute }}>{label}</div>
        {files.map((file) => (
          <button key={file.id} type="button" role="menuitem" className="ams-item" onClick={() => { setOpen(false); onOpen(file); }}
            title={`Open ${file.name}`}>
            <Paperclip size={14} strokeWidth={2} style={{ color: C.mute, flexShrink: 0, marginTop: 1 }} />
            <span className="min-w-0">
              <span className="block truncate">{file.name}</span>
              <span className="block truncate" style={{ fontFamily: MONO, fontSize: 10.5, color: C.mute }}>{kb(file.size)} · filed {fmt(file.at)}{file.by ? ` by ${file.by}` : ""}</span>
            </span>
            <Eye size={13} style={{ color: C.mute, flexShrink: 0, marginLeft: "auto", marginTop: 2 }} />
          </button>
        ))}
      </div>,
      document.body,
    )}
  </>);
}

function MaintenanceChoiceModal({ lockedAssetTag = "", initialAssetTag = "", initialTab = "upcoming", ctx, assets = [], records = [], isSuperAdmin = false, busy = false, onClose, onSubmit, onSaveRecord, onDeleteRecord, onOpenEroForm, onOpenFile }) {
  const [tab, setTab] = useState(initialTab || "upcoming");
  const def = PLAN_ACTIONS.addPlan;
  /* the asset it opens on: locked from the asset panel, or the one it was
     showing before it stepped aside for a file */
  const fields = useMemo(() => def.fields({ assetTag: lockedAssetTag || initialAssetTag || "" }, ctx), [def, ctx, lockedAssetTag, initialAssetTag]);
  const [opened] = useState(() => Object.fromEntries(fields.map((f) => [f.key, f.value ?? ""])));
  const [vals, setVals] = useState(opened);
  const [err, setErr] = useState("");
  const [historicDirty, setHistoricDirty] = useState(false);
  const [askDiscard, setAskDiscard] = useState(false);
  const [historicView, setHistoricView] = useState("list");
  const [editing, setEditing] = useState(null);
  const panel = useRef(null);
  const titleId = useId();

  const assetField = lockedAssetTag
    ? { ...fields.find((f) => f.key === "assetTag"), options: [lockedAssetTag], readOnly: true, full: true }
    : { ...fields.find((f) => f.key === "assetTag"), full: true };
  const restFields = fields.filter((f) => f.key !== "assetTag");
  const assetTag = lockedAssetTag || vals.assetTag || "";
  const asset = useMemo(() => {
    const tag = String(assetTag).split(" — ")[0];
    return tag ? assets.find((a) => a.tag === tag) || null : null;
  }, [assets, assetTag]);
  const assetRecords = useMemo(() => (asset ? records.filter((r) => r.assetId === asset.id) : []), [records, asset]);

  /* A different asset chosen drops back to the list; a record deleted while
     open is simply no longer there to edit, so the list shows instead. Both
     are derived from what is loaded rather than chased with an effect. */
  const assetId = asset?.id || null;
  const [viewAssetId, setViewAssetId] = useState(assetId);
  if (viewAssetId !== assetId) { setViewAssetId(assetId); setEditing(null); setHistoricView("list"); }
  const liveEditing = editing ? records.find((r) => r.id === editing.id) || null : null;

  const changeField = (key, value) => { setVals((v) => ({ ...v, [key]: value })); setErr(""); };
  const go = () => {
    const withAsset = { ...vals, assetTag };
    const miss = fields.filter((f) => f.required && !String(withAsset[f.key] || "").trim());
    if (miss.length) return setErr(`Fill in ${miss.map((m) => m.label.toLowerCase()).join(", ")}.`);
    onSubmit(withAsset);
  };

  /* choosing which asset to look at is not work that can be lost, so it does
     not count; anything typed for a schedule does */
  const upcomingDirty = Object.keys(vals).some((key) => key !== "assetTag" && String(vals[key] ?? "") !== String(opened[key] ?? ""));
  const dirty = upcomingDirty || historicDirty;
  /* Closing, and leaving for the printed sheet, take the same route: nothing
     typed goes straight away, anything typed asks first. askDiscard holds
     what to do once the discard is confirmed. */
  const leave = (then) => {
    if (busy) return;
    if (dirty) return setAskDiscard({ then });
    then();
  };
  const requestClose = () => leave(onClose);
  const openSheet = (record) => leave(() => onOpenEroForm(record));
  /* a file kept with a record opens on its own, with this modal out of the
     way; where the modal was goes with it, so closing the file brings the
     modal back on the same asset and the same tab */
  const openFile = (file) => leave(() => { onClose(); onOpenFile?.(file, { lockedAssetTag, initialAssetTag: assetTag, initialTab: tab }); });
  useEscapeKey(!busy && !askDiscard, requestClose);
  useEscapeKey(!!askDiscard, () => setAskDiscard(false));
  useDialogFocus(panel);

  const showForm = (historicView === "form" && (!editing || liveEditing)) || (asset && assetRecords.length === 0);
  const tabButton = (key, label) => (
    <button key={key} type="button" onClick={() => setTab(key)} className="px-3 py-2 text-sm"
      style={{ borderRadius: 10, border: `1px solid ${tab === key ? C.brandEdge : C.rule}`, background: tab === key ? C.brand : C.surface, color: tab === key ? C.brandInk : C.ink, fontWeight: 600 }}>
      {label}
    </button>
  );

  return (
    <div className="ams-scrim fixed inset-0 z-50 flex items-end sm:items-center justify-center sm:p-6">
      <div className="relative w-full" style={{ maxWidth: MAINTENANCE_MODAL_W }}>
      <div ref={panel} tabIndex={-1} role="dialog" aria-modal="true" aria-labelledby={titleId}
        className="w-full flex flex-col" style={{ height: MAINTENANCE_MODAL_H, background: C.surface, borderRadius: 2, border: `1px solid ${C.rule}`, outline: "none" }}>

        <div className="flex items-start justify-between px-5 py-4" style={{ borderBottom: `1px solid ${C.ruleSoft}`, flexShrink: 0 }}>
          <div id={titleId} style={{ fontSize: 17, fontWeight: 600 }}>Add Maintenance</div>
          <button type="button" onClick={requestClose} disabled={busy} aria-label="Close" style={{ color: C.mute }} className="p-1 hover:opacity-60 disabled:opacity-40"><X size={18} /></button>
        </div>

        <div className="px-5 pt-4" style={{ flexShrink: 0 }}>
          <div className="grid grid-cols-2 gap-x-4">
            <Field f={assetField} value={assetTag} onChange={(v) => changeField("assetTag", v)} />
          </div>
        </div>

        <div className="flex gap-2 px-5 pt-4" style={{ flexShrink: 0 }}>
          {tabButton("upcoming", "Upcoming")}
          {tabButton("historic", "Historic")}
        </div>

        <div style={tabPanel(tab === "upcoming")}>
          <div style={tabBody}>
            <div className="px-5 pt-4" style={{ fontSize: 13, color: C.mute, lineHeight: 1.5 }}>{def.note}</div>
            <div className="grid grid-cols-2 gap-x-4 gap-y-3 p-5">
              {restFields.map((f) => <Field key={f.key} f={f} value={vals[f.key] ?? ""} onChange={(v) => changeField(f.key, v)} />)}
            </div>
            {err && (
              <div className="mx-5 mb-3 flex items-start gap-2 px-3 py-2" style={{ background: STAGES.broken.tint, color: STAGES.broken.color, fontSize: 13, lineHeight: 1.45 }}>
                <AlertCircle size={14} style={{ marginTop: 2, flexShrink: 0 }} />
                <span>{err}</span>
              </div>
            )}
          </div>
          <div className="flex items-center justify-end gap-2 px-5 py-4" style={{ borderTop: `1px solid ${C.ruleSoft}`, background: C.soft, ...tabFoot }}>
            <Btn onClick={requestClose} disabled={busy}>Cancel</Btn>
            <Btn kind="solid" onClick={go} disabled={busy}>{busy ? "Saving…" : def.submit}</Btn>
          </div>
        </div>

        <div style={tabPanel(tab === "historic")}>
          {!asset ? (<>
            <div className="p-5" style={tabBody}>
              <div className="px-4 py-6 text-center" style={{ border: `1px dashed ${C.rule}`, fontSize: 13, color: C.mute, lineHeight: 1.5 }}>
                Choose an asset above to see its maintenance history or write up a job that was done.
              </div>
            </div>
            <div className="flex items-center justify-end gap-2 px-5 py-4" style={{ borderTop: `1px solid ${C.ruleSoft}`, background: C.soft, ...tabFoot }}>
              <Btn onClick={requestClose} disabled={busy}>Close</Btn>
            </div>
          </>) : !showForm ? (<>
            <div style={tabBody}>
            <div className="px-5 pt-4" style={{ fontSize: 13, color: C.mute, lineHeight: 1.5 }}>
              This asset already has {assetRecords.length} historic {assetRecords.length === 1 ? "record" : "records"}. Review one below, or add another.
            </div>
            <div className="px-5 pt-3 pb-4">
              <div style={{ border: `1px solid ${C.ruleSoft}` }}>
                {assetRecords.map((record) => (
                  <div key={record.id} className="flex flex-wrap items-center gap-x-4 gap-y-1 px-3 py-2.5" style={{ borderBottom: `1px solid ${C.ruleSoft}` }}>
                    <div style={{ fontFamily: MONO, fontSize: 12.5, minWidth: 96 }}>{fmt(record.startedOn)}</div>
                    <div className="flex-1 min-w-0" style={{ minWidth: 150 }}>
                      <div style={{ fontSize: 13.5, fontWeight: 600 }}>{maintenanceRecordTypeLabel(record.type)}{record.eroCode ? <span style={{ fontFamily: MONO, fontWeight: 400, color: C.mute, marginLeft: 8 }}>{record.eroCode}</span> : null}</div>
                      <div style={{ fontSize: 12.5, color: C.mute }}>
                        {[record.assignedTo && `Assigned to ${record.assignedTo}`, record.failureCause].filter(Boolean).join(" · ") || "No details recorded"}
                        {/* that files are kept with it: resting on the clip lists
                            them, and choosing one opens it */}
                        {record.files?.length ? <HistoryFilesPop files={record.files} onOpen={openFile} /> : null}
                      </div>
                    </div>
                    {/* the state and the two ways into the record travel
                        together, so a longer line of detail never splits them
                        across two rows */}
                    <div className="flex items-center gap-2 flex-shrink-0">
                      <Chip color={record.completedOn ? C.ok : C.due} tint={record.completedOn ? TINT.ok : TINT.warn}>
                        {record.completedOn ? `Completed ${fmt(record.completedOn)}` : record.finishedOn ? `Finished ${fmt(record.finishedOn)}` : "In progress"}
                      </Chip>
                      <Btn small icon={FileText} onClick={() => openSheet(record)}>ERO form</Btn>
                      <Btn small icon={Eye} onClick={() => { setEditing(record); setHistoricView("form"); }}>{isSuperAdmin ? "Review / edit" : "Review"}</Btn>
                    </div>
                  </div>
                ))}
              </div>
            </div>
            </div>
            <div className="flex items-center justify-end gap-2 px-5 py-4" style={{ borderTop: `1px solid ${C.ruleSoft}`, background: C.soft, ...tabFoot }}>
              <Btn onClick={requestClose} disabled={busy}>Close</Btn>
              <Btn kind="solid" icon={Plus} onClick={() => { setEditing(null); setHistoricView("form"); }} disabled={busy}>Add historic record</Btn>
            </div>
          </>) : (
            <HistoricMaintenanceForm key={liveEditing?.id || `new-${asset.id}`} record={liveEditing} asset={asset}
              readOnly={!!liveEditing && !isSuperAdmin} canDelete={!!liveEditing && isSuperAdmin} busy={busy}
              onOpenForm={liveEditing ? () => openSheet(liveEditing) : undefined}
              onOpenFile={onOpenFile}
              showBack={assetRecords.length > 0}
              onBack={() => { setEditing(null); setHistoricView("list"); }}
              onCancel={requestClose}
              onDirtyChange={setHistoricDirty}
              onDelete={() => onDeleteRecord(liveEditing)}
              onSave={async (value) => {
                const saved = await onSaveRecord(liveEditing?.id || null, asset.id, value);
                if (saved) { setHistoricDirty(false); setEditing(null); setHistoricView("list"); }
              }} />
          )}
        </div>

        {askDiscard && <DiscardPrompt onKeep={() => setAskDiscard(false)} onDiscard={() => { const { then } = askDiscard; setAskDiscard(false); then(); }} />}
      </div>
      </div>
    </div>
  );
}

/* One historic job, laid out the way the Equipment Repair Order is: the
   header, the details table (who repaired it, hours for repair and for
   P.M., the parts and supplies lines), contracted repairs and totals, then
   completion and sign-off. Amount on a parts line and the parts total are
   worked out from quantity and unit cost as they are typed, and stay open to
   correction. Date Completed follows the finish date until it is set by
   hand. Read-only for anyone but the super admin once it has been saved. */
function HistoricMaintenanceForm({ record, asset = {}, readOnly = false, canDelete = false, busy = false, showBack = false, onBack, onCancel, onSave, onDelete, onDirtyChange, onOpenForm, onOpenFile }) {
  const seed = useMemo(() => ({
    ...emptyMaintenanceRecord(), ...(record || {}),
    parts: record?.parts?.length ? record.parts : [blankMaintenancePartLine()],
    files: historyFileEntries(record),
  }), [record]);
  const [vals, setVals] = useState(seed);
  const [err, setErr] = useState("");
  const snapshot = (v) => JSON.stringify({ ...v, id: undefined, assetId: undefined, createdAt: undefined, updatedAt: undefined });
  const dirty = !readOnly && snapshot(vals) !== snapshot(seed);
  useEffect(() => { onDirtyChange?.(dirty); }, [dirty, onDirtyChange]);
  useEffect(() => () => onDirtyChange?.(false), [onDirtyChange]);

  const set = (key, value) => { setVals((v) => ({ ...v, [key]: value })); setErr(""); };
  const lock = readOnly ? { background: C.soft, color: C.mute, cursor: "not-allowed" } : {};
  const box = { ...inputStyle, ...lock };
  const cell = { ...box, minHeight: 34, padding: "6px 8px", fontSize: 13, borderRadius: 8 };
  const text = (key, extra = {}) => <input style={extra.mono ? { ...box, fontFamily: MONO } : box} value={vals[key] ?? ""} readOnly={readOnly} placeholder={extra.placeholder} onChange={(e) => set(key, e.target.value)} />;
  const date = (key, onChange) => <input type="date" style={box} value={vals[key] ?? ""} readOnly={readOnly} onChange={(e) => (onChange || ((v) => set(key, v)))(e.target.value)} />;
  const area = (key, rows = 2) => <textarea rows={rows} style={box} value={vals[key] ?? ""} readOnly={readOnly} onChange={(e) => set(key, e.target.value)} />;
  const field = (label, control, { full, required, hint } = {}) => (
    <div className={full ? "col-span-2" : "col-span-2 sm:col-span-1"}>
      <Label>{label}{required && <span style={{ color: STAGES.broken.color }}> *</span>}</Label>
      {control}
      {hint && <div className="mt-1" style={{ fontSize: 11.5, color: C.mute }}>{hint}</div>}
    </div>
  );
  const section = (title) => <div className="col-span-2 ams-section-title" style={{ marginTop: 6 }}>{title}</div>;
  /* off the asset, never typed: what the paper calls the equipment */
  const equipment = eroEquipment(asset);
  const fixed = (value) => <div style={{ ...inputStyle, background: C.soft, color: value ? C.ink : C.mute, display: "flex", alignItems: "center", cursor: "default" }}>{value || "—"}</div>;
  const span = (to) => { const label = spanLabel(vals.startedOn, to); return label ? `(${label})` : ""; };

  const totalOf = (lines) => lines.reduce((sum, line) => sum + num(line.amount), 0);
  const withTotal = (v, lines) => ({ ...v, parts: lines, partsTotal: lines.some((line) => String(line.amount).trim()) ? totalOf(lines).toFixed(2) : v.partsTotal });
  const setLine = (index, key, value) => {
    setVals((v) => withTotal(v, v.parts.map((line, i) => {
      if (i !== index) return line;
      const next = { ...line, [key]: value };
      if (key === "qty" || key === "unitCost") {
        const qty = parseFloat(next.qty), unit = parseFloat(next.unitCost);
        if (!isNaN(qty) && !isNaN(unit)) next.amount = (qty * unit).toFixed(2);
      }
      return next;
    })));
    setErr("");
  };
  const addLine = () => setVals((v) => ({ ...v, parts: [...v.parts, blankMaintenancePartLine()] }));
  const removeLine = (index) => setVals((v) => { const kept = v.parts.filter((_, i) => i !== index); return withTotal(v, kept.length ? kept : [blankMaintenancePartLine()]); });
  const setFinished = (value) => setVals((v) => ({ ...v, finishedOn: value, completedOn: !v.completedOn || v.completedOn === v.finishedOn ? value : v.completedOn }));

  const go = () => {
    if (!String(vals.startedOn || "").trim()) return setErr("Fill in the start date.");
    onSave(vals);
  };

  const th = { padding: "7px 8px", fontSize: 10.5, fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase", color: C.mute, textAlign: "left", background: C.soft, borderBottom: `1px solid ${C.rule}`, whiteSpace: "nowrap" };
  const sub = { ...th, fontWeight: 600, textTransform: "none", letterSpacing: 0, fontSize: 11.5 };
  const td = { padding: "5px 6px", verticalAlign: "top", borderBottom: `1px solid ${C.ruleSoft}` };
  const lineInput = (index, key, extra = {}) => (
    <input style={{ ...cell, ...(extra.mono ? { fontFamily: MONO } : {}), ...(extra.right ? { textAlign: "right" } : {}) }} value={vals.parts[index][key] ?? ""} readOnly={readOnly}
      placeholder={extra.placeholder} onChange={(e) => setLine(index, key, e.target.value)} aria-label={`${extra.label || key} line ${index + 1}`} />
  );

  return (<>
    <div style={{ flex: 1, minHeight: 0, overflowY: "auto" }}>
    {!record && !showBack && (
      <div className="px-5 pt-4" style={{ fontSize: 13, color: C.mute, lineHeight: 1.5 }}>No historic records for this asset yet. Write up the first one below.</div>
    )}
    {readOnly && (
      <div className="mx-5 mt-4 flex items-start gap-2 px-3 py-2" style={{ background: TINT.info, color: C.active, fontSize: 12.5, lineHeight: 1.45 }}>
        <AlertCircle size={14} style={{ marginTop: 2, flexShrink: 0 }} />
        <span>Saved records can only be changed or deleted by a super admin. You are viewing this one.</span>
      </div>
    )}
    <div className="grid grid-cols-2 gap-x-4 gap-y-3 p-5">
      {field("What maintenance", (
        <select style={box} value={vals.type} disabled={readOnly} onChange={(e) => set("type", e.target.value)}>
          {MAINTENANCE_RECORD_TYPES.map((type) => <option key={type.value} value={type.value}>{type.label}</option>)}
        </select>
      ), { required: true })}
      {field("ERO Code", text("eroCode", { mono: true, placeholder: "2600588" }))}
      {field("Code", (<>
        <input style={box} list="ams-ero-code-options" value={vals.repairPlace ?? ""} readOnly={readOnly} placeholder="Field, Yard or Contracted outside"
          onChange={(e) => set("repairPlace", e.target.value)} />
        {!readOnly && <datalist id="ams-ero-code-options">{REPAIR_PLACES.map((place) => <option key={place} value={place} />)}</datalist>}
      </>), { hint: "Where the repair took place, as written on the form" })}
      {field("Date (start)", date("startedOn"), { required: true })}
      {field("Assigned to", text("assignedTo"))}
      {section("Equipment")}
      {field("Equipment type", fixed(equipment.type), { hint: "The asset's name" })}
      {field("SN / PN", fixed(equipment.snPn), { hint: asset.plate ? "Plate number" : "Serial number" })}
      {field("I.D / BD", fixed(equipment.idBd), { hint: "Body number" })}
      {field("Mileage / Hours", text("mileageHours", { mono: true }))}
      {field("Location", text("location", { placeholder: asset.location || "" }))}
      {field("Describe failure or cause", area("failureCause", 3), { full: true })}

      {section("Details")}
      <div className="col-span-2" style={{ overflowX: "auto" }}>
        <table style={{ width: "100%", minWidth: 680, borderCollapse: "separate", borderSpacing: 0, border: `1px solid ${C.rule}`, borderRadius: 10, overflow: "hidden" }}>
          <thead>
            <tr>
              <th style={th}>Repaired by</th>
              <th style={th}>Repair</th>
              <th style={th}>P.M.</th>
              <th style={{ ...th, textAlign: "center", borderLeft: `1px solid ${C.rule}` }} colSpan={readOnly ? 5 : 6}>Parts &amp; supplies</th>
            </tr>
            <tr>
              <th style={sub}>Name</th>
              <th style={sub}>Hours</th>
              <th style={sub}>Hours</th>
              <th style={{ ...th, borderLeft: `1px solid ${C.rule}` }}>Qty.</th>
              <th style={th}>Parts#</th>
              <th style={th}>Description</th>
              <th style={th}>Unit cost</th>
              <th style={th}>Amount</th>
              {!readOnly && <th style={th} aria-label="Remove line" />}
            </tr>
          </thead>
          <tbody>
            {vals.parts.map((line, index) => (
              <tr key={index}>
                {index === 0 && (<>
                  <td style={{ ...td, width: 150 }} rowSpan={vals.parts.length}><input style={cell} value={vals.repairedBy} readOnly={readOnly} onChange={(e) => set("repairedBy", e.target.value)} aria-label="Repaired by name" /></td>
                  <td style={{ ...td, width: 76 }} rowSpan={vals.parts.length}><input style={{ ...cell, fontFamily: MONO }} value={vals.repairHours} readOnly={readOnly} onChange={(e) => set("repairHours", e.target.value)} aria-label="Repair hours" /></td>
                  <td style={{ ...td, width: 76 }} rowSpan={vals.parts.length}><input style={{ ...cell, fontFamily: MONO }} value={vals.pmHours} readOnly={readOnly} onChange={(e) => set("pmHours", e.target.value)} aria-label="P.M. hours" /></td>
                </>)}
                <td style={{ ...td, width: 58, borderLeft: `1px solid ${C.rule}` }}>{lineInput(index, "qty", { mono: true, right: true, label: "Qty" })}</td>
                <td style={{ ...td, width: 96 }}>{lineInput(index, "partNo", { mono: true, label: "Parts#" })}</td>
                <td style={td}>{lineInput(index, "description", { label: "Description" })}</td>
                <td style={{ ...td, width: 92 }}>{lineInput(index, "unitCost", { mono: true, right: true, label: "Unit cost" })}</td>
                <td style={{ ...td, width: 96 }}>{lineInput(index, "amount", { mono: true, right: true, label: "Amount" })}</td>
                {!readOnly && (
                  <td style={{ ...td, width: 34 }}>
                    <button type="button" onClick={() => removeLine(index)} aria-label={`Remove parts line ${index + 1}`} className="p-1 hover:opacity-60" style={{ color: C.mute, marginTop: 4 }}><X size={14} /></button>
                  </td>
                )}
              </tr>
            ))}
          </tbody>
          {!readOnly && (
            <tfoot>
              <tr>
                <td colSpan={9} style={{ padding: "6px 8px", background: C.soft }}>
                  <Btn small icon={Plus} onClick={addLine}>Add part</Btn>
                </td>
              </tr>
            </tfoot>
          )}
        </table>
      </div>

      {section("Contracted repairs")}
      {field("Vendor", text("vendor"))}
      {field("Address", text("vendorAddress"))}
      {field("Date (finish)", date("finishedOn", setFinished), { hint: span(vals.finishedOn) ? `From the start date ${span(vals.finishedOn)}` : "How long the job ran shows here once both dates are set" })}
      <div className="col-span-2 sm:col-span-1 grid grid-cols-2 gap-x-4">
        {field("Parts", <input type="number" min="0" step="0.01" style={{ ...box, fontFamily: MONO }} value={vals.partsTotal ?? ""} readOnly={readOnly} onChange={(e) => set("partsTotal", e.target.value)} />, { hint: "Total of the parts lines" })}
        {field("Labor", <input type="number" min="0" step="0.01" style={{ ...box, fontFamily: MONO }} value={vals.laborTotal ?? ""} readOnly={readOnly} onChange={(e) => set("laborTotal", e.target.value)} />, { hint: "Total labor cost" })}
      </div>

      {section("Completion")}
      {field("Date completed", date("completedOn"), { hint: span(vals.completedOn) ? `Duration from the start date ${span(vals.completedOn)}` : "Follows the finish date until you set it" })}
      {field("Idle time / downtime", text("downtime"))}
      {field("Mechanic operator signature", text("mechanicOperator"))}
      {field("Assistant supervisor", text("assistantSupervisor"))}
      {field("Supervisor", text("supervisor"))}
      {field("Department head / General manager", text("departmentHead"))}
      {field("Remarks", area("remarks", 3), { full: true })}

      {/* kept with the record, never printed: the ERO sheet does not know
          these exist */}
      {section("Attachments")}
      {field("Files kept with this record", (
        <AttachmentRows
          f={{ plain: true, readOnly, accept: HISTORY_ACCEPT, onOpen: onOpenFile,
            empty: readOnly ? "No files were kept with this record." : "Nothing attached yet. A quotation, an invoice, a photo of the failed part or the signed sheet can go on here." }}
          value={vals.files} onChange={(v) => set("files", v)} />
      ), { full: true, hint: readOnly ? undefined : "Optional. PDF, Word (DOC or DOCX), JPG or PNG, up to 10 MB each. These stay with the record only: the ERO form, its PDF and the printed sheet never show them." })}
    </div>
    {err && (
      <div className="mx-5 mb-3 flex items-start gap-2 px-3 py-2" style={{ background: STAGES.broken.tint, color: STAGES.broken.color, fontSize: 13, lineHeight: 1.45 }}>
        <AlertCircle size={14} style={{ marginTop: 2, flexShrink: 0 }} />
        <span>{err}</span>
      </div>
    )}
    </div>
    <div className="flex flex-wrap items-center gap-2 px-5 py-4" style={{ borderTop: `1px solid ${C.ruleSoft}`, background: C.soft, flexShrink: 0 }}>
      {showBack && <Btn small icon={ChevronLeft} onClick={onBack} disabled={busy}>Back to list</Btn>}
      {onOpenForm && <Btn small icon={FileText} onClick={onOpenForm} disabled={busy}>ERO form</Btn>}
      {canDelete && <Btn small kind="danger" icon={Trash2} onClick={onDelete} disabled={busy}>Delete record</Btn>}
      <span className="flex-1" />
      <Btn onClick={onCancel} disabled={busy}>Cancel</Btn>
      {!readOnly && <Btn kind="solid" onClick={go} disabled={busy}>{busy ? "Saving…" : record ? "Save changes" : "Save record"}</Btn>}
    </div>
  </>);
}

function MaintenanceTab({ plans, assets, onAdd, onLog, onEdit, onDelete, onOpenAsset, canManage = false, canDelete = false }) {
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
            style={{ borderRadius: 10, border: `1px solid ${scope === k ? C.brandEdge : C.rule}`, background: scope === k ? C.brand : C.surface, color: scope === k ? C.brandInk : C.ink, fontWeight: 600 }}>{l}</button>
        ))}
      </div>
      {canManage && <Btn kind="solid" icon={Plus} onClick={onAdd}>Add Maintenance</Btn>}
    </div>

    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4">
      {[["Overdue", overdue, C.overdue], ["Due this week", bucket("week"), C.due], ["Due this month", bucket("month"), C.active], ["Spent on maintenance", money0(spent), C.ok]].map(([l, v, col]) => (
        <MetricTile key={l} label={l} value={v} tone={col} />
      ))}
    </div>

    <div className="ams-table-frame" style={{ background: C.surface }}>
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
                <RecordTag>{a.tag}</RecordTag>
                <div className="truncate" style={{ fontSize: 12.5, color: C.mute, maxWidth: 170, marginTop: 3 }}>{a.name}</div>
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
                {canDelete && <Btn small kind="danger" icon={Trash2} onClick={() => onDelete(p)}>{""}</Btn>}
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
      <div><div className="ams-section-title" style={{ fontSize: 18 }}>Purchasing report</div><div style={{ color: C.mute, fontSize: 13 }}>Limited to parts and purchasing records inside your assigned company and asset-group scope.</div></div>
      <Btn icon={Download} onClick={exportRows}>Export purchasing report</Btn>
    </div>
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-4">
      {[["Part lines", rows.length, C.ink], ["Needed", rows.filter((row) => row.part.state === "Needed").length, PART_COLOR.Needed], ["Ordered value", money0(ordered), PART_COLOR.Ordered], ["Purchased value", money0(purchased), PART_COLOR.Purchased]].map(([label, value, color]) => (
        <MetricTile key={label} label={label} value={value} tone={color} />
      ))}
    </div>
    <div className="flex flex-wrap gap-2 mb-4">
      <div className="relative flex-1" style={{ minWidth: 250 }}><Search size={15} style={{ color: C.mute, position: "absolute", left: 11, top: 13 }} /><input value={q} onChange={(event) => setQ(event.target.value)} placeholder="Search part, supplier, order, ticket, asset, company" style={{ ...inputStyle, paddingLeft: 34 }} /></div>
      <select value={state} onChange={(event) => setState(event.target.value)} style={{ ...inputStyle, width: "auto", minWidth: 160 }}><option value="">All states</option>{PART_STATES.map((value) => <option key={value}>{value}</option>)}</select>
    </div>
    <div className="ams-table-frame overflow-x-auto" style={{ background: C.surface }}>
      <table className="ams-table" style={{ minWidth: 920 }}>
        <thead><tr style={{ background: C.soft }}>{["Ticket", "Asset", "Company", "Part", "State", "Qty", "Unit price", "Total", "Supplier / order"].map((heading) => <th key={heading} className="text-left px-3 py-2" style={{ color: C.mute, borderBottom: `1px solid ${C.rule}` }}>{heading}</th>)}</tr></thead>
        <tbody>{rows.length === 0 ? <tr><td colSpan={9} className="p-10 text-center" style={{ color: C.mute }}>No purchasing records match this view.</td></tr> : rows.map(({ part, repair, asset, total }) => (
          <tr key={`${repair.id}-${part.id}`} style={{ borderBottom: `1px solid ${C.ruleSoft}` }}><td className="px-3 py-2" style={{ fontFamily: MONO }}>{repair.ticket}</td><td className="px-3 py-2">{asset.tag} · {asset.name}</td><td className="px-3 py-2">{asset.company || "—"}</td><td className="px-3 py-2">{part.name}</td><td className="px-3 py-2"><Chip color={PART_COLOR[part.state] || C.mute} tint={part.state === "Purchased" ? TINT.ok : part.state === "Ordered" ? TINT.warn : TINT.alarm}>{part.state}</Chip></td><td className="px-3 py-2">{num(part.qty) || 1}</td><td className="px-3 py-2" style={{ fontFamily: MONO }}>{money(part.unit)}</td><td className="px-3 py-2" style={{ fontFamily: MONO, fontWeight: 700 }}>{money(total)}</td><td className="px-3 py-2">{[part.supplier, part.ref].filter(Boolean).join(" · ") || "—"}</td></tr>
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
    <div className="ams-table-frame grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-7 gap-3 mb-4 px-4 py-4" style={{ background: C.surface }}>
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
      {[["Assets in query", rows.length, C.ink], ["Total asset value", money0(T.value), C.active],
        ["Total repair cost", money0(T.rep), STAGES.ongoing.color], ["Total maintenance cost", money0(T.mnt), C.ok]].map(([l, v, col]) => (
        <MetricTile key={l} label={l} value={v} tone={col} />
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
    <div className="ams-table-frame overflow-x-auto" style={{ background: C.surface }}>
      <table className="ams-table" style={{ minWidth: 1060 }}>
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
              <td style={{ padding: "8px 10px" }}><RecordTag>{r.tag}</RecordTag></td>
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
