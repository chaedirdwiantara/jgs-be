/**
 * Creates the first console account, or resets an existing one's password.
 *
 * Run once after the stack is up — nothing else can create an account, because
 * creating accounts requires being signed in as an owner. There is deliberately
 * no self-service sign-up endpoint: this console has no public registration.
 *
 *   npx tsx scripts/create-owner.ts admin@jgs-ev.com "Nama Pemilik"
 *
 * Prints a generated password once. Change it after the first sign-in.
 */
import { randomBytes, randomUUID } from "node:crypto";

import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, PutCommand, QueryCommand } from "@aws-sdk/lib-dynamodb";

import { ScryptPasswordHasher } from "../src/infrastructure/crypto/scrypt-password-hasher.js";

const region = process.env.AWS_REGION ?? "ap-southeast-1";
const table = process.env.TABLE_USERS ?? `${process.env.NAME_PREFIX ?? "jgs"}-users`;

const [emailArg, nameArg] = process.argv.slice(2);

if (!emailArg || !nameArg) {
  console.error('Usage: npx tsx scripts/create-owner.ts <email> "<Nama Lengkap>"');
  process.exit(1);
}

const email = emailArg.trim().toLowerCase();
const documents = DynamoDBDocumentClient.from(new DynamoDBClient({ region }));

/**
 * 24 random bytes as base64url: ~32 characters of real entropy, and still
 * something that can be read aloud or pasted without ambiguity.
 */
const password = randomBytes(24).toString("base64url");
const passwordHash = await new ScryptPasswordHasher().hash(password);

const existing = await documents.send(
  new QueryCommand({
    TableName: table,
    IndexName: "email-index",
    KeyConditionExpression: "email = :email",
    ExpressionAttributeValues: { ":email": email },
    Limit: 1,
  }),
);

const current = existing.Items?.[0] as { id: string; createdAt: string } | undefined;
const now = new Date().toISOString();

await documents.send(
  new PutCommand({
    TableName: table,
    Item: {
      id: current?.id ?? randomUUID(),
      email,
      name: nameArg.trim(),
      role: "owner",
      isActive: true,
      passwordHash,
      createdAt: current?.createdAt ?? now,
      updatedAt: now,
      lastLoginAt: null,
    },
  }),
);

console.log("");
console.log(current ? "Password reset for existing owner." : "Owner account created.");
console.log(`  Table    : ${table}`);
console.log(`  Email    : ${email}`);
console.log(`  Password : ${password}`);
console.log("");
console.log("This password is shown once. Sign in and change it.");
