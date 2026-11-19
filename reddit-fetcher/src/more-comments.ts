export interface ResponseLike {
  url(): string;
}

export interface ResponseSource {
  on(event: 'response', handler: (response: ResponseLike) => void): void;
  off(event: 'response', handler: (response: ResponseLike) => void): void;
}

/**
 * Counts the `/svc/shreddit/more-comments` responses a page receives, so the
 * expansion loop can wait for the data instead of sleeping. Reddit renders the
 * new replies only after these responses land, so clicking again before they
 * arrive finds no controls.
 */
export class MoreCommentsTracker {
  private responses = 0;
  private readonly handler = (response: ResponseLike): void => {
    if (response.url().includes('/svc/shreddit/more-comments')) {
      this.responses += 1;
    }
  };

  constructor(private readonly source?: ResponseSource) {
    if (typeof source?.on === 'function') {
      source.on('response', this.handler);
    }
  }

  get count(): number {
    return this.responses;
  }

  /** Resolves true once `clicked` new responses arrived, false on timeout. */
  async waitFor(
    clicked: number,
    timeoutMs: number,
    pollMs = 20,
  ): Promise<boolean> {
    const target = this.responses + clicked;
    const deadline = Date.now() + timeoutMs;
    while (this.responses < target) {
      if (Date.now() >= deadline) return false;
      await new Promise((resolve) => setTimeout(resolve, pollMs));
    }
    return true;
  }

  stop(): void {
    if (typeof this.source?.off === 'function') {
      this.source.off('response', this.handler);
    }
  }
}
