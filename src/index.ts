#!/usr/bin/env node
import { mkdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { Command } from "commander";
import { z } from "zod";
import { detectBodyType } from "./detector.js";
import { createConversionPlan } from "./planner.js";
import { scanModFiles } from "./scanner.js";
import { BODY_TYPES } from "./types.js";

const targetSchema = z.enum(BODY_TYPES);

const program = new Command();

program
  .name("bodyslide-converter")
  .description(
    "Detect source body type from mod files and generate a Bodyslide conversion plan.",
  )
  .requiredOption("-i, --input <path>", "Path to clothing/armor mod folder")
  .requiredOption("-t, --target <bodyType>", "Desired target body type")
  .requiredOption(
    "-o, --output <path>",
    "Output folder for conversion artifacts",
  )
  .action(
    async (options: { input: string; target: string; output: string }) => {
      const input = resolve(options.input);
      const output = resolve(options.output);
      const targetBodyType = targetSchema.parse(options.target.toLowerCase());

      const files = await scanModFiles(input);
      const detection = detectBodyType(files);
      const plan = createConversionPlan(detection, targetBodyType, files);

      await mkdir(output, { recursive: true });

      const reportPath = join(output, "conversion-report.json");
      const planPath = join(output, "conversion-plan.txt");

      await writeFile(
        reportPath,
        `${JSON.stringify({ detection, plan }, null, 2)}\n`,
        "utf8",
      );
      await writeFile(
        planPath,
        [
          `Source detected: ${detection.bodyType} (confidence ${detection.confidence})`,
          `Top candidates: ${
            detection.rankedCandidates.length > 0
              ? detection.rankedCandidates
                  .map(
                    (candidate) =>
                      `${candidate.bodyType} (${candidate.share.toFixed(2)})`,
                  )
                  .join(", ")
              : "none"
          }`,
          `Target body type: ${targetBodyType}`,
          `Files analyzed: ${files.length}`,
          "",
          "Planned operations:",
          ...plan.operations.map(
            (operation, index) =>
              `${index + 1}. ${operation.name} - ${operation.description}`,
          ),
          "",
          "Warnings:",
          ...plan.warnings.map((warning, index) => `${index + 1}. ${warning}`),
        ].join("\n"),
        "utf8",
      );

      process.stdout.write(`Generated ${reportPath}\n`);
      process.stdout.write(`Generated ${planPath}\n`);
    },
  );

program.parseAsync().catch((error: unknown) => {
  process.stderr.write(
    `Failed: ${error instanceof Error ? error.message : String(error)}\n`,
  );
  process.exitCode = 1;
});
