/**
 * @file fs/dirBrowser.js
 * @description 服务端目录浏览 — 供前端选择工作空间文件夹
 */

import fs from "node:fs";
import path from "node:path";
import os from "node:os";

const LOG_PREFIX = "[dirBrowser]";

/** @typedef {{ name: string, path: string, isDir: boolean, relativePath?: string, size?: number }} DirEntry */
/** @typedef {{ path: string, parent: string | null, entries: DirEntry[], isRoots?: boolean, relativePath?: string, workspaceRoot?: string }} DirListing */

/** ponytail: 工作空间浏览跳过常见巨型目录，减少移动端列表噪音 */
const WORKSPACE_SKIP_DIRS = new Set(["node_modules", ".git"]);

/**
 * 判断是否为 Windows 盘符根目录（如 C:\）
 * @param {string} dirPath
 * @returns {boolean}
 */
function isWindowsDriveRoot(dirPath) {
  return process.platform === "win32" && /^[A-Za-z]:\\?$/.test(dirPath);
}

/**
 * 列出 Windows 可用盘符
 * @returns {DirListing}
 */
function listWindowsDrives() {
  /** @type {DirEntry[]} */
  const entries = [];

  for (let code = 65; code <= 90; code++) {
    const letter = String.fromCharCode(code);
    const drivePath = `${letter}:\\`;
    try {
      fs.accessSync(drivePath, fs.constants.R_OK);
      entries.push({ name: `${letter}:`, path: drivePath, isDir: true });
      console.log(`${LOG_PREFIX} 发现盘符 ${drivePath}`);
    } catch {
      // ponytail: 盘符不存在或无权限，跳过
    }
  }

  return { path: "", parent: null, entries, isRoots: true };
}

/**
 * 列出 Unix 根目录或用户主目录作为起点
 * @returns {DirListing}
 */
function listUnixRoots() {
  return listDirectory("/");
}

/**
 * 获取目录浏览起点（Windows 盘符列表 / Unix 根目录）
 * @returns {DirListing}
 */
export function listRoots() {
  console.log(`${LOG_PREFIX} listRoots platform=${process.platform}`);
  return process.platform === "win32" ? listWindowsDrives() : listUnixRoots();
}

/**
 * 解析并校验目录路径
 * @param {string} dirPath
 * @returns {string} 绝对路径
 */
export function resolveDirPath(dirPath) {
  const resolved = path.resolve(dirPath);
  let stat;
  try {
    stat = fs.statSync(resolved);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new Error(`无法访问目录: ${resolved} (${message})`);
  }
  if (!stat.isDirectory()) {
    throw new Error(`不是目录: ${resolved}`);
  }
  return resolved;
}

/**
 * 列出指定目录下的子文件夹
 * @param {string} dirPath
 * @returns {DirListing}
 */
export function listDirectory(dirPath) {
  const resolved = resolveDirPath(dirPath);
  console.log(`${LOG_PREFIX} listDirectory path=${resolved}`);

  /** @type {DirEntry[]} */
  const entries = [];

  let dirents;
  try {
    dirents = fs.readdirSync(resolved, { withFileTypes: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new Error(`无法读取目录: ${message}`);
  }

  for (const dirent of dirents) {
    if (!dirent.isDirectory()) continue;
    // ponytail: 跳过隐藏目录，减少移动端列表噪音
    if (dirent.name.startsWith(".")) continue;

    const fullPath = path.join(resolved, dirent.name);
    try {
      // 跳过无读权限的目录
      fs.accessSync(fullPath, fs.constants.R_OK);
      entries.push({ name: dirent.name, path: fullPath, isDir: true });
    } catch {
      console.log(`${LOG_PREFIX} 跳过无权限目录 ${fullPath}`);
    }
  }

  entries.sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" }));

  // Windows 盘符根的上一级是盘符列表
  let parent = null;
  if (isWindowsDriveRoot(resolved)) {
    parent = "";
  } else {
    const parentDir = path.dirname(resolved);
    if (parentDir !== resolved) {
      parent = parentDir;
    }
  }

  return { path: resolved, parent, entries };
}

/**
 * 浏览目录 — 空路径返回根列表，否则列出子目录
 * @param {string | undefined | null} inputPath
 * @returns {DirListing}
 */
export function browseDirectory(inputPath) {
  if (!inputPath || inputPath === "") {
    return listRoots();
  }
  return listDirectory(inputPath);
}

/**
 * 格式化路径用于 UI 显示（缩短过长路径）
 * @param {string} dirPath
 * @param {number} [maxLen=40]
 * @returns {string}
 */
export function formatPathForDisplay(dirPath, maxLen = 40) {
  if (!dirPath) return "选择盘符";
  if (dirPath.length <= maxLen) return dirPath;
  const base = path.basename(dirPath) || dirPath;
  const head = dirPath.slice(0, 12);
  return `${head}…${base}`;
}

/**
 * 判断目标路径是否位于工作空间根目录内
 * @param {string} workspaceRoot
 * @param {string} targetPath
 * @returns {boolean}
 */
export function isPathInsideWorkspace(workspaceRoot, targetPath) {
  const root = path.resolve(workspaceRoot);
  const target = path.resolve(targetPath);
  const rel = path.relative(root, target);
  return rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel));
}

/**
 * 列出工作空间内指定目录下的文件与子文件夹
 * @param {string} workspaceRoot 工作空间根目录绝对路径
 * @param {string | undefined | null} inputPath 绝对路径或相对路径；空则列出根目录
 * @returns {DirListing}
 */
export function listWorkspaceContents(workspaceRoot, inputPath) {
  const root = resolveDirPath(workspaceRoot);
  let targetPath = root;

  if (inputPath) {
    const candidate = path.isAbsolute(inputPath)
      ? path.resolve(inputPath)
      : path.resolve(root, inputPath);
    if (!isPathInsideWorkspace(root, candidate)) {
      throw new Error("路径超出工作空间范围");
    }
    targetPath = resolveDirPath(candidate);
  }

  console.log(`${LOG_PREFIX} listWorkspaceContents root=${root} target=${targetPath}`);

  /** @type {DirEntry[]} */
  const entries = [];

  let dirents;
  try {
    dirents = fs.readdirSync(targetPath, { withFileTypes: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new Error(`无法读取目录: ${message}`);
  }

  for (const dirent of dirents) {
    const name = dirent.name;
    if (name.startsWith(".")) continue;

    const fullPath = path.join(targetPath, name);
    const relativePath = path.relative(root, fullPath).replace(/\\/g, "/");

    if (dirent.isDirectory()) {
      if (WORKSPACE_SKIP_DIRS.has(name)) continue;
      try {
        fs.accessSync(fullPath, fs.constants.R_OK);
        entries.push({ name, path: fullPath, relativePath, isDir: true });
      } catch {
        console.log(`${LOG_PREFIX} 跳过无权限目录 ${fullPath}`);
      }
      continue;
    }

    if (!dirent.isFile()) continue;

    try {
      fs.accessSync(fullPath, fs.constants.R_OK);
      const stat = fs.statSync(fullPath);
      entries.push({
        name,
        path: fullPath,
        relativePath,
        isDir: false,
        size: stat.size,
      });
    } catch {
      console.log(`${LOG_PREFIX} 跳过无权限文件 ${fullPath}`);
    }
  }

  entries.sort((a, b) => {
    if (a.isDir !== b.isDir) return a.isDir ? -1 : 1;
    return a.name.localeCompare(b.name, undefined, { sensitivity: "base" });
  });

  const parent =
    targetPath === root
      ? null
      : path.dirname(targetPath);

  const listingRelative = targetPath === root ? "" : path.relative(root, targetPath).replace(/\\/g, "/");

  return {
    path: targetPath,
    relativePath: listingRelative,
    parent,
    workspaceRoot: root,
    entries,
  };
}

/** ponytail: 预览上限 512KB，再大只读头部；升级路径：分页或按需 range 读 */
const MAX_PREVIEW_BYTES = 512 * 1024;

/** @typedef {{ path: string, relativePath: string, name: string, size: number, truncated: boolean, isBinary?: boolean, isImage?: boolean, mimeType?: string, data?: string, content?: string }} WorkspaceFileContent */

/** 常见可预览图片扩展名 → MIME */
const IMAGE_EXT_MIME = /** @type {Record<string, string>} */ ({
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".bmp": "image/bmp",
});

/**
 * 读取工作空间内文件内容供前端预览
 * @param {string} workspaceRoot
 * @param {string} inputPath 绝对或相对路径
 * @returns {WorkspaceFileContent}
 */
export function readWorkspaceFile(workspaceRoot, inputPath) {
  if (!inputPath?.trim()) {
    throw new Error("未指定文件路径");
  }

  const root = resolveDirPath(workspaceRoot);
  const candidate = path.isAbsolute(inputPath)
    ? path.resolve(inputPath)
    : path.resolve(root, inputPath);

  if (!isPathInsideWorkspace(root, candidate)) {
    throw new Error("路径超出工作空间范围");
  }

  let stat;
  try {
    stat = fs.statSync(candidate);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new Error(`无法访问文件: ${message}`);
  }
  if (!stat.isFile()) {
    throw new Error("不是文件");
  }

  try {
    fs.accessSync(candidate, fs.constants.R_OK);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new Error(`无读取权限: ${message}`);
  }

  const relativePath = path.relative(root, candidate).replace(/\\/g, "/");
  const name = path.basename(candidate);
  const ext = path.extname(name).toLowerCase();
  const fileSize = stat.size;
  const readSize = Math.min(fileSize, MAX_PREVIEW_BYTES);
  const buf = Buffer.alloc(readSize);

  const fd = fs.openSync(candidate, "r");
  try {
    fs.readSync(fd, buf, 0, readSize, 0);
  } finally {
    fs.closeSync(fd);
  }

  const truncated = fileSize > MAX_PREVIEW_BYTES;
  const mimeType = IMAGE_EXT_MIME[ext];

  console.log(
    `${LOG_PREFIX} readWorkspaceFile rel=${relativePath} size=${fileSize} truncated=${truncated}`
  );

  if (mimeType) {
    return {
      path: candidate,
      relativePath,
      name,
      size: fileSize,
      truncated,
      isImage: true,
      mimeType,
      data: buf.toString("base64"),
    };
  }

  const isBinary = buf.includes(0);
  if (isBinary) {
    return {
      path: candidate,
      relativePath,
      name,
      size: fileSize,
      truncated,
      isBinary: true,
    };
  }

  return {
    path: candidate,
    relativePath,
    name,
    size: fileSize,
    truncated,
    isBinary: false,
    content: buf.toString("utf8"),
  };
}

// ponytail: 最小自检 — 工作空间路径边界 + 文件读取
if (process.platform === "win32") {
  console.assert(
    isPathInsideWorkspace("C:\\ws", "C:\\ws\\src"),
    "[dirBrowser] isPathInsideWorkspace 自检失败"
  );
  console.assert(
    !isPathInsideWorkspace("C:\\ws", "C:\\other"),
    "[dirBrowser] isPathInsideWorkspace 越界自检失败"
  );
}

try {
  const selfRoot = fs.mkdtempSync(path.join(os.tmpdir(), "dirBrowser-self-"));
  const selfFile = path.join(selfRoot, "sample.txt");
  fs.writeFileSync(selfFile, "preview-ok");
  const preview = readWorkspaceFile(selfRoot, "sample.txt");
  console.assert(preview.content === "preview-ok", "[dirBrowser] readWorkspaceFile 自检失败");
  fs.rmSync(selfRoot, { recursive: true, force: true });
} catch (selfErr) {
  console.warn("[dirBrowser] readWorkspaceFile 自检跳过:", selfErr);
}
