import { existsSync, readdirSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import type { AppConfig, ProjectInfo } from "./types.js";

export function listFallbackFolderProjects(config: AppConfig): ProjectInfo[] {
  if (!existsSync(config.projectsRoot)) return [];
  return readdirSync(config.projectsRoot)
    .filter((name) => !config.excludeProjectNames.includes(name))
    .map((name) => ({ id: `folder:${name}`, name, path: join(config.projectsRoot, name), source: "fallback-folder" as const }))
    .filter((project) => statSync(project.path).isDirectory())
    .sort((a, b) => a.name.localeCompare(b.name));
}

export function findFallbackFolderProject(config: AppConfig, name: string): ProjectInfo | null {
  const normalized = name.toLowerCase();
  return listFallbackFolderProjects(config).find((project) => project.name.toLowerCase() === normalized || project.id.toLowerCase() === normalized) || null;
}

export function assertProjectInsideRoot(config: AppConfig, projectPath: string): void {
  const root = resolve(config.projectsRoot).toLowerCase();
  const target = resolve(projectPath).toLowerCase();
  if (!target.startsWith(root)) {
    throw new Error("Project path is outside CODEX_PROJECTS_ROOT fallback root.");
  }
}
