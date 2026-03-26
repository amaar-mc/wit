import { Cli, Builtins } from "clipanion";
import { InitCommand } from "./commands/init";

const cli = new Cli({
  binaryLabel: "wit",
  binaryName: "wit",
  binaryVersion: "0.1.0",
});

cli.register(Builtins.HelpCommand);
cli.register(Builtins.VersionCommand);
cli.register(InitCommand);

cli.runExit(process.argv.slice(2));
