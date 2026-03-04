import { ErrorCode } from "../errors/ErrorCodes";
import { ZeroHashError } from "../errors/ZeroHashError";
import type { TelemetryEmitter } from "../telemetry/TelemetryHooks";
import type { Logger } from "../utils/logger";
import type { VersionConstraint, ZeroHashSDKInstance } from "./types";

interface SemVer {
  major: number;
  minor: number;
  patch: number;
}

function parseSemVer(version: string): SemVer | null {
  const match = version.trim().replace(/^v/, "").match(/^(\d+)\.(\d+)\.(\d+)/);
  if (!match) return null;

  return {
    major: parseInt(match[1], 10),
    minor: parseInt(match[2], 10),
    patch: parseInt(match[3], 10),
  };
}

function compareSemVer(a: SemVer, b: SemVer): number {
  if (a.major !== b.major) return a.major - b.major;
  if (a.minor !== b.minor) return a.minor - b.minor;
  return a.patch - b.patch;
}

function formatSemVer(v: SemVer): string {
  return `${v.major}.${v.minor}.${v.patch}`;
}

export class VersionGuard {
  constructor(
    private readonly constraint: VersionConstraint,
    private readonly telemetry: TelemetryEmitter,
    private readonly logger: Logger
  ) {}

  validate(sdk: ZeroHashSDKInstance): void {
    const rawVersion = sdk.version ?? this.resolveVersionFromPackage();

    if (!rawVersion) {
      this.logger.warn(
        "SDK does not expose a version property and zh-web-sdk package version could not be resolved — skipping version check"
      );
      return;
    }

    const current = parseSemVer(rawVersion);
    if (!current) {
      this.logger.warn(`Could not parse SDK version "${rawVersion}"`);
      return;
    }

    const min = parseSemVer(this.constraint.minVersion);
    if (!min) {
      this.logger.warn(
        `Invalid minVersion constraint "${this.constraint.minVersion}"`
      );
      return;
    }

    if (compareSemVer(current, min) < 0) {
      this.telemetry.track("VERSION_MISMATCH", undefined, {
        currentVersion: formatSemVer(current),
        minVersion: formatSemVer(min),
      });

      throw new ZeroHashError(
        ErrorCode.VERSION_INCOMPATIBLE,
        `SDK version ${formatSemVer(current)} is below the minimum required version ${formatSemVer(min)}`,
        { currentVersion: formatSemVer(current), minVersion: formatSemVer(min) }
      );
    }

    if (this.constraint.maxVersion) {
      const max = parseSemVer(this.constraint.maxVersion);
      if (max && compareSemVer(current, max) > 0) {
        this.telemetry.track("VERSION_MISMATCH", undefined, {
          currentVersion: formatSemVer(current),
          maxVersion: formatSemVer(max),
        });

        throw new ZeroHashError(
          ErrorCode.VERSION_INCOMPATIBLE,
          `SDK version ${formatSemVer(current)} exceeds maximum supported version ${formatSemVer(max)}`,
          {
            currentVersion: formatSemVer(current),
            maxVersion: formatSemVer(max),
          }
        );
      }
    }

    this.logger.info(`SDK version ${formatSemVer(current)} is compatible`);
  }

  private resolveVersionFromPackage(): string | undefined {
    try {
      // Attempt to read the installed zh-web-sdk package version at runtime
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const pkg = require("zh-web-sdk/package.json") as { version?: string };
      if (pkg.version) {
        this.logger.debug(
          `Resolved SDK version from package.json: ${pkg.version}`
        );
        return pkg.version;
      }
    } catch {
      // Package resolution failed — not critical
    }
    return undefined;
  }
}
