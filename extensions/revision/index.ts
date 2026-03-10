import type { OpenClawPluginApi } from "openclaw/plugin-sdk";
import { registerRevisionCli } from "./src/cli.js";

const revisionPlugin = {
  id: "revision",
  name: "Revision",
  description: "Flashcard revision system with SM-2 spaced repetition — add, review, and track cards from the CLI.",
  kind: "tool" as const,

  register(api: OpenClawPluginApi) {
    api.registerCli(
      ({ program }) => {
        registerRevisionCli({ program });
      },
      { commands: ["revision", "rev"] },
    );
  },
};

export default revisionPlugin;
