import { randomBytes, createHash, createHmac, randomUUID } from "node:crypto";
import * as argon2 from "argon2";
import { SignJWT, jwtVerify } from "jose";
import { env } from "../../config/env.js";
import { AppError } from "../../shared/errors/app-error.js";
import * as repository from "./auth.repository.js";

const accessTokenLifetimeSeconds = 15 * 60;
const refreshTokenLifetimeMs = 30 * 24 * 60 * 60 * 1000;
const resetTokenLifetimeMs = 30 * 60 * 1000;
const issuer = "marketplace-server";
const audience = "marketplace-web";
const accessKey = new TextEncoder().encode(env.accessTokenSecret);
const dummyPasswordHash = argon2.hash(randomBytes(32).toString("hex"), { type: argon2.argon2id });

export interface Identity {
  id: string;
  email: string;
  roles: string[];
}

export interface IssuedTokens {
  accessToken: string;
  refreshToken: string;
  csrfToken: string;
  identity: Identity;
}

export interface PasswordResetDelivery {
  deliver(email: string, token: string): Promise<void>;
}

export class AuthService {
  constructor(private readonly resetDelivery?: PasswordResetDelivery) {}

  async register(email: string, password: string): Promise<void> {
    const passwordHash = await argon2.hash(password, { type: argon2.argon2id });
    try {
      await repository.createCustomer(email, passwordHash);
    } catch (error) {
      if (!repository.isUniqueConstraintError(error)) throw error;
      // Registration is deliberately indistinguishable for existing and new addresses.
    }
  }

  async login(email: string, password: string): Promise<IssuedTokens> {
    const user = await repository.findUserByEmail(email);
    const validPassword = user
      ? await argon2.verify(user.passwordHash, password).catch(() => false)
      : await argon2.verify(await dummyPasswordHash, password).catch(() => false);

    if (!user || !validPassword || user.status !== "active") {
      throw new AppError(401, "UNAUTHENTICATED", "Email or password is incorrect.");
    }
    return this.issueTokens(user);
  }

  async refresh(refreshToken: string | undefined): Promise<IssuedTokens> {
    if (!refreshToken) throw new AppError(401, "UNAUTHENTICATED", "Authentication is required.");
    const session = await repository.findRefreshSession(hashToken(refreshToken));
    if (!session) throw new AppError(401, "UNAUTHENTICATED", "Authentication is required.");
    if (session.revokedAt) {
      await repository.revokeRefreshFamily(session.familyId);
      throw new AppError(401, "UNAUTHENTICATED", "Authentication is required.");
    }
    if (session.expiresAt <= new Date()) {
      await repository.revokeRefreshSession(session.id);
      throw new AppError(401, "UNAUTHENTICATED", "Authentication is required.");
    }

    const user = await repository.findUserById(session.userId);
    if (!user || user.status !== "active") {
      await repository.revokeRefreshFamily(session.familyId);
      throw new AppError(401, "UNAUTHENTICATED", "Authentication is required.");
    }

    const nextRefreshToken = randomToken();
    try {
      await repository.rotateRefreshSession({
        previousId: session.id,
        userId: user.id,
        familyId: session.familyId,
        tokenHash: hashToken(nextRefreshToken),
        expiresAt: new Date(Date.now() + refreshTokenLifetimeMs),
      });
    } catch (error) {
      if (!(error instanceof repository.RefreshReplayError)) throw error;
      await repository.revokeRefreshFamily(session.familyId);
      throw new AppError(401, "UNAUTHENTICATED", "Authentication is required.");
    }

    return this.issueAccessAndRefresh(user, session.familyId, nextRefreshToken);
  }

  async logout(refreshToken: string | undefined): Promise<void> {
    if (!refreshToken) return;
    const session = await repository.findRefreshSession(hashToken(refreshToken));
    if (session) await repository.revokeRefreshFamily(session.familyId);
  }

  async authenticate(accessToken: string | undefined): Promise<Identity> {
    if (!accessToken) throw new AppError(401, "UNAUTHENTICATED", "Authentication is required.");
    try {
      const { payload } = await jwtVerify(accessToken, accessKey, { issuer, audience });
      if (typeof payload.sub !== "string" || typeof payload.sid !== "string") throw new Error("Invalid claims");
      const [user, sessionActive] = await Promise.all([
        repository.findUserById(payload.sub),
        repository.hasActiveRefreshFamily(payload.sub, payload.sid),
      ]);
      if (!user || user.status !== "active" || !sessionActive) {
        throw new AppError(401, "UNAUTHENTICATED", "Authentication is required.");
      }
      return { id: user.id, email: user.email, roles: user.roles };
    } catch (error) {
      if (error instanceof AppError) throw error;
      throw new AppError(401, "UNAUTHENTICATED", "Authentication is required.");
    }
  }

  async requestPasswordReset(email: string): Promise<void> {
    const user = await repository.findUserByEmail(email);
    if (!user || user.status !== "active") return;
    const token = randomToken();
    await repository.createPasswordResetToken({
      userId: user.id,
      tokenHash: hashToken(token),
      expiresAt: new Date(Date.now() + resetTokenLifetimeMs),
    });
    await this.resetDelivery?.deliver(email, token);
  }

  async completePasswordReset(token: string, password: string): Promise<void> {
    const passwordHash = await argon2.hash(password, { type: argon2.argon2id });
    const completed = await repository.completePasswordReset(hashToken(token), passwordHash);
    if (!completed) throw new AppError(400, "VALIDATION_ERROR", "The password reset token is invalid or expired.");
  }

  private async issueTokens(user: repository.AuthUser): Promise<IssuedTokens> {
    const familyId = randomUUID();
    const refreshToken = randomToken();
    await repository.createRefreshSession({
      userId: user.id,
      familyId,
      tokenHash: hashToken(refreshToken),
      expiresAt: new Date(Date.now() + refreshTokenLifetimeMs),
    });
    return this.issueAccessAndRefresh(user, familyId, refreshToken);
  }

  private async issueAccessAndRefresh(
    user: Pick<repository.AuthUser, "id" | "email" | "roles">,
    familyId: string,
    refreshToken: string,
  ): Promise<IssuedTokens> {
    const now = Math.floor(Date.now() / 1000);
    const accessToken = await new SignJWT({ sid: familyId })
      .setProtectedHeader({ alg: "HS256", typ: "JWT" })
      .setIssuer(issuer)
      .setAudience(audience)
      .setSubject(user.id)
      .setIssuedAt(now)
      .setExpirationTime(now + accessTokenLifetimeSeconds)
      .sign(accessKey);
    return {
      accessToken,
      refreshToken,
      csrfToken: createCsrfToken(),
      identity: { id: user.id, email: user.email, roles: user.roles },
    };
  }
}

export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

function randomToken(): string {
  return randomBytes(32).toString("base64url");
}

export function createCsrfToken(): string {
  const nonce = randomBytes(32).toString("base64url");
  const signature = createHmac("sha256", env.csrfSecret)
    .update(nonce)
    .digest("base64url");
  return `${nonce}.${signature}`;
}
