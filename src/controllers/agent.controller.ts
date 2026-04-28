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
      if (str === "true")  return true;
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
          { Name:    { $regex: q, $options: "i" } },
          { Email:   { $regex: q, $options: "i" } },
          { Mobile:  { $regex: q, $options: "i" } },
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
    try{
      // Creating initial zones
      await this.ctrlCreateZones(req, res, next);
      // Creating initial regions
      await this.ctrlCreateRegions(req, res, next);
      await this.ctrlCreateSampleAgents(req, res, next);


      res.status(201).json({ success: true });

    }catch (err) {
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
        { regionId: 101, name: "Jammu & Kashmir", zoneId: 1 },
        { regionId: 102, name: "Himachal Pradesh", zoneId: 1 },
        { regionId: 103, name: "Punjab", zoneId: 1 },
        { regionId: 104, name: "Haryana", zoneId: 1 },
        { regionId: 105, name: "Uttarakhand", zoneId: 1 },
        { regionId: 106, name: "Uttar Pradesh", zoneId: 1 },
        { regionId: 107, name: "Delhi (NCT)", zoneId: 1 },
        { regionId: 108, name: "Chandigarh", zoneId: 1 },

        { regionId: 201, name: "Andhra Pradesh", zoneId: 2 },
        { regionId: 202, name: "Telangana", zoneId: 2 },
        { regionId: 203, name: "Karnataka", zoneId: 2 },
        { regionId: 204, name: "Tamil Nadu", zoneId: 2 },
        { regionId: 205, name: "Kerala", zoneId: 2 },
        { regionId: 206, name: "Puducherry (UT)", zoneId: 2 },
        { regionId: 207, name: "Lakshadweep (UT)", zoneId: 2 },

        // { regionId: 301, name: "Bihar", zoneId: 3 },
        // { regionId: 302, name: "Jharkhand", zoneId: 3 },
        // { regionId: 303, name: "Odisha", zoneId: 3 },
        // { regionId: 304, name: "West Bengal", zoneId: 3 },
        // { regionId: 305, name: "Andaman & Nicobar Islands (UT)", zoneId: 3 },

        // { regionId: 401, name: "Rajasthan", zoneId: 4 },
        // { regionId: 402, name: "Gujarat", zoneId: 4 },
        // { regionId: 403, name: "Maharashtra", zoneId: 4 },
        // { regionId: 404, name: "Goa", zoneId: 4 },
        // { regionId: 405, name: "Dadra & Nagar Haveli and Daman & Diu (UT)", zoneId: 4 },

        // { regionId: 501, name: "Madhya Pradesh", zoneId: 5 },
        // { regionId: 502, name: "Chhattisgarh", zoneId: 5 },

        // { regionId: 601, name: "Assam", zoneId: 6 },
        // { regionId: 602, name: "Arunachal Pradesh", zoneId: 6 },
        // { regionId: 603, name: "Meghalaya", zoneId: 6 },
        // { regionId: 604, name: "Manipur", zoneId: 6 },
        // { regionId: 605, name: "Mizoram", zoneId: 6 },
        // { regionId: 606, name: "Nagaland", zoneId: 6 },
        // { regionId: 607, name: "Tripura", zoneId: 6 },
        // { regionId: 608, name: "Sikkim", zoneId: 6 }
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
        { agentId: 5001, firstName: "BM-Agent A", lastName: "Last A", regionId: 203, email: "agentA@example.com", mobile: "1234567890", pincode: ["560066"], isBranchManager: true },
        { agentId: 5002, branchManagerId: 5001, isBranchManager: false, firstName: "Agent B", lastName: "Last B", regionId: 203, email: "agentB@example.com", mobile: "1234567890", pincode: ["560066"] },
        { agentId: 5003, branchManagerId: 5001,isBranchManager: false,  firstName: "Agent C", lastName: "Last C", regionId: 203, email: "agentC@example.com", mobile: "1234567890", pincode: ["560066"] },
        { agentId: 5004, branchManagerId: 5001, isBranchManager: false, firstName: "Agent D", lastName: "Last D", regionId: 203, email: "agentD@example.com", mobile: "1234567890", pincode: ["560066"] },
        { agentId: 5005, branchManagerId: 5001, isBranchManager: false, firstName: "Agent E", lastName: "Last E", regionId: 203, email: "agentE@example.com", mobile: "1234567890", pincode: ["560066"] },
        { agentId: 5006, firstName: "BM-Agent F", lastName: "Last F", regionId: 203, email: "agentF@example.com", mobile: "1234567890", pincode: ["560066"], isBranchManager: true },
      ];

      // ensure Agent model is available (avoid re-declaring if already defined)
      let Agent: any;
      try {
        Agent = mongoose.model("Agent");
      } catch (e) {
        const AgentSchema = new mongoose.Schema({ agentId: Number, branchManagerId: Number, firstName: String, lastName: String, email: String, mobile: String, pincode: [String], regionId: Number , isBranchManager: Boolean }, { strict: false });
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