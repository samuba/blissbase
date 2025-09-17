import { TelegramClient } from "telegram";
import { StringSession } from "telegram/sessions";
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

for await (const dialog of client.iterDialogs({})) {
    console.log(`${dialog.id}: ${dialog.title}`);
}