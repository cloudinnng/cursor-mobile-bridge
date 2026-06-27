import { listWorkspaceContents, isPathInsideWorkspace, readWorkspaceFile } from "./fs/dirBrowser.js";
import path from "node:path";
import fs from "node:fs";
import os from "node:os";

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "ws-test-"));
fs.writeFileSync(path.join(tmp, "hello.txt"), "hi");
fs.mkdirSync(path.join(tmp, "src"));

const listing = listWorkspaceContents(tmp);
console.log("entries:", listing.entries.map((e) => `${e.isDir ? "D" : "F"}:${e.name}`).join(", "));
console.assert(listing.entries.length === 2, "expected 2 entries");
console.assert(isPathInsideWorkspace(tmp, path.join(tmp, "src")), "inside check");

const preview = readWorkspaceFile(tmp, "hello.txt");
console.assert(preview.content === "hi", "read file content");
console.log("ok");
