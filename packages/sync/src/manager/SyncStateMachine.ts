import { SyncError } from "@platform/core";
import type { SyncState } from "../types.js";

export class SyncStateMachine {
  private currentState: SyncState = "DISCONNECTED";
  private readonly listeners = new Set<
    (newState: SyncState, oldState: SyncState) => void
  >();

  getState(): SyncState {
    return this.currentState;
  }

  transition(newState: SyncState, reason?: string): void {
    if (this.currentState === newState) return;

    if (!this.isLegalTransition(this.currentState, newState)) {
      throw new SyncError({
        message: `Illegal sync state transition from '${this.currentState}' to '${newState}'${reason ? `: ${reason}` : ""}`,
        userMessage: "Sync connection state error",
        correlationId: `sync_state_${this.currentState}_to_${newState}`,
      });
    }

    const oldState = this.currentState;
    this.currentState = newState;

    for (const listener of this.listeners) {
      listener(newState, oldState);
    }
  }

  onStateChange(
    listener: (newState: SyncState, oldState: SyncState) => void,
  ): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private isLegalTransition(from: SyncState, to: SyncState): boolean {
    // Any state can transition to terminal/error states or DISCONNECTED
    if (
      to === "DISCONNECTED" ||
      to === "REVOKED" ||
      to === "EXPIRED" ||
      to === "INCOMPATIBLE" ||
      to === "ERROR"
    ) {
      return true;
    }

    switch (from) {
      case "DISCONNECTED":
        return to === "DISCOVERED" || to === "CONNECTING";
      case "DISCOVERED":
        return to === "IDENTIFIED" || to === "CONNECTING";
      case "IDENTIFIED":
        return to === "CONNECTING";
      case "CONNECTING":
        return to === "CONNECTED";
      case "CONNECTED":
        return to === "AUTHENTICATING";
      case "AUTHENTICATING":
        return to === "AUTHORISED";
      case "AUTHORISED":
        return to === "SYNCING" || to === "IDLE";
      case "SYNCING":
        return to === "IDLE";
      case "IDLE":
        return to === "SYNCING";
      default:
        return false;
    }
  }
}
