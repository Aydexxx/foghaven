import "dotenv/config";
import { PrismaClient } from "@prisma/client";

/**
 * Issue or lift a ban from the command line, so a live game can moderate
 * without an admin UI (which the spec doesn't call for). The ban only bites at
 * `GameRoom.onAuth`, which re-reads this row on every join — so a ban set here
 * takes effect on the target's very next attempt to join, mid-session or not.
 *
 *   npm run ban -w server -- <username> "<reason>"            # permanent
 *   npm run ban -w server -- <username> "<reason>" --until 2025-12-31T00:00:00Z
 *   npm run ban -w server -- <username> --unban
 */
async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const username = args[0];
  if (!username || username.startsWith("--")) {
    console.error('Usage: npm run ban -w server -- <username> "<reason>" [--until ISO] [--unban]');
    process.exit(1);
  }

  const unban = args.includes("--unban");
  const untilIndex = args.indexOf("--until");
  const untilRaw = untilIndex >= 0 ? args[untilIndex + 1] : undefined;
  const reason = args.slice(1).find((a) => !a.startsWith("--") && a !== untilRaw);

  let banUntil: Date | null = null;
  if (untilRaw) {
    banUntil = new Date(untilRaw);
    if (Number.isNaN(banUntil.getTime())) {
      console.error(`Invalid --until date: ${untilRaw}`);
      process.exit(1);
    }
  }

  const prisma = new PrismaClient();
  try {
    const user = await prisma.user.findUnique({
      where: { usernameLower: username.toLowerCase() },
    });
    if (!user) {
      console.error(`No such user: ${username}`);
      process.exit(1);
    }

    const updated = await prisma.user.update({
      where: { id: user.id },
      data: unban
        ? { banned: false, banReason: null, banUntil: null }
        : { banned: true, banReason: reason ?? "banned by an administrator", banUntil },
    });

    if (unban) {
      console.log(`Unbanned ${updated.username}.`);
    } else {
      const when = banUntil ? `until ${banUntil.toISOString()}` : "permanently";
      console.log(`Banned ${updated.username} ${when} — reason: ${updated.banReason}`);
    }
  } finally {
    await prisma.$disconnect();
  }
}

void main();
