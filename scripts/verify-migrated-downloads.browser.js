// Run only in the signed-in published app's developer console.
// GET requests only. Does not read cookies, write records, or send data elsewhere.
(async () => {
  const report = {
    check: "staff-file-downloads",
    version: 1,
    checkedAt: new Date().toISOString(),
    authenticated: false,
    inventoryComplete: false,
    inventoryErrors: [],
    categories: {},
    failures: [],
    providerConfirmed: false,
    cleanupApproved: false,
    scope: "References exposed by application lists; orphan uploads and provider activation are not verified.",
  };
  const groups = ["certificate PDFs", "templates", "signatures", "photos", "documents", "transfer attachments"];
  const files = new Map();
  for (const group of groups) report.categories[group] = { found: 0, passed: 0, failed: 0 };
  const get = (path, anonymous = false) => fetch(path, {
    method: "GET", credentials: anonymous ? "omit" : "same-origin",
    cache: "no-store", redirect: "error", signal: AbortSignal.timeout(30000),
  });
  const mime = response => (response.headers.get("content-type") || "").split(";")[0].trim().toLowerCase();
  async function list(path, label) {
    try {
      const response = await get(path);
      if (response.status !== 200 || mime(response) !== "application/json") {
        throw new Error("HTTP " + response.status);
      }
      const rows = await response.json();
      if (!Array.isArray(rows)) throw new Error("Unexpected list format");
      return rows;
    } catch {
      report.inventoryErrors.push(label + ": list unavailable or invalid");
      return [];
    }
  }
  function add(path, group, expected, size) {
    if (typeof path !== "string" || !path.startsWith("/api/") || path.includes("?") ||
        path.includes("#") || path.includes("\\") || path.includes("..")) {
      report.inventoryErrors.push(group + ": invalid file reference");
      return;
    }
    if (!files.has(path)) files.set(path, { groups: new Set(), expected: new Set(), sizes: new Set() });
    const file = files.get(path);
    file.groups.add(group);
    if (expected) file.expected.add(expected);
    if (Number.isSafeInteger(size) && size > 0) file.sizes.add(size);
  }
  function walk(value, fallback) {
    if (!value || typeof value !== "object") return;
    for (const [key, child] of Object.entries(value)) {
      if (["signaturePath", "picturePath", "objectPath"].includes(key) && child) {
        const group = key === "signaturePath" ? "signatures" : key === "picturePath" ? "photos" : fallback;
        if (typeof child !== "string" || !/^\/objects\/uploads\/[^/?#\\\s]+$/.test(child)) {
          report.inventoryErrors.push(group + ": unsupported object reference");
          continue;
        }
        const name = String(value.name || "").toLowerCase();
        const expected = ["signatures", "photos"].includes(group) ? "image" :
          name.endsWith(".pdf") ? "application/pdf" : name.endsWith(".txt") ? "text/plain" :
          /\.(png|jpe?g|webp)$/.test(name) ? "image" : null;
        add("/api/storage" + child, group, expected, value.size);
      } else if (child && typeof child === "object") walk(child, fallback);
    }
  }
  async function bytes(response) {
    const reader = response.body.getReader(), chunks = [];
    let length = 0;
    try {
      while (true) {
        const part = await reader.read();
        if (part.done) break;
        length += part.value.length;
        if (length > 25 * 1024 * 1024) throw new Error("Safety size limit");
        chunks.push(part.value);
      }
    } finally {
      await reader.cancel().catch(() => {});
    }
    const data = new Uint8Array(length);
    let offset = 0;
    for (const chunk of chunks) { data.set(chunk, offset); offset += chunk.length; }
    return data;
  }
  function formatOK(data, type) {
    const ascii = value => new TextDecoder("latin1").decode(value);
    const head = ascii(data.subarray(0, 1024));
    if (type === "application/pdf") return head.includes("%PDF-") && ascii(data.slice(-2048)).includes("%%EOF");
    if (type === "image/png") return [137, 80, 78, 71, 13, 10, 26, 10].every((n, i) => data[i] === n);
    if (type === "image/jpeg") return data[0] === 255 && data[1] === 216 && data[2] === 255;
    if (type === "image/webp") return head.startsWith("RIFF") && head.slice(8, 12) === "WEBP";
    if (type === "text/plain") {
      try { return !new TextDecoder("utf-8", { fatal: true }).decode(data).includes("\0"); } catch { return false; }
    }
    return false;
  }
  try {
    if (location.origin !== "https://shareholder-management.replit.app") throw new Error("wrong-origin");
    const auth = await get("/api/auth/user");
    if (auth.status !== 200 || mime(auth) !== "application/json" || !(await auth.json()).user) throw new Error("not-signed-in");
    report.authenticated = true;
    const sources = [
      ["/api/certificate-pdfs", "certificate PDFs"],
      ["/api/settings/certificate-templates", "templates"],
      ["/api/settings/signoffs", "signatures"],
      ["/api/shareholders", "documents"],
      ["/api/transfers", "transfer attachments"],
      ["/api/sign-off-history", "transfer attachments"],
    ];
    for (const [path, group] of sources) {
      const rows = await list(path, group);
      if (["certificate PDFs", "templates"].includes(group)) {
        for (const row of rows) {
          if (typeof row.id !== "string" || !row.id) {
            report.inventoryErrors.push(group + ": invalid record ID");
            continue;
          }
          add(path + "/" + encodeURIComponent(row.id) + (group === "templates" ? "/pdf" : ""),
            group, "application/pdf");
        }
      } else walk(rows, group);
    }
    report.inventoryComplete = report.inventoryErrors.length === 0;
    let index = 0;
    for (const [path, file] of files) {
      index++;
      let issue = null;
      try {
        const response = await get(path);
        const type = mime(response);
        if (response.status !== 200) throw new Error("HTTP " + response.status);
        const data = await bytes(response);
        if (!data.length || !formatOK(data, type)) throw new Error("Empty file or invalid format/MIME");
        for (const expected of file.expected) {
          if (expected === "image" ? !type.startsWith("image/") : type !== expected) throw new Error("Unexpected MIME");
        }
        for (const size of file.sizes) if (size !== data.length) throw new Error("Recorded size mismatch");
        const anonymous = await get(path, true);
        const denied = [401, 403].includes(anonymous.status) && mime(anonymous) === "application/json";
        await anonymous.body?.cancel();
        if (!denied) throw new Error("Anonymous API denial not confirmed");
      } catch (error) {
        const safe = ["Empty file or invalid format/MIME", "Unexpected MIME", "Recorded size mismatch",
          "Anonymous API denial not confirmed"];
        issue = safe.includes(error.message) || /^HTTP \d{3}$/.test(error.message) ?
          error.message : "Request failed, timed out, or exceeded safety size limit";
        report.failures.push({ file: index, categories: [...file.groups], issue });
      }
      for (const group of file.groups) {
        const summary = report.categories[group];
        summary.found++;
        summary[issue ? "failed" : "passed"]++;
      }
    }
    report.uniqueFiles = files.size;
    report.formatCheck = "MIME and file headers; PDF end marker; UTF-8 text. Not a full document parse or migration hash comparison.";
  } catch {
    report.inventoryErrors.push("Open the published app and complete staff sign-in before running this check.");
  }
  for (const result of Object.values(report.categories)) {
    result.result = !report.inventoryComplete ? "inventory incomplete" :
      !result.found ? "no references; untested" : result.failed ? "failed" : "passed";
  }
  console.log("FILE CHECK SUMMARY — copy only the JSON below");
  console.log(JSON.stringify(report, null, 2));
})();
