/**
 * MCP Discovery Engine — Melista's self-evolution system.
 *
 * Searches npm registry and MCP directories for servers matching needed
 * capabilities. Installs them at runtime and connects via the MCP client.
 *
 * This is what makes Melista self-evolving: when it encounters a task
 * requiring a skill it doesn't have, it finds and acquires the tool.
 */
import { execSync } from "node:child_process";
import { McpJobClient, type McpServerConfig } from "./client.js";
import { getDb } from "../db/index.js";

// --- Known MCP Registry (curated, tested) ---

export interface McpSkill {
  id: string;
  name: string;
  description: string;
  npmPackage?: string;
  githubRepo?: string;
  command: string;
  args: string[];
  tools: string[];
  category: string;
  authRequired: boolean;
  authEnvVar?: string;
}

/** Curated registry of known-good MCP servers by category */
export const SKILL_REGISTRY: McpSkill[] = [
  // --- Graphics/Images ---
  { id: "replicate", name: "Replicate (Flux/SD/DALL-E)", description: "AI image generation via Replicate API", npmPackage: "replicate-mcp", command: "npx", args: ["-y", "replicate-mcp"], tools: ["generate_image"], category: "image", authRequired: true, authEnvVar: "REPLICATE_API_TOKEN" },
  { id: "mcp-image", name: "MCP Image Generator", description: "AI image generation", npmPackage: "mcp-image", command: "npx", args: ["-y", "mcp-image"], tools: ["generate_image"], category: "image", authRequired: true },
  { id: "quickchart", name: "QuickChart (Charts/QR)", description: "Generate charts, QR codes, barcodes", npmPackage: "@gongrzhe/quickchart-mcp-server", command: "npx", args: ["-y", "@gongrzhe/quickchart-mcp-server"], tools: ["create_chart", "create_qr"], category: "chart", authRequired: false },

  // --- Documents ---
  { id: "mcp-pdf", name: "PDF Generator", description: "Create PDFs with full Unicode support", npmPackage: "@mcp-z/mcp-pdf", command: "npx", args: ["-y", "@mcp-z/mcp-pdf"], tools: ["create_pdf"], category: "document", authRequired: false },
  { id: "md2pdf", name: "Markdown to PDF", description: "Convert markdown to styled PDF", npmPackage: "@99xio/markdown2pdf-mcp", command: "npx", args: ["-y", "@99xio/markdown2pdf-mcp"], tools: ["convert_to_pdf"], category: "document", authRequired: false },
  { id: "drawio", name: "draw.io Diagrams", description: "Create and edit diagrams", npmPackage: "@drawio/mcp", command: "npx", args: ["-y", "@drawio/mcp"], tools: ["create_diagram"], category: "diagram", authRequired: false },

  // --- Spreadsheets ---
  { id: "excel", name: "Excel Reader/Writer", description: "Read and write MS Excel files", npmPackage: "@negokaz/excel-mcp-server", command: "npx", args: ["-y", "@negokaz/excel-mcp-server"], tools: ["read_excel", "write_excel"], category: "spreadsheet", authRequired: false },

  // --- Presentations ---
  { id: "mermaid", name: "Mermaid Diagrams", description: "Generate diagrams and flowcharts", npmPackage: "mcp-mermaid", command: "npx", args: ["-y", "mcp-mermaid"], tools: ["render_mermaid"], category: "presentation", authRequired: false },

  // --- Charts ---
  { id: "antv-chart", name: "AntV Charts (25+ types)", description: "Professional data visualization", npmPackage: "@antv/mcp-server-chart", command: "npx", args: ["-y", "@antv/mcp-server-chart"], tools: ["create_chart"], category: "chart", authRequired: false },

  // --- QA / Quality ---
  { id: "eslint", name: "ESLint Code Linter", description: "Lint JavaScript/TypeScript code", npmPackage: "@eslint/mcp", command: "npx", args: ["-y", "@eslint/mcp"], tools: ["lint_code"], category: "qa", authRequired: false },
  { id: "playwright", name: "Playwright Testing", description: "Automated browser testing", npmPackage: "@playwright/mcp", command: "npx", args: ["-y", "@playwright/mcp"], tools: ["run_test"], category: "qa", authRequired: false },

  // --- Music/Audio ---
  { id: "music-studio", name: "Music Studio", description: "Compose music from ABC notation", npmPackage: "mcp-music-studio", command: "npx", args: ["-y", "mcp-music-studio"], tools: ["compose_music"], category: "music", authRequired: false },

  // --- SEO ---
  { id: "seo-free", name: "SEO Analysis (Free)", description: "SEO analysis based on Ahrefs data", githubRepo: "cnych/seo-mcp", command: "npx", args: ["-y", "github:cnych/seo-mcp"], tools: ["analyze_seo"], category: "seo", authRequired: false },

  // --- Design ---
  { id: "figma", name: "Figma", description: "Access and implement Figma designs", npmPackage: "figma-developer-mcp", command: "npx", args: ["-y", "figma-developer-mcp"], tools: ["get_figma_data"], category: "design", authRequired: true, authEnvVar: "FIGMA_ACCESS_TOKEN" },
];

// --- Dynamic npm Search ---

interface NpmSearchResult {
  name: string;
  version: string;
  description: string;
}

export async function searchNpmForMcp(query: string): Promise<NpmSearchResult[]> {
  try {
    const url = `https://registry.npmjs.org/-/v1/search?text=mcp+${encodeURIComponent(query)}&size=10&keywords=mcp`;
    const resp = await fetch(url, { signal: AbortSignal.timeout(10000) });
    if (!resp.ok) return [];
    const data = await resp.json() as { objects: Array<{ package: NpmSearchResult }> };
    return data.objects.map((o) => o.package);
  } catch {
    return [];
  }
}

// --- Smithery Registry Search ---

export async function searchSmithery(query: string): Promise<Array<{ name: string; qualifiedName: string; description: string }>> {
  try {
    const url = `https://registry.smithery.ai/servers?q=${encodeURIComponent(query)}`;
    const resp = await fetch(url, { signal: AbortSignal.timeout(10000) });
    if (!resp.ok) return [];
    const data = await resp.json() as { servers?: Array<{ name: string; qualifiedName: string; description: string }> };
    return data.servers ?? [];
  } catch {
    return [];
  }
}

// --- Runtime Install ---

const PACKAGE_NAME_REGEX = /^(@[\w-]+\/)?[\w.-]+$/;

export function installPackage(packageName: string): boolean {
  if (!PACKAGE_NAME_REGEX.test(packageName)) {
    console.error(`[Discovery] Invalid package name: ${packageName}`);
    return false;
  }

  try {
    execSync(`npm install ${packageName} --no-save`, {
      cwd: process.cwd(),
      stdio: "pipe",
      timeout: 60000,
    });
    return true;
  } catch (err) {
    console.error(`[Discovery] Failed to install ${packageName}:`, err instanceof Error ? err.message : err);
    return false;
  }
}

// --- Skill Matching ---

/** Find skills in registry matching a task description */
export function findMatchingSkills(taskDescription: string): McpSkill[] {
  const desc = taskDescription.toLowerCase();
  const matches: McpSkill[] = [];

  const keywords: Record<string, string[]> = {
    image: ["image", "logo", "graphic", "design", "illustration", "banner", "thumbnail", "icon", "poster", "flyer"],
    chart: ["chart", "graph", "visualization", "dashboard", "data viz", "bar chart", "pie chart", "infographic"],
    document: ["pdf", "document", "report", "whitepaper", "ebook", "brochure"],
    spreadsheet: ["excel", "spreadsheet", "csv", "xlsx", "google sheets", "pivot"],
    presentation: ["powerpoint", "presentation", "slides", "pptx", "slide deck", "pitch deck"],
    music: ["music", "song", "audio", "soundtrack", "melody", "beat", "composition"],
    seo: ["seo", "search engine", "keyword", "backlink", "ranking", "serp"],
    design: ["figma", "ui design", "ux design", "wireframe", "prototype", "mockup"],
    diagram: ["diagram", "flowchart", "architecture diagram", "sequence diagram", "uml"],
    qa: ["lint", "code review", "test", "quality", "bug"],
  };

  for (const [category, kws] of Object.entries(keywords)) {
    if (kws.some((kw) => desc.includes(kw))) {
      const categorySkills = SKILL_REGISTRY.filter((s) => s.category === category);
      matches.push(...categorySkills);
    }
  }

  return matches;
}

// --- Installed Skills Tracking (SQLite) ---

export function recordInstalledSkill(skillId: string, packageName: string): void {
  const db = getDb();
  db.prepare(`
    CREATE TABLE IF NOT EXISTS installed_skills (
      skill_id TEXT PRIMARY KEY,
      package_name TEXT NOT NULL,
      installed_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000),
      times_used INTEGER DEFAULT 0,
      last_used INTEGER
    )
  `).run();

  db.prepare(
    "INSERT OR REPLACE INTO installed_skills (skill_id, package_name, installed_at) VALUES (?, ?, ?)"
  ).run(skillId, packageName, Date.now());
}

export function getInstalledSkills(): Array<{ skill_id: string; package_name: string; times_used: number }> {
  const db = getDb();
  try {
    return db.prepare("SELECT skill_id, package_name, times_used FROM installed_skills ORDER BY times_used DESC").all() as Array<{ skill_id: string; package_name: string; times_used: number }>;
  } catch {
    return [];
  }
}

export function recordSkillUsage(skillId: string): void {
  const db = getDb();
  try {
    db.prepare("UPDATE installed_skills SET times_used = times_used + 1, last_used = ? WHERE skill_id = ?").run(Date.now(), skillId);
  } catch { /* ignore */ }
}

// --- Auto-Acquire Skill ---

export async function acquireSkill(
  skill: McpSkill,
  mcpClient: McpJobClient,
): Promise<boolean> {
  const pkg = skill.npmPackage ?? `github:${skill.githubRepo}`;
  console.log(`[Discovery] Acquiring skill: ${skill.name} (${pkg})`);

  // Install the package
  const installed = installPackage(pkg);
  if (!installed) return false;

  // Connect as MCP server
  const serverConfig: McpServerConfig = {
    name: skill.name,
    command: skill.command,
    args: skill.args,
    searchTool: skill.tools[0] ?? "list_tools",
    searchArgs: {},
    normalise: () => [], // Skills don't return tasks
  };

  try {
    await mcpClient.connect(skill.id, serverConfig);
    recordInstalledSkill(skill.id, pkg);
    console.log(`[Discovery] Skill acquired: ${skill.name}`);
    return true;
  } catch (err) {
    console.error(`[Discovery] Failed to connect ${skill.name}:`, err instanceof Error ? err.message : err);
    return false;
  }
}
