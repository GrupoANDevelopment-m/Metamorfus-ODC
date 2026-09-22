/**
 * Metamorph engine — performs the profession-change ritual and persists
 * the resulting DNA library state.
 *
 * Engine contract (round 2):
 *
 *   1. adopt(profession, ctx, [context])
 *      a) record the previous profession's retained keys
 *      b) set the new morph_focus
 *      c) forge every seed from the new profession via the bridge,
 *         with NO dedup-by-key — each (key + version + profession)
 *         tuple is a distinct historical entry. Older versions of a
 *         key remain in skills[] tagged "archaeology".
 *      d) reactivate dormant skills from past professions whose
 *         reactivation_triggers match the adoption context. Each
 *         reactivation records a use, possibly promoting the skill
 *         to transferable after the second distinct profession.
 *      e) apply time-based mastery decay across the whole library.
 *      f) write a manifest.json describing the new state.
 *      g) return the post-metamorphosis state plus a per-step report.
 *
 *   2. recall(manifest, skillKey)  — does the DNA library still contain
 *      this skill? Returns the highest-version entry or undefined.
 *
 *   3. recordUseAcross(manifest, skillKey, byProfession, context)
 *      — invoked by the Executor when a skill is actually run.
 *      Boosts mastery, marks last_used_at, may promote transferable.
 *
 *   4. summary(state)             — human-readable report of the
 *      organism's cumulative history.
 *
 * FORGET IS INTENTIONALLY ABSENT. The Metamorfus remembers everything.
 * If you want a skill to vanish, you fork a new organism without it.
 */

import path from "node:path";
import { existsSync } from "node:fs";
import { writeFile, readFile, mkdir } from "node:fs/promises";

import type {
  SkillManifest,
  MetamorphState,
  MorphFocus,
  SkillSelectorContext,
} from "./types.js";
import { chooseCandidateSkills } from "./types.js";
import { getProfession } from "./professions.js";
import { applyDecay, recordUseAcross } from "./decay.js";

export interface ForgeSkillFn {
  (
    args: {
      skillKey: string;
      pythonSource: string;
      dryRun?: boolean;
      dnaDir?: string;
    },
  ): Promise<{ output: string; data: unknown }>;
}

export interface ScanCodebaseFn {
  (args: { root?: string }): Promise<{
    data: {
      fileCount: number;
      totalBytes: number;
      todoCount: number;
      topExtensions: Record<string, number>;
    };
  }>;
}

export interface ManifestMeta {
  state: MetamorphState;
  /**
   * All skill entries ever forged. May contain multiple versions of
   * the same key. The latest version of each key is the active one;
   * earlier versions are "archaeology".
   */
  skills: SkillManifest[];
  profession_chain: string[];
  metamorphosis_log: Array<{
    from: string;
    to: string;
    at: string;
    skills_forged: string[];
    skills_reactivated: string[];
    retained_from_past: string[];
  }>;
}

export interface MetamorphContext {
  workspaceRoot: string;
  forgeSkill: ForgeSkillFn;
  scanCodebase: ScanCodebaseFn;
  /** Optional override; default `packages/metamorfus-src/dna_library`. */
  dnaDir?: string;
}

/** Default DNA library path, relative to workspaceRoot. */
export const DEFAULT_DNA_DIR = "packages/metamorfus-src/dna_library";

/** Mastery a freshly-forged skill starts at. Half-trained. */
export const FORGE_MASTERY = 0.5;

async function ensureDnaDir(ctx: MetamorphContext): Promise<string> {
  const target = ctx.dnaDir ?? DEFAULT_DNA_DIR;
  const dnaDir = path.join(ctx.workspaceRoot, target);
  if (!existsSync(dnaDir)) {
    await mkdir(dnaDir, { recursive: true });
  }
  return dnaDir;
}

export async function loadManifest(ctx: MetamorphContext): Promise<ManifestMeta> {
  const dnaDir = await ensureDnaDir(ctx);
  const manifestPath = path.join(dnaDir, "manifest.json");
  if (!existsSync(manifestPath)) {
    return emptyManifest();
  }
  try {
    const raw = await readFile(manifestPath, "utf8");
    const parsed = JSON.parse(raw) as ManifestMeta;
    if (!parsed.state) parsed.state = emptyState();
    if (!parsed.skills) parsed.skills = [];
    if (!parsed.profession_chain) parsed.profession_chain = [];
    if (!parsed.metamorphosis_log) parsed.metamorphosis_log = [];
    // Backfill: round-2 fields. Old manifests persisted before the
    // round-2 schema upgrade may lack these. Defaults are safe.
    for (const s of parsed.skills) {
      if (s.mastery === undefined) s.mastery = 0.5;
      if (s.last_used_at === undefined) s.last_used_at = null;
      if (!Array.isArray(s.usage_history)) s.usage_history = [];
      if (typeof s.transferable !== "boolean") s.transferable = false;
      if (!Array.isArray(s.reactivation_triggers)) s.reactivation_triggers = [];
      if (!s.status) s.status = "dormant";
    }
    for (const ev of parsed.metamorphosis_log) {
      if (!Array.isArray(ev.skills_reactivated)) ev.skills_reactivated = [];
    }
    // Round-2 state field: `active_skill_keys` (was `active_skill_count` in
    // the round-1 schema). Legacy manifests may still carry the old key.
    const legacy = parsed.state as unknown as { active_skill_count?: number };
    if (parsed.state.active_skill_keys === undefined && legacy.active_skill_count !== undefined) {
      const seen = new Set<string>();
      const keys: string[] = [];
      for (const s of parsed.skills) {
        if (!seen.has(s.key)) {
          seen.add(s.key);
          keys.push(s.key);
        }
      }
      parsed.state.active_skill_keys = keys;
    }
    if (!Array.isArray(parsed.state.decayed_skills)) {
      parsed.state.decayed_skills = [];
    }
    return parsed;
  } catch {
    return emptyManifest();
  }
}

function emptyManifest(): ManifestMeta {
  return {
    state: emptyState(),
    skills: [],
    profession_chain: [],
    metamorphosis_log: [],
  };
}

function emptyState(): MetamorphState {
  return {
    profession: "(unborn)",
    morph_focus: "BALANCED",
    cumulative_skill_count: 0,
    active_skill_keys: [],
    retained_from_past_professions: [],
    decayed_skills: [],
  };
}

async function persistManifest(
  ctx: MetamorphContext,
  manifest: ManifestMeta,
): Promise<string> {
  const dnaDir = await ensureDnaDir(ctx);
  const manifestPath = path.join(dnaDir, "manifest.json");
  const tmpPath = `${manifestPath}.tmp`;
  await writeFile(tmpPath, JSON.stringify(manifest, null, 2), "utf8");
  const { rename } = await import("node:fs/promises");
  await rename(tmpPath, manifestPath);
  return manifestPath;
}

/** Find latest entry for a key (or undefined). */
function latestVersion(
  manifest: ManifestMeta,
  skillKey: string,
): SkillManifest | undefined {
  let best: SkillManifest | undefined;
  for (const s of manifest.skills) {
    if (s.key !== skillKey) continue;
    if (!best || s.version > best.version) best = s;
  }
  return best;
}

/** Tag all but the latest version of each key as "archaeology". */
function tagArchaeology(skills: SkillManifest[]): SkillManifest[] {
  // Group by key, find max version per key, tag the rest.
  const maxVersionByKey = new Map<string, number>();
  for (const s of skills) {
    const cur = maxVersionByKey.get(s.key) ?? 0;
    if (s.version > cur) maxVersionByKey.set(s.key, s.version);
  }
  return skills.map((s) => {
    if (s.version < (maxVersionByKey.get(s.key) ?? s.version)) {
      return s.status === "archaeology" ? s : { ...s, status: "archaeology" };
    }
    return s;
  });
}

/**
 * Adopt a profession. The cortex should pass a `context` describing why
 * (e.g., the latest user message or environment) so dormant skills
 * matching triggers get reactivated.
 *
 * Idempotency rule: a re-adopt of the current profession with the SAME
 * version of every seed is a no-op for forging. The chain is preserved.
 *
 * If a newer version of any seed is forged (the seed spec bumps the
 * version), the older version is kept as archaeology.
 */
export async function adopt(
  professionName: string,
  ctx: MetamorphContext,
  context: SkillSelectorContext = { text: "" },
): Promise<{
  state: MetamorphState;
  report: ManifestMeta;
  steps: Array<{
    skillKey: string;
    status: "FORGED" | "SKIPPED" | "FAILED";
    detail?: string;
  }>;
  reactivatedSkills: string[];
}> {
  const profession = getProfession(professionName);
  if (!profession) {
    throw new Error(`adopt: unknown profession "${professionName}". Known: scientist, lumberjack, architect`);
  }

  const manifest = await loadManifest(ctx);
  const nowMs = Date.now();
  const previousProfession = manifest.state.profession;

  const steps: Array<{
    skillKey: string;
    status: "FORGED" | "SKIPPED" | "FAILED";
    detail?: string;
  }> = [];

  const forgedKeys: string[] = [];

  for (const seed of profession.seeds) {
    // Idempotency: if a SAME-version entry from THIS profession exists,
    // skip the forge call (but keep the entry's last_used_at fresh — it's
    // being re-encountered).
    const sameVersion = manifest.skills.find(
      (s) =>
        s.key === seed.key &&
        s.profession === professionName &&
        s.version === seed.version,
    );
    if (sameVersion) {
      // Pure no-op: re-adopting the same profession at the same version
      // does NOT count as a use. The skill exists, mastery holds, no
      // usage_history entry, no transferable promotion. It's just an
      // acknowledgement that the organism is still in this profession.
      steps.push({
        skillKey: seed.key,
        status: "SKIPPED",
        detail: "already forged at this version",
      });
      continue;
    }
    try {
      const result = await ctx.forgeSkill({
        skillKey: seed.key,
        pythonSource: seed.source,
        dryRun: false,
        dnaDir: ctx.dnaDir ?? DEFAULT_DNA_DIR,
      });
      const now = new Date(nowMs).toISOString();
      const newSkill: SkillManifest = {
        key: seed.key,
        profession: professionName,
        version: seed.version,
        source: seed.source,
        foraged_by: seed.foraged_by,
        morph_focus: seed.morph_focus,
        mastery: FORGE_MASTERY,
        last_used_at: null,
        usage_history: [],
        transferable: false,
        reactivation_triggers: seed.reactivation_triggers ?? [],
        forged_at: now,
        status: "dormant",
      };
      // KEY-LEVEL HISTORY: append, do NOT dedup by key. The engine
      // will later tag everything except the latest version of each
      // key as "archaeology".
      manifest.skills.push(newSkill);
      forgedKeys.push(seed.key);
      steps.push({ skillKey: seed.key, status: "FORGED", detail: result.output });
    } catch (e: any) {
      steps.push({
        skillKey: seed.key,
        status: "FAILED",
        detail: e?.message ?? String(e),
      });
    }
  }

  // Reactivation pass: dormant skills from past professions whose
  // reactivation_triggers match the adoption context get a usage event.
  // After the second distinct profession uses a skill, it gets
  // promoted to transferable=true (handled in recordUse).
  const reactivated: string[] = [];
  const adoptedContextText = `${professionName} ${context.text ?? ""} ${profession.description}`.toLowerCase();
  const adoptedContextTags = new Set((context.tags ?? []).map((t) => t.toLowerCase()));
  const dormantKeys = new Set<string>();
  for (const s of manifest.skills) {
    if (
      s.profession !== professionName &&
      s.status !== "archaeology"
    ) {
      dormantKeys.add(s.key);
    }
  }
  for (const key of dormantKeys) {
    const latest = latestVersion(manifest, key);
    if (!latest) continue;
    const triggers = latest.reactivation_triggers.map((t) => t.toLowerCase());
    const matched = triggers.some(
      (t) => adoptedContextText.includes(t) || adoptedContextTags.has(t),
    );
    if (matched) {
      manifest.skills = recordUseAcross(
        manifest.skills,
        key,
        professionName,
        `reactivated on adopt:${professionName}`,
        nowMs,
      );
      reactivated.push(key);
    }
  }

  // Tag archaeology: every entry that's not the latest version of its key.
  manifest.skills = tagArchaeology(manifest.skills);

  // Apply time-based mastery decay across the library.
  manifest.skills = applyDecay(manifest.skills, nowMs);

  // Compute new state.
  const cumulativeKeys = new Set(manifest.skills.map((s) => s.key));
  const latestByKey = new Map<string, SkillManifest>();
  for (const s of manifest.skills) {
    if (!latestByKey.has(s.key) || s.version > latestByKey.get(s.key)!.version) {
      latestByKey.set(s.key, s);
    }
  }
  const activeSkillKeys = [...latestByKey.values()]
    .filter((s) => s.status !== "archaeology")
    .map((s) => s.key);
  const retainedFromPast = [...latestByKey.values()]
    .filter((s) => s.profession !== professionName)
    .map((s) => s.key);
  const decayedSkills = [...latestByKey.values()]
    .filter((s) => s.status === "decayed")
    .map((s) => s.key);

  const next: MetamorphState = {
    profession: professionName,
    morph_focus: profession.default_morph_focus as MorphFocus,
    cumulative_skill_count: cumulativeKeys.size,
    active_skill_keys: activeSkillKeys,
    retained_from_past_professions: retainedFromPast,
    decayed_skills: decayedSkills,
  };

  const now = new Date(nowMs).toISOString();
  manifest.state = next;
  manifest.profession_chain = [
    ...new Set([...manifest.profession_chain, professionName]),
  ];
  const didForge = forgedKeys.length > 0;
  const didSwitch = previousProfession !== professionName;
  if (didForge || didSwitch || reactivated.length > 0) {
    manifest.metamorphosis_log.push({
      from: previousProfession,
      to: professionName,
      at: now,
      skills_forged: forgedKeys,
      skills_reactivated: reactivated,
      retained_from_past: retainedFromPast,
    });
  }

  await persistManifest(ctx, manifest);
  return {
    state: next,
    report: manifest,
    steps,
    reactivatedSkills: reactivated,
  };
}

/**
 * Recall a skill from the DNA library. Returns the highest-version
 * (most recent) entry, or undefined.
 */
export function recall(
  manifest: ManifestMeta,
  skillKey: string,
): SkillManifest | undefined {
  return latestVersion(manifest, skillKey);
}

/**
 * Record that a specific skill was just used. Convenience wrapper used
 * by the Executor. Mutates a copy and returns it.
 */
export function useSkill(
  manifest: ManifestMeta,
  skillKey: string,
  byProfession: string,
  context: string,
): ManifestMeta {
  const updated = recordUseAcross(manifest.skills, skillKey, byProfession, context);
  return { ...manifest, skills: updated };
}

/**
 * Re-evaluate the candidate skill set for an executor context. This
 * honours morph_focus gating AND reactivation triggers.
 */
export function candidates(
  manifest: ManifestMeta,
  context: SkillSelectorContext,
): SkillManifest[] {
  return chooseCandidateSkills(manifest.skills, manifest.state, context);
}

/**
 * Build a human-readable summary of what the organism has become across
 * metamorphoses.
 */
export function summary(manifest: ManifestMeta): string {
  const latestByKey = new Map<string, SkillManifest>();
  for (const s of manifest.skills) {
    if (!latestByKey.has(s.key) || s.version > latestByKey.get(s.key)!.version) {
      latestByKey.set(s.key, s);
    }
  }
  const archaeology: SkillManifest[] = manifest.skills.filter(
    (s) => s.status === "archaeology",
  );
  const lines: string[] = [];
  lines.push(`Active profession: ${manifest.state.profession}`);
  lines.push(`Current morph_focus: ${manifest.state.morph_focus}`);
  lines.push(`Cumulative unique skills: ${manifest.state.cumulative_skill_count}`);
  lines.push(
    `Reachable right now (focus + transferable + reactivated): ${manifest.state.active_skill_keys.length}`,
  );
  lines.push(`Decayed (mastery < 0.2): ${manifest.state.decayed_skills.length}`);
  lines.push(
    `Archaeology (older versions preserved): ${archaeology.length}`,
  );
  lines.push("");
  lines.push(
    `Profession chain (chronological): ${manifest.profession_chain.join(" -> ")}`,
  );
  lines.push("");

  const linesByProfession = new Map<string, SkillManifest[]>();
  for (const s of latestByKey.values()) {
    if (!linesByProfession.has(s.profession))
      linesByProfession.set(s.profession, []);
    linesByProfession.get(s.profession)!.push(s);
  }
  lines.push("Latest version of each skill (by origin profession):");
  for (const [prof, skills] of linesByProfession) {
    lines.push(`  ${prof}:`);
    for (const s of skills) {
      const t = s.transferable ? ", transferable" : "";
      const u = s.usage_history.length > 0
        ? `, used by ${new Set(s.usage_history.map((u) => u.by_profession)).size} professions`
        : "";
      lines.push(
        `    - ${s.key} v${s.version}  mastery=${s.mastery.toFixed(2)}  status=${s.status}${t}${u}`,
      );
    }
  }

  if (archaeology.length > 0) {
    lines.push("");
    lines.push("Archaeology (older versions preserved, not invoked):");
    for (const s of archaeology) {
      lines.push(
        `  - ${s.key} v${s.version} (was the canonical version before re-forge)`,
      );
    }
  }

  lines.push("");
  lines.push("Metamorphosis log:");
  for (const ev of manifest.metamorphosis_log) {
    lines.push(
      `  ${ev.at}  ${ev.from} → ${ev.to}  (forged: ${ev.skills_forged.length}, reactivated: ${ev.skills_reactivated.length}, retained: ${ev.retained_from_past.length})`,
    );
  }
  return lines.join("\n");
}
