export interface HlcTimestamp {
  readonly physicalTime: number; // Wall clock ms
  readonly counter: number; // Logical counter
  readonly nodeId: string; // Device / node ID
}

export class HybridLogicalClock {
  private latestTime: number;
  private counter: number;
  private readonly nodeId: string;

  constructor(nodeId: string) {
    this.nodeId = nodeId;
    this.latestTime = Date.now();
    this.counter = 0;
  }

  /**
   * Generates a new locally monotonic HLC timestamp string.
   */
  now(): string {
    const physical = Date.now();

    if (physical > this.latestTime) {
      this.latestTime = physical;
      this.counter = 0;
    } else {
      this.counter++;
    }

    return this.format(this.latestTime, this.counter, this.nodeId);
  }

  /**
   * Updates local HLC state given a remote timestamp received over the network.
   */
  update(remoteTimestampStr: string): string {
    const remote = HybridLogicalClock.parse(remoteTimestampStr);
    const physical = Date.now();

    if (physical > this.latestTime && physical > remote.physicalTime) {
      this.latestTime = physical;
      this.counter = 0;
    } else if (this.latestTime === remote.physicalTime) {
      this.counter = Math.max(this.counter, remote.counter) + 1;
    } else if (remote.physicalTime > this.latestTime) {
      this.latestTime = remote.physicalTime;
      this.counter = remote.counter + 1;
    } else {
      this.counter++;
    }

    return this.format(this.latestTime, this.counter, this.nodeId);
  }

  private format(physical: number, counter: number, nodeId: string): string {
    const p = physical.toString(16).padStart(12, "0");
    const c = counter.toString(16).padStart(4, "0");
    return `${p}_${c}_${nodeId}`;
  }

  /**
   * Parses an HLC string into its components.
   */
  static parse(timestampStr: string): HlcTimestamp {
    const parts = timestampStr.split("_");
    if (parts.length < 3) {
      return {
        physicalTime: 0,
        counter: 0,
        nodeId: "unknown",
      };
    }
    const physicalTime = parseInt(parts[0]!, 16) || 0;
    const counter = parseInt(parts[1]!, 16) || 0;
    const nodeId = parts.slice(2).join("_");

    return { physicalTime, counter, nodeId };
  }

  /**
   * Compares two HLC timestamp strings.
   * Returns:
   *  < 0 if a < b
   *    0 if a === b
   *  > 0 if a > b
   */
  static compare(a: string, b: string): number {
    const parsedA = this.parse(a);
    const parsedB = this.parse(b);

    if (parsedA.physicalTime !== parsedB.physicalTime) {
      return parsedA.physicalTime - parsedB.physicalTime;
    }
    if (parsedA.counter !== parsedB.counter) {
      return parsedA.counter - parsedB.counter;
    }
    return parsedA.nodeId.localeCompare(parsedB.nodeId);
  }
}
