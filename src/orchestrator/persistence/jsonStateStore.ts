import { promises as fs } from "fs";
import path from "path";
import { ProjectState, StateStore } from "../types";

export class JsonStateStore implements StateStore {
  private readonly filePath: string;

  constructor(filePath: string) {
    this.filePath = filePath;
  }

  async load(): Promise<ProjectState | null> {
    try {
      const raw = await fs.readFile(this.filePath, "utf8");
      return JSON.parse(raw) as ProjectState;
    } catch (error) {
      if (error instanceof Error && "code" in error && error.code === "ENOENT") {
        return null;
      }
      throw error;
    }
  }

  async save(state: ProjectState): Promise<void> {
    const dir = path.dirname(this.filePath);
    await fs.mkdir(dir, { recursive: true });
    const payload = JSON.stringify(state, null, 2);
    await fs.writeFile(this.filePath, `${payload}\n`, "utf8");
  }
}
