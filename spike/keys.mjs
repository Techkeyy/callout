import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import fs from "fs";
if (!fs.existsSync(".env")) { const a=generatePrivateKey(), b=generatePrivateKey(); fs.writeFileSync(".env",`CALLER_KEY=${a}\nFOLLOWER_KEY=${b}\n`); }
const env = Object.fromEntries(fs.readFileSync(".env","utf8").trim().split("\n").map(l=>l.split("=")));
console.log("caller  ", privateKeyToAccount(env.CALLER_KEY).address);
console.log("follower", privateKeyToAccount(env.FOLLOWER_KEY).address);
