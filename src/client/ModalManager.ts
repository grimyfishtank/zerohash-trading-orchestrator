import { ErrorCode } from "../errors/ErrorCodes";
import { ZeroHashError } from "../errors/ZeroHashError";
import type { TelemetryEmitter } from "../telemetry/TelemetryHooks";
import type { Logger } from "../utils/logger";
import type { TradingFlowType, ZeroHashSDKInstance } from "./types";

export class ModalManager {
  private activeFlow: TradingFlowType | null = null;
  private opening = false;

  constructor(
    private readonly sdk: ZeroHashSDKInstance,
    private readonly telemetry: TelemetryEmitter,
    private readonly logger: Logger
  ) {}

  get currentFlow(): TradingFlowType | null {
    return this.activeFlow;
  }

  get isOpen(): boolean {
    return this.activeFlow !== null;
  }

  async open(
    flow: TradingFlowType,
    jwt: string,
    metadata?: Record<string, unknown>
  ): Promise<void> {
    // Guard: prevent concurrent open attempts
    if (this.opening) {
      throw new ZeroHashError(
        ErrorCode.MODAL_CONFLICT,
        "A modal open operation is already in progress",
        { flow, activeFlow: this.activeFlow }
      );
    }

    // Guard: prevent opening when another modal is active
    if (this.activeFlow !== null) {
      // Cross-check with SDK state — the modal may have been closed externally
      if (this.sdk.isModalOpen()) {
        this.telemetry.track("MODAL_CONFLICT_DETECTED", flow, {
          activeFlow: this.activeFlow,
        });

        throw new ZeroHashError(
          ErrorCode.MODAL_CONFLICT,
          `Cannot open flow "${flow}" — flow "${this.activeFlow}" is already active`,
          { flow, activeFlow: this.activeFlow }
        );
      }

      // SDK says modal is closed — reconcile our state
      this.logger.warn("Stale modal state detected, reconciling", {
        staleFlow: this.activeFlow,
      });
      this.activeFlow = null;
    }

    this.opening = true;

    try {
      this.logger.info("Opening modal", { flow });

      await this.sdk.openModal({
        flow,
        jwt,
        metadata,
      });

      this.activeFlow = flow;
      this.telemetry.track("FLOW_OPENED", flow);
    } catch (error: unknown) {
      throw ZeroHashError.fromUnknown(error, ErrorCode.NETWORK_ERROR);
    } finally {
      this.opening = false;
    }
  }

  async close(flow: TradingFlowType): Promise<void> {
    if (this.activeFlow !== flow) {
      // Cross-check with SDK — the modal may have been closed externally
      if (!this.sdk.isModalOpen()) {
        const staleFlow = this.activeFlow;
        this.logger.warn("Stale modal state in close, reconciling", {
          requestedFlow: flow,
          staleFlow,
        });
        this.activeFlow = null;
        // Emit for the flow that was actually active, not the one requested
        if (staleFlow) {
          this.telemetry.track("FLOW_CLOSED", staleFlow);
        }
        return;
      }

      throw new ZeroHashError(
        ErrorCode.FLOW_NOT_ACTIVE,
        `Cannot close flow "${flow}" — it is not the active flow`,
        { flow, activeFlow: this.activeFlow }
      );
    }

    try {
      this.logger.info("Closing modal", { flow });
      await this.sdk.closeModal();
      this.telemetry.track("FLOW_CLOSED", flow);
    } catch (error: unknown) {
      throw ZeroHashError.fromUnknown(error, ErrorCode.MODAL_CLOSE_FAILED);
    } finally {
      // Always clear state — even on error the modal may be gone
      this.activeFlow = null;
    }
  }

  forceReset(): void {
    this.activeFlow = null;
    this.opening = false;
    this.logger.warn("Modal state force-reset");
  }
}
