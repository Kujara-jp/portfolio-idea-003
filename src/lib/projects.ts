import fs from "node:fs/promises";
import path from "node:path";

import matter from "gray-matter";

export type ProjectFrontmatter = {
  slug: string;
  title: string;
  summary: string;
  tags: string[];
  featured: boolean;
  repoUrl: string;
  demoUrl: string;
  date: string;
};

export type Project = ProjectFrontmatter & {
  content: string;
};

const projectsDirectory = path.join(process.cwd(), "content", "projects");

function readRequiredString(value: unknown, field: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`Invalid '${field}' in project frontmatter.`);
  }

  return value;
}

function readOptionalString(value: unknown, field: string): string {
  if (typeof value !== "string") {
    throw new Error(`Invalid '${field}' in project frontmatter.`);
  }

  return value.trim();
}

function readStringArray(value: unknown, field: string): string[] {
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) {
    throw new Error(`Invalid '${field}' in project frontmatter.`);
  }

  return value;
}

function readBoolean(value: unknown, field: string): boolean {
  if (typeof value !== "boolean") {
    throw new Error(`Invalid '${field}' in project frontmatter.`);
  }

  return value;
}

function parseProjectFrontmatter(data: Record<string, unknown>): ProjectFrontmatter {
  return {
    slug: readRequiredString(data.slug, "slug"),
    title: readRequiredString(data.title, "title"),
    summary: readRequiredString(data.summary, "summary"),
    tags: readStringArray(data.tags, "tags"),
    featured: readBoolean(data.featured, "featured"),
    repoUrl: readOptionalString(data.repoUrl, "repoUrl"),
    demoUrl: readOptionalString(data.demoUrl, "demoUrl"),
    date: readRequiredString(data.date, "date"),
  };
}

async function readProjectFile(filePath: string): Promise<Project> {
  const file = await fs.readFile(filePath, "utf8");
  const { data, content } = matter(file);
  const frontmatter = parseProjectFrontmatter(data);

  return {
    ...frontmatter,
    content,
  };
}

export async function getProjectSlugs(): Promise<string[]> {
  const entries = await fs.readdir(projectsDirectory);

  return entries
    .filter((entry) => entry.endsWith(".mdx"))
    .map((entry) => entry.replace(/\.mdx$/, ""));
}

export async function getAllProjects(): Promise<ProjectFrontmatter[]> {
  const slugs = await getProjectSlugs();

  const projects = await Promise.all(
    slugs.map(async (slug) => {
      const filePath = path.join(projectsDirectory, `${slug}.mdx`);
      const project = await readProjectFile(filePath);

      return {
        slug: project.slug,
        title: project.title,
        summary: project.summary,
        tags: project.tags,
        featured: project.featured,
        repoUrl: project.repoUrl,
        demoUrl: project.demoUrl,
        date: project.date,
      } satisfies ProjectFrontmatter;
    }),
  );

  return projects.sort((a, b) => b.date.localeCompare(a.date));
}

export async function getProjectBySlug(slug: string): Promise<Project | null> {
  const filePath = path.join(projectsDirectory, `${slug}.mdx`);

  try {
    const project = await readProjectFile(filePath);

    if (project.slug !== slug) {
      return null;
    }

    return project;
  } catch (error) {
    const message = error instanceof Error ? error.message : "";

    if (message.includes("ENOENT")) {
      return null;
    }

    throw error;
  }
}
