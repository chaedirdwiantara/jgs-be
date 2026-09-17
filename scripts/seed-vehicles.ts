/**
 * Seeds the fleet table with the catalogue the site shipped with.
 *
 * One-time: after this runs, DynamoDB is the source of truth and the console
 * is where units are edited. Existing rows are left alone, so re-running never
 * overwrites an operator's edit.
 *
 *   npx tsx scripts/seed-vehicles.ts
 */
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, PutCommand } from "@aws-sdk/lib-dynamodb";

import type { Vehicle } from "../src/domain/vehicle/vehicle.js";

const region = process.env.AWS_REGION ?? "ap-southeast-1";
const table = process.env.TABLE_VEHICLES ?? `${process.env.NAME_PREFIX ?? "jgs"}-vehicles`;

/** Photo paths follow the unit's slug; the site serves them from `public/`. */
const photosFor = (id: string): Vehicle["photos"] => ({
  outdoor: {
    wide: `/images/fleet/${id}-outdoor-wide.jpg`,
    tall: `/images/fleet/${id}-outdoor-tall.jpg`,
  },
  studio: {
    wide: `/images/fleet/${id}-studio-wide.jpg`,
    tall: `/images/fleet/${id}-studio-tall.jpg`,
  },
});

const seed: Vehicle[] = [
  {
    id: "byd-atto-1",
    name: "BYD ATTO 1",
    tier: "economy",
    seats: 5,
    luggage: 2,
    rangeKm: 300,
    dailyRate: 500_000,
    monthlyRate: 8_000_000,
    downtimeRate: 250_000,
    highlights: ["Lincah di dalam kota", "Parkir mudah", "Konsumsi paling irit"],
    photos: photosFor("byd-atto-1"),
  },
  {
    id: "wuling-cloud",
    name: "Wuling Cloud EV",
    tier: "economy",
    seats: 5,
    luggage: 3,
    rangeKm: 460,
    dailyRate: 700_000,
    monthlyRate: 13_000_000,
    downtimeRate: 400_000,
    highlights: ["Kabin lapang dan senyap", "Kursi belakang dapat direbahkan", "Fast charging"],
    photos: photosFor("wuling-cloud"),
  },
  {
    id: "byd-m6",
    name: "BYD M6",
    tier: "premium",
    seats: 7,
    luggage: 4,
    rangeKm: 530,
    dailyRate: 750_000,
    monthlyRate: 14_000_000,
    downtimeRate: 400_000,
    highlights: ["Tiga baris kursi", "Ideal untuk rombongan", "Bagasi luas"],
    photos: photosFor("byd-m6"),
  },
  {
    id: "hyundai-ioniq-5",
    name: "Hyundai IONIQ 5",
    tier: "premium",
    seats: 5,
    luggage: 3,
    rangeKm: 480,
    dailyRate: 1_800_000,
    monthlyRate: 25_000_000,
    downtimeRate: 800_000,
    highlights: ["Interior premium", "Ruang kaki luas", "Pengisian daya sangat cepat"],
    photos: photosFor("hyundai-ioniq-5"),
  },
  {
    id: "byd-seal",
    name: "BYD Seal",
    tier: "premium",
    seats: 5,
    luggage: 2,
    rangeKm: 550,
    dailyRate: 1_800_000,
    monthlyRate: 25_000_000,
    downtimeRate: 800_000,
    highlights: ["Sedan eksekutif", "Kedap suara", "Jarak tempuh terjauh"],
    photos: photosFor("byd-seal"),
  },
  {
    id: "denza-d9",
    name: "Denza D9",
    tier: "elite",
    seats: 7,
    luggage: 4,
    rangeKm: 600,
    dailyRate: 2_000_000,
    monthlyRate: 36_000_000,
    downtimeRate: 1_000_000,
    highlights: ["Kursi kapten VIP", "Kabin kelas satu", "Pilihan untuk tamu penting"],
    photos: photosFor("denza-d9"),
  },
];

const documents = DynamoDBDocumentClient.from(new DynamoDBClient({ region }));

let created = 0;
let skipped = 0;

for (const vehicle of seed) {
  try {
    await documents.send(
      new PutCommand({
        TableName: table,
        Item: vehicle,
        ConditionExpression: "attribute_not_exists(id)",
      }),
    );
    created += 1;
    console.log(`  + ${vehicle.id}`);
  } catch (cause) {
    if (
      typeof cause === "object" &&
      cause !== null &&
      (cause as { name?: string }).name === "ConditionalCheckFailedException"
    ) {
      skipped += 1;
      console.log(`  = ${vehicle.id} (sudah ada, dilewati)`);
      continue;
    }
    throw cause;
  }
}

console.log(`\n${created} unit ditambahkan, ${skipped} dilewati.`);
