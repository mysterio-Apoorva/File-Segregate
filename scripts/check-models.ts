import { GoogleGenAI } from "@google/genai";
const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY, httpOptions: { timeout: 20000, retryOptions: { attempts: 1 } } });
try {
  const models = await ai.models.list();
  for await (const model of models) if (model.name?.includes("flash") && !/image|tts|live|audio/i.test(model.name)) console.log(model.name);
} catch (error) {
  const message = error instanceof Error ? error.message : "Model discovery failed";
  console.error(message.replaceAll(process.env.GEMINI_API_KEY || "<unset>", "[redacted]").slice(0, 1500)); process.exitCode = 1;
}
