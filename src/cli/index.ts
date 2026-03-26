import { Cli, Builtins } from "clipanion";
import { InitCommand } from "./commands/init";
import { HookInstallCommand, CheckContractsCommand } from "./commands/hook";

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

cli.runExit(process.argv.slice(2));
