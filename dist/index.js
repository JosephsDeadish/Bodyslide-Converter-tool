#!/usr/bin/env node
import { mkdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { Command } from "commander";
import { z } from "zod";
import { convertMod } from "./converter.js";
import { detectBodyType } from "./detector.js";
import { buildExecutedOperations } from "./executedOperations.js";
import { createConversionPlan } from "./planner.js";
import { scanModFiles } from "./scanner.js";
import { BODY_TYPES } from "./types.js";
const targetSchema = z.enum(BODY_TYPES);
const program = new Command();
program
    .name("slidesmith")
    .description("Detect source body type and run a native BodySlide asset conversion.")
    .requiredOption("-i, --input <path>", "Path to clothing/armor mod folder")
    .requiredOption("-t, --target <bodyType>", "Desired target body type")
    .requiredOption("-o, --output <path>", "Output folder for conversion artifacts")
    .action(async (options) => {
    const input = resolve(options.input);
    const output = resolve(options.output);
    const targetBodyType = targetSchema.parse(options.target.toLowerCase());
    const files = await scanModFiles(input);
    const detection = detectBodyType(files);
    const plan = createConversionPlan(detection, targetBodyType, files);
    const result = await convertMod(input, output, files, detection, targetBodyType);
    plan.operations = buildExecutedOperations({
        filesAnalyzed: files.length,
        conversion: result,
    });
    await mkdir(output, { recursive: true });
    const reportPath = join(output, "conversion-report.json");
    const summaryPath = join(output, "conversion-summary.txt");
    await writeFile(reportPath, `${JSON.stringify({ detection, plan, result }, null, 2)}\n`, "utf8");
    await writeFile(summaryPath, [
        `Source detected: ${detection.bodyType} (confidence ${detection.confidence})`,
        `Top candidates: ${detection.rankedCandidates.length > 0
            ? detection.rankedCandidates
                .map((candidate) => `${candidate.bodyType} (${candidate.share.toFixed(2)})`)
                .join(", ")
            : "none"}`,
        `Target body type: ${targetBodyType}`,
        `Conversion mode: ${result.conversionMode}`,
        `Conversion path: ${result.conversionPath}`,
        `Preferred output alias: ${result.preferredOutputAlias}`,
        `Files analyzed: ${files.length}`,
        `Converted assets: ${result.convertedFiles.length}`,
        `Non-converted/auxiliary file decisions: ${result.skippedFiles.length}`,
        "",
        "Executed conversion stages:",
        ...plan.operations.map((operation, index) => `${index + 1}. ${operation.name} — ${operation.description}`),
        "",
        "Plan warnings:",
        ...plan.warnings.map((warning, index) => `${index + 1}. ${warning}`),
        "",
        "Naming notes:",
        ...result.namingNotes.map((note, index) => `${index + 1}. ${note}`),
        "",
        `Conversion audit: ${result.audit.overallStatus.toUpperCase()}`,
        ...result.audit.checks.map((check, index) => `${index + 1}. [${check.status}] ${check.title} — ${check.summary}${check.details.length > 0 ? ` (${check.details.join(" | ")})` : ""}`),
        "",
        "Converted files:",
        ...result.convertedFiles.map((file, index) => `${index + 1}. [${file.kind}/${file.action}] ${file.sourcePath} -> ${file.outputPath}`),
        "",
        "Warnings:",
        ...result.warnings.map((warning, index) => `${index + 1}. ${warning}`),
    ].join("\n"), "utf8");
    process.stdout.write(`Generated ${reportPath}\n`);
    process.stdout.write(`Generated ${summaryPath}\n`);
});
program.parseAsync().catch((error) => {
    process.stderr.write(`Failed: ${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
});
//# sourceMappingURL=index.js.map