import { createHash } from 'node:crypto';
import type { Blueprint } from '../parser/schema';

export class BlueprintUtils {
  /**
   * Calculate a stable hash for a blueprint
   */
  static calculateHash(blueprint: Blueprint): string {
    const stableString = JSON.stringify(BlueprintUtils.sortObject(blueprint));
    return createHash('sha256').update(stableString).digest('hex');
  }

  /**
   * Recursively sort object keys for stable JSON stringification
   */
  // biome-ignore lint/suspicious/noExplicitAny: Generic JSON sort utility
  private static sortObject(obj: any): any {
    if (obj === null || typeof obj !== 'object') {
      return obj;
    }

    if (Array.isArray(obj)) {
      const sortedArray = obj.map((item) => BlueprintUtils.sortObject(item));
      // For stability, sort arrays of objects by a common key if possible,
      // otherwise sort by their stringified representation.
      return sortedArray.sort((a, b) => {
        const sA = JSON.stringify(a);
        const sB = JSON.stringify(b);
        return sA.localeCompare(sB);
      });
    }

    // biome-ignore lint/suspicious/noExplicitAny: Building dynamic sorted object
    const sortedObj: any = {};
    Object.keys(obj)
      .sort()
      .forEach((key) => {
        sortedObj[key] = BlueprintUtils.sortObject(obj[key]);
      });
    return sortedObj;
  }

  /**
   * Detect drift between a blueprint and generated outputs
   * Returns a list of differences found.
   */
  static detectDrift(
    blueprint: Blueprint,
    generatedFiles: { path: string; purpose?: string }[]
  ): string[] {
    const diffs: string[] = [];

    // Check for missing files
    for (const blueprintFile of blueprint.files) {
      const generated = generatedFiles.find((f) => f.path === blueprintFile.path);
      if (!generated) {
        diffs.push(`Missing file: ${blueprintFile.path}`);
      } else if (
        blueprintFile.purpose &&
        generated.purpose &&
        blueprintFile.purpose !== generated.purpose
      ) {
        // Optional: Check purpose drift if provided in outputs
        diffs.push(
          `Purpose drift in ${blueprintFile.path}: expected "${blueprintFile.purpose}", got "${generated.purpose}"`
        );
      }
    }

    // Check for unexpected extra files
    for (const generated of generatedFiles) {
      const inBlueprint = blueprint.files.some((f) => f.path === generated.path);
      if (!inBlueprint) {
        diffs.push(`Extra file not in blueprint: ${generated.path}`);
      }
    }

    return diffs;
  }
}
