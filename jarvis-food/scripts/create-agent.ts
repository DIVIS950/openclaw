/**
 * Creates (or updates) the Jarvis Food voice agent in ElevenLabs and lists your phone numbers.
 *
 *   npm run create-agent             # create a new agent
 *   npm run create-agent -- --update # update the agent in ELEVENLABS_AGENT_ID
 *
 * Reads ELEVENLABS_API_KEY (and optional ELEVENLABS_VOICE_ID, ELEVENLABS_LLM, ELEVENLABS_TTS_MODEL)
 * from the environment or from .env.local. No computer? Use Settings → Voice agent in the app instead;
 * it runs exactly the same code.
 */
import { agentOptionsFromEnv } from "../lib/agent-config";
import { createAgent, listPhoneNumbers, updateAgent } from "../lib/elevenlabs";

async function main() {
  try {
    process.loadEnvFile(".env.local");
  } catch {
    // No .env.local: rely on the real environment.
  }
  if (!process.env.ELEVENLABS_API_KEY) {
    throw new Error("Set ELEVENLABS_API_KEY (in .env.local or the environment) first.");
  }

  const options = agentOptionsFromEnv();
  if (process.argv.includes("--update")) {
    const agentId = process.env.ELEVENLABS_AGENT_ID;
    if (!agentId) throw new Error("--update needs ELEVENLABS_AGENT_ID.");
    await updateAgent(agentId, options);
    console.log(`Updated agent ${agentId}.`);
  } else {
    const agentId = await createAgent(options);
    console.log(`Created agent: ${agentId}`);
    console.log(`Set ELEVENLABS_AGENT_ID=${agentId} in Vercel (or press "Create the voice agent" in the app instead).`);
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
