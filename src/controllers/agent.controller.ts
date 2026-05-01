// Student controller

import { Request, Response, NextFunction } from "express";
const XLSX = require("xlsx");
const mongoose = require("mongoose");

// very permissive schema to store arbitrary rows
const ExcelRowSchema = new mongoose.Schema({}, { strict: false });
const ExcelRow = mongoose.model("ExcelRow", ExcelRowSchema, "agents");

export class Agent {
  /**
   * Importing Agents
   * @param req 
   * @param res 
   * @param next 
   * @returns 
   */
  ctrlAddAgent = async (req: Request & { file?: any }, res: Response, next: NextFunction) => {
    try {
      if (!req.file) return res.status(400).json({ success: false, message: "No file uploaded" });
      const workbook = XLSX.read(req.file.buffer, { type: "buffer" });
      const sheetName = workbook.SheetNames[0];
      const sheet = workbook.Sheets[sheetName];
      const json = XLSX.utils.sheet_to_json(sheet, { defval: null }); // array of objects
      if (!Array.isArray(json) || json.length === 0) {
        return res.json({ success: false, message: "No rows found in sheet" });
      }

      // normalize rows: pincode -> array of strings; normalize email/mobile for matching
      const prepared = json.map((r: any) => {
        // pincode normalization
        const val = r.pincode ?? r.Pincode ?? r.pincode;
        if (val == null) {
          r.pincode = [];
        } else if (Array.isArray(val)) {
          r.pincode = val.map((v: any) => String(v).trim()).filter((s: string) => s !== "");
        } else {
          const str = String(val);
          const parts = str
            .split(/[,;|\/\s]+/)
            .map((p: string) => p.trim())
            .filter((p: string) => p !== "");
          r.pincode = parts.length ? parts : [str.trim()];
        }

        // normalize email and mobile for consistent duplicate detection
        if (r.Email != null) {
          r.Email = String(r.Email).trim().toLowerCase();
          if (r.Email === "") r.Email = null;
        } else {
          r.Email = null;
        }

        if (r.Mobile != null) {
          // strip non-digits for mobile comparison
          const m = String(r.Mobile).replace(/\D+/g, "");
          r.Mobile = m || null;
        } else {
          r.Mobile = null;
        }

        // keep original zone/region name fields normalized (trimmed) for lookup later
        if (r.Zone != null) r.Zone = String(r.Zone).trim();
        if (r.Region != null) r.Region = String(r.Region).trim();
        return r;
      });

      // load zones and regions maps from DB once
      let Zone: any;
      try {
        Zone = mongoose.model("Zone");
      } catch (e) {
        const ZoneSchema = new mongoose.Schema({ id: Number, name: String }, { strict: false });
        Zone = mongoose.model("Zone", ZoneSchema, "zones");
      }

      let Region: any;
      try {
        Region = mongoose.model("Region");
      } catch (e) {
        const RegionSchema = new mongoose.Schema({ id: Number, name: String, zoneId: Number, sme: String }, { strict: false });
        Region = mongoose.model("Region", RegionSchema, "regions");
      }

      const [zonesFromDb, regionsFromDb] = await Promise.all([
        Zone.find().lean().exec(),
        Region.find().lean().exec()
      ]);

      const zoneByName = new Map<string, any>();
      for (const z of zonesFromDb) {
        if (!z || !z.name) continue;
        zoneByName.set(String(z.name).trim().toLowerCase(), z);
      }

      const regionByName = new Map<string, any>();
      for (const r of regionsFromDb) {
        if (!r || !r.name) continue;
        regionByName.set(String(r.name).trim().toLowerCase(), r);
      }

      // enrich prepared rows with zoneId, regionId and region.sme when possible
      for (const row of prepared) {
        // zone lookup by name (case-insensitive)
        const zName = (row.Zone ?? row.zone ?? row.ZoneName ?? "").toString().trim().toLowerCase();
        if (zName) {
          const zDoc = zoneByName.get(zName);
          if (zDoc) {
            // use numeric id from zones documents (same as ctrlCreateZones)
            row.zoneId = zDoc.id ?? null;
            row.zoneName = zDoc.name ?? zName;
          }
        }

        // region lookup by name (case-insensitive)
        const rName = (row.Region ?? row.region ?? row.RegionName ?? "").toString().trim().toLowerCase();
        if (rName) {
          const rDoc = regionByName.get(rName);
          if (rDoc) {
            row.regionId = rDoc.regionId ?? null;
            row.regionName = rDoc.name ?? rName;
            // attach SME from region doc if present
            row.regionSme = rDoc.sme ?? null;
            // ensure zoneId consistent with region's zoneId if missing
            if (!row.zoneId && rDoc.zoneId != null) row.zoneId = rDoc.zoneId;
          }
        }
      }

      // in-memory dedupe by a simple signature (Email|Mobile|pincode-joined)
      const uniqueMap = new Map<string, any>();
      for (const row of prepared) {
        const sigParts = [
          row.Email || "",
          row.Mobile || "",
          Array.isArray(row.pincode) ? row.pincode.join("|") : String(row.pincode || "")
        ];
        const sig = sigParts.join("||");
        if (!uniqueMap.has(sig)) uniqueMap.set(sig, row);
      }
      const uniqueRows = Array.from(uniqueMap.values());

      // look up existing documents matching Email or Mobile to avoid inserting duplicates
      const emails = uniqueRows.map(r => r.Email).filter(Boolean);
      const mobiles = uniqueRows.map(r => r.Mobile).filter(Boolean);

      const queryOr: any[] = [];
      if (emails.length) queryOr.push({ Email: { $in: emails } });
      if (mobiles.length) queryOr.push({ Mobile: { $in: mobiles } });

      let existing: any[] = [];
      if (queryOr.length) {
        existing = await ExcelRow.find({ $or: queryOr }).select("Email Mobile").lean().exec();
      }

      const existingEmails = new Set(existing.map(e => (e.Email || "").toString().toLowerCase()));
      const existingMobiles = new Set(existing.map(e => (e.Mobile || "").toString().replace(/\D+/g, "")));

      const toInsert = uniqueRows.filter(r => {
        const em = r.Email ? String(r.Email).toLowerCase() : null;
        const mo = r.Mobile ? String(r.Mobile).replace(/\D+/g, "") : null;
        if ((em && existingEmails.has(em)) || (mo && existingMobiles.has(mo))) {
          return false; // skip duplicates
        }
        return true;
      });

      if (toInsert.length === 0) {
        return res.json({ success: true, inserted: 0, message: "No new rows to insert (duplicates skipped)" });
      }

      const insertResult = await ExcelRow.insertMany(toInsert);
      console.log("Inserted rows:", insertResult.length);
      res.json({ success: true, inserted: insertResult.length });
    } catch (err) {
      console.error(err);
      res.status(500).json({ success: false, message: "Server error" });
    }
  }


  ctrlGetAgents = async (req: Request & { file?: any }, res: Response, next: NextFunction) => {
    try {
      const page = Math.max(parseInt(String(req.query.page || "1"), 10), 1);
      const limit = Math.min(Math.max(parseInt(String(req.query.limit || "50"), 10), 1), 1000);
      const skip = (page - 1) * limit;

      console.log("Search query========:", req.query);

      const RESERVED = new Set(["page", "limit", "sort", "filter", "q"]);

      function coerceValue(str: string): boolean | number | string {
        if (str === "true") return true;
        if (str === "false") return false;
        const num = Number(str);
        if (!isNaN(num) && str.trim() !== "") return num; // "5001" → 5001
        return str;
      }

      let filter: any = {};

      if (req.query.filter) {
        try {
          filter = JSON.parse(String(req.query.filter));
        } catch (e) {
          return res.status(400).json({ success: false, message: "Invalid filter JSON" });
        }
      } else if (req.query.q) {
        const q = String(req.query.q);
        filter = {
          $or: [
            { Name: { $regex: q, $options: "i" } },
            { Email: { $regex: q, $options: "i" } },
            { Mobile: { $regex: q, $options: "i" } },
            { Pincode: { $regex: q, $options: "i" } },
          ],
        };
      } else {
        for (const [key, value] of Object.entries(req.query)) {
          if (RESERVED.has(key)) continue;
          filter[key] = coerceValue(String(value));
        }
      }

      let sort: any = { _id: -1 };
      if (req.query.sort) {
        try {
          sort = JSON.parse(String(req.query.sort));
        } catch (e) {
          return res.status(400).json({ success: false, message: "Invalid sort JSON" });
        }
      }

      const [data, total] = await Promise.all([
        ExcelRow.find(filter).sort(sort).skip(skip).limit(limit).lean().exec(),
        ExcelRow.countDocuments(filter),
      ]);

      res.json({ success: true, page, limit, total, data });
    } catch (err) {
      console.error(err);
      res.status(500).json({ success: false, message: "Server error" });
    }
  };

  ctrlGetZones = async (req: Request & { file?: any }, res: Response, next: NextFunction) => {
    try {
      let Zone: any;
      try {
        Zone = mongoose.model("Zone");
      } catch (e) {
        const ZoneSchema = new mongoose.Schema({ id: Number, name: String }, { strict: false });
        Zone = mongoose.model("Zone", ZoneSchema, "zones");
      }

      const zones = await Zone.find().lean().exec();
      res.json({ success: true, data: zones });
    } catch (err) {
      console.error(err);
      res.status(500).json({ success: false, message: "Server error" });
    }
  }

  ctrlGetRegions = async (req: Request & { file?: any }, res: Response, next: NextFunction) => {
    try {
      let Region: any;
      try {
        Region = mongoose.model("Region");
      } catch (e) {
        const RegionSchema = new mongoose.Schema({ id: Number, name: String, zoneId: Number }, { strict: false });
        Region = mongoose.model("Region", RegionSchema, "regions");
      }

      const regions = await Region.find().lean().exec();
      res.json({ success: true, data: regions });
    } catch (err) {
      console.error(err);
      res.status(500).json({ success: false, message: "Server error" });
    }
  }

  // Developer Purpose scripts for DB data.

  ctrlRunDbScripts = async (req: Request & { file?: any }, res: Response, next: NextFunction) => {
    try {
      // Creating initial zones
      await this.ctrlCreateZones(req, res, next);
      // Creating initial regions
      await this.ctrlCreateRegions(req, res, next);
      await this.ctrlCreateSampleAgents(req, res, next);


      res.status(201).json({ success: true });

    } catch (err) {
      console.error(err);
      res.status(500).json({ success: false, message: "Server error" });
    }
  }

  // PreScripts for zones
  ctrlCreateZones = async (req: Request & { file?: any }, res: Response, next: NextFunction) => {
    try {
      const zonesData = [
        { zoneId: 1, name: 'North India' },
        { zoneId: 2, name: 'South India' },
        { zoneId: 3, name: 'East India' },
        { zoneId: 4, name: 'West India' },
        { zoneId: 5, name: 'Central India' },
        { zoneId: 6, name: 'North-East India' }
      ];

      // ensure Zone model is available (avoid re-declaring if already defined)
      let Zone: any;
      try {
        Zone = mongoose.model("Zone");
      } catch (e) {
        const ZoneSchema = new mongoose.Schema({ zoneId: Number, name: String }, { strict: false });
        Zone = mongoose.model("Zone", ZoneSchema, "zones");
      }

      // create unique index on zoneId to prevent duplicates at DB level (no-op if already exists)
      try {
        // use collection API to ensure index exists
        // eslint-disable-next-line no-await-in-loop
        await Zone.collection.createIndex({ zoneId: 1 }, { unique: true });
      } catch (idxErr) {
        // ignore index creation errors (already exists or permission issues)
      }

      // use bulkWrite upserts to avoid inserting duplicates and be efficient
      const ops = zonesData.map(z => ({
        updateOne: {
          filter: { zoneId: z.zoneId },
          update: { $set: { zoneId: z.zoneId, name: z.name } },
          upsert: true
        }
      }));

      const result = await Zone.bulkWrite(ops, { ordered: false });
      console.log("Zones Created!");
      return result;

      // res.status(201).json({ success: true, result });
    } catch (err) {
      console.error("Error While creating zones:", err);
    }
  }

  // PreScripts for regions in DB.
  ctrlCreateRegions = async (req: Request & { file?: any }, res: Response, next: NextFunction) => {
    try {

      const regionsData = [
        // Zone 1 — North India
        { regionId: 101, name: "Jammu & Kashmir", zoneId: 1 },
        { regionId: 102, name: "Himachal Pradesh", zoneId: 1 },
        { regionId: 103, name: "Punjab", zoneId: 1 },
        { regionId: 104, name: "Haryana", zoneId: 1 },
        { regionId: 105, name: "Uttarakhand", zoneId: 1 },
        { regionId: 106, name: "Uttar Pradesh", zoneId: 1 },
        { regionId: 107, name: "Delhi (NCT)", zoneId: 1 },
        { regionId: 108, name: "Chandigarh", zoneId: 1 },

        // Zone 2 — South India
        { regionId: 201, name: "Andhra Pradesh", zoneId: 2 },
        { regionId: 202, name: "Telangana", zoneId: 2 },
        { regionId: 203, name: "Karnataka", zoneId: 2 },
        { regionId: 204, name: "Tamil Nadu", zoneId: 2 },
        { regionId: 205, name: "Kerala", zoneId: 2 },
        { regionId: 206, name: "Puducherry (UT)", zoneId: 2 },
        { regionId: 207, name: "Lakshadweep (UT)", zoneId: 2 },

        // Zone 3 — East India
        { regionId: 301, name: "West Bengal", zoneId: 3 },
        { regionId: 302, name: "Odisha", zoneId: 3 },
        { regionId: 303, name: "Bihar", zoneId: 3 },
        { regionId: 304, name: "Jharkhand", zoneId: 3 },
        { regionId: 305, name: "Andaman & Nicobar Islands (UT)", zoneId: 3 },

        // Zone 4 — West India
        { regionId: 401, name: "Rajasthan", zoneId: 4 },
        { regionId: 402, name: "Gujarat", zoneId: 4 },
        { regionId: 403, name: "Maharashtra", zoneId: 4 },
        { regionId: 404, name: "Goa", zoneId: 4 },
        { regionId: 405, name: "Dadra & Nagar Haveli and Daman & Diu (UT)", zoneId: 4 },

        // Zone 5 — Central India
        { regionId: 501, name: "Madhya Pradesh", zoneId: 5 },
        { regionId: 502, name: "Chhattisgarh", zoneId: 5 },

        // Zone 6 — North-East India
        { regionId: 601, name: "Assam", zoneId: 6 },
        { regionId: 602, name: "Arunachal Pradesh", zoneId: 6 },
        { regionId: 603, name: "Nagaland", zoneId: 6 },
        { regionId: 604, name: "Manipur", zoneId: 6 },
        { regionId: 605, name: "Mizoram", zoneId: 6 },
        { regionId: 606, name: "Tripura", zoneId: 6 },
        { regionId: 607, name: "Meghalaya", zoneId: 6 },
        { regionId: 608, name: "Sikkim", zoneId: 6 },
      ];

      // ensure Region model is available (avoid re-declaring if already defined)
      let Region: any;
      try {
        Region = mongoose.model("Region");
      } catch (e) {
        const RegionSchema = new mongoose.Schema({ regionId: Number, name: String, zoneId: Number, sme: String }, { strict: false });
        Region = mongoose.model("Region", RegionSchema, "regions");
      }

      // ensure unique index on regionId to prevent DB duplicates
      try {
        // eslint-disable-next-line no-await-in-loop
        await Region.collection.createIndex({ regionId: 1 }, { unique: true });
      } catch (idxErr) {
        // ignore index creation errors
      }

      // use bulkWrite upserts to insert/update without duplicates
      const ops = regionsData.map(r => ({
        updateOne: {
          filter: { regionId: r.regionId },
          update: { $set: { regionId: r.regionId, name: r.name, zoneId: r.zoneId } },
          upsert: true
        }
      }));

      const result = await Region.bulkWrite(ops, { ordered: false });
      console.log("Regions Created!");
      return result;

      // res.status(201).json({ success: true, result });
    } catch (err) {
      console.error(err);
      // res.status(500).json({ success: false, message: "Server error" });
      console.log("Error occurred while creating regions");
    }
  }

  // Scripts for Sample Agents
  ctrlCreateSampleAgents = async (req: Request & { file?: any }, res: Response, next: NextFunction) => {
    try {
      // Creating for karnataka regions
      const sampleAgents = [

        // ─── Zone 1: North India ───────────────────────────────────────────────────

        // Region 101 — Jammu & Kashmir
        { agentId: 1001, isBranchManager: true, firstName: "BM Rajesh", lastName: "Sharma", regionId: 101, email: "bm.rajesh@example.com", mobile: "9810000101", pincode: ["180001", "180002", "180003"], status: "active" },
        { agentId: 1002, isBranchManager: false, branchManagerId: 1001, firstName: "Anil", lastName: "Dogra", regionId: 101, email: "anil.dogra@example.com", mobile: "9810000102", pincode: ["180004", "180005"], status: "active" },
        { agentId: 1003, isBranchManager: false, branchManagerId: 1001, firstName: "Sunita", lastName: "Raina", regionId: 101, email: "sunita.raina@example.com", mobile: "9810000103", pincode: ["180006", "180007"], status: "active" },

        // Region 102 — Himachal Pradesh
        { agentId: 1011, isBranchManager: true, firstName: "BM Vikram", lastName: "Thakur", regionId: 102, email: "bm.vikram@example.com", mobile: "9810000111", pincode: ["171001", "171002", "171003"], status: "active" },
        { agentId: 1012, isBranchManager: false, branchManagerId: 1011, firstName: "Pooja", lastName: "Verma", regionId: 102, email: "pooja.verma@example.com", mobile: "9810000112", pincode: ["171004", "171005"], status: "active" },
        { agentId: 1013, isBranchManager: false, branchManagerId: 1011, firstName: "Ramesh", lastName: "Negi", regionId: 102, email: "ramesh.negi@example.com", mobile: "9810000113", pincode: ["171006", "171007"], status: "inactive" },

        // Region 103 — Punjab
        { agentId: 1021, isBranchManager: true, firstName: "BM Gurpreet", lastName: "Singh", regionId: 103, email: "bm.gurpreet@example.com", mobile: "9810000121", pincode: ["141001", "141002", "141003"], status: "active" },
        { agentId: 1022, isBranchManager: false, branchManagerId: 1021, firstName: "Harjit", lastName: "Kaur", regionId: 103, email: "harjit.kaur@example.com", mobile: "9810000122", pincode: ["141004", "141005"], status: "active" },
        { agentId: 1023, isBranchManager: false, branchManagerId: 1021, firstName: "Mandeep", lastName: "Bhatia", regionId: 103, email: "mandeep.bhatia@example.com", mobile: "9810000123", pincode: ["141006", "141007"], status: "active" },

        // Region 104 — Haryana
        { agentId: 1031, isBranchManager: true, firstName: "BM Suresh", lastName: "Yadav", regionId: 104, email: "bm.suresh@example.com", mobile: "9810000131", pincode: ["122001", "122002", "122003"], status: "active" },
        { agentId: 1032, isBranchManager: false, branchManagerId: 1031, firstName: "Neha", lastName: "Hooda", regionId: 104, email: "neha.hooda@example.com", mobile: "9810000132", pincode: ["122004", "122005"], status: "active" },
        { agentId: 1033, isBranchManager: false, branchManagerId: 1031, firstName: "Deepak", lastName: "Malik", regionId: 104, email: "deepak.malik@example.com", mobile: "9810000133", pincode: ["122006", "122007"], status: "inactive" },

        // Region 105 — Uttarakhand
        { agentId: 1041, isBranchManager: true, firstName: "BM Mohan", lastName: "Bisht", regionId: 105, email: "bm.mohan@example.com", mobile: "9810000141", pincode: ["248001", "248002", "248003"], status: "active" },
        { agentId: 1042, isBranchManager: false, branchManagerId: 1041, firstName: "Kavita", lastName: "Rawat", regionId: 105, email: "kavita.rawat@example.com", mobile: "9810000142", pincode: ["248004", "248005"], status: "active" },
        { agentId: 1043, isBranchManager: false, branchManagerId: 1041, firstName: "Sanjay", lastName: "Joshi", regionId: 105, email: "sanjay.joshi@example.com", mobile: "9810000143", pincode: ["248006", "248007"], status: "active" },

        // Region 106 — Uttar Pradesh
        { agentId: 1051, isBranchManager: true, firstName: "BM Rakesh", lastName: "Gupta", regionId: 106, email: "bm.rakesh@example.com", mobile: "9810000151", pincode: ["226001", "226002", "226003"], status: "active" },
        { agentId: 1052, isBranchManager: false, branchManagerId: 1051, firstName: "Priya", lastName: "Srivastava", regionId: 106, email: "priya.sriv@example.com", mobile: "9810000152", pincode: ["226004", "226005"], status: "active" },
        { agentId: 1053, isBranchManager: false, branchManagerId: 1051, firstName: "Amit", lastName: "Tiwari", regionId: 106, email: "amit.tiwari@example.com", mobile: "9810000153", pincode: ["226006", "226007"], status: "active" },
        { agentId: 1054, isBranchManager: false, branchManagerId: 1051, firstName: "Ritu", lastName: "Pandey", regionId: 106, email: "ritu.pandey@example.com", mobile: "9810000154", pincode: ["208001", "208002"], status: "inactive" },

        // Region 107 — Delhi (NCT)
        { agentId: 1061, isBranchManager: true, firstName: "BM Anita", lastName: "Kapoor", regionId: 107, email: "bm.anita@example.com", mobile: "9810000161", pincode: ["110001", "110002", "110003"], status: "active" },
        { agentId: 1062, isBranchManager: false, branchManagerId: 1061, firstName: "Rohit", lastName: "Mehra", regionId: 107, email: "rohit.mehra@example.com", mobile: "9810000162", pincode: ["110004", "110005"], status: "active" },
        { agentId: 1063, isBranchManager: false, branchManagerId: 1061, firstName: "Shweta", lastName: "Arora", regionId: 107, email: "shweta.arora@example.com", mobile: "9810000163", pincode: ["110006", "110007"], status: "active" },
        { agentId: 1064, isBranchManager: true, firstName: "BM Vivek", lastName: "Khanna", regionId: 107, email: "bm.vivek@example.com", mobile: "9810000164", pincode: ["110008", "110009", "110010"], status: "active" },
        { agentId: 1065, isBranchManager: false, branchManagerId: 1064, firstName: "Simran", lastName: "Sethi", regionId: 107, email: "simran.sethi@example.com", mobile: "9810000165", pincode: ["110011", "110012"], status: "active" },

        // Region 108 — Chandigarh
        { agentId: 1071, isBranchManager: true, firstName: "BM Parveen", lastName: "Kumar", regionId: 108, email: "bm.parveen@example.com", mobile: "9810000171", pincode: ["160001", "160002", "160003"], status: "active" },
        { agentId: 1072, isBranchManager: false, branchManagerId: 1071, firstName: "Jasleen", lastName: "Gill", regionId: 108, email: "jasleen.gill@example.com", mobile: "9810000172", pincode: ["160004", "160005"], status: "active" },

        // ─── Zone 2: South India ──────────────────────────────────────────────────

        // Region 201 — Andhra Pradesh
        { agentId: 2001, isBranchManager: true, firstName: "BM Venkat", lastName: "Reddy", regionId: 201, email: "bm.venkat@example.com", mobile: "9820000201", pincode: ["520001", "520002", "520003"], status: "active" },
        { agentId: 2002, isBranchManager: false, branchManagerId: 2001, firstName: "Sravani", lastName: "Rao", regionId: 201, email: "sravani.rao@example.com", mobile: "9820000202", pincode: ["520004", "520005"], status: "active" },
        { agentId: 2003, isBranchManager: false, branchManagerId: 2001, firstName: "Kiran", lastName: "Babu", regionId: 201, email: "kiran.babu@example.com", mobile: "9820000203", pincode: ["520006", "520007"], status: "active" },

        // Region 202 — Telangana
        { agentId: 2011, isBranchManager: true, firstName: "BM Ramana", lastName: "Murthy", regionId: 202, email: "bm.ramana@example.com", mobile: "9820000211", pincode: ["500001", "500002", "500003"], status: "active" },
        { agentId: 2012, isBranchManager: false, branchManagerId: 2011, firstName: "Divya", lastName: "Chandra", regionId: 202, email: "divya.chandra@example.com", mobile: "9820000212", pincode: ["500004", "500005"], status: "active" },
        { agentId: 2013, isBranchManager: false, branchManagerId: 2011, firstName: "Suresh", lastName: "Goud", regionId: 202, email: "suresh.goud@example.com", mobile: "9820000213", pincode: ["500006", "500007"], status: "inactive" },

        // Region 203 — Karnataka
        { agentId: 2021, isBranchManager: true, firstName: "BM Sunil", lastName: "Naik", regionId: 203, email: "bm.sunil@example.com", mobile: "9820000221", pincode: ["560001", "560002", "560003"], status: "active" },
        { agentId: 2022, isBranchManager: false, branchManagerId: 2021, firstName: "Kavya", lastName: "Shetty", regionId: 203, email: "kavya.shetty@example.com", mobile: "9820000222", pincode: ["560004", "560005"], status: "active" },
        { agentId: 2023, isBranchManager: false, branchManagerId: 2021, firstName: "Ravi", lastName: "Kumar", regionId: 203, email: "ravi.kumar@example.com", mobile: "9820000223", pincode: ["560066", "560068"], status: "active" },
        { agentId: 2024, isBranchManager: true, firstName: "BM Preethi", lastName: "Raj", regionId: 203, email: "bm.preethi@example.com", mobile: "9820000224", pincode: ["560008", "560009", "560010"], status: "active" },
        { agentId: 2025, isBranchManager: false, branchManagerId: 2024, firstName: "Arun", lastName: "Gowda", regionId: 203, email: "arun.gowda@example.com", mobile: "9820000225", pincode: ["560011", "560012"], status: "active" },

        // Region 204 — Tamil Nadu
        { agentId: 2031, isBranchManager: true, firstName: "BM Senthil", lastName: "Kumar", regionId: 204, email: "bm.senthil@example.com", mobile: "9820000231", pincode: ["600001", "600002", "600003"], status: "active" },
        { agentId: 2032, isBranchManager: false, branchManagerId: 2031, firstName: "Anitha", lastName: "Raj", regionId: 204, email: "anitha.raj@example.com", mobile: "9820000232", pincode: ["600004", "600005"], status: "active" },
        { agentId: 2033, isBranchManager: false, branchManagerId: 2031, firstName: "Murugan", lastName: "Pillai", regionId: 204, email: "murugan.pillai@example.com", mobile: "9820000233", pincode: ["600006", "600007"], status: "inactive" },

        // Region 205 — Kerala
        { agentId: 2041, isBranchManager: true, firstName: "BM Sreejith", lastName: "Nair", regionId: 205, email: "bm.sreejith@example.com", mobile: "9820000241", pincode: ["695001", "695002", "695003"], status: "active" },
        { agentId: 2042, isBranchManager: false, branchManagerId: 2041, firstName: "Reshma", lastName: "Menon", regionId: 205, email: "reshma.menon@example.com", mobile: "9820000242", pincode: ["695004", "695005"], status: "active" },
        { agentId: 2043, isBranchManager: false, branchManagerId: 2041, firstName: "Ajeesh", lastName: "Pillai", regionId: 205, email: "ajeesh.pillai@example.com", mobile: "9820000243", pincode: ["695006", "695007"], status: "active" },

        // Region 206 — Puducherry
        { agentId: 2051, isBranchManager: true, firstName: "BM Arjun", lastName: "Sharma", regionId: 206, email: "bm.arjun@example.com", mobile: "9820000251", pincode: ["605001", "605002"], status: "active" },
        { agentId: 2052, isBranchManager: false, branchManagerId: 2051, firstName: "Meena", lastName: "Das", regionId: 206, email: "meena.das@example.com", mobile: "9820000252", pincode: ["605003", "605004"], status: "active" },

        // Region 207 — Lakshadweep
        { agentId: 2061, isBranchManager: true, firstName: "BM Hassan", lastName: "Ali", regionId: 207, email: "bm.hassan@example.com", mobile: "9820000261", pincode: ["682555", "682556"], status: "active" },
        { agentId: 2062, isBranchManager: false, branchManagerId: 2061, firstName: "Fathima", lastName: "Beevi", regionId: 207, email: "fathima.beevi@example.com", mobile: "9820000262", pincode: ["682557", "682558"], status: "active" },

        // ─── Zone 3: East India ───────────────────────────────────────────────────

        // Region 301 — West Bengal
        { agentId: 3001, isBranchManager: true, firstName: "BM Subrata", lastName: "Ghosh", regionId: 301, email: "bm.subrata@example.com", mobile: "9830000301", pincode: ["700001", "700002", "700003"], status: "active" },
        { agentId: 3002, isBranchManager: false, branchManagerId: 3001, firstName: "Ananya", lastName: "Bose", regionId: 301, email: "ananya.bose@example.com", mobile: "9830000302", pincode: ["700004", "700005"], status: "active" },
        { agentId: 3003, isBranchManager: false, branchManagerId: 3001, firstName: "Suman", lastName: "Das", regionId: 301, email: "suman.das@example.com", mobile: "9830000303", pincode: ["700006", "700007"], status: "inactive" },

        // Region 302 — Odisha
        { agentId: 3011, isBranchManager: true, firstName: "BM Prasant", lastName: "Panda", regionId: 302, email: "bm.prasant@example.com", mobile: "9830000311", pincode: ["751001", "751002", "751003"], status: "active" },
        { agentId: 3012, isBranchManager: false, branchManagerId: 3011, firstName: "Smita", lastName: "Mohanty", regionId: 302, email: "smita.mohanty@example.com", mobile: "9830000312", pincode: ["751004", "751005"], status: "active" },
        { agentId: 3013, isBranchManager: false, branchManagerId: 3011, firstName: "Bikash", lastName: "Nayak", regionId: 302, email: "bikash.nayak@example.com", mobile: "9830000313", pincode: ["751006", "751007"], status: "active" },

        // Region 303 — Bihar
        { agentId: 3021, isBranchManager: true, firstName: "BM Ranjit", lastName: "Singh", regionId: 303, email: "bm.ranjit@example.com", mobile: "9830000321", pincode: ["800001", "800002", "800003"], status: "active" },
        { agentId: 3022, isBranchManager: false, branchManagerId: 3021, firstName: "Pinki", lastName: "Kumari", regionId: 303, email: "pinki.kumari@example.com", mobile: "9830000322", pincode: ["800004", "800005"], status: "active" },
        { agentId: 3023, isBranchManager: false, branchManagerId: 3021, firstName: "Gaurav", lastName: "Mishra", regionId: 303, email: "gaurav.mishra@example.com", mobile: "9830000323", pincode: ["800006", "800007"], status: "inactive" },

        // Region 304 — Jharkhand
        { agentId: 3031, isBranchManager: true, firstName: "BM Dilip", lastName: "Mahato", regionId: 304, email: "bm.dilip@example.com", mobile: "9830000331", pincode: ["834001", "834002", "834003"], status: "active" },
        { agentId: 3032, isBranchManager: false, branchManagerId: 3031, firstName: "Sangita", lastName: "Devi", regionId: 304, email: "sangita.devi@example.com", mobile: "9830000332", pincode: ["834004", "834005"], status: "active" },

        // Region 305 — Andaman & Nicobar
        { agentId: 3041, isBranchManager: true, firstName: "BM Robert", lastName: "Paul", regionId: 305, email: "bm.robert@example.com", mobile: "9830000341", pincode: ["744101", "744102"], status: "active" },
        { agentId: 3042, isBranchManager: false, branchManagerId: 3041, firstName: "Asha", lastName: "George", regionId: 305, email: "asha.george@example.com", mobile: "9830000342", pincode: ["744103", "744104"], status: "active" },

        // ─── Zone 4: West India ───────────────────────────────────────────────────

        // Region 401 — Rajasthan
        { agentId: 4001, isBranchManager: true, firstName: "BM Mahesh", lastName: "Pareek", regionId: 401, email: "bm.mahesh@example.com", mobile: "9840000401", pincode: ["302001", "302002", "302003"], status: "active" },
        { agentId: 4002, isBranchManager: false, branchManagerId: 4001, firstName: "Sunita", lastName: "Sharma", regionId: 401, email: "sunita.sharma@example.com", mobile: "9840000402", pincode: ["302004", "302005"], status: "active" },
        { agentId: 4003, isBranchManager: false, branchManagerId: 4001, firstName: "Lokesh", lastName: "Gupta", regionId: 401, email: "lokesh.gupta@example.com", mobile: "9840000403", pincode: ["302006", "302007"], status: "active" },

        // Region 402 — Gujarat
        { agentId: 4011, isBranchManager: true, firstName: "BM Nilesh", lastName: "Shah", regionId: 402, email: "bm.nilesh@example.com", mobile: "9840000411", pincode: ["380001", "380002", "380003"], status: "active" },
        { agentId: 4012, isBranchManager: false, branchManagerId: 4011, firstName: "Hetal", lastName: "Patel", regionId: 402, email: "hetal.patel@example.com", mobile: "9840000412", pincode: ["380004", "380005"], status: "active" },
        { agentId: 4013, isBranchManager: false, branchManagerId: 4011, firstName: "Bhavik", lastName: "Desai", regionId: 402, email: "bhavik.desai@example.com", mobile: "9840000413", pincode: ["380006", "380007"], status: "inactive" },

        // Region 403 — Maharashtra
        { agentId: 4021, isBranchManager: true, firstName: "BM Santosh", lastName: "Patil", regionId: 403, email: "bm.santosh@example.com", mobile: "9840000421", pincode: ["400001", "400002", "400003"], status: "active" },
        { agentId: 4022, isBranchManager: false, branchManagerId: 4021, firstName: "Priya", lastName: "Jadhav", regionId: 403, email: "priya.jadhav@example.com", mobile: "9840000422", pincode: ["400004", "400005"], status: "active" },
        { agentId: 4023, isBranchManager: false, branchManagerId: 4021, firstName: "Rahul", lastName: "Deshpande", regionId: 403, email: "rahul.desh@example.com", mobile: "9840000423", pincode: ["400006", "400007"], status: "active" },
        { agentId: 4024, isBranchManager: true, firstName: "BM Sneha", lastName: "More", regionId: 403, email: "bm.sneha@example.com", mobile: "9840000424", pincode: ["411001", "411002", "411003"], status: "active" },
        { agentId: 4025, isBranchManager: false, branchManagerId: 4024, firstName: "Vikas", lastName: "Shinde", regionId: 403, email: "vikas.shinde@example.com", mobile: "9840000425", pincode: ["411004", "411005"], status: "active" },

        // Region 404 — Goa
        { agentId: 4031, isBranchManager: true, firstName: "BM Marcus", lastName: "Fernandes", regionId: 404, email: "bm.marcus@example.com", mobile: "9840000431", pincode: ["403001", "403002"], status: "active" },
        { agentId: 4032, isBranchManager: false, branchManagerId: 4031, firstName: "Seema", lastName: "DSouza", regionId: 404, email: "seema.dsouza@example.com", mobile: "9840000432", pincode: ["403003", "403004"], status: "active" },

        // Region 405 — Dadra & Nagar Haveli
        { agentId: 4041, isBranchManager: true, firstName: "BM Tejas", lastName: "Patel", regionId: 405, email: "bm.tejas@example.com", mobile: "9840000441", pincode: ["396230", "396231"], status: "active" },
        { agentId: 4042, isBranchManager: false, branchManagerId: 4041, firstName: "Kruti", lastName: "Mehta", regionId: 405, email: "kruti.mehta@example.com", mobile: "9840000442", pincode: ["396232", "396233"], status: "active" },

        // ─── Zone 5: Central India ────────────────────────────────────────────────

        // Region 501 — Madhya Pradesh
        { agentId: 5001, isBranchManager: true, firstName: "BM Hemant", lastName: "Dubey", regionId: 501, email: "bm.hemant@example.com", mobile: "9850000501", pincode: ["462001", "462002", "462003"], status: "active" },
        { agentId: 5002, isBranchManager: false, branchManagerId: 5001, firstName: "Rekha", lastName: "Tiwari", regionId: 501, email: "rekha.tiwari@example.com", mobile: "9850000502", pincode: ["462004", "462005"], status: "active" },
        { agentId: 5003, isBranchManager: false, branchManagerId: 5001, firstName: "Sachin", lastName: "Patel", regionId: 501, email: "sachin.patel@example.com", mobile: "9850000503", pincode: ["462006", "462007"], status: "active" },
        { agentId: 5004, isBranchManager: false, branchManagerId: 5001, firstName: "Nisha", lastName: "Chouhan", regionId: 501, email: "nisha.chouhan@example.com", mobile: "9850000504", pincode: ["452001", "452002"], status: "inactive" },

        // Region 502 — Chhattisgarh
        { agentId: 5011, isBranchManager: true, firstName: "BM Ajay", lastName: "Sahu", regionId: 502, email: "bm.ajay@example.com", mobile: "9850000511", pincode: ["492001", "492002", "492003"], status: "active" },
        { agentId: 5012, isBranchManager: false, branchManagerId: 5011, firstName: "Lata", lastName: "Verma", regionId: 502, email: "lata.verma@example.com", mobile: "9850000512", pincode: ["492004", "492005"], status: "active" },
        { agentId: 5013, isBranchManager: false, branchManagerId: 5011, firstName: "Rohit", lastName: "Yadav", regionId: 502, email: "rohit.yadav@example.com", mobile: "9850000513", pincode: ["492006", "492007"], status: "active" },

        // ─── Zone 6: North-East India ─────────────────────────────────────────────

        // Region 601 — Assam
        { agentId: 6001, isBranchManager: true, firstName: "BM Bhupen", lastName: "Hazarika", regionId: 601, email: "bm.bhupen@example.com", mobile: "9860000601", pincode: ["781001", "781002", "781003"], status: "active" },
        { agentId: 6002, isBranchManager: false, branchManagerId: 6001, firstName: "Puja", lastName: "Bora", regionId: 601, email: "puja.bora@example.com", mobile: "9860000602", pincode: ["781004", "781005"], status: "active" },
        { agentId: 6003, isBranchManager: false, branchManagerId: 6001, firstName: "Dipen", lastName: "Kalita", regionId: 601, email: "dipen.kalita@example.com", mobile: "9860000603", pincode: ["781006", "781007"], status: "active" },

        // Region 602 — Arunachal Pradesh
        { agentId: 6011, isBranchManager: true, firstName: "BM Tapi", lastName: "Mara", regionId: 602, email: "bm.tapi@example.com", mobile: "9860000611", pincode: ["791001", "791002"], status: "active" },
        { agentId: 6012, isBranchManager: false, branchManagerId: 6011, firstName: "Rina", lastName: "Tayeng", regionId: 602, email: "rina.tayeng@example.com", mobile: "9860000612", pincode: ["791003", "791004"], status: "active" },

        // Region 603 — Nagaland
        { agentId: 6021, isBranchManager: true, firstName: "BM Neikuo", lastName: "Zhimomi", regionId: 603, email: "bm.neikuo@example.com", mobile: "9860000621", pincode: ["797001", "797002"], status: "active" },
        { agentId: 6022, isBranchManager: false, branchManagerId: 6021, firstName: "Vikuo", lastName: "Sema", regionId: 603, email: "vikuo.sema@example.com", mobile: "9860000622", pincode: ["797003", "797004"], status: "active" },

        // Region 604 — Manipur
        { agentId: 6031, isBranchManager: true, firstName: "BM Ibohal", lastName: "Meitei", regionId: 604, email: "bm.ibohal@example.com", mobile: "9860000631", pincode: ["795001", "795002"], status: "active" },
        { agentId: 6032, isBranchManager: false, branchManagerId: 6031, firstName: "Sangeeta", lastName: "Devi", regionId: 604, email: "sangeeta.devi@example.com", mobile: "9860000632", pincode: ["795003", "795004"], status: "active" },

        // Region 605 — Mizoram
        { agentId: 6041, isBranchManager: true, firstName: "BM Lalduhawma", lastName: "Ralte", regionId: 605, email: "bm.laldu@example.com", mobile: "9860000641", pincode: ["796001", "796002"], status: "active" },
        { agentId: 6042, isBranchManager: false, branchManagerId: 6041, firstName: "Zosangzuali", lastName: "Hmar", regionId: 605, email: "zosang.hmar@example.com", mobile: "9860000642", pincode: ["796003", "796004"], status: "active" },

        // Region 606 — Tripura
        { agentId: 6051, isBranchManager: true, firstName: "BM Biplab", lastName: "Deb", regionId: 606, email: "bm.biplab@example.com", mobile: "9860000651", pincode: ["799001", "799002"], status: "active" },
        { agentId: 6052, isBranchManager: false, branchManagerId: 6051, firstName: "Mita", lastName: "Chakma", regionId: 606, email: "mita.chakma@example.com", mobile: "9860000652", pincode: ["799003", "799004"], status: "active" },

        // Region 607 — Meghalaya
        { agentId: 6061, isBranchManager: true, firstName: "BM Banteidor", lastName: "Lyngdoh", regionId: 607, email: "bm.bante@example.com", mobile: "9860000661", pincode: ["793001", "793002"], status: "active" },
        { agentId: 6062, isBranchManager: false, branchManagerId: 6061, firstName: "Pynhun", lastName: "Nongrum", regionId: 607, email: "pynhun.nongrum@example.com", mobile: "9860000662", pincode: ["793003", "793004"], status: "active" },

        // Region 608 — Sikkim
        { agentId: 6071, isBranchManager: true, firstName: "BM Tshering", lastName: "Lepcha", regionId: 608, email: "bm.tshering@example.com", mobile: "9860000671", pincode: ["737101", "737102"], status: "active" },
        { agentId: 6072, isBranchManager: false, branchManagerId: 6071, firstName: "Dichen", lastName: "Bhutia", regionId: 608, email: "dichen.bhutia@example.com", mobile: "9860000672", pincode: ["737103", "737104"], status: "active" },

      ];

      // ensure Agent model is available (avoid re-declaring if already defined)
      let Agent: any;
      try {
        Agent = mongoose.model("Agent");
      } catch (e) {
        const AgentSchema = new mongoose.Schema({ agentId: Number, branchManagerId: Number, firstName: String, lastName: String, email: String, mobile: String, pincode: [String], regionId: Number, isBranchManager: Boolean }, { strict: false });
        Agent = mongoose.model("Agent", AgentSchema, "agents");
      }

      // ensure unique index on agentId to prevent DB duplicates
      try {
        // eslint-disable-next-line no-await-in-loop
        await Agent.collection.createIndex({ agentId: 1 }, { unique: true });
      } catch (idxErr) {
        // ignore index creation errors
      }

      // use bulkWrite upserts to insert/update without duplicates
      const ops = sampleAgents.map(a => ({
        updateOne: {
          filter: { agentId: a.agentId },
          update: { $set: { agentId: a.agentId, branchManagerId: a.branchManagerId, isBranchManager: a.isBranchManager, firstName: a.firstName, lastName: a.lastName, email: a.email, mobile: a.mobile, pincode: a.pincode, regionId: a.regionId } },
          upsert: true
        }
      }));

      const result = await Agent.bulkWrite(ops, { ordered: false });
      console.log("Sample Agents Created!")
      return result;

      // res.status(201).json({ success: true, result });
    } catch (err) {
      console.error(err);
      console.log("Error occurred while creating agents");
    }
  }

  ctrlTestAgent = async (req: Request & { file?: any }, res: Response, next: NextFunction) => {
    res.status(200).json({ success: true });
  }
}