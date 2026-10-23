/**
 * Creates (or updates) the Pineapple voice agent in ElevenLabs and lists your phone numbers.
 * Most people should use Settings → Voice agent → "Set up voice agent" in the app instead; it runs
 * the same steps with nothing to copy around.
 *
 *   npm run create-agent             # create a new agent
 *   npm run create-agent -- --update # update the agent in ELEVENLABS_AGENT_ID
 *
 * Needs (in .env.local or the environment):
 *   ELEVENLABS_API_KEY  your ElevenLabs key
 *   APP_URL             your deployed app, e.g. https://pineapple-yourname.vercel.app
 *   LLM_BRIDGE_TOKEN    a long random string; set the SAME value in Vercel so the app accepts it
 * Optional: PINEAPPLE_CLAUDE_MODEL, ELEVENLABS_VOICE_ID, ELEVENLABS_TTS_MODEL.
 */
import { BRIDGE_SECRET_NAME, voiceOptionsFromEnv } from "../lib/agent-config";
import { claudeModel } from "../lib/claude-config";
import { createAgent, listPhoneNumbers, updateAgent, upsertWorkspaceSecret } from "../lib/elevenlabs";

function required(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Set ${name} (in .env.local or the environment) first.`);
  return value;
}

async function main() {
  try {
    process.loadEnvFile(".env.local");
  } catch {
    // No .env.local: rely on the real environment.
  }
  required("ELEVENLABS_API_KEY");
  const appUrl = required("APP_URL").replace(/\/+$/, "");
  const token = required("LLM_BRIDGE_TOKEN");
  if (token.length < 32) throw new Error("LLM_BRIDGE_TOKEN must be at least 32 characters.");

  const secretId = await upsertWorkspaceSecret(BRIDGE_SECRET_NAME, token, null);
  const options = { bridgeUrl: `${appUrl}/api/llm`, bridgeSecretId: secretId, claudeModel: claudeModel(), ...voiceOptionsFromEnv() };

  if (process.argv.includes("--update")) {
    const agentId = required("ELEVENLABS_AGENT_ID");
    await updateAgent(agentId, options);
    console.log(`Updated agent ${agentId}.`);
  } else {
    const agentId = await createAgent(options);
    console.log(`Created agent: ${agentId}`);
    console.log(`Set ELEVENLABS_AGENT_ID=${agentId} and LLM_BRIDGE_TOKEN in Vercel, then redeploy.`);
  }

  const numbers = await listPhoneNumbers();
  if (numbers.length === 0) {
    console.log("\nNo phone numbers in ElevenLabs yet. Import your Twilio number (see README), then run this again.");
  } else {
    console.log("\nYour ElevenLabs phone numbers (use the id as ELEVENLABS_PHONE_NUMBER_ID):");
    for (const n of numbers) console.log(`  ${n.phone_number}  ${n.label}  [${n.provider}]  id=${n.phone_number_id}`);
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
