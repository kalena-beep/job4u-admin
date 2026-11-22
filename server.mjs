import http from "node:http";
import crypto from "node:crypto";
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { Pool } from "pg";
import "dotenv/config";

const __dirname = path.resolve();
const PORT = Number(process.env.PORT || 5174);
const ADMIN_EMAIL = (process.env.ADMIN_EMAIL || "admin@jobs4u.sg").trim().toLowerCase();
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "admin123";
const CV_DIR = path.resolve(
  process.env.CV_UPLOAD_DIR || path.resolve(__dirname, "../job4u/secure_uploads/cvs")
);

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

const activeTokens = new Set();

const MIME_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
};

const VALID_STATUSES = new Set(["NEW", "REVIEWED", "SHORTLISTED", "REJECTED"]);

function sendJson(res, status, data) {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(data));
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let raw = "";
    req.on("data", (chunk) => {
      raw += chunk;
      if (raw.length > 1_000_000) {
        reject(new Error("Payload too large"));
        req.destroy();
      }
    });
    req.on("end", () => {
      if (!raw) return resolve({});
      try {
        resolve(JSON.parse(raw));
      } catch {
        reject(new Error("Invalid JSON body"));
      }
    });
    req.on("error", reject);
  });
}

function extractToken(req, urlObj) {
  const authHeader = req.headers.authorization || "";
  if (authHeader.startsWith("Bearer ")) {
    return authHeader.slice(7).trim();
  }
  return (urlObj.searchParams.get("token") || "").trim();
}

function isAuthorized(req, urlObj) {
  const token = extractToken(req, urlObj);
  return Boolean(token && activeTokens.has(token));
}

function slugify(text) {
  return String(text || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

async function generateUniqueSlug(title, company, excludeId = null) {
  const base = slugify(`${title}-${company}`) || `job-${Date.now()}`;
  let candidate = base;
  let counter = 2;

  while (true) {
    const params = excludeId ? [candidate, excludeId] : [candidate];
    const sql = excludeId
      ? `SELECT 1 FROM "Job" WHERE "slug" = $1 AND "id" <> $2 LIMIT 1`
      : `SELECT 1 FROM "Job" WHERE "slug" = $1 LIMIT 1`;
    const { rowCount } = await pool.query(sql, params);
    if (!rowCount) return candidate;
    candidate = `${base}-${counter}`;
    counter += 1;
  }
}

async function serveStatic(req, res, pathname) {
  const relPath = pathname === "/" ? "/admin.html" : pathname;
  const safePath = path.normalize(relPath).replace(/^(\.\.[/\\])+/, "");
  const fullPath = path.join(__dirname, safePath);

  if (!fullPath.startsWith(__dirname + path.sep) && fullPath !== __dirname) {
    res.writeHead(403);
    return res.end("Forbidden");
  }

  try {
    const stat = await fsp.stat(fullPath);
    if (stat.isDirectory()) {
      res.writeHead(403);
      return res.end("Forbidden");
    }
    const ext = path.extname(fullPath).toLowerCase();
    res.writeHead(200, { "Content-Type": MIME_TYPES[ext] || "application/octet-stream" });
    fs.createReadStream(fullPath).pipe(res);
  } catch {
    res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
    res.end("Not found");
  }
}

const server = http.createServer(async (req, res) => {
  const urlObj = new URL(req.url || "/", `http://${req.headers.host || `localhost:${PORT}`}`);
  const pathname = urlObj.pathname;
  const method = req.method || "GET";

  if (!pathname.startsWith("/api/")) {
    return serveStatic(req, res, pathname);
  }

  try {
    // --- AUTH ---
    if (pathname === "/api/auth/login" && method === "POST") {
      const body = await readBody(req);
      const email = String(body.email || "").trim().toLowerCase();
      const password = String(body.password || "");

      if (!email || !password) {
        return sendJson(res, 400, { message: "Email and password are required." });
      }

      if (email !== ADMIN_EMAIL || password !== ADMIN_PASSWORD) {
        return sendJson(res, 401, { message: "Invalid email or password." });
      }

      const token = crypto.randomBytes(24).toString("hex");
      activeTokens.add(token);
      return sendJson(res, 200, { token, email: ADMIN_EMAIL });
    }

    if (pathname === "/api/auth/logout" && method === "POST") {
      const token = extractToken(req, urlObj);
      if (token) activeTokens.delete(token);
      return sendJson(res, 200, { loggedOut: true });
    }

    // Protect all other /api/* routes
    if (!isAuthorized(req, urlObj)) {
      return sendJson(res, 401, { message: "Unauthorized. Please sign in again." });
    }

    // --- JOBS ---
    if (pathname === "/api/jobs" && method === "GET") {
      const { rows } = await pool.query(
        `SELECT * FROM "Job" ORDER BY "createdAt" DESC NULLS LAST, "id" DESC`
      );
      return sendJson(res, 200, { jobs: rows });
    }

    if (pathname === "/api/jobs" && method === "POST") {
      const body = await readBody(req);
      const title = String(body.title || "").trim();
      const company = String(body.company || "").trim();
      const description = String(body.description || "").trim();
      const location = String(body.location || "Singapore").trim();
      const employmentType = String(body.employmentType || "Full-time").trim();
      const workMode = body.workMode ? String(body.workMode).trim() : "On-site";
      const salary = body.salary ? String(body.salary).trim() : null;
      const whatsappNumber = body.whatsappNumber ? String(body.whatsappNumber).trim() : null;
      const published = body.published === undefined ? true : Boolean(body.published);
      const featured = Boolean(body.featured);

      if (!title || !company || !description) {
        return sendJson(res, 400, { message: "Title, company, and description are required." });
      }

      const slug = await generateUniqueSlug(title, company);

      const { rows } = await pool.query(
        `INSERT INTO "Job" (
          "slug", "title", "company", "description", "location",
          "employmentType", "workMode", "salary", "whatsappNumber",
          "published", "featured", "createdAt", "updatedAt"
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, NOW(), NOW())
        RETURNING *`,
        [
          slug,
          title,
          company,
          description,
          location,
          employmentType,
          workMode,
          salary,
          whatsappNumber,
          published,
          featured,
        ]
      );

      return sendJson(res, 201, { job: rows[0] });
    }

    const jobMatch = pathname.match(/^\/api\/jobs\/([^/]+)$/);
    if (jobMatch) {
      const jobId = decodeURIComponent(jobMatch[1]);

      if (method === "PATCH") {
        const body = await readBody(req);
        const { rows: existingRows } = await pool.query(
          `SELECT * FROM "Job" WHERE "id"::text = $1 LIMIT 1`,
          [jobId]
        );
        const current = existingRows[0];
        if (!current) {
          return sendJson(res, 404, { message: "Job not found." });
        }

        const title = body.title !== undefined ? String(body.title).trim() : current.title;
        const company = body.company !== undefined ? String(body.company).trim() : current.company;
        const description =
          body.description !== undefined ? String(body.description).trim() : current.description;
        const location =
          body.location !== undefined ? String(body.location).trim() : current.location;
        const employmentType =
          body.employmentType !== undefined
            ? String(body.employmentType).trim()
            : current.employmentType;
        const workMode =
          body.workMode !== undefined
            ? body.workMode
              ? String(body.workMode).trim()
              : null
            : current.workMode;
        const salary =
          body.salary !== undefined
            ? body.salary
              ? String(body.salary).trim()
              : null
            : current.salary;
        const whatsappNumber =
          body.whatsappNumber !== undefined
            ? body.whatsappNumber
              ? String(body.whatsappNumber).trim()
              : null
            : current.whatsappNumber;
        const published =
          body.published !== undefined ? Boolean(body.published) : Boolean(current.published);
        const featured =
          body.featured !== undefined ? Boolean(body.featured) : Boolean(current.featured);

        if (!title || !company || !description) {
          return sendJson(res, 400, { message: "Title, company, and description are required." });
        }

        const nextSlug =
          title !== current.title || company !== current.company
            ? await generateUniqueSlug(title, company, current.id)
            : current.slug;

        const { rows } = await pool.query(
          `UPDATE "Job"
           SET "slug" = $1, "title" = $2, "company" = $3, "description" = $4,
               "location" = $5, "employmentType" = $6, "workMode" = $7, "salary" = $8,
               "whatsappNumber" = $9, "published" = $10, "featured" = $11, "updatedAt" = NOW()
           WHERE "id"::text = $12
           RETURNING *`,
          [
            nextSlug,
            title,
            company,
            description,
            location,
            employmentType,
            workMode,
            salary,
            whatsappNumber,
            published,
            featured,
            jobId,
          ]
        );

        return sendJson(res, 200, { job: rows[0] });
      }

      if (method === "DELETE") {
        const { rowCount } = await pool.query(
          `DELETE FROM "Job" WHERE "id"::text = $1`,
          [jobId]
        );
        if (!rowCount) {
          return sendJson(res, 404, { message: "Job not found." });
        }
        return sendJson(res, 200, { deleted: true });
      }
    }

    // --- APPLICATIONS ---
    if (pathname === "/api/applications" && method === "GET") {
      const jobIdFilter = (urlObj.searchParams.get("jobId") || "").trim();
      const params = [];
      let whereClause = "";
      if (jobIdFilter) {
        params.push(jobIdFilter);
        whereClause = `WHERE a."jobId"::text = $1`;
      }

      const { rows } = await pool.query(
        `SELECT
          a.*,
          j."title" AS "jobTitle",
          j."company" AS "jobCompany",
          j."slug" AS "jobSlug"
         FROM "Application" a
         LEFT JOIN "Job" j ON j."id"::text = a."jobId"::text
         ${whereClause}
         ORDER BY a."createdAt" DESC NULLS LAST, a."id" DESC`,
        params
      );

      return sendJson(res, 200, { applications: rows });
    }

    const statusMatch = pathname.match(/^\/api\/applications\/([^/]+)\/status$/);
    if (statusMatch && method === "PATCH") {
      const appId = decodeURIComponent(statusMatch[1]);
      const body = await readBody(req);
      const nextStatus = String(body.status || "").trim().toUpperCase();

      if (!VALID_STATUSES.has(nextStatus)) {
        return sendJson(res, 400, {
          message: "Invalid status. Use NEW, REVIEWED, SHORTLISTED, or REJECTED.",
        });
      }

      const { rows } = await pool.query(
        `UPDATE "Application"
         SET "status" = $1, "updatedAt" = NOW()
         WHERE "id"::text = $2
         RETURNING *`,
        [nextStatus, appId]
      );

      if (!rows[0]) {
        return sendJson(res, 404, { message: "Application not found." });
      }

      return sendJson(res, 200, { application: rows[0] });
    }

    const cvMatch = pathname.match(/^\/api\/applications\/([^/]+)\/cv$/);
    if (cvMatch && method === "GET") {
      const appId = decodeURIComponent(cvMatch[1]);
      const { rows } = await pool.query(
        `SELECT "cvFileName", "cvFilePath" FROM "Application" WHERE "id"::text = $1 LIMIT 1`,
        [appId]
      );
      const app = rows[0];
      if (!app || (!app.cvFilePath && !app.cvFileName)) {
        return sendJson(res, 404, { message: "CV file not found." });
      }

      const candidatePath = app.cvFilePath
        ? path.resolve(app.cvFilePath)
        : path.resolve(CV_DIR, path.basename(app.cvFileName));

      const baseName = path.basename(candidatePath);
      const safeFile = path.join(CV_DIR, baseName);

      try {
        await fsp.access(safeFile, fs.constants.R_OK);
        const downloadName = app.cvFileName || baseName;
        res.writeHead(200, {
          "Content-Type": "application/octet-stream",
          "Content-Disposition": `attachment; filename="${downloadName.replace(/"/g, "")}"`,
        });
        return fs.createReadStream(safeFile).pipe(res);
      } catch {
        return sendJson(404, { message: "CV file missing on disk." });
      }
    }

    return sendJson(res, 404, { message: "API endpoint not found." });
  } catch (err) {
    return sendJson(500, {
      message: err instanceof Error ? err.message : "Internal server error",
    });
  }
});

server.listen(PORT, () => {
  console.log(`Jobs4U Admin server running at http://localhost:${PORT}/admin.html`);
});