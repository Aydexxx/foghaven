import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import { USER_ROLE, type UserRole } from "@foghaven/shared";
import { PrismaModerationProvider } from "../src/moderation/provider";

/**
 * Grant or revoke moderation privilege from the command line.
 *
 * This exists because the admin panel's own role endpoint requires an existing
 * admin to call it — a deliberate rule (see `adminRoutes.ts`), but one that
 * leaves a fresh deployment with nobody able to reach the panel at all. This
 * is the bootstrap: it needs database access rather than an account, which is
 * the right bar for minting the first administrator.
 *
 *   npm run grant-role -w server -- <username> admin
 *   npm run grant-role -w server -- <username> moderator
 *   npm run grant-role -w server -- <username> player     # revoke
 */
const ROLES: readonly string[] = [USER_ROLE.PLAYER, USER_ROLE.MODERATOR, USER_ROLE.ADMIN];

async function main(): Promise<void> {
  const [username, role] = process.argv.slice(2);

  if (!username || !role || !ROLES.includes(role)) {
    console.error(`Usage: npm run grant-role -w server -- <username> <${ROLES.join("|")}>`);
    process.exit(1);
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

    const moderation = new PrismaModerationProvider(prisma);
    const updated = await moderation.setRole(user.id, role as UserRole);
    console.log(`${updated?.username} is now: ${updated?.role}`);
  } finally {
    await prisma.$disconnect();
  }
}

void main();
