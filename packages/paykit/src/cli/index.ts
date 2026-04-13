#!/usr/bin/env node

import { Command } from "commander";

process.env.PAYKIT_CLI = "1";

const program = new Command().name("paykitjs").description("CLI for PayKit");

const commandName = process.argv[2];

switch (commandName) {
  case "status": {
    const { statusCommand } = await import("./commands/status");
    program.addCommand(statusCommand);
    break;
  }
  case "init": {
    const { initCommand } = await import("./commands/init");
    program.addCommand(initCommand);
    break;
  }
  case "push": {
    const { pushCommand } = await import("./commands/push");
    program.addCommand(pushCommand);
    break;
  }
  default: {
    const [{ statusCommand }, { initCommand }, { pushCommand }] = await Promise.all([
      import("./commands/status"),
      import("./commands/init"),
      import("./commands/push"),
    ]);
    program.addCommand(statusCommand);
    program.addCommand(initCommand);
    program.addCommand(pushCommand);
  }
}

try {
  await program.parseAsync(process.argv);
} catch (error) {
  const { captureError, flush } = await import("./utils/telemetry");
  const command = commandName ?? "unknown";
  captureError(command, error);

  const message = error instanceof Error ? error.message : String(error);
  console.error(`\n  error: ${message}\n`);
  await flush();
  process.exit(1);
}
