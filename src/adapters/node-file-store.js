"use strict";

const fs = require("fs");
const path = require("path");

/**
 * File-based persistence for Node.js. Stores bridges under config/*.json
 * with the shape: { bridges: BridgeData[] }
 */
class NodeFileStore {
  /**
   * @param {string} configDir
   * @param {Record<string,string>} bridgeFilesMap
   */
  constructor(configDir, bridgeFilesMap) {
    this.configDir = configDir;
    this.bridgeFilesMap = bridgeFilesMap;
  }

  async readAll() {
    /** @type {Record<string,{bridges:any[]}>} */
    const docs = {};
    for (const [type, file] of Object.entries(this.bridgeFilesMap)) {
      if (!fs.existsSync(file)) {
        docs[type] = { bridges: [] };
        continue;
      }
      try {
        const data = JSON.parse(fs.readFileSync(file, "utf8"));
        const list = Array.isArray(data?.bridges) ? data.bridges : [];
        docs[type] = { bridges: list };
      } catch (_e) {
        docs[type] = { bridges: [] };
      }
    }
    return docs;
  }

  /**
   * @param {string} type
   * @param {any} data
   */
  async append(type, data) {
    if (!fs.existsSync(this.configDir)) {
      fs.mkdirSync(this.configDir, { recursive: true });
    }
    const file = this.bridgeFilesMap[type];
    let doc = { bridges: [] };
    if (fs.existsSync(file)) {
      try {
        const json = JSON.parse(fs.readFileSync(file, "utf8"));
        doc = { bridges: Array.isArray(json.bridges) ? json.bridges : [] };
      } catch (_e) {
        doc = { bridges: [] };
      }
    }
    doc.bridges.push(data);
    fs.writeFileSync(file, JSON.stringify(doc, null, 2));
  }
}

module.exports = { NodeFileStore };
