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
      this.increment();
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
      this.counter = Math.max(this.counter, remote.counter);
      this.increment();
    } else if (remote.physicalTime > this.latestTime) {
      this.latestTime = remote.physicalTime;
      this.counter = remote.counter;
      this.increment();
    } else {
      this.increment();
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
    const canonical = /^([0-9a-f]+)_([0-9a-f]+)_(.+)$/.exec(timestampStr);
    if (canonical) {
      const physicalTime = Number.parseInt(canonical[1]!, 16);
      const counter = Number.parseInt(canonical[2]!, 16);
      if (Number.isSafeInteger(physicalTime) && Number.isSafeInteger(counter)) {
        return { physicalTime, counter, nodeId: canonical[3]! };
      }
    }

    // Accept timestamps written by existing app/outbox code while callers migrate
    // to the canonical hexadecimal HLC representation.
    const legacy = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z)([:|])(\d+)\2(.+)$/.exec(
      timestampStr,
    );
    if (legacy) {
      const physicalTime = Date.parse(legacy[1]!);
      const counter = Number.parseInt(legacy[3]!, 10);
      if (
        Number.isSafeInteger(physicalTime) &&
        new Date(physicalTime).toISOString() === legacy[1] &&
        Number.isSafeInteger(counter)
      ) {
        return { physicalTime, counter, nodeId: legacy[4]! };
      }
    }

    throw new RangeError("Invalid HLC timestamp");
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
      return parsedA.physicalTime < parsedB.physicalTime ? -1 : 1;
    }
    if (parsedA.counter !== parsedB.counter) {
      return parsedA.counter < parsedB.counter ? -1 : 1;
    }
    return parsedA.nodeId.localeCompare(parsedB.nodeId);
  }

  private increment(): void {
    if (this.counter < Number.MAX_SAFE_INTEGER) {
      this.counter++;
      return;
    }
    if (this.latestTime >= Number.MAX_SAFE_INTEGER) {
      throw new RangeError("HLC timestamp space exhausted");
    }
    this.latestTime++;
    this.counter = 0;
  }
}
