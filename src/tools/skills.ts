/**
 * Self-evolution tools — let Melista discover and acquire new capabilities.
 *
 * When Melista encounters a task it can't fully handle, it uses these tools
 * to search for MCP servers that provide the needed capability, install them,
 * and use them to complete the work.
 */
import type { Tool } from "./types.js";
import {
  findMatchingSkills,
  searchNpmForMcp,
  SKILL_REGISTRY,
  getInstalledSkills,
} from "../mcp/discovery.js";

export const searchSkills: Tool = {
  definition: {
    name: "search_skills",
    description: "Search for MCP tools/skills that can help complete the current task. Use when you need capabilities like image generation, PDF creation, Excel processing, chart making, music, video, design, SEO, etc. Returns available skills that can be acquired.",
    input_schema: {
      type: "object",
      properties: {
        query: { type: "string", description: "What capability you need (e.g. 'image generation', 'PDF creation', 'chart', 'music')" },
      },
      required: ["query"],
    },
  },
  async execute(input) {
    const query = (input.query as string) ?? "";

    // Search curated registry first
    const registryMatches = findMatchingSkills(query);

    // Search npm for more
    const npmResults = await searchNpmForMcp(query);

    // Get already installed
    const installed = getInstalledSkills();
    const installedIds = new Set(installed.map((s) => s.skill_id));

    const parts: string[] = [];

    if (registryMatches.length > 0) {
      parts.push("## Available Skills (curated, tested):\n");
      for (const skill of registryMatches) {
        const status = installedIds.has(skill.id) ? "INSTALLED" : skill.authRequired ? `NEEDS ${skill.authEnvVar ?? "API KEY"}` : "READY";
        parts.push(`- **${skill.name}** [${status}]: ${skill.description} (category: ${skill.category})`);
      }
    }

    if (npmResults.length > 0) {
      parts.push("\n## Additional npm packages found:\n");
      for (const pkg of npmResults.slice(0, 5)) {
        parts.push(`- **${pkg.name}** v${pkg.version}: ${pkg.description}`);
      }
    }

    if (installed.length > 0) {
      parts.push("\n## Already installed skills:\n");
      for (const s of installed) {
        parts.push(`- ${s.skill_id} (${s.package_name}) — used ${s.times_used} times`);
      }
    }

    if (parts.length === 0) {
      parts.push(`No specific MCP skills found for "${query}". Try using the E2B sandbox to write code that accomplishes this task.`);
    }

    return { success: true, data: parts.join("\n") };
  },
};

export const listAllSkills: Tool = {
  definition: {
    name: "list_available_skills",
    description: "List all available MCP skills in the registry that Melista can acquire. Shows categories: image, chart, document, spreadsheet, presentation, music, seo, design, diagram, qa.",
    input_schema: {
      type: "object",
      properties: {},
    },
  },
  async execute() {
    const installed = getInstalledSkills();
    const installedIds = new Set(installed.map((s) => s.skill_id));

    const byCategory = new Map<string, typeof SKILL_REGISTRY>();
    for (const skill of SKILL_REGISTRY) {
      const list = byCategory.get(skill.category) ?? [];
      list.push(skill);
      byCategory.set(skill.category, list);
    }

    const parts: string[] = ["# Melista Skill Registry\n"];
    for (const [category, skills] of byCategory) {
      parts.push(`## ${category.toUpperCase()}`);
      for (const skill of skills) {
        const status = installedIds.has(skill.id) ? "INSTALLED" : skill.authRequired ? "NEEDS KEY" : "AVAILABLE";
        parts.push(`  [${status}] ${skill.name} — ${skill.description}`);
      }
      parts.push("");
    }

    parts.push(`\nTotal: ${SKILL_REGISTRY.length} skills, ${installed.length} installed`);
    return { success: true, data: parts.join("\n") };
  },
};
