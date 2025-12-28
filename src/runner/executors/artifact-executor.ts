import * as fs from 'node:fs';
import * as path from 'node:path';
import type { ExpressionContext } from '../../expression/evaluator.ts';
import { ExpressionEvaluator } from '../../expression/evaluator.ts';
import type { ArtifactStep } from '../../parser/schema.ts';
import type { Logger } from '../../utils/logger.ts';
import type { StepResult } from './types.ts';

/**
 * Execute an artifact step (upload/download)
 */
export async function executeArtifactStep(
    step: ArtifactStep,
    context: ExpressionContext,
    logger: Logger,
    options: { artifactRoot?: string; workflowDir?: string; runId?: string }
): Promise<StepResult> {
    const baseDir = options.workflowDir || process.cwd();
    const rawName = ExpressionEvaluator.evaluateString(step.name, context);
    if (typeof rawName !== 'string' || rawName.trim().length === 0) {
        throw new Error('Artifact name must be a non-empty string');
    }
    const sanitizedName = rawName.replace(/[^a-zA-Z0-9._-]/g, '_');
    if (sanitizedName !== rawName) {
        logger.warn(`⚠️  Artifact name "${rawName}" contained unsafe characters. Using "${sanitizedName}".`);
    }

    const artifactRoot = options.artifactRoot || path.join(process.cwd(), '.keystone', 'artifacts');
    const runDir = options.runId ? path.join(artifactRoot, options.runId) : artifactRoot;

    if (!fs.existsSync(runDir)) {
        fs.mkdirSync(runDir, { recursive: true });
    }

    const artifactPath = path.join(runDir, sanitizedName);

    if (step.op === 'upload') {
        const source = ExpressionEvaluator.evaluateString(step.path, context);
        const sourcePath = path.isAbsolute(source) ? source : path.join(baseDir, source);

        if (!fs.existsSync(sourcePath)) {
            throw new Error(`Source file not found for upload: ${sourcePath}`);
        }

        // copy file to artifact area
        await fs.promises.copyFile(sourcePath, artifactPath);

        return {
            output: { name: sanitizedName, path: artifactPath, op: 'upload' },
            status: 'success',
        };
    } else {
        // download
        const dest = ExpressionEvaluator.evaluateString(step.path, context);
        const destPath = path.isAbsolute(dest) ? dest : path.join(baseDir, dest);

        if (!fs.existsSync(artifactPath)) {
            throw new Error(`Artifact not found for download: ${sanitizedName}`);
        }

        // ensure dest dir exists
        const destDir = path.dirname(destPath);
        if (!fs.existsSync(destDir)) {
            fs.mkdirSync(destDir, { recursive: true });
        }

        await fs.promises.copyFile(artifactPath, destPath);

        return {
            output: { name: sanitizedName, path: destPath, op: 'download' },
            status: 'success',
        };
    }
}
