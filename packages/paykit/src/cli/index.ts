#!/usr/bin/env node

import { Command } from "commander";

import { checkCommand } from "./commands/check";
import { initCommand } from "./commands/init";
import { pushCommand } from "./commands/push";
import { telemetryCommand } from "./commands/telemetry";
import { captureError, flush } from "./utils/telemetry";

const program = new Command()
  .name("paykitjs")
  .description("CLI for PayKit")
  .addCommand(checkCommand)
  .addCommand(initCommand)
  .addCommand(pushCommand)
  .addCommand(telemetryCommand);

try {
  await program.parseAsync(process.argv);
} catch (error) {
  const command = process.argv[2] ?? "unknown";
  captureError(command, error);

  const message = error instanceof Error ? error.message : String(error);
  console.error(`\n  error: ${message}\n`);
  await flush();
  process.exit(1);
}

await flush();
