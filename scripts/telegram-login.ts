/**
 * Mint a Telegram StringSession for the scraper.
 * Run once per phone number during dual-account transition:
 * - New number → TELEGRAM_APP_SESSION_PRIMARY (GitHub secret + Vercel/.env)
 * - Old number → TELEGRAM_APP_SESSION_FALLBACK (or keep legacy TELEGRAM_APP_SESSION)
 */
import { TelegramClient } from "teleproto";
import { StringSession } from "teleproto/sessions";
import readline from "readline";
import 'dotenv/config'

const apiId = Number(process.env.TELEGRAM_APP_ID!);
const apiHash = process.env.TELEGRAM_APP_HASH!;
const stringSession = new StringSession(""); // fill this later with the value from session.save()

const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
});

const client = new TelegramClient(stringSession, apiId, apiHash, { connectionRetries: 5 });
await client.start({
    phoneNumber: async () =>
        new Promise((resolve) =>
            rl.question("Please enter your number: ", resolve)
        ),
    password: async () =>
        new Promise((resolve) =>
            rl.question("Please enter your password: ", resolve)
        ),
    phoneCode: async () =>
        new Promise((resolve) =>
            rl.question("Please enter the code you received: ", resolve)
        ),
    onError: (err) => console.log(err),
});
console.log("Login succesfull")
console.log("Session key:", client.session.save()); // Save this string to avoid logging in again
console.log("Store as TELEGRAM_APP_SESSION_PRIMARY (new) or TELEGRAM_APP_SESSION_FALLBACK (old). Legacy TELEGRAM_APP_SESSION still works alone.");

for await (const dialog of client.iterDialogs({})) {
    console.log(`${dialog.date}: (${dialog.id}) ${dialog.title}`);
}