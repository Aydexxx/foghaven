import { PrismaClient } from "@prisma/client";
import { BaseAuthProvider, type NewUser, type StoredUser } from "./provider";

/**
 * The real, Postgres-backed account store. Deliberately in its own file,
 * imported only by `index.ts` (boot) and `scripts/ban.ts` — never by the test
 * path — so running the suite never needs a generated Prisma client or a live
 * database. All the actual auth logic lives in `BaseAuthProvider`; this only
 * supplies the four storage primitives, mapped straight onto Prisma queries.
 */
export class PrismaAuthProvider extends BaseAuthProvider {
  constructor(private readonly prisma: PrismaClient) {
    super();
  }

  protected async findById(id: string): Promise<StoredUser | null> {
    return this.prisma.user.findUnique({ where: { id } });
  }

  protected async findByEmail(emailLower: string): Promise<StoredUser | null> {
    return this.prisma.user.findUnique({ where: { email: emailLower } });
  }

  protected async findByUsernameLower(usernameLower: string): Promise<StoredUser | null> {
    return this.prisma.user.findUnique({ where: { usernameLower } });
  }

  protected async insert(user: NewUser): Promise<StoredUser> {
    // A unique-constraint violation throws here, which `BaseAuthProvider.register`
    // catches and turns into a friendly "taken" error — the database is the
    // real arbiter of uniqueness against a concurrent registration.
    return this.prisma.user.create({ data: user });
  }

  protected async remove(id: string): Promise<void> {
    // Everything else this account owns — cosmetics, friendships, blocks,
    // stats, ban history — goes with it via the schema's own `onDelete`
    // rules; a report *filed by* this account survives with `reporterId` set
    // null (see `Report.reporter`), and a report *against* it is cascaded
    // away along with the account it was about.
    await this.prisma.user.delete({ where: { id } });
  }
}
