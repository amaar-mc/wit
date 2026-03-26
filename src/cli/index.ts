import { Cli, Builtins } from "clipanion";
import { InitCommand } from "./commands/init";
import { HookInstallCommand, CheckContractsCommand } from "./commands/hook";
import { StatusCommand } from "./commands/status";
import { DeclareCommand } from "./commands/declare";
import { LockCommand } from "./commands/lock";
import { ReleaseCommand } from "./commands/release";

const cli = new Cli({
  binaryLabel: "wit",
  binaryName: "wit",
  binaryVersion: "0.1.0",
});

cli.register(Builtins.HelpCommand);
cli.register(Builtins.VersionCommand);
cli.register(InitCommand);
cli.register(HookInstallCommand);
cli.register(CheckContractsCommand);
cli.register(StatusCommand);
cli.register(DeclareCommand);
cli.register(LockCommand);
cli.register(ReleaseCommand);

cli.runExit(process.argv.slice(2));
