// Same bridge, for a Custom LLM URL configured without the /chat/completions suffix.
export { POST } from "./chat/completions/route";

export const dynamic = "force-dynamic";
export const maxDuration = 60;
